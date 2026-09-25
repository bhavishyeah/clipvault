// @vitest-environment node
//
// Feature: volt-reach, Batch 9 — best-effort server-side rate limiter.
//
// The share endpoints delegate burst-control to the pure fixed-window counter
// in api/lib/rateLimit.js. These tests pin that contract deterministically by
// injecting `now` (and small windows): under-limit hits are allowed, the hit
// past the limit is blocked with a sensible Retry-After, and once the window
// elapses the key is allowed again. Also covers the IP-derivation helper.

import { describe, it, expect, beforeEach } from 'vitest'
import { rateLimit, clientIp, _resetRateLimits } from './rateLimit.js'

beforeEach(() => {
  _resetRateLimits()
})

describe('rateLimit', () => {
  it('allows hits up to the limit within a window', () => {
    const opts = { limit: 3, windowMs: 1000, now: 0 }
    expect(rateLimit('k', opts).allowed).toBe(true)
    expect(rateLimit('k', opts).allowed).toBe(true)
    const third = rateLimit('k', opts)
    expect(third.allowed).toBe(true)
    expect(third.remaining).toBe(0)
  })

  it('blocks the hit that exceeds the limit and reports Retry-After', () => {
    const opts = { limit: 2, windowMs: 1000, now: 0 }
    rateLimit('k', opts)
    rateLimit('k', opts)
    // Third hit within the same window (now still 0) exceeds limit=2.
    const blocked = rateLimit('k', { limit: 2, windowMs: 1000, now: 100 })
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSec).toBeGreaterThanOrEqual(1)
    expect(blocked.remaining).toBe(0)
  })

  it('allows again after the window resets', () => {
    const opts = { limit: 1, windowMs: 1000, now: 0 }
    expect(rateLimit('k', opts).allowed).toBe(true)
    // Same window → blocked.
    expect(rateLimit('k', { limit: 1, windowMs: 1000, now: 500 }).allowed).toBe(false)
    // After the window boundary → a fresh window opens, allowed again.
    expect(rateLimit('k', { limit: 1, windowMs: 1000, now: 1000 }).allowed).toBe(true)
  })

  it('tracks each key independently', () => {
    const opts = { limit: 1, windowMs: 1000, now: 0 }
    expect(rateLimit('a', opts).allowed).toBe(true)
    expect(rateLimit('b', opts).allowed).toBe(true)
    expect(rateLimit('a', { limit: 1, windowMs: 1000, now: 1 }).allowed).toBe(false)
  })

  it('fails open when the key is missing or empty', () => {
    expect(rateLimit('', { limit: 1, windowMs: 1000, now: 0 }).allowed).toBe(true)
    expect(rateLimit(undefined, { limit: 1, windowMs: 1000, now: 0 }).allowed).toBe(true)
  })
})

describe('clientIp', () => {
  it('uses the first x-forwarded-for hop', () => {
    expect(clientIp({ headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' } })).toBe('203.0.113.7')
  })

  it('falls back to the socket remote address', () => {
    expect(clientIp({ headers: {}, socket: { remoteAddress: '198.51.100.2' } })).toBe('198.51.100.2')
  })

  it('returns unknown when nothing is available', () => {
    expect(clientIp({ headers: {} })).toBe('unknown')
    expect(clientIp({})).toBe('unknown')
  })
})
