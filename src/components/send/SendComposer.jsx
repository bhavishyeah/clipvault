import { useRef, useState } from 'react'
import { IconSearch, IconUpload } from '../ui/Icons'
import { toast } from '../ui/toastStore'

const CLOUDINARY_CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME
const CLOUDINARY_UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET

const isUrl = (text) => /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}([/?#].*)?$/i.test(text)

export default function SendComposer({ onClose, searchUsers, sendTo, sending, userId, contacts, addContact, removeContact }) {
  const [content, setContent] = useState('')
  const [image, setImage] = useState(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [selectedUser, setSelectedUser] = useState(null)
  const [searching, setSearching] = useState(false)
  const searchTimer = useRef(null)
  const fileRef = useRef(null)

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

  const handleImagePick = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 10 * 1024 * 1024) { toast('Max 10MB', 'error'); return }
    // Revoke previous preview URL if exists
    if (image?.preview) URL.revokeObjectURL(image.preview)
    setImage({ file, preview: URL.createObjectURL(file) })
    e.target.value = ''
  }

  const selectUser = (u) => {
    setSelectedUser(u)
    setQuery(`@${u.username}`)
    setResults([])
  }

  const handleSend = async () => {
    if (!selectedUser) { toast('Select a recipient', 'error'); return }
    if (!content.trim() && !image) { toast('Add content to send', 'error'); return }

    let type = 'text'
    let finalContent = content.trim()
    let fileData = null

    if (image) {
      type = 'image'
      if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_UPLOAD_PRESET) {
        toast('Image upload not configured', 'error')
        return
      }

      const formData = new FormData()
      formData.append('file', image.file)
      formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET)
      formData.append('folder', `volt/${userId}`)

      const res = await fetch(
        `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
        { method: 'POST', body: formData }
      )
      const uploaded = await res.json()
      if (!res.ok) { toast('Upload failed', 'error'); return }

      fileData = { url: uploaded.secure_url, name: image.file.name, size: uploaded.bytes, mime: image.file.type }
      finalContent = null
    } else if (isUrl(finalContent)) {
      type = 'link'
    }

    const success = await sendTo(selectedUser.id, type, finalContent, fileData)
    if (success) onClose()
  }

  const isContact = (id) => contacts?.some((c) => c.id === id)

  return (
    <div className="confirm-overlay" onClick={onClose}>
      <div className="send-composer" onClick={(e) => e.stopPropagation()}>
        <div className="send-header">
          <h3>Send to</h3>
          <button className="send-close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Content input */}
        <div className="send-content-area">
          {image ? (
            <div className="send-image-preview">
              <img src={image.preview} alt="To send" />
              <button onClick={() => { if (image?.preview) URL.revokeObjectURL(image.preview); setImage(null) }} className="send-remove-image">Remove</button>
            </div>
          ) : (
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onPaste={(e) => e.stopPropagation()}
              placeholder="Paste text, link, or drop an image..."
              rows={3}
              maxLength={10000}
            />
          )}
          {!image && (
            <button className="send-attach" onClick={() => fileRef.current?.click()}>
              <IconUpload width="14" height="14" /> Image
            </button>
          )}
          <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png" onChange={handleImagePick} hidden />
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
          disabled={sending || (!content.trim() && !image) || !selectedUser}
        >
          {sending ? 'Sending...' : 'Send'}
        </button>
      </div>
    </div>
  )
}
