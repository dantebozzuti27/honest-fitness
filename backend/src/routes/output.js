/**
 * Output Layer Routes
 * AI Coach and Analytics Dashboard
 */

import express from 'express'
import { generateAIInsights, generateAIWeeklySummary } from '../engines/ai/index.js'
import { processML } from '../engines/ml/index.js'
import { getFromDatabase } from '../database/index.js'

export const outputRouter = express.Router()

// Get AI Coach guidance
outputRouter.post('/coach/guidance', async (req, res, next) => {
  try {
    const { userId } = req.body
    
    const dataContext = await loadDataContext(userId)
    const mlResults = await processML(userId, dataContext)
    
    const insights = await generateAIInsights(userId, dataContext, mlResults)
    
    res.json({
      success: true,
      guidance: insights,
      generatedAt: new Date().toISOString()
    })
  } catch (error) {
    next(error)
  }
})

// Get analytics dashboard data
outputRouter.post('/analytics/dashboard', async (req, res, next) => {
  try {
    const { userId, dateRange } = req.body
    
    const dataContext = await loadDataContext(userId, dateRange)
    const mlResults = await processML(userId, dataContext)
    
    const analytics = {
      trends: {
        workouts: mlResults.workoutAnalysis,
        nutrition: mlResults.nutritionAnalysis
      },
      readiness: mlResults.readiness,
      anomalies: mlResults.anomalies,
      predictions: mlResults.predictions,
      summary: await generateAIWeeklySummary(userId, dataContext, mlResults)
    }
    
    res.json({
      success: true,
      analytics
    })
  } catch (error) {
    next(error)
  }
})

async function loadDataContext(userId, dateRange = {}) {
  const endDate = dateRange.endDate || new Date().toISOString().split('T')[0]
  const startDate = dateRange.startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  
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

