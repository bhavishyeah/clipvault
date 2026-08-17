import { useCallback, useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { supabase } from '../../lib/supabaseClient'

export default function QRLogin({ onSessionReady }) {
  const [qrDataUrl, setQrDataUrl] = useState(null)
  const [token, setToken] = useState(null)
  const [status, setStatus] = useState('generating') // generating, waiting, confirming, error, expired
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

      setToken(data.token)

      // Generate QR code with the token embedded as a URL
      const qrUrl = `${window.location.origin}?qr_token=${data.token}`
      const dataUrl = await QRCode.toDataURL(qrUrl, {
        width: 220,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      })

      if (!mountedRef.current) return
      setQrDataUrl(dataUrl)
      setStatus('waiting')
    } catch (err) {
      if (mountedRef.current) setStatus('error')
      console.error('QR generation failed:', err)
    }
  }, [])

  // Poll for confirmation
  useEffect(() => {
    if (status !== 'waiting' || !token) return

    const poll = async () => {
      try {
        const res = await fetch(`/api/qr-session?token=${token}`)
        const data = await res.json()

        if (!mountedRef.current) return

        if (res.status === 410) {
          setStatus('expired')
          return
        }

        if (data.status === 'confirmed') {
          setStatus('confirming')

          // Use the magic link to sign in
          if (data.action_link) {
            // Extract token_hash from action link and verify OTP
            const url = new URL(data.action_link)
            const tokenHash = url.searchParams.get('token_hash')
            const type = url.searchParams.get('type') || 'magiclink'

            const { error } = await supabase.auth.verifyOtp({
              token_hash: tokenHash,
              type,
            })

            if (error) {
              console.error('OTP verification failed:', error.message)
              setStatus('error')
              return
            }

            // Session is now active — App.jsx onAuthStateChange will handle it
            if (onSessionReady) onSessionReady()
          }
          return
        }
      } catch {
        // Network error — keep polling
      }
    }

    pollRef.current = window.setInterval(poll, 2500)

    return () => {
      window.clearInterval(pollRef.current)
    }
  }, [status, token, onSessionReady])

  // Cleanup on unmount + initial generation
  useEffect(() => {
    mountedRef.current = true

    // Load initial QR on mount (async, no direct setState)
    const init = async () => {
      try {
        const res = await fetch('/api/qr-session', { method: 'POST' })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error)
        if (!mountedRef.current) return

        setToken(data.token)
        const qrUrl = `${window.location.origin}?qr_token=${data.token}`
        const dataUrl = await QRCode.toDataURL(qrUrl, {
          width: 220, margin: 2,
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

    return () => { mountedRef.current = false }
  }, [])

  return (
    <div className="qr-login">
      <h3>Scan to log in</h3>
      <p>Open ClipVault on your phone and scan this code</p>

      <div className="qr-code-wrap">
        {status === 'generating' && <div className="qr-loader" />}
        {status === 'waiting' && qrDataUrl && (
          <img src={qrDataUrl} alt="Login QR Code" width="220" height="220" />
        )}
        {status === 'confirming' && <p className="qr-status">Signing in...</p>}
        {status === 'expired' && (
          <div className="qr-expired">
            <p>QR code expired</p>
            <button onClick={generateQR}>Generate new</button>
          </div>
        )}
        {status === 'error' && (
          <div className="qr-expired">
            <p>Something went wrong</p>
            <button onClick={generateQR}>Try again</button>
          </div>
        )}
      </div>

      {status === 'waiting' && (
        <p className="qr-hint">QR expires in 5 minutes</p>
      )}
    </div>
  )
}
