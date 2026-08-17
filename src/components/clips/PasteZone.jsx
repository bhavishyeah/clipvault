import { useEffect, useState } from 'react'

export default function PasteZone({ onText, onImage }) {
  const [flash, setFlash] = useState('')

  useEffect(() => {
    let timer

    const showFlash = (message) => {
      setFlash(message)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setFlash(''), 2200)
    }

    const handlePaste = (event) => {
      // Skip if user is pasting into any input, textarea, or contenteditable
      if (
        event.target instanceof Element &&
        event.target.closest('input, textarea, [contenteditable]')
      ) {
        return
      }

      // Skip if any input/textarea on the page is focused (covers edge cases)
      const active = document.activeElement
      if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) {
        return
      }

      const items = event.clipboardData?.items
      if (!items) return

      // Handle image paste
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const blob = item.getAsFile()
          if (blob) {
            event.preventDefault()
            onImage(blob)
            showFlash('Image saved')
            return
          }
        }
      }

      // Handle text paste (only when no text input is visible/focused)
      const text = event.clipboardData.getData('text/plain')
      if (text?.trim()) {
        event.preventDefault()
        onText(text)
        showFlash('Saved to vault')
      }
    }

    window.addEventListener('paste', handlePaste)

    return () => {
      window.removeEventListener('paste', handlePaste)
      window.clearTimeout(timer)
    }
  }, [onText, onImage])

  return (
    <div className="vault-paste-zone" aria-label="Paste area">
      {flash && <span className="paste-flash">{flash}</span>}
    </div>
  )
}
