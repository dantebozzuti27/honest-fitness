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
    
    // Validate Supabase connection
    if (!supabase) {
      return res.status(500).json({ error: 'Database connection error' })
    }
    
    // Get Fitbit access token
    const { data: account, error: accountError } = await supabase
      .from('connected_accounts')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', 'fitbit')
      .single()
    
    if (accountError) {
      if (accountError.code === 'PGRST116') {
        return res.status(404).json({ error: 'Fitbit account not connected' })
      }
      throw new Error(`Database error: ${accountError.message}`)
    }
    
    if (!account) {
      return res.status(404).json({ error: 'Fitbit account not connected' })
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
        
        const { error: updateError } = await supabase
          .from('connected_accounts')
          .update({
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
            expires_at: newExpiresAt.toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('user_id', userId)
          .eq('provider', 'fitbit')
        
        if (updateError) {
          throw new Error(`Failed to update tokens: ${updateError.message}`)
        }
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
    const { error: fitbitDailyError } = await supabase
      .from('fitbit_daily')
      .upsert({
        user_id: userId,
        date: date,
        ...fitbitData,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,date' })
    
    if (fitbitDailyError) {
      throw new Error(`Failed to save Fitbit data: ${fitbitDailyError.message}`)
    }
    
    // Also merge into daily_metrics
    const { error: metricsError } = await supabase
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
    
    if (metricsError) {
      // Log but don't fail - metrics update is secondary
      console.error('Failed to update daily_metrics:', metricsError)
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
      error: errorMessage,
      success: false,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    })
  }
})

