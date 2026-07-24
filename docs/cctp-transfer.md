# Funding the agent across chains with CCTP V2

The Golazo agent pays for premium data in USDC on Injective. When it runs low it
should be able to refuel on its own rather than wait for a human to move funds.
[scripts/fund-agent.ts](../scripts/fund-agent.ts) does that with Circle's
Cross-Chain Transfer Protocol V2: it burns native USDC on Avalanche Fuji and
mints native USDC to the agent on Injective. No wrapped token, no bridge
liquidity pool, no third-party custody. Same dollar, moved natively.

## The flow

```
Avalanche Fuji (domain 1)                     Injective (domain 29)
------------------------------                -----------------------------
1. approve  USDC -> TokenMessengerV2
2. depositForBurn  (burn, standard)  ─────┐
                                          │
3. Circle Iris attests the burn  <────────┘
                                          │
                                          └──────►  4. receiveMessage (mint to agent)
```

1. **approve** the TokenMessengerV2 to spend the agent's USDC on Fuji.
2. **depositForBurn** burns the USDC on Fuji, addressed to the agent on
   Injective. Standard transfer: `maxFee = 0`, `minFinalityThreshold = 2000`,
   `destinationCaller = bytes32(0)` so any wallet may relay the mint.
3. **attestation**: poll Circle's Iris sandbox until the burn is attested,
   `GET https://iris-api-sandbox.circle.com/v2/messages/1?transactionHash=<burnTx>`,
   until `messages[0].status == "complete"`.
4. **receiveMessage** delivers the message and attestation to the
   MessageTransmitterV2 on Injective, which mints the USDC to the agent.

## Two Injective-specific adaptations

Both are deliberate and both come straight from things this project already
learned:

- **The mint is confirmed with `eth_getLogs`, not `eth_getTransactionReceipt`.**
  Injective testnet does not serve receipts (see
  [testnet-rpc-notes.md](testnet-rpc-notes.md)), so the script watches for the
  USDC `Transfer` log of the mint transaction instead. The same finding that
  shaped the x402 facilitator shapes this.
- **The mint is relayed by the facilitator wallet, which holds INJ for gas.**
  The agent can be completely out of INJ and still get funded: because
  `destinationCaller` is `bytes32(0)`, any wallet may submit `receiveMessage`,
  and the USDC still mints to the agent (`mintRecipient`). The facilitator pays
  the Injective gas; the agent receives the dollars.

## Verified on-chain

CCTP V2 is genuinely deployed and reachable on both chains. Contract code is
present at every address the script uses (checked with `eth_getCode`):

| Chain | Contract | Address | Code present |
|---|---|---|---|
| Avalanche Fuji | TokenMessengerV2 | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` | yes |
| Avalanche Fuji | USDC | `0x5425890298aed601595a70AB815c96711a31Bc65` | yes |
| Injective | MessageTransmitterV2 | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` | yes |
| Injective | TokenMinterV2 | `0xb43db544E2c27092c107639Ad201b3dEfAbcF192` | yes |
| Injective | USDC | `0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d` | yes |

These addresses, the domains (Fuji 1, Injective 29), and the standard-transfer
parameters were cross-checked against Circle's official sample app
(`circlefin/circle-cctp-crosschain-transfer`), which lists Injective testnet in
its chain config at domain 29.

## Status: built and verified, live run pending Fuji faucet

The script is complete and typechecks, and it runs correctly through preflight.
The one thing standing between it and a completed transfer is testnet funds on
the source chain: the agent holds its 19.94 USDC on Injective, but nothing on
Avalanche Fuji, and CCTP burns on the source. The script detects this and stops
with exact instructions rather than sending a doomed transaction:

```
Golazo CCTP funding: Avalanche Fuji -> Injective
  agent (burns, receives): 0x050F35c2fF49f5A0F35794E72BCE5B53dc0A6af5
  relayer (mints on Injective): 0xaC37161144343bc4ea9f0E33356B2D8f76bf2BA8
  amount: 0.5 USDC

[+1.1s] Fuji USDC:      0
[+1.1s] Fuji AVAX gas:  0
[+1.1s] Injective USDC (before): 19.94

Cannot start the burn: the agent wallet is not funded on Avalanche Fuji.
Fund it, then run again:
  - USDC:  https://faucet.circle.com  (select Avalanche Fuji, address 0x050F35c2fF49f5A0F35794E72BCE5B53dc0A6af5)
  - AVAX:  https://faucet.avax.network  (Fuji C-Chain, address 0x050F35c2fF49f5A0F35794E72BCE5B53dc0A6af5)
```

To complete a live transfer, fund the agent wallet on Fuji with a little testnet
USDC (Circle faucet) and a little AVAX for gas (Avalanche faucet), then:

```bash
GOLAZO_WALLET_KEY=0x<agent> PRIVATE_KEY=0x<facilitator> npm run fund-agent -- 0.5
```

The burn and mint transaction hashes go here once the live run completes:

```
burn tx (Avalanche Fuji):  <pending funding>
mint tx (Injective):       <pending funding>
```

This is documented honestly as built and verified up to the burn, blocked only
on an external testnet faucet, not on the code or the protocol.
