/**
 * ML/AI Engine Routes
 */

import express from 'express'
import { processML } from '../engines/ml/index.js'
import { generateAIWorkoutPlan, generateAINutritionPlan, generateAIWeeklySummary, generateAIInsights, generateAIPageInsights, interpretPrompt } from '../engines/ai/index.js'
import { getFromDatabase } from '../database/index.js'
import { mlLimiter } from '../middleware/rateLimiter.js'
import { logError } from '../utils/logger.js'

export const mlRouter = express.Router()

// Apply ML rate limiter to all ML routes
mlRouter.use(mlLimiter)

// Process ML analysis
mlRouter.post('/analyze', async (req, res, next) => {
  try {
    // SECURITY: bind to authenticated user; never trust body userId.
    const userId = req.userId
    const { dateRange } = req.body || {}
    
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
    // SECURITY: bind to authenticated user; never trust body userId.
    const userId = req.userId
    const { preferences } = req.body || {}
    
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
    // SECURITY: bind to authenticated user; never trust body userId.
    const userId = req.userId
    const { goals } = req.body || {}
    
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
    // SECURITY: bind to authenticated user; never trust body userId.
    const userId = req.userId
    const { week } = req.body || {}
    
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
    // SECURITY: bind to authenticated user; never trust body userId.
    const userId = req.userId
    
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

// Page-specific insights
mlRouter.post('/page-insights', async (req, res, next) => {
  try {
    const userId = req.userId
    const { page, context } = req.body || {}

    const pageKey = (page || '').toString().trim()
    if (!pageKey || pageKey.length > 40) {
      return res.status(400).json({ success: false, message: 'Invalid page' })
    }

    const dataContext = await loadDataContext(userId)
    const mlResults = await processML(userId, dataContext)

    const insights = await generateAIPageInsights(userId, dataContext, mlResults, pageKey, context)

    res.json({
      success: true,
      page: pageKey,
      ...insights
    })
  } catch (error) {
    next(error)
  }
})

// Interpret user prompt
mlRouter.post('/interpret', async (req, res, next) => {
  try {
    // SECURITY: bind to authenticated user; never trust body userId.
    const userId = req.userId
    const { prompt } = req.body || {}
    
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
  try {
    if (!userId) {
      throw new Error('User ID is required')
    }
    
    const endDate = filters.endDate || new Date().toISOString().split('T')[0]
    const startDate = filters.startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    
    const [workouts, nutrition, health, user] = await Promise.all([
      getFromDatabase('workout', userId, { startDate, endDate }).catch(err => {
        logError('Error loading workouts', err)
        return []
      }),
      getFromDatabase('nutrition', userId, { startDate, endDate }).catch(err => {
        logError('Error loading nutrition', err)
        return []
      }),
      getFromDatabase('health', userId, { startDate, endDate }).catch(err => {
        logError('Error loading health data', err)
        return []
      }),
      getFromDatabase('user', userId).catch(err => {
        logError('Error loading user data', err)
        return []
      })
    ])
    
    return {
      workouts: workouts || [],
      nutrition: nutrition || [],
      health: health || [],
      user: user?.[0] || null,
      weekData: filters.week || null
    }
  } catch (error) {
    logError('Error in loadDataContext', error)
    throw new Error(`Failed to load data context: ${error.message}`)
  }
}

