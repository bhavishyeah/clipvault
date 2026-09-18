// VOLT — Pure MFA decision helpers
// No side effects, no Supabase calls. These functions decide *whether* to
// challenge, *whether* a TOTP code is well-formed, and *whether* a session
// may see the vault. The actual Auth_Service calls live in the useMfa hook.

/**
 * Assurance levels used by Supabase Auth MFA.
 * `aal1` = password only; `aal2` = a second factor has been verified.
 * `recovery-aal2` is an app-level marker: a valid recovery code was accepted
 * for the session (see design "Recovery-code elevation tradeoff"), which the
 * vault gate treats the same as `aal2`.
 */
export const AAL1 = 'aal1'
export const AAL2 = 'aal2'
export const RECOVERY_AAL2 = 'recovery-aal2'

// A TOTP_Code is exactly six numeric digits.
const TOTP_PATTERN = /^\d{6}$/

/**
 * Validate the shape of a TOTP code before issuing any verify call.
 * @param {string} code - the submitted code
 * @returns {boolean} true iff the code is exactly six numeric digits
 */
export function isValidTotpFormat(code) {
  return typeof code === 'string' && TOTP_PATTERN.test(code)
}

/**
 * Decide whether the user must complete a second-factor challenge.
 * @param {string} current - the session's current assurance level
 * @param {string} next - the assurance level the account requires
 * @returns {boolean} true iff the account requires aal2 but the session is at aal1
 */
export function needsMfaChallenge(current, next) {
  return next === AAL2 && current === AAL1
}

/**
 * Decide whether the current session may access the vault.
 *
 * - No active factor            -> always allowed (email + password alone)
 * - Active factor at aal2        -> allowed (TOTP challenge passed)
 * - Active factor, recovery-aal2 -> allowed (valid recovery code accepted)
 * - Otherwise                    -> denied (hold at the challenge step)
 *
 * @param {object} state
 * @param {boolean} state.hasActiveFactor - whether an MFA_Factor is activated
 * @param {string} state.currentLevel - the session's current assurance level
 * @returns {boolean} true iff the session is allowed to see the vault
 */
export function canAccessVault({ hasActiveFactor, currentLevel } = {}) {
  if (!hasActiveFactor) return true
  return currentLevel === AAL2 || currentLevel === RECOVERY_AAL2
}
