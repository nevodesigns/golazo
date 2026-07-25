/**
 * Minimal fixed-window rate limiter, no external dependency.
 *
 * Keeps a per-client counter in a bounded in-memory map. Each client gets
 * `max` requests per `windowMs`; the (max + 1)th within the window gets a 429
 * with a Retry-After header. Counters reset when the window rolls over.
 *
 * Defaults: 120 requests per 60s per client. Override with RATE_LIMIT_MAX and
 * RATE_LIMIT_WINDOW_MS. Set RATE_LIMIT_MAX=0 to disable (useful for tests).
 *
 * If the API is fronted by a reverse proxy (Cloudflare, nginx), set
 * `app.set("trust proxy", 1)` so req.ip is the real client and not the proxy,
 * otherwise every caller shares one bucket.
 */
import type { Request, Response, NextFunction } from "express";

interface Bucket {
  count: number;
  resetAt: number;
}

export function rateLimit(options?: { max?: number; windowMs?: number }) {
  const max = options?.max ?? Number(process.env.RATE_LIMIT_MAX ?? 120);
  const windowMs = options?.windowMs ?? Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
  // Hard cap on tracked clients so a flood of unique IPs cannot grow the map
  // without bound. Beyond this the oldest entries are dropped.
  const MAX_CLIENTS = 100_000;

  const buckets = new Map<string, Bucket>();

  // Periodic sweep of expired buckets, unref'd so it never holds the process up.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, b] of buckets) {
      if (now > b.resetAt) buckets.delete(key);
    }
  }, windowMs);
  if (typeof sweep.unref === "function") sweep.unref();

  return function rateLimiter(req: Request, res: Response, next: NextFunction) {
    if (max <= 0) return next(); // disabled

    const key = req.ip ?? req.socket.remoteAddress ?? "unknown";
    const now = Date.now();
    let b = buckets.get(key);

    if (!b || now > b.resetAt) {
      if (buckets.size >= MAX_CLIENTS) {
        // Drop the first (oldest-inserted) entry to stay bounded.
        const oldest = buckets.keys().next().value;
        if (oldest !== undefined) buckets.delete(oldest);
      }
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }

    b.count += 1;
    const remaining = Math.max(0, max - b.count);
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(remaining));

    if (b.count > max) {
      const retryAfter = Math.ceil((b.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({
        error: "rate_limited",
        message: `Too many requests. Try again in ${retryAfter}s.`,
      });
    }

    next();
  };
}
