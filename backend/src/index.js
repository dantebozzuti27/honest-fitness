/**
 * HonestFitness Backend System
 * Main entry point for the backend API server
 */

import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { apiRouter } from './routes/api.js'
import { errorHandler } from './middleware/errorHandler.js'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3001

// Middleware
app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// API routes
app.use('/api', apiRouter)

// Error handling
app.use(errorHandler)

// Start server
app.listen(PORT, () => {
  console.log(`HonestFitness Backend running on port ${PORT}`)
})

export default app

