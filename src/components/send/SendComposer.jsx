import { useEffect, useRef, useState } from 'react'
import { IconSearch, IconUpload } from '../ui/Icons'
import { toast } from '../ui/toastStore'
import FileCard from '../ui/FileCard'
import { uploadFile, SizeError } from '../../lib/uploadFile'
import { classifyFile, validateFile, humanSize } from '../../lib/fileType'

// Unique id for the hidden file input — avoids collisions if composer is
// ever rendered more than once.
const FILE_INPUT_ID = 'send-composer-file-input'

const isUrl = (text) => /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}([/?#].*)?$/i.test(text)

// Broadened picker scope: images, audio, and common document types. Selections
// are still gated by `validateFile` in the pick handler, so the accept list is
// only a first-pass filter for the native dialog.
const ACCEPT = 'image/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip'

export default function SendComposer({ onClose, searchUsers, sendTo, sending, userId, contacts, addContact, removeContact }) {
  const [content, setContent] = useState('')
  const [attachment, setAttachment] = useState(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [selectedUser, setSelectedUser] = useState(null)
  const [searching, setSearching] = useState(false)
  const searchTimer = useRef(null)

  // Close on Escape key — safe on all platforms
  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  const handleSearch = (value) => {
    setQuery(value)
    setSelectedUser(null)
    window.clearTimeout(searchTimer.current)

    if (value.length < 2) { setResults([]); return }

    setSearching(true)
    searchTimer.current = window.setTimeout(async () => {
      const users = await searchUsers(value)
      setResults(users)
      setSearching(false)
    }, 300)
  }

  const clearAttachment = () => {
    setAttachment((prev) => {
      if (prev?.preview) URL.revokeObjectURL(prev.preview)
      return null
    })
  }

  // Gate the selection on `validateFile` BEFORE upload. On rejection we toast
  // and return, retaining composer state (content/recipient are untouched).
  const handleFilePick = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    const check = validateFile({ type: file.type, size: file.size })
    if (!check.ok) {
      const message =
        check.reason === 'too_large'
          ? `Too large — max ${humanSize(check.limit)}`
          : 'File is empty'
      toast(message, 'error')
      return
    }

    const kind = classifyFile(file.type)
    if (attachment?.preview) URL.revokeObjectURL(attachment.preview)
    setAttachment({
      file,
      kind,
      preview: kind === 'image' ? URL.createObjectURL(file) : null,
    })
  }

  const selectUser = (u) => {
    setSelectedUser(u)
    setQuery(`@${u.username}`)
    setResults([])
  }

  const handleSend = async () => {
    if (!selectedUser) { toast('Select a recipient', 'error'); return }
    if (!content.trim() && !attachment) { toast('Add content to send', 'error'); return }

    let type = 'text'
    let finalContent = content.trim()
    let fileData = null

    if (attachment) {
      type = attachment.kind
      try {
        // Shared Upload_Service handles the size gate, resource routing and
        // response normalization into an UploadDescriptor.
        fileData = await uploadFile(attachment.file, { userId })
        finalContent = null
      } catch (err) {
        // SizeError carries its own human message; other failures fall back to
        // a generic message. In both cases the composer stays open.
        const message = err instanceof SizeError ? err.message : 'Upload failed — check your connection'
        toast(message, 'error')
        return
      }
    } else if (isUrl(finalContent)) {
      type = 'link'
    }

    const success = await sendTo(selectedUser.id, type, finalContent, fileData)
    if (success) onClose()
  }

  const isContact = (id) => contacts?.some((c) => c.id === id)

  return (
    // NOTE: overlay click-to-close intentionally removed. On Android Chrome,
    // when the native file picker (bottom sheet) closes and returns focus to
    // the page, the browser fires a synthetic click event on the document.
    // If the overlay has onClick={onClose} it triggers and dismisses the
    // modal before the file is processed. Close is handled by the × button
    // and Escape key above.
    <div className="confirm-overlay">
      <div className="send-composer">
        <div className="send-header">
          <h3>Send to</h3>
          <button className="send-close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Content input */}
        <div className="send-content-area">
          {attachment ? (
            attachment.kind === 'image' ? (
              <div className="send-image-preview">
                <img src={attachment.preview} alt="To send" />
                <button onClick={clearAttachment} className="send-remove-image">Remove</button>
              </div>
            ) : (
              <div className="send-file-preview">
                <FileCard kind={attachment.kind} name={attachment.file.name} size={attachment.file.size} />
                <button onClick={clearAttachment} className="send-remove-image">Remove</button>
              </div>
            )
          ) : (
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onPaste={(e) => e.stopPropagation()}
              placeholder="Paste text, link, or attach a file..."
              rows={3}
              maxLength={10000}
            />
          )}
          {!attachment && (
            // Use <label htmlFor> instead of a button with onClick(.click()).
            // On Android Chrome, programmatic .click() on a file input fires a
            // synthetic document-level click when the picker closes, which hits
            // the overlay and dismisses the modal. A native label association
            // opens the picker without any JS click call.
            <label htmlFor={FILE_INPUT_ID} className="send-attach" style={{ cursor: 'pointer' }}>
              <IconUpload width="14" height="14" /> Attach
            </label>
          )}
          <input
            id={FILE_INPUT_ID}
            type="file"
            accept={ACCEPT}
            onChange={handleFilePick}
            hidden
            aria-hidden="true"
          />
        </div>

        {/* Contacts (quick pick) */}
        {contacts && contacts.length > 0 && !selectedUser && !query && (
          <div className="send-contacts">
            <span className="send-contacts-label">Contacts</span>
            <div className="send-contacts-list">
              {contacts.map((c) => (
                <button key={c.id} className="send-contact-chip" onClick={() => selectUser(c)}>
                  <span className="send-status-dot" data-status={c.presence?.status} />
                  @{c.username}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Recipient search */}
        <div className="send-recipient">
          <div className="send-search-box">
            <IconSearch width="14" height="14" />
            <input
              value={query}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search @username..."
            />
          </div>

          {selectedUser && (
            <div className="send-selected">
              <span className="send-status-dot" data-status={selectedUser.presence?.status} />
              <strong>{selectedUser.display_name}</strong>
              <span>@{selectedUser.username}</span>
              <span className="send-device">{selectedUser.presence?.status === 'online' ? selectedUser.presence.device : 'offline'}</span>
              {!isContact(selectedUser.id) && (
                <button className="send-add-contact" onClick={() => addContact(selectedUser)}>+ Save</button>
              )}
              {isContact(selectedUser.id) && (
                <button className="send-remove-contact" onClick={() => removeContact(selectedUser.id)}>Remove</button>
              )}
            </div>
          )}

          {!selectedUser && results.length > 0 && (
            <div className="send-results">
              {results.map((u) => (
                <button key={u.id} className="send-result-item" onClick={() => selectUser(u)}>
                  <span className="send-status-dot" data-status={u.presence?.status} />
                  <div>
                    <strong>{u.display_name}</strong>
                    <span>@{u.username}</span>
                  </div>
                  <span className="send-device">{u.presence?.status === 'online' ? u.presence.device : 'offline'}</span>
                </button>
              ))}
            </div>
          )}

          {searching && <p className="send-searching">Searching...</p>}
        </div>

        <button
          className="send-button"
          onClick={handleSend}
          disabled={sending || (!content.trim() && !attachment) || !selectedUser}
        >
          {sending ? 'Sending...' : 'Send'}
        </button>
      </div>
    </div>
  )
}
