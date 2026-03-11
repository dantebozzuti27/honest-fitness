/**
 * Logger Utility
 * Centralized logging with environment-aware levels
 */

const env = import.meta.env
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

/** In-memory error log (max 50 entries) for inspection from console or debug screen */
const MAX_REPORTED_ERRORS = 50
const reportedErrors: Array<{ timestamp: string; message: string; stack?: string }> = []

export function getRecentErrors() {
  return [...reportedErrors]
}

/**
 * Log error messages
 */
export function logError(message: string, error: unknown = null) {
  if (currentLogLevel >= LOG_LEVELS.ERROR) {
    console.error(`[ERROR] ${message}`, error || '')
  }
  const stack = error instanceof Error ? error.stack : undefined
  reportedErrors.push({ timestamp: new Date().toISOString(), message, stack })
  if (reportedErrors.length > MAX_REPORTED_ERRORS) {
    reportedErrors.shift()
  }
}

/**
 * Log warning messages
 */
export function logWarn(message: string, data: unknown = null) {
  if (currentLogLevel >= LOG_LEVELS.WARN) {
    console.warn(`[WARN] ${message}`, data || '')
  }
}

/**
 * Log info messages
 */
export function logInfo(message: string, data: unknown = null) {
  if (currentLogLevel >= LOG_LEVELS.INFO) {
    console.log(`[INFO] ${message}`, data || '')
  }
}

/**
 * Log debug messages (only in development)
 * Always exported to prevent "is not defined" errors
 * This function is always available, even in production (as a no-op)
 */
export function logDebug(message: string, data: unknown = null) {
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

