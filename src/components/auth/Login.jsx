import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

export default function Login() {
  const [mode, setMode] = useState('login') // 'login' | 'signup' | 'reset'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const isSignup = mode === 'signup'
  const isReset = mode === 'reset'

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setMessage('')

    const normalizedEmail = email.trim().toLowerCase()

    if (!normalizedEmail) {
      setError('Please enter your email address.')
      return
    }

    // Password reset flow
    if (isReset) {
      setBusy(true)
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        normalizedEmail,
        { redirectTo: `${window.location.origin}/?reset=true` }
      )
      if (resetError) {
        setError(resetError.message)
      } else {
        setMessage('Password reset link sent. Check your inbox.')
      }
      setBusy(false)
      return
    }

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

  const switchMode = (newMode) => {
    setMode(newMode)
    setError('')
    setMessage('')
    setPassword('')
    setConfirmPassword('')
  }

  const getTitle = () => {
    if (isReset) return 'Reset Password'
    if (isSignup) return 'Create Account'
    return 'Welcome Back'
  }

  const getSubtitle = () => {
    if (isReset) return 'Enter your email to receive a reset link'
    if (isSignup) return 'Create your private clipboard vault'
    return 'Sign in to access your clipboard vault'
  }

  const getButtonText = () => {
    if (busy) return 'Please wait…'
    if (isReset) return 'Send reset link'
    if (isSignup) return 'Create account'
    return 'Log in'
  }

  return (
    <main style={styles.wrap}>
      <section style={styles.card}>
        <h1 style={styles.title}>{getTitle()}</h1>
        <p style={styles.subtitle}>{getSubtitle()}</p>

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

          {!isReset && (
            <>
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
            </>
          )}

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
                onChange={(event) => setConfirmPassword(event.target.value)}
                style={styles.input}
              />
            </>
          )}

          <button type="submit" disabled={busy} style={styles.primaryButton}>
            {getButtonText()}
          </button>
        </form>

        {message && <p style={styles.message}>{message}</p>}
        {error && <p style={styles.error}>{error}</p>}

        {/* Forgot password link (only on login screen) */}
        {mode === 'login' && (
          <button
            type="button"
            onClick={() => switchMode('reset')}
            style={styles.forgotLink}
          >
            Forgot your password?
          </button>
        )}

        <div style={styles.divider}>or</div>

        {isReset ? (
          <button
            type="button"
            onClick={() => switchMode('login')}
            style={styles.secondaryButton}
          >
            Back to login
          </button>
        ) : (
          <button
            type="button"
            onClick={() => switchMode(isSignup ? 'login' : 'signup')}
            style={styles.secondaryButton}
          >
            {isSignup
              ? 'Already have an account? Log in'
              : 'New to ClipVault? Create an account'}
          </button>
        )}
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
    fontFamily: "'Archivo', system-ui, sans-serif",
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
    fontSize: 22,
    fontFamily: "'Clash Display', sans-serif",
  },
  subtitle: {
    margin: '8px 0 24px',
    textAlign: 'center',
    color: '#6b7280',
    fontSize: 14,
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
    fontWeight: 600,
    cursor: 'pointer',
  },
  secondaryButton: {
    width: '100%',
    padding: 12,
    border: '1px solid #d1d5db',
    borderRadius: 8,
    background: '#ffffff',
    color: '#374151',
    fontSize: 14,
    cursor: 'pointer',
  },
  forgotLink: {
    display: 'block',
    width: '100%',
    marginTop: 12,
    padding: 0,
    border: 0,
    background: 'none',
    color: '#4f46e5',
    fontSize: 13,
    textAlign: 'center',
    cursor: 'pointer',
  },
  divider: {
    margin: '20px 0',
    textAlign: 'center',
    color: '#9ca3af',
    fontSize: 13,
  },
  message: {
    marginTop: 12,
    color: '#15803d',
    fontSize: 14,
    textAlign: 'center',
  },
  error: {
    marginTop: 12,
    color: '#dc2626',
    fontSize: 14,
    textAlign: 'center',
  },
}
