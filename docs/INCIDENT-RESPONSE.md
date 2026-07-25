# Incident response: leaked key or credential

This is the runbook for a suspected or confirmed leak of any Golazo secret: the
agent wallet key (`GOLAZO_WALLET_KEY`), the facilitator wallet key
(`PRIVATE_KEY`), the football-data API key (`FOOTBALL_DATA_KEY`), the Pxxl
credential, or a host SSH key. Work top to bottom. Move funds first, rotate
second, redeploy third.

Wallets referenced here:

- Agent wallet (payer, holds USDC): env `GOLAZO_WALLET_KEY`, address `0x050F35c2fF49f5A0F35794E72BCE5B53dc0A6af5`
- Facilitator wallet (submits transfers, holds INJ for gas): env `PRIVATE_KEY`, address `0xaC37161144343bc4ea9f0E33356B2D8f76bf2BA8`

Never paste a private key into a shell command, a commit, a chat, or this file.
Reference keys by env var name only.

## 0. Confirm and contain (first 5 minutes)

```bash
# Stop the running services so nothing keeps signing with the leaked key.
pkill -f "src/server.ts"        # API
pkill -f "src/facilitator/server.ts"  # facilitator
# If deployed elsewhere, stop that process/host too.
```

Decide which secret leaked. If in doubt, treat every secret in `.env` as leaked
and rotate all of them.

## 1. Move funds out of a compromised wallet

If a wallet key leaked, assume an attacker is already draining it. Sweep first.

```bash
cd ~/golazo
# Create a NEW wallet offline and record only its address here.
node -e "const {generatePrivateKey,privateKeyToAccount}=require('viem/accounts');const k=generatePrivateKey();console.error('NEW ADDRESS:',privateKeyToAccount(k).address);require('fs').writeFileSync(process.env.HOME+'/.golazo-new-key',k,{mode:0o600});console.error('key written to ~/.golazo-new-key (chmod 600)')"
```

Then transfer the USDC (agent wallet) and/or INJ (facilitator wallet) from the
compromised address to the new address. Use the network the leak affects
(testnet `eip155:1439`, mainnet `eip155:1776`). USDC is 6 decimals; INJ is the
native gas token. A minimal sweep script:

```bash
# Sweep USDC from the compromised agent wallet to the new address.
# OLD_KEY = the leaked GOLAZO_WALLET_KEY, NEW_ADDR = address printed above.
node --loader ts-node/esm -e '
import {createWalletClient,createPublicClient,http,encodeFunctionData} from "viem";
import {privateKeyToAccount} from "viem/accounts";
const rpc=process.env.INJ_RPC_URL||"https://k8s.testnet.json-rpc.injective.network/";
const chain={id:1439,name:"inj-test",nativeCurrency:{name:"INJ",symbol:"INJ",decimals:18},rpcUrls:{default:{http:[rpc]}}};
const usdc="0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d";
const acct=privateKeyToAccount(process.env.OLD_KEY);
const pub=createPublicClient({chain,transport:http(rpc)});
const w=createWalletClient({account:acct,chain,transport:http(rpc)});
const abi=[{name:"balanceOf",type:"function",stateMutability:"view",inputs:[{type:"address"}],outputs:[{type:"uint256"}]},{name:"transfer",type:"function",stateMutability:"nonpayable",inputs:[{type:"address"},{type:"uint256"}],outputs:[{type:"bool"}]}];
const bal=await pub.readContract({address:usdc,abi,functionName:"balanceOf",args:[acct.address]});
const data=encodeFunctionData({abi,functionName:"transfer",args:[process.env.NEW_ADDR,bal]});
const tx=await w.sendTransaction({to:usdc,data});
console.error("swept",bal.toString(),"USDC ->",process.env.NEW_ADDR,"tx",tx);
'
```

Note: the agent wallet holds no INJ (it never pays gas), so a USDC transfer from
it needs gas from elsewhere or a gasless path. If the agent wallet cannot pay
gas to move its own USDC, the practical containment is to rotate the key so no
new payments are signed, and accept that the residual USDC in the old wallet is
what an attacker could at most reach if they can fund gas. Keep balances low.

## 2. Rotate the leaked secret

### Wallet key

1. Put the new key from `~/.golazo-new-key` into `.env` under the right var
   (`GOLAZO_WALLET_KEY` or `PRIVATE_KEY`).
2. Shred the temp file: `shred -u ~/.golazo-new-key`.
3. Confirm perms: `chmod 600 ~/golazo/.env && stat -c %a ~/golazo/.env` (must be 600).
4. Re-fund the new wallet (testnet faucet / mainnet treasury), then verify:
   `npm run fund-agent` uses the funding path in `scripts/fund-agent.ts`.

### Football-data API key

1. Log in to https://www.football-data.org, revoke the old token, issue a new one.
2. Replace `FOOTBALL_DATA_KEY` in `.env`. It is only used by `scripts/ingest.ts`
   at ingest time, not by the running API, so no live traffic depends on it.

### Pxxl credential

1. Rotate at https://pxxl.app dashboard (revoke session / regenerate token).
2. Update `~/.config/pxxl/config.json` (already mode 600).

### Host SSH key

1. Remove the public key from every `authorized_keys` and from GitHub.
2. `ssh-keygen -t ed25519` a new pair, re-add the public half where needed.

## 3. Revoke external access

- GitHub: rotate any personal access token; review deploy keys on
  `nevodesigns/golazo` and `nevodesigns/golazo-site`; check the audit log.
- Injective explorer: watch the old addresses for unexpected outflows at
  https://testnet.blockscout.injective.network (or mainnet explorer).

## 4. Confirm the secret never entered git

```bash
cd ~/golazo
git log --all -p -- .env            # must return nothing (.env is gitignored)
git grep -nE "0x[0-9a-f]{64}" $(git rev-list --all) 2>/dev/null | grep -vi "tx" | head
# Any hit that is a private key (not a tx hash) means history rewrite + rotate.
```

If a key was ever committed: rotate it (already done above) and scrub history
with `git filter-repo --invert-paths --path .env`, then force-push and treat the
old key as permanently burned.

## 5. Rebuild and redeploy

```bash
cd ~/golazo
npm ci                              # clean, lockfile-exact install
npm run build
# start facilitator, then API
PRIVATE_KEY=$PRIVATE_KEY npm run facilitator &
GOLAZO_FACILITATOR_URL=http://localhost:3402 npm start &
curl -s localhost:3000/health       # confirm healthy
```

Static site (no secrets): redeploy from `~/golazo-site` only if code changed.

## 6. Post-incident

- Record: what leaked, when, blast radius, the rotation tx hashes.
- Keep wallet balances minimal (only what a demo needs) so a future leak caps
  the loss.
- Re-run the security pass (fuzz, x402 bypass, replay) before calling it closed.

## 7. Applied hardening (security pass, 2026-07-25)

Record of the changes made during the audit, so future you knows the current
state and why it is wired the way it is. Each was proven with a before/after
positive control.

- **Agent .env permissions.** `~/golazo/.env` (holds both wallet keys) was mode
  664 (world-readable) and is now 600. Keep it 600 on every host.
- **onchainos config permissions.** `~/.onchainos/session.json` and
  `wallets.json` were 664 and are now 600. They hold identity metadata and an
  encrypted session key (no plaintext private keys; `keyring.enc` was already
  600). Re-tighten if the onchainos tooling ever resets them.
- **Facilitator bind.** The facilitator now binds `127.0.0.1` by default
  (`FACILITATOR_HOST` to override). It holds the gas wallet and does no auth, so
  it must never listen on a public interface. The API reaches it on localhost.
- **API rate limit.** The API applies a per-client limiter (default 120 req/60s,
  `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS`). Set `app.set("trust proxy", 1)` if
  the API is ever fronted by a proxy, so it keys on the real client IP.
- **Site: deploy config no longer served.** The site is served from
  `~/golazo-site/public/` (`serve public`), so `pxxl.toml`, `package.json`,
  `README.md`, and `serve.json` return 404 instead of 200. Web assets live in
  `public/`; build/deploy config stays in the repo root.
- **Site security headers (the header limitation was NOT real).** The earlier
  assumption that pxxl.run cannot serve custom headers is wrong. pxxl runs
  `serve`, `serve` honors `serve.json`, and Cloudflare passes the headers
  through. The site now sends `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, and `Referrer-Policy: no-referrer-when-downgrade`,
  configured in `~/golazo-site/serve.json` (kept in the repo root and loaded with
  `serve public -c ../serve.json` so the config file itself is not served).
  Not yet set, and safe to add the same way if wanted: `Content-Security-Policy`
  (test against the video and fonts first) and `Strict-Transport-Security`
  (a long-lived commitment, so decide deliberately).
