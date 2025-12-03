/**
 * Authentication Middleware
 * Verifies Supabase JWT tokens for API requests
 */

import { createClient } from '@supabase/supabase-js'
import { logError } from '../utils/logger.js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
)

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
    const { data: { user }, error } = await supabase.auth.getUser(token)

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
      const { data: { user }, error } = await supabase.auth.getUser(token)
      
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

