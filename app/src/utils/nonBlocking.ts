import { logError } from './logger'
import type { MutableRefObject } from 'react'
import type { ToastType } from '../hooks/useToast'

/**
 * Best-effort wrapper for non-critical async work:
 * - logs errors for debugging
 * - optionally shows a one-time toast (per key) so failures aren’t silent
 */
export function nonBlocking<T>(
  promise: Promise<T> | T,
  opts: {
    key?: string | null
    shownRef?: MutableRefObject<Record<string, boolean>> | null
    showToast?: ((message: string, type?: ToastType) => void) | null
    message?: string | null
    level?: ToastType
  } = {}
) {
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


