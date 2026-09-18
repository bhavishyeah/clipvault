import { useState } from 'react'
import { useMfa } from '../../hooks/useMfa'
import { supabase } from '../../lib/supabaseClient'
import { isValidTotpFormat } from '../../lib/mfa'
import { markRecoveryElevated } from '../../lib/recoveryElevation'
import { IconVault } from '../ui/Icons'

// VOLT — Login-time MFA challenge step (Feature 2: TOTP 2FA)
//
// Rendered when an authenticated session has an activated factor but has not
// reached AAL2. Offers a 6-digit TOTP entry (→ mfa.challenge/verify → AAL2) or,
// as a fallback, a recovery-code entry (→ api/recovery-codes verify → app-level
// recovery elevation). Invalid entries show an inline error and do NOT elevate
// or proceed (Req 7.5, 8.5). On success it calls `onVerified` so the parent can
// re-check AAL and proceed to the vault (Req 7.3, 7.4, 8.3).
//
// Shared by Login.jsx and the App.jsx vault gate to avoid duplication.
export default function MfaChallenge({ user, onVerified, onCancel }) {
  const mfa = useMfa(user)
  const [useRecovery, setUseRecovery] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // The activated TOTP factor whose id we challenge against.
  const totpFactor = mfa.factors.find((f) => f.status === 'verified')

  const submitTotp = async () => {
    const trimmed = code.trim()
    if (!isValidTotpFormat(trimmed)) {
      setError('Enter the 6-digit code from your authenticator app.')
      return
    }
    if (!totpFactor) {
      setError('No authenticator is set up for this account.')
      return
    }
    setBusy(true)
    const result = await mfa.challenge(totpFactor.id, trimmed)
    setBusy(false)
    if (result.error || !result.success) {
      setError('Invalid code — try again.')
      return
    }
    onVerified?.()
  }

  const submitRecovery = async () => {
    const trimmed = code.trim()
    if (!trimmed) {
      setError('Enter one of your recovery codes.')
      return
    }
    setBusy(true)
    const result = await mfa.verifyRecoveryCode(trimmed)
    if (result.error || !result.success) {
      setBusy(false)
      setError('That recovery code is invalid or already used.')
      return
    }
    // Supabase cannot mint AAL2 from a recovery code, so mark an app-level
    // recovery elevation for this session (design approach 1).
    const { data } = await supabase.auth.getSession()
    markRecoveryElevated(data?.session?.access_token)
    setBusy(false)
    onVerified?.()
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    setError('')
    if (useRecovery) submitRecovery()
    else submitTotp()
  }

  const switchToRecovery = () => { setUseRecovery(true); setCode(''); setError('') }
  const switchToTotp = () => { setUseRecovery(false); setCode(''); setError('') }

  if (mfa.loading) {
    return (
      <div className="app-loader">
        <div className="app-loader-bar" />
        <span className="app-loader-text">VOLT</span>
      </div>
    )
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-logo"><IconVault width="24" height="24" /></div>
        <h1>{useRecovery ? 'Enter recovery code' : 'Two-factor authentication'}</h1>
        <p className="auth-subtitle">
          {useRecovery
            ? 'Enter one of your single-use recovery codes'
            : 'Enter the 6-digit code from your authenticator app'}
        </p>

        <form onSubmit={handleSubmit}>
          {useRecovery ? (
            <>
              <label htmlFor="recovery-code">Recovery code</label>
              <input
                id="recovery-code"
                type="text"
                autoComplete="one-time-code"
                autoFocus
                placeholder="XXXX-XXXX"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </>
          ) : (
            <>
              <label htmlFor="totp-code">Authentication code</label>
              <input
                id="totp-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={6}
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />
            </>
          )}

          <button type="submit" className="auth-primary" disabled={busy}>
            {busy ? 'Verifying...' : 'Verify'}
          </button>
        </form>

        {error && <p className="auth-error">{error}</p>}

        <button
          type="button"
          className="auth-link"
          onClick={useRecovery ? switchToTotp : switchToRecovery}
        >
          {useRecovery ? 'Use authenticator app instead' : 'Use a recovery code instead'}
        </button>

        {onCancel && (
          <>
            <div className="auth-divider" />
            <button type="button" className="auth-secondary" onClick={onCancel}>
              Sign out
            </button>
          </>
        )}
      </section>
    </main>
  )
}
