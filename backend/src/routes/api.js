/**
 * Main API Router
 * Routes all API requests to appropriate handlers
 */

import express from 'express'
import { inputRouter } from './input.js'
import { mlRouter } from './ml.js'
import { personalizationRouter } from './personalization.js'
import { outputRouter } from './output.js'
import { pipelineRouter } from './pipeline.js'
import { chatRouter } from './chat.js'
import { insightsRouter } from './insights.js'
import { dbRouter } from './db.js'
import { rpcRouter } from './rpc.js'
import { authenticate } from '../middleware/auth.js'

export const apiRouter = express.Router()

// Apply authentication to all API routes except health check
apiRouter.use(authenticate)

// Returns the resolved user (maps cognito_sub → historical users.id)
apiRouter.get('/auth/me', (req, res) => {
  res.json({ id: req.userId, email: req.user?.email || '' })
})

// Generic CRUD proxy (RDS)
apiRouter.use('/db', dbRouter)

// RPC endpoints (RDS)
apiRouter.use('/rpc', rpcRouter)

// Route to input layer
apiRouter.use('/input', inputRouter)

// Route to ML/AI engine
apiRouter.use('/ml', mlRouter)

// Route to personalization engine
apiRouter.use('/personalization', personalizationRouter)

// Route to output layer
apiRouter.use('/output', outputRouter)

// Route to data pipelines
apiRouter.use('/pipeline', pipelineRouter)

// Chat (frontend /api/chat)
apiRouter.use('/chat', chatRouter)

// LLM insights (frontend /api/insights)
apiRouter.use('/insights', insightsRouter)

