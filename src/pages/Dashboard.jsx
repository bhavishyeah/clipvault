import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useClips } from '../hooks/useClips'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import { useTheme } from '../hooks/useTheme'
import { usePresence } from '../hooks/usePresence'
import { useDirectSend } from '../hooks/useDirectSend'
import { useGroups } from '../hooks/useGroups'
import PasteZone from '../components/clips/PasteZone'
import MobilePasteBox from '../components/clips/MobilePasteBox'
import ImageUpload from '../components/clips/ImageUpload'
import SortableClipGrid from '../components/clips/SortableClipGrid'
import ToastContainer from '../components/ui/Toast'
import { toast } from '../components/ui/toastStore'
import ConfirmModal from '../components/ui/ConfirmModal'
import EditModal from '../components/ui/EditModal'
import ClipBody from '../components/clips/ClipBody'
import SendComposer from '../components/send/SendComposer'
import IncomingTransfers from '../components/send/IncomingTransfers'
import GroupSendPanel from '../components/send/GroupSendPanel'
import GroupCreateModal from '../components/groups/GroupCreateModal'
import MemberList from '../components/groups/MemberList'
import AddMemberModal from '../components/groups/AddMemberModal'
import SecuritySettings from '../components/auth/SecuritySettings'
import {
  IconVault, IconCopy, IconTrash, IconEdit, IconPin, IconPinFilled,
  IconDownload, IconExternalLink, IconSearch, IconImage, IconText, IconLink,
  IconSun, IconMoon, IconLogOut, IconMenu, IconGrip, IconClock,
  IconInfinity, IconCheck, IconClipboard,
} from '../components/ui/Icons'
import { trackEvent } from '../lib/analytics'
import './Dashboard.css'

const formatDate = (value) =>
  new Intl.DateTimeFormat('en', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))

const getInitials = (name = '') => {
  if (!name) return '?'
  const parts = name.trim().split(' ')
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

const calculateStorageUsage = (clips) => {
  let totalBytes = 0
  let imageCount = 0
  clips.forEach((clip) => {
    if (clip.metadata?.bytes) { totalBytes += clip.metadata.bytes; imageCount++ }
  })
  return { totalBytes, imageCount }
}

const formatBytes = (bytes) => {
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Guard against optimistic temporary group ids (e.g. "temp-1789731875105").
// Only real, persisted group ids are valid uuids that can be queried against
// group_members; temp ids would trigger a 400 (Postgres 22P02) on the backend.
const isRealGroupId = (id) => typeof id === 'string' && !id.startsWith('temp-')

// Desktop paste input with char count, auto-focus, duplicate detection
function DesktopPasteInput({ onSave, saving, clips }) {
  const [text, setText] = useState('')
  const textareaRef = useRef(null)

  // Auto-focus on mount
  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const isDuplicate = useMemo(() => {
    const trimmed = text.trim().toLowerCase()
    if (!trimmed) return false
    return clips.some((c) => c.content?.toLowerCase() === trimmed)
  }, [text, clips])

  const handleSubmit = async (e) => {
    e.preventDefault()
    const value = text.trim()
    if (!value || saving) return
    if (isDuplicate) {
      toast('This clip already exists in your vault', 'info')
      return
    }
    await onSave(value)
    setText('')
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      handleSubmit(e)
    }
  }

  return (
    <form className="desktop-input-form" onSubmit={handleSubmit}>
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={(e) => e.stopPropagation()}
        placeholder="Paste or type text, links..."
        rows={3}
        maxLength={10000}
      />
      <div className="desktop-input-footer">
        <span className="desktop-input-hint">
          {isDuplicate ? 'Duplicate detected' : `${text.length}/10000`}
        </span>
        <button type="submit" disabled={!text.trim() || saving}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </form>
  )
}

export default function Dashboard({ user, profile }) {
  const {
    clips, loading, saving, uploadProgress,
    saveText, saveFile, saveImage, removeClip, togglePin, editClip, setExpiration, reorderPins,
  } = useClips(user)

  const { theme, toggleTheme } = useTheme()

  // Track online/offline presence
  usePresence(user)

  // Direct Send
  const { incoming, contacts, sending: directSending, searchUsers, sendTo, addContact, removeContact, saveToVault, dismissTransfer } = useDirectSend(user)
  const [showSendComposer, setShowSendComposer] = useState(false)

  // Groups — send-only distribution lists (no chat/threads/realtime)
  const {
    groups, createGroup, deleteGroup,
    addMember, removeMember, leaveGroup, members: fetchMembers,
    sendToGroup,
  } = useGroups(user)

  // Group send + management UI state
  const [showGroupSend, setShowGroupSend] = useState(false)
  const [showGroupCreate, setShowGroupCreate] = useState(false)
  const [manageGroupId, setManageGroupId] = useState(null)
  const [groupMemberCounts, setGroupMemberCounts] = useState({})
  const [selectedGroupMembers, setSelectedGroupMembers] = useState([])
  const [addMemberTarget, setAddMemberTarget] = useState(null)

  // Security settings modal (Feature 2) — mounts SecuritySettings which owns useMfa
  const [showSecurity, setShowSecurity] = useState(false)

  const isAnonymous = user.user_metadata?.is_anonymous === true
  const [showConvert, setShowConvert] = useState(false)
  const [convertEmail, setConvertEmail] = useState('')
  const [convertPassword, setConvertPassword] = useState('')
  const [convertBusy, setConvertBusy] = useState(false)
  const [convertError, setConvertError] = useState('')

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [sortOrder, setSortOrder] = useState('newest')
  const [editTarget, setEditTarget] = useState(null)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [bulkMode, setBulkMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [bulkConfirm, setBulkConfirm] = useState(false)
  const [undoClip, setUndoClip] = useState(null)
  const undoTimer = useRef(null)
  const searchTimer = useRef(null)
  const searchInputRef = useRef(null)
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const shareHandled = useRef(false)

  useKeyboardShortcuts({
    searchRef: searchInputRef,
    onEscape: () => {
      setQuery(''); setDebouncedQuery(''); setShowUserMenu(false)
      setEditTarget(null)
      if (bulkMode) { setBulkMode(false); setSelectedIds(new Set()) }
    },
  })

  useEffect(() => {
    if (!showUserMenu) return
    const handleClick = (e) => { if (!e.target.closest('.user-menu')) setShowUserMenu(false) }
    window.addEventListener('click', handleClick)
    return () => window.removeEventListener('click', handleClick)
  }, [showUserMenu])

  useEffect(() => {
    if (shareHandled.current) return
    shareHandled.current = true
    const params = new URLSearchParams(window.location.search)
    const content = params.get('url') || params.get('text') || params.get('title')
    if (content) {
      window.setTimeout(() => { saveText(content); toast('Shared content saved') }, 500)
      window.history.replaceState({}, '', '/')
    }
  }, [saveText])

  const handleSearchChange = (e) => {
    const value = e.target.value
    setQuery(value)
    window.clearTimeout(searchTimer.current)
    searchTimer.current = window.setTimeout(() => { setDebouncedQuery(value); if (value.trim()) trackEvent('search') }, 200)
  }

  // Resolve member counts for the user's groups so GroupSendPanel can show a
  // "N members" count and a "Send to N members" button label.
  // useGroups.groups does not carry memberCount, so we build a { groupId: count }
  // map here by asking the hook for each group's members once per group set.
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!groups.length) {
        if (!cancelled) setGroupMemberCounts((prev) => (Object.keys(prev).length ? {} : prev))
        return
      }
      const entries = await Promise.all(
        groups.map(async (g) => {
          if (!isRealGroupId(g.id)) return [g.id, 0]
          const list = await fetchMembers(g.id)
          return [g.id, list.length]
        })
      )
      if (cancelled) return
      setGroupMemberCounts(Object.fromEntries(entries))
    }
    load()
    return () => { cancelled = true }
  }, [groups, fetchMembers])

  // Load the roster for the group currently being managed (for MemberList).
  // Refreshes whenever the managed group changes or membership is edited.
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!manageGroupId || !isRealGroupId(manageGroupId)) {
        if (!cancelled) setSelectedGroupMembers((prev) => (prev.length ? [] : prev))
        return
      }
      const list = await fetchMembers(manageGroupId)
      if (!cancelled) setSelectedGroupMembers(list)
    }
    load()
    return () => { cancelled = true }
  }, [manageGroupId, fetchMembers, groupMemberCounts])

  // Groups augmented with a resolved memberCount for GroupSendPanel.
  const groupsWithCounts = useMemo(
    () => groups.map((g) => ({ ...g, memberCount: groupMemberCounts[g.id] ?? 0 })),
    [groups, groupMemberCounts]
  )

  const manageGroup = useMemo(
    () => groupsWithCounts.find((g) => g.id === manageGroupId) ?? null,
    [groupsWithCounts, manageGroupId]
  )

  const filteredClips = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase()
    let result = clips.filter((clip) => {
      const matchesType = filter === 'all' || clip.type === filter
      const matchesQuery = !q || clip.content?.toLowerCase().includes(q) || clip.metadata?.mime?.toLowerCase().includes(q)
      return matchesType && matchesQuery
    })

    // Sort (pinned always first, then by sortOrder)
    if (sortOrder === 'oldest') {
      result = [...result].sort((a, b) => {
        if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1
        return new Date(a.created_at) - new Date(b.created_at)
      })
    } else if (sortOrder === 'alpha') {
      result = [...result].sort((a, b) => {
        if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1
        return (a.content || '').localeCompare(b.content || '')
      })
    }
    // 'newest' is default from useClips hook

    return result
  }, [clips, filter, debouncedQuery, sortOrder])

  const storageUsage = useMemo(() => calculateStorageUsage(clips), [clips])

  const copyClip = useCallback(async (clip) => {
    try {
      if (clip.type === 'image' && clip.url) {
        if (!navigator.clipboard?.write) { toast('Image copy not supported', 'error'); return }
        const r = await fetch(clip.url)
        const blob = await r.blob()
        await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
        toast('Image copied')
        return
      }
      await navigator.clipboard.writeText(clip.content ?? '')
      toast('Copied to clipboard')
      trackEvent('copy')
    } catch { toast('Failed to copy', 'error') }
  }, [])

  const downloadClip = useCallback(async (clip) => {
    if (!clip.url) return
    try {
      const r = await fetch(clip.url)
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = clip.file_path?.split('/').pop() || `volt-${Date.now()}.${clip.metadata?.format || 'png'}`
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
      toast('Download started')
    } catch { toast('Download failed', 'error') }
  }, [])

  const openLink = useCallback((content) => {
    const url = /^https?:\/\//i.test(content) ? content : `https://${content}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }, [])

  // --- Delete with undo ---
  const handleDeleteClick = (clip) => {
    // Remove from UI immediately
    setUndoClip(clip)
    removeClip(clip)

    // Clear any existing undo timer
    window.clearTimeout(undoTimer.current)
    undoTimer.current = window.setTimeout(() => {
      setUndoClip(null)
    }, 5000)
  }

  const handleUndo = () => {
    if (!undoClip) return
    // Re-save the clip
    if (undoClip.type === 'image') {
      // Can't easily undo image deletion, just inform
      toast('Cannot undo image deletion', 'error')
    } else {
      saveText(undoClip.content)
      toast('Clip restored')
    }
    window.clearTimeout(undoTimer.current)
    setUndoClip(null)
  }

  const handleEditClick = (clip) => { if (clip.type !== 'image') setEditTarget(clip) }

  const handleSetExpiry = (clip, days) => {
    if (days === null) { setExpiration(clip, null) }
    else { const d = new Date(); d.setDate(d.getDate() + days); setExpiration(clip, d.toISOString()) }
  }

  const toggleSelect = (id) => setSelectedIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const selectAll = () => setSelectedIds(new Set(filteredClips.map((c) => c.id)))
  const bulkDelete = () => { selectedIds.forEach((id) => { const c = clips.find((x) => x.id === id); if (c) removeClip(c) }); setSelectedIds(new Set()); setBulkMode(false); setBulkConfirm(false) }

  const exportVault = () => {
    const data = clips.map((c) => ({ type: c.type, content: c.content || null, url: c.url || null, is_pinned: c.is_pinned, created_at: c.created_at, metadata: c.metadata }))
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `volt-export-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
    toast('Vault exported')
  }

  const signOutAll = async () => {
    if (isAnonymous) {
      await fetch('/api/qr-logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id }),
      })
    }
    await supabase.auth.signOut({ scope: 'global' })
    setShowUserMenu(false)
  }

  const deleteAccount = async () => {
    const { data: sessionData } = await supabase.auth.getSession()
    const accessToken = sessionData?.session?.access_token
    if (!accessToken) { toast('Session expired', 'error'); return }

    const res = await fetch('/api/delete-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: user.id, access_token: accessToken }),
    })

    if (res.ok) {
      toast('Account deleted')
      await supabase.auth.signOut()
    } else {
      const data = await res.json()
      toast(data.error || 'Failed to delete account', 'error')
    }
    setShowDeleteConfirm(false)
    setShowUserMenu(false)
  }
  const signOut = async () => {
    if (isAnonymous) {
      // Anonymous: always destroy everything on any sign out
      await fetch('/api/qr-logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id }),
      })
      await supabase.auth.signOut({ scope: 'global' })
    } else {
      await supabase.auth.signOut({ scope: 'local' })
    }
    setShowUserMenu(false)
  }

  const handleConvert = async (e) => {
    e.preventDefault()
    setConvertError('')
    const email = convertEmail.trim().toLowerCase()
    if (!email || convertPassword.length < 8) {
      setConvertError('Enter email and password (8+ chars)')
      return
    }
    setConvertBusy(true)

    const { error } = await supabase.auth.updateUser({
      email,
      password: convertPassword,
      data: { is_anonymous: false },
    })

    if (error) {
      setConvertError(error.message)
    } else {
      toast('Account created! Your clips are now permanent.')
      setShowConvert(false)
    }
    setConvertBusy(false)
  }

  // Refresh the member-count for a single group after membership changes.
  const refreshGroupCount = useCallback(async (groupId) => {
    if (!isRealGroupId(groupId)) return
    const list = await fetchMembers(groupId)
    setGroupMemberCounts((prev) => ({ ...prev, [groupId]: list.length }))
    if (groupId === manageGroupId) setSelectedGroupMembers(list)
  }, [fetchMembers, manageGroupId])

  // Create a group, then add any members chosen in the modal (GroupCreateModal
  // passes (name, members[]); useGroups.createGroup takes only the name, so we
  // add the selected members afterward against the persisted group).
  const handleCreateGroup = useCallback(async (name, membersToAdd = []) => {
    const created = await createGroup(name)
    if (!created) return null
    for (const member of membersToAdd) {
      await addMember(created.id, member)
    }
    await refreshGroupCount(created.id)
    return created
  }, [createGroup, addMember, refreshGroupCount])

  // MemberList add/remove wiring. onAddMember opens an inline search modal;
  // onRemoveMember removes directly and refreshes the roster/counts.
  const handleRemoveMember = useCallback(async (group, userId) => {
    const ok = await removeMember(group.id, userId)
    if (ok) await refreshGroupCount(group.id)
  }, [removeMember, refreshGroupCount])

  const handleAddMemberConfirm = useCallback(async (member) => {
    if (!addMemberTarget) return
    const ok = await addMember(addMemberTarget.id, member)
    if (ok) await refreshGroupCount(addMemberTarget.id)
  }, [addMember, addMemberTarget, refreshGroupCount])

  const handleDeleteGroup = useCallback(async (groupId) => {
    await deleteGroup(groupId)
    if (groupId === manageGroupId) setManageGroupId(null)
    setGroupMemberCounts((prev) => {
      if (!(groupId in prev)) return prev
      const next = { ...prev }; delete next[groupId]; return next
    })
  }, [deleteGroup, manageGroupId])

  const handleLeaveGroup = useCallback(async (groupId) => {
    const ok = await leaveGroup(groupId)
    if (ok && groupId === manageGroupId) setManageGroupId(null)
  }, [leaveGroup, manageGroupId])

  const getTypeIcon = (type) => {
    if (type === 'image') return <IconImage />
    if (type === 'link') return <IconLink />
    return <IconText />
  }

  // Empty state messages per filter
  const getEmptyMessage = () => {
    if (query) return { title: 'No results', desc: 'Try a different search term.' }
    switch (filter) {
      case 'text': return { title: 'No text clips', desc: 'Save some text to see it here.' }
      case 'link': return { title: 'No links saved', desc: 'Paste a URL to save it.' }
      case 'image': return { title: 'No images yet', desc: 'Upload or paste an image.' }
      default: return { title: 'Empty vault', desc: 'Your first clip will appear here.' }
    }
  }

  return (
    <main className="vault-shell">
      <div className="vault-container">
        <header className="topbar">
          <div className="brand-lockup">
            <div className="brand-mark"><IconVault /></div>
            <div>
              <div className="brand-name">VOLT</div>
              <div className="brand-caption">Private clipboard</div>
            </div>
          </div>

          <div className="topbar-actions">
            <button className="theme-toggle" onClick={toggleTheme} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
              {theme === 'dark' ? <IconSun /> : <IconMoon />}
            </button>
            <div className="sync-status"><span className="status-dot" />Synced</div>
            <div className="user-menu">
              <div className="avatar">{getInitials(profile?.display_name || user.email)}</div>
              <span className="user-email">@{profile?.username || 'guest'}</span>
              <button className="icon-button" title="Menu" onClick={(e) => { e.stopPropagation(); setShowUserMenu(!showUserMenu) }}>
                <IconMenu />
              </button>
              {showUserMenu && (
                <div className="user-dropdown">
                  <div className="dropdown-storage">
                    <span>{formatBytes(storageUsage.totalBytes)}</span>
                    <span>{storageUsage.imageCount} images</span>
                  </div>
                  <button onClick={exportVault}>Export vault</button>
                  {!isAnonymous && (
                    <button onClick={() => { setShowSecurity(true); setShowUserMenu(false) }}>Security &amp; 2FA</button>
                  )}
                  <button onClick={signOut}><IconLogOut style={{ marginRight: 8, verticalAlign: 'middle' }} />Sign out</button>
                  <button onClick={signOutAll}>Sign out all devices</button>
                  <button onClick={() => { setShowDeleteConfirm(true); setShowUserMenu(false) }} style={{ color: 'var(--danger)' }}>Delete account</button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Anonymous session banner */}
        {isAnonymous && (
          <div className="anon-banner">
            <span>Temporary session — clips will be deleted on logout</span>
            <button onClick={() => setShowConvert(true)}>Create account to keep clips</button>
          </div>
        )}

        <section className="welcome-row">
          <div className="welcome-left">
            <p className="eyebrow">Your vault</p>
            <h1>Everything you copy,<br /><span>within reach.</span></h1>
            <p className="welcome-copy">Save text, links, images, audio and files. Access them from any device, anytime.</p>
          </div>

          <div className="welcome-right">
            <div className="desktop-paste-box">
              <DesktopPasteInput onSave={saveText} saving={saving} clips={clips} />
            </div>
            <ImageUpload onImage={saveFile} saving={saving} />
          </div>
        </section>

        <PasteZone onText={saveText} onImage={saveImage} />
        <MobilePasteBox onSave={saveText} onImage={saveImage} saving={saving} />

        {/* Send To + Sharing buttons */}
        {!isAnonymous && (
          <div className="share-actions">
            <button className="share-panel-button" onClick={() => setShowSendComposer(true)}>
              Send to @user
            </button>
            <button className="share-panel-button" onClick={() => setShowGroupSend(true)}>
              Send to group
            </button>
          </div>
        )}

        {/* Incoming transfers */}
        <IncomingTransfers transfers={incoming} onSaveToVault={saveToVault} onDismiss={dismissTransfer} />

        {saving && uploadProgress > 0 && (
          <div className="upload-progress-bar"><div className="upload-progress-fill" style={{ width: `${uploadProgress}%` }} /></div>
        )}

        <section className="toolbar">
          <div className="section-title">
            <h2>Clips</h2>
            <span>{filteredClips.length}</span>
          </div>
          <div className="toolbar-controls">
            <label className="search-box">
              <IconSearch />
              <input ref={searchInputRef} value={query} onChange={handleSearchChange} placeholder="Search... (Ctrl+K)" />
            </label>
            <div className="filter-tabs">
              {['all', 'text', 'link', 'image', 'file', 'audio'].map((type) => (
                <button key={type} className={filter === type ? 'active' : ''} onClick={() => setFilter(type)}>
                  {type === 'all' ? 'All' : type}
                </button>
              ))}
            </div>
            <select className="sort-select" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}>
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="alpha">A-Z</option>
            </select>
            <button className={`bulk-toggle ${bulkMode ? 'active' : ''}`} onClick={() => { setBulkMode(!bulkMode); setSelectedIds(new Set()) }} title="Select multiple">
              <IconCheck />
            </button>
          </div>
        </section>

        {bulkMode && selectedIds.size > 0 && (
          <div className="bulk-bar">
            <span>{selectedIds.size} selected</span>
            <button onClick={selectAll}>Select all</button>
            <button className="bulk-delete" onClick={() => setBulkConfirm(true)}>Delete</button>
          </div>
        )}

        {loading ? (
          <div className="empty-state"><div className="loader" />Loading...</div>
        ) : filteredClips.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon"><IconClipboard width="28" height="28" /></div>
            <h3>{getEmptyMessage().title}</h3>
            <p>{getEmptyMessage().desc}</p>
          </div>
        ) : (
          <SortableClipGrid
            pinnedClips={filteredClips.filter((c) => c.is_pinned)}
            unpinnedClips={filteredClips.filter((c) => !c.is_pinned)}
            onReorder={reorderPins}
            renderClip={(clip, isPinned, dragListeners) => (
              <article className={`clip-card clip-${clip.type} ${selectedIds.has(clip.id) ? 'selected' : ''}`} key={clip.id} onClick={bulkMode ? () => toggleSelect(clip.id) : undefined}>
                <div className="clip-card-top">
                  {bulkMode && <span className={`bulk-checkbox ${selectedIds.has(clip.id) ? 'checked' : ''}`}>{selectedIds.has(clip.id) && <IconCheck />}</span>}
                  {isPinned && !bulkMode && <button className="drag-handle" title="Drag to reorder" {...dragListeners}><IconGrip /></button>}
                  <span className="type-pill"><span className="type-symbol">{getTypeIcon(clip.type)}</span>{clip.type}</span>
                  <div className="clip-card-top-actions">
                    {clip.expires_at && <span className="expiry-badge" title={`Expires ${formatDate(clip.expires_at)}`}><IconClock /></span>}
                    <button className={`pin-button ${clip.is_pinned ? 'pinned' : ''}`} title={clip.is_pinned ? 'Unpin' : 'Pin'} onClick={(e) => { e.stopPropagation(); togglePin(clip) }}>
                      {clip.is_pinned ? <IconPinFilled /> : <IconPin />}
                    </button>
                  </div>
                </div>

                <ClipBody clip={clip} />

                {!bulkMode && (
                  <div className="clip-card-bottom">
                    <time>{formatDate(clip.created_at)}</time>
                    <div className="clip-actions">
                      <button onClick={() => copyClip(clip)} title="Copy"><IconCopy /></button>
                      {clip.type !== 'image' && <button onClick={() => handleEditClick(clip)} title="Edit"><IconEdit /></button>}
                      {clip.type === 'link' && <button onClick={() => openLink(clip.content)} title="Open"><IconExternalLink /></button>}
                      {(clip.type === 'image' || clip.type === 'file' || clip.type === 'audio') && <button onClick={() => downloadClip(clip)} title="Download"><IconDownload /></button>}
                      <button className="expiry-action" onClick={() => handleSetExpiry(clip, clip.expires_at ? null : 7)} title={clip.expires_at ? 'Remove expiry' : 'Expire in 7d'}>
                        {clip.expires_at ? <IconInfinity /> : <IconClock />}
                      </button>
                      <button className="delete-action" onClick={() => handleDeleteClick(clip)} title="Delete"><IconTrash /></button>
                    </div>
                  </div>
                )}
              </article>
            )}
          />
        )}

        {/* Undo delete toast */}
        {undoClip && (
          <div className="undo-bar">
            <span>Clip deleted</span>
            <button onClick={handleUndo}>Undo</button>
          </div>
        )}

        <footer className="vault-footer">
          <span>Private by design</span>
        </footer>
      </div>

      <ToastContainer />
      <ConfirmModal open={bulkConfirm} title={`Delete ${selectedIds.size} clips?`} message="All selected clips will be permanently removed." onConfirm={bulkDelete} onCancel={() => setBulkConfirm(false)} />
      <EditModal open={!!editTarget} clip={editTarget} onSave={editClip} onCancel={() => setEditTarget(null)} />

      {/* Convert anonymous to permanent account */}
      {showConvert && (
        <div className="confirm-overlay" onClick={() => setShowConvert(false)}>
          <div className="edit-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Create permanent account</h3>
            <p className="convert-desc">Your clips will be saved permanently.</p>
            <form onSubmit={handleConvert}>
              <label htmlFor="convert-email">Email</label>
              <input id="convert-email" type="email" required placeholder="you@example.com" value={convertEmail} onChange={(e) => setConvertEmail(e.target.value)} className="edit-textarea" style={{ minHeight: 'auto', padding: '10px 12px' }} />
              <label htmlFor="convert-pass">Password</label>
              <input id="convert-pass" type="password" required placeholder="8+ characters" value={convertPassword} onChange={(e) => setConvertPassword(e.target.value)} className="edit-textarea" style={{ minHeight: 'auto', padding: '10px 12px' }} />
              {convertError && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 8 }}>{convertError}</p>}
              <div className="confirm-actions" style={{ marginTop: 16 }}>
                <button type="button" className="confirm-cancel" onClick={() => setShowConvert(false)}>Cancel</button>
                <button type="submit" className="confirm-delete" style={{ background: 'var(--text)' }} disabled={convertBusy}>
                  {convertBusy ? 'Creating...' : 'Create account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete account confirmation */}
      <ConfirmModal
        open={showDeleteConfirm}
        title="Delete your account?"
        message="Your account and username will be deleted."
        onConfirm={deleteAccount}
        onCancel={() => setShowDeleteConfirm(false)}
      />

      {/* Send Composer */}
      {showSendComposer && (
        <SendComposer
          onClose={() => setShowSendComposer(false)}
          searchUsers={searchUsers}
          sendTo={sendTo}
          sending={directSending}
          userId={user.id}
          contacts={contacts}
          addContact={addContact}
          removeContact={removeContact}
        />
      )}

      {/* Security & 2FA settings */}
      {showSecurity && (
        <div className="confirm-overlay" onClick={() => setShowSecurity(false)}>
          <div className="security-modal" onClick={(e) => e.stopPropagation()}>
            <button className="send-close security-modal-close" title="Close" onClick={() => setShowSecurity(false)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            <SecuritySettings user={user} />
          </div>
        </div>
      )}

      {/* Send to group — one-shot fan-out distribution list */}
      {showGroupSend && (
        <GroupSendPanel
          onClose={() => setShowGroupSend(false)}
          groups={groupsWithCounts}
          groupMemberCounts={groupMemberCounts}
          onCreateGroup={() => setShowGroupCreate(true)}
          onManageGroup={(g) => setManageGroupId(g.id)}
          sendToGroup={sendToGroup}
          userId={user.id}
        />
      )}

      {/* Lightweight group management (owner: add/remove/delete; member: leave) */}
      {manageGroup && (
        <div className="confirm-overlay" onClick={() => setManageGroupId(null)}>
          <div className="send-composer" role="dialog" aria-modal="true" aria-labelledby="group-manage-title" onClick={(e) => e.stopPropagation()}>
            <div className="send-header">
              <h3 id="group-manage-title">{manageGroup.name}</h3>
              <button className="send-close" title="Close" onClick={() => setManageGroupId(null)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <MemberList
              group={manageGroup}
              members={selectedGroupMembers}
              currentUserId={user.id}
              onAddMember={(g) => setAddMemberTarget(g)}
              onRemoveMember={handleRemoveMember}
            />

            <div className="group-view-header">
              {manageGroup.isOwner ? (
                <button className="group-danger" onClick={() => handleDeleteGroup(manageGroup.id)}>Delete group</button>
              ) : (
                <button className="group-danger" onClick={() => handleLeaveGroup(manageGroup.id)}>Leave group</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create group */}
      <GroupCreateModal
        open={showGroupCreate}
        onClose={() => setShowGroupCreate(false)}
        onCreate={handleCreateGroup}
        searchUsers={searchUsers}
      />

      {/* Add member to a group (inline search) */}
      <AddMemberModal
        open={!!addMemberTarget}
        group={addMemberTarget}
        onClose={() => setAddMemberTarget(null)}
        onAdd={handleAddMemberConfirm}
        searchUsers={searchUsers}
      />
    </main>
  )
}
