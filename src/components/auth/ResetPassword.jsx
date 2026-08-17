import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { IconVault } from '../ui/Icons'

export default function ResetPassword({ onDone }) {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return }

    setBusy(true)
    const { error: e } = await supabase.auth.updateUser({ password })
    if (e) setError(e.message)
    else onDone()
    setBusy(false)
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-logo"><IconVault width="24" height="24" /></div>
        <h1>Set new password</h1>
        <p className="auth-subtitle">Choose a strong password for your vault</p>

        <form onSubmit={handleSubmit}>
          <label htmlFor="new-password">New password</label>
          <input id="new-password" type="password" required autoComplete="new-password" placeholder="8+ characters" value={password} onChange={(e) => setPassword(e.target.value)} />
          <label htmlFor="confirm-new-password">Confirm password</label>
          <input id="confirm-new-password" type="password" required autoComplete="new-password" placeholder="Repeat password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
          <button type="submit" className="auth-primary" disabled={busy}>{busy ? 'Updating...' : 'Update password'}</button>
        </form>

        {error && <p className="auth-error">{error}</p>}
      </section>
    </main>
  )
}
