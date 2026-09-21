import { useRef, useState } from 'react'
import { IconUpload, IconClipboard } from '../ui/Icons'

export default function MobilePasteBox({ onSave, onImage, saving }) {
  const [text, setText] = useState('')
  const fileRef = useRef(null)

  const handleSubmit = async (event) => {
    event.preventDefault()

    const value = text.trim()
    if (!value || saving) return

    await onSave(value)
    setText('')
  }

  const handleImagePick = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    onImage(file)
  }

  return (
    <form className="mobile-paste-box" onSubmit={handleSubmit}>
      <div className="mobile-paste-heading">
        <div>
          <span className="mobile-paste-label">MOBILE INPUT</span>
          <h3>Paste text or a link</h3>
        </div>
        <span className="mobile-paste-icon"><IconClipboard width="16" height="16" /></span>
      </div>

      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Tap here and paste anything..."
        rows={4}
        maxLength={10000}
        autoComplete="off"
        spellCheck="true"
      />

      <div className="mobile-paste-footer">
        <span>{text.length}/10000</span>
        <div className="mobile-paste-actions">
          <button
            type="button"
            className="mobile-image-btn"
            onClick={() => fileRef.current?.click()}
            disabled={saving}
            title="Upload file"
          >
            <IconUpload />
          </button>
          <button type="submit" disabled={!text.trim() || saving}>
            {saving ? 'Saving…' : 'Save text'}
          </button>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
        onChange={handleImagePick}
        hidden
        aria-hidden="true"
      />
    </form>
  )
}
