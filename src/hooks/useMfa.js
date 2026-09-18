import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { toast } from '../components/ui/toastStore'
import { trackEvent } from '../lib/analytics'
import { isValidTotpFormat } from '../lib/mfa'

// VOLT — MFA hook (Feature 2: TOTP 2FA)
//
// Wraps Supabase Auth MFA (enroll / challenge / verify / unenroll / listFactors)
// and the app-managed recovery-code endpoint (`api/recovery-codes`). Pure
// decision logic (whether a code is well-formed, whether to challenge, whether
// the vault is reachable) lives in `src/lib/mfa.js`; this hook only performs the
// side-effecting Auth_Service and endpoint calls and holds the factor state.
//
// All verify/challenge calls are gated behind `isValidTotpFormat` so a
// malformed code never reaches Supabase (Req 6.4, 7.5).

const RECOVERY_ENDPOINT = '/api/recovery-codes'

// Grab the current session's access token for authenticating api/ calls.
async function getAccessToken() {
  const { data } = await supabase.auth.getSession()
  return data?.session?.access_token ?? null
}

// POST an action to the recovery-codes endpoint with the caller's Bearer token.
async function callRecoveryEndpoint(action, body = {}) {
  const token = await getAccessToken()
  if (!token) {
    return { ok: false, error: 'Session expired' }
  }

  try {
    const res = await fetch(RECOVERY_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ action, ...body }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { ok: false, error: data.error || 'Request failed' }
    }
    return { ok: true, ...data }
  } catch (err) {
    return { ok: false, error: err.message || 'Network error' }
  }
}

export function useMfa(user) {
  const [factors, setFactors] = useState([])
  const [loading, setLoading] = useState(true)

  // Any TOTP factor with status 'verified' means 2FA is active (Req 6.6).
  const hasActiveFactor = factors.some((f) => f.status === 'verified')

  // --- Reload the account's factors ---
  const refresh = useCallback(async () => {
    if (!user) {
      setFactors([])
      setLoading(false)
      return
    }

    const { data, error } = await supabase.auth.mfa.listFactors()

    if (error) {
      console.error('Could not load MFA factors:', error.message)
      setFactors([])
    } else {
      // listFactors returns { all, totp }. Prefer `all` when present.
      setFactors(data?.all ?? data?.totp ?? [])
    }
    setLoading(false)
  }, [user])

  // Load factors on mount / when the user changes. The async body defers any
  // setState off the synchronous effect body (avoids cascading renders).
  useEffect(() => {
    let cancelled = false

    const load = async () => {
      if (!user) {
        if (!cancelled) {
          setFactors([])
          setLoading(false)
        }
        return
      }

      const { data, error } = await supabase.auth.mfa.listFactors()
      if (cancelled) return

      if (error) {
        console.error('Could not load MFA factors:', error.message)
        setFactors([])
      } else {
        setFactors(data?.all ?? data?.totp ?? [])
      }
      setLoading(false)
    }

    load()

    return () => {
      cancelled = true
    }
  }, [user])

  // --- Begin enrollment: returns QR + secret to display (Req 6.1, 6.2) ---
  const enroll = useCallback(async () => {
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' })

    if (error) {
      toast('Could not start 2FA setup', 'error')
      console.error('MFA enroll failed:', error.message)
      return { error: error.message }
    }

    return {
      factorId: data.id,
      qr: data.totp?.qr_code,
      secret: data.totp?.secret,
    }
  }, [])

  // --- Activate a pending factor, then mint recovery codes (Req 6.3, 8.1) ---
  const activate = useCallback(async (factorId, code) => {
    if (!isValidTotpFormat(code)) {
      return { error: 'Enter the 6-digit code from your authenticator app' }
    }

    const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId })
    if (chErr) {
      toast('Could not verify code', 'error')
      console.error('MFA challenge failed:', chErr.message)
      return { error: chErr.message }
    }

    const { error: vErr } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: ch.id,
      code,
    })
    if (vErr) {
      toast('Invalid code — try again', 'error')
      return { error: vErr.message }
    }

    await refresh()
    trackEvent('mfa_enroll')

    // Factor is verified — issue the one-time recovery codes.
    const result = await callRecoveryEndpoint('generate')
    if (!result.ok) {
      // 2FA is active even if code generation hiccups; surface a soft warning.
      toast('2FA enabled, but recovery codes could not be created', 'error')
      return { recoveryCodes: [], recoveryError: result.error }
    }

    toast('Two-factor authentication enabled')
    return { recoveryCodes: result.codes ?? [] }
  }, [refresh])

  // --- Login-time challenge: verify a TOTP to elevate to AAL2 (Req 7.3) ---
  const challenge = useCallback(async (factorId, code) => {
    if (!isValidTotpFormat(code)) {
      return { error: 'Enter the 6-digit code from your authenticator app' }
    }

    const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId })
    if (chErr) {
      console.error('MFA challenge failed:', chErr.message)
      return { error: chErr.message }
    }

    const { error: vErr } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: ch.id,
      code,
    })
    if (vErr) {
      return { error: vErr.message }
    }

    trackEvent('mfa_challenge')
    return { success: true }
  }, [])

  // --- Disable a factor (Req 9.3) ---
  const unenroll = useCallback(async (factorId) => {
    const { error } = await supabase.auth.mfa.unenroll({ factorId })

    if (error) {
      // Factor is retained on failure (Req 9.5).
      toast('Unenrollment did not complete', 'error')
      console.error('MFA unenroll failed:', error.message)
      return { error: error.message }
    }

    await refresh()
    trackEvent('mfa_disable')
    return { success: true }
  }, [refresh])

  // --- Regenerate the 10 recovery codes, invalidating prior ones (Req 8.6) ---
  const regenerateRecoveryCodes = useCallback(async () => {
    const result = await callRecoveryEndpoint('generate')
    if (!result.ok) {
      toast('Could not regenerate recovery codes', 'error')
      return { error: result.error }
    }
    return { recoveryCodes: result.codes ?? [] }
  }, [])

  // --- Verify a recovery code at login time (Req 8.3) ---
  const verifyRecoveryCode = useCallback(async (code) => {
    const result = await callRecoveryEndpoint('verify', { code })
    if (!result.ok) {
      return { error: result.error }
    }
    return { success: true }
  }, [])

  return {
    factors,
    hasActiveFactor,
    loading,
    enroll,
    activate,
    challenge,
    unenroll,
    regenerateRecoveryCodes,
    verifyRecoveryCode,
    refresh,
  }
}
