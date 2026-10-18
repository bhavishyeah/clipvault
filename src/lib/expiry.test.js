// @vitest-environment node
//
// Feature: volt-vault-polish, A2 — auto-expiry presets and expiring-soon
//
// Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.7
//
// Unit tests for the pure expiry helpers in ./expiry.js:
//   - presetToExpiry: preset math (1h/1d/7d) and the 'none' / unknown cases
//   - formatCountdown: "in Nd"/"in Nh"/"in Nm" buckets, past, and absent input
//   - isExpiringSoon: threshold window with an exactly-at-threshold boundary,
//     plus past/absent handling
//   - SOON_THRESHOLD_MS: default 24h

import { describe, it, expect } from 'vitest'
import {
  presetToExpiry,
  formatCountdown,
  isExpiringSoon,
  SOON_THRESHOLD_MS,
} from './expiry.js'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

// A fixed reference "now" so every assertion is deterministic.
const NOW = new Date('2025-01-01T00:00:00.000Z')

describe('SOON_THRESHOLD_MS', () => {
  it('defaults to 24 hours', () => {
    expect(SOON_THRESHOLD_MS).toBe(24 * HOUR)
  })
})

describe('presetToExpiry', () => {
  it('adds 1 hour for the "1h" preset', () => {
    expect(presetToExpiry('1h', NOW)).toBe(new Date(NOW.getTime() + HOUR).toISOString())
  })

  it('adds 1 day for the "1d" preset', () => {
    expect(presetToExpiry('1d', NOW)).toBe(new Date(NOW.getTime() + DAY).toISOString())
  })

  it('adds 7 days for the "7d" preset', () => {
    expect(presetToExpiry('7d', NOW)).toBe(new Date(NOW.getTime() + 7 * DAY).toISOString())
  })

  it('returns null for the "none" preset', () => {
    expect(presetToExpiry('none', NOW)).toBeNull()
  })

  it('returns null for an unknown preset', () => {
    expect(presetToExpiry('42y', NOW)).toBeNull()
    expect(presetToExpiry(undefined, NOW)).toBeNull()
  })

  it('accepts an ISO string or epoch-millis "now"', () => {
    expect(presetToExpiry('1h', NOW.toISOString())).toBe(
      new Date(NOW.getTime() + HOUR).toISOString(),
    )
    expect(presetToExpiry('1h', NOW.getTime())).toBe(
      new Date(NOW.getTime() + HOUR).toISOString(),
    )
  })

  it('returns null when "now" is unparseable', () => {
    expect(presetToExpiry('1h', 'not-a-date')).toBeNull()
  })
})

describe('formatCountdown', () => {
  const at = (ms) => new Date(NOW.getTime() + ms).toISOString()

  it('formats multi-day remaining as "in Nd"', () => {
    expect(formatCountdown(at(2 * DAY), NOW)).toBe('in 2d')
    expect(formatCountdown(at(7 * DAY), NOW)).toBe('in 7d')
  })

  it('formats sub-day remaining as "in Nh"', () => {
    expect(formatCountdown(at(3 * HOUR), NOW)).toBe('in 3h')
    expect(formatCountdown(at(23 * HOUR), NOW)).toBe('in 23h')
  })

  it('formats sub-hour remaining as "in Nm"', () => {
    expect(formatCountdown(at(5 * MINUTE), NOW)).toBe('in 5m')
    expect(formatCountdown(at(59 * MINUTE), NOW)).toBe('in 59m')
  })

  it('formats sub-minute remaining as "in <1m"', () => {
    expect(formatCountdown(at(30 * 1000), NOW)).toBe('in <1m')
  })

  it('floors within a bucket (26h -> "in 1d", 90m -> "in 1h")', () => {
    expect(formatCountdown(at(26 * HOUR), NOW)).toBe('in 1d')
    expect(formatCountdown(at(90 * MINUTE), NOW)).toBe('in 1h')
  })

  it('uses the day bucket exactly at the 1-day boundary', () => {
    expect(formatCountdown(at(DAY), NOW)).toBe('in 1d')
  })

  it('returns "expired" at or before now', () => {
    expect(formatCountdown(at(0), NOW)).toBe('expired')
    expect(formatCountdown(at(-HOUR), NOW)).toBe('expired')
  })

  it('returns "" for absent input', () => {
    expect(formatCountdown(null, NOW)).toBe('')
    expect(formatCountdown(undefined, NOW)).toBe('')
  })

  it('returns "" for unparseable input', () => {
    expect(formatCountdown('not-a-date', NOW)).toBe('')
  })
})

describe('isExpiringSoon', () => {
  const at = (ms) => new Date(NOW.getTime() + ms).toISOString()

  it('is true for an expiry within the default 24h window', () => {
    expect(isExpiringSoon(at(3 * HOUR), NOW)).toBe(true)
    expect(isExpiringSoon(at(23 * HOUR), NOW)).toBe(true)
  })

  it('is true exactly at the threshold boundary (inclusive)', () => {
    expect(isExpiringSoon(at(SOON_THRESHOLD_MS), NOW)).toBe(true)
  })

  it('is false just beyond the threshold', () => {
    expect(isExpiringSoon(at(SOON_THRESHOLD_MS + 1), NOW)).toBe(false)
    expect(isExpiringSoon(at(2 * DAY), NOW)).toBe(false)
  })

  it('respects a custom threshold and its boundary', () => {
    expect(isExpiringSoon(at(HOUR), NOW, HOUR)).toBe(true)
    expect(isExpiringSoon(at(HOUR + 1), NOW, HOUR)).toBe(false)
  })

  it('is false for an already-expired or exactly-now expiry', () => {
    expect(isExpiringSoon(at(0), NOW)).toBe(false)
    expect(isExpiringSoon(at(-HOUR), NOW)).toBe(false)
  })

  it('is false for absent input', () => {
    expect(isExpiringSoon(null, NOW)).toBe(false)
    expect(isExpiringSoon(undefined, NOW)).toBe(false)
  })

  it('is false for unparseable input', () => {
    expect(isExpiringSoon('not-a-date', NOW)).toBe(false)
  })
})
