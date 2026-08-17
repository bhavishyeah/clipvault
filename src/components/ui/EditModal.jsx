import { useEffect, useRef, useState } from 'react'

export default function EditModal({ open, clip, onSave, onCancel }) {
  if (!open || !clip) return null

  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="edit-modal" onClick={(e) => e.stopPropagation()}>
        <EditForm clip={clip} onSave={onSave} onCancel={onCancel} />
      </div>
    </div>
  )
}

function EditForm({ clip, onSave, onCancel }) {
  const [content, setContent] = useState(clip.content || '')
  const textareaRef = useRef(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const handleSubmit = (e) => {
    e.preventDefault()
    const trimmed = content.trim()
    if (trimmed && trimmed !== clip.content) {
      onSave(clip, trimmed)
    }
    onCancel()
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      handleSubmit(e)
    }
  }

  return (
    <>
      <h3>Edit clip</h3>
      <form onSubmit={handleSubmit}>
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={5}
          maxLength={10000}
          className="edit-textarea"
          placeholder="Edit content..."
        />
        <p className="edit-hint">Ctrl + Enter to save</p>
        <div className="confirm-actions">
          <button type="button" className="confirm-cancel" onClick={onCancel}>Cancel</button>
          <button type="submit" className="confirm-delete" style={{ background: 'linear-gradient(135deg, #7567ff, #a36bff)' }}>
            Save
          </button>
        </div>
      </form>
    </>
  )
}
