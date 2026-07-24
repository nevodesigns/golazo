# Settled payment: an agent buying data on-chain

This is a real, completed x402 micropayment on Injective testnet. An AI agent
called an MCP tool, the API answered HTTP 402 with payment terms, the agent
signed an EIP-3009 authorisation, the payment settled on-chain, and the agent
received the data. No human in the loop.

Network: Injective EVM testnet (chain 1439). Token: native Circle USDC
`0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d`. Price: 0.01 USDC per call.

The settlement is confirmed via `eth_getLogs` rather than
`eth_getTransactionReceipt`, because Injective testnet does not serve receipts
for these transactions. That finding, with evidence, is in
[testnet-rpc-notes.md](testnet-rpc-notes.md). The payment itself is identical to
the reference flow and fully on-chain.

---

## The transcript

### Step 1: agent balance before

```
agent 0x050F35c2fF49f5A0F35794E72BCE5B53dc0A6af5
balance: 19.95 USDC
```

### Step 2: the 402 challenge

The agent requests a premium endpoint. The paywall answers with the x402 v2
payment terms.

```
HTTP 402 Payment Required
{
  "x402Version": 2,
  "error": "PAYMENT-SIGNATURE header is required",
  "resource": {
    "url": "http://localhost:3000/v1/premium/team/ESP",
    "description": "Full performance breakdown for one team",
    "mimeType": "application/json"
  },
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:1439",
      "amount": "10000",
      "payTo": "0xaC37161144343bc4ea9f0E33356B2D8f76bf2BA8",
      "maxTimeoutSeconds": 60,
      "asset": "0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d",
      "extra": { "name": "USDC", "version": "2", "assetTransferMethod": "eip3009" }
    }
  ]
}
```

### Step 3: the agent pays and gets the data

The agent calls the MCP tool. Behind the tool, the x402 client signs an EIP-3009
transfer authorisation and retries with the payment header. The facilitator
submits the transfer and confirms it. The tool returns the real data.

```
tool call: team_breakdown { team: "ESP" }
returned cleanly (isError=false):
{
  "team": "ESP",
  "name": "Spain",
  "played": 8,
  "won": 7,
  "drawn": 1,
  "lost": 0,
  "goalsFor": 14,
  "goalsAgainst": 1,
  "goalDifference": 13,
  "cleanSheets": 7,
  "biggestWin": "4-0 v KSA (group)",
  "stagesReached": ["group","round_of_32","round_of_16","quarter_final","semi_final","final"]
}
```

Facilitator side, for the same request:

```
submitted transferWithAuthorization: 0x7e9893225d21e9acfe072b7a545bd37675ec6d2147a973ad254c40a298f31b5d
confirmed via eth_getLogs: block 134482421 after 2 poll(s)
```

### Step 4: on-chain settlement proof

```
settlement tx:   0x7e9893225d21e9acfe072b7a545bd37675ec6d2147a973ad254c40a298f31b5d
block:           134482421
amount:          0.01 USDC  (agent -> facilitator)
explorer:        https://testnet.blockscout.injective.network/tx/0x7e9893225d21e9acfe072b7a545bd37675ec6d2147a973ad254c40a298f31b5d

agent balance after: 19.94 USDC  (was 19.95, spent 0.01)
```

The balance dropped by exactly the quoted price. The agent paid for what it got.

---

## Supporting evidence: earlier settled payments

These two settlements happened during development, against the reference
facilitator, before the getLogs confirmation path was added. They are real
on-chain USDC transfers and independent proof that the payment path works.

| Block | Amount | Transaction |
|---|---|---|
| 134479490 | 0.01 USDC | `0xf364a5ba3972adcf831d7df40a1ead9f7508b75875d7db0a49716f66313432fe` |
| 134479664 | 0.01 USDC | `0x116fbd12d3f2d51b334f67adb620f07b57ce6a2185e512d2c1a9d5b4afadeab0` |

---

## One honest note on the client

The x402 client shipped in the `0.1.0-rc.1` package throws an undici HTTP parser
error while reading the retried (paid) response on Node 24, even though the
payment settles and the server returns the data. undici hands the delivered body
back on the error, so the MCP layer recovers it (see `src/mcp/pay.ts`). The
payment is real and on-chain regardless. This is a client parsing quirk in an
early release, not a payment failure, and the on-chain settlement above is the
proof.
