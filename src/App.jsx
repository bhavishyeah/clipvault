import { useEffect, useState } from 'react'
import { supabase } from './lib/supabaseClient'
import Login from './components/auth/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import ResetPassword from './components/auth/ResetPassword.jsx'

export default function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showResetForm, setShowResetForm] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession)

      // Supabase fires PASSWORD_RECOVERY when user clicks the reset link
      if (event === 'PASSWORD_RECOVERY') {
        setShowResetForm(true)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  if (loading) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', color: '#9698ad' }}>
        <p>Loading…</p>
      </div>
    )
  }

  // Show password update form when user arrives from reset email
  if (showResetForm && session) {
    return <ResetPassword onDone={() => setShowResetForm(false)} />
  }

  return session ? <Dashboard user={session.user} /> : <Login />
}
