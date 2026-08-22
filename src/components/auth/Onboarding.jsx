import { useRef, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { IconVault } from '../ui/Icons'

const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/

export default function Onboarding({ user, onComplete }) {
  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState(() => {
    // Auto-suggest from email
    if (user.email) {
      const base = user.email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '').slice(0, 15)
      if (base.length >= 3) return base
    }
    return ''
  })
  const [usernameStatus, setUsernameStatus] = useState(null)
  const [suggestions, setSuggestions] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const checkTimer = useRef(null)

  const checkUsername = (value) => {
    setUsername(value)
    setSuggestions([])

    const normalized = value.trim().toLowerCase()

    if (!normalized) {
      setUsernameStatus(null)
      return
    }

    if (!USERNAME_REGEX.test(normalized)) {
      setUsernameStatus('invalid')
      return
    }

    setUsernameStatus('checking')

    window.clearTimeout(checkTimer.current)
    checkTimer.current = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/username-check?username=${encodeURIComponent(normalized)}`)
        const data = await res.json()

        if (data.available) {
          setUsernameStatus('available')
        } else {
          setUsernameStatus('taken')
          if (data.suggestions) setSuggestions(data.suggestions)
        }
      } catch {
        setUsernameStatus(null)
      }
    }, 400)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    const trimmedName = displayName.trim()
    const trimmedUsername = username.trim().toLowerCase()

    if (!trimmedName) { setError('Enter your name'); return }
    if (!trimmedUsername || !USERNAME_REGEX.test(trimmedUsername)) { setError('Enter a valid username'); return }
    if (usernameStatus !== 'available') { setError('Choose an available username'); return }

    setBusy(true)

    const { error: insertError } = await supabase.from('profiles').insert({
      id: user.id,
      username: trimmedUsername,
      display_name: trimmedName,
    })

    if (insertError) {
      if (insertError.message.includes('duplicate')) {
        setError('Username just got taken. Try another.')
        setUsernameStatus('taken')
      } else {
        setError(insertError.message)
      }
      setBusy(false)
      return
    }

    onComplete()
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-logo"><IconVault width="24" height="24" /></div>
        <h1>Set up your profile</h1>
        <p className="auth-subtitle">Choose a username for your VOLT identity</p>

        <form onSubmit={handleSubmit}>
          <label htmlFor="onboard-name">Display name</label>
          <input
            id="onboard-name"
            type="text"
            required
            placeholder="Your name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={50}
          />

          <label htmlFor="onboard-username">Username</label>
          <div className="username-input-wrap">
            <span className="username-at">@</span>
            <input
              id="onboard-username"
              type="text"
              required
              placeholder="username"
              value={username}
              onChange={(e) => checkUsername(e.target.value.replace(/\s/g, ''))}
              maxLength={20}
              autoComplete="off"
            />
            <span className="username-status">
              {usernameStatus === 'checking' && <span className="status-dot-check" />}
              {usernameStatus === 'available' && <span className="status-available">&#10003;</span>}
              {usernameStatus === 'taken' && <span className="status-taken">&#10005;</span>}
              {usernameStatus === 'invalid' && <span className="status-taken">&#10005;</span>}
            </span>
          </div>

          {usernameStatus === 'invalid' && (
            <p className="username-hint">3-20 characters, letters/numbers/underscore only</p>
          )}

          {usernameStatus === 'taken' && suggestions.length > 0 && (
            <div className="username-suggestions">
              <span>Try: </span>
              {suggestions.map((s) => (
                <button type="button" key={s} onClick={() => checkUsername(s)}>@{s}</button>
              ))}
            </div>
          )}

          <button type="submit" className="auth-primary" disabled={busy || usernameStatus !== 'available'}>
            {busy ? 'Creating...' : 'Continue'}
          </button>
        </form>

        {error && <p className="auth-error">{error}</p>}
      </section>
    </main>
  )
}
