// @vitest-environment node
//
// Feature: sharing-enhancements, Property 8: MFA challenge decision
//
// Validates: Requirements 7.2
//
// needsMfaChallenge(current, next) must return true iff the account requires
// aal2 (next === 'aal2') while the session is still at aal1 (current ===
// 'aal1'). Every other pairing of assurance levels — including unknown/junk
// values — must return false. The property is checked across the full input
// space of level pairs drawn from the valid levels plus junk values.

import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { needsMfaChallenge, AAL1, AAL2 } from './mfa.js'

// A level generator spanning the real assurance levels plus junk values so the
// property covers both the single true case and the many false cases.
const level = fc.oneof(
  fc.constant(AAL1), // 'aal1'
  fc.constant(AAL2), // 'aal2'
  fc.constant('recovery-aal2'),
  fc.constant(''),
  fc.constant(undefined),
  fc.constant(null),
  fc.constant('aal3'),
  fc.constant('AAL2'), // wrong case — must NOT match
  fc.string(),
  fc.integer(),
)

describe('Property 8: MFA challenge decision', () => {
  it('returns true iff next is aal2 and current is aal1', () => {
    fc.assert(
      fc.property(level, level, (current, next) => {
        const expected = next === AAL2 && current === AAL1
        expect(needsMfaChallenge(current, next)).toBe(expected)
      }),
      { numRuns: 500 },
    )
  })

  it('challenges exactly the aal1 -> aal2 elevation', () => {
    expect(needsMfaChallenge(AAL1, AAL2)).toBe(true)
  })

  it('does not challenge when the session is already at aal2', () => {
    fc.assert(
      fc.property(level, (next) => {
        // current already aal2: no challenge regardless of the required level.
        expect(needsMfaChallenge(AAL2, next)).toBe(false)
      }),
      { numRuns: 100 },
    )
  })

  it('does not challenge when the required level is not aal2', () => {
    const nonAal2 = level.filter((v) => v !== AAL2)
    fc.assert(
      fc.property(level, nonAal2, (current, next) => {
        // If the account does not require aal2, there is never a challenge.
        expect(needsMfaChallenge(current, next)).toBe(false)
      }),
      { numRuns: 200 },
    )
  })
})
