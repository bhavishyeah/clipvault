// VOLT — App-level recovery-code elevation marker
//
// Supabase MFA cannot mint AAL2 from an app-managed recovery code, so a valid
// recovery code records an app-level elevation for the current auth session.
// The marker is keyed to the JWT's stable session_id rather than the rotating
// access token, so a normal TOKEN_REFRESHED event does not destroy elevation
// or unmount Dashboard while Android's native file picker is open.

const KEY = 'volt.recovery-aal2'

function sessionKey(accessToken) {
  if (!accessToken) return null
  try {
    const payload = accessToken.split('.')[1]
    if (!payload) return accessToken
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const claims = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')))
    return claims?.session_id || accessToken
  } catch {
    // Preserve compatibility with opaque/test tokens.
    return accessToken
  }
}

export function markRecoveryElevated(accessToken) {
  const key = sessionKey(accessToken)
  if (!key) return
  try {
    sessionStorage.setItem(KEY, key)
  } catch {
    // Storage unavailable — elevation simply will not persist across renders.
  }
}

export function isRecoveryElevated(accessToken) {
  const key = sessionKey(accessToken)
  if (!key) return false
  try {
    return sessionStorage.getItem(KEY) === key
  } catch {
    return false
  }
}

export function clearRecoveryElevated() {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}
