/**
 * Personalization Engine Routes
 */

import express from 'express'
import { personalize } from '../engines/personalization/index.js'
import { processML } from '../engines/ml/index.js'
import { getFromDatabase } from '../database/index.js'

export const personalizationRouter = express.Router()

// Generate personalized recommendations
personalizationRouter.post('/generate', async (req, res, next) => {
  try {
    const { userId } = req.body
    
    const dataContext = await loadDataContext(userId)
    const mlResults = await processML(userId, dataContext)
    const aiResults = {} // Would include AI-generated plans if needed
    
    const personalization = await personalize(userId, dataContext, mlResults, aiResults)
    
    res.json({
      success: true,
      personalization
    })
  } catch (error) {
    next(error)
  }
})

async function loadDataContext(userId) {
  const endDate = new Date().toISOString().split('T')[0]
  const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  
  const [workouts, nutrition, health, user] = await Promise.all([
    getFromDatabase('workout', userId, { startDate, endDate }),
    getFromDatabase('nutrition', userId, { startDate, endDate }),
    getFromDatabase('health', userId, { startDate, endDate }),
    getFromDatabase('user', userId)
  ])
  
  return {
    workouts,
    nutrition,
    health,
    user: user?.[0] || null
  }
}

