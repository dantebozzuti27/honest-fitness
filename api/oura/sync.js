/**
 * Oura Data Sync Handler
 * Proxies Oura API calls to avoid CORS issues
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
    console.log('Oura sync request:', { userId, date })
    
    // Get Oura account from Supabase
    const { createClient } = await import('@supabase/supabase-js')
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
    
    if (!supabaseUrl || !supabaseKey) {
      console.error('Missing Supabase credentials')
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
      .eq('provider', 'oura')
      .single()
    
    if (accountError || !account) {
      return res.status(404).json({ 
        message: 'Oura account not connected',
        error: accountError?.message || 'Account not found',
        success: false
      })
    }

    // Check if token needs refresh
    const expiresAt = account.expires_at ? new Date(account.expires_at) : null
    const now = new Date()
    let accessToken = account.access_token

    if (!expiresAt || expiresAt <= new Date(now.getTime() + 10 * 60 * 1000)) {
      // Token expired or expiring soon, try to refresh
      if (account.refresh_token) {
        try {
          // Call refresh endpoint directly
          const basicAuth = Buffer.from(
            `${process.env.OURA_CLIENT_ID}:${process.env.OURA_CLIENT_SECRET}`
          ).toString('base64')
          
          const refreshResponse = await fetch('https://api.ouraring.com/oauth/token', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Authorization': `Basic ${basicAuth}`
            },
            body: new URLSearchParams({
              grant_type: 'refresh_token',
              refresh_token: account.refresh_token
            })
          })

          if (refreshResponse.ok) {
            const tokenData = await refreshResponse.json()
            accessToken = tokenData.access_token
            
            // Calculate new expiration
            const newExpiresAt = new Date()
            newExpiresAt.setSeconds(newExpiresAt.getSeconds() + (tokenData.expires_in || 86400))
            
            // Update account with new tokens
            await supabase
              .from('connected_accounts')
              .update({
                access_token: tokenData.access_token,
                refresh_token: tokenData.refresh_token || account.refresh_token,
                expires_at: newExpiresAt.toISOString(),
                updated_at: new Date().toISOString()
              })
              .eq('user_id', userId)
              .eq('provider', 'oura')
          }
        } catch (refreshError) {
          console.error('Token refresh failed, using existing token:', refreshError)
        }
      }
    }

    // Fetch daily readiness data
    const readinessResponse = await fetch(
      `https://api.ouraring.com/v2/usercollection/daily_readiness?start_date=${date}&end_date=${date}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      }
    )

    if (!readinessResponse.ok) {
      if (readinessResponse.status === 401) {
        return res.status(401).json({ 
          message: 'Oura token expired. Please reconnect your account.',
          error: 'Token expired',
          success: false
        })
      }
      const errorText = await readinessResponse.text()
      return res.status(readinessResponse.status).json({ 
        message: `Oura API error: ${readinessResponse.statusText}`,
        error: errorText,
        success: false
      })
    }

    const readinessData = await readinessResponse.json()

    // Fetch daily sleep data (summary scores)
    const sleepResponse = await fetch(
      `https://api.ouraring.com/v2/usercollection/daily_sleep?start_date=${date}&end_date=${date}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      }
    )

    let sleepData = null
    if (sleepResponse.ok) {
      sleepData = await sleepResponse.json()
    }

    // Also fetch detailed sleep data (has actual durations)
    const sleepDetailedResponse = await fetch(
      `https://api.ouraring.com/v2/usercollection/sleep?start_date=${date}&end_date=${date}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      }
    )

    let sleepDetailedData = null
    if (sleepDetailedResponse.ok) {
      sleepDetailedData = await sleepDetailedResponse.json()
    } else {
      console.log('Sleep detailed API response not OK:', sleepDetailedResponse.status, sleepDetailedResponse.statusText)
    }

    // Fetch daily activity data
    const activityResponse = await fetch(
      `https://api.ouraring.com/v2/usercollection/daily_activity?start_date=${date}&end_date=${date}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      }
    )

    let activityData = null
    if (activityResponse.ok) {
      activityData = await activityResponse.json()
    } else {
      console.log('Activity API response not OK:', activityResponse.status, activityResponse.statusText)
      const errorText = await activityResponse.text().catch(() => '')
      console.log('Activity API error:', errorText)
    }

    // Parse and combine Oura data
    const dailyReadiness = readinessData.data?.[0] || null
    const dailySleep = sleepData?.data?.[0] || null
    const sleepDetailed = sleepDetailedData?.data?.[0] || null // Detailed sleep with actual durations
    const dailyActivity = activityData?.data?.[0] || null

    // Log full response structure for debugging
    console.log('Oura API Full Response:', {
      readinessFull: dailyReadiness,
      sleepFull: dailySleep,
      sleepDetailedFull: sleepDetailed,
      activityFull: dailyActivity
    })

    // Oura API v2 structure:
    // - Readiness: score object may be empty, check contributors instead
    // - Sleep: has 'score', 'contributors', 'day', 'timestamp' - sleep duration is in contributors
    // - Activity: may not be available for all dates

    // Extract from readiness contributors
    const readinessContributors = dailyReadiness?.contributors || {}
    const sleepContributors = dailySleep?.contributors || {}
    
    console.log('Contributors structure:', {
      readinessContributorsKeys: Object.keys(readinessContributors),
      readinessContributors: readinessContributors,
      sleepContributorsKeys: Object.keys(sleepContributors),
      sleepContributors: sleepContributors
    })
    
    // Map Oura data to our health_metrics schema
    // Oura API v2 uses contributors object with different field names
    const ouraData = {
      date: date,
      // HRV from readiness contributors (may be in different format)
      hrv: readinessContributors?.hrv_balance || 
           readinessContributors?.hrv?.balance ||
           dailyReadiness?.score?.hrv_balance?.middle || 
           dailyReadiness?.score?.hrv_balance?.average || null,
      // Resting HR from readiness contributors or score
      resting_heart_rate: readinessContributors?.resting_heart_rate || 
                          readinessContributors?.heart_rate?.resting ||
                          dailyReadiness?.score?.resting_heart_rate || 
                          dailyActivity?.heart_rate?.resting || null,
      // Body temp from readiness contributors
      body_temp: readinessContributors?.body_temperature || 
                 readinessContributors?.temperature?.deviation ||
                 dailyReadiness?.score?.body_temperature?.deviation || null,
      // Sleep score from sleep data (score is a number, not an object)
      sleep_score: typeof dailySleep?.score === 'number' ? dailySleep.score : 
                   readinessContributors?.sleep_balance || 
                   dailyReadiness?.score?.sleep_balance || null,
      // Sleep duration - use detailed sleep endpoint which has actual durations (in seconds)
      sleep_duration: sleepDetailed?.total_sleep_duration ? Math.round(sleepDetailed.total_sleep_duration / 60) :
                      sleepDetailed?.duration ? Math.round(sleepDetailed.duration / 60) :
                      // Fallback to calculating from sleep stages if available
                      (sleepDetailed?.deep_sleep_duration && sleepDetailed?.rem_sleep_duration && sleepDetailed?.light_sleep_duration) ?
                        Math.round((sleepDetailed.deep_sleep_duration + sleepDetailed.rem_sleep_duration + sleepDetailed.light_sleep_duration) / 60) :
                      // Last resort: check dailySleep structure
                      dailySleep?.total_sleep_duration ? Math.round(dailySleep.total_sleep_duration / 60) : null,
      // Sleep stages - use detailed sleep endpoint (durations in seconds, convert to minutes)
      deep_sleep: sleepDetailed?.deep_sleep_duration ? Math.round(sleepDetailed.deep_sleep_duration / 60) :
                  sleepDetailed?.sleep?.deep?.duration ? Math.round(sleepDetailed.sleep.deep.duration / 60) : null,
      rem_sleep: sleepDetailed?.rem_sleep_duration ? Math.round(sleepDetailed.rem_sleep_duration / 60) :
                 sleepDetailed?.sleep?.rem?.duration ? Math.round(sleepDetailed.sleep.rem.duration / 60) : null,
      light_sleep: sleepDetailed?.light_sleep_duration ? Math.round(sleepDetailed.light_sleep_duration / 60) :
                   sleepDetailed?.sleep?.light?.duration ? Math.round(sleepDetailed.sleep.light.duration / 60) : null,
      // Calories and steps from activity (may not be available)
      calories_burned: dailyActivity?.total_calories || dailyActivity?.calories?.total || null,
      steps: dailyActivity?.steps || null,
      source_provider: 'oura',
      source_data: {
        // Store the actual score value (not the object)
        readiness_score: typeof dailyReadiness?.score === 'number' ? dailyReadiness.score : 
                        dailyReadiness?.score?.score || null,
        activity_score: readinessContributors?.activity_balance || dailyReadiness?.score?.activity_balance || null,
        recovery_index: readinessContributors?.recovery_index || dailyReadiness?.score?.recovery_index || null,
        sleep_efficiency: sleepContributors?.sleep_efficiency || dailySleep?.efficiency || null,
        sleep_latency: sleepContributors?.sleep_latency || dailySleep?.sleep?.onset_latency || null,
        active_calories: dailyActivity?.calories?.active || null,
        total_calories: dailyActivity?.calories?.total || null,
        average_heart_rate: dailyActivity?.heart_rate?.average || null,
        max_heart_rate: dailyActivity?.heart_rate?.max || null,
        // Store contributors for debugging
        readiness_contributors: readinessContributors,
        sleep_contributors: sleepContributors
      }
    }

    console.log('Mapped Oura data:', ouraData)

    // Save to health_metrics
    // Use != null to preserve 0 values (which are valid)
    const dataToSave = {
      user_id: userId,
      date: date,
      resting_heart_rate: ouraData.resting_heart_rate != null ? Number(ouraData.resting_heart_rate) : null,
      hrv: ouraData.hrv != null ? Number(ouraData.hrv) : null,
      body_temp: ouraData.body_temp != null ? Number(ouraData.body_temp) : null,
      sleep_score: ouraData.sleep_score != null ? Number(ouraData.sleep_score) : null,
      sleep_duration: ouraData.sleep_duration != null ? Number(ouraData.sleep_duration) : null,
      deep_sleep: ouraData.deep_sleep != null ? Number(ouraData.deep_sleep) : null,
      rem_sleep: ouraData.rem_sleep != null ? Number(ouraData.rem_sleep) : null,
      light_sleep: ouraData.light_sleep != null ? Number(ouraData.light_sleep) : null,
      calories_burned: ouraData.calories_burned != null ? Number(ouraData.calories_burned) : null,
      steps: ouraData.steps != null ? parseInt(ouraData.steps) : null,
      source_provider: 'oura',
      source_data: ouraData.source_data,
      updated_at: new Date().toISOString()
    }

    console.log('Saving to database:', dataToSave)

    const { data: result, error: saveError } = await supabase
      .from('health_metrics')
      .upsert(dataToSave, { onConflict: 'user_id,date' })
      .select()
      .single()

    if (saveError) {
      console.error('Error saving Oura data:', saveError)
      return res.status(500).json({ 
        message: 'Failed to save data',
        error: saveError.message,
        success: false
      })
    }

    return res.status(200).json({
      success: true,
      synced: true,
      date: date,
      data: ouraData,
      saved: result
    })

  } catch (error) {
    console.error('Oura sync error:', error)
    return res.status(500).json({ 
      message: 'Internal server error',
      error: error.message,
      success: false
    })
  }
}

