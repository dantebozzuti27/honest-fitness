/**
 * Keyboard shortcuts utility
 * Provides common keyboard shortcuts for the app
 */

export const SHORTCUTS = {
  SAVE: 'Ctrl+S',
  ESCAPE: 'Escape',
  ENTER: 'Enter',
  DELETE: 'Delete',
  ARROW_UP: 'ArrowUp',
  ARROW_DOWN: 'ArrowDown'
}

/**
 * Hook to handle keyboard shortcuts
 * @param {Object} shortcuts - Object mapping key combinations to handlers
 * @param {Array} deps - Dependencies array for useEffect
 */
export function useKeyboardShortcuts(shortcuts, deps = []) {
  const { useEffect } = require('react')
  
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Check for Ctrl/Cmd combinations
      const isCtrl = e.ctrlKey || e.metaKey
      const key = e.key
      
      // Check each shortcut
      Object.entries(shortcuts).forEach(([name, handler]) => {
        if (typeof handler !== 'function') return
        
        switch (name) {
          case 'save':
            if (isCtrl && key === 's') {
              e.preventDefault()
              handler(e)
            }
            break
          case 'escape':
            if (key === 'Escape') {
              handler(e)
            }
            break
          case 'enter':
            if (key === 'Enter' && !e.shiftKey && !isCtrl) {
              // Only trigger if not in textarea
              if (e.target.tagName !== 'TEXTAREA') {
                handler(e)
              }
            }
            break
          default:
            // Custom key handler
            if (handler.key && key === handler.key) {
              if (!handler.ctrl || isCtrl) {
                e.preventDefault()
                handler(e)
              }
            }
        }
      })
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, deps)
}

