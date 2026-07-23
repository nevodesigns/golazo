# Golazo

An agent payable World Cup 2026 data API. Free endpoints serve the tournament
archive. Premium endpoints are gated behind real x402 micropayments in USDC on
Injective, at 0.01 USDC per call.

The 2026 World Cup ended on 19 July 2026. The dataset is therefore a fixed
historical archive rather than a live feed, and nobody had made it agent
accessible. Golazo does.

## Status, stated plainly

The x402 dependency is **`@injectivelabs/x402@0.1.0-rc.1`**. It is a release
candidate: only two versions have ever been published (`0.0.1` and this one),
and the referenced source repository `InjectiveLabs/x402` currently returns
**404**, so there is no public code to audit. The library works, and the paywall
in this project is genuinely enforced by it, but this is early software and
should be treated as such. Being straight about that is better than implying a
stability that does not exist yet.

The Injective docs page and the published package also disagree on the
middleware options shape. The docs show `{ facilitatorUrl }`; the package takes
`{ facilitator: { privateKey } }`. This project follows the **package**, because
that is what actually runs.

## Quick start

```bash
npm install
npm run ingest        # builds the dataset offline from the committed seed
npm run dev           # http://localhost:3000
```

No API key and no network access are needed to run it.

## Endpoints

### Free

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Service and dataset status, x402 configuration |
| GET | `/v1/tournament` | Tournament summary and metadata |
| GET | `/v1/teams` | All teams in the dataset |
| GET | `/v1/matches` | Matches, filterable with `?stage=` and `?team=` |

### Premium, 0.01 USDC per call

| Method | Path | Description |
|---|---|---|
| GET | `/v1/premium/match/:id` | Detailed analytics for one match |
| GET | `/v1/premium/h2h/:teamA/:teamB` | Head to head record between two teams |
| GET | `/v1/premium/team/:id` | Full performance breakdown for one team |
| GET | `/v1/premium/stats` | Complete tournament statistics export |

## How payment works

An unpaid request to a premium endpoint returns HTTP 402 with the payment
terms:

```json
{
  "x402Version": 2,
  "error": "PAYMENT-SIGNATURE header is required",
  "accepts": [{
    "scheme": "exact",
    "network": "eip155:1439",
    "amount": "10000",
    "payTo": "0x...",
    "asset": "0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d",
    "extra": { "name": "USDC", "version": "2", "assetTransferMethod": "eip3009" }
  }]
}
```

To pay and retry, a client signs an EIP-3009 transfer authorisation for the
quoted amount and repeats the request with the payment header. There is no
on-chain approval transaction per call, and the facilitator pays the INJ gas, so
the client spends only the USDC itself. The bundled client does the whole dance
for you:

```ts
import { createInjectiveClient } from "@injectivelabs/x402/client";

const client = createInjectiveClient({ privateKey: process.env.PRIVATE_KEY });
const res = await client.fetch("http://localhost:3000/v1/premium/stats");
const data = await res.json();
```

### settlementPolicy: after-success

The middleware runs with `settlementPolicy: "after-success"`, so a client is
charged **only when the endpoint actually returns 2xx**. Ask for a team that
does not exist and you get a 404 for free rather than paying 0.01 USDC for an
error. For an API that agents call automatically, without a human reading the
response, that distinction matters: a buggy agent cannot bleed money into
failed lookups.

## Networks

Testnet is the default so the API can be demonstrated without real funds.

| | Chain ID | CAIP-2 | USDC |
|---|---|---|---|
| Testnet (default) | 1439 | `eip155:1439` | `0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d` |
| Mainnet | 1776 | `eip155:1776` | `0xa00C59fF5a080D2b954d0c75e46E22a0c371235a` |

**Switching to mainnet is one line**, an environment variable:

```bash
X402_NETWORK=mainnet npm run dev
```

Nothing else in the codebase changes. Both networks use the native Circle USDC
contract with EIP-3009 support, so nothing needs deploying.

## Configuration

| Variable | Required | Purpose |
|---|---|---|
| `PRIVATE_KEY` | for settlement | Facilitator key. Needs INJ for gas. Without it the premium routes still return 402 with terms, they are never served free. |
| `X402_NETWORK` | no | `mainnet` to switch off testnet. Defaults to testnet. |
| `PORT` | no | Defaults to 3000. |
| `FOOTBALL_DATA_KEY` | for refresh | Free key from football-data.org, only used by the refresh path. |

Never commit a private key. `.env` is gitignored.

## Data

The dataset is built by `scripts/ingest.ts` in two modes:

```bash
npm run ingest            # offline, from the committed seed
npm run ingest:refresh    # merges football-data.org over the seed
```

Every match carries a `provenance` field. Seeded records are marked `verified`
and were cross checked by hand against at least two public sources. Records
pulled from the upstream API are marked `imported`. **On conflict the seed
wins**, and the disagreement is printed rather than silently resolved, so a bad
upstream record cannot quietly corrupt a verified result.

Verified knockout results in the seed:

| Stage | Result |
|---|---|
| Round of 16 | England 3-2 Mexico, France 1-0 Paraguay, Norway 2-0 Brazil |
| Quarter final | Spain 2-1 Belgium, England 2-1 Norway |
| Semi final | Spain 2-0 France, Argentina 2-1 England (aet) |
| Third place | England 6-4 France |
| Final | **Spain 1-0 Argentina** (aet), Ferran Torres 106', MetLife Stadium |

Spain's second world title after 2010. The seed currently covers the knockout
phase; the group stage is populated by the refresh path.

## MCP server, agent access

An MCP server exposes Golazo to any MCP capable agent (Claude Desktop, Claude
Code, Cursor). It has seven tools:

- Free: `tournament_summary`, `list_teams`, `search_matches`
- Premium: `match_analytics`, `head_to_head`, `team_breakdown`, `tournament_stats`

When a premium tool is called and a wallet is configured, the server settles the
x402 micropayment automatically through `createInjectiveClient`: it receives the
402, signs an EIP-3009 authorisation, and retries, all with no human in the
loop. That is the whole point, an agent buying data on its own.

If no wallet is configured, premium tools do not error. They return a plain
message explaining that the query is premium and how to enable payment. If a
wallet is set but underfunded, they say exactly that and how to fix it.

### Run it

```bash
npm run mcp   # talks MCP over stdio
```

The MCP server calls the HTTP API, so run the API too (`npm run dev`), or point
it at a deployed instance with `GOLAZO_API_URL`.

### Connect from Claude Desktop or Claude Code

Add this to your MCP config (`claude_desktop_config.json` for Claude Desktop, or
`.mcp.json` in a project for Claude Code):

```json
{
  "mcpServers": {
    "golazo": {
      "command": "npm",
      "args": ["run", "mcp"],
      "cwd": "/absolute/path/to/golazo",
      "env": {
        "GOLAZO_API_URL": "http://localhost:3000",
        "GOLAZO_WALLET_KEY": "0xYOUR_INJECTIVE_EVM_KEY"
      }
    }
  }
}
```

`GOLAZO_WALLET_KEY` is optional. Without it the free tools work and premium
tools explain how to enable payment. With it, funded with a little testnet USDC,
premium tools pay and return data automatically. Never commit this key.

## Roadmap

An agent skill ships alongside the MCP server (`skill/`), teaching an agent what
data exists, which queries are free, which cost 0.01 USDC, and how to read the
results.

## Licence

MIT.
