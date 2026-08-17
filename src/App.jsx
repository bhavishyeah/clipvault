import { useEffect, useState } from 'react'
import { supabase } from './lib/supabaseClient'
import { trackEvent } from './lib/analytics'
import Login from './components/auth/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import ResetPassword from './components/auth/ResetPassword.jsx'
import QRConfirmPage from './components/auth/QRConfirmPage.jsx'

export default function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showResetForm, setShowResetForm] = useState(false)

  // Check for QR token in URL on initial load (before effects)
  const [qrToken] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('qr_token')
    if (token) {
      window.history.replaceState({}, '', '/')
      return token
    }
    return null
  })
  const [qrDone, setQrDone] = useState(false)

  useEffect(() => {
    trackEvent('session_start')

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession)
      if (event === 'PASSWORD_RECOVERY') {
        setShowResetForm(true)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  if (loading) {
    return (
      <div className="app-loader">
        <div className="app-loader-bar" />
        <span className="app-loader-text">ClipVault</span>
      </div>
    )
  }

  // QR confirmation page — shown when user scans QR code
  if (qrToken && !qrDone) {
    return (
      <QRConfirmPage
        token={qrToken}
        onDone={() => setQrDone(true)}
      />
    )
  }

  if (showResetForm && session) {
    return <ResetPassword onDone={() => setShowResetForm(false)} />
  }

  return session ? <Dashboard user={session.user} /> : <Login />
}
