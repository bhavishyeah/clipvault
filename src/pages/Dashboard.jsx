import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useClips } from '../hooks/useClips'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import { useTheme } from '../hooks/useTheme'
import PasteZone from '../components/clips/PasteZone'
import MobilePasteBox from '../components/clips/MobilePasteBox'
import ImageUpload from '../components/clips/ImageUpload'
import SortableClipGrid from '../components/clips/SortableClipGrid'
import ToastContainer from '../components/ui/Toast'
import { toast } from '../components/ui/toastStore'
import ConfirmModal from '../components/ui/ConfirmModal'
import EditModal from '../components/ui/EditModal'
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

const getFaviconUrl = (url) => {
  try {
    const domain = url?.replace(/^https?:\/\//, '').split('/')[0]
    if (!domain) return null
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`
  } catch {
    return null
  }
}

// Calculate storage usage from clip metadata
const calculateStorageUsage = (clips) => {
  let totalBytes = 0
  let imageCount = 0
  clips.forEach((clip) => {
    if (clip.metadata?.bytes) {
      totalBytes += clip.metadata.bytes
      imageCount++
    }
  })
  return { totalBytes, imageCount }
}

const formatBytes = (bytes) => {
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function Dashboard({ user }) {
  const {
    clips,
    loading,
    saving,
    uploadProgress,
    saveText,
    saveImage,
    removeClip,
    togglePin,
    editClip,
    setExpiration,
    reorderPins,
  } = useClips(user)

  const { theme, toggleTheme } = useTheme()

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [confirmTarget, setConfirmTarget] = useState(null)
  const [editTarget, setEditTarget] = useState(null)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [bulkMode, setBulkMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [bulkConfirm, setBulkConfirm] = useState(false)
  const searchTimer = useRef(null)
  const searchInputRef = useRef(null)
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const shareHandled = useRef(false)

  // --- Keyboard shortcuts ---
  useKeyboardShortcuts({
    searchRef: searchInputRef,
    onEscape: () => {
      setQuery('')
      setDebouncedQuery('')
      setShowUserMenu(false)
      setConfirmTarget(null)
      setEditTarget(null)
      if (bulkMode) {
        setBulkMode(false)
        setSelectedIds(new Set())
      }
    },
  })

  // --- Close dropdown on outside click ---
  useEffect(() => {
    if (!showUserMenu) return
    const handleClick = (e) => {
      if (!e.target.closest('.user-menu')) setShowUserMenu(false)
    }
    window.addEventListener('click', handleClick)
    return () => window.removeEventListener('click', handleClick)
  }, [showUserMenu])

  // --- Handle Android share target ---
  useEffect(() => {
    if (shareHandled.current) return
    shareHandled.current = true

    const params = new URLSearchParams(window.location.search)
    const sharedText = params.get('text')
    const sharedUrl = params.get('url')
    const sharedTitle = params.get('title')

    const content = sharedUrl || sharedText || sharedTitle
    if (content) {
      window.setTimeout(() => {
        saveText(content)
        toast('Shared content saved')
      }, 500)
      window.history.replaceState({}, '', '/')
    }
  }, [saveText])

  // Debounced search
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

  const storageUsage = useMemo(() => calculateStorageUsage(clips), [clips])

  // --- Clipboard actions ---
  const copyClip = useCallback(async (clip) => {
    try {
      if (clip.type === 'image' && clip.url) {
        if (!navigator.clipboard?.write) {
          toast('Image copy not supported in this browser', 'error')
          return
        }
        const response = await fetch(clip.url)
        const blob = await response.blob()
        await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
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

  // --- Delete ---
  const handleDeleteClick = (clip) => setConfirmTarget(clip)
  const confirmDelete = () => {
    if (confirmTarget) { removeClip(confirmTarget); setConfirmTarget(null) }
  }

  // --- Edit ---
  const handleEditClick = (clip) => {
    if (clip.type === 'image') return
    setEditTarget(clip)
  }

  // --- Expiration ---
  const handleSetExpiry = (clip, days) => {
    if (days === null) { setExpiration(clip, null) }
    else {
      const date = new Date()
      date.setDate(date.getDate() + days)
      setExpiration(clip, date.toISOString())
    }
  }

  // --- Bulk actions ---
  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAll = () => {
    setSelectedIds(new Set(filteredClips.map((c) => c.id)))
  }

  const bulkDelete = () => {
    selectedIds.forEach((id) => {
      const clip = clips.find((c) => c.id === id)
      if (clip) removeClip(clip)
    })
    setSelectedIds(new Set())
    setBulkMode(false)
    setBulkConfirm(false)
  }

  const exportVault = () => {
    const exportData = clips.map((clip) => ({
      type: clip.type,
      content: clip.content || null,
      url: clip.url || null,
      is_pinned: clip.is_pinned,
      created_at: clip.created_at,
      expires_at: clip.expires_at,
      metadata: clip.metadata,
    }))

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `clipvault-export-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    toast('Vault exported')
  }

  // --- Auth ---
  const signOutAllDevices = async () => {
    const { error } = await supabase.auth.signOut({ scope: 'global' })
    if (error) toast('Failed to sign out from all devices', 'error')
    else toast('Signed out from all devices')
    setShowUserMenu(false)
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setShowUserMenu(false)
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
            <button
              className="theme-toggle"
              onClick={toggleTheme}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              {theme === 'dark' ? '☀' : '◗'}
            </button>
            <div className="sync-status">
              <span className="status-dot" />
              Synced
            </div>
            <div className="user-menu">
              <div className="avatar">{getInitials(user.email)}</div>
              <span className="user-email">{user.email}</span>
              <button
                className="icon-button"
                title="Account menu"
                onClick={(e) => { e.stopPropagation(); setShowUserMenu(!showUserMenu) }}
              >
                ⋮
              </button>

              {showUserMenu && (
                <div className="user-dropdown">
                  <div className="dropdown-storage">
                    <span>Storage: {formatBytes(storageUsage.totalBytes)}</span>
                    <span>{storageUsage.imageCount} images</span>
                  </div>
                  <button onClick={exportVault}>Export vault (JSON)</button>
                  <button onClick={signOut}>Sign out</button>
                  <button onClick={signOutAllDevices}>Sign out all devices</button>
                </div>
              )}
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

          {saving && (
            <div className="saving-label">
              {uploadProgress > 0 ? `Uploading… ${uploadProgress}%` : 'Saving…'}
            </div>
          )}

          <MobilePasteBox onSave={saveText} onImage={saveImage} saving={saving} />
          <PasteZone onText={saveText} onImage={saveImage} />
        </section>

        {saving && uploadProgress > 0 && (
          <div className="upload-progress-bar">
            <div className="upload-progress-fill" style={{ width: `${uploadProgress}%` }} />
          </div>
        )}

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
                ref={searchInputRef}
                value={query}
                onChange={handleSearchChange}
                placeholder="Search your vault… (Ctrl+K)"
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
            <button
              className={`bulk-toggle ${bulkMode ? 'active' : ''}`}
              onClick={() => { setBulkMode(!bulkMode); setSelectedIds(new Set()) }}
              title="Bulk select"
            >
              ☐
            </button>
          </div>
        </section>

        {/* Bulk action bar */}
        {bulkMode && selectedIds.size > 0 && (
          <div className="bulk-bar">
            <span>{selectedIds.size} selected</span>
            <button onClick={selectAll}>Select all</button>
            <button className="bulk-delete" onClick={() => setBulkConfirm(true)}>Delete selected</button>
          </div>
        )}

        {loading ? (
          <div className="empty-state"><div className="loader" />Loading your vault…</div>
        ) : filteredClips.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">◌</div>
            <h3>{query || filter !== 'all' ? 'No matching clips' : 'Your vault is empty'}</h3>
            <p>{query || filter !== 'all' ? 'Try another search or filter.' : 'Your next saved idea will appear here.'}</p>
          </div>
        ) : (
          <SortableClipGrid
            pinnedClips={filteredClips.filter((c) => c.is_pinned)}
            unpinnedClips={filteredClips.filter((c) => !c.is_pinned)}
            onReorder={reorderPins}
            renderClip={(clip, isPinned, dragListeners) => (
              <article
                className={`clip-card clip-${clip.type} ${selectedIds.has(clip.id) ? 'selected' : ''}`}
                key={clip.id}
                onClick={bulkMode ? () => toggleSelect(clip.id) : undefined}
              >
                <div className="clip-card-top">
                  {bulkMode && (
                    <span className={`bulk-checkbox ${selectedIds.has(clip.id) ? 'checked' : ''}`}>
                      {selectedIds.has(clip.id) ? '✓' : ''}
                    </span>
                  )}
                  {isPinned && !bulkMode && (
                    <button className="drag-handle" title="Drag to reorder" {...dragListeners}>⠿</button>
                  )}
                  <span className="type-pill">
                    <span className="type-symbol">{clip.type === 'image' ? '▧' : clip.type === 'link' ? '↗' : '≡'}</span>
                    {clip.type}
                  </span>
                  <div className="clip-card-top-actions">
                    {clip.expires_at && (
                      <span className="expiry-badge" title={`Expires ${formatDate(clip.expires_at)}`}>⏱</span>
                    )}
                    <button
                      className={`pin-button ${clip.is_pinned ? 'pinned' : ''}`}
                      title={clip.is_pinned ? 'Unpin clip' : 'Pin clip'}
                      onClick={(e) => { e.stopPropagation(); togglePin(clip) }}
                    >
                      {clip.is_pinned ? '★' : '☆'}
                    </button>
                  </div>
                </div>

                {clip.type === 'image' ? (
                  <div className="image-preview-wrap">
                    <img src={clip.url} alt="Saved clip" className="image-preview" loading="lazy" />
                  </div>
                ) : clip.type === 'link' ? (
                  <div className="link-preview">
                    <img src={getFaviconUrl(clip.content)} alt="" className="link-favicon" width="16" height="16" loading="lazy" />
                    <div className="link-preview-text">
                      <p className="clip-content">{clip.content}</p>
                      <div className="link-domain">{clip.content?.replace(/^https?:\/\//, '').split('/')[0]}</div>
                    </div>
                  </div>
                ) : (
                  <p className="clip-content">{clip.content}</p>
                )}

                {!bulkMode && (
                  <div className="clip-card-bottom">
                    <time>{formatDate(clip.created_at)}</time>
                    <div className="clip-actions">
                      <button onClick={() => copyClip(clip)}>Copy</button>
                      {clip.type !== 'image' && <button onClick={() => handleEditClick(clip)}>Edit</button>}
                      {clip.type === 'link' && <button onClick={() => openLink(clip.content)}>Open</button>}
                      {clip.type === 'image' && <button onClick={() => downloadClip(clip)}>Download</button>}
                      <button
                        className="expiry-action"
                        onClick={() => handleSetExpiry(clip, clip.expires_at ? null : 7)}
                        title={clip.expires_at ? 'Remove expiry' : 'Expire in 7 days'}
                      >
                        {clip.expires_at ? '∞' : '⏱'}
                      </button>
                      <button className="delete-action" onClick={() => handleDeleteClick(clip)}>Delete</button>
                    </div>
                  </div>
                )}
              </article>
            )}
          />
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

      <ConfirmModal
        open={bulkConfirm}
        title={`Delete ${selectedIds.size} clips?`}
        message="All selected clips will be permanently removed. This cannot be undone."
        onConfirm={bulkDelete}
        onCancel={() => setBulkConfirm(false)}
      />

      <EditModal
        open={!!editTarget}
        clip={editTarget}
        onSave={editClip}
        onCancel={() => setEditTarget(null)}
      />
    </main>
  )
}
