/**
 * ML/AI Engine Routes
 */

import express from 'express'
import { processML } from '../engines/ml/index.js'
import { generateAIWorkoutPlan, generateAINutritionPlan, generateAIWeeklySummary, generateAIInsights, interpretPrompt } from '../engines/ai/index.js'
import { getFromDatabase } from '../database/index.js'

export const mlRouter = express.Router()

// Process ML analysis
mlRouter.post('/analyze', async (req, res, next) => {
  try {
    const { userId, dateRange } = req.body
    
    // Load data context
    const dataContext = await loadDataContext(userId, dateRange)
    
    // Process ML
    const mlResults = await processML(userId, dataContext)
    
    res.json({
      success: true,
      results: mlResults,
      processedAt: new Date().toISOString()
    })
  } catch (error) {
    next(error)
  }
})

// Generate workout plan
mlRouter.post('/workout-plan', async (req, res, next) => {
  try {
    const { userId, preferences } = req.body
    
    const dataContext = await loadDataContext(userId)
    const mlResults = await processML(userId, dataContext)
    
    const workoutPlan = await generateAIWorkoutPlan(userId, dataContext, preferences)
    
    res.json({
      success: true,
      plan: workoutPlan
    })
  } catch (error) {
    next(error)
  }
})

// Generate nutrition plan
mlRouter.post('/nutrition-plan', async (req, res, next) => {
  try {
    const { userId, goals } = req.body
    
    const dataContext = await loadDataContext(userId)
    const nutritionPlan = await generateAINutritionPlan(userId, dataContext, goals)
    
    res.json({
      success: true,
      plan: nutritionPlan
    })
  } catch (error) {
    next(error)
  }
})

// Generate weekly summary
mlRouter.post('/weekly-summary', async (req, res, next) => {
  try {
    const { userId, week } = req.body
    
    const dataContext = await loadDataContext(userId, { week })
    const mlResults = await processML(userId, dataContext)
    
    const summary = await generateAIWeeklySummary(userId, dataContext.weekData, mlResults)
    
    res.json({
      success: true,
      summary
    })
  } catch (error) {
    next(error)
  }
})

// Generate insights
mlRouter.post('/insights', async (req, res, next) => {
  try {
    const { userId } = req.body
    
    const dataContext = await loadDataContext(userId)
    const mlResults = await processML(userId, dataContext)
    
    const insights = await generateAIInsights(userId, dataContext, mlResults)
    
    res.json({
      success: true,
      insights
    })
  } catch (error) {
    next(error)
  }
})

// Interpret user prompt
mlRouter.post('/interpret', async (req, res, next) => {
  try {
    const { userId, prompt } = req.body
    
    const dataContext = await loadDataContext(userId)
    const interpretation = await interpretPrompt(userId, prompt, dataContext)
    
    res.json({
      success: true,
      interpretation
    })
  } catch (error) {
    next(error)
  }
})

async function loadDataContext(userId, filters = {}) {
  const endDate = filters.endDate || new Date().toISOString().split('T')[0]
  const startDate = filters.startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  
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
    user: user?.[0] || null,
    weekData: filters.week || null
  }
}

