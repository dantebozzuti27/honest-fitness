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
import { authenticate } from '../middleware/auth.js'

export const apiRouter = express.Router()

// Apply authentication to all API routes except health check
apiRouter.use(authenticate)

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

