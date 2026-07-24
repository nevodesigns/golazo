# Golazo

**An agent payable World Cup 2026 data API.** Free endpoints serve the whole
tournament archive. Premium endpoints are gated behind real x402 micropayments
in USDC on Injective, at 0.01 USDC per call, and an AI agent pays for them by
itself with no human in the loop.

> **This is not a mock.** A real agent called a tool, the API answered HTTP 402,
> the agent signed and paid on-chain, and it got the data back. The settled
> transaction is
> [`0x7e9893…f31b5d`](https://testnet.blockscout.injective.network/tx/0x7e9893225d21e9acfe072b7a545bd37675ec6d2147a973ad254c40a298f31b5d),
> and the full transcript is in **[docs/settled-payment.md](docs/settled-payment.md)**.

## The problem, and what Golazo does

The 2026 World Cup finished on 19 July 2026: 48 teams, 12 groups, 104 matches,
Spain beating Argentina 1-0 after extra time. That result is a fixed historical
record, but nobody had made it *agent accessible* behind a real payment rail. An
AI agent that wants verified tournament data has no way to just buy the one
answer it needs.

Golazo is that service. It exposes the tournament as an HTTP API and as
[MCP](https://modelcontextprotocol.io) tools. The basic archive is free. The
derived analytics (per match breakdowns, head to head records, team performance,
full tournament stats) cost 0.01 USDC per call, charged over
[x402](https://x402.org) on Injective. An agent hits a premium tool, receives a
402, signs an EIP-3009 authorisation, the payment settles on Injective, and the
agent receives the data. It happens automatically, in one tool call.

### How you interact with it

- **As a person:** run the API and curl the free endpoints, or point an MCP
  client at it and ask questions in natural language.
- **As an agent (the point):** install the MCP server and the Agent Skill. Free
  questions are answered directly; premium questions trigger an automatic 0.01
  USDC payment and return the data. You configure one wallet key and never touch
  the payment flow again.

## How each Injective technology is used

| Technology | Where it lives | What it does here |
|---|---|---|
| **x402** | [src/server.ts](src/server.ts) | The paywall. `injectivePaymentMiddleware` gates every premium route, quotes 0.01 USDC in a 402, and settles the EIP-3009 payment. Charged `after-success`, so an error costs the caller nothing. |
| **MCP Server** | [src/mcp/server.ts](src/mcp/server.ts), [src/mcp/pay.ts](src/mcp/pay.ts) | Agent access. Seven tools over stdio. Premium tools auto-pay through `createInjectiveClient`: receive 402, sign, retry, return data, no human in the loop. |
| **Agent Skill** | [skill/SKILL.md](skill/SKILL.md) | The installable skill (Anthropic skill standard) that teaches an agent what data exists, which queries are free vs 0.01 USDC, and how to read the results. |
| **CCTP** | [scripts/fund-agent.ts](scripts/fund-agent.ts) | Funding. Bridges native USDC from Avalanche Fuji to the agent's Injective wallet via Circle CCTP V2 (Injective is domain 29), so the agent can refuel itself to keep paying. See [docs/cctp-transfer.md](docs/cctp-transfer.md). |
| **Custom facilitator** | [src/facilitator/server.ts](src/facilitator/server.ts) | Settlement confirmation. Confirms via `eth_getLogs` because Injective testnet does not serve receipts. This is what made the settled payment above actually complete. See [docs/testnet-rpc-notes.md](docs/testnet-rpc-notes.md). |

## Quickstart

Everything below is testnet, no real funds required, and the free API needs no
key and no network access at all.

### 1. Install and build the dataset

```bash
npm install
npm run ingest        # builds the complete dataset offline from the committed seed
```

`npm run ingest` produces all 104 matches, 48 teams, and 12 groups from the
committed seed. No API key needed.

### 2. Run the free API

```bash
npm run dev           # http://localhost:3000
curl localhost:3000/v1/tournament
curl "localhost:3000/v1/matches?stage=final"
```

That is a complete, working, free API. To take payments as well, add the
facilitator.

### 3. Run the paid path (facilitator + API)

The facilitator submits the on-chain transfer and confirms it. It needs a wallet
funded with a little testnet INJ for gas. In one terminal:

```bash
PRIVATE_KEY=0xYOUR_FACILITATOR_KEY npm run facilitator   # listens on :3402
```

In another, run the API pointed at it:

```bash
PRIVATE_KEY=0xYOUR_FACILITATOR_KEY \
GOLAZO_FACILITATOR_URL=http://localhost:3402 \
npm run dev
```

Now every premium route settles a real x402 payment on Injective testnet.

### 4. Connect the MCP server

```bash
npm run mcp           # talks MCP over stdio; calls the HTTP API above
```

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
        "GOLAZO_WALLET_KEY": "0xYOUR_AGENT_EVM_KEY"
      }
    }
  }
}
```

`GOLAZO_WALLET_KEY` is the **agent's** wallet, funded with a little testnet
USDC. Without it, the free tools work and premium tools explain how to enable
payment; with it, premium tools pay and return data automatically. Never commit
this key. Then install the skill in [skill/](skill/) so the agent knows what to
ask.

## Endpoints

### Free

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Service and dataset status, x402 configuration |
| GET | `/v1/tournament` | Tournament summary and metadata |
| GET | `/v1/teams` | All 48 teams, each tagged with its group |
| GET | `/v1/matches` | Matches, filterable with `?stage=` and `?team=` |

### Premium, 0.01 USDC per call

| Method | Path | Description |
|---|---|---|
| GET | `/v1/premium/match/:id` | Detailed analytics for one match |
| GET | `/v1/premium/h2h/:teamA/:teamB` | Head to head record between two teams |
| GET | `/v1/premium/team/:id` | Full performance breakdown for one team |
| GET | `/v1/premium/stats` | Complete tournament statistics export |

### MCP tools

- Free: `tournament_summary`, `list_teams`, `search_matches`
- Premium: `match_analytics`, `head_to_head`, `team_breakdown`, `tournament_stats`

## How payment works

An unpaid request to a premium endpoint returns HTTP 402 with the payment terms:

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

The client signs an EIP-3009 `transferWithAuthorization` for the quoted amount
and repeats the request with the payment header. There is **no per-call on-chain
approval**, and the facilitator pays the INJ gas, so the client spends only the
0.01 USDC itself. The bundled client does the whole dance:

```ts
import { createInjectiveClient } from "@injectivelabs/x402/client";

const client = createInjectiveClient({ privateKey: process.env.GOLAZO_WALLET_KEY });
const res = await client.fetch("http://localhost:3000/v1/premium/stats");
const data = await res.json();
```

### settlementPolicy: after-success

The middleware runs `settlementPolicy: "after-success"`, so a client is charged
**only when the endpoint returns 2xx**. Ask for a team that does not exist and
you get a 404 for free rather than paying for an error. For an API agents call
automatically, without a human reading the response, that matters: a buggy agent
cannot bleed money into failed lookups.

## The settled payment, and the RPC finding behind it

The completed end-to-end payment is documented, with the balance before and
after, the 402 challenge, the clean data returned, and the on-chain proof, in
**[docs/settled-payment.md](docs/settled-payment.md)**.

Getting there surfaced a finding worth its own writeup. On Injective EVM testnet,
a transaction can change state and emit logs while `eth_getTransactionReceipt`
and `eth_getTransactionByHash` return **null for that same transaction**, tested
across four RPC endpoints. The reference x402 facilitator confirms via the
receipt endpoint, so it times out on a payment that actually succeeded. The fix
was a small **custom facilitator** ([src/facilitator/server.ts](src/facilitator/server.ts))
that submits the identical transfer and confirms it with `eth_getLogs`, which the
testnet does serve. The full evidence is in
**[docs/testnet-rpc-notes.md](docs/testnet-rpc-notes.md)**. It is documented for
other Injective builders regardless of this hackathon.

## Funding the agent across chains (CCTP)

An agent that pays for data will eventually run low. Rather than wait for a
human, it can refuel itself with Circle's Cross-Chain Transfer Protocol V2:
[scripts/fund-agent.ts](scripts/fund-agent.ts) burns native USDC on Avalanche
Fuji and mints native USDC to the agent on Injective (domain 29). Same dollar,
moved natively, no wrapped token or bridge pool.

```bash
GOLAZO_WALLET_KEY=0x<agent> PRIVATE_KEY=0x<facilitator> npm run fund-agent -- 0.5
```

It reuses the two lessons this project already learned about Injective: the mint
is confirmed via `eth_getLogs` (not receipts), and it is relayed by the
facilitator wallet so the agent can be funded even with zero INJ of its own.

The implementation is complete and the CCTP V2 contracts are confirmed deployed
on both chains via `eth_getCode`, cross-checked against Circle's official sample
app. The live run is currently blocked not by the code but by faucet policy: the
Avalanche AVAX gas faucet requires a coupon or a mainnet balance, so the source
wallet cannot be funded to sign the burn. The script halts cleanly at preflight,
and the moment funds exist one command runs the full burn, attest, and mint and
prints both transaction hashes. Full detail, including the on-chain verification,
is in [docs/cctp-transfer.md](docs/cctp-transfer.md).

## Honest notes

Being straight about early-software rough edges is better than implying a
stability that does not exist yet.

- **x402 is a release candidate.** The dependency is
  `@injectivelabs/x402@0.1.0-rc.1`. Only two versions have been published
  (`0.0.1` and this one), and the referenced source repo `InjectiveLabs/x402`
  currently returns 404, so there is no public code to audit. The library works
  and the paywall is genuinely enforced by it, but treat it as early software.
- **A client parser quirk.** The rc client throws an undici HTTP parser error
  while reading the *retried, paid* response on Node 24, even though the payment
  settles on-chain and the server returns the data. undici hands the delivered
  body back on the error, so the MCP layer recovers it (see
  [src/mcp/pay.ts](src/mcp/pay.ts)). The payment is real and on-chain regardless.
- **Receipts on testnet.** See the RPC finding above; it is why a custom
  facilitator exists.

## Networks

Testnet is the default so the API can be demonstrated without real funds.

| | Chain ID | CAIP-2 | USDC |
|---|---|---|---|
| Testnet (default) | 1439 | `eip155:1439` | `0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d` |
| Mainnet | 1776 | `eip155:1776` | `0xa00C59fF5a080D2b954d0c75e46E22a0c371235a` |

**Switching to mainnet is one environment variable:**

```bash
X402_NETWORK=mainnet npm run dev
```

Both networks use the native Circle USDC contract with EIP-3009 support, so
nothing needs deploying. On mainnet the receipt endpoint works, so the reference
facilitator confirms normally and the custom one is optional.

## Configuration

| Variable | Required | Purpose |
|---|---|---|
| `GOLAZO_WALLET_KEY` | for the agent to pay | The agent's wallet key, used by the MCP server to sign payments. Needs a little USDC. |
| `PRIVATE_KEY` | for settlement | The facilitator wallet. Submits the transfer, needs INJ for gas. Without it, premium routes still return 402 with terms, never served free. |
| `GOLAZO_FACILITATOR_URL` | for the custom facilitator | Point the API at the getLogs-confirming facilitator, e.g. `http://localhost:3402`. |
| `GOLAZO_API_URL` | no | Where the MCP server finds the API. Defaults to `http://localhost:3000`. |
| `X402_NETWORK` | no | `mainnet` to switch off testnet. Defaults to testnet. |
| `PORT` | no | API port. Defaults to 3000. |
| `FOOTBALL_DATA_KEY` | for refresh | Free key from football-data.org, only used by the refresh path. |

Never commit a private key. `.env` is gitignored.

## Data

The dataset is built by [scripts/ingest.ts](scripts/ingest.ts) in two modes:

```bash
npm run ingest            # offline, from the committed seed (complete: 104 matches)
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
| Round of 16 | England 3-2 Mexico, France 1-0 Paraguay, Norway 2-1 Brazil |
| Quarter final | Spain 2-1 Belgium, England 2-1 Norway |
| Semi final | Spain 2-0 France, Argentina 2-1 England (aet) |
| Third place | England 6-4 France |
| Final | **Spain 1-0 Argentina** (aet), Ferran Torres 106', MetLife Stadium |

Spain's second world title after 2010.

## Licence

MIT.
