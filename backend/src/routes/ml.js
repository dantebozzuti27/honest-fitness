/**
 * ML/AI Engine Routes
 */

import express from 'express'
import { createClient } from '@supabase/supabase-js'
import { processML } from '../engines/ml/index.js'
import { generateAIWorkoutPlan, generateAINutritionPlan, generateAIWeeklySummary, generateAIInsights, generateAIPageInsights, interpretPrompt } from '../engines/ai/index.js'
import { getFromDatabase } from '../database/index.js'
import { mlLimiter } from '../middleware/rateLimiter.js'
import { logError, logMetric } from '../utils/logger.js'

export const mlRouter = express.Router()
let metricsSupabase = null
let metricsSupabaseInit = false

function getMetricsSupabase() {
  if (metricsSupabase) return metricsSupabase
  if (metricsSupabaseInit) return null
  metricsSupabaseInit = true

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  metricsSupabase = createClient(url, key)
  return metricsSupabase
}

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
      dataQuality: dataContext.dataQuality,
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

// Basic weekly model-quality telemetry for user-facing diagnostics
mlRouter.get('/metrics/model-quality', async (req, res, next) => {
  try {
    const userId = req.userId
    const days = Math.max(1, Math.min(90, Number(req.query?.days) || 7))
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

    const supabase = getMetricsSupabase()
    if (!supabase) {
      return res.status(500).json({ success: false, message: 'Metrics DB client unavailable' })
    }

    const [{ data: outcomes, error: outcomesError }, { data: workouts, error: workoutsError }] = await Promise.all([
      supabase
        .from('workout_outcomes')
        .select('session_outcome_score, outcome_notes, workout_date')
        .eq('user_id', userId)
        .gte('workout_date', startDate),
      supabase
        .from('workouts')
        .select('id, generated_workout_id, date')
        .eq('user_id', userId)
        .gte('date', startDate)
    ])

    if (outcomesError) throw outcomesError
    if (workoutsError) throw workoutsError

    const scores = (outcomes || [])
      .map(o => Number(o.session_outcome_score))
      .filter(v => Number.isFinite(v))

    const confidenceBuckets = { high: 0, medium: 0, low: 0, unknown: 0 }
    for (const o of (outcomes || [])) {
      const note = String(o.outcome_notes || '').toLowerCase()
      if (note.includes('high_confidence')) confidenceBuckets.high++
      else if (note.includes('medium_confidence')) confidenceBuckets.medium++
      else if (note.includes('low_confidence')) confidenceBuckets.low++
      else confidenceBuckets.unknown++
    }

    const linkedGenerated = (workouts || []).filter(w => !!w.generated_workout_id).length
    const totalWorkouts = (workouts || []).length
    const generatedCoverage = totalWorkouts > 0 ? linkedGenerated / totalWorkouts : 0
    const avgOutcomeScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0

    logMetric('model_quality_avg_outcome_score', avgOutcomeScore, { userId, days })
    logMetric('model_quality_generated_coverage', generatedCoverage, { userId, days })

    res.json({
      success: true,
      windowDays: days,
      summary: {
        avgOutcomeScore,
        outcomeSampleSize: scores.length,
        totalWorkouts,
        generatedCoverage
      },
      confidenceBuckets
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
    
    const dataQuality = computeWearableDataQuality(health || [])

    return {
      workouts: workouts || [],
      nutrition: nutrition || [],
      health: health || [],
      user: user?.[0] || null,
      weekData: filters.week || null,
      dataQuality
    }
  } catch (error) {
    logError('Error in loadDataContext', error)
    throw new Error(`Failed to load data context: ${error.message}`)
  }
}

function computeWearableDataQuality(healthRows = []) {
  const rows = Array.isArray(healthRows) ? healthRows : []
  if (rows.length === 0) {
    return { score: 0, completeness: 0, coverageDays: 0, usableForModel: false }
  }

  const core = ['sleep_duration', 'hrv', 'resting_heart_rate', 'steps']
  const present = rows.map((r) => core.reduce((acc, k) => acc + (r?.[k] != null ? 1 : 0), 0) / core.length)
  const completeness = present.reduce((a, b) => a + b, 0) / present.length

  const dateSet = new Set(rows.map((r) => String(r?.date || '')).filter(Boolean))
  const coverageDays = dateSet.size
  const coverage = Math.max(0, Math.min(1, coverageDays / 21))

  const score = Math.max(0, Math.min(1, completeness * 0.7 + coverage * 0.3))
  return {
    score,
    completeness,
    coverageDays,
    usableForModel: score >= 0.4
  }
}

