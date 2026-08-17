import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { supabase } from '../../lib/supabaseClient'
import { toast } from '../ui/toastStore'

export default function QRScanner({ onClose }) {
  const [scanning, setScanning] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const scannerRef = useRef(null)
  const confirmingRef = useRef(false)

  useEffect(() => {
    let scanner = null

    const handleScan = async (decodedText) => {
      if (confirmingRef.current) return

      let qrToken
      try {
        const url = new URL(decodedText)
        qrToken = url.searchParams.get('qr_token')
      } catch {
        return
      }

      if (!qrToken) return

      confirmingRef.current = true
      setConfirming(true)

      if (scanner?.isScanning) {
        await scanner.stop().catch(() => {})
      }

      try {
        const { data: sessionData } = await supabase.auth.getSession()
        const accessToken = sessionData?.session?.access_token

        if (!accessToken) {
          toast('You must be logged in to scan', 'error')
          onClose()
          return
        }

        const res = await fetch('/api/qr-confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: qrToken, access_token: accessToken }),
        })

        const data = await res.json()

        if (res.ok && data.success) {
          toast('Desktop connected successfully')
        } else {
          toast(data.error || 'Failed to confirm', 'error')
        }
      } catch {
        toast('Connection failed', 'error')
      }

      onClose()
    }

    const startScanner = async () => {
      try {
        scanner = new Html5Qrcode('qr-scanner-container')
        scannerRef.current = scanner

        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 220, height: 220 } },
          handleScan,
          () => {}
        )

        setScanning(true)
      } catch {
        toast('Camera access denied or not available', 'error')
        onClose()
      }
    }

    startScanner()

    return () => {
      if (scanner?.isScanning) {
        scanner.stop().catch(() => {})
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="qr-scanner-overlay">
      <div className="qr-scanner-modal">
        <div className="qr-scanner-header">
          <h3>Scan QR Code</h3>
          <button onClick={onClose} className="qr-scanner-close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div id="qr-scanner-container" className="qr-scanner-view" />

        {confirming && <p className="qr-scanner-status">Connecting...</p>}
        {!scanning && !confirming && <p className="qr-scanner-status">Starting camera...</p>}
      </div>
    </div>
  )
}
