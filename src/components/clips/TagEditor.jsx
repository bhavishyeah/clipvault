import { useState, useRef, useEffect } from 'react'
import { addTag, removeTag, MAX_TAGS, MAX_TAG_LEN } from '../../lib/tags'
import { toast } from '../ui/toastStore'

// Inline tag chips + add/remove editor for a single clip.
//
// Renders the clip's existing tags as removable chips and an inline text input
// (revealed by an "add tag" toggle) that appends a normalized tag. All list
// mutation goes through the pure `addTag`/`removeTag` helpers; persistence is
// delegated to the `onChange(nextTags)` callback (wired to `useClips.setTags`
// in the Dashboard). Rejection reasons from `addTag` are surfaced via `toast`
// with a clear message (Req 1.5).

const REJECTION_MESSAGE = {
  empty: 'Tag can’t be empty',
  duplicate: 'Tag already added',
  too_long: `Tags are limited to ${MAX_TAG_LEN} characters`,
  too_many: `A clip can have at most ${MAX_TAGS} tags`,
}

export default function TagEditor({ tags, onChange }) {
  const current = Array.isArray(tags) ? tags : []
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    if (adding) inputRef.current?.focus()
  }, [adding])

  const commit = () => {
    const result = addTag(current, draft)
    if (result.ok) {
      onChange(result.tags)
      setDraft('')
      // keep the input open so the owner can add several tags in a row
      inputRef.current?.focus()
    } else {
      toast(REJECTION_MESSAGE[result.reason] ?? 'Could not add tag', 'error')
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setDraft('')
      setAdding(false)
    }
  }

  const handleRemove = (tag) => {
    onChange(removeTag(current, tag))
  }

  const atMax = current.length >= MAX_TAGS

  return (
    <div className="tag-editor">
      {current.map((tag) => (
        <span className="tag-chip" key={tag}>
          <span className="tag-chip-label">{tag}</span>
          <button
            type="button"
            className="tag-chip-remove"
            onClick={(e) => { e.stopPropagation(); handleRemove(tag) }}
            title={`Remove tag ${tag}`}
            aria-label={`Remove tag ${tag}`}
          >
            ×
          </button>
        </span>
      ))}

      {adding ? (
        <input
          ref={inputRef}
          type="text"
          className="tag-input"
          value={draft}
          maxLength={MAX_TAG_LEN}
          placeholder="tag…"
          aria-label="Add a tag"
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => { setAdding(false); setDraft('') }}
        />
      ) : (
        <button
          type="button"
          className="tag-add"
          disabled={atMax}
          title={atMax ? `A clip can have at most ${MAX_TAGS} tags` : 'Add tag'}
          aria-label="Add tag"
          onClick={(e) => { e.stopPropagation(); setAdding(true) }}
        >
          + tag
        </button>
      )}
    </div>
  )
}
