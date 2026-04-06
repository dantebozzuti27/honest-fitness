import express from 'express'
import cors from 'cors'
import { apiRouter } from '../routes/api.js'
import { errorHandler } from '../middleware/errorHandler.js'
import { apiLimiter } from '../middleware/rateLimiter.js'
import { requestId } from '../middleware/requestId.js'

export function createApp({ trustProxy = false } = {}) {
  const app = express()

  if (trustProxy) app.set('trust proxy', 1)

  app.use(requestId)

  const allowedOrigins = (() => {
    const origins = new Set(['http://localhost:5173', 'http://localhost:3000'])
    if (process.env.ALLOWED_ORIGINS) {
      process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean).forEach(o => origins.add(o))
    }
    if (process.env.VERCEL_URL) origins.add(`https://${process.env.VERCEL_URL}`)
    if (process.env.VERCEL_PROJECT_PRODUCTION_URL) origins.add(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`)
    const publicSite = process.env.VITE_PUBLIC_SITE_URL
    if (publicSite) origins.add(publicSite.replace(/\/$/, ''))
    return [...origins]
  })()

  app.use(cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true)
      if (/^https:\/\/honest-fitness[a-z0-9-]*\.vercel\.app$/.test(origin)) return callback(null, true)
      if (allowedOrigins.includes(origin)) return callback(null, true)
      callback(new Error('Not allowed by CORS'))
    },
    credentials: true
  }))

  app.use(express.json({ limit: '5mb' }))
  app.use(express.urlencoded({ extended: true, limit: '5mb' }))

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() })
  })

  app.use('/api', apiLimiter)
  app.use('/api', apiRouter)
  app.use(errorHandler)

  return app
}
