import { useCallback, useEffect, useRef, useState } from 'react'
import { validateGroupName, NAME_MAX } from '../../lib/group'
import { IconSearch, IconCheck, IconTrash } from '../ui/Icons'

// VOLT — GroupCreateModal (Feature 3: group sharing)
//
// A modal for creating a new group. It collects a group name (validated with
// the pure `validateGroupName` gate) and an optional set of members chosen from
// existing app users. Member lookup reuses `searchUsers` from useDirectSend so
// only real VOLT accounts (by username / display name) can be added.
//
// Props:
//   open        - boolean; when false the component renders nothing.
//   onClose     - () => void; called on cancel, overlay click, Escape, or after
//                 a successful create.
//   onCreate    - async (name, members[]) => group | null; the Dashboard wires
//                 useGroups.createGroup here. Called with the trimmed name and
//                 the selected member users. When it resolves truthy the modal
//                 resets its state and closes.
//   searchUsers - async (query) => user[]; the Dashboard wires
//                 useDirectSend.searchUsers here. Returns matching app users
//                 (id, username, display_name, presence, isContact).
//
// The name gate mirrors useGroups.createGroup: submission is disabled while the
// name is invalid so an invalid group is never created (Req 11.1, 12.1, 12.2).

// Stable label for a searched / selected user: prefer display name, then the
// @username, so a user is never rendered blank.
function userLabel(user) {
  if (user.display_name) return user.display_name
  if (user.username) return `@${user.username}`
  return 'Unknown user'
}

export default function GroupCreateModal({ open, onClose, onCreate, searchUsers }) {
  const [name, setName] = useState('')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [selected, setSelected] = useState([])
  const [searching, setSearching] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [touched, setTouched] = useState(false)

  const nameInputRef = useRef(null)

  // Reset all local state whenever the modal transitions to open, and move
  // focus to the name field (basic focus management). State updates are
  // deferred off the synchronous effect body (mirrors the useGroups/useMfa
  // pattern) so they don't trigger cascading renders.
  useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() => {
      setName('')
      setQuery('')
      setResults([])
      setSelected([])
      setSearching(false)
      setSubmitting(false)
      setTouched(false)
      nameInputRef.current?.focus()
    })
    return () => cancelAnimationFrame(id)
  }, [open])

  // Escape closes the modal.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Debounced member search. Reuses the injected `searchUsers` (which itself
  // ignores queries shorter than 2 chars and returns []). Members already
  // selected are filtered out of the result list so they can't be added twice.
  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (!q || !searchUsers) {
      // Clear results off the synchronous effect body.
      const clear = requestAnimationFrame(() => {
        setResults([])
        setSearching(false)
      })
      return () => cancelAnimationFrame(clear)
    }

    let cancelled = false
    // Defer the "searching" flag off the synchronous effect body.
    const start = requestAnimationFrame(() => setSearching(true))
    const handle = setTimeout(async () => {
      try {
        const found = await searchUsers(q)
        if (cancelled) return
        const selectedIds = new Set(selected.map((s) => s.id))
        setResults((found || []).filter((u) => !selectedIds.has(u.id)))
      } catch (err) {
        if (!cancelled) {
          setResults([])
          console.error('Member search failed:', err?.message)
        }
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 250)

    return () => {
      cancelled = true
      cancelAnimationFrame(start)
      clearTimeout(handle)
    }
  }, [query, open, searchUsers, selected])

  // Add a user to the selected list (dedupe by id) and drop them from results.
  const addMember = useCallback((user) => {
    setSelected((prev) => (prev.some((s) => s.id === user.id) ? prev : [...prev, user]))
    setResults((prev) => prev.filter((u) => u.id !== user.id))
  }, [])

  // Remove a previously selected member before creating.
  const removeMember = useCallback((userId) => {
    setSelected((prev) => prev.filter((s) => s.id !== userId))
  }, [])

  const trimmed = name.trim()
  const nameCheck = validateGroupName(name)
  const nameInvalid = !nameCheck.ok
  const showNameError = touched && nameInvalid

  const nameErrorText =
    nameCheck.reason === 'too_long'
      ? `Group name must be ${NAME_MAX} characters or fewer`
      : 'Enter a group name'

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault()
    setTouched(true)
    if (nameInvalid || submitting) return

    setSubmitting(true)
    try {
      const result = await onCreate?.(trimmed, selected)
      // A truthy result (the persisted group) signals success; close + reset.
      if (result) {
        onClose?.()
      }
    } finally {
      setSubmitting(false)
    }
  }, [nameInvalid, submitting, onCreate, trimmed, selected, onClose])

  if (!open) return null

  return (
    <div className="confirm-overlay" onClick={() => onClose?.()}>
      <div
        className="group-create-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="group-create-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="group-create-title">Create group</h3>

        <form onSubmit={handleSubmit}>
          <label className="group-field-label" htmlFor="group-name-input">
            Group name
          </label>
          <input
            id="group-name-input"
            ref={nameInputRef}
            type="text"
            className="group-name-input"
            value={name}
            maxLength={NAME_MAX}
            placeholder="e.g. Design team"
            aria-invalid={showNameError}
            aria-describedby={showNameError ? 'group-name-error' : undefined}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setTouched(true)}
          />
          {showNameError && (
            <p id="group-name-error" className="group-field-error" role="alert">
              {nameErrorText}
            </p>
          )}

          <label className="group-field-label" htmlFor="group-member-search">
            Add members
          </label>
          <div className="group-member-search">
            <IconSearch className="group-member-search-icon" aria-hidden="true" />
            <input
              id="group-member-search"
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
                        onClick={() => addMember(user)}
                        aria-label={`Add ${userLabel(user)} to the group`}
                      >
                        <span className="group-member-result-name">{userLabel(user)}</span>
                        {user.username && user.display_name && (
                          <span className="group-member-result-username">
                            @{user.username}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {selected.length > 0 && (
            <ul className="group-selected-list" aria-label="Selected members">
              {selected.map((user) => (
                <li key={user.id} className="group-selected-chip">
                  <IconCheck aria-hidden="true" />
                  <span className="group-selected-name">{userLabel(user)}</span>
                  <button
                    type="button"
                    className="group-selected-remove"
                    onClick={() => removeMember(user.id)}
                    aria-label={`Remove ${userLabel(user)}`}
                  >
                    <IconTrash />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="confirm-actions">
            <button
              type="button"
              className="confirm-cancel"
              onClick={() => onClose?.()}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="group-create-submit"
              disabled={nameInvalid || submitting}
              aria-disabled={nameInvalid || submitting}
            >
              {submitting ? 'Creating…' : 'Create group'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
