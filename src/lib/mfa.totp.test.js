// @vitest-environment node
//
// Feature: sharing-enhancements, Property 7: TOTP format validation gate
//
// Validates: Requirements 6.4
//
// isValidTotpFormat(code) must return true iff `code` is a string of exactly
// six numeric digits (matching ^\d{6}$). Property 7 has two halves:
//   (a) Format decision — for any input, isValidTotpFormat is true iff the
//       value is a six-ASCII-digit string. Everything else (wrong length,
//       non-digit characters, whitespace, unicode digits, non-strings) is
//       false.
//   (b) Verify gate — a small caller shim only issues a verify call when
//       isValidTotpFormat returns true. Whenever the format is invalid, the
//       (mocked) verify function is never invoked.

import { describe, it, expect, vi } from 'vitest'
import fc from 'fast-check'
import { isValidTotpFormat } from './mfa.js'

const RUNS = 100

// Small caller shim: mirrors the real ordering (validate first, only verify
// when the gate passes). Returns the gate result so callers can assert on both
// the decision and the mock's invocation.
function maybeVerify(code, verifyFn) {
  const ok = isValidTotpFormat(code)
  if (ok) verifyFn(code)
  return ok
}

// Independent reference for "exactly six ASCII digits". Uses a fresh regex so
// the test does not simply mirror the implementation's shared literal.
function isSixAsciiDigits(value) {
  return typeof value === 'string' && /^[0-9]{6}$/.test(value)
}

// Generator spanning the full input space: valid six-digit codes, digit
// strings of other lengths, codes with stray characters/whitespace, unicode
// "digits" that are not ASCII, and non-string values.
const codeArb = fc.oneof(
  // Exactly six ASCII digits (the accept region).
  fc
    .array(fc.integer({ min: 0, max: 9 }), { minLength: 6, maxLength: 6 })
    .map((ds) => ds.join('')),
  // Digit strings of arbitrary (often non-six) length.
  fc
    .array(fc.integer({ min: 0, max: 9 }), { minLength: 0, maxLength: 12 })
    .map((ds) => ds.join('')),
  // Six-character strings that may include non-digits.
  fc.string({ minLength: 6, maxLength: 6 }),
  // Arbitrary strings, including whitespace and symbols.
  fc.string(),
  // Codes padded with whitespace (must be rejected — pattern is anchored).
  fc
    .array(fc.integer({ min: 0, max: 9 }), { minLength: 6, maxLength: 6 })
    .map((ds) => ` ${ds.join('')} `),
  // Non-ASCII "digit" (Arabic-Indic) — a full-length but non-\d string.
  fc.constant('٦٦٦٦٦٦'),
  // Non-string values.
  fc.constantFrom(undefined, null, 123456, ['1', '2'], {}, true),
)

describe('Property 7: TOTP format validation gate', () => {
  it('returns true iff the code is exactly six ASCII digits', () => {
    fc.assert(
      fc.property(codeArb, (code) => {
        expect(isValidTotpFormat(code)).toBe(isSixAsciiDigits(code))
      }),
      { numRuns: RUNS },
    )
  })

  it('never issues a verify call when the format is invalid', () => {
    fc.assert(
      fc.property(codeArb, (code) => {
        const verify = vi.fn()

        const ok = maybeVerify(code, verify)

        if (ok) {
          expect(verify).toHaveBeenCalledTimes(1)
          expect(verify).toHaveBeenCalledWith(code)
        } else {
          // Core gate guarantee: no verify call on an invalid TOTP shape.
          expect(verify).not.toHaveBeenCalled()
        }
      }),
      { numRuns: RUNS },
    )
  })

  it('accepts canonical six-digit codes across the full digit range', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 999999 }), (n) => {
        const code = String(n).padStart(6, '0')
        expect(isValidTotpFormat(code)).toBe(true)
      }),
      { numRuns: RUNS },
    )
  })

  it('rejects digit strings whose length is not six', () => {
    fc.assert(
      fc.property(
        fc
          .integer({ min: 0, max: 12 })
          .filter((len) => len !== 6),
        (len) => {
          const code = '7'.repeat(len)
          expect(isValidTotpFormat(code)).toBe(false)
        },
      ),
      { numRuns: RUNS },
    )
  })
})
