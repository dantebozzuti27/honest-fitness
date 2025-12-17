import { logError } from './logger'

/**
 * Best-effort wrapper for non-critical async work:
 * - logs errors for debugging
 * - optionally shows a one-time toast (per key) so failures aren’t silent
 */
export function nonBlocking(promise, opts = {}) {
  const {
    key = null,
    shownRef = null,
    showToast = null,
    message = null,
    level = 'info'
  } = opts || {}

  return Promise.resolve(promise).catch((err) => {
    logError('Non-blocking task failed', err)
    if (key && shownRef?.current && showToast && message && !shownRef.current[key]) {
      shownRef.current[key] = true
      try {
        showToast(message, level)
      } catch {
        // ignore
      }
    }
    return null
  })
}


