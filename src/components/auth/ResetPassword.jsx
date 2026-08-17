import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

export default function ResetPassword({ onDone }) {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setBusy(true)

    const { error: updateError } = await supabase.auth.updateUser({
      password,
    })

    if (updateError) {
      setError(updateError.message)
    } else {
      onDone()
    }

    setBusy(false)
  }

  return (
    <main style={styles.wrap}>
      <section style={styles.card}>
        <h1 style={styles.title}>Set New Password</h1>
        <p style={styles.subtitle}>Choose a strong password for your vault</p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <label style={styles.label} htmlFor="new-password">
            New password
          </label>
          <input
            id="new-password"
            type="password"
            required
            autoComplete="new-password"
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={styles.input}
          />

          <label style={styles.label} htmlFor="confirm-new-password">
            Confirm new password
          </label>
          <input
            id="confirm-new-password"
            type="password"
            required
            autoComplete="new-password"
            placeholder="Repeat your password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            style={styles.input}
          />

          <button type="submit" disabled={busy} style={styles.primaryButton}>
            {busy ? 'Updating…' : 'Update password'}
          </button>
        </form>

        {error && <p style={styles.error}>{error}</p>}
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
  error: {
    marginTop: 12,
    color: '#dc2626',
    fontSize: 14,
    textAlign: 'center',
  },
}
