/**
 * x402 aware fetch for the MCP server.
 *
 * A free endpoint is a plain fetch. A premium endpoint answers 402 with payment
 * terms; if a wallet is configured, createInjectiveClient signs an EIP-3009
 * authorisation and retries automatically, so the agent buys the data with no
 * human in the loop. If no wallet is configured, we do NOT surface a raw error:
 * we read the quoted terms and return a clear, actionable explanation.
 */
import { createInjectiveClient } from "@injectivelabs/x402/client";

const BASE = process.env.GOLAZO_API_URL ?? "http://localhost:3000";
const KEY = process.env.GOLAZO_WALLET_KEY as `0x${string}` | undefined;

let client: ReturnType<typeof createInjectiveClient> | null = null;
function payingClient() {
  if (!KEY) return null;
  if (!client) client = createInjectiveClient({ privateKey: KEY });
  return client;
}

export interface PayResult {
  ok: boolean;
  status: number;
  data?: unknown;
  /** Present when payment is required but no wallet is configured. */
  paymentNeeded?: {
    price: string;
    asset: string;
    network: string;
    message: string;
    howTo: string;
  };
  error?: string;
}

export async function apiGet(path: string): Promise<PayResult> {
  const url = `${BASE}${path}`;
  const c = payingClient();

  // With a wallet, the client transparently handles 402 -> sign -> retry.
  if (c) {
    try {
      const res = await c.fetch(url);
      const data: any = await res.json().catch(() => ({}));
      if (res.ok) return { ok: true, status: res.status, data };

      // The automatic payment was attempted but did not settle. Turn the
      // common causes into a clear, actionable message instead of raw JSON.
      const reason = String(data?.error ?? "").toLowerCase();
      const term = data?.accepts?.[0] ?? {};
      if (res.status === 402 || reason.includes("payment") || reason.includes("funds")) {
        const insufficient = reason.includes("insufficient") || reason.includes("funds");
        return {
          ok: false,
          status: res.status,
          paymentNeeded: {
            price: term.amount ? `${Number(term.amount) / 1_000_000} USDC` : "0.01 USDC",
            asset: term.asset ?? "USDC",
            network: term.network ?? "eip155:1439",
            message: insufficient
              ? "The payment was signed and submitted automatically, but the configured wallet does not hold enough USDC to settle it."
              : "The automatic payment did not settle.",
            howTo: insufficient
              ? "Fund the GOLAZO_WALLET_KEY wallet with a little USDC (testnet by default) and run the same query again."
              : "Check that GOLAZO_WALLET_KEY is a valid Injective EVM key and the facilitator is reachable, then retry.",
          },
        };
      }
      return { ok: false, status: res.status, data };
    } catch (err) {
      return { ok: false, status: 0, error: `payment or request failed: ${(err as Error).message}` };
    }
  }

  // Without a wallet, do a plain fetch. Free endpoints just work.
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    return { ok: false, status: 0, error: `could not reach the API at ${BASE}: ${(err as Error).message}` };
  }

  if (res.status !== 402) {
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  }

  // 402 without a wallet: explain rather than error.
  const body: any = await res.json().catch(() => ({}));
  const term = body?.accepts?.[0] ?? {};
  const units = term.amount ? Number(term.amount) / 1_000_000 : 0.01;
  return {
    ok: false,
    status: 402,
    paymentNeeded: {
      price: `${units} USDC`,
      asset: term.asset ?? "USDC",
      network: term.network ?? "eip155:1439",
      message:
        "This is a premium Golazo endpoint. It costs a micropayment per call, and no wallet is configured for this MCP server, so the payment cannot be made automatically.",
      howTo:
        "Set GOLAZO_WALLET_KEY to an Injective EVM private key funded with a little USDC (testnet by default). Then this same query will pay and return the data automatically, no other change needed.",
    },
  };
}
