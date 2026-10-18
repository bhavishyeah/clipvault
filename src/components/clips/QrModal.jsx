import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { chooseQrValue } from '../../lib/qrTarget'
import { toast } from '../ui/toastStore'
import { IconCopy, IconCheck } from '../ui/Icons'

/**
 * QrModal — render a scannable QR code for a clip (Requirement 3).
 *
 * The scanning device is usually signed out, so `chooseQrValue` decides what to
 * encode: an existing public share URL, short raw text/link content, or — for
 * image/file/audio clips and oversized content — a signal that a share must be
 * created first. When kind is 'needs-share' we offer to create one (reusing
 * `useShares.createShare`) and then encode the returned URL.
 *
 * Accessibility: renders a labelled dialog, moves focus in on open, traps focus
 * within the modal, and closes on Escape or overlay click. Uses the bundled
 * `qrcode` dependency (Requirement 3.6) — no new QR library.
 *
 * @param {{
 *   open: boolean,
 *   clip: { id: string, type?: string, content?: string|null }|null,
 *   activeShare: { token?: string, url?: string }|null,
 *   onCreateShare: (clip: object) => Promise<{ token, url }|null>,
 *   creatingShare?: boolean,
 *   onClose: () => void,
 * }} props
 */
export default function QrModal({
  open,
  clip,
  activeShare,
  onCreateShare,
  creatingShare = false,
  onClose,
}) {
  if (!open || !clip) return null
  return (
    <QrModalInner
      clip={clip}
      activeShare={activeShare}
      onCreateShare={onCreateShare}
      creatingShare={creatingShare}
      onClose={onClose}
    />
  )
}

function QrModalInner({ clip, activeShare, onCreateShare, creatingShare, onClose }) {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  // The share created within the modal (kind 'needs-share' flow). Once set, it
  // supersedes the incoming activeShare so we encode the freshly-made URL.
  const [createdShare, setCreatedShare] = useState(null)
  const [qrDataUrl, setQrDataUrl] = useState(null)
  const [qrError, setQrError] = useState(false)
  const [copied, setCopied] = useState(false)

  const dialogRef = useRef(null)
  const closeButtonRef = useRef(null)
  const previouslyFocused = useRef(null)

  // Decide what to encode. A share (incoming or just-created) always wins.
  const target = useMemo(
    () => chooseQrValue(clip, createdShare || activeShare, { origin }),
    [clip, createdShare, activeShare, origin]
  )

  const hasValue = target.kind !== 'needs-share' && !!target.value

  // Render the QR whenever the encoded value changes. Nothing to render for the
  // 'needs-share' state, so the effect simply no-ops there (the needs-share
  // branch of the JSX is shown instead of the QR frame).
  useEffect(() => {
    if (!hasValue) return undefined
    let cancelled = false
    QRCode.toDataURL(target.value, {
      width: 240,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    })
      .then((dataUrl) => {
        if (!cancelled) {
          setQrDataUrl(dataUrl)
          setQrError(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQrDataUrl(null)
          setQrError(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [hasValue, target.value])

  // Focus management: remember the trigger, move focus in, restore on close.
  useEffect(() => {
    previouslyFocused.current = document.activeElement
    closeButtonRef.current?.focus()
    return () => {
      if (previouslyFocused.current instanceof HTMLElement) {
        previouslyFocused.current.focus()
      }
    }
  }, [])

  // Escape to close + a simple focus trap over the dialog's focusables.
  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const focusables = dialogRef.current?.querySelectorAll(
        'button, [href], input, textarea, [tabindex]:not([tabindex="-1"])'
      )
      if (!focusables || focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    },
    [onClose]
  )

  const handleCopy = useCallback(async () => {
    if (!target.value) return
    try {
      await navigator.clipboard.writeText(target.value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      toast('Could not copy', 'error')
    }
  }, [target.value])

  const handleCreateShare = useCallback(async () => {
    const created = await onCreateShare(clip)
    if (created) {
      setCreatedShare(created)
    }
  }, [onCreateShare, clip])

  return (
    <div className="confirm-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        className="qr-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="qr-modal-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="qr-modal-header">
          <h3 id="qr-modal-title">Scan to open</h3>
          <button
            ref={closeButtonRef}
            className="qr-modal-close"
            onClick={onClose}
            aria-label="Close QR code"
          >
            ×
          </button>
        </div>

        {target.kind === 'needs-share' ? (
          <div className="qr-needs-share">
            <p>
              This clip can&apos;t be scanned directly. Create a public share
              link and its QR code will appear here.
            </p>
            <button
              className="qr-create-share"
              onClick={handleCreateShare}
              disabled={creatingShare}
            >
              {creatingShare ? 'Creating…' : 'Create share link'}
            </button>
          </div>
        ) : (
          <>
            <div className="qr-code-frame">
              {qrError ? (
                <p className="qr-error">Couldn&apos;t generate a QR code.</p>
              ) : qrDataUrl ? (
                <img src={qrDataUrl} alt="QR code" width={240} height={240} />
              ) : (
                <p className="qr-loading">Generating…</p>
              )}
            </div>

            <span className="qr-value-label">
              {target.kind === 'share' ? 'Share link' : 'Encoded value'}
            </span>
            <div className="qr-value-row">
              <input
                className="qr-value-text"
                type="text"
                readOnly
                value={target.value}
                aria-label="Encoded value"
                onFocus={(e) => e.target.select()}
              />
              <button
                className="qr-value-copy"
                onClick={handleCopy}
                title="Copy value"
                aria-label="Copy encoded value"
              >
                {copied ? <IconCheck /> : <IconCopy />}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
