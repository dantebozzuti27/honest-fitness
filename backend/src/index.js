/**
 * HonestFitness Backend System
 * Main entry point for the backend API server
 */

import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { apiRouter } from './routes/api.js'
import { errorHandler } from './middleware/errorHandler.js'
import { apiLimiter } from './middleware/rateLimiter.js'
import { requestId } from './middleware/requestId.js'
import { logError, logInfo } from './utils/logger.js'

dotenv.config()

// Validate required environment variables (skip in test so `npm test` can spin up locally)
if (process.env.NODE_ENV !== 'test') {
  const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName])
  if (missingVars.length > 0) {
    logError('Missing required environment variables', { missing: missingVars })
    process.exit(1)
  }
}

const app = express()
const PORT = process.env.PORT || 3001

// Request ID (observability)
app.use(requestId)

// CORS configuration - only allow frontend origin
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:5173', 'http://localhost:3000']

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true)
    } else {
      callback(new Error('Not allowed by CORS'))
    }
  },
  credentials: true
}))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Health check (no rate limit)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Apply rate limiting to all API routes
app.use('/api', apiLimiter)

// API routes
app.use('/api', apiRouter)

// Error handling
app.use(errorHandler)

// Export for Vercel serverless
export default app

// Start server for local development
if (!process.env.VERCEL && process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    logInfo(`HonestFitness Backend running on port ${PORT}`)
  })
}

