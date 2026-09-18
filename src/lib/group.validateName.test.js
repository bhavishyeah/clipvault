// @vitest-environment node
//
// Feature: sharing-enhancements, Property 11: Group-name validation
//
// Validates: Requirements 11.1, 11.2
//
// validateGroupName(name) accepts a group name iff, after trimming leading and
// trailing whitespace, its length is within [1, 100] inclusive. When a name is
// rejected, no Group or Group_Member record must be created. The "no record
// created" half is exercised through a small createGroup-like caller shim that
// only invokes its (mocked) insert when validateGroupName reports ok.

import { describe, it, expect, vi } from 'vitest'
import fc from 'fast-check'
import { validateGroupName, NAME_MIN, NAME_MAX } from './group.js'

// Oracle: the canonical spec definition of validity, independent of the
// implementation under test.
const trimmedLen = (name) => (typeof name === 'string' ? name.trim().length : 0)
const shouldAccept = (name) => {
  const len = trimmedLen(name)
  return len >= NAME_MIN && len <= NAME_MAX
}

// Caller shim mirroring the createGroup gate: it only calls `insert` (which
// stands in for the group + membership write) when validateGroupName is ok.
// Returns whether a write was attempted so callers can assert the effect.
function createGroupShim(name, insert) {
  const result = validateGroupName(name)
  if (!result.ok) {
    return { created: false, reason: result.reason }
  }
  insert({ name: name.trim() })
  return { created: true }
}

// Generators spanning the interesting input space.

// Empty / whitespace-only names — always rejected.
const emptyOrWhitespace = fc.string({
  unit: fc.constantFrom(' ', '\t', '\n', '\r', '\f', '\v'),
  minLength: 0,
  maxLength: 20,
})

// A name whose trimmed length is exactly `len`, optionally wrapped in
// surrounding whitespace so trimming is genuinely exercised.
const nameWithTrimmedLength = (len) =>
  fc
    .tuple(
      // Non-whitespace core of the requested length. Use printable ASCII that
      // is not whitespace so `.trim()` cannot shrink the core itself.
      fc.string({
        unit: fc.integer({ min: 33, max: 126 }).map((c) => String.fromCharCode(c)),
        minLength: len,
        maxLength: len,
      }),
      fc.string({ unit: fc.constantFrom(' ', '\t', '\n'), maxLength: 8 }),
      fc.string({ unit: fc.constantFrom(' ', '\t', '\n'), maxLength: 8 }),
    )
    .map(([core, lead, trail]) => `${lead}${core}${trail}`)

describe('Property 11: Group-name validation', () => {
  it('accepts iff trimmed length is in [1, 100] for arbitrary strings', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (name) => {
        const result = validateGroupName(name)
        expect(result.ok).toBe(shouldAccept(name))
      }),
      { numRuns: 500 },
    )
  })

  it('accepts iff trimmed length is in [1, 100], including surrounding whitespace', () => {
    // trimmed length swept across 0..110 to cover both sides of both bounds.
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 110 }), (len) => {
        const gen = len === 0 ? emptyOrWhitespace : nameWithTrimmedLength(len)
        return fc.assert(
          fc.property(gen, (name) => {
            const result = validateGroupName(name)
            expect(result.ok).toBe(shouldAccept(name))
          }),
          { numRuns: 10 },
        )
      }),
      { numRuns: 120 },
    )
  })

  it('rejects empty and whitespace-only names', () => {
    fc.assert(
      fc.property(emptyOrWhitespace, (name) => {
        const result = validateGroupName(name)
        expect(result.ok).toBe(false)
        expect(result.reason).toBe('empty')
      }),
      { numRuns: 200 },
    )
  })

  it('honors the boundary lengths 1, 100 (accept) and 101 (reject)', () => {
    fc.assert(
      fc.property(nameWithTrimmedLength(NAME_MIN), (name) => {
        expect(validateGroupName(name).ok).toBe(true)
      }),
      { numRuns: 100 },
    )
    fc.assert(
      fc.property(nameWithTrimmedLength(NAME_MAX), (name) => {
        expect(validateGroupName(name).ok).toBe(true)
      }),
      { numRuns: 100 },
    )
    fc.assert(
      fc.property(nameWithTrimmedLength(NAME_MAX + 1), (name) => {
        const result = validateGroupName(name)
        expect(result.ok).toBe(false)
        expect(result.reason).toBe('too_long')
      }),
      { numRuns: 100 },
    )
  })

  it('creates no group/membership record when the name is rejected (Req 11.2)', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          emptyOrWhitespace,
          nameWithTrimmedLength(NAME_MAX + 1),
          // trimmed length far beyond the max
          nameWithTrimmedLength(150),
        ),
        (name) => {
          // Precondition: only exercise names the oracle deems invalid.
          fc.pre(!shouldAccept(name))
          const insert = vi.fn()
          const outcome = createGroupShim(name, insert)
          expect(outcome.created).toBe(false)
          // No group or membership write attempted on rejection.
          expect(insert).not.toHaveBeenCalled()
        },
      ),
      { numRuns: 300 },
    )
  })

  it('creates exactly one record when the name is accepted (Req 11.1)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: NAME_MIN, max: NAME_MAX }).chain((len) => nameWithTrimmedLength(len)),
        (name) => {
          fc.pre(shouldAccept(name))
          const insert = vi.fn()
          const outcome = createGroupShim(name, insert)
          expect(outcome.created).toBe(true)
          expect(insert).toHaveBeenCalledTimes(1)
        },
      ),
      { numRuns: 300 },
    )
  })
})
