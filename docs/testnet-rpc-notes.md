# Injective testnet EVM: logs work, receipts do not

A finding worth documenting for anyone building on Injective EVM testnet, x402
or otherwise.

## The finding

On Injective EVM testnet (chain 1439), a transaction can change state and emit
logs while `eth_getTransactionReceipt` and `eth_getTransactionByHash` return
null for that same transaction. The transfer happens, `eth_getLogs` sees it, the
token balance changes, but the receipt and by-hash lookups do not serve it.

This matters because most tooling confirms a transaction by polling
`eth_getTransactionReceipt`. On this testnet that polling never resolves, so the
tooling reports a timeout or failure for a transaction that actually succeeded.

## Evidence

Take a real settlement transaction that moved 0.01 USDC:

```
tx 0x116fbd12d3f2d51b334f67adb620f07b57ce6a2185e512d2c1a9d5b4afadeab0
```

Queried against the RPC:

```
eth_getLogs sees the transfer:            YES  (block 134479664, with tx hash and value)
eth_getTransactionByHash for same tx:     NULL
eth_getTransactionReceipt for same tx:    NULL
```

The USDC balance of the payer dropped by exactly 0.01 across these transfers, so
the state change is real. Only the receipt and by-hash endpoints fail to serve
it.

We tested four endpoints:

| RPC | eth_chainId | receipt for a confirmed tx |
|---|---|---|
| `https://k8s.testnet.json-rpc.injective.network` | 0x59f (1439) | null |
| `https://testnet.sentry.chain.json-rpc.injective.network` | 0x59f (1439) | null |
| `https://injective-testnet-evm-rpc.publicnode.com` | HTTP 404 | not available |
| `https://injective-testnet.drpc.org` | HTTP 400 | not available |

The two endpoints that respond both fail the same way. A fresh transaction from
the latest block also has no retrievable receipt, so this is not lag on one old
transaction; it is the endpoint.

## Why it is not just latency

The transactions above are minutes old and still return null from the receipt
and by-hash endpoints, while `eth_getLogs` returns them immediately with block
numbers. Polling longer does not help.

## What we did about it

x402 settlement in the reference `@injectivelabs/x402` facilitator confirms via
`eth_getTransactionReceipt`, so it times out on this testnet even though the
payment lands. We wrote a small custom facilitator
(`src/facilitator/server.ts`) that submits the identical
`transferWithAuthorization` transaction and confirms it with `eth_getLogs`,
which this testnet does serve. The payment is byte for byte the same and fully
on-chain; only the confirmation method changed. The middleware points at this
facilitator through its supported `facilitatorUrl` option.

See [settled-payment.md](settled-payment.md) for the completed end-to-end
payment this enabled.

## For mainnet

On Injective mainnet, where the receipt endpoint works, the reference
facilitator is expected to confirm normally and this workaround is not needed.
The getLogs path remains a valid, arguably more robust confirmation method, so
it is fine to keep either way.
