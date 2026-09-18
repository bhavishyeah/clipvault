import { useEffect, useRef, useState } from 'react'
import { IconSearch } from '../ui/Icons'

// VOLT — AddMemberModal (Feature 3: group sharing)
//
// A minimal modal for adding an existing app user to a group. It reuses
// `searchUsers` from useDirectSend to look up real VOLT accounts by username /
// display name, and calls `onAdd(user)` (the Dashboard wires useGroups.addMember)
// when a result is chosen. Duplicate / profile-required guards live in the hook.
//
// Props:
//   open        - boolean; renders nothing when false.
//   group       - the group being edited ({ id, name, ... }); shown in the title.
//   onClose     - () => void; cancel / overlay click / Escape.
//   onAdd       - async (user) => void; called with the chosen app user.
//   searchUsers - async (query) => user[]; injected from useDirectSend.

function userLabel(user) {
  if (user.display_name) return user.display_name
  if (user.username) return `@${user.username}`
  return 'Unknown user'
}

export default function AddMemberModal({ open, group, onClose, onAdd, searchUsers }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [adding, setAdding] = useState(false)
  const inputRef = useRef(null)

  // Reset + focus whenever the modal opens (deferred off the effect body).
  useEffect(() => {
    if (!open) return undefined
    const id = requestAnimationFrame(() => {
      setQuery('')
      setResults([])
      setSearching(false)
      setAdding(false)
      inputRef.current?.focus()
    })
    return () => cancelAnimationFrame(id)
  }, [open])

  // Escape closes.
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Debounced search reusing the injected searchUsers.
  useEffect(() => {
    if (!open) return undefined
    const q = query.trim()
    if (!q || !searchUsers) {
      const clear = requestAnimationFrame(() => { setResults([]); setSearching(false) })
      return () => cancelAnimationFrame(clear)
    }

    let cancelled = false
    const start = requestAnimationFrame(() => setSearching(true))
    const handle = setTimeout(async () => {
      try {
        const found = await searchUsers(q)
        if (!cancelled) setResults(found || [])
      } catch (err) {
        if (!cancelled) { setResults([]); console.error('Member search failed:', err?.message) }
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 250)

    return () => {
      cancelled = true
      cancelAnimationFrame(start)
      clearTimeout(handle)
    }
  }, [query, open, searchUsers])

  const handleAdd = async (user) => {
    if (adding) return
    setAdding(true)
    try {
      await onAdd?.(user)
      onClose?.()
    } finally {
      setAdding(false)
    }
  }

  if (!open) return null

  return (
    <div className="confirm-overlay" onClick={() => onClose?.()}>
      <div
        className="group-create-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-member-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="add-member-title">Add member{group?.name ? ` to ${group.name}` : ''}</h3>

        <label className="group-field-label" htmlFor="add-member-search">Search users</label>
        <div className="group-member-search">
          <IconSearch className="group-member-search-icon" aria-hidden="true" />
          <input
            id="add-member-search"
            ref={inputRef}
            type="text"
            className="group-member-search-input"
            value={query}
            placeholder="Search by username"
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {query.trim().length > 0 && (
          <div className="group-member-results" aria-live="polite">
            {searching ? (
              <p className="group-member-hint">Searching…</p>
            ) : results.length === 0 ? (
              <p className="group-member-hint">No matching users.</p>
            ) : (
              <ul className="group-member-result-list">
                {results.map((user) => (
                  <li key={user.id}>
                    <button
                      type="button"
                      className="group-member-result"
                      disabled={adding}
                      onClick={() => handleAdd(user)}
                      aria-label={`Add ${userLabel(user)} to the group`}
                    >
                      <span className="group-member-result-name">{userLabel(user)}</span>
                      {user.username && user.display_name && (
                        <span className="group-member-result-username">@{user.username}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="confirm-actions">
          <button type="button" className="confirm-cancel" onClick={() => onClose?.()}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
