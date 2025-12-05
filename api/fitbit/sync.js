/**
 * Fitbit Data Sync Handler
 * Proxies Fitbit API calls to avoid CORS issues
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed', success: false })
  }

  const { userId, date } = req.body

  if (!userId || !date) {
    return res.status(400).json({ message: 'Missing userId or date', success: false })
  }

  try {
    console.log('Fitbit sync request:', { userId, date })
    
    // Validate input
    if (!userId || !date) {
      return res.status(400).json({ 
        message: 'Missing userId or date',
        error: 'Missing required parameters',
        success: false
      })
    }
    
    // Get Fitbit account from Supabase
    const { createClient } = await import('@supabase/supabase-js')
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
    
    if (!supabaseUrl || !supabaseKey) {
      console.error('Missing Supabase credentials:', {
        hasUrl: !!supabaseUrl,
        hasKey: !!supabaseKey
      })
      return res.status(500).json({ 
        message: 'Server configuration error',
        error: 'Missing Supabase credentials',
        success: false
      })
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Get connected account
    const { data: account, error: accountError } = await supabase
      .from('connected_accounts')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', 'fitbit')
      .maybeSingle()

    if (accountError) {
      console.error('Error fetching Fitbit account:', accountError)
      return res.status(500).json({ 
        message: 'Database error',
        error: accountError.message,
        success: false
      })
    }

    if (!account) {
      console.error('Fitbit account not found for user:', userId)
      return res.status(404).json({ 
        message: 'Fitbit account not connected',
        error: 'Fitbit account not connected',
        success: false
      })
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
          fitbitData.sleep_duration = sleep.minutesAsleep || null
          fitbitData.sleep_efficiency = sleep.efficiency || null
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
          fitbitData.resting_heart_rate = heartData?.restingHeartRate || null
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
        fitbitData.steps = summary.steps || null
        fitbitData.calories = summary.caloriesOut || null
        fitbitData.active_calories = summary.activityCalories || null
        fitbitData.distance = summary.distances && summary.distances.length > 0 
          ? summary.distances[0].distance || null 
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
    
    // Save to fitbit_daily table - only sync metrics we're actually using
    const saveData = {
      user_id: userId,
      date: date,
      hrv: fitbitData.hrv || null,
      resting_heart_rate: fitbitData.resting_heart_rate || null,
      sleep_duration: fitbitData.sleep_duration || null,
      sleep_efficiency: fitbitData.sleep_efficiency || null,
      steps: fitbitData.steps || null,
      calories: fitbitData.calories || null,
      active_calories: fitbitData.active_calories || null,
      distance: fitbitData.distance || null,
      updated_at: new Date().toISOString()
    }
    
    // Save to fitbit_daily table
    const { error: saveError } = await supabase
      .from('fitbit_daily')
      .upsert(saveData, { onConflict: 'user_id,date' })

    if (saveError) {
      console.error('Error saving Fitbit data:', saveError)
      return res.status(500).json({ 
        message: 'Failed to save data',
        error: saveError 
      })
    }

    // Also merge into daily_metrics for use in workout page
    try {
      const merged = {
        hrv: fitbitData.hrv || null,
        sleep_time: fitbitData.sleep_duration || null,
        sleep_score: fitbitData.sleep_efficiency ? Math.round(fitbitData.sleep_efficiency) : null,
        steps: fitbitData.steps || null,
        calories: fitbitData.calories || fitbitData.active_calories || null,
        weight: null
      }
      
      // Update daily_metrics - only if we have data
      if (merged.hrv || merged.sleep_time || merged.steps || merged.calories) {
        const { error: metricsError } = await supabase
          .from('daily_metrics')
          .upsert({
            user_id: userId,
            date: date,
            sleep_score: merged.sleep_score,
            sleep_time: merged.sleep_time,
            hrv: merged.hrv,
            steps: merged.steps,
            calories: merged.calories,
            weight: null
          }, { onConflict: 'user_id,date' })
        
        if (metricsError) {
          console.error('Error merging to daily_metrics:', metricsError)
        }
      }
    } catch (mergeError) {
      console.error('Error merging wearable data:', mergeError)
      // Don't fail the request if merge fails
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
      error: errorMessage,
      success: false,
      message: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    })
  }
}

