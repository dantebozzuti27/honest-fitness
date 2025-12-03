/**
 * Input Layer Routes
 * Handles all user data input
 */

import express from 'express'
import { normalizeData } from '../layers/abstraction/index.js'
import { processDataPipeline } from '../pipelines/index.js'
import { fetchFitbitData } from '../integrations/fitbit.js'
import { getFromDatabase } from '../database/index.js'
import { createClient } from '@supabase/supabase-js'

export const inputRouter = express.Router()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
)

// Submit workout data
inputRouter.post('/workout', async (req, res, next) => {
  try {
    const result = await processDataPipeline('workout', req.body, 'manual')
    res.json(result)
  } catch (error) {
    next(error)
  }
})

// Submit nutrition data
inputRouter.post('/nutrition', async (req, res, next) => {
  try {
    const result = await processDataPipeline('nutrition', req.body, 'manual')
    res.json(result)
  } catch (error) {
    next(error)
  }
})

// Submit health data
inputRouter.post('/health', async (req, res, next) => {
  try {
    const result = await processDataPipeline('health', req.body, req.body.source || 'manual')
    res.json(result)
  } catch (error) {
    next(error)
  }
})

// Submit user profile data
inputRouter.post('/user', async (req, res, next) => {
  try {
    const result = await processDataPipeline('user', req.body, 'manual')
    res.json(result)
  } catch (error) {
    next(error)
  }
})

// Sync Fitbit data
inputRouter.post('/fitbit/sync', async (req, res, next) => {
  try {
    const { userId, date } = req.body
    
    // Get Fitbit access token
    const { data: account, error: accountError } = await supabase
      .from('connected_accounts')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', 'fitbit')
      .single()
    
    if (accountError || !account) {
      return res.status(404).json({ error: 'Fitbit account not connected' })
    }
    
    // Fetch data from Fitbit
    const fitbitData = await fetchFitbitData(userId, date, account.access_token)
    
    // Normalize and store
    const normalized = await normalizeData('health', {
      userId,
      date,
      source: 'fitbit',
      steps: fitbitData.steps,
      hrv: fitbitData.hrv,
      sleepDuration: fitbitData.sleepDuration,
      sleepEfficiency: fitbitData.sleepEfficiency,
      caloriesBurned: fitbitData.caloriesBurned,
      activeCalories: fitbitData.activeCalories,
      restingHeartRate: fitbitData.restingHeartRate,
      distance: fitbitData.distance,
      floors: fitbitData.floors,
      rawData: fitbitData
    })
    
    const result = await processDataPipeline('health', normalized, 'fitbit')
    
    res.json({
      success: true,
      data: result,
      syncedAt: new Date().toISOString()
    })
  } catch (error) {
    next(error)
  }
})

