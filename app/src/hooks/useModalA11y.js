import { useEffect, useRef } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

function getFocusable(container) {
  if (!container) return []
  const nodes = Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR))
  return nodes.filter((el) => {
    // Filter out elements that are not actually focusable/visible
    const style = window.getComputedStyle(el)
    if (style.visibility === 'hidden' || style.display === 'none') return false
    if (el.hasAttribute('disabled')) return false
    return true
  })
}

/**
 * useModalA11y
 * Minimal, dependency-free a11y behaviors for modals/overlays:
 * - ESC closes
 * - Focus trap (Tab loops within the modal)
 * - Initial focus (first focusable, or provided ref)
 * - Restore focus to previously focused element on close
 */
export function useModalA11y({
  open,
  onClose,
  containerRef,
  initialFocusRef,
  restoreFocus = true,
  closeOnEscape = true,
  trapFocus = true
}) {
  // Keep latest callbacks/options without re-running the "open" effect on each render.
  const onCloseRef = useRef(onClose)
  const closeOnEscapeRef = useRef(closeOnEscape)
  const trapFocusRef = useRef(trapFocus)
  const restoreFocusRef = useRef(restoreFocus)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])
  useEffect(() => {
    closeOnEscapeRef.current = closeOnEscape
  }, [closeOnEscape])
  useEffect(() => {
    trapFocusRef.current = trapFocus
  }, [trapFocus])
  useEffect(() => {
    restoreFocusRef.current = restoreFocus
  }, [restoreFocus])

  useEffect(() => {
    if (!open) return

    const container = containerRef?.current
    const previouslyFocused = document.activeElement

    // Focus something inside the modal ASAP (only when the modal opens).
    // Crucially: do NOT re-run this on each render while open, or typing in a controlled
    // input can cause focus to "jump" (especially on iOS) when parent callbacks change.
    queueMicrotask(() => {
      const active = document.activeElement
      if (container && active && container.contains(active)) return

      const initial = initialFocusRef?.current
      if (initial && typeof initial.focus === 'function') {
        initial.focus()
        return
      }
      const focusable = getFocusable(container)
      focusable[0]?.focus?.()
    })

    const onKeyDown = (e) => {
      const currentContainer = containerRef?.current

      if (closeOnEscapeRef.current && e.key === 'Escape') {
        e.preventDefault()
        onCloseRef.current?.()
        return
      }

      if (!trapFocusRef.current || e.key !== 'Tab') return
      if (!currentContainer) return

      const focusable = getFocusable(currentContainer)
      if (focusable.length === 0) {
        e.preventDefault()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement

      // If focus somehow escapes, bring it back in.
      if (!currentContainer.contains(active)) {
        e.preventDefault()
        first.focus()
        return
      }

      if (e.shiftKey) {
        if (active === first) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (active === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      if (restoreFocusRef.current && previouslyFocused && typeof previouslyFocused.focus === 'function') {
        try {
          previouslyFocused.focus()
        } catch {
          // ignore
        }
      }
    }
  }, [open, containerRef, initialFocusRef])
}


