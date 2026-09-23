import { useState } from 'react'
import { IconUpload, IconClipboard } from '../ui/Icons'

const MOBILE_INPUT_ID = 'mobile-file-upload'

export default function MobilePasteBox({ onSave, onImage, saving }) {
  const [text, setText] = useState('')

  const handleSubmit = async (event) => {
    event.preventDefault()

    const value = text.trim()
    if (!value || saving) return

    await onSave(value)
    setText('')
  }

  const handleImagePick = async (event) => {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return

    // Keep the selected Android File attached to its native input throughout
    // the upload. Some content providers revoke lazy content:// access when
    // input.value is cleared before the file is consumed.
    try {
      await onImage(file)
    } finally {
      input.value = ''
    }
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
          {/* Native label/input activation avoids a programmatic click and
              keeps Android content-provider behavior consistent. */}
          <label
            htmlFor={MOBILE_INPUT_ID}
            className="mobile-image-btn"
            title="Upload file"
            aria-disabled={saving}
            style={{ cursor: saving ? 'not-allowed' : 'pointer', pointerEvents: saving ? 'none' : 'auto' }}
          >
            <IconUpload />
          </label>
          <button type="submit" disabled={!text.trim() || saving}>
            {saving ? 'Saving…' : 'Save text'}
          </button>
        </div>
      </div>

      <input
        id={MOBILE_INPUT_ID}
        type="file"
        accept="image/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
        onChange={handleImagePick}
        disabled={saving}
        hidden
        aria-hidden="true"
      />
    </form>
  )
}
