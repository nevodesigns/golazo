# A2A safe handling: processing files and data from other agents

Golazo is an agent-payable API. In an agent-to-agent (A2A) setting, another
agent or client can hand Golazo arbitrary input: a query string, a JSON body, an
uploaded file, a tool argument. All of it is untrusted. This is the procedure
for handling it without giving a caller a foothold on the host or the wallet.

The one rule everything else follows: **received content is data, never code,
never a path, never a command.**

## Before processing: check

1. **Size.** Reject oversized input before parsing. The API caps JSON bodies
   (Express `express.json()` default 100kb) and the rate limiter caps request
   volume. For any file ingest, set an explicit byte cap and stream-check it;
   never read an unbounded body into memory.
2. **Type and shape.** Validate against a strict schema, not a permissive one.
   The MCP tools already do this with `zod` (`stage` is an enum, ids are plain
   strings). Any new input path must reject unknown fields and wrong types up
   front, not coerce them.
3. **No control characters used as paths.** A caller-supplied value is never
   concatenated into a filesystem path, a URL host, a shell command, or a
   `require`/`import`. Golazo's data lookups are all in-memory `.find`/`.filter`
   over a fixed dataset for exactly this reason. MCP path parameters are wrapped
   in `encodeURIComponent` so a value like `../../etc/passwd` becomes an opaque
   segment, not a traversal. Keep it that way.
4. **Provenance.** Record who sent it (agent id, payment payer address if the
   call was paid) and when. A paid x402 call already carries the payer address
   in the settled payment; log it alongside the request.

## Where to store it

- If input must be persisted (it rarely should be for this API), write it to a
  dedicated quarantine directory outside the repo and outside any served or
  executed path: `~/.golazo/quarantine/` (mode 700), never `~/golazo/`,
  `~/golazo-site/`, or any directory `serve` publishes.
- Give each item a generated name (uuid), not the caller's filename. A caller
  filename like `../../.env` or `index.html` must never become the name on disk.
- Set files mode 600, directories 700. Nothing in quarantine is executable.
- Expire and delete. Quarantine is a buffer, not storage.

## What never to run

- **Never execute received content.** No `eval`, no `Function()`, no `vm`, no
  `child_process`/`exec`/`spawn` with caller data, no dynamic `import()` or
  `require()` of a received path, no `JSON.parse` feeding a `__proto__` merge.
- **Never let received content reach a secret.** The process holds
  `GOLAZO_WALLET_KEY` / `PRIVATE_KEY` in env. Received data must not be
  interpolated into anything that reads, logs, or transmits env values. Golazo
  never logs env values (verified); keep new code the same.
- **Never trust a caller-supplied network, asset, amount, or recipient.** In
  x402, payment terms come from the server config, and the signature is bound to
  the server's chain, asset, amount, and payTo. A caller cannot redirect payment
  by supplying a different network or address. Do not add a code path that reads
  those from the request.
- **Never auto-fetch a caller-supplied URL.** No SSRF surface exists today (the
  MCP `BASE` and facilitator RPC are fixed from env). Do not introduce a tool
  that fetches a URL a caller controls without an allowlist.

## If something looks malicious

1. Stop processing that request; return a generic 4xx (do not echo the payload
   back, which reflects an attack at the caller and leaks internals).
2. Preserve the raw input in quarantine with its provenance for review.
3. If it targeted the wallet or a secret, follow `INCIDENT-RESPONSE.md`.
