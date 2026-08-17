import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { IconVault } from '../ui/Icons'

async function confirmAndLogin(token) {
  // Call API to create anonymous user and confirm the QR session
  const res = await fetch('/api/qr-confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  })

  const data = await res.json()

  if (!res.ok || !data.success) {
    return { ok: false, error: data.error || 'Failed to connect' }
  }

  // Sign in as the anonymous user on this device (phone)
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: data.email,
    password: data.password,
  })

  if (signInError) {
    return { ok: false, error: signInError.message }
  }

  return { ok: true }
}

export default function QRConfirmPage({ token, onDone }) {
  const [status, setStatus] = useState('confirming') // confirming, success, error
  const [error, setError] = useState('')
  const ranRef = useRef(false)

  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true

    const run = async () => {
      const result = await confirmAndLogin(token)

      if (result.ok) {
        setStatus('success')
        // Wait 2s then proceed to dashboard
        window.setTimeout(() => onDone(), 2000)
      } else {
        setError(result.error)
        setStatus('error')
      }
    }

    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-logo"><IconVault width="24" height="24" /></div>

        {status === 'confirming' && (
          <>
            <h1>Connecting...</h1>
            <p className="auth-subtitle">Setting up your temporary session</p>
            <div className="qr-confirm-loader"><div className="loader" /></div>
          </>
        )}

        {status === 'success' && (
          <>
            <h1>Connected</h1>
            <p className="auth-subtitle">Temporary session active on both devices. Loading vault...</p>
            <div className="qr-confirm-success">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
          </>
        )}

        {status === 'error' && (
          <>
            <h1>Connection failed</h1>
            <p className="auth-subtitle">{error}</p>
            <button className="auth-primary" onClick={onDone}>Try again</button>
          </>
        )}
      </section>
    </main>
  )
}
