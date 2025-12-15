/**
 * Authentication Middleware
 * Verifies Supabase JWT tokens for API requests
 */

import { createClient } from '@supabase/supabase-js'
import { logError } from '../utils/logger.js'

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
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
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
      return res.status(401).json({ 
        error: { 
          message: 'Missing or invalid authorization header',
          status: 401 
        } 
      })
    }

    const token = authHeader.substring(7) // Remove 'Bearer ' prefix

    // Verify token with Supabase
    const client = getSupabaseAuthClient()
    if (!client) {
      logError('Auth not configured: missing SUPABASE_URL / SUPABASE_*_KEY')
      return res.status(500).json({
        error: {
          message: 'Server authentication is not configured',
          status: 500
        }
      })
    }

    const { data: { user }, error } = await client.auth.getUser(token)

    if (error || !user) {
      return res.status(401).json({ 
        error: { 
          message: 'Invalid or expired token',
          status: 401 
        } 
      })
    }

    // Attach user to request object
    req.user = user
    req.userId = user.id

    next()
  } catch (error) {
    logError('Authentication error', error)
    return res.status(500).json({ 
      error: { 
        message: 'Authentication failed',
        status: 500 
      } 
    })
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

