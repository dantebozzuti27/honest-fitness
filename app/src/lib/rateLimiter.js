/**
 * Client-side Rate Limiter
 * Prevents excessive API calls from the client
 */

const RATE_LIMITS = {
  sync: {
    maxRequests: 10,
    windowMs: 60 * 1000, // 1 minute
  },
  api: {
    maxRequests: 100,
    windowMs: 15 * 60 * 1000, // 15 minutes
  }
}

const requestHistory = new Map()

/**
 * Check if a request should be rate limited
 * @param {string} key - Unique key for the rate limit (e.g., userId + action)
 * @param {string} type - Type of rate limit ('sync' or 'api')
 * @returns {boolean} - true if allowed, false if rate limited
 */
export function checkRateLimit(key, type = 'api') {
  const limit = RATE_LIMITS[type]
  if (!limit) return true

  const now = Date.now()
  const history = requestHistory.get(key) || []

  // Remove old entries outside the window
  const recentRequests = history.filter(timestamp => now - timestamp < limit.windowMs)

  // Check if we've exceeded the limit
  if (recentRequests.length >= limit.maxRequests) {
    return false
  }

  // Add current request
  recentRequests.push(now)
  requestHistory.set(key, recentRequests)

  // Clean up old entries periodically
  if (requestHistory.size > 1000) {
    const cutoff = now - Math.max(...Object.values(RATE_LIMITS).map(l => l.windowMs))
    for (const [k, v] of requestHistory.entries()) {
      if (v.length === 0 || v[v.length - 1] < cutoff) {
        requestHistory.delete(k)
      }
    }
  }

  return true
}

/**
 * Get remaining requests for a rate limit
 * @param {string} key - Unique key for the rate limit
 * @param {string} type - Type of rate limit ('sync' or 'api')
 * @returns {number} - Number of remaining requests
 */
export function getRemainingRequests(key, type = 'api') {
  const limit = RATE_LIMITS[type]
  if (!limit) return Infinity

  const now = Date.now()
  const history = requestHistory.get(key) || []
  const recentRequests = history.filter(timestamp => now - timestamp < limit.windowMs)

  return Math.max(0, limit.maxRequests - recentRequests.length)
}

/**
 * Clear rate limit history for a key
 * @param {string} key - Unique key for the rate limit
 */
export function clearRateLimit(key) {
  requestHistory.delete(key)
}

