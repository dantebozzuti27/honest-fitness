import { extractUser } from '../_shared/auth.js'
import { query } from '../_shared/db.js'

/**
 * Fitbit Data Sync Handler
 * Handles two actions:
 *   1. Default (daily sync): Proxies Fitbit API calls for a date.
 *   2. action='workout-metrics': Fetches intraday HR/steps/calories for a time window.
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: { message: 'Method not allowed', status: 405 } })
  }

  const { action } = req.body || {}

  if (action === 'workout-metrics') {
    return handleWorkoutMetrics(req, res)
  }

  const { date } = req.body || {}
  if (!date) {
    return res.status(400).json({ success: false, error: { message: 'Missing date', status: 400 } })
  }

  let userId = null

  try {
    const user = await extractUser(req)
    if (!user) {
      return res.status(401).json({ success: false, error: { message: 'Missing or invalid authorization', status: 401 } })
    }
    userId = user.id

    // Validate date format
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, error: { message: 'Invalid date format (expected YYYY-MM-DD)', status: 400 } })
    }

    // Get connected account
    const { rows: accountRows } = await query(
      'SELECT * FROM connected_accounts WHERE user_id = $1 AND provider = $2',
      [userId, 'fitbit']
    )
    const account = accountRows[0]

    if (!account) {
      return res.status(404).json({ success: false, error: { message: 'Fitbit account not connected', status: 404 } })
    }

    // Check if token needs refresh (refresh if expires within 10 minutes)
    const expiresAt = account.expires_at ? new Date(account.expires_at) : null
    const now = new Date()
    let accessToken = account.access_token
    let tokenRefreshed = false

    // Check if Fitbit credentials are configured
    if (!process.env.FITBIT_CLIENT_ID || !process.env.FITBIT_CLIENT_SECRET) {
      console.error('Missing Fitbit credentials:', {
        hasClientId: !!process.env.FITBIT_CLIENT_ID,
        hasSecret: !!process.env.FITBIT_CLIENT_SECRET
      })
      return res.status(500).json({
        error: 'Fitbit integration not configured',
        message: 'Server configuration error. Please contact support.',
        success: false
      })
    }
    
    if (!expiresAt || expiresAt <= new Date(now.getTime() + 10 * 60 * 1000)) {
      // Refresh token proactively
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

        if (tokenResponse.ok) {
          const tokenData = await tokenResponse.json()
          accessToken = tokenData.access_token
          tokenRefreshed = true
          
          // Update tokens in database
          const newExpiresAt = new Date()
          newExpiresAt.setSeconds(newExpiresAt.getSeconds() + (tokenData.expires_in || 28800))
          
          try {
            await query(
              `UPDATE connected_accounts
               SET access_token = $1, refresh_token = $2, expires_at = $3, updated_at = $4
               WHERE user_id = $5 AND provider = $6`,
              [tokenData.access_token, tokenData.refresh_token, newExpiresAt.toISOString(),
               new Date().toISOString(), userId, 'fitbit']
            )
          } catch (updateError) {
            console.error('Error updating refreshed token:', updateError)
          }
        } else {
          // If refresh fails, throw error - don't continue with expired token
          const errorText = await tokenResponse.text().catch(() => '')
          let errorData = {}
          try {
            errorData = JSON.parse(errorText)
          } catch (e) {
            errorData = { error: errorText || 'Unknown error' }
          }
          console.error('Token refresh failed:', {
            status: tokenResponse.status,
            statusText: tokenResponse.statusText,
            error: errorData
          })
          throw new Error(`Token refresh failed: ${errorData.error_description || errorData.error || 'Please reconnect your Fitbit account.'}`)
        }
      } catch (refreshError) {
        console.error('Error during token refresh:', refreshError)
        throw new Error(refreshError.message || 'Token refresh failed. Please reconnect your Fitbit account.')
      }
    }
    
    if (!accessToken) {
      throw new Error('No access token available. Please reconnect your Fitbit account.')
    }

    // Fetch Fitbit data
    const fitbitData = {}

    // Fetch sleep data
    try {
      const sleepResponse = await fetch(
        `https://api.fitbit.com/1.2/user/-/sleep/date/${date}.json`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        }
      )
      
      if (sleepResponse.ok) {
        const sleepJson = await sleepResponse.json()
        if (sleepJson.sleep && sleepJson.sleep.length > 0) {
          const sleep = sleepJson.sleep[0]
          fitbitData.sleep_duration = sleep.minutesAsleep != null ? Number(sleep.minutesAsleep) : null
          fitbitData.sleep_efficiency = sleep.efficiency != null ? Number(sleep.efficiency) : null
        }
      }
    } catch (e) {
      console.error('Error fetching sleep:', e)
    }

    // Fetch heart rate data
    try {
      const hrResponse = await fetch(
        `https://api.fitbit.com/1/user/-/activities/heart/date/${date}/1d.json`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        }
      )
      
      if (hrResponse.ok) {
        const hrJson = await hrResponse.json()
        if (hrJson['activities-heart'] && hrJson['activities-heart'].length > 0) {
          const heartData = hrJson['activities-heart'][0].value
          fitbitData.resting_heart_rate = heartData?.restingHeartRate != null ? Number(heartData.restingHeartRate) : null
          if (heartData?.heartRateZones && Array.isArray(heartData.heartRateZones)) {
            const zones = {}
            for (const z of heartData.heartRateZones) {
              if (z.name && z.minutes != null) zones[z.name] = Number(z.minutes)
            }
            if (Object.keys(zones).length > 0) fitbitData.hr_zones_minutes = zones
          }

          // Extract HR zone minutes (Fat Burn, Cardio, Peak, Out of Range)
          if (heartData?.heartRateZones && Array.isArray(heartData.heartRateZones)) {
            const zones = {}
            for (const zone of heartData.heartRateZones) {
              if (zone.name && zone.minutes != null) {
                zones[zone.name] = Number(zone.minutes)
              }
            }
            if (Object.keys(zones).length > 0) {
              fitbitData.hr_zones_minutes = zones
            }
          }
        }
      } else if (hrResponse.status === 401 || hrResponse.status === 403) {
        const errorText = await hrResponse.text().catch(() => '')
        throw new Error(`Authorization failed: ${hrResponse.status}. ${errorText}`)
      }
    } catch (e) {
      console.error('Error fetching heart rate:', e)
    }

    // Fetch HRV data
    try {
      const hrvResponse = await fetch(
        `https://api.fitbit.com/1/user/-/hrv/date/${date}.json`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        }
      )
      
      if (hrvResponse.ok) {
        const hrvJson = await hrvResponse.json()
        if (hrvJson.hrv && hrvJson.hrv.length > 0) {
          const hrvValues = hrvJson.hrv
            .map(entry => entry.value?.dailyRmssd || entry.value?.rmssd)
            .filter(v => v != null)
          
          if (hrvValues.length > 0) {
            const avgHRV = hrvValues.reduce((a, b) => a + b, 0) / hrvValues.length
            fitbitData.hrv = avgHRV
          }
        }
      }
    } catch (e) {
      console.error('Error fetching HRV:', e)
    }

    // Fetch activity data
    try {
      const activityResponse = await fetch(
        `https://api.fitbit.com/1/user/-/activities/date/${date}.json`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        }
      )
      
      if (activityResponse.ok) {
        const activityJson = await activityResponse.json()
        const summary = activityJson.summary || {}
        // Ensure steps is always an integer, handle string conversion
        const stepsValue = summary.steps
        if (stepsValue != null && stepsValue !== '') {
          const num = typeof stepsValue === 'string' ? parseFloat(stepsValue) : Number(stepsValue)
          fitbitData.steps = isNaN(num) ? null : Math.round(num)
        } else {
          fitbitData.steps = null
        }
        fitbitData.calories = summary.caloriesOut != null ? Number(summary.caloriesOut) : null
        fitbitData.active_calories = summary.activityCalories != null ? Number(summary.activityCalories) : null
        fitbitData.distance = summary.distances && summary.distances.length > 0 && summary.distances[0].distance != null
          ? Number(summary.distances[0].distance) 
          : null
        fitbitData.sedentary_minutes = summary.sedentaryMinutes != null ? Number(summary.sedentaryMinutes) : null
        fitbitData.lightly_active_minutes = summary.lightlyActiveMinutes != null ? Number(summary.lightlyActiveMinutes) : null
        fitbitData.fairly_active_minutes = summary.fairlyActiveMinutes != null ? Number(summary.fairlyActiveMinutes) : null
        fitbitData.very_active_minutes = summary.veryActiveMinutes != null ? Number(summary.veryActiveMinutes) : null
        fitbitData.floors = summary.floors != null ? Number(summary.floors) : null

        // Activity zone minutes
        fitbitData.sedentary_minutes = summary.sedentaryMinutes != null ? Number(summary.sedentaryMinutes) : null
        fitbitData.lightly_active_minutes = summary.lightlyActiveMinutes != null ? Number(summary.lightlyActiveMinutes) : null
        fitbitData.fairly_active_minutes = summary.fairlyActiveMinutes != null ? Number(summary.fairlyActiveMinutes) : null
        fitbitData.very_active_minutes = summary.veryActiveMinutes != null ? Number(summary.veryActiveMinutes) : null
        fitbitData.floors = summary.floors != null ? Number(summary.floors) : null
      } else if (activityResponse.status === 401 || activityResponse.status === 403) {
        const errorText = await activityResponse.text().catch(() => '')
        throw new Error(`Authorization failed: ${activityResponse.status}. Please reconnect your Fitbit account.`)
      } else {
        const errorText = await activityResponse.text().catch(() => '')
        console.warn(`Activity API error ${activityResponse.status}:`, errorText)
      }
    } catch (e) {
      console.error('Error fetching activity:', e)
      if (e.message?.includes('Authorization failed')) {
        throw e
      }
    }
    
    // Body weight is NOT fetched from Fitbit — user enters weight manually

    // Helper to ensure integer conversion
    const toInteger = (val) => {
      if (val === null || val === undefined || val === '') return null
      const num = typeof val === 'string' ? parseFloat(val) : Number(val)
      return isNaN(num) ? null : Math.round(num)
    }
    
    const saveData = {
      user_id: userId,
      date: date,
      hrv: fitbitData.hrv != null ? Number(fitbitData.hrv) : null,
      resting_heart_rate: fitbitData.resting_heart_rate != null ? Number(fitbitData.resting_heart_rate) : null,
      sleep_duration: fitbitData.sleep_duration != null ? Number(fitbitData.sleep_duration) : null,
      sleep_efficiency: fitbitData.sleep_efficiency != null ? Number(fitbitData.sleep_efficiency) : null,
      steps: toInteger(fitbitData.steps),
      calories: fitbitData.calories != null ? Number(fitbitData.calories) : null,
      active_calories: fitbitData.active_calories != null ? Number(fitbitData.active_calories) : null,
      distance: fitbitData.distance != null ? Number(fitbitData.distance) : null,
      updated_at: new Date().toISOString()
    }
    
    // Check if there's an existing manual weight entry for this date
    let existingManualWeight = null
    let existingSourceProvider = null
    try {
      const { rows } = await query(
        'SELECT weight, source_provider FROM health_metrics WHERE user_id = $1 AND date = $2',
        [userId, date]
      )
      const existingRow = rows[0]
      if (existingRow?.weight != null && existingRow.source_provider === 'manual') {
        existingManualWeight = existingRow.weight
      }
      existingSourceProvider = existingRow?.source_provider ?? null
    } catch (_) {}

    const sourceData = {
      sleep_efficiency: fitbitData.sleep_efficiency != null ? Number(fitbitData.sleep_efficiency) : null,
      active_calories: fitbitData.active_calories != null ? Number(fitbitData.active_calories) : null,
      distance: fitbitData.distance != null ? Number(fitbitData.distance) : null,
      floors: fitbitData.floors || null,
      average_heart_rate: fitbitData.average_heart_rate || null,
      sedentary_minutes: fitbitData.sedentary_minutes || null,
      lightly_active_minutes: fitbitData.lightly_active_minutes || null,
      fairly_active_minutes: fitbitData.fairly_active_minutes || null,
      very_active_minutes: fitbitData.very_active_minutes || null,
      marginal_calories: fitbitData.marginal_calories || null,
      weight: fitbitData.weight || null,
      bmi: fitbitData.bmi || null,
      fat: fitbitData.fat || null
    }

    // Never write Fitbit weight to the primary weight column.
    // Weight must only come from manual user entry (Home page or Profile).
    // Fitbit body weight data is stored in source_data for reference only.
    // COALESCE in the ON CONFLICT clause preserves existing manual weight.
    try {
      await query(
        `INSERT INTO health_metrics
           (user_id, date, resting_heart_rate, hrv, body_temp, sleep_duration,
            calories_burned, steps, source_provider, source_data, weight, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)
         ON CONFLICT (user_id, date) DO UPDATE SET
           resting_heart_rate = EXCLUDED.resting_heart_rate,
           hrv = EXCLUDED.hrv,
           body_temp = EXCLUDED.body_temp,
           sleep_duration = EXCLUDED.sleep_duration,
           calories_burned = EXCLUDED.calories_burned,
           steps = EXCLUDED.steps,
           source_provider = EXCLUDED.source_provider,
           source_data = EXCLUDED.source_data,
           weight = COALESCE(EXCLUDED.weight, health_metrics.weight),
           updated_at = EXCLUDED.updated_at`,
        [
          userId, date,
          fitbitData.resting_heart_rate != null ? Number(fitbitData.resting_heart_rate) : null,
          fitbitData.hrv != null ? Number(fitbitData.hrv) : null,
          fitbitData.body_temp != null ? Number(fitbitData.body_temp) : null,
          fitbitData.sleep_duration != null ? Number(fitbitData.sleep_duration) : null,
          fitbitData.calories != null ? Number(fitbitData.calories) : null,
          toInteger(fitbitData.steps),
          existingSourceProvider === 'manual' ? 'manual' : 'fitbit',
          JSON.stringify(sourceData),
          existingManualWeight,
          new Date().toISOString()
        ]
      )
    } catch (healthMetricsError) {
      console.error('Error saving Fitbit data to health_metrics:', healthMetricsError)
      return res.status(500).json({
        success: false,
        error: { message: 'Failed to save data', status: 500 },
        details: process.env.NODE_ENV === 'development' ? healthMetricsError.message : undefined
      })
    }

    // Also save to fitbit_daily for backward compatibility (deprecated)
    try {
      await query(
        `INSERT INTO fitbit_daily
           (user_id, date, hrv, resting_heart_rate, sleep_duration, sleep_efficiency,
            steps, calories, active_calories, distance, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (user_id, date) DO UPDATE SET
           hrv = EXCLUDED.hrv,
           resting_heart_rate = EXCLUDED.resting_heart_rate,
           sleep_duration = EXCLUDED.sleep_duration,
           sleep_efficiency = EXCLUDED.sleep_efficiency,
           steps = EXCLUDED.steps,
           calories = EXCLUDED.calories,
           active_calories = EXCLUDED.active_calories,
           distance = EXCLUDED.distance,
           updated_at = EXCLUDED.updated_at`,
        [userId, date, saveData.hrv, saveData.resting_heart_rate,
         saveData.sleep_duration, saveData.sleep_efficiency,
         saveData.steps, saveData.calories,
         saveData.active_calories, saveData.distance,
         saveData.updated_at]
      )
    } catch (legacyError) {
      console.error('Error saving to fitbit_daily (deprecated):', legacyError)
    }

    const coreMetrics = ['sleep_duration', 'resting_heart_rate', 'steps', 'hrv']
    const populatedCount = coreMetrics.filter(k => fitbitData[k] != null).length
    const partialFailure = populatedCount < coreMetrics.length && populatedCount > 0

    return res.status(200).json({
      success: true,
      synced: true,
      partial_failure: partialFailure,
      date: date,
      data: fitbitData
    })

  } catch (error) {
    console.error('Fitbit sync error:', {
      userId,
      date,
      error: error?.message || String(error),
      stack: error?.stack
    })
    
    let statusCode = 500
    let errorMessage = 'Failed to sync Fitbit data'
    
    // Safely get error message as string
    const errorMsg = typeof error?.message === 'string' ? error.message : String(error || 'Unknown error')
    
    if (errorMsg.includes('authorization') || errorMsg.includes('reconnect') || errorMsg.includes('401') || errorMsg.includes('403')) {
      statusCode = 401
      errorMessage = 'Fitbit authorization expired. Please reconnect your account.'
    } else if (errorMsg.includes('not connected') || errorMsg.includes('404') || errorMsg.includes('not found')) {
      statusCode = 404
      errorMessage = 'Fitbit account not connected'
    } else if (errorMsg && errorMsg !== 'Unknown error') {
      errorMessage = errorMsg
    }
    
    return res.status(statusCode).json({
      success: false,
      error: { message: errorMessage, status: statusCode },
      details: process.env.NODE_ENV === 'development' ? errorMsg : undefined
    })
  }
}

/**
 * Intraday workout metrics: HR, steps, calories for a specific time window.
 * POST { action: 'workout-metrics', date: 'YYYY-MM-DD', startTime: 'HH:mm', endTime: 'HH:mm' }
 */
async function handleWorkoutMetrics(req, res) {
  const { date, startTime, endTime } = req.body || {}
  const timeRe = /^\d{2}:\d{2}$/

  if (!date || !startTime || !endTime) {
    return res.status(400).json({ success: false, error: { message: 'Missing date, startTime, or endTime' } })
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !timeRe.test(startTime) || !timeRe.test(endTime)) {
    return res.status(400).json({ success: false, error: { message: 'Invalid format. date=YYYY-MM-DD, startTime/endTime=HH:mm' } })
  }

  try {
    const user = await extractUser(req)
    if (!user) {
      return res.status(401).json({ success: false, error: { message: 'Missing or invalid authorization' } })
    }

    const { rows: accountRows } = await query(
      'SELECT access_token, refresh_token, expires_at FROM connected_accounts WHERE user_id = $1 AND provider = $2',
      [user.id, 'fitbit']
    )
    const account = accountRows[0]

    if (!account?.access_token) {
      return res.status(404).json({ success: false, error: { message: 'Fitbit not connected' } })
    }

    let accessToken = account.access_token
    const expiresAt = account.expires_at ? new Date(account.expires_at) : null
    if (!expiresAt || expiresAt <= new Date(Date.now() + 10 * 60 * 1000)) {
      const clientId = process.env.FITBIT_CLIENT_ID
      const clientSecret = process.env.FITBIT_CLIENT_SECRET
      if (clientId && clientSecret && account.refresh_token) {
        try {
          const tokenRes = await fetch('https://api.fitbit.com/oauth2/token', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
            },
            body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: account.refresh_token })
          })
          if (tokenRes.ok) {
            const td = await tokenRes.json()
            accessToken = td.access_token
            const newExpires = new Date()
            newExpires.setSeconds(newExpires.getSeconds() + (td.expires_in || 28800))
            await query(
              `UPDATE connected_accounts
               SET access_token = $1, refresh_token = $2, expires_at = $3, updated_at = $4
               WHERE user_id = $5 AND provider = $6`,
              [td.access_token, td.refresh_token, newExpires.toISOString(),
               new Date().toISOString(), user.id, 'fitbit']
            )
          }
        } catch (_) { /* proceed with existing token */ }
      }
    }

    const headers = { Authorization: `Bearer ${accessToken}` }

    const [hrRes, stepsRes, caloriesRes] = await Promise.all([
      fetch(`https://api.fitbit.com/1/user/-/activities/heart/date/${date}/1d/1min/time/${startTime}/${endTime}.json`, { headers }).catch(() => null),
      fetch(`https://api.fitbit.com/1/user/-/activities/steps/date/${date}/1d/1min/time/${startTime}/${endTime}.json`, { headers }).catch(() => null),
      fetch(`https://api.fitbit.com/1/user/-/activities/calories/date/${date}/1d/1min/time/${startTime}/${endTime}.json`, { headers }).catch(() => null),
    ])

    const metrics = { avgHr: null, peakHr: null, totalSteps: null, totalCalories: null, activeMinutes: null, hrZones: null, hrTimeline: null, durationMinutes: null }

    if (hrRes?.ok) {
      try {
        const hrJson = await hrRes.json()
        const dataset = hrJson?.['activities-heart-intraday']?.dataset || []
        if (dataset.length > 0) {
          const values = dataset.map(d => d.value).filter(v => typeof v === 'number' && v > 0)
          if (values.length > 0) {
            metrics.avgHr = Math.round(values.reduce((a, b) => a + b, 0) / values.length)
            metrics.peakHr = Math.max(...values)
            metrics.durationMinutes = dataset.length
            const zones = { rest: 0, fatBurn: 0, cardio: 0, peak: 0 }
            for (const v of values) {
              if (v < 100) zones.rest++
              else if (v < 130) zones.fatBurn++
              else if (v < 155) zones.cardio++
              else zones.peak++
            }
            metrics.hrZones = zones
            const timeline = []
            for (let i = 0; i < dataset.length; i += 5) {
              timeline.push({ time: dataset[i].time, hr: dataset[i].value })
            }
            if (dataset.length > 0 && (dataset.length - 1) % 5 !== 0) {
              const last = dataset[dataset.length - 1]
              timeline.push({ time: last.time, hr: last.value })
            }
            metrics.hrTimeline = timeline
            metrics.activeMinutes = values.filter(v => v >= 100).length
          }
        }
      } catch (e) { console.error('Error parsing HR intraday:', e) }
    }

    if (stepsRes?.ok) {
      try {
        const stepsJson = await stepsRes.json()
        const dataset = stepsJson?.['activities-steps-intraday']?.dataset || []
        if (dataset.length > 0) {
          metrics.totalSteps = dataset.reduce((sum, d) => sum + (Number(d.value) || 0), 0)
        }
      } catch (e) { console.error('Error parsing steps intraday:', e) }
    }

    if (caloriesRes?.ok) {
      try {
        const calJson = await caloriesRes.json()
        const dataset = calJson?.['activities-calories-intraday']?.dataset || []
        if (dataset.length > 0) {
          metrics.totalCalories = Math.round(dataset.reduce((sum, d) => sum + (Number(d.value) || 0), 0))
        }
      } catch (e) { console.error('Error parsing calories intraday:', e) }
    }

    return res.status(200).json({ success: true, metrics })
  } catch (error) {
    console.error('workout-metrics error:', error)
    return res.status(500).json({ success: false, error: { message: error?.message || 'Failed to fetch workout metrics' } })
  }
}
