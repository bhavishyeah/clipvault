import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { IconVault } from '../ui/Icons'

async function confirmQRSession(token, accessToken) {
  const res = await fetch('/api/qr-confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, access_token: accessToken }),
  })
  const data = await res.json()
  if (res.ok && data.success) return { ok: true }
  return { ok: false, error: data.error || 'Failed to link desktop' }
}

export default function QRConfirmPage({ token, onDone }) {
  const [status, setStatus] = useState('checking')
  const [error, setError] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const confirmedRef = useRef(false)

  useEffect(() => {
    if (confirmedRef.current) return

    const checkAndConfirm = async () => {
      const { data: sessionData } = await supabase.auth.getSession()

      if (sessionData?.session) {
        confirmedRef.current = true
        setStatus('confirming')
        const result = await confirmQRSession(token, sessionData.session.access_token)
        if (result.ok) {
          setStatus('success')
          window.setTimeout(() => onDone(), 2000)
        } else {
          setError(result.error)
          setStatus('error')
        }
      } else {
        setStatus('needsLogin')
      }
    }

    checkAndConfirm()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleLogin = async (e) => {
    e.preventDefault()
    setError('')
    const normalizedEmail = email.trim().toLowerCase()

    if (!normalizedEmail || password.length < 8) {
      setError('Enter email and password (8+ chars)')
      return
    }

    setBusy(true)

    const { data, error: loginError } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    })

    if (loginError) {
      setError(loginError.message)
      setBusy(false)
      return
    }

    if (data.session) {
      setStatus('confirming')
      const result = await confirmQRSession(token, data.session.access_token)
      if (result.ok) {
        setStatus('success')
        window.setTimeout(() => onDone(), 2000)
      } else {
        setError(result.error)
        setStatus('error')
      }
    }

    setBusy(false)
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-logo"><IconVault width="24" height="24" /></div>

        {status === 'checking' && (
          <>
            <h1>Linking desktop...</h1>
            <div className="qr-confirm-loader"><div className="loader" /></div>
          </>
        )}

        {status === 'confirming' && (
          <>
            <h1>Connecting...</h1>
            <p className="auth-subtitle">Linking your account to the desktop</p>
            <div className="qr-confirm-loader"><div className="loader" /></div>
          </>
        )}

        {status === 'success' && (
          <>
            <h1>Connected</h1>
            <p className="auth-subtitle">Desktop is now logged in. You can close this page.</p>
            <div className="qr-confirm-success">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
          </>
        )}

        {status === 'error' && (
          <>
            <h1>Link failed</h1>
            <p className="auth-subtitle">{error}</p>
            <button className="auth-primary" onClick={onDone}>Go to ClipVault</button>
          </>
        )}

        {status === 'needsLogin' && (
          <>
            <h1>Sign in to link</h1>
            <p className="auth-subtitle">Log in to connect your desktop session</p>

            <form onSubmit={handleLogin}>
              <label htmlFor="qr-email">Email</label>
              <input id="qr-email" type="email" required autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              <label htmlFor="qr-password">Password</label>
              <input id="qr-password" type="password" required autoComplete="current-password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <button type="submit" className="auth-primary" disabled={busy}>
                {busy ? 'Signing in...' : 'Sign in & link desktop'}
              </button>
            </form>

            {error && <p className="auth-error">{error}</p>}
          </>
        )}
      </section>
    </main>
  )
}
