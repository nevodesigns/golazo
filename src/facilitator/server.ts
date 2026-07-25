/**
 * Golazo custom x402 facilitator.
 *
 * Identical to the reference @injectivelabs/x402 facilitator except for how it
 * confirms settlement.
 *
 * The reference facilitator confirms by calling eth_getTransactionReceipt.
 * Injective testnet does not serve receipts (or eth_getTransactionByHash) for
 * EVM transactions, even though the state change happens and the logs are
 * emitted. See docs/testnet-rpc-notes.md for the tested evidence. That makes the
 * reference facilitator time out on a payment that actually succeeded on-chain.
 *
 * This facilitator submits the exact same transferWithAuthorization transaction,
 * then confirms it with eth_getLogs, which the testnet does serve. The payment
 * is byte for byte the same and fully on-chain. Only the confirmation method
 * differs. Verification (signature, balance, nonce, time window) is reused
 * unchanged from the reference facilitator.
 */
import express, { type Request, type Response } from "express";
import { createPublicClient, createWalletClient, http, parseAbiItem } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { InjectiveFacilitator } from "@injectivelabs/x402/facilitator";
import { normalizeFacilitatorRequest } from "@injectivelabs/x402/protocol";
import { encodeTransferWithAuthorizationCalldata } from "@injectivelabs/x402/eip3009";
import { getViemChain } from "@injectivelabs/x402/networks";
import type { SettleResponse } from "@injectivelabs/x402";

const KEY = process.env.PRIVATE_KEY as `0x${string}` | undefined;
if (!KEY) {
  console.error("facilitator: PRIVATE_KEY is required (the facilitator wallet, funded with INJ for gas)");
  process.exit(1);
}
const PORT = Number(process.env.FACILITATOR_PORT ?? 3402);
// Bind to loopback by default. The facilitator holds the gas wallet and does no
// auth of its own, so it must not be exposed on a public interface; the API
// server reaches it at http://localhost:3402. Override with FACILITATOR_HOST
// only when fronting it with an authenticated proxy on a trusted network.
const HOST = process.env.FACILITATOR_HOST ?? "127.0.0.1";
const account = privateKeyToAccount(KEY);

// Reuse the reference facilitator's verification: signature, balance, nonce,
// and time window are all checked off-chain or with eth_call, none of which
// depend on the receipt endpoint.
const verifier = new InjectiveFacilitator({ privateKey: KEY });

const TRANSFER = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)"
);

function clientsFor(network: string) {
  const chain = getViemChain(network as any);
  const rpc = process.env.INJ_RPC_URL || chain.rpcUrls.default.http[0];
  return {
    chain,
    pub: createPublicClient({ chain, transport: http(rpc) }),
    wallet: createWalletClient({ account, chain, transport: http(rpc) }),
  };
}

/** Confirm a settlement by watching for its USDC Transfer log, since the
 *  testnet does not serve receipts. Returns the block number or null. */
async function confirmViaLogs(
  pub: ReturnType<typeof clientsFor>["pub"],
  token: `0x${string}`,
  from: `0x${string}`,
  to: `0x${string}`,
  value: bigint,
  txHash: string
): Promise<bigint | null> {
  const start = await pub.getBlockNumber();
  const deadline = Date.now() + 90_000;
  let polls = 0;
  while (Date.now() < deadline) {
    polls++;
    const logs = await pub.getLogs({
      address: token,
      event: TRANSFER,
      args: { from, to },
      fromBlock: start > 10n ? start - 10n : 0n,
    });
    const hit = logs.find(
      (l) => l.transactionHash?.toLowerCase() === txHash.toLowerCase() && l.args.value === value
    );
    if (hit) {
      console.error(`  confirmed via eth_getLogs: block ${hit.blockNumber} after ${polls} poll(s)`);
      return hit.blockNumber;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

async function settle(req: any): Promise<SettleResponse> {
  const { paymentPayload, paymentRequirements } = req;
  const payload = paymentPayload.payload;
  const auth = payload.authorization;
  const network = paymentRequirements.network as string;

  const v = await verifier.verify(req);
  if (!v.isValid) {
    return {
      success: false,
      errorReason: v.invalidReason,
      errorMessage: v.invalidMessage,
      payer: v.payer,
      transaction: "",
      network,
    };
  }

  const { chain, pub, wallet } = clientsFor(network);
  const token = paymentRequirements.asset as `0x${string}`;
  try {
    const data = encodeTransferWithAuthorizationCalldata(payload);
    const txHash = await wallet.sendTransaction({ chain, account, to: token, data });
    console.error(`  submitted transferWithAuthorization: ${txHash}`);

    const block = await confirmViaLogs(
      pub,
      token,
      auth.from as `0x${string}`,
      auth.to as `0x${string}`,
      BigInt(auth.value),
      txHash
    );
    if (block === null) {
      return {
        success: false,
        errorReason: "settlement_failed",
        errorMessage: "transfer was submitted but not observed via eth_getLogs within 90s",
        payer: auth.from,
        transaction: "",
        network,
      };
    }
    return {
      success: true,
      transaction: txHash,
      network,
      payer: auth.from,
      amount: paymentRequirements.amount,
      extra: { blockNumber: String(block), confirmedVia: "eth_getLogs" },
    };
  } catch (e) {
    return {
      success: false,
      errorReason: "settlement_failed",
      errorMessage: (e as Error).message,
      payer: auth.from,
      transaction: "",
      network,
    };
  }
}

const app = express();
app.use(express.json());

app.post("/verify", async (req: Request, res: Response) => {
  try {
    res.json(await verifier.verify(normalizeFacilitatorRequest(req.body) as any));
  } catch (e) {
    res.status(400).json({ isValid: false, invalidReason: "invalid_request", invalidMessage: (e as Error).message });
  }
});

app.post("/settle", async (req: Request, res: Response) => {
  try {
    res.json(await settle(normalizeFacilitatorRequest(req.body)));
  } catch (e) {
    res.status(400).json({
      success: false,
      errorReason: "invalid_request",
      errorMessage: (e as Error).message,
      transaction: "",
      network: "",
    });
  }
});

app.get("/health", (_req: Request, res: Response) =>
  res.json({ status: "ok", facilitator: account.address, confirms: "eth_getLogs" })
);

app.listen(PORT, HOST, () =>
  console.error(`golazo facilitator (getLogs confirmation) on ${HOST}:${PORT}, address ${account.address}`)
);
