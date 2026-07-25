import express, { type Request, type Response, type NextFunction } from "express";
import { injectivePaymentMiddleware } from "@injectivelabs/x402/middleware";
import {
  INJECTIVE_MAINNET_CAIP2,
  INJECTIVE_TESTNET_CAIP2,
} from "@injectivelabs/x402/networks";
import { privateKeyToAccount } from "viem/accounts";

import * as store from "./lib/store.js";
import {
  teamPerformance,
  headToHead,
  matchAnalytics,
  tournamentStats,
} from "./lib/analytics.js";
import { rateLimit } from "./lib/rateLimit.js";

const PORT = Number(process.env.PORT ?? 3000);

/**
 * Network selection.
 *
 * Testnet is the default so the API can be run and demonstrated without real
 * funds. Switching to mainnet is the one line change below: set
 * X402_NETWORK=mainnet. Nothing else in the codebase needs to change.
 */
const USE_MAINNET = process.env.X402_NETWORK === "mainnet";

const NETWORK = USE_MAINNET ? INJECTIVE_MAINNET_CAIP2 : INJECTIVE_TESTNET_CAIP2;

// Native Circle USDC, EIP-3009 capable on both networks.
const USDC: `0x${string}` = USE_MAINNET
  ? "0xa00C59fF5a080D2b954d0c75e46E22a0c371235a"
  : "0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d";

// 0.01 USDC. USDC carries 6 decimals, so this is in smallest units.
const PRICE = "10000";

const app = express();
app.use(express.json());
// Per-client rate limit (default 120 req / 60s). Applied before routing so it
// covers every endpoint, free and premium alike.
app.use(rateLimit());

/* ------------------------------------------------------------------ *
 * x402 paywall
 *
 * Applied before the premium routes so an unpaid request never reaches
 * the handler. settlementPolicy "after-success" means a client is only
 * charged when the endpoint actually returns 2xx, so a validation error
 * or a missing record costs the caller nothing.
 * ------------------------------------------------------------------ */
const PREMIUM_ROUTES = {
  "GET /v1/premium/match/:id": "Detailed analytics for a single match",
  "GET /v1/premium/h2h/:teamA/:teamB": "Head to head record between two teams",
  "GET /v1/premium/team/:id": "Full performance breakdown for one team",
  "GET /v1/premium/stats": "Complete tournament statistics export",
} as const;

const facilitatorKey = process.env.PRIVATE_KEY as `0x${string}` | undefined;

// When settling through an external facilitator, each route must name its payTo.
// It is the facilitator wallet, derived from the same key, since that wallet
// submits the transfer and receives the USDC.
const PAY_TO = facilitatorKey ? privateKeyToAccount(facilitatorKey).address : undefined;

const FACILITATOR_URL = process.env.GOLAZO_FACILITATOR_URL;

const paywallConfig = Object.fromEntries(
  Object.entries(PREMIUM_ROUTES).map(([route, description]) => [
    route,
    {
      description,
      accepts: [
        {
          network: NETWORK,
          asset: USDC,
          amount: PRICE,
          ...(FACILITATOR_URL && PAY_TO ? { payTo: PAY_TO } : {}),
        },
      ],
    },
  ])
);

if (FACILITATOR_URL) {
  // Custom facilitator that confirms settlement via eth_getLogs, which the
  // Injective testnet serves, unlike eth_getTransactionReceipt. See the
  // facilitator server and docs/testnet-rpc-notes.md.
  app.use(
    injectivePaymentMiddleware(paywallConfig, {
      facilitatorUrl: FACILITATOR_URL,
      settlementPolicy: "after-success",
    })
  );
  console.log(
    `x402 paywall active on ${USE_MAINNET ? "mainnet" : "testnet"} (${NETWORK}), ` +
      `settling via external facilitator ${FACILITATOR_URL}`
  );
} else if (facilitatorKey) {
  app.use(
    injectivePaymentMiddleware(paywallConfig, {
      facilitator: { privateKey: facilitatorKey },
      settlementPolicy: "after-success",
    })
  );
  console.log(`x402 paywall active on ${USE_MAINNET ? "mainnet" : "testnet"} (${NETWORK})`);
} else {
  // Without a facilitator key the server cannot settle payments, so rather than
  // silently serving premium data for free we answer 402 ourselves with the
  // same payment terms. The paywall is never bypassed.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith("/v1/premium/")) return next();
    return res.status(402).json({
      error: "payment_required",
      message:
        "This endpoint requires an x402 micropayment. The server has no facilitator key configured, so payments cannot be settled here.",
      accepts: [
        {
          scheme: "exact",
          network: NETWORK,
          asset: USDC,
          amount: PRICE,
          description: "0.01 USDC per request",
        },
      ],
      howToPay:
        "Set PRIVATE_KEY on the server to enable settlement, then retry with an X-PAYMENT header. See README.",
    });
  });
  console.log("x402 paywall in terms-only mode: PRIVATE_KEY not set, premium routes answer 402");
}

/* ---------------------------- free ---------------------------- */

app.get("/health", (_req: Request, res: Response) => {
  try {
    const d = store.load();
    res.json({
      status: "ok",
      dataset: {
        matches: d.matches.length,
        teams: d.teams.length,
        coverage: d.meta.coverage,
        generatedAt: d.meta.generatedAt,
      },
      x402: {
        network: NETWORK,
        mode: USE_MAINNET ? "mainnet" : "testnet",
        settlementEnabled: Boolean(facilitatorKey),
        pricePerCall: "0.01 USDC",
      },
    });
  } catch (err) {
    res.status(503).json({ status: "degraded", error: (err as Error).message });
  }
});

app.get("/v1/tournament", (_req: Request, res: Response) => {
  const d = store.load();
  res.json({ tournament: d.tournament, meta: d.meta });
});

app.get("/v1/teams", (_req: Request, res: Response) => {
  res.json({ count: store.teams().length, teams: store.teams() });
});

app.get("/v1/matches", (req: Request, res: Response) => {
  const stage = typeof req.query.stage === "string" ? req.query.stage : undefined;
  const team = typeof req.query.team === "string" ? req.query.team : undefined;

  const VALID = [
    "group", "round_of_32", "round_of_16",
    "quarter_final", "semi_final", "third_place", "final",
  ];
  if (stage && !VALID.includes(stage)) {
    return res.status(400).json({
      error: "invalid_stage",
      message: `stage must be one of: ${VALID.join(", ")}`,
    });
  }
  if (team && !store.findTeam(team)) {
    return res.status(404).json({ error: "unknown_team", message: `no team matching '${team}'` });
  }

  const list = store.matches({ stage, team });
  res.json({ count: list.length, filters: { stage, team }, matches: list });
});

/* --------------------------- premium --------------------------- */

app.get("/v1/premium/match/:id", (req: Request, res: Response) => {
  const m = store.findMatch(req.params.id);
  if (!m) {
    return res.status(404).json({ error: "unknown_match", message: `no match with id '${req.params.id}'` });
  }
  res.json(matchAnalytics(m));
});

app.get("/v1/premium/h2h/:teamA/:teamB", (req: Request, res: Response) => {
  const { teamA, teamB } = req.params;
  if (teamA.toLowerCase() === teamB.toLowerCase()) {
    return res.status(400).json({ error: "invalid_request", message: "provide two different teams" });
  }
  const result = headToHead(teamA, teamB);
  if (!result) {
    return res.status(404).json({ error: "unknown_team", message: `could not resolve '${teamA}' or '${teamB}'` });
  }
  res.json(result);
});

app.get("/v1/premium/team/:id", (req: Request, res: Response) => {
  const perf = teamPerformance(req.params.id);
  if (!perf) {
    return res.status(404).json({ error: "unknown_team", message: `no team matching '${req.params.id}'` });
  }
  res.json(perf);
});

app.get("/v1/premium/stats", (_req: Request, res: Response) => {
  res.json(tournamentStats());
});

/* ---------------------------- errors ---------------------------- */

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "not_found", message: "no such endpoint. See / for the route list." });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "internal_error", message: err.message });
});

app.listen(PORT, () => {
  console.log(`golazo listening on http://localhost:${PORT}`);
});
