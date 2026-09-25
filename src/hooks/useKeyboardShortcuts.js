import { useEffect } from 'react'

/**
 * Global keyboard shortcuts for the dashboard
 * - Ctrl+K / Cmd+K: Open the command palette (Req 6.1, 6.5). This supersedes
 *   the previous "focus search" binding; the palette itself owns clip search.
 *   Falls back to focusing the search box only when no palette handler is
 *   provided, preserving the old behaviour for callers that opt out.
 * - Escape: Clear search / close modals (unchanged — Req 6.5). The palette
 *   handles its own Escape internally; this global handler stays for the rest
 *   of the dashboard.
 *
 * @param {object} params
 * @param {import('react').RefObject<HTMLElement>} [params.searchRef] - search input ref
 * @param {() => void} [params.onOpenPalette] - open the command palette
 * @param {() => void} [params.onEscape] - clear/close handler for Escape
 */
export function useKeyboardShortcuts({ searchRef, onOpenPalette, onEscape }) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ctrl+K or Cmd+K → open the command palette (Req 6.1, 6.5).
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        if (onOpenPalette) {
          onOpenPalette()
        } else {
          // Backwards-compatible fallback: focus the search box.
          searchRef?.current?.focus()
        }
        return
      }

      // Escape → clear/close (unchanged behaviour).
      if (e.key === 'Escape') {
        // If search is focused, blur it
        if (searchRef?.current && document.activeElement === searchRef.current) {
          searchRef.current.blur()
        }
        onEscape?.()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [searchRef, onOpenPalette, onEscape])
}
