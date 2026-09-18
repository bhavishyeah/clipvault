// @vitest-environment node
//
// Feature: sharing-enhancements, Property 9: Vault access gate
//
// Validates: Requirements 7.4, 7.6, 9.6, 10.5
//
// canAccessVault({ hasActiveFactor, currentLevel }) returns true IFF the user
// has no active factor, OR has an active factor and the current assurance level
// is 'aal2' (or the equivalent valid recovery elevation 'recovery-aal2').
// Everything else (active factor at 'aal1' or any junk level) is denied.

import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { canAccessVault, AAL1, AAL2, RECOVERY_AAL2 } from './mfa.js'

// The set of levels the gate may see: the three known levels plus arbitrary
// junk so we exercise the "otherwise -> denied" branch.
const KNOWN_LEVELS = [AAL1, AAL2, RECOVERY_AAL2]
const JUNK_LEVELS = ['', 'aal0', 'AAL2', 'aal3', 'recovery', 'unknown', undefined, null]

// Reference oracle expressed directly from the acceptance criteria.
const oracle = (hasActiveFactor, currentLevel) =>
  !hasActiveFactor ||
  currentLevel === AAL2 ||
  currentLevel === RECOVERY_AAL2

describe('Property 9: Vault access gate', () => {
  it('matches the acceptance-criteria oracle for any session state', () => {
    const levelArb = fc.oneof(
      fc.constantFrom(...KNOWN_LEVELS),
      fc.constantFrom(...JUNK_LEVELS),
      fc.string(),
    )

    fc.assert(
      fc.property(fc.boolean(), levelArb, (hasActiveFactor, currentLevel) => {
        expect(canAccessVault({ hasActiveFactor, currentLevel })).toBe(
          oracle(hasActiveFactor, currentLevel),
        )
      }),
      { numRuns: 300 },
    )
  })

  it('always grants access when there is no active factor (Req 7.6, 9.6)', () => {
    const anyLevel = fc.oneof(
      fc.constantFrom(...KNOWN_LEVELS),
      fc.constantFrom(...JUNK_LEVELS),
      fc.string(),
    )

    fc.assert(
      fc.property(anyLevel, (currentLevel) => {
        // No factor => email + password alone is sufficient, regardless of level.
        expect(canAccessVault({ hasActiveFactor: false, currentLevel })).toBe(true)
      }),
      { numRuns: 200 },
    )
  })

  it('with an active factor, grants only at aal2 or recovery-aal2 (Req 7.4, 10.5)', () => {
    const elevated = fc.constantFrom(AAL2, RECOVERY_AAL2)

    fc.assert(
      fc.property(elevated, (currentLevel) => {
        expect(canAccessVault({ hasActiveFactor: true, currentLevel })).toBe(true)
      }),
      { numRuns: 100 },
    )
  })

  it('with an active factor, denies at aal1 or any junk level (Req 7.4)', () => {
    // Any level that is neither aal2 nor recovery-aal2 must be denied when a
    // factor is active — this is the "hold at the challenge step" branch.
    const nonElevated = fc
      .oneof(fc.constantFrom(AAL1, ...JUNK_LEVELS), fc.string())
      .filter((lvl) => lvl !== AAL2 && lvl !== RECOVERY_AAL2)

    fc.assert(
      fc.property(nonElevated, (currentLevel) => {
        expect(canAccessVault({ hasActiveFactor: true, currentLevel })).toBe(false)
      }),
      { numRuns: 200 },
    )
  })
})
