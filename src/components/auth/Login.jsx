import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { needsMfaChallenge } from '../../lib/mfa'
import { IconVault } from '../ui/Icons'
import QRLogin from './QRLogin'
import MfaChallenge from './MfaChallenge'

export default function Login() {
  const [mode, setMode] = useState('login') // 'login' | 'signup' | 'reset'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  // When a signed-in session has an activated factor but has not reached AAL2,
  // hold at the challenge step here rather than letting App proceed to the vault.
  const [challengeUser, setChallengeUser] = useState(null)

  const isSignup = mode === 'signup'
  const isReset = mode === 'reset'

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setMessage('')
    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail) { setError('Enter your email.'); return }

    if (isReset) {
      setBusy(true)
      const { error: e } = await supabase.auth.resetPasswordForEmail(normalizedEmail, { redirectTo: `${window.location.origin}/?reset=true` })
      if (e) setError(e.message)
      else setMessage('Reset link sent. Check your inbox.')
      setBusy(false)
      return
    }

    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (isSignup && password !== confirmPassword) { setError('Passwords do not match.'); return }

    setBusy(true)
    if (isSignup) {
      const { data, error: e } = await supabase.auth.signUp({ email: normalizedEmail, password })
      if (e) setError(e.message)
      else if (data.session) setMessage('Account created.')
      else setMessage('Account created. Check email for confirmation.')
    } else {
      const { data, error: e } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password })
      if (e) {
        setError(e.message)
      } else {
        // Credentials are valid (Req 7.1). Evaluate MFA before letting the app
        // reach the vault: if the account requires AAL2 but the session is at
        // AAL1, hold at the challenge step (Req 7.2).
        const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
        if (aal && needsMfaChallenge(aal.currentLevel, aal.nextLevel)) {
          setChallengeUser(data?.session?.user ?? data?.user ?? null)
        }
      }
    }
    setBusy(false)
  }

  const switchMode = (m) => { setMode(m); setError(''); setMessage(''); setPassword(''); setConfirmPassword('') }

  // MFA challenge step — shown after a valid password when the account requires
  // a second factor. On success the session becomes AAL2 (or recovery-elevated)
  // and App's gate picks it up; here we simply clear the challenge state.
  if (challengeUser) {
    return (
      <MfaChallenge
        user={challengeUser}
        onVerified={() => setChallengeUser(null)}
        onCancel={async () => { await supabase.auth.signOut(); setChallengeUser(null) }}
      />
    )
  }

  return (
    <main className="auth-page">
      <section className="auth-card auth-card-wide">
        <div className="auth-grid">
          {/* Left: QR Code */}
          <div className="auth-qr-section">
            <QRLogin />
          </div>

          {/* Divider */}
          <div className="auth-vertical-divider">
            <span>or</span>
          </div>

          {/* Right: Form */}
          <div className="auth-form-section">
            <div className="auth-logo"><IconVault width="24" height="24" /></div>
            <h1>{isReset ? 'Reset password' : isSignup ? 'Create account' : 'Sign in'}</h1>
            <p className="auth-subtitle">
              {isReset ? "We'll send you a reset link" : isSignup ? 'Start your private clipboard vault' : 'Use email and password'}
            </p>

            <form onSubmit={handleSubmit}>
              <label htmlFor="email">Email</label>
              <input id="email" type="email" required autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />

              {!isReset && (
                <>
                  <label htmlFor="password">Password</label>
                  <input id="password" type="password" required autoComplete={isSignup ? 'new-password' : 'current-password'} placeholder="8+ characters" value={password} onChange={(e) => setPassword(e.target.value)} />
                </>
              )}

              {isSignup && (
                <>
                  <label htmlFor="confirm-password">Confirm password</label>
                  <input id="confirm-password" type="password" required autoComplete="new-password" placeholder="Repeat password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
                </>
              )}

              <button type="submit" className="auth-primary" disabled={busy}>
                {busy ? 'Please wait...' : isReset ? 'Send link' : isSignup ? 'Create account' : 'Sign in'}
              </button>
            </form>

            {message && <p className="auth-message">{message}</p>}
            {error && <p className="auth-error">{error}</p>}

            {mode === 'login' && (
              <button type="button" className="auth-link" onClick={() => switchMode('reset')}>Forgot password?</button>
            )}

            <div className="auth-divider" />

            <button type="button" className="auth-secondary" onClick={() => switchMode(isReset ? 'login' : isSignup ? 'login' : 'signup')}>
              {isReset ? 'Back to sign in' : isSignup ? 'Already have an account?' : 'Create an account'}
            </button>
          </div>
        </div>
      </section>
    </main>
  )
}
