import { useEffect, useState } from 'react'
import { supabase } from './lib/supabaseClient'
import { trackEvent } from './lib/analytics'
import Login from './components/auth/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import ResetPassword from './components/auth/ResetPassword.jsx'
import QRConfirmPage from './components/auth/QRConfirmPage.jsx'
import Onboarding from './components/auth/Onboarding.jsx'

export default function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showResetForm, setShowResetForm] = useState(false)
  const [profile, setProfile] = useState(undefined) // undefined = not checked, null = no profile, object = has profile

  // Check for QR token in URL on initial load
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
      // Reset profile check when session changes
      if (!newSession) setProfile(undefined)
      if (event === 'PASSWORD_RECOVERY') {
        setShowResetForm(true)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  // Check if user has a profile (username set)
  useEffect(() => {
    if (!session?.user) return

    const checkProfile = async () => {
      // Anonymous users skip onboarding
      if (session.user.user_metadata?.is_anonymous) {
        setProfile({ username: 'guest', display_name: 'Guest' })
        return
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single()

      if (error || !data) {
        setProfile(null) // needs onboarding
      } else {
        setProfile(data)
      }
    }

    checkProfile()
  }, [session])

  if (loading) {
    return (
      <div className="app-loader">
        <div className="app-loader-bar" />
        <span className="app-loader-text">VOLT</span>
      </div>
    )
  }

  // QR confirmation page
  if (qrToken && !qrDone) {
    return <QRConfirmPage token={qrToken} onDone={() => setQrDone(true)} />
  }

  if (showResetForm && session) {
    return <ResetPassword onDone={() => setShowResetForm(false)} />
  }

  // Not logged in
  if (!session) return <Login />

  // Logged in but no profile yet — show onboarding
  if (profile === null) {
    return (
      <Onboarding
        user={session.user}
        onComplete={async () => {
          const { data } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', session.user.id)
            .single()
          setProfile(data)
        }}
      />
    )
  }

  // Still checking profile
  if (profile === undefined) {
    return (
      <div className="app-loader">
        <div className="app-loader-bar" />
        <span className="app-loader-text">VOLT</span>
      </div>
    )
  }

  // Logged in + profile exists
  return <Dashboard user={session.user} profile={profile} />
}
