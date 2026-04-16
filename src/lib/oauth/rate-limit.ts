// In-memory sliding-window rate limiter for OAuth endpoints.
//
// Per-edge-region memory (not shared across regions) — a determined
// attacker can round-robin across regions to multiply their budget.
// This is belt-and-braces; the real defence against flooding is
// configured in the Vercel Firewall dashboard (out of code scope).

export type RateLimiter = {
  check(key: string): boolean;
};

export function createRateLimiter(opts: {
  limit: number;
  windowMs: number;
}): RateLimiter {
  const hits = new Map<string, number[]>();

  return {
    check(key: string): boolean {
      const now = Date.now();
      const cutoff = now - opts.windowMs;
      const arr = (hits.get(key) ?? []).filter((t) => t > cutoff);
      if (arr.length >= opts.limit) {
        hits.set(key, arr);
        return false;
      }
      arr.push(now);
      hits.set(key, arr);
      return true;
    },
  };
}

// Shared limiter for /api/oauth/* — 30 requests per minute per IP.
export const oauthRateLimiter = createRateLimiter({
  limit: 30,
  windowMs: 60_000,
});
