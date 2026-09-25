// @vitest-environment node
//
// Feature: volt-reach, Batch 3 — public share-link helpers.
//
// The share endpoints delegate all token generation, activity checks, expiry
// math, and the public projection to the pure helpers in api/lib/share.js.
// These tests pin that contract: tokens are high-entropy and URL-safe, the
// active/revoked/expired matrix is correct, the public projection leaks no
// internal columns, and expiry math honors the default and custom lifetimes.

import { describe, it, expect } from 'vitest'
import {
  generateToken,
  isShareActive,
  presentClip,
  computeExpiry,
  DEFAULT_EXPIRY_DAYS,
} from './share.js'

describe('generateToken', () => {
  it('produces a 32-char base64url token (URL-safe chars only, no padding)', () => {
    const token = generateToken()
    expect(token).toHaveLength(32)
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/) // base64url alphabet, no + / =
    expect(token).not.toContain('=')
  })

  it('encodes ~192 bits of entropy (24 random bytes)', () => {
    // base64url of 24 bytes decodes back to exactly 24 bytes.
    const token = generateToken()
    expect(Buffer.from(token, 'base64url')).toHaveLength(24)
  })

  it('is unique across many runs', () => {
    const seen = new Set()
    for (let i = 0; i < 1000; i++) seen.add(generateToken())
    expect(seen.size).toBe(1000)
  })
})

describe('isShareActive', () => {
  const NOW = new Date('2025-01-15T00:00:00.000Z')
  const FUTURE = new Date('2025-02-01T00:00:00.000Z').toISOString()
  const PAST = new Date('2025-01-01T00:00:00.000Z').toISOString()

  it('is active when not revoked and not yet expired', () => {
    expect(isShareActive({ revoked_at: null, expires_at: FUTURE }, NOW)).toBe(true)
  })

  it('is inactive when revoked (even if not expired)', () => {
    expect(
      isShareActive({ revoked_at: '2025-01-10T00:00:00.000Z', expires_at: FUTURE }, NOW),
    ).toBe(false)
  })

  it('is inactive when expired (even if not revoked)', () => {
    expect(isShareActive({ revoked_at: null, expires_at: PAST }, NOW)).toBe(false)
  })

  it('treats an expiry equal to now as inactive (strictly-after required)', () => {
    expect(isShareActive({ revoked_at: null, expires_at: NOW.toISOString() }, NOW)).toBe(false)
  })

  it('fails closed on a missing share or missing/invalid expiry', () => {
    expect(isShareActive(null, NOW)).toBe(false)
    expect(isShareActive({ revoked_at: null, expires_at: null }, NOW)).toBe(false)
    expect(isShareActive({ revoked_at: null, expires_at: 'not-a-date' }, NOW)).toBe(false)
  })
})

describe('presentClip', () => {
  const FULL_ROW = {
    id: 'clip-uuid',
    owner_id: 'owner-uuid',
    token: 'secret-token',
    metadata: { secure_url: 'x' },
    position: 3,
    type: 'link',
    content: 'https://example.com',
    file_url: 'https://res.cloudinary.com/x/cat.png',
    file_name: 'cat.png',
    mime_type: 'image/png',
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-02T00:00:00.000Z',
  }

  it('returns only the whitelisted presentable fields', () => {
    expect(presentClip(FULL_ROW)).toEqual({
      type: 'link',
      content: 'https://example.com',
      file_url: 'https://res.cloudinary.com/x/cat.png',
      file_name: 'cat.png',
      mime_type: 'image/png',
      created_at: '2025-01-01T00:00:00.000Z',
    })
  })

  it('leaks no owner id, token, or internal columns', () => {
    const out = presentClip(FULL_ROW)
    const keys = Object.keys(out)
    expect(keys).not.toContain('owner_id')
    expect(keys).not.toContain('token')
    expect(keys).not.toContain('id')
    expect(keys).not.toContain('metadata')
    expect(keys).not.toContain('position')
    expect(keys).not.toContain('updated_at')
    // Exhaustive: the projection has EXACTLY these six keys.
    expect(new Set(keys)).toEqual(
      new Set(['type', 'content', 'file_url', 'file_name', 'mime_type', 'created_at']),
    )
  })

  it('normalizes absent fields to null (never undefined)', () => {
    const out = presentClip({ type: 'text', content: 'hi' })
    expect(out).toEqual({
      type: 'text',
      content: 'hi',
      file_url: null,
      file_name: null,
      mime_type: null,
      created_at: null,
    })
  })
})

describe('computeExpiry', () => {
  const NOW = new Date('2025-01-15T00:00:00.000Z')
  const MS_PER_DAY = 24 * 60 * 60 * 1000

  it('defaults to 7 days when days is not provided', () => {
    const iso = computeExpiry(undefined, NOW)
    expect(iso).toBe(new Date(NOW.getTime() + DEFAULT_EXPIRY_DAYS * MS_PER_DAY).toISOString())
    expect(DEFAULT_EXPIRY_DAYS).toBe(7)
  })

  it('honors a custom number of days', () => {
    const iso = computeExpiry(30, NOW)
    expect(iso).toBe(new Date(NOW.getTime() + 30 * MS_PER_DAY).toISOString())
  })

  it('falls back to the default for non-positive or invalid days', () => {
    const expected = new Date(NOW.getTime() + DEFAULT_EXPIRY_DAYS * MS_PER_DAY).toISOString()
    expect(computeExpiry(0, NOW)).toBe(expected)
    expect(computeExpiry(-5, NOW)).toBe(expected)
    expect(computeExpiry(NaN, NOW)).toBe(expected)
  })

  it('returns an ISO-8601 timestamptz string', () => {
    expect(computeExpiry(7, NOW)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })
})
