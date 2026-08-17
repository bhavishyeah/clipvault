import { useRef, useState } from 'react'
import { toast } from '../ui/toastStore'

const ACCEPTED_TYPES = ['image/jpeg', 'image/jpg', 'image/png']
const MAX_SIZE = 10 * 1024 * 1024 // 10MB

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
    if (!file) return

    if (!ACCEPTED_TYPES.includes(file.type)) {
      toast('Only JPG and PNG images are supported', 'error')
      e.target.value = ''
      return
    }

    if (file.size > MAX_SIZE) {
      toast('Image must be under 10MB', 'error')
      e.target.value = ''
      return
    }

    onImage(file)
    e.target.value = ''
  }

  return (
    <form className="mobile-paste-box" onSubmit={handleSubmit}>
      <div className="mobile-paste-heading">
        <div>
          <span className="mobile-paste-label">MOBILE INPUT</span>
          <h3>Paste text or a link</h3>
        </div>
        <span className="mobile-paste-icon">↳</span>
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
            title="Upload image"
          >
            📷
          </button>
          <button type="submit" disabled={!text.trim() || saving}>
            {saving ? 'Saving…' : 'Save text'}
          </button>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".jpg,.jpeg,.png"
        onChange={handleImagePick}
        hidden
        aria-hidden="true"
      />
    </form>
  )
}
