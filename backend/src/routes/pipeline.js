/**
 * Data Pipeline Routes
 */

import express from 'express'
import { processDataPipeline, processBatchPipeline } from '../pipelines/index.js'

export const pipelineRouter = express.Router()

// Process single data point
pipelineRouter.post('/process', async (req, res, next) => {
  try {
    const { type, data, source } = req.body
    const result = await processDataPipeline(type, data, source)
    res.json(result)
  } catch (error) {
    next(error)
  }
})

// Process batch data
pipelineRouter.post('/process-batch', async (req, res, next) => {
  try {
    const { type, data, source } = req.body
    const result = await processBatchPipeline(type, data, source)
    res.json(result)
  } catch (error) {
    next(error)
  }
})

