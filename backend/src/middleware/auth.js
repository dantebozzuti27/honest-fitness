/**
 * Authentication Middleware
 * Verifies Supabase JWT tokens for API requests
 */

import { createClient } from '@supabase/supabase-js'
import { logError } from '../utils/logger.js'
import { sendError } from '../utils/http.js'

/**
 * IMPORTANT:
 * Do NOT create the Supabase client at import time.
 * Serverless platforms can bundle/build without runtime env present.
 */
let supabase = null
let didInit = false

function getSupabaseAuthClient() {
  if (supabase) return supabase
  if (didInit) return null
  didInit = true

  const url = process.env.SUPABASE_URL
  // SECURITY: for token verification, require explicit server-side key.
  // Prefer SUPABASE_SERVICE_ROLE_KEY (available on the server) and do not fall back.
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null

  supabase = createClient(url, key)
  return supabase
}

/**
 * Middleware to verify JWT token and extract user ID
 */
export async function authenticate(req, res, next) {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return sendError(res, { status: 401, message: 'Missing or invalid authorization header' })
    }

    const token = authHeader.substring(7) // Remove 'Bearer ' prefix

    // Verify token with Supabase
    const client = getSupabaseAuthClient()
    if (!client) {
      logError('Auth not configured: missing SUPABASE_URL / SUPABASE_*_KEY')
      return sendError(res, { status: 500, message: 'Server authentication is not configured' })
    }

    const { data: { user }, error } = await client.auth.getUser(token)

    if (error || !user) {
      return sendError(res, { status: 401, message: 'Invalid or expired token' })
    }

    // Attach user to request object
    req.user = user
    req.userId = user.id

    next()
  } catch (error) {
    logError('Authentication error', error)
    return sendError(res, { status: 500, message: 'Authentication failed' })
  }
}

/**
 * Optional authentication - doesn't fail if no token
 */
export async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7)

      const client = getSupabaseAuthClient()
      if (!client) return next()

      const { data: { user }, error } = await client.auth.getUser(token)
      
      if (!error && user) {
        req.user = user
        req.userId = user.id
      }
    }
    next()
  } catch (error) {
    // Continue without authentication
    next()
  }
}

