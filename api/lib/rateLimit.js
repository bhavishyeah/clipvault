// VOLT — Best-effort server-side rate limiter (in-memory, no dependencies)
//
// A tiny fixed-window counter keyed by an arbitrary string (an authenticated
// user id, a client IP, etc.). Used by the share endpoints to blunt abusive
// bursts: excessive share creation and public-read scraping.
//
// LIMITATION — this is BEST EFFORT only. Vercel serverless functions run in
// ephemeral, per-instance isolates: each cold start gets a fresh module scope,
// and concurrent requests may be spread across several instances. So the
// counters here are per-instance and reset whenever an instance is recycled.
// That is intentionally acceptable — the goal is to soften obvious bursts, not
// to provide a strict, globally-consistent quota. A durable limit would need a
// shared store (Redis/Upstash/KV). Kept dependency-free and unit-testable by
// allowing the caller to inject `now` and `windowMs`.

// Module-scoped bucket store: key → { count, resetAt } (epoch ms).
const buckets = new Map()

/**
 * Record a hit for `key` and report whether it is within the allowed rate.
 *
 * Fixed-window semantics: the first hit for a key opens a window of `windowMs`
 * and permits up to `limit` hits within it; the window resets once `now`
 * passes `resetAt`. Purely counting — it does not sleep or throw.
 *
 * @param {string} key - the identity to rate-limit (user id, IP, token, ...)
 * @param {Object} [opts]
 * @param {number} [opts.limit=60]     - max hits allowed per window
 * @param {number} [opts.windowMs=60000] - window length in milliseconds
 * @param {number} [opts.now=Date.now()] - injectable clock for tests
 * @returns {{ allowed: boolean, retryAfterSec: number, remaining: number }}
 *   `allowed` is false once the window's count exceeds `limit`;
 *   `retryAfterSec` is the whole seconds until the window resets (0 when
 *   allowed); `remaining` is how many hits are still permitted this window.
 */
export function rateLimit(key, { limit = 60, windowMs = 60_000, now = Date.now() } = {}) {
  if (typeof key !== 'string' || !key) {
    // No usable key → fail open (never block on a missing identity).
    return { allowed: true, retryAfterSec: 0, remaining: limit }
  }

  const existing = buckets.get(key)
  if (!existing || now >= existing.resetAt) {
    // Open a fresh window.
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, retryAfterSec: 0, remaining: Math.max(0, limit - 1) }
  }

  existing.count += 1
  if (existing.count > limit) {
    const retryAfterSec = Math.max(1, Math.ceil((existing.resetAt - now) / 1000))
    return { allowed: false, retryAfterSec, remaining: 0 }
  }

  return { allowed: true, retryAfterSec: 0, remaining: Math.max(0, limit - existing.count) }
}

/**
 * Clear all rate-limit state. Intended for test isolation.
 * @returns {void}
 */
export function _resetRateLimits() {
  buckets.clear()
}

/**
 * Derive a best-effort client IP from a request for use as a rate-limit key.
 * Prefers the first hop of `x-forwarded-for` (set by Vercel's proxy), then the
 * raw socket address. Returns 'unknown' when nothing is available.
 *
 * @param {{ headers?: Object, socket?: { remoteAddress?: string } }} req
 * @returns {string}
 */
export function clientIp(req) {
  const xff = req?.headers?.['x-forwarded-for']
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim()
  }
  if (Array.isArray(xff) && xff.length) {
    return String(xff[0]).split(',')[0].trim()
  }
  return req?.socket?.remoteAddress || 'unknown'
}
