import express from 'express'
import cors from 'cors'
import { apiRouter } from '../backend/src/routes/api.js'
import { errorHandler } from '../backend/src/middleware/errorHandler.js'
import { apiLimiter } from '../backend/src/middleware/rateLimiter.js'
import { requestId } from '../backend/src/middleware/requestId.js'

const app = express()

// Vercel sits behind a reverse proxy — required for express-rate-limit
// to correctly read client IPs from X-Forwarded-For.
app.set('trust proxy', 1)

// Request ID (observability)
app.use(requestId)

// CORS configuration
const allowedOrigins = (() => {
  const origins = new Set(['http://localhost:5173', 'http://localhost:3000'])
  if (process.env.ALLOWED_ORIGINS) {
    process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean).forEach(o => origins.add(o))
  }
  // Auto-detect Vercel deployment URL so CORS works without manual ALLOWED_ORIGINS config
  if (process.env.VERCEL_URL) origins.add(`https://${process.env.VERCEL_URL}`)
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) origins.add(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`)
  // Common Vercel production patterns
  const publicSite = process.env.VITE_PUBLIC_SITE_URL
  if (publicSite) origins.add(publicSite.replace(/\/$/, ''))
  return [...origins]
})()

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, Capacitor)
    if (!origin) return callback(null, true)
    // Allow same-project Vercel preview deployments (exact project slug match)
    if (/^https:\/\/honest-fitness[a-z0-9-]*\.vercel\.app$/.test(origin)) return callback(null, true)
    if (allowedOrigins.includes(origin)) return callback(null, true)
    callback(new Error('Not allowed by CORS'))
  },
  credentials: true
}))

app.use(express.json({ limit: '5mb' }))
app.use(express.urlencoded({ extended: true, limit: '5mb' }))

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})


// Apply rate limiting
app.use('/api', apiLimiter)

// API routes
app.use('/api', apiRouter)

// Error handling
app.use(errorHandler)

export default app

