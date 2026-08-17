import { useCallback, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useClips } from '../hooks/useClips'
import PasteZone from '../components/clips/PasteZone'
import MobilePasteBox from '../components/clips/MobilePasteBox'
import ImageUpload from '../components/clips/ImageUpload'
import ToastContainer from '../components/ui/Toast'
import { toast } from '../components/ui/toastStore'
import ConfirmModal from '../components/ui/ConfirmModal'
import './Dashboard.css'

const formatDate = (value) =>
  new Intl.DateTimeFormat('en', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))

const getInitials = (email = '') => {
  if (!email) return '?'
  return email.slice(0, 2).toUpperCase()
}

export default function Dashboard({ user }) {
  const {
    clips,
    loading,
    saving,
    saveText,
    saveImage,
    removeClip,
    togglePin,
  } = useClips(user)

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [confirmTarget, setConfirmTarget] = useState(null)
  const searchTimer = useRef(null)
  const [debouncedQuery, setDebouncedQuery] = useState('')

  // Debounced search for performance
  const handleSearchChange = (e) => {
    const value = e.target.value
    setQuery(value)
    window.clearTimeout(searchTimer.current)
    searchTimer.current = window.setTimeout(() => {
      setDebouncedQuery(value)
    }, 200)
  }

  const filteredClips = useMemo(() => {
    const normalizedQuery = debouncedQuery.trim().toLowerCase()

    return clips.filter((clip) => {
      const matchesType = filter === 'all' || clip.type === filter
      const matchesQuery =
        !normalizedQuery ||
        clip.content?.toLowerCase().includes(normalizedQuery) ||
        clip.metadata?.mime?.toLowerCase().includes(normalizedQuery)

      return matchesType && matchesQuery
    })
  }, [clips, filter, debouncedQuery])

  // --- Clipboard actions with error handling ---

  const copyClip = useCallback(async (clip) => {
    try {
      if (clip.type === 'image' && clip.url) {
        if (!navigator.clipboard?.write) {
          toast('Image copy not supported in this browser', 'error')
          return
        }
        const response = await fetch(clip.url)
        const blob = await response.blob()
        await navigator.clipboard.write([
          new ClipboardItem({ [blob.type]: blob }),
        ])
        toast('Image copied')
        return
      }

      await navigator.clipboard.writeText(clip.content ?? '')
      toast('Copied to clipboard')
    } catch (err) {
      toast('Failed to copy — try clicking inside the page first', 'error')
      console.error('Clipboard error:', err)
    }
  }, [])

  const downloadClip = useCallback(async (clip) => {
    if (!clip.url) return

    try {
      const response = await fetch(clip.url)
      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')

      link.href = objectUrl
      link.download = clip.file_path?.split('/').pop() || `clipvault-${Date.now()}.${clip.metadata?.format || 'png'}`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(objectUrl)
      toast('Download started')
    } catch (err) {
      toast('Download failed', 'error')
      console.error('Download error:', err)
    }
  }, [])

  const openLink = useCallback((content) => {
    const url = /^https?:\/\//i.test(content) ? content : `https://${content}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }, [])

  // --- Delete with confirmation ---

  const handleDeleteClick = (clip) => setConfirmTarget(clip)

  const confirmDelete = () => {
    if (confirmTarget) {
      removeClip(confirmTarget)
      setConfirmTarget(null)
    }
  }

  return (
    <main className="vault-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <div className="vault-container">
        <header className="topbar">
          <div className="brand-lockup">
            <div className="brand-mark">✦</div>
            <div>
              <div className="brand-name">ClipVault</div>
              <div className="brand-caption">Your private digital memory</div>
            </div>
          </div>

          <div className="topbar-actions">
            <div className="sync-status">
              <span className="status-dot" />
              Synced
            </div>
            <div className="user-menu">
              <div className="avatar">{getInitials(user.email)}</div>
              <span className="user-email">{user.email}</span>
              <button
                className="icon-button"
                title="Sign out"
                onClick={() => supabase.auth.signOut()}
              >
                ↗
              </button>
            </div>
          </div>
        </header>

        <section className="welcome-row">
          <div>
            <p className="eyebrow">YOUR PERSONAL VAULT</p>
            <h1>Everything you copy, <span>within reach.</span></h1>
            <p className="welcome-copy">
              Save text, links and screenshots. Find them anywhere, whenever
              you need them.
            </p>
          </div>
          <div className="clip-count">
            <strong>{clips.length}</strong>
            <span>saved clips</span>
          </div>
        </section>

        <section className="capture-card">
          <div className="capture-glow" />
          <div className="capture-content">
            <div className="capture-icon">⌘</div>
            <div>
              <h2>Capture something new</h2>
              <p>Copy anything, then paste it anywhere on this page.</p>
              <div className="capture-hints">
                <div className="desktop-hint">
                  <strong>Laptop:</strong> copy text, then press <kbd>Ctrl</kbd> + <kbd>V</kbd>
                </div>
                <div className="mobile-hint">
                  <strong>Mobile:</strong> use the paste box below to save text and links
                </div>
              </div>
            </div>
          </div>

          <div className="shortcut-hint">
            <kbd>Ctrl</kbd><span>+</span><kbd>V</kbd>
          </div>

          {saving && <div className="saving-label">Saving…</div>}

          <MobilePasteBox onSave={saveText} onImage={saveImage} saving={saving} />
          <PasteZone onText={saveText} onImage={saveImage} />
        </section>

        {/* Desktop image upload zone */}
        <ImageUpload onImage={saveImage} saving={saving} />

        <section className="toolbar">
          <div className="section-title">
            <h2>Your clips</h2>
            <span>{filteredClips.length} items</span>
          </div>
          <div className="toolbar-controls">
            <label className="search-box">
              <span>⌕</span>
              <input
                value={query}
                onChange={handleSearchChange}
                placeholder="Search your vault..."
              />
            </label>
            <div className="filter-tabs">
              {['all', 'text', 'link', 'image'].map((type) => (
                <button
                  key={type}
                  className={filter === type ? 'active' : ''}
                  onClick={() => setFilter(type)}
                >
                  {type === 'all' ? 'All' : type}
                </button>
              ))}
            </div>
          </div>
        </section>

        {loading ? (
          <div className="empty-state"><div className="loader" />Loading your vault…</div>
        ) : filteredClips.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">◌</div>
            <h3>{query || filter !== 'all' ? 'No matching clips' : 'Your vault is empty'}</h3>
            <p>{query || filter !== 'all' ? 'Try another search or filter.' : 'Your next saved idea will appear here.'}</p>
          </div>
        ) : (
          <section className="clip-grid">
            {filteredClips.map((clip) => (
              <article className={`clip-card clip-${clip.type}`} key={clip.id}>
                <div className="clip-card-top">
                  <span className="type-pill">
                    <span className="type-symbol">{clip.type === 'image' ? '▧' : clip.type === 'link' ? '↗' : '≡'}</span>
                    {clip.type}
                  </span>
                  <button
                    className={`pin-button ${clip.is_pinned ? 'pinned' : ''}`}
                    title={clip.is_pinned ? 'Unpin clip' : 'Pin clip'}
                    onClick={() => togglePin(clip)}
                  >
                    {clip.is_pinned ? '★' : '☆'}
                  </button>
                </div>

                {clip.type === 'image' ? (
                  <div className="image-preview-wrap">
                    <img src={clip.url} alt="Saved clip" className="image-preview" loading="lazy" />
                  </div>
                ) : (
                  <>
                    <p className="clip-content">{clip.content}</p>
                    {clip.type === 'link' && <div className="link-domain">{clip.content?.replace(/^https?:\/\//, '').split('/')[0]}</div>}
                  </>
                )}

                <div className="clip-card-bottom">
                  <time>{formatDate(clip.created_at)}</time>
                  <div className="clip-actions">
                    {clip.type !== 'image' && <button onClick={() => copyClip(clip)}>Copy</button>}
                    {clip.type === 'image' && <button onClick={() => copyClip(clip)}>Copy</button>}
                    {clip.type === 'link' && <button onClick={() => openLink(clip.content)}>Open</button>}
                    {clip.type === 'image' && <button onClick={() => downloadClip(clip)}>Download</button>}
                    <button className="delete-action" onClick={() => handleDeleteClick(clip)}>Delete</button>
                  </div>
                </div>
              </article>
            ))}
          </section>
        )}

        <footer className="vault-footer">
          <span>Private by design</span><span>•</span><span>Stored securely in your vault</span>
        </footer>
      </div>

      <ToastContainer />

      <ConfirmModal
        open={!!confirmTarget}
        title="Delete clip?"
        message="This clip will be permanently removed. This cannot be undone."
        onConfirm={confirmDelete}
        onCancel={() => setConfirmTarget(null)}
      />
    </main>
  )
}
