import express from 'express'
import cors from 'cors'
import { apiRouter } from '../backend/src/routes/api.js'
import { errorHandler } from '../backend/src/middleware/errorHandler.js'
import { apiLimiter } from '../backend/src/middleware/rateLimiter.js'
import { requestId } from '../backend/src/middleware/requestId.js'

const app = express()

// Request ID (observability)
app.use(requestId)

// CORS configuration - only allow explicitly configured origins
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
  : ['http://localhost:5173', 'http://localhost:3000']

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, Capacitor)
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

