import express from 'express'
import cors from 'cors'
import { apiRouter } from '../backend/src/routes/api.js'
import { errorHandler } from '../backend/src/middleware/errorHandler.js'
import { apiLimiter } from '../backend/src/middleware/rateLimiter.js'

const app = express()

// CORS - allow all origins in production (adjust as needed)
app.use(cors({
  origin: true,
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

