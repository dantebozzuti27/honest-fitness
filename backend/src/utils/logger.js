/**
 * Logger Utility
 * Centralized logging with environment-aware levels
 */

const isDevelopment = process.env.NODE_ENV === 'development'

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
    console.error(`[ERROR] ${new Date().toISOString()} - ${message}`, error || '')
  }
  // In production, you might want to send to error tracking service
  if (!isDevelopment && error) {
    // TODO: Send to error tracking service (e.g., Sentry, DataDog)
  }
}

/**
 * Log warning messages
 */
export function logWarn(message, data = null) {
  if (currentLogLevel >= LOG_LEVELS.WARN) {
    console.warn(`[WARN] ${new Date().toISOString()} - ${message}`, data || '')
  }
}

/**
 * Log info messages
 */
export function logInfo(message, data = null) {
  if (currentLogLevel >= LOG_LEVELS.INFO) {
    console.log(`[INFO] ${new Date().toISOString()} - ${message}`, data || '')
  }
}

/**
 * Log debug messages (only in development)
 */
export function logDebug(message, data = null) {
  if (isDevelopment && currentLogLevel >= LOG_LEVELS.DEBUG) {
    console.log(`[DEBUG] ${new Date().toISOString()} - ${message}`, data || '')
  }
}

