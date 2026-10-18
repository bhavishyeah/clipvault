import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { rankItems } from '../../lib/fuzzy'
import {
  IconCopy, IconPin, IconPinFilled, IconLink, IconTrash, IconClock, IconText,
} from './Icons'

// VOLT — Command palette (Ctrl+K / Cmd+K) — Requirement 6.
//
// A keyboard-first overlay that lets the user jump to any clip and run any
// action without the mouse. It is a controlled component: Dashboard owns the
// `open` state (toggled by the global Ctrl+K binding in useKeyboardShortcuts)
// and passes the clip list plus the action handlers it already wires to
// useClips / useShares / useDirectSend. The palette re-uses those handlers
// rather than re-instantiating the hooks, so there is no duplicate hook state.
//
// Interaction model (Req 6.2, 6.3, 6.4):
//   - Two steps. Step "clips": typing fuzzy-filters clips (by content or tag)
//     and the global command entries. Arrow/Enter navigate + activate.
//   - Selecting a clip advances to step "actions" for that clip, listing the
//     per-clip commands (copy / pin / share / send / delete / set expiry).
//   - Selecting a command runs it against the chosen clip, then closes.
//   - Escape closes the palette (or steps back from actions to clips).
//
// Accessibility (Req 6.6): role="dialog" + aria-modal, a role="listbox" of
// role="option" rows with aria-selected + aria-activedescendant, a labelled
// search input, and a focus trap that keeps Tab/Shift+Tab inside the dialog
// and restores focus to the previously-focused element on close.

// A short, human-readable summary of a clip for the palette row + fuzzy key.
function clipLabel(clip) {
  if (clip.content) return clip.content
  if (clip.metadata?.name) return clip.metadata.name
  if (clip.type === 'image') return 'Image clip'
  if (clip.type === 'file') return 'File clip'
  if (clip.type === 'audio') return 'Audio clip'
  return `${clip.type} clip`
}

// The string a clip is fuzzy-matched against: its content plus any tags.
function clipSearchKey(clip) {
  const tags = Array.isArray(clip.metadata?.tags) ? clip.metadata.tags.join(' ') : ''
  return `${clipLabel(clip)} ${tags}`.trim()
}

// Quick expiry presets offered by the palette's "set expiry" command. Mirrors
// Dashboard's EXPIRY_MENU so behaviour is consistent (Req 2.1 / 6.3).
const EXPIRY_PRESETS = [
  { preset: '1h', label: 'Expire in 1 hour' },
  { preset: '1d', label: 'Expire in 1 day' },
  { preset: '7d', label: 'Expire in 7 days' },
  { preset: 'none', label: 'Remove expiry' },
]

export default function CommandPalette({
  open,
  onClose,
  clips = [],
  // Action handlers, supplied by Dashboard (already wired to the hooks).
  onCopy,        // (clip) => void            useClips.copyClip-equivalent
  onTogglePin,   // (clip) => void            useClips.togglePin
  onShare,       // (clip) => void            useShares.createShare via Dashboard
  onSend,        // (clip) => void            open SendComposer / useDirectSend
  onDelete,      // (clip) => void            useClips.removeClip (with undo)
  onSetExpiry,   // (clip, preset) => void    useClips.setExpiration
  onOpenClip,    // (clip) => void            focus/open the clip (optional)
}) {
  // step: 'clips' (pick a clip) | 'actions' (pick a command for chosenClip)
  //       | 'expiry' (pick an expiry preset for chosenClip)
  const [step, setStep] = useState('clips')
  const [chosenClip, setChosenClip] = useState(null)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)

  const dialogRef = useRef(null)
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const previouslyFocused = useRef(null)

  // Reset transient state whenever the palette opens, and remember the element
  // to restore focus to on close. The resets and focus run in a rAF callback
  // (not synchronously in the effect body) to avoid cascading-render churn.
  useEffect(() => {
    if (open) {
      previouslyFocused.current = document.activeElement
      const id = window.requestAnimationFrame(() => {
        setStep('clips')
        setChosenClip(null)
        setQuery('')
        setActiveIndex(0)
        inputRef.current?.focus()
      })
      return () => window.cancelAnimationFrame(id)
    }
    // On close, restore focus to whatever was focused before opening.
    const el = previouslyFocused.current
    if (el && typeof el.focus === 'function') el.focus()
    return undefined
  }, [open])

  // Build the current list of selectable entries for the active step.
  // Each entry: { id, label, hint, icon, run }.
  const entries = useMemo(() => {
    if (step === 'actions' && chosenClip) {
      const clip = chosenClip
      const list = [
        { id: 'copy', label: 'Copy', hint: 'Copy to clipboard', icon: <IconCopy />, run: () => onCopy?.(clip) },
        {
          id: 'pin',
          label: clip.is_pinned ? 'Unpin' : 'Pin',
          hint: clip.is_pinned ? 'Remove from pinned' : 'Pin to top',
          icon: clip.is_pinned ? <IconPinFilled /> : <IconPin />,
          run: () => onTogglePin?.(clip),
        },
        { id: 'share', label: 'Share', hint: 'Create a public share link', icon: <IconLink />, run: () => onShare?.(clip) },
        { id: 'send', label: 'Send', hint: 'Send to a user', icon: <IconLink />, run: () => onSend?.(clip) },
        {
          id: 'expiry',
          label: 'Set expiry',
          hint: 'Auto-expire this clip',
          icon: <IconClock />,
          // Advance to the expiry sub-step instead of closing.
          run: () => 'step:expiry',
        },
        { id: 'delete', label: 'Delete', hint: 'Remove this clip', icon: <IconTrash />, run: () => onDelete?.(clip) },
      ]
      // Only offer copy where there is something to copy / open.
      return list.filter((e) => {
        if (e.id === 'copy') return clip.type !== 'image' || clip.url
        return true
      })
    }

    if (step === 'expiry' && chosenClip) {
      const clip = chosenClip
      return EXPIRY_PRESETS.map(({ preset, label }) => ({
        id: `expiry-${preset}`,
        label,
        hint: '',
        icon: <IconClock />,
        run: () => onSetExpiry?.(clip, preset),
      }))
    }

    // step === 'clips' — fuzzy-filtered clips (by content or tag).
    const ranked = rankItems(query, clips, clipSearchKey)
    return ranked.map((clip) => ({
      id: `clip-${clip.id}`,
      label: clipLabel(clip),
      hint: clip.type,
      icon: <IconText />,
      // Selecting a clip advances to its action list (Req 6.3).
      run: () => {
        setChosenClip(clip)
        onOpenClip?.(clip)
        return 'step:actions'
      },
    }))
  }, [step, chosenClip, query, clips, onCopy, onTogglePin, onShare, onSend, onDelete, onSetExpiry, onOpenClip])

  // Clamp the active index to the current list at render time (the list can
  // shrink as the query narrows) instead of via a setState-in-effect.
  const safeIndex = entries.length === 0 ? 0 : Math.min(activeIndex, entries.length - 1)

  // Scroll the active option into view as the selection moves.
  useEffect(() => {
    if (!open) return
    const node = listRef.current?.querySelector(`[data-index="${safeIndex}"]`)
    node?.scrollIntoView({ block: 'nearest' })
  }, [safeIndex, open])

  const activate = useCallback((entry) => {
    if (!entry) return
    const outcome = entry.run?.()
    if (outcome === 'step:actions') {
      setStep('actions')
      setQuery('')
      setActiveIndex(0)
      window.requestAnimationFrame(() => inputRef.current?.focus())
      return
    }
    if (outcome === 'step:expiry') {
      setStep('expiry')
      setQuery('')
      setActiveIndex(0)
      window.requestAnimationFrame(() => inputRef.current?.focus())
      return
    }
    // Any concrete command ran — close the palette.
    onClose?.()
  }, [onClose])

  const goBack = useCallback(() => {
    if (step === 'expiry') {
      setStep('actions')
      setQuery('')
      setActiveIndex(0)
      window.requestAnimationFrame(() => inputRef.current?.focus())
      return true
    }
    if (step === 'actions') {
      setStep('clips')
      setChosenClip(null)
      setQuery('')
      setActiveIndex(0)
      window.requestAnimationFrame(() => inputRef.current?.focus())
      return true
    }
    return false
  }, [step])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      // Escape steps back from a sub-step, or closes from the root.
      if (!goBack()) onClose?.()
      return
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => (entries.length === 0 ? 0 : (i + 1) % entries.length))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => (entries.length === 0 ? 0 : (i - 1 + entries.length) % entries.length))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      activate(entries[safeIndex])
      return
    }

    // Focus trap: keep Tab / Shift+Tab within the dialog.
    if (e.key === 'Tab') {
      const focusables = dialogRef.current?.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      if (!focusables || focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }, [entries, safeIndex, activate, goBack, onClose])

  if (!open) return null

  const placeholder =
    step === 'clips'
      ? 'Search clips or type a command...'
      : step === 'expiry'
        ? 'Choose an expiry...'
        : 'Choose an action...'

  const heading =
    step === 'clips'
      ? 'Command palette'
      : `${chosenClip ? clipLabel(chosenClip).slice(0, 40) : 'Clip'} — actions`

  const activeId = entries[safeIndex] ? `cmdk-option-${entries[safeIndex].id}` : undefined

  return (
    <div
      className="cmdk-overlay"
      onClick={() => onClose?.()}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={dialogRef}
        className="cmdk-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cmdk-header">
          {(step === 'actions' || step === 'expiry') && (
            <button
              type="button"
              className="cmdk-back"
              onClick={goBack}
              aria-label="Back"
              title="Back"
            >
              ‹
            </button>
          )}
          <label className="cmdk-search" htmlFor="cmdk-input">
            <span className="cmdk-visually-hidden">{heading}</span>
            <input
              id="cmdk-input"
              ref={inputRef}
              type="text"
              className="cmdk-input"
              value={query}
              placeholder={placeholder}
              autoComplete="off"
              spellCheck="false"
              role="combobox"
              aria-expanded="true"
              aria-controls="cmdk-listbox"
              aria-activedescendant={activeId}
              onChange={(e) => { setQuery(e.target.value); setActiveIndex(0) }}
            />
          </label>
        </div>

        <ul
          id="cmdk-listbox"
          ref={listRef}
          className="cmdk-list"
          role="listbox"
          aria-label={heading}
        >
          {entries.length === 0 ? (
            <li className="cmdk-empty" role="option" aria-selected="false" aria-disabled="true">
              No results
            </li>
          ) : (
            entries.map((entry, index) => (
              <li
                key={entry.id}
                id={`cmdk-option-${entry.id}`}
                data-index={index}
                className={`cmdk-option ${index === safeIndex ? 'active' : ''}`}
                role="option"
                aria-selected={index === safeIndex}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => activate(entry)}
              >
                <span className="cmdk-option-icon" aria-hidden="true">{entry.icon}</span>
                <span className="cmdk-option-label">{entry.label}</span>
                {entry.hint && <span className="cmdk-option-hint">{entry.hint}</span>}
              </li>
            ))
          )}
        </ul>

        <div className="cmdk-footer" aria-hidden="true">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> select</span>
          <span><kbd>esc</kbd> {step === 'clips' ? 'close' : 'back'}</span>
        </div>
      </div>
    </div>
  )
}
