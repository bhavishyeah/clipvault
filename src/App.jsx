import { useEffect, useState } from 'react'
import { supabase } from './lib/supabaseClient'
import Login from './components/auth/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'

export default function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
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

  return session ? <Dashboard user={session.user} /> : <Login />
}
