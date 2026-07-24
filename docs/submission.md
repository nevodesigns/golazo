# Golazo submission pack

Everything to paste into the Typeform, plus a ready-to-post X draft. Copy the
fields straight across.

---

## Project name

**Golazo**

## Short description (one line)

An agent-payable FIFA World Cup 2026 data API on Injective: a free tournament
archive, plus premium analytics an AI agent buys for itself in USDC over x402, no
human in the loop.

## Longer description

Golazo turns the finished 2026 World Cup into a service an AI agent can actually
pay for. The tournament ended on 19 July 2026 (48 teams, 12 groups, 104 matches,
Spain beating Argentina 1-0 after extra time), and that record is a permanent
archive, but nobody had made it agent-payable behind a real payment rail.

Golazo exposes the tournament as an HTTP API and as MCP tools. The basic archive
is free. The derived analytics (per-match breakdowns, head-to-head records, team
performance, full tournament stats) cost 0.01 USDC per call, charged over x402 on
Injective. An agent hits a premium tool, receives an HTTP 402, signs an EIP-3009
authorisation, the payment settles on Injective, and the agent gets the data.
One tool call, no human in the loop.

This is not a mock. A real agent settled a real payment on-chain: it received a
402, signed EIP-3009, paid 0.01 USDC, and got the data back. The settlement
transaction is
`0x7e9893225d21e9acfe072b7a545bd37675ec6d2147a973ad254c40a298f31b5d`
(https://testnet.blockscout.injective.network/tx/0x7e9893225d21e9acfe072b7a545bd37675ec6d2147a973ad254c40a298f31b5d),
and the full transcript is in docs/settled-payment.md.

Getting there surfaced a finding worth documenting for other Injective builders:
on Injective EVM testnet, a transaction can change state and emit logs while
`eth_getTransactionReceipt` and `eth_getTransactionByHash` return null for that
same transaction, tested across four RPC endpoints. The reference x402
facilitator confirms via the receipt endpoint, so it times out on a payment that
actually succeeded. Golazo ships a small custom facilitator that submits the
identical transfer and confirms it with `eth_getLogs`, which the testnet does
serve. The evidence is in docs/testnet-rpc-notes.md.

Golazo is honest about its rough edges: the x402 dependency is a release
candidate, and its client throws an undici parser error while reading the paid
response on Node 24 even though the payment settles on-chain, which the code
recovers cleanly. Both are documented in the README rather than hidden.

## The four Injective technologies used

- **x402** is the paywall. `injectivePaymentMiddleware` gates every premium
  route, quotes 0.01 USDC in an HTTP 402, and settles the EIP-3009 payment.
  Charged only after a 2xx, so an error costs the caller nothing.
- **MCP Server** is the agent interface. Seven tools over stdio; the premium
  tools auto-pay through `createInjectiveClient` (receive 402, sign, retry,
  return data) with no human in the loop.
- **Agent Skills** ship the installable skill (`skill/SKILL.md`, Anthropic skill
  standard) that teaches an agent what data exists, which queries are free versus
  0.01 USDC, and how to read the results.
- **CCTP** lets the agent refuel itself: `scripts/fund-agent.ts` bridges native
  USDC from Avalanche Fuji to the agent's Injective wallet via Circle CCTP V2
  (Injective is domain 29). Implemented in full and verified on-chain; the live
  run is blocked only by an external AVAX gas-faucet policy, documented honestly
  in docs/cctp-transfer.md.

## Links

- **GitHub:** https://github.com/nevodesigns/golazo
- **Demo video:** `demo/golazo-demo.mp4` in the repo (1920x1080, ~103s). Hosted
  link to add after upload: `<paste YouTube or X video link here>`
- **Settled payment proof:** docs/settled-payment.md, tx
  `0x7e9893225d21e9acfe072b7a545bd37675ec6d2147a973ad254c40a298f31b5d`,
  https://testnet.blockscout.injective.network/tx/0x7e9893225d21e9acfe072b7a545bd37675ec6d2147a973ad254c40a298f31b5d
- **Testnet RPC finding:** docs/testnet-rpc-notes.md
- **CCTP funding flow:** docs/cctp-transfer.md

---

## Draft X post

### As a two-post thread (recommended, fits the full hash)

**Post 1**

```
Meet Golazo: an agent-payable FIFA World Cup 2026 data API on @injective.

A free archive, plus premium analytics an AI agent buys for itself, 0.01 USDC
per call, no human in the loop.

Four Injective techs: x402, MCP Server, Agent Skills, CCTP.

#InjectiveGlobalCupHackathon
```

**Post 2**

```
Not a mock. Real on-chain settlement: the agent got a 402, signed EIP-3009, and
paid USDC on Injective.

tx 0x7e9893225d21e9acfe072b7a545bd37675ec6d2147a973ad254c40a298f31b5d

Repo + demo: github.com/nevodesigns/golazo

cc @NinjaLabsHQ @NinjaLabsCN
```

### As a single post (uses a shortened hash to fit)

```
Golazo: an agent-payable World Cup 2026 data API on @injective.

An AI agent gets a 402, signs EIP-3009, pays 0.01 USDC on-chain, gets the data.
No human.

x402 + MCP Server + Agent Skills + CCTP.
tx 0x7e9893...f31b5d
github.com/nevodesigns/golazo

@NinjaLabsHQ @NinjaLabsCN #InjectiveGlobalCupHackathon
```
