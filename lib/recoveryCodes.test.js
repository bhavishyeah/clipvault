// @vitest-environment node
//
// Feature: sharing-enhancements, Property 10: Recovery-code single-use and regeneration
//
// Validates: Requirements 8.1, 8.4, 8.5, 8.6
//
// Models the hash/compare/mark-used state machine that api/recovery-codes.js
// runs against the `recovery_codes` table, using the pure helpers from
// api/lib/recoveryCodes.js and an in-memory store of rows
// [{ code_hash, used_at }]. No Supabase, no network — the endpoint's persistence
// is stood in for by a plain array so the invariants can be exercised across
// many inputs.
//
// Invariants covered:
//   - generate yields exactly 10 fresh, distinct plaintext codes (Req 8.1).
//   - a code verifies successfully exactly once; after being marked used, the
//     same code no longer verifies while every other code stays valid (single-
//     use, Req 8.4).
//   - verifying an invalid or already-used code leaves the whole store
//     untouched (Req 8.5).
//   - regeneration produces 10 fresh distinct codes and invalidates all prior
//     codes — a previously valid code matches none of the new hashes (Req 8.6).

import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  CODE_COUNT,
  generateCodes,
  hashCode,
  matchesHash,
  normalizeCode,
} from './recoveryCodes.js'

// scryptSync at the production work factor (N=16384) is deliberately slow; a
// property run issues and compares thousands of hashes. The cost is read
// lazily per call, so lowering it here keeps the state-machine invariants
// identical while the run stays fast. Production reads the secure default.
process.env.RECOVERY_CODE_SCRYPT_COST = '2'

// Even at N=2, hashing 20 scrypt codes per run × 100 runs exceeds Vitest's
// default 5s per-test budget on some machines. Give the property tests a
// generous per-test timeout so they run to completion without flaking.
const PROP_TIMEOUT_MS = 30000

// Build the in-memory store the endpoint's `generate` action would create:
// one row per code, holding only its salted hash and an unused marker.
function issue(count = CODE_COUNT) {
  const codes = generateCodes(count)
  const store = codes.map((code) => ({ code_hash: hashCode(code), used_at: null }))
  return { codes, store }
}

// Mirror the endpoint's `verify` action against the in-memory store: find an
// unused row whose hash matches, mark exactly that row used, and report the
// outcome. On no match, the store is left untouched.
function verify(store, code) {
  const normalized = normalizeCode(code)
  if (!normalized) return { ok: false }
  const row = store.find((r) => r.used_at === null && matchesHash(normalized, r.code_hash))
  if (!row) return { ok: false }
  row.used_at = new Date().toISOString()
  return { ok: true }
}

// Deterministic index into a code set, derived from an arbitrary integer.
const indexArb = fc.integer({ min: 0, max: 10_000 })

describe('Property 10: Recovery-code single-use and regeneration', () => {
  it('issues exactly 10 fresh, distinct codes', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const { codes, store } = issue()
        expect(codes).toHaveLength(CODE_COUNT)
        expect(new Set(codes).size).toBe(CODE_COUNT)
        expect(store).toHaveLength(CODE_COUNT)
        // Every issued code verifies against its own stored hash.
        expect(codes.every((c) => store.some((r) => matchesHash(c, r.code_hash)))).toBe(true)
      }),
      { numRuns: 100 },
    )
  }, PROP_TIMEOUT_MS)

  it('a chosen code verifies exactly once and marks only that code used', () => {
    fc.assert(
      fc.property(indexArb, (pick) => {
        const { codes, store } = issue()
        const chosen = codes[pick % codes.length]

        // First verification succeeds.
        expect(verify(store, chosen).ok).toBe(true)
        // Second verification of the same code fails (single-use, Req 8.4).
        expect(verify(store, chosen).ok).toBe(false)

        // Exactly one row is now marked used.
        const usedCount = store.filter((r) => r.used_at !== null).length
        expect(usedCount).toBe(1)

        // Every other code still verifies exactly once (remaining codes valid).
        const others = codes.filter((c) => c !== chosen)
        for (const c of others) {
          expect(verify(store, c).ok).toBe(true)
        }
        // All 10 are now consumed; none verify again.
        expect(store.every((r) => r.used_at !== null)).toBe(true)
        expect(codes.every((c) => verify(store, c).ok === false)).toBe(true)
      }),
      { numRuns: 100 },
    )
  }, PROP_TIMEOUT_MS)

  it('verifying an invalid or already-used code leaves the store unchanged', () => {
    fc.assert(
      fc.property(indexArb, fc.string(), (pick, junk) => {
        const { codes, store } = issue()

        // Consume one code so we have an already-used code to re-submit.
        const used = codes[pick % codes.length]
        expect(verify(store, used).ok).toBe(true)

        const snapshot = store.map((r) => r.used_at)

        // Re-submitting the already-used code: no change.
        expect(verify(store, used).ok).toBe(false)
        // A code that isn't in the set (junk / never issued): no change.
        // Guard against the rare case where junk normalizes to a real code.
        if (!codes.some((c) => normalizeCode(c) === normalizeCode(junk))) {
          expect(verify(store, junk).ok).toBe(false)
        }

        // The used_at column is identical to the snapshot — nothing else moved.
        expect(store.map((r) => r.used_at)).toEqual(snapshot)
      }),
      { numRuns: 100 },
    )
  }, PROP_TIMEOUT_MS)

  it('regeneration yields 10 fresh distinct codes and invalidates all prior codes', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const first = issue()
        // Regenerate: the endpoint deletes prior rows and issues a new set.
        const second = issue()

        // 10 fresh, distinct codes.
        expect(second.codes).toHaveLength(CODE_COUNT)
        expect(new Set(second.codes).size).toBe(CODE_COUNT)

        // No old plaintext code matches any new hash (prior codes invalidated).
        for (const oldCode of first.codes) {
          expect(second.store.some((r) => matchesHash(oldCode, r.code_hash))).toBe(false)
          // And against the fresh store, an old code never verifies.
          expect(verify(second.store, oldCode).ok).toBe(false)
        }

        // The new codes are usable against the new store.
        expect(second.codes.every((c) => second.store.some((r) => matchesHash(c, r.code_hash)))).toBe(true)
      }),
      { numRuns: 100 },
    )
  }, PROP_TIMEOUT_MS)
})
