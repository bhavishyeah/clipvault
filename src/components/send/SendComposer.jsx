import { useEffect, useRef, useState } from 'react'
import { IconSearch, IconUpload } from '../ui/Icons'
import { toast } from '../ui/toastStore'
import FileCard from '../ui/FileCard'
import { classifyFile } from '../../lib/fileType'

// Use the original direct-fetch approach that worked on mobile.
// The shared uploadFile() helper introduced validateFile() which silently
// rejects Android files (file.size===0 at pick time). Fetching directly to
// Cloudinary bypasses that gate entirely.
const CLOUDINARY_CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME
const CLOUDINARY_UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET

const ACCEPT = 'image/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip'
const FILE_INPUT_ID = 'send-composer-file-input'

const isUrl = (text) => /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}([/?#].*)?$/i.test(text)

export default function SendComposer({ onClose, searchUsers, sendTo, sending, userId, contacts, addContact, removeContact }) {
  const [content, setContent] = useState('')
  const [attachment, setAttachment] = useState(null) // { file, kind, preview }
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [selectedUser, setSelectedUser] = useState(null)
  const [searching, setSearching] = useState(false)
  const [uploading, setUploading] = useState(false)
  const searchTimer = useRef(null)

  // Close on Escape
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
    if (attachment?.preview) URL.revokeObjectURL(attachment.preview)
    setAttachment(null)
  }

  const handleFilePick = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    const kind = classifyFile(file.type || 'application/octet-stream')
    if (attachment?.preview) URL.revokeObjectURL(attachment.preview)

    // Defer one microtask so post-picker browser click events finish first
    Promise.resolve().then(() => {
      setAttachment({
        file,
        kind,
        // Only create object URL for images with known size
        preview: kind === 'image' && file.size > 0 ? URL.createObjectURL(file) : null,
      })
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
      if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_UPLOAD_PRESET) {
        toast('Upload not configured', 'error')
        return
      }

      setUploading(true)
      try {
        const formData = new FormData()
        formData.append('file', attachment.file)
        formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET)
        formData.append('folder', `volt/${userId}`)

        // Direct fetch — same approach as the original working code
        const res = await fetch(
          `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`,
          { method: 'POST', body: formData }
        )
        const uploaded = await res.json()

        if (!res.ok) {
          toast(`Upload failed: ${uploaded?.error?.message || res.status}`, 'error')
          return
        }

        type = attachment.kind
        fileData = {
          secure_url: uploaded.secure_url,
          name: attachment.file.name || `file-${Date.now()}`,
          bytes: uploaded.bytes ?? attachment.file.size,
          mime: attachment.file.type || 'application/octet-stream',
        }
        finalContent = null
      } catch (err) {
        toast(`Upload failed: ${err.message}`, 'error')
        return
      } finally {
        setUploading(false)
      }
    } else if (isUrl(finalContent)) {
      type = 'link'
    }

    const success = await sendTo(selectedUser.id, type, finalContent, fileData)
    if (success) onClose()
  }

  const isContact = (id) => contacts?.some((c) => c.id === id)
  const isBusy = sending || uploading

  return (
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

        <div className="send-content-area">
          {attachment ? (
            attachment.kind === 'image' && attachment.preview ? (
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
          disabled={isBusy || (!content.trim() && !attachment) || !selectedUser}
        >
          {uploading ? 'Uploading...' : sending ? 'Sending...' : 'Send'}
        </button>
      </div>
    </div>
  )
}
