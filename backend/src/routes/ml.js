/**
 * ML/AI Engine Routes
 */

import express from 'express'
import { createClient } from '@supabase/supabase-js'
import { processML } from '../engines/ml/index.js'
import { computeReplayRows, evaluateEpisodeMetrics, summarizeReplayPromotion } from '../engines/ml/policyReplay.js'
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

function isFlagEnabled(flagName, fallback = true) {
  const raw = process.env?.[flagName]
  if (raw == null) return fallback
  const normalized = String(raw).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
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

// Evaluate intervention episodes and compute policy-improvement readiness.
mlRouter.get('/policy/episodes/evaluate', async (req, res, next) => {
  try {
    const userId = req.userId
    const supabase = getMetricsSupabase()
    if (!supabase) {
      return res.status(500).json({ success: false, message: 'Metrics DB client unavailable' })
    }

    const limit = Math.max(1, Math.min(100, Number(req.query?.limit) || 30))
    const { data: episodes, error: episodesError } = await supabase
      .from('intervention_episodes')
      .select('id, episode_key, status, started_on, ended_on, active_policy_params')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (episodesError) throw episodesError

    if (!episodes?.length) {
      return res.json({ success: true, episodes: [], summary: { promoteReady: false, sampleSize: 0 } })
    }

    const episodeIds = episodes.map(e => e.id)
    const { data: outcomes, error: outcomesError } = await supabase
      .from('intervention_episode_outcomes')
      .select('intervention_episode_id, objective_score, regret_score, adherence_score, measured_on')
      .eq('user_id', userId)
      .in('intervention_episode_id', episodeIds)
    if (outcomesError) throw outcomesError

    const evaluated = evaluateEpisodeMetrics(episodes, outcomes)

    const promoteCount = evaluated.filter(e => e.promoteReady).length
    res.json({
      success: true,
      episodes: evaluated,
      summary: {
        sampleSize: evaluated.length,
        promoteReady: promoteCount > 0,
        promoteReadyCount: promoteCount,
      }
    })
  } catch (error) {
    next(error)
  }
})

// Replay/regret execution over historical outcomes with promotion gating.
mlRouter.post('/policy/replay', async (req, res, next) => {
  try {
    const userId = req.userId
    const supabase = getMetricsSupabase()
    if (!supabase) {
      return res.status(500).json({ success: false, message: 'Metrics DB client unavailable' })
    }
    if (!isFlagEnabled('HF_ENABLE_REPLAY_PROMOTIONS', true)) {
      return res.status(403).json({ success: false, message: 'Replay promotions disabled by runtime flag' })
    }

    const baselinePolicyVersion = String(req.body?.baselinePolicyVersion || 'policy_v3_pid_fusion')
    const candidatePolicyVersion = String(req.body?.candidatePolicyVersion || `${baselinePolicyVersion}_candidate`)
    const dateEnd = String(req.body?.dateEnd || new Date().toISOString().slice(0, 10))
    const dateStart = String(
      req.body?.dateStart || new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    )

    const { data: scenario, error: scenarioError } = await supabase
      .from('replay_scenarios')
      .insert({
        user_id: userId,
        scenario_name: `Replay ${candidatePolicyVersion}`,
        baseline_policy_version: baselinePolicyVersion,
        candidate_policy_version: candidatePolicyVersion,
        date_start: dateStart,
        date_end: dateEnd,
        status: 'running',
        config: { mode: 'counterfactual_simple_v1' },
      })
      .select('id')
      .single()
    if (scenarioError) throw scenarioError

    const { data: outcomes, error: outcomesError } = await supabase
      .from('workout_outcomes')
      .select('workout_date, session_outcome_score')
      .eq('user_id', userId)
      .gte('workout_date', dateStart)
      .lte('workout_date', dateEnd)
      .order('workout_date', { ascending: true })
    if (outcomesError) throw outcomesError

    const rows = computeReplayRows(
      outcomes || [],
      userId,
      scenario.id,
      baselinePolicyVersion,
      candidatePolicyVersion
    )

    if (rows.length > 0) {
      const { error: resultsError } = await supabase.from('replay_results').insert(rows)
      if (resultsError) throw resultsError
    }

    const { avgRegretDelta, promote } = summarizeReplayPromotion(rows)

    if (promote && rows.length > 0) {
      await supabase
        .from('replay_results')
        .update({ promoted: true })
        .eq('replay_scenario_id', scenario.id)
        .eq('user_id', userId)
    }

    await supabase
      .from('replay_scenarios')
      .update({
        status: 'completed',
        config: {
          mode: 'counterfactual_simple_v1',
          sampleSize: rows.length,
          avgRegretDelta,
          promote,
        },
      })
      .eq('id', scenario.id)
      .eq('user_id', userId)

    res.json({
      success: true,
      replayScenarioId: scenario.id,
      summary: {
        sampleSize: rows.length,
        avgRegretDelta,
        promote,
      },
    })
  } catch (error) {
    next(error)
  }
})

mlRouter.get('/policy/replay/:scenarioId', async (req, res, next) => {
  try {
    const userId = req.userId
    const scenarioId = req.params.scenarioId
    const supabase = getMetricsSupabase()
    if (!supabase) {
      return res.status(500).json({ success: false, message: 'Metrics DB client unavailable' })
    }

    const [{ data: scenario, error: scenarioError }, { data: results, error: resultsError }] = await Promise.all([
      supabase
        .from('replay_scenarios')
        .select('*')
        .eq('id', scenarioId)
        .eq('user_id', userId)
        .maybeSingle(),
      supabase
        .from('replay_results')
        .select('workout_date, baseline_score, candidate_score, regret_delta, promoted')
        .eq('replay_scenario_id', scenarioId)
        .eq('user_id', userId)
        .order('workout_date', { ascending: true })
    ])
    if (scenarioError) throw scenarioError
    if (resultsError) throw resultsError
    if (!scenario) {
      return res.status(404).json({ success: false, message: 'Replay scenario not found' })
    }

    res.json({
      success: true,
      scenario,
      results: results || [],
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

