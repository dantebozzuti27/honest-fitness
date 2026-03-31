/**
 * Input Layer Routes
 * Handles all user data input
 */

import express from 'express'
import { normalizeData } from '../layers/abstraction/index.js'
import { processDataPipeline } from '../pipelines/index.js'
import { fetchFitbitData } from '../integrations/fitbit.js'
import { getFromDatabase } from '../database/index.js'
import { query } from '../database/pg.js'
import { syncLimiter } from '../middleware/rateLimiter.js'
import { sendError } from '../utils/http.js'

export const inputRouter = express.Router()

// Submit workout data
inputRouter.post('/workout', async (req, res, next) => {
  try {
    // SECURITY: bind writes to authenticated user; never trust body user_id/userId.
    const result = await processDataPipeline(
      'workout',
      { ...req.body, user_id: req.userId },
      'manual'
    )
    res.json(result)
  } catch (error) {
    next(error)
  }
})

// Submit nutrition data
inputRouter.post('/nutrition', async (req, res, next) => {
  try {
    // SECURITY: bind writes to authenticated user; never trust body user_id/userId.
    const result = await processDataPipeline(
      'nutrition',
      { ...req.body, user_id: req.userId },
      'manual'
    )
    res.json(result)
  } catch (error) {
    next(error)
  }
})

// Submit health data
inputRouter.post('/health', async (req, res, next) => {
  try {
    // SECURITY: bind writes to authenticated user; never trust body user_id/userId.
    const source = req.body?.source || 'manual'
    const result = await processDataPipeline(
      'health',
      { ...req.body, user_id: req.userId },
      source
    )
    res.json(result)
  } catch (error) {
    next(error)
  }
})

// Submit user profile data
inputRouter.post('/user', async (req, res, next) => {
  try {
    // SECURITY: bind writes to authenticated user; never trust body user_id/userId.
    const result = await processDataPipeline(
      'user',
      { ...req.body, user_id: req.userId },
      'manual'
    )
    res.json(result)
  } catch (error) {
    next(error)
  }
})

// Ingest model outcome events from client analytics queue
inputRouter.post('/model-outcome-events', async (req, res, next) => {
  try {
    const userId = req.userId
    const events = Array.isArray(req.body?.events) ? req.body.events : []

    if (events.length === 0) {
      return res.json({ success: true, inserted: 0 })
    }

    const seenKeys = new Set()
    const rows = events
      .slice(0, 100)
      .map((evt) => {
        const data = evt?.data || {}
        const rawScore = data.outcomeScore ?? data.sessionOutcomeScore
        const score = Number(rawScore)
        const normalizedScore = Number.isFinite(score) ? Math.max(0, Math.min(1, score)) : null
        let generatedWorkoutId = data.generatedWorkoutId || data.generated_workout_id || null
        const eventType = typeof evt?.event === 'string' ? evt.event : 'model_outcome_unknown'
        const workoutDate = typeof data.workoutDate === 'string' ? data.workoutDate : null
        const idempotencyKey = evt?.idempotencyKey || evt?.idempotency_key || data?.idempotencyKey || null
        if (generatedWorkoutId && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(generatedWorkoutId)) {
          generatedWorkoutId = null
        }
        return {
          user_id: userId,
          generated_workout_id: generatedWorkoutId,
          workout_date: workoutDate || new Date().toISOString().split('T')[0],
          session_outcome_score: normalizedScore,
          outcome_notes: eventType,
          idempotency_key: idempotencyKey || `${generatedWorkoutId || 'anon'}:${workoutDate || 'nodate'}:${eventType}:${normalizedScore ?? 'x'}`
        }
      })
      .filter(r => {
        if (!(r.generated_workout_id || r.session_outcome_score != null)) return false
        const key = r.idempotency_key
        if (seenKeys.has(key)) return false
        seenKeys.add(key)
        return true
      })

    if (rows.length === 0) {
      return res.json({ success: true, inserted: 0 })
    }

    for (const row of rows) {
      await query(
        `INSERT INTO workout_outcomes (user_id, generated_workout_id, workout_date, session_outcome_score, outcome_notes, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id, idempotency_key) DO NOTHING`,
        [row.user_id, row.generated_workout_id, row.workout_date, row.session_outcome_score, row.outcome_notes, row.idempotency_key]
      )
    }

    return res.json({ success: true, inserted: rows.length })
  } catch (error) {
    next(error)
  }
})

// Sync Fitbit data (with rate limiting)
inputRouter.post('/fitbit/sync', syncLimiter, async (req, res, next) => {
  try {
    // SECURITY: bind to authenticated user; never trust body userId.
    const userId = req.userId
    const { date } = req.body || {}
    
    if (!date) {
      return sendError(res, { status: 400, message: 'Missing date' })
    }
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return sendError(res, { status: 400, message: 'Invalid date format (expected YYYY-MM-DD)' })
    }
    
    // Get Fitbit access token
    const accountResult = await query(
      'SELECT * FROM connected_accounts WHERE user_id = $1 AND provider = $2 LIMIT 1',
      [userId, 'fitbit']
    )
    const account = accountResult.rows[0] || null

    if (!account) {
      return sendError(res, { status: 404, message: 'Fitbit account not connected' })
    }
    
    // Check if Fitbit credentials are configured
    if (!process.env.FITBIT_CLIENT_ID || !process.env.FITBIT_CLIENT_SECRET) {
      throw new Error('Fitbit integration not configured. Please set FITBIT_CLIENT_ID and FITBIT_CLIENT_SECRET environment variables.')
    }
    
    // Check if token needs refresh
    const expiresAt = account.expires_at ? new Date(account.expires_at) : null
    const now = new Date()
    let accessToken = account.access_token
    
    if (!expiresAt || expiresAt <= new Date(now.getTime() + 10 * 60 * 1000)) {
      // Refresh token
      try {
        if (!account.refresh_token) {
          throw new Error('No refresh token available. Please reconnect your Fitbit account.')
        }
        
        const tokenResponse = await fetch('https://api.fitbit.com/oauth2/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${Buffer.from(
              `${process.env.FITBIT_CLIENT_ID}:${process.env.FITBIT_CLIENT_SECRET}`
            ).toString('base64')}`
          },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: account.refresh_token
          })
        })
        
        if (!tokenResponse.ok) {
          const errorData = await tokenResponse.json().catch(() => ({}))
          throw new Error(`Token refresh failed: ${errorData.error_description || errorData.error || 'Unknown error'}. Please reconnect your Fitbit account.`)
        }
        
        const tokenData = await tokenResponse.json()
        accessToken = tokenData.access_token
        
        // Update tokens in database
        const newExpiresAt = new Date()
        newExpiresAt.setSeconds(newExpiresAt.getSeconds() + (tokenData.expires_in || 28800))
        
        await query(
          `UPDATE connected_accounts SET access_token = $1, refresh_token = $2, token_expires_at = $3, updated_at = $4
           WHERE user_id = $5 AND provider = $6`,
          [tokenData.access_token, tokenData.refresh_token, newExpiresAt.toISOString(), new Date().toISOString(), userId, 'fitbit']
        )
      } catch (refreshError) {
        // If refresh fails, throw error instead of continuing with expired token
        throw new Error(refreshError.message || 'Token refresh failed. Please reconnect your Fitbit account.')
      }
    }
    
    // Fetch data from Fitbit API directly
    const fitbitData = {}
    const errors = []
    
    // Fetch activity data
    try {
      const activityResponse = await fetch(
        `https://api.fitbit.com/1/user/-/activities/date/${date}.json`,
        {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        }
      )
      
      if (!activityResponse.ok) {
        const errorText = await activityResponse.text()
        if (activityResponse.status === 401 || activityResponse.status === 403) {
          throw new Error(`Fitbit authorization failed: ${activityResponse.status}. Please reconnect your account.`)
        }
        errors.push(`Activity data: ${activityResponse.status} ${errorText}`)
      } else {
        const activityJson = await activityResponse.json()
        const summary = activityJson.summary || {}
        fitbitData.steps = summary.steps || null
        fitbitData.calories = summary.caloriesOut || null
        fitbitData.active_calories = summary.activityCalories || null
        fitbitData.distance = summary.distances?.[0]?.distance || null
        fitbitData.floors = summary.floors || null
      }
    } catch (e) {
      if (e.message?.includes('authorization failed')) {
        throw e
      }
      errors.push(`Activity: ${e.message}`)
    }
    
    // Fetch sleep data
    try {
      const sleepResponse = await fetch(
        `https://api.fitbit.com/1.2/user/-/sleep/date/${date}.json`,
        {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        }
      )
      
      if (!sleepResponse.ok) {
        const errorText = await sleepResponse.text()
        if (sleepResponse.status === 401 || sleepResponse.status === 403) {
          throw new Error(`Fitbit authorization failed: ${sleepResponse.status}. Please reconnect your account.`)
        }
        errors.push(`Sleep data: ${sleepResponse.status} ${errorText}`)
      } else {
        const sleepJson = await sleepResponse.json()
        if (sleepJson.sleep?.[0]) {
          const sleep = sleepJson.sleep[0]
          fitbitData.sleep_duration = sleep.minutesAsleep || null
          fitbitData.sleep_efficiency = sleep.efficiency || null
        }
      }
    } catch (e) {
      if (e.message?.includes('authorization failed')) {
        throw e
      }
      errors.push(`Sleep: ${e.message}`)
    }
    
    // Fetch HRV data
    try {
      const hrvResponse = await fetch(
        `https://api.fitbit.com/1/user/-/hrv/date/${date}.json`,
        {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        }
      )
      
      if (!hrvResponse.ok) {
        // HRV might not be available for all devices, so we don't throw on error
        if (hrvResponse.status !== 404) {
          errors.push(`HRV: ${hrvResponse.status}`)
        }
      } else {
        const hrvJson = await hrvResponse.json()
        if (hrvJson.hrv?.length > 0) {
          const hrvValues = hrvJson.hrv
            .map(entry => entry.value?.dailyRmssd || entry.value?.rmssd)
            .filter(v => v != null)
          if (hrvValues.length > 0) {
            fitbitData.hrv = hrvValues.reduce((a, b) => a + b, 0) / hrvValues.length
          }
        }
      }
    } catch (e) {
      // HRV is optional, continue
      errors.push(`HRV: ${e.message}`)
    }
    
    // Fetch heart rate data
    try {
      const hrResponse = await fetch(
        `https://api.fitbit.com/1/user/-/activities/heart/date/${date}/1d.json`,
        {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        }
      )
      
      if (!hrResponse.ok) {
        const errorText = await hrResponse.text()
        if (hrResponse.status === 401 || hrResponse.status === 403) {
          throw new Error(`Fitbit authorization failed: ${hrResponse.status}. Please reconnect your account.`)
        }
        errors.push(`Heart rate: ${hrResponse.status} ${errorText}`)
      } else {
        const hrJson = await hrResponse.json()
        if (hrJson['activities-heart']?.[0]?.value) {
          fitbitData.resting_heart_rate = hrJson['activities-heart'][0].value.restingHeartRate || null
        }
      }
    } catch (e) {
      if (e.message?.includes('authorization failed')) {
        throw e
      }
      errors.push(`Heart rate: ${e.message}`)
    }
    
    // If we got authorization errors, throw
    if (errors.some(e => e.includes('401') || e.includes('403'))) {
      throw new Error('Fitbit authorization expired. Please reconnect your account.')
    }
    
    // If we have no data and errors, throw
    if (Object.keys(fitbitData).length === 0 && errors.length > 0) {
      throw new Error(`Failed to fetch Fitbit data: ${errors.join('; ')}`)
    }
    
    // Save to fitbit_daily table
    const fitbitCols = ['user_id', 'date', 'updated_at']
    const fitbitVals = [userId, date, new Date().toISOString()]
    for (const [k, v] of Object.entries(fitbitData)) {
      if (v != null) { fitbitCols.push(k); fitbitVals.push(v) }
    }
    const fitbitPlaceholders = fitbitCols.map((_, i) => `$${i + 1}`).join(', ')
    const fitbitUpdateSet = fitbitCols.filter(c => c !== 'user_id' && c !== 'date').map(c => `"${c}" = EXCLUDED."${c}"`).join(', ')
    await query(
      `INSERT INTO fitbit_daily (${fitbitCols.map(c => `"${c}"`).join(', ')}) VALUES (${fitbitPlaceholders})
       ON CONFLICT (user_id, date) DO UPDATE SET ${fitbitUpdateSet}`,
      fitbitVals
    )

    // Also merge into health_metrics
    try {
      await query(
        `INSERT INTO health_metrics (user_id, date, steps, calories_burned, hrv, sleep_duration, sleep_score, source_provider)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'fitbit')
         ON CONFLICT (user_id, date) DO UPDATE SET
           steps = COALESCE(EXCLUDED.steps, health_metrics.steps),
           calories_burned = COALESCE(EXCLUDED.calories_burned, health_metrics.calories_burned),
           hrv = COALESCE(EXCLUDED.hrv, health_metrics.hrv),
           sleep_duration = COALESCE(EXCLUDED.sleep_duration, health_metrics.sleep_duration),
           sleep_score = COALESCE(EXCLUDED.sleep_score, health_metrics.sleep_score)`,
        [
          userId, date,
          fitbitData.steps != null ? Math.round(Number(fitbitData.steps)) : null,
          (fitbitData.calories || fitbitData.active_calories) != null ? Number(fitbitData.calories || fitbitData.active_calories) : null,
          fitbitData.hrv != null ? Number(fitbitData.hrv) : null,
          fitbitData.sleep_duration != null ? Number(fitbitData.sleep_duration) : null,
          fitbitData.sleep_efficiency != null ? Math.round(Number(fitbitData.sleep_efficiency)) : null
        ]
      )
    } catch (metricsErr) {
      console.error('Failed to update health_metrics:', metricsErr.message)
    }
    
    res.json({
      success: true,
      data: fitbitData,
      syncedAt: new Date().toISOString(),
      warnings: errors.length > 0 ? errors : undefined
    })
  } catch (error) {
    // Log the error for debugging
    console.error('Fitbit sync error:', {
      userId,
      date,
      error: error.message,
      stack: error.stack,
      name: error.name
    })
    
    // Return user-friendly error message
    let statusCode = 500
    let errorMessage = 'Failed to sync Fitbit data'
    
    if (error.message?.includes('authorization') || error.message?.includes('reconnect') || error.message?.includes('401') || error.message?.includes('403')) {
      statusCode = 401
      errorMessage = 'Fitbit authorization expired. Please reconnect your account from the Wearables page.'
    } else if (error.message?.includes('not connected') || error.message?.includes('404') || error.message?.includes('not found')) {
      statusCode = 404
      errorMessage = 'Fitbit account not connected. Please connect your Fitbit account first.'
    } else if (error.message?.includes('not configured') || error.message?.includes('environment variables')) {
      statusCode = 500
      errorMessage = 'Fitbit integration not configured. Please contact support.'
    } else if (error.message) {
      errorMessage = error.message
    }
    
    res.status(statusCode).json({ 
      success: false,
      error: { message: errorMessage, status: statusCode },
      ...(process.env.NODE_ENV === 'development' ? { details: error.message } : {})
    })
  }
})

