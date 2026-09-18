// VOLT — App-level recovery-code elevation marker
//
// Supabase MFA can only reach AAL2 through `mfa.verify` against an enrolled
// TOTP factor; a recovery code cannot drive that API. Per design
// ("Recovery-code elevation tradeoff", approach 1) we keep an app-level marker
// for the session when a valid recovery code is accepted. `canAccessVault`
// treats this the same as `aal2`. The marker is scoped to the current session's
// access token so it does not leak across sign-ins, and lives in sessionStorage
// so it clears when the tab/browser session ends.
//
// This unlocks only the client vault gate; the true data boundary remains the
// per-row `user_id` RLS on user-owned tables, which is unaffected.

const KEY = 'volt.recovery-aal2'

/**
 * Mark the given session (identified by its access token) as recovery-elevated.
 * @param {string} accessToken - the current session's access token
 */
export function markRecoveryElevated(accessToken) {
  if (!accessToken) return
  try {
    sessionStorage.setItem(KEY, accessToken)
  } catch {
    // sessionStorage unavailable (private mode / SSR) — elevation simply
    // won't persist; the caller can still proceed in-memory this render.
  }
}

/**
 * Whether the given session has an app-level recovery elevation marker.
 * @param {string} accessToken - the current session's access token
 * @returns {boolean}
 */
export function isRecoveryElevated(accessToken) {
  if (!accessToken) return false
  try {
    return sessionStorage.getItem(KEY) === accessToken
  } catch {
    return false
  }
}

/** Clear any recovery elevation marker (e.g. on sign-out). */
export function clearRecoveryElevated() {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}
