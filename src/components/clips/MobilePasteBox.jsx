import { useState } from 'react'

export default function MobilePasteBox({ onSave, saving }) {
  const [text, setText] = useState('')
  const [message, setMessage] = useState('')

  const handleSubmit = async (event) => {
    event.preventDefault()

    const value = text.trim()
    if (!value || saving) return

    await onSave(value)
    setText('')
    setMessage('Saved to your vault')
    window.setTimeout(() => setMessage(''), 2200)
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
        <button type="submit" disabled={!text.trim() || saving}>
          {saving ? 'Saving…' : 'Save text'}
        </button>
      </div>

      {message && <p className="mobile-paste-success">{message}</p>}
    </form>
  )
}