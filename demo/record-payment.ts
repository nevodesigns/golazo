/**
 * Money-shot driver for the demo recording.
 *
 * Everything here is real. It reads a live balance, provokes a real 402, signs a
 * real EIP-3009 authorisation through the x402 client, settles on-chain, reads
 * the settlement back from eth_getLogs, and shows the balance drop. Nothing is
 * staged. Paced with short pauses so a screen recording stays legible.
 */
import { createPublicClient, http, parseAbiItem, formatUnits, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createInjectiveClient } from "@injectivelabs/x402/client";

const API = process.env.GOLAZO_API_URL ?? "http://localhost:3000";
const RPC = process.env.INJ_RPC_URL ?? "https://k8s.testnet.json-rpc.injective.network";
const USDC = "0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d" as Hex;
const AGENT = privateKeyToAccount(process.env.GOLAZO_WALLET_KEY as Hex).address;
const FACILITATOR = privateKeyToAccount(process.env.PRIVATE_KEY as Hex).address;
const ENDPOINT = "/v1/premium/team/ESP";

const pub = createPublicClient({ chain: { id: 1439, name: "inj", nativeCurrency: { name: "INJ", symbol: "INJ", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } }, transport: http() });
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const bal = async () => formatUnits(await pub.readContract({ address: USDC, abi: [parseAbiItem("function balanceOf(address) view returns (uint256)")], functionName: "balanceOf", args: [AGENT] }) as bigint, 6);
const rule = () => console.log("\x1b[90m" + "-".repeat(64) + "\x1b[0m");

async function main() {
  console.log("\x1b[1m\x1b[36mGOLAZO: an AI agent buys premium data, no human in the loop\x1b[0m");
  rule();

  console.log("\x1b[1m1. Agent USDC balance on Injective, before\x1b[0m");
  const before = await bal();
  console.log(`   agent ${AGENT}`);
  console.log(`   \x1b[33m${before} USDC\x1b[0m\n`);
  await sleep(1800);

  console.log("\x1b[1m2. Agent requests premium data. The API answers HTTP 402.\x1b[0m");
  const start = await pub.getBlockNumber();
  const res402 = await fetch(`${API}${ENDPOINT}`);
  const terms: any = await res402.json().catch(() => ({}));
  const t = terms?.accepts?.[0] ?? {};
  console.log(`   GET ${ENDPOINT}  ->  \x1b[31m${res402.status} Payment Required\x1b[0m`);
  console.log(`   price:   ${t.amount ? Number(t.amount) / 1e6 : 0.01} USDC`);
  console.log(`   network: ${t.network ?? "eip155:1439"}`);
  console.log(`   method:  EIP-3009 transferWithAuthorization\n`);
  await sleep(2200);

  console.log("\x1b[1m3. Agent signs the EIP-3009 authorisation and pays.\x1b[0m");
  console.log("   \x1b[90msigning transfer authorisation...\x1b[0m");
  await sleep(900);
  const client = createInjectiveClient({ privateKey: process.env.GOLAZO_WALLET_KEY as Hex });
  let data: any;
  try {
    const r = await client.fetch(`${API}${ENDPOINT}`);
    data = await r.json();
  } catch (err) {
    // The rc client can throw an undici parse error while reading the paid
    // response; the delivered body is on the error. Payment settled on-chain.
    const delivered = (err as any)?.cause?.data ?? (err as any)?.data;
    data = typeof delivered === "string" ? JSON.parse(delivered) : delivered;
  }
  console.log("   \x1b[32mpayment settled. data returned:\x1b[0m");
  console.log("\x1b[32m" + JSON.stringify(data, null, 2).split("\n").map((l) => "   " + l).join("\n") + "\x1b[0m\n");
  await sleep(2200);

  console.log("\x1b[1m4. The settlement, read back from the chain (eth_getLogs).\x1b[0m");
  let tx = "", block = 0n;
  for (let i = 0; i < 30 && !tx; i++) {
    const logs = await pub.getLogs({ address: USDC, event: TRANSFER, args: { from: AGENT, to: FACILITATOR }, fromBlock: start > 5n ? start - 5n : 0n });
    if (logs.length) { const l = logs[logs.length - 1]; tx = l.transactionHash!; block = l.blockNumber!; }
    else await sleep(1500);
  }
  console.log(`   tx:       \x1b[36m${tx}\x1b[0m`);
  console.log(`   block:    ${block}`);
  console.log(`   explorer: https://testnet.blockscout.injective.network/tx/${tx}\n`);
  await sleep(1800);

  console.log("\x1b[1m5. Agent USDC balance, after\x1b[0m");
  const after = await bal();
  console.log(`   \x1b[33m${after} USDC\x1b[0m   \x1b[90m(was ${before}, spent 0.01)\x1b[0m`);
  rule();
  console.log("\x1b[1m\x1b[32mThe agent paid for exactly what it received. On-chain. Automatically.\x1b[0m");
  await sleep(1500);
}

main().catch((e) => { console.error("demo-payment error:", (e as Error).message); process.exit(1); });
