/**
 * Rate Limiting Middleware
 * Prevents abuse by limiting the number of requests per IP address
 */

import rateLimit from 'express-rate-limit'

/**
 * General API rate limiter
 * 100 requests per 15 minutes per IP
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    error: {
      message: 'Too many requests from this IP, please try again later.',
      status: 429
    }
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
})

/**
 * Strict rate limiter for authentication endpoints
 * 5 requests per 15 minutes per IP
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  message: {
    error: {
      message: 'Too many authentication attempts, please try again later.',
      status: 429
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
})

/**
 * ML/AI endpoint rate limiter
 * 20 requests per hour per IP (more expensive operations)
 */
export const mlLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // Limit each IP to 20 requests per hour
  message: {
    error: {
      message: 'Too many ML/AI requests, please try again later.',
      status: 429
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
})

/**
 * Data sync rate limiter
 * 10 requests per minute per IP
 */
export const syncLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // Limit each IP to 10 requests per minute
  message: {
    error: {
      message: 'Too many sync requests, please wait a moment.',
      status: 429
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
})

