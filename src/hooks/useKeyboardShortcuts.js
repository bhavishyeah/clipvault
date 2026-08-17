import { useEffect } from 'react'

/**
 * Global keyboard shortcuts for the dashboard
 * - Ctrl+K / Cmd+K: Focus search
 * - Escape: Clear search / close modals
 */
export function useKeyboardShortcuts({ searchRef, onEscape }) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ctrl+K or Cmd+K → focus search
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
        return
      }

      // Escape → clear/close
      if (e.key === 'Escape') {
        // If search is focused, blur it
        if (document.activeElement === searchRef.current) {
          searchRef.current.blur()
        }
        onEscape?.()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [searchRef, onEscape])
}
