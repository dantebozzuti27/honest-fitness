/**
 * Logger Utility
 * Centralized logging with environment-aware levels
 */

const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : {}
const isDevelopment = Boolean(env.DEV || env.MODE === 'development')

/**
 * Log levels
 */
const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
}

const currentLogLevel = isDevelopment ? LOG_LEVELS.DEBUG : LOG_LEVELS.ERROR

/**
 * Log error messages
 */
export function logError(message, error = null) {
  if (currentLogLevel >= LOG_LEVELS.ERROR) {
    console.error(`[ERROR] ${message}`, error || '')
  }
  // In production, you might want to send to error tracking service
  if (!isDevelopment && error) {
    // TODO: Send to error tracking service (e.g., Sentry)
  }
}

/**
 * Log warning messages
 */
export function logWarn(message, data = null) {
  if (currentLogLevel >= LOG_LEVELS.WARN) {
    console.warn(`[WARN] ${message}`, data || '')
  }
}

/**
 * Log info messages
 */
export function logInfo(message, data = null) {
  if (currentLogLevel >= LOG_LEVELS.INFO) {
    console.log(`[INFO] ${message}`, data || '')
  }
}

/**
 * Log debug messages (only in development)
 * Always exported to prevent "is not defined" errors
 * This function is always available, even in production (as a no-op)
 */
export function logDebug(message, data = null) {
  try {
    if (isDevelopment && currentLogLevel >= LOG_LEVELS.DEBUG) {
      console.log(`[DEBUG] ${message}`, data || '')
    }
  } catch (e) {
    // Silently fail if console is not available
  }
}

// Ensure logDebug is always available (export as const for better tree-shaking compatibility)
export const logDebugSafe = logDebug

