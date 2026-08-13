import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useClips } from '../hooks/useClips'
import PasteZone from '../components/clips/PasteZone'
import './Dashboard.css'

const formatDate = (value) =>
  new Intl.DateTimeFormat('en', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))

const getInitials = (email = '') => email.slice(0, 2).toUpperCase()

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

  const filteredClips = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    return clips.filter((clip) => {
      const matchesType = filter === 'all' || clip.type === filter
      const matchesQuery =
        !normalizedQuery ||
        clip.content?.toLowerCase().includes(normalizedQuery) ||
        clip.metadata?.mime?.toLowerCase().includes(normalizedQuery)

      return matchesType && matchesQuery
    })
  }, [clips, filter, query])

  const copyClip = async (clip) => {
    if (clip.type === 'image' && clip.url) {
      const response = await fetch(clip.url)
      const blob = await response.blob()
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob }),
      ])
      return
    }

    await navigator.clipboard.writeText(clip.content ?? '')
  }

  const downloadClip = async (clip) => {
    if (!clip.url) return

    const response = await fetch(clip.url)
    const blob = await response.blob()
    const objectUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = objectUrl
    link.download = clip.file_path?.split('/').pop() || 'clipvault-file'
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(objectUrl)
  }

  const openLink = (content) => {
    const url = /^https?:\/\//i.test(content) ? content : `https://${content}`
    window.open(url, '_blank', 'noopener,noreferrer')
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
          <strong>Mobile:</strong> use share or upload to save screenshots and images
        </div>
      </div>
    </div>
  </div>

  <div className="capture-stats">
    <strong>{clips.length}</strong>
    <span>saved clips</span>
  </div>

  <div className="shortcut-hint">
    <kbd>Ctrl</kbd><span>+</span><kbd>V</kbd>
  </div>

  <PasteZone onText={saveText} onImage={saveImage} />
  {saving && <div className="saving-label">Encrypting and saving…</div>}
</section>
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
                onChange={(event) => setQuery(event.target.value)}
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
                    <img src={clip.url} alt="Saved clip" className="image-preview" />
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
                    {clip.type === 'link' && <button onClick={() => openLink(clip.content)}>Open</button>}
                    {clip.type === 'image' && <button onClick={() => downloadClip(clip)}>Download</button>}
                    <button className="delete-action" onClick={() => removeClip(clip)}>Delete</button>
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
    </main>
  )
}