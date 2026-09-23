import { useEffect, useRef, useState } from 'react'
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

function tokenClaim(accessToken, claim) {
  try {
    const payload = accessToken?.split('.')[1]
    if (!payload) return null
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const decoded = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')))
    return decoded?.[claim] ?? null
  } catch {
    return null
  }
}

function sessionAal(session) {
  return tokenClaim(session?.access_token, 'aal')
}

export default function App() {
  const [session, setSession] = useState(null)
  // Tracks the authenticated principal independently of render state so
  // same-user TOKEN_REFRESHED / SIGNED_IN events do not tear down Dashboard.
  // Android backgrounds Chrome while its native picker is open; Supabase can
  // emit one of those events when the tab resumes.
  const sessionUserIdRef = useRef(null)
  const sessionRef = useRef(null)
  const [aalCheckVersion, setAalCheckVersion] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showResetForm, setShowResetForm] = useState(false)
  const [profile, setProfile] = useState(undefined) // undefined = not checked, null = no profile, object = has profile
  // Vault access gate (Feature 2): undefined = not checked yet.
  // { hasActiveFactor, currentLevel } once resolved.
  const [aal, setAal] = useState(undefined)
  const sessionUserId = session?.user?.id ?? null

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
      sessionUserIdRef.current = data.session?.user?.id ?? null
      sessionRef.current = data.session
      setSession(data.session)
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      const previousSession = sessionRef.current
      const previousUserId = sessionUserIdRef.current
      const nextUserId = newSession?.user?.id ?? null
      const identityChanged = previousUserId !== nextUserId
      const assuranceDowngraded =
        !identityChanged &&
        sessionAal(previousSession) === 'aal2' &&
        sessionAal(newSession) === 'aal1'

      sessionUserIdRef.current = nextUserId
      sessionRef.current = newSession
      setSession(newSession)

      if (assuranceDowngraded) {
        // A confirmed aal2 -> aal1 transition invalidates any prior app-level
        // recovery elevation for this auth session before the gate re-checks.
        clearRecoveryElevated()
      }

      if (!newSession) {
        // Signing out must clear all user-scoped state.
        setProfile(undefined)
        setAal(undefined)
        clearRecoveryElevated()
      } else if (identityChanged) {
        // Never reuse one account's profile/AAL for another account.
        setProfile(undefined)
        setAal(undefined)
      } else if (event === 'PASSWORD_RECOVERY' || assuranceDowngraded) {
        // Password recovery and a real AAL downgrade must re-run the gate.
        // Ordinary same-session token refreshes preserve Dashboard so Android's
        // native picker cannot destroy an in-flight selected File.
        setAal(undefined)
        setAalCheckVersion((value) => value + 1)
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

  // Compute assurance for a new account or an explicit MFA/password-recovery
  // transition. Token refreshes for the same account intentionally do not
  // restart this gate: Android backgrounds Chrome during native file picking,
  // and a same-user auth refresh must not unmount Dashboard mid-selection.
  useEffect(() => {
    const activeSession = sessionRef.current
    if (!sessionUserId || !activeSession?.user) return

    let cancelled = false

    const checkAal = async () => {
      if (activeSession.user.user_metadata?.is_anonymous) {
        if (!cancelled) setAal({ hasActiveFactor: false, currentLevel: 'aal1' })
        return
      }

      const [{ data: levels }, { data: factorData }] = await Promise.all([
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        supabase.auth.mfa.listFactors(),
      ])
      if (cancelled || sessionUserIdRef.current !== sessionUserId) return

      const allFactors = factorData?.all ?? factorData?.totp ?? []
      const hasActiveFactor = allFactors.some((f) => f.status === 'verified')
      let currentLevel = levels?.currentLevel ?? 'aal1'
      if (isRecoveryElevated(activeSession.access_token)) {
        currentLevel = RECOVERY_AAL2
      }

      setAal({ hasActiveFactor, currentLevel })
    }

    checkAal()
    return () => { cancelled = true }
  }, [sessionUserId, aalCheckVersion])

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
      sessionRef.current = data?.session ?? null
      sessionUserIdRef.current = data?.session?.user?.id ?? null
      setAal(undefined)
      setAalCheckVersion((value) => value + 1)
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
