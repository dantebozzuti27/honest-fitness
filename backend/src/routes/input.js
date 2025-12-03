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
import { syncLimiter } from '../middleware/rateLimiter.js'

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

// Sync Fitbit data (with rate limiting)
inputRouter.post('/fitbit/sync', syncLimiter, async (req, res, next) => {
  try {
    const { userId, date } = req.body
    
    if (!userId || !date) {
      return res.status(400).json({ error: 'Missing userId or date' })
    }
    
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
    
    // Check if token needs refresh
    const expiresAt = account.expires_at ? new Date(account.expires_at) : null
    const now = new Date()
    let accessToken = account.access_token
    
    if (!expiresAt || expiresAt <= new Date(now.getTime() + 10 * 60 * 1000)) {
      // Refresh token
      try {
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
        
        if (tokenResponse.ok) {
          const tokenData = await tokenResponse.json()
          accessToken = tokenData.access_token
          
          // Update tokens in database
          const newExpiresAt = new Date()
          newExpiresAt.setSeconds(newExpiresAt.getSeconds() + (tokenData.expires_in || 28800))
          
          await supabase
            .from('connected_accounts')
            .update({
              access_token: tokenData.access_token,
              refresh_token: tokenData.refresh_token,
              expires_at: newExpiresAt.toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq('user_id', userId)
            .eq('provider', 'fitbit')
        }
      } catch (refreshError) {
        // Continue with existing token
      }
    }
    
    // Fetch data from Fitbit API directly
    const fitbitData = {}
    
    // Fetch activity data
    try {
      const activityResponse = await fetch(
        `https://api.fitbit.com/1/user/-/activities/date/${date}.json`,
        {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        }
      )
      
      if (activityResponse.ok) {
        const activityJson = await activityResponse.json()
        const summary = activityJson.summary || {}
        fitbitData.steps = summary.steps || null
        fitbitData.calories = summary.caloriesOut || null
        fitbitData.active_calories = summary.activityCalories || null
        fitbitData.distance = summary.distances?.[0]?.distance || null
        fitbitData.floors = summary.floors || null
      }
    } catch (e) {
      // Continue
    }
    
    // Fetch sleep data
    try {
      const sleepResponse = await fetch(
        `https://api.fitbit.com/1.2/user/-/sleep/date/${date}.json`,
        {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        }
      )
      
      if (sleepResponse.ok) {
        const sleepJson = await sleepResponse.json()
        if (sleepJson.sleep?.[0]) {
          const sleep = sleepJson.sleep[0]
          fitbitData.sleep_duration = sleep.minutesAsleep || null
          fitbitData.sleep_efficiency = sleep.efficiency || null
        }
      }
    } catch (e) {
      // Continue
    }
    
    // Fetch HRV data
    try {
      const hrvResponse = await fetch(
        `https://api.fitbit.com/1/user/-/hrv/date/${date}.json`,
        {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        }
      )
      
      if (hrvResponse.ok) {
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
      // Continue
    }
    
    // Fetch heart rate data
    try {
      const hrResponse = await fetch(
        `https://api.fitbit.com/1/user/-/activities/heart/date/${date}/1d.json`,
        {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        }
      )
      
      if (hrResponse.ok) {
        const hrJson = await hrResponse.json()
        if (hrJson['activities-heart']?.[0]?.value) {
          fitbitData.resting_heart_rate = hrJson['activities-heart'][0].value.restingHeartRate || null
        }
      }
    } catch (e) {
      // Continue
    }
    
    // Save to fitbit_daily table
    await supabase
      .from('fitbit_daily')
      .upsert({
        user_id: userId,
        date: date,
        ...fitbitData,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,date' })
    
    // Also merge into daily_metrics
    await supabase
      .from('daily_metrics')
      .upsert({
        user_id: userId,
        date: date,
        steps: fitbitData.steps,
        calories: fitbitData.calories || fitbitData.active_calories,
        hrv: fitbitData.hrv,
        sleep_time: fitbitData.sleep_duration,
        sleep_score: fitbitData.sleep_efficiency ? Math.round(fitbitData.sleep_efficiency) : null
      }, { onConflict: 'user_id,date' })
    
    res.json({
      success: true,
      data: fitbitData,
      syncedAt: new Date().toISOString()
    })
  } catch (error) {
    next(error)
  }
})

