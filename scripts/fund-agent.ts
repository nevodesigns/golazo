/**
 * fund-agent.ts: top up the Golazo agent's Injective USDC over Circle CCTP V2.
 *
 * The agent pays for premium data in USDC on Injective. When it runs low it can
 * refuel from another chain instead of waiting on a human. This script bridges
 * USDC from Avalanche Fuji to the agent's Injective wallet using Circle's
 * Cross-Chain Transfer Protocol V2: burn on the source, fetch Circle's
 * attestation, mint on the destination. Native USDC, no wrapped tokens, no
 * liquidity pool.
 *
 * Flow (all testnet):
 *   1. approve         USDC -> TokenMessengerV2 on Avalanche Fuji
 *   2. depositForBurn  burn the USDC on Fuji, addressed to the agent on Injective
 *   3. attestation     poll Circle's Iris sandbox until the burn is attested
 *   4. receiveMessage  mint the USDC on Injective to the agent
 *
 * Two Injective-specific adaptations, both deliberate:
 *   - The mint is confirmed with eth_getLogs, not eth_getTransactionReceipt,
 *     because Injective testnet does not serve receipts. See
 *     docs/testnet-rpc-notes.md.
 *   - The mint (receiveMessage) is relayed by the facilitator wallet, which
 *     holds INJ for gas. destinationCaller is left as bytes32(0) so any wallet
 *     may relay, and the USDC still mints to the agent (mintRecipient). This is
 *     how the agent can be funded even with zero INJ of its own.
 *
 * Usage:
 *   GOLAZO_WALLET_KEY=0x..  (agent: burns on Fuji, receives on Injective)
 *   PRIVATE_KEY=0x..        (facilitator: relays the Injective mint, needs INJ)
 *   npm run fund-agent -- 1        # bridge 1 USDC (default 0.5)
 */
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  encodeFunctionData,
  parseUnits,
  formatUnits,
  parseAbiItem,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

/* ----------------------------- configuration ----------------------------- */

const AGENT_KEY = process.env.GOLAZO_WALLET_KEY as Hex | undefined;
const RELAY_KEY = (process.env.PRIVATE_KEY ?? process.env.GOLAZO_WALLET_KEY) as Hex | undefined;
if (!AGENT_KEY) {
  console.error("fund-agent: GOLAZO_WALLET_KEY is required (the agent wallet).");
  process.exit(1);
}

const AMOUNT_USDC = process.argv[2] ?? process.env.CCTP_AMOUNT ?? "0.5";
const IRIS = process.env.IRIS_API_URL ?? "https://iris-api-sandbox.circle.com";

// Circle CCTP V2 uses the same contract addresses across every testnet EVM chain.
const TOKEN_MESSENGER: Hex = "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA";
const MESSAGE_TRANSMITTER: Hex = "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275";

const FUJI = {
  chain: defineChain({
    id: 43113,
    name: "Avalanche Fuji",
    nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
    rpcUrls: { default: { http: [process.env.FUJI_RPC_URL ?? "https://api.avax-test.network/ext/bc/C/rpc"] } },
  }),
  usdc: "0x5425890298aed601595a70AB815c96711a31Bc65" as Hex,
  domain: 1,
};

const INJECTIVE = {
  chain: defineChain({
    id: 1439,
    name: "Injective Testnet",
    nativeCurrency: { name: "Injective", symbol: "INJ", decimals: 18 },
    rpcUrls: { default: { http: [process.env.INJ_RPC_URL ?? "https://k8s.testnet.json-rpc.injective.network"] } },
  }),
  usdc: "0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d" as Hex,
  domain: 29,
};

const BYTES32_ZERO = ("0x" + "0".repeat(64)) as Hex;
const STANDARD_FINALITY_THRESHOLD = 2000; // hard finality; fast transfers use 1000 and a fee.

/* -------------------------------- helpers -------------------------------- */

const t0 = Date.now();
const log = (msg: string) => console.log(`[+${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);
const toBytes32 = (addr: string): Hex => ("0x" + addr.replace(/^0x/, "").toLowerCase().padStart(64, "0")) as Hex;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const erc20 = [
  parseAbiItem("function balanceOf(address) view returns (uint256)"),
  parseAbiItem("function allowance(address owner, address spender) view returns (uint256)"),
  parseAbiItem("function approve(address spender, uint256 amount) returns (bool)"),
];
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const DEPOSIT_FOR_BURN = parseAbiItem(
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold)"
);
const RECEIVE_MESSAGE = parseAbiItem("function receiveMessage(bytes message, bytes attestation) returns (bool)");

/* --------------------------------- main ---------------------------------- */

const agent = privateKeyToAccount(AGENT_KEY);
const relayer = privateKeyToAccount(RELAY_KEY!);

const fujiPub = createPublicClient({ chain: FUJI.chain, transport: http() });
const fujiWallet = createWalletClient({ account: agent, chain: FUJI.chain, transport: http() });
const injPub = createPublicClient({ chain: INJECTIVE.chain, transport: http() });
const injWallet = createWalletClient({ account: relayer, chain: INJECTIVE.chain, transport: http() });

async function usdcBalance(pub: { readContract: (args: any) => Promise<unknown> }, token: Hex, who: Hex): Promise<bigint> {
  return pub.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [who] }) as Promise<bigint>;
}

/** Confirm a mint on Injective by its USDC Transfer log, since receipts are not
 *  served. Matches the mint transaction hash and the recipient. */
async function confirmMintViaLogs(txHash: Hex, to: Hex): Promise<bigint | null> {
  const start = await injPub.getBlockNumber();
  const deadline = Date.now() + 120_000;
  let polls = 0;
  while (Date.now() < deadline) {
    polls++;
    const logs = await injPub.getLogs({
      address: INJECTIVE.usdc,
      event: TRANSFER,
      args: { to },
      fromBlock: start > 20n ? start - 20n : 0n,
    });
    const hit = logs.find((l) => l.transactionHash?.toLowerCase() === txHash.toLowerCase());
    if (hit) {
      log(`mint confirmed via eth_getLogs: block ${hit.blockNumber} after ${polls} poll(s)`);
      return hit.blockNumber;
    }
    await sleep(2000);
  }
  return null;
}

async function main() {
  const amount = parseUnits(AMOUNT_USDC, 6);
  console.log("Golazo CCTP funding: Avalanche Fuji -> Injective");
  console.log(`  agent (burns, receives): ${agent.address}`);
  console.log(`  relayer (mints on Injective): ${relayer.address}`);
  console.log(`  amount: ${AMOUNT_USDC} USDC\n`);

  /* -- preflight: the agent needs USDC to burn and AVAX for gas on Fuji -- */
  const [fujiUsdc, fujiGas, injBefore] = await Promise.all([
    usdcBalance(fujiPub, FUJI.usdc, agent.address),
    fujiPub.getBalance({ address: agent.address }),
    usdcBalance(injPub, INJECTIVE.usdc, agent.address),
  ]);
  log(`Fuji USDC:      ${formatUnits(fujiUsdc, 6)}`);
  log(`Fuji AVAX gas:  ${formatUnits(fujiGas, 18)}`);
  log(`Injective USDC (before): ${formatUnits(injBefore, 6)}\n`);

  if (fujiUsdc < amount || fujiGas === 0n) {
    console.error("Cannot start the burn: the agent wallet is not funded on Avalanche Fuji.");
    console.error("Fund it, then run again:");
    if (fujiUsdc < amount)
      console.error(`  - USDC:  https://faucet.circle.com  (select Avalanche Fuji, address ${agent.address})`);
    if (fujiGas === 0n)
      console.error(`  - AVAX:  https://faucet.avax.network  (Fuji C-Chain, address ${agent.address})`);
    process.exit(2);
  }

  /* -- step 1: approve -- */
  const allowance: bigint = await fujiPub.readContract({
    address: FUJI.usdc, abi: erc20, functionName: "allowance", args: [agent.address, TOKEN_MESSENGER],
  });
  if (allowance < amount) {
    log("step 1/4 approve: granting TokenMessengerV2 an allowance on Fuji");
    const approveTx = await fujiWallet.sendTransaction({
      to: FUJI.usdc,
      data: encodeFunctionData({ abi: erc20, functionName: "approve", args: [TOKEN_MESSENGER, amount] }),
    });
    log(`  approve tx: ${approveTx}`);
    await fujiPub.waitForTransactionReceipt({ hash: approveTx });
    log("  approved");
  } else {
    log("step 1/4 approve: existing allowance is sufficient, skipping");
  }

  /* -- step 2: burn on Fuji -- */
  log("step 2/4 burn: depositForBurn on Fuji (standard transfer)");
  const mintRecipient = toBytes32(agent.address);
  const burnTx = await fujiWallet.sendTransaction({
    to: TOKEN_MESSENGER,
    data: encodeFunctionData({
      abi: [DEPOSIT_FOR_BURN],
      functionName: "depositForBurn",
      args: [amount, INJECTIVE.domain, mintRecipient, FUJI.usdc, BYTES32_ZERO, 0n, STANDARD_FINALITY_THRESHOLD],
    }),
  });
  log(`  burn tx (Fuji): ${burnTx}`);
  await fujiPub.waitForTransactionReceipt({ hash: burnTx });
  log(`  burned. explorer: https://testnet.snowtrace.io/tx/${burnTx}`);

  /* -- step 3: attestation from Circle's Iris sandbox -- */
  log("step 3/4 attestation: polling Circle Iris sandbox");
  const url = `${IRIS}/v2/messages/${FUJI.domain}?transactionHash=${burnTx}`;
  let message: Hex, attestation: Hex;
  const attDeadline = Date.now() + 900_000; // standard finality can take a while
  for (;;) {
    if (Date.now() > attDeadline) throw new Error("attestation did not complete within 15 minutes");
    const res = await fetch(url);
    if (res.status === 404) { await sleep(5000); continue; }
    if (!res.ok) throw new Error(`Iris request failed: ${res.status}`);
    const data: any = await res.json();
    const m = data?.messages?.[0];
    if (m?.status === "complete" && m.message && m.attestation) {
      message = m.message; attestation = m.attestation;
      log(`  attestation complete (nonce ${m.eventNonce ?? "n/a"})`);
      break;
    }
    log(`  waiting for attestation (status: ${m?.status ?? "pending"})`);
    await sleep(5000);
  }

  /* -- step 4: mint on Injective, relayed by the facilitator (has INJ gas) -- */
  log("step 4/4 mint: receiveMessage on Injective, relayed by the facilitator");
  const mintData = encodeFunctionData({ abi: [RECEIVE_MESSAGE], functionName: "receiveMessage", args: [message!, attestation!] });
  let gas: bigint;
  try {
    gas = (await injPub.estimateGas({ account: relayer, to: MESSAGE_TRANSMITTER, data: mintData })) * 120n / 100n;
  } catch {
    gas = 800_000n; // estimate can be unreliable on this testnet; use a safe ceiling
  }
  const mintTx = await injWallet.sendTransaction({ to: MESSAGE_TRANSMITTER, data: mintData, gas });
  log(`  mint tx (Injective): ${mintTx}`);

  const block = await confirmMintViaLogs(mintTx, agent.address);
  if (block === null) throw new Error("mint submitted but not observed via eth_getLogs within 120s");
  log(`  minted. explorer: https://testnet.blockscout.injective.network/tx/${mintTx}`);

  /* -- result -- */
  const injAfter = await usdcBalance(injPub, INJECTIVE.usdc, agent.address);
  console.log("\nDone. The agent refuelled itself across chains.");
  console.log(`  Injective USDC: ${formatUnits(injBefore, 6)} -> ${formatUnits(injAfter, 6)}`);
  console.log(`  burn tx (Fuji):      ${burnTx}`);
  console.log(`  mint tx (Injective): ${mintTx}`);
}

main().catch((e) => { console.error("\nfund-agent failed:", (e as Error).message); process.exit(1); });
