/**
 * ML/AI Engine Routes
 */

import express from 'express'
import { processML } from '../engines/ml/index.js'
import { computeReplayRows, evaluateEpisodeMetrics, summarizeReplayPromotion, evaluatePromotionGate } from '../engines/ml/policyReplay.js'
import { generateAIWorkoutPlan, generateAINutritionPlan, generateAIWeeklySummary, generateAIInsights, generateAIPageInsights, interpretPrompt } from '../engines/ai/index.js'
import { getFromDatabase } from '../database/index.js'
import { query } from '../database/pg.js'
import { mlLimiter } from '../middleware/rateLimiter.js'
import { logError, logMetric } from '../utils/logger.js'

export const mlRouter = express.Router()

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

    const [outcomesResult, workoutsResult] = await Promise.all([
      query('SELECT session_outcome_score, outcome_notes, workout_date FROM workout_outcomes WHERE user_id = $1 AND workout_date >= $2', [userId, startDate]),
      query('SELECT id, generated_workout_id, date FROM workouts WHERE user_id = $1 AND date >= $2', [userId, startDate]),
    ])
    const outcomes = outcomesResult.rows
    const workouts = workoutsResult.rows

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
    const limit = Math.max(1, Math.min(100, Number(req.query?.limit) || 30))
    const episodesResult = await query(
      'SELECT id, episode_key, status, started_on, ended_on, active_policy_params FROM intervention_episodes WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
      [userId, limit]
    )
    const episodes = episodesResult.rows

    if (!episodes?.length) {
      return res.json({ success: true, episodes: [], summary: { promoteReady: false, sampleSize: 0 } })
    }

    const episodeIds = episodes.map(e => e.id)
    const outcomesResult = await query(
      'SELECT intervention_episode_id, objective_score, regret_score, adherence_score, measured_on FROM intervention_episode_outcomes WHERE user_id = $1 AND intervention_episode_id = ANY($2)',
      [userId, episodeIds]
    )
    const outcomes = outcomesResult.rows

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
    if (!isFlagEnabled('HF_ENABLE_REPLAY_PROMOTIONS', true)) {
      return res.status(403).json({ success: false, message: 'Replay promotions disabled by runtime flag' })
    }

    const baselinePolicyVersion = String(req.body?.baselinePolicyVersion || 'policy_v3_pid_fusion')
    const candidatePolicyVersion = String(req.body?.candidatePolicyVersion || `${baselinePolicyVersion}_candidate`)
    const dateEnd = String(req.body?.dateEnd || new Date().toISOString().slice(0, 10))
    const dateStart = String(
      req.body?.dateStart || new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    )

    const scenarioResult = await query(
      `INSERT INTO replay_scenarios (user_id, scenario_name, baseline_policy_version, candidate_policy_version, date_start, date_end, status, config)
       VALUES ($1, $2, $3, $4, $5, $6, 'running', $7) RETURNING id`,
      [userId, `Replay ${candidatePolicyVersion}`, baselinePolicyVersion, candidatePolicyVersion, dateStart, dateEnd, JSON.stringify({ mode: 'counterfactual_simple_v1' })]
    )
    const scenario = scenarioResult.rows[0]

    const outcomesResult = await query(
      'SELECT workout_date, session_outcome_score FROM workout_outcomes WHERE user_id = $1 AND workout_date >= $2 AND workout_date <= $3 ORDER BY workout_date ASC',
      [userId, dateStart, dateEnd]
    )
    const outcomes = outcomesResult.rows

    const rows = computeReplayRows(
      outcomes || [],
      userId,
      scenario.id,
      baselinePolicyVersion,
      candidatePolicyVersion
    )

    if (rows.length > 0) {
      const colsPerRow = 8
      const valueGroups = rows.map((_, i) => {
        const b = i * colsPerRow + 1
        return `($${b}, $${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7})`
      }).join(', ')
      const params = rows.flatMap((row) => [
        row.user_id,
        row.replay_scenario_id,
        row.workout_date,
        row.baseline_score,
        row.candidate_score,
        row.regret_delta,
        row.promoted || false,
        JSON.stringify(row.result_payload || {}),
      ])
      await query(
        `INSERT INTO replay_results (user_id, replay_scenario_id, workout_date, baseline_score, candidate_score, regret_delta, promoted, result_payload)
         VALUES ${valueGroups}`,
        params
      )
    }

    const replaySummary = summarizeReplayPromotion(rows)
    const strictPromotionGates = isFlagEnabled('HF_ENABLE_STRICT_PROMOTION_GATES', true)
    const trustedQualityGate = {}
    const gateDecision = evaluatePromotionGate(
      replaySummary,
      trustedQualityGate,
      { strict: strictPromotionGates, requireQualityMetrics: strictPromotionGates }
    )
    const { avgRegretDelta } = replaySummary
    const promote = gateDecision.promote

    if (promote && rows.length > 0) {
      await query(
        'UPDATE replay_results SET promoted = true WHERE replay_scenario_id = $1 AND user_id = $2',
        [scenario.id, userId]
      )
    }

    await query(
      'UPDATE replay_scenarios SET status = $1, config = $2 WHERE id = $3 AND user_id = $4',
      ['completed', JSON.stringify({
        mode: 'counterfactual_simple_v1',
        sampleSize: rows.length,
        avgRegretDelta,
        promote,
        promotionGateReason: gateDecision.reason,
        strictPromotionGates,
      }), scenario.id, userId]
    )

    res.json({
      success: true,
      replayScenarioId: scenario.id,
      summary: {
        sampleSize: rows.length,
        avgRegretDelta,
        promote,
        promotionGateReason: gateDecision.reason,
        strictPromotionGates,
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
    const [scenarioResult, resultsResult] = await Promise.all([
      query('SELECT * FROM replay_scenarios WHERE id = $1 AND user_id = $2 LIMIT 1', [scenarioId, userId]),
      query('SELECT workout_date, baseline_score, candidate_score, regret_delta, promoted FROM replay_results WHERE replay_scenario_id = $1 AND user_id = $2 ORDER BY workout_date ASC', [scenarioId, userId]),
    ])
    const scenario = scenarioResult.rows[0] || null
    const results = resultsResult.rows
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

