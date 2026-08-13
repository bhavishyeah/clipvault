import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

export default function Login() {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const isSignup = mode === 'signup'

  const handleSubmit = async (event) => {
    event.preventDefault()

    setError('')
    setMessage('')

    const normalizedEmail = email.trim().toLowerCase()

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }

    if (isSignup && password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setBusy(true)

    if (isSignup) {
      const { data, error: signupError } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
      })

      if (signupError) {
        setError(signupError.message)
      } else if (data.session) {
        setMessage('Account created. Loading your vault…')
      } else {
        setMessage(
          'Account created. Check your email if confirmation is enabled.'
        )
      }
    } else {
      const { error: loginError } =
        await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        })

      if (loginError) {
        setError(loginError.message)
      }
    }

    setBusy(false)
  }

  const switchMode = () => {
    setMode(isSignup ? 'login' : 'signup')
    setError('')
    setMessage('')
    setPassword('')
    setConfirmPassword('')
  }

  return (
    <main style={styles.wrap}>
      <section style={styles.card}>
<h1 style={styles.title}>ClipVault Password Login</h1>
        <p style={styles.subtitle}>
          {isSignup
            ? 'Create your private clipboard vault'
            : 'Sign in to access your clipboard vault'}
        </p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <label style={styles.label} htmlFor="email">
            Email
          </label>

          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            style={styles.input}
          />

          <label style={styles.label} htmlFor="password">
            Password
          </label>

          <input
            id="password"
            type="password"
            required
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            placeholder="At least 8 characters"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            style={styles.input}
          />

          {isSignup && (
            <>
              <label style={styles.label} htmlFor="confirm-password">
                Confirm password
              </label>

              <input
                id="confirm-password"
                type="password"
                required
                autoComplete="new-password"
                placeholder="Repeat your password"
                value={confirmPassword}
                onChange={(event) =>
                  setConfirmPassword(event.target.value)
                }
                style={styles.input}
              />
            </>
          )}

          <button type="submit" disabled={busy} style={styles.primaryButton}>
            {busy
              ? 'Please wait…'
              : isSignup
                ? 'Create account'
                : 'Log in'}
          </button>
        </form>

        {message && <p style={styles.message}>{message}</p>}
        {error && <p style={styles.error}>{error}</p>}

        <div style={styles.divider}>or</div>

        <button
          type="button"
          onClick={switchMode}
          style={styles.secondaryButton}
        >
          {isSignup
            ? 'Already have an account? Log in'
            : 'New to ClipVault? Create an account'}
        </button>
      </section>
    </main>
  )
}

const styles = {
  wrap: {
    minHeight: '100vh',
    display: 'grid',
    placeItems: 'center',
    padding: 20,
    background: '#0f172a',
    fontFamily: 'system-ui, sans-serif',
  },
  card: {
    width: '100%',
    maxWidth: 380,
    boxSizing: 'border-box',
    padding: 32,
    borderRadius: 16,
    background: '#ffffff',
    boxShadow: '0 20px 50px rgba(0, 0, 0, 0.25)',
  },
  title: {
    margin: 0,
    textAlign: 'center',
    color: '#111827',
  },
  subtitle: {
    margin: '8px 0 24px',
    textAlign: 'center',
    color: '#6b7280',
  },
  form: {
    display: 'grid',
    gap: 8,
  },
  label: {
    marginTop: 8,
    color: '#374151',
    fontSize: 14,
    fontWeight: 600,
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    padding: 12,
    border: '1px solid #d1d5db',
    borderRadius: 8,
    fontSize: 15,
  },
  primaryButton: {
    marginTop: 14,
    padding: 12,
    border: 0,
    borderRadius: 8,
    background: '#4f46e5',
    color: '#ffffff',
    fontSize: 15,
    cursor: 'pointer',
  },
  secondaryButton: {
    width: '100%',
    padding: 12,
    border: '1px solid #d1d5db',
    borderRadius: 8,
    background: '#ffffff',
    color: '#374151',
    cursor: 'pointer',
  },
  divider: {
    margin: '20px 0',
    textAlign: 'center',
    color: '#9ca3af',
  },
  message: {
    color: '#15803d',
    fontSize: 14,
  },
  error: {
    color: '#dc2626',
    fontSize: 14,
  },
}