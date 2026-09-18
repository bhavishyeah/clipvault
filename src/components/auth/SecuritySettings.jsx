import { useState } from 'react'
import { useMfa } from '../../hooks/useMfa'
import ConfirmModal from '../ui/ConfirmModal'
import { toast } from '../ui/toastStore'
import { IconCopy, IconVault } from '../ui/Icons'

// VOLT — Security settings (Feature 2: TOTP 2FA)
//
// Surfaces the enroll / activate / disable / regenerate flows exposed by
// `useMfa`. Pure MFA decision logic and the side-effecting Auth_Service calls
// live in the hook; this component only renders state and forwards user intent.
//
// Enrollment flow:
//   1. "Enable two-factor authentication" -> mfa.enroll() -> show QR + secret
//   2. 6-digit code + "Verify & activate" -> mfa.activate(factorId, code)
//   3. On success reveal the 10 recovery codes ONCE (copy / download)
//
// Active state (mfa.hasActiveFactor === true):
//   - "Regenerate recovery codes" -> re-reveal a fresh set once
//   - "Disable 2FA" -> ConfirmModal -> mfa.unenroll(factorId)
//
// Requirements: 6.2, 6.5, 6.6, 8.1, 8.2, 9.1, 9.2, 9.3, 9.4, 9.5

// Build a plain-text blob of the recovery codes for download (Req 8.2).
function codesToText(codes) {
  return [
    'VOLT — Two-factor recovery codes',
    'Keep these somewhere safe. Each code works once.',
    '',
    ...codes,
    '',
  ].join('\n')
}

export default function SecuritySettings({ user }) {
  const mfa = useMfa(user)

  // Pending enrollment (before activation): the factor id + QR + text secret.
  const [pending, setPending] = useState(null) // { factorId, qr, secret }
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // The 10 recovery codes, revealed exactly once after activation/regeneration.
  const [recoveryCodes, setRecoveryCodes] = useState(null)

  // Confirmation modal for disabling 2FA (Req 9.2).
  const [confirmDisable, setConfirmDisable] = useState(false)

  const activeFactor = mfa.factors.find((f) => f.status === 'verified')

  // --- Enroll: create an unactivated factor and show its QR + secret (Req 6.2) ---
  const handleEnroll = async () => {
    setError('')
    setBusy(true)
    const res = await mfa.enroll()
    setBusy(false)

    if (res.error) {
      setError(res.error)
      return
    }
    setPending({ factorId: res.factorId, qr: res.qr, secret: res.secret })
    setCode('')
  }

  // --- Activate the pending factor, then reveal recovery codes once (Req 8.1) ---
  const handleActivate = async (event) => {
    event.preventDefault()
    if (!pending) return
    setError('')
    setBusy(true)
    const res = await mfa.activate(pending.factorId, code)
    setBusy(false)

    if (res.error) {
      // Invalid code — factor stays unactivated (Req 6.4 / inline error).
      setError(res.error)
      return
    }

    // Enrollment complete: clear the pending panel and show the codes once.
    setPending(null)
    setCode('')
    setRecoveryCodes(res.recoveryCodes ?? [])
  }

  // --- Cancel a pending enrollment without activating ---
  const handleCancelEnroll = () => {
    setPending(null)
    setCode('')
    setError('')
  }

  // --- Regenerate recovery codes, re-revealing the new set once (Req 8.6) ---
  const handleRegenerate = async () => {
    setError('')
    setBusy(true)
    const res = await mfa.regenerateRecoveryCodes()
    setBusy(false)

    if (res.error) {
      setError(res.error)
      return
    }
    setRecoveryCodes(res.recoveryCodes ?? [])
  }

  // --- Disable the active factor after explicit confirmation (Req 9.1–9.5) ---
  const handleDisableConfirmed = async () => {
    setConfirmDisable(false)
    if (!activeFactor) return
    setError('')
    setBusy(true)
    const res = await mfa.unenroll(activeFactor.id)
    setBusy(false)

    if (res.error) {
      // Factor retained on failure (Req 9.5) — the hook already toasted.
      setError(res.error)
      return
    }
    // Successfully removed (Req 9.4).
    setRecoveryCodes(null)
    toast('Two-factor authentication disabled')
  }

  // --- Recovery-code save controls (Req 8.2) ---
  const handleCopyCodes = async () => {
    if (!recoveryCodes?.length) return
    try {
      await navigator.clipboard.writeText(recoveryCodes.join('\n'))
      toast('Recovery codes copied')
    } catch {
      toast('Could not copy — download them instead', 'error')
    }
  }

  const handleDownloadCodes = () => {
    if (!recoveryCodes?.length) return
    const blob = new Blob([codesToText(recoveryCodes)], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'volt-recovery-codes.txt'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // The one-time recovery-code reveal panel, shared by activate + regenerate.
  const recoveryPanel = recoveryCodes && (
    <div className="security-recovery" role="region" aria-label="Recovery codes">
      <h4>Your recovery codes</h4>
      <p className="security-hint">
        Save these now — they are shown only once. Each code can be used a single
        time to sign in if you lose your authenticator.
      </p>
      <ul className="security-codes">
        {recoveryCodes.map((c) => (
          <li key={c}>
            <code>{c}</code>
          </li>
        ))}
      </ul>
      <div className="security-actions">
        <button type="button" className="security-secondary" onClick={handleCopyCodes} aria-label="Copy recovery codes">
          <IconCopy /> Copy
        </button>
        <button type="button" className="security-secondary" onClick={handleDownloadCodes} aria-label="Download recovery codes">
          Download
        </button>
        <button type="button" className="security-secondary" onClick={() => setRecoveryCodes(null)} aria-label="Dismiss recovery codes">
          Done
        </button>
      </div>
    </div>
  )

  if (mfa.loading) {
    return (
      <section className="security-settings" aria-busy="true">
        <p className="security-hint">Loading security settings…</p>
      </section>
    )
  }

  return (
    <section className="security-settings" aria-label="Security settings">
      <header className="security-header">
        <div className="security-logo"><IconVault width="20" height="20" /></div>
        <div>
          <h3>Two-factor authentication</h3>
          <p className="security-hint">Add a time-based code from an authenticator app.</p>
        </div>
      </header>

      {error && <p className="security-error" role="alert">{error}</p>}

      {/* --- Active state: 2FA is on (Req 6.6) --- */}
      {mfa.hasActiveFactor ? (
        <div className="security-active">
          <p className="security-status" role="status">
            <span className="security-badge">On</span>
            Two-factor authentication is on for your account.
          </p>

          {recoveryPanel}

          <div className="security-actions">
            <button
              type="button"
              className="security-secondary"
              onClick={handleRegenerate}
              disabled={busy}
              aria-label="Regenerate recovery codes"
            >
              {busy ? 'Working…' : 'Regenerate recovery codes'}
            </button>
            <button
              type="button"
              className="security-danger"
              onClick={() => setConfirmDisable(true)}
              disabled={busy}
              aria-label="Disable two-factor authentication"
            >
              Disable 2FA
            </button>
          </div>
        </div>
      ) : pending ? (
        /* --- Enrollment in progress: show QR + secret, then verify (Req 6.2) --- */
        <div className="security-enroll">
          <p className="security-hint">
            Scan this QR code with Google Authenticator (or a similar app), or
            enter the secret manually. Then enter the 6-digit code to finish.
          </p>

          {pending.qr && (
            <img
              className="security-qr"
              src={pending.qr}
              alt="QR code for setting up two-factor authentication in your authenticator app"
              width="180"
              height="180"
            />
          )}

          {pending.secret && (
            <div className="security-secret">
              <span className="security-secret-label">Setup key</span>
              <code>{pending.secret}</code>
            </div>
          )}

          <form onSubmit={handleActivate} className="security-verify">
            <label htmlFor="totp-code">6-digit code</label>
            <input
              id="totp-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              aria-describedby={error ? 'totp-error' : undefined}
              aria-invalid={error ? 'true' : undefined}
            />
            {error && <span id="totp-error" className="security-error" role="alert">{error}</span>}
            <div className="security-actions">
              <button type="submit" className="security-primary" disabled={busy} aria-label="Verify and activate two-factor authentication">
                {busy ? 'Verifying…' : 'Verify & activate'}
              </button>
              <button type="button" className="security-secondary" onClick={handleCancelEnroll} disabled={busy}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : (
        /* --- No factor: offer to enroll (Req 6.5) --- */
        <div className="security-enroll">
          {recoveryPanel}
          <button
            type="button"
            className="security-primary"
            onClick={handleEnroll}
            disabled={busy}
            aria-label="Enable two-factor authentication"
          >
            {busy ? 'Starting…' : 'Enable two-factor authentication'}
          </button>
        </div>
      )}

      <ConfirmModal
        open={confirmDisable}
        title="Disable two-factor authentication?"
        message="Your account will no longer require a code at login. You can re-enable it at any time."
        onConfirm={handleDisableConfirmed}
        onCancel={() => setConfirmDisable(false)}
      />
    </section>
  )
}
