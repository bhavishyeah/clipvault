import { useEffect, useState } from 'react'
import { setToastHandler, clearToastHandler } from './toastStore'

export default function ToastContainer() {
  const [toasts, setToasts] = useState([])

  useEffect(() => {
    setToastHandler((t) => setToasts((prev) => [...prev.slice(-4), t])) // Max 5 toasts visible
    return () => clearToastHandler()
  }, [])

  const dismiss = (id) => setToasts((prev) => prev.filter((t) => t.id !== id))

  return (
    <div className="toast-container" aria-live="polite">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDone={() => dismiss(t.id)} />
      ))}
    </div>
  )
}

function ToastItem({ toast: t, onDone }) {
  const [exiting, setExiting] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setExiting(true), 2800)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (exiting) {
      const timer = window.setTimeout(onDone, 300)
      return () => window.clearTimeout(timer)
    }
  }, [exiting, onDone])

  return (
    <div className={`toast-item toast-${t.type} ${exiting ? 'toast-exit' : ''}`}>
      <span className="toast-icon">
        {t.type === 'success' ? '✓' : t.type === 'error' ? '✕' : 'ℹ'}
      </span>
      <span className="toast-message">{t.message}</span>
    </div>
  )
}
