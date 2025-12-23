/**
 * Fitbit Data Sync Handler
 * Proxies Fitbit API calls to avoid CORS issues
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: { message: 'Method not allowed', status: 405 } })
  }

  const { date } = req.body || {}
  if (!date) {
    return res.status(400).json({ success: false, error: { message: 'Missing date', status: 400 } })
  }

  try {
    // Auth required; derive userId from JWT (never trust body userId)
    const authHeader = req.headers?.authorization || req.headers?.Authorization
    if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: { message: 'Missing authorization', status: 401 } })
    }
    const token = authHeader.slice('Bearer '.length).trim()
    if (!token) {
      return res.status(401).json({ success: false, error: { message: 'Missing authorization token', status: 401 } })
    }
    
    // Validate date format
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, error: { message: 'Invalid date format (expected YYYY-MM-DD)', status: 400 } })
    }
    
    // Get Fitbit account from Supabase
    // SECURITY: Only use service role key (no fallback to anon key)
    const { createClient } = await import('@supabase/supabase-js')
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    
    if (!supabaseUrl || !supabaseKey) {
      console.error('Missing Supabase credentials:', {
        hasUrl: !!supabaseUrl,
        hasKey: !!supabaseKey
      })
      return res.status(500).json({ success: false, error: { message: 'Server configuration error', status: 500 } })
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey)

    const { data: { user }, error: userErr } = await supabase.auth.getUser(token)
    if (userErr || !user?.id) {
      return res.status(401).json({ success: false, error: { message: 'Invalid or expired token', status: 401 } })
    }
    const userId = user.id

    // Get connected account
    const { data: account, error: accountError } = await supabase
      .from('connected_accounts')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', 'fitbit')
      .maybeSingle()

    if (accountError) {
      console.error('Error fetching Fitbit account:', accountError)
      return res.status(500).json({ success: false, error: { message: 'Database error', status: 500 }, details: accountError.message })
    }

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
    
    // Save to health_metrics table (primary) and fitbit_daily (backward compatibility)
    // Ensure steps is an integer (not a decimal string)
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
      steps: toInteger(fitbitData.steps), // INTEGER - must be whole number, handle string conversion
      calories: fitbitData.calories != null ? Number(fitbitData.calories) : null,
      active_calories: fitbitData.active_calories != null ? Number(fitbitData.active_calories) : null,
      distance: fitbitData.distance != null ? Number(fitbitData.distance) : null,
      updated_at: new Date().toISOString()
    }
    
    // Save to health_metrics table (primary)
    const healthMetricsData = {
      user_id: userId,
      date: date,
      resting_heart_rate: fitbitData.resting_heart_rate != null ? Number(fitbitData.resting_heart_rate) : null,
      hrv: fitbitData.hrv != null ? Number(fitbitData.hrv) : null,
      body_temp: fitbitData.body_temp != null ? Number(fitbitData.body_temp) : null,
      sleep_duration: fitbitData.sleep_duration != null ? Number(fitbitData.sleep_duration) : null,
      calories_burned: fitbitData.calories != null ? Number(fitbitData.calories) : null,
      steps: toInteger(fitbitData.steps), // INTEGER - must be whole number
      source_provider: 'fitbit',
      source_data: {
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
      },
      updated_at: new Date().toISOString()
    }

    const { error: healthMetricsError } = await supabase
      .from('health_metrics')
      .upsert(healthMetricsData, { onConflict: 'user_id,date' })

    if (healthMetricsError) {
      console.error('Error saving Fitbit data to health_metrics:', healthMetricsError)
      return res.status(500).json({
        success: false,
        error: { message: 'Failed to save data', status: 500 },
        details: process.env.NODE_ENV === 'development' ? healthMetricsError : undefined
      })
    }

    // Also save to fitbit_daily for backward compatibility (deprecated)
    try {
      const { error: saveError } = await supabase
        .from('fitbit_daily')
        .upsert(saveData, { onConflict: 'user_id,date' })

      if (saveError) {
        console.error('Error saving to fitbit_daily (deprecated):', saveError)
        // Don't fail - this is just for backward compatibility
      }
    } catch (legacyError) {
      console.error('Error saving to fitbit_daily (deprecated):', legacyError)
      // Don't fail - this is just for backward compatibility
    }

    return res.status(200).json({
      success: true,
      synced: true,
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

