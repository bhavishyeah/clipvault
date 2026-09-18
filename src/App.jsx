import { useEffect, useState } from 'react'
import { supabase } from './lib/supabaseClient'
import { trackEvent } from './lib/analytics'
import { canAccessVault, RECOVERY_AAL2 } from './lib/mfa'
import { isRecoveryElevated, clearRecoveryElevated } from './lib/recoveryElevation'
import Login from './components/auth/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import ResetPassword from './components/auth/ResetPassword.jsx'
import QRConfirmPage from './components/auth/QRConfirmPage.jsx'
import Onboarding from './components/auth/Onboarding.jsx'
import MfaChallenge from './components/auth/MfaChallenge.jsx'

export default function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showResetForm, setShowResetForm] = useState(false)
  const [profile, setProfile] = useState(undefined) // undefined = not checked, null = no profile, object = has profile
  // Vault access gate (Feature 2): undefined = not checked yet.
  // { hasActiveFactor, currentLevel } once resolved.
  const [aal, setAal] = useState(undefined)

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
      // Reset profile + AAL checks when the session changes.
      setAal(undefined)
      if (!newSession) {
        setProfile(undefined)
        clearRecoveryElevated()
      }
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

  // Compute the session's assurance level + factor state for the vault gate.
  // Runs when the session changes; guarded with a cancelled flag so a stale
  // resolve after sign-out can't write state (avoids re-render loops).
  useEffect(() => {
    if (!session?.user) return

    let cancelled = false

    const checkAal = async () => {
      // Anonymous/guest sessions never carry an MFA factor.
      if (session.user.user_metadata?.is_anonymous) {
        if (!cancelled) setAal({ hasActiveFactor: false, currentLevel: 'aal1' })
        return
      }

      const [{ data: levels }, { data: factorData }] = await Promise.all([
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        supabase.auth.mfa.listFactors(),
      ])
      if (cancelled) return

      const allFactors = factorData?.all ?? factorData?.totp ?? []
      const hasActiveFactor = allFactors.some((f) => f.status === 'verified')

      // A valid recovery code elevates the session at the app level only
      // (Supabase cannot mint AAL2 from a recovery code — design approach 1).
      let currentLevel = levels?.currentLevel ?? 'aal1'
      if (isRecoveryElevated(session.access_token)) {
        currentLevel = RECOVERY_AAL2
      }

      setAal({ hasActiveFactor, currentLevel })
    }

    checkAal()

    return () => { cancelled = true }
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

  // Still resolving the assurance level for the vault gate
  if (aal === undefined) {
    return (
      <div className="app-loader">
        <div className="app-loader-bar" />
        <span className="app-loader-text">VOLT</span>
      </div>
    )
  }

  // Vault access gate (Req 7.4, 7.6, 9.6, 10.5): a session with an active
  // factor that has not reached AAL2 (including immediately after a password
  // reset) is held at the challenge step rather than shown the vault. A
  // no-factor session is always granted.
  if (!canAccessVault(aal)) {
    const reCheck = async () => {
      const { data } = await supabase.auth.getSession()
      setAal(undefined)
      if (data?.session) setSession(data.session)
    }
    return (
      <MfaChallenge
        user={session.user}
        onVerified={reCheck}
        onCancel={async () => { await supabase.auth.signOut() }}
      />
    )
  }

  // Logged in + profile exists + vault access granted
  return <Dashboard user={session.user} profile={profile} />
}
