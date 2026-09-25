import { useEffect, useState } from 'react'
import { shareViewModel } from '../../lib/share'
import FileCard from '../ui/FileCard'
import { IconCopy, IconDownload, IconExternalLink, IconCheck } from '../ui/Icons'
import '../../pages/Dashboard.css'
import './PublicShare.css'

// Public, unauthenticated share page mounted by App.jsx for /s/<token>.
// Fetches the whitelisted clip projection from GET /api/share and renders it
// by kind, offering copy (text/link) or download/open (image/file). Never
// shows any content in the "unavailable" state.

export default function PublicShare({ token }) {
  const [state, setState] = useState('loading') // 'loading' | 'ready' | 'unavailable'
  const [view, setView] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const res = await fetch(`/api/share?token=${encodeURIComponent(token)}`)
        if (cancelled) return
        if (!res.ok) {
          setState('unavailable')
          return
        }
        const data = await res.json()
        if (cancelled) return
        setView(shareViewModel(data))
        setState('ready')
      } catch {
        if (!cancelled) setState('unavailable')
      }
    }

    load()
    return () => { cancelled = true }
  }, [token])

  const copy = async () => {
    if (!view?.content) return
    try {
      await navigator.clipboard.writeText(view.content)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard may be unavailable (permissions); silently ignore.
    }
  }

  return (
    <div className="share-page">
      <header className="share-page-header">
        <a className="share-brand" href="https://clipvault-lilac.vercel.app">VOLT</a>
      </header>

      <main className="share-page-main">
        {state === 'loading' && (
          <div className="share-card share-card-status">
            <div className="app-loader-bar" />
            <p>Loading…</p>
          </div>
        )}

        {state === 'unavailable' && (
          <div className="share-card share-card-status">
            <h1>This link is unavailable</h1>
            <p>It may have expired, been revoked, or never existed.</p>
            <a className="share-cta" href="https://clipvault-lilac.vercel.app">Go to VOLT</a>
          </div>
        )}

        {state === 'ready' && view && (
          <div className="share-card">
            <p className="share-eyebrow">Shared via VOLT</p>

            {view.kind === 'image' && (
              <>
                <div className="share-image-wrap">
                  <img src={view.downloadUrl} alt={view.fileName || 'Shared image'} />
                </div>
                {view.canDownload && (
                  <a className="share-action" href={view.downloadUrl} target="_blank" rel="noopener noreferrer" download>
                    <IconDownload /> Download image
                  </a>
                )}
              </>
            )}

            {view.kind === 'file' && (
              <FileCard kind="file" name={view.fileName} url={view.downloadUrl} />
            )}

            {view.kind === 'link' && (
              <>
                <a className="share-link" href={view.content} target="_blank" rel="noopener noreferrer">
                  {view.content}
                </a>
                <div className="share-actions-row">
                  <button className="share-action" onClick={copy}>
                    {copied ? <IconCheck /> : <IconCopy />} {copied ? 'Copied' : 'Copy'}
                  </button>
                  <a className="share-action" href={view.content} target="_blank" rel="noopener noreferrer">
                    <IconExternalLink /> Open
                  </a>
                </div>
              </>
            )}

            {view.kind === 'text' && (
              <>
                <pre className="share-text">{view.content}</pre>
                {view.canCopy && (
                  <button className="share-action" onClick={copy}>
                    {copied ? <IconCheck /> : <IconCopy />} {copied ? 'Copied' : 'Copy'}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
