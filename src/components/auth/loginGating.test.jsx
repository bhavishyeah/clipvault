// @vitest-environment node
//
// VOLT — App vault-gate scenario tests (Feature 2: TOTP 2FA)
//
// Task 13.3 (part 1): assert the exact decisions App.jsx relies on when it
// chooses between rendering the Dashboard and holding the session at the
// MfaChallenge step. App computes `{ hasActiveFactor, currentLevel }` for the
// session and calls `canAccessVault(aal)`: when it returns false App renders
// MfaChallenge, when true it renders Dashboard.
//
// The universal properties of `canAccessVault` are covered by
// `src/lib/mfa.vaultGate.test.js` (Property 9). Here we pin the concrete
// App-gate scenarios explicitly so the gate contract can't silently drift.
//
// Requirements: 7.4, 7.6, 10.5

import { describe, it, expect } from 'vitest'
import { canAccessVault, AAL1, AAL2, RECOVERY_AAL2 } from '../../lib/mfa.js'

describe('App vault gate — scenarios App.jsx relies on', () => {
  it('holds a below-AAL2 session (active factor at aal1) at the challenge step (Req 7.4)', () => {
    // Account has an activated factor but the session is only aal1 → App must
    // render MfaChallenge, not the Dashboard.
    const gate = canAccessVault({ hasActiveFactor: true, currentLevel: AAL1 })
    expect(gate).toBe(false)
  })

  it('grants a no-factor session access to the vault (Req 7.6)', () => {
    // No MFA factor → email + password alone is sufficient; App renders the
    // Dashboard regardless of the reported level.
    const gate = canAccessVault({ hasActiveFactor: false, currentLevel: AAL1 })
    expect(gate).toBe(true)
  })

  it('grants a recovery-elevated session access to the vault (Req 10.5)', () => {
    // A valid recovery code marks the session recovery-aal2 at the app level,
    // which the gate treats the same as aal2 → App renders the Dashboard.
    const gate = canAccessVault({ hasActiveFactor: true, currentLevel: RECOVERY_AAL2 })
    expect(gate).toBe(true)
  })

  it('grants a session that has completed the TOTP challenge (active factor at aal2)', () => {
    // Sanity companion to the aal1 hold case: once the challenge elevates the
    // session to aal2, the same active-factor account is admitted.
    const gate = canAccessVault({ hasActiveFactor: true, currentLevel: AAL2 })
    expect(gate).toBe(true)
  })
})
