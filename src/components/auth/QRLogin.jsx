import { useCallback, useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { supabase } from '../../lib/supabaseClient'

export default function QRLogin() {
  const [qrDataUrl, setQrDataUrl] = useState(null)
  const [status, setStatus] = useState('generating') // generating, waiting, signing-in, error, expired
  const tokenRef = useRef(null)
  const pollRef = useRef(null)
  const mountedRef = useRef(true)

  const generateQR = useCallback(async () => {
    setStatus('generating')
    setQrDataUrl(null)

    try {
      const res = await fetch('/api/qr-session', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      if (!mountedRef.current) return

      tokenRef.current = data.token

      const qrUrl = `${window.location.origin}?qr_token=${data.token}`
      const dataUrl = await QRCode.toDataURL(qrUrl, {
        width: 200,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      })

      if (!mountedRef.current) return
      setQrDataUrl(dataUrl)
      setStatus('waiting')
    } catch {
      if (mountedRef.current) setStatus('error')
    }
  }, [])

  // Poll for confirmation
  useEffect(() => {
    if (status !== 'waiting') return

    const poll = async () => {
      if (!tokenRef.current || !mountedRef.current) return

      try {
        const res = await fetch(`/api/qr-session?token=${tokenRef.current}`)

        if (!mountedRef.current) return

        if (res.status === 410) {
          setStatus('expired')
          window.clearInterval(pollRef.current)
          return
        }

        const data = await res.json()

        if (data.status === 'confirmed' && data.email) {
          window.clearInterval(pollRef.current)
          setStatus('signing-in')

          // Sign in with the anonymous user credentials
          // Password is derived from the QR token
          const anonPassword = `anon-${tokenRef.current.slice(0, 32)}`
          await supabase.auth.signInWithPassword({
            email: data.email,
            password: anonPassword,
          })
        }
      } catch {
        // Network error — keep polling
      }
    }

    pollRef.current = window.setInterval(poll, 2500)

    return () => window.clearInterval(pollRef.current)
  }, [status])

  // Initial generation
  useEffect(() => {
    mountedRef.current = true

    const init = async () => {
      try {
        const res = await fetch('/api/qr-session', { method: 'POST' })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error)
        if (!mountedRef.current) return

        tokenRef.current = data.token
        const qrUrl = `${window.location.origin}?qr_token=${data.token}`
        const dataUrl = await QRCode.toDataURL(qrUrl, {
          width: 200, margin: 2,
          color: { dark: '#000000', light: '#ffffff' },
          errorCorrectionLevel: 'M',
        })
        if (!mountedRef.current) return
        setQrDataUrl(dataUrl)
        setStatus('waiting')
      } catch {
        if (mountedRef.current) setStatus('error')
      }
    }

    init()

    return () => {
      mountedRef.current = false
      window.clearInterval(pollRef.current)
    }
  }, [])

  return (
    <div className="qr-login">
      <h3>Quick access</h3>
      <p>Scan with your phone for a temporary session</p>

      <div className="qr-code-wrap">
        {status === 'generating' && <div className="qr-loader" />}
        {status === 'waiting' && qrDataUrl && (
          <img src={qrDataUrl} alt="Login QR Code" width="200" height="200" />
        )}
        {status === 'signing-in' && <p className="qr-status">Signing in...</p>}
        {status === 'expired' && (
          <div className="qr-expired">
            <p>QR expired</p>
            <button onClick={generateQR}>New code</button>
          </div>
        )}
        {status === 'error' && (
          <div className="qr-expired">
            <p>Failed to generate</p>
            <button onClick={generateQR}>Retry</button>
          </div>
        )}
      </div>

      {status === 'waiting' && (
        <p className="qr-hint">No account needed. Expires in 5 min.</p>
      )}
    </div>
  )
}
