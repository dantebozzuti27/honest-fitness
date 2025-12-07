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
    // Note: The detailed sleep endpoint returns individual sleep sessions, not daily summaries
    // It might return empty if there are no sleep sessions for that date
    // Try querying a 3-day range to catch sleep sessions that might span dates
    const sleepStartDate = new Date(date)
    sleepStartDate.setDate(sleepStartDate.getDate() - 1) // Start 1 day before
    const sleepEndDate = new Date(date)
    sleepEndDate.setDate(sleepEndDate.getDate() + 1) // End 1 day after
    
    const sleepDetailedResponse = await fetch(
      `https://api.ouraring.com/v2/usercollection/sleep?start_date=${sleepStartDate.toISOString().split('T')[0]}&end_date=${sleepEndDate.toISOString().split('T')[0]}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      }
    )

    let sleepDetailedData = null
    console.log('Sleep detailed response status:', sleepDetailedResponse.status, sleepDetailedResponse.statusText)
    if (sleepDetailedResponse.ok) {
      sleepDetailedData = await sleepDetailedResponse.json()
      console.log('Sleep detailed response data:', sleepDetailedData)
      console.log('Sleep detailed data array length:', sleepDetailedData?.data?.length)
    } else {
      const errorText = await sleepDetailedResponse.text().catch(() => '')
      console.log('Sleep detailed API response not OK:', sleepDetailedResponse.status, sleepDetailedResponse.statusText, errorText)
    }

    // Fetch daily activity data
    // Try a date range in case activity data is available for nearby dates
    const activityStartDate = new Date(date)
    activityStartDate.setDate(activityStartDate.getDate() - 1)
    const activityEndDate = new Date(date)
    activityEndDate.setDate(activityEndDate.getDate() + 1)
    
    const activityResponse = await fetch(
      `https://api.ouraring.com/v2/usercollection/daily_activity?start_date=${activityStartDate.toISOString().split('T')[0]}&end_date=${activityEndDate.toISOString().split('T')[0]}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      }
    )

    let activityData = null
    console.log('Activity response status:', activityResponse.status, activityResponse.statusText)
    if (activityResponse.ok) {
      activityData = await activityResponse.json()
      console.log('Activity response data:', activityData)
      console.log('Activity data array length:', activityData?.data?.length)
    } else {
      const errorText = await activityResponse.text().catch(() => '')
      console.log('Activity API response not OK:', activityResponse.status, activityResponse.statusText, errorText)
      // Activity data might not be available for all dates or might require different scopes
    }

    // Parse and combine Oura data
    // Match exact dates - don't use fallback to avoid date mismatches
    const dailyReadiness = readinessData.data?.find(r => r.day === date) || null
    const dailySleep = sleepData?.data?.find(s => s.day === date) || null
    
    // Find sleep session that matches our target date
    // Sleep sessions might span multiple days, so find the one that includes our date
    // A sleep session that starts on the previous day and ends on the target date should be counted for the target date
    let sleepDetailed = null
    if (sleepDetailedData?.data && sleepDetailedData.data.length > 0) {
      // Find sleep session that matches the date
      // Check: 1) session.day matches, 2) bedtime_start is on target date, 3) bedtime_end is on target date
      sleepDetailed = sleepDetailedData.data.find(session => {
        // First check if session.day matches
        if (session.day === date) {
          return true
        }
        
        // Check if bedtime_start is on target date (session might start on target date)
        if (session.bedtime_start) {
          const bedtimeStartDate = new Date(session.bedtime_start).toISOString().split('T')[0]
          if (bedtimeStartDate === date) {
            return true
          }
        }
        
        // Check if bedtime_end is on target date (session might end on target date)
        if (session.bedtime_end) {
          const bedtimeEndDate = new Date(session.bedtime_end).toISOString().split('T')[0]
          if (bedtimeEndDate === date) {
            return true
          }
        }
        
        // Check if session spans the target date (starts before and ends after)
        if (session.bedtime_start && session.bedtime_end) {
          const startDate = new Date(session.bedtime_start).toISOString().split('T')[0]
          const endDate = new Date(session.bedtime_end).toISOString().split('T')[0]
          const targetDateObj = new Date(date)
          const startDateObj = new Date(startDate)
          const endDateObj = new Date(endDate)
          
          // If session starts before or on target date and ends on or after target date
          if (startDateObj <= targetDateObj && endDateObj >= targetDateObj) {
            return true
          }
        }
        
        return false
      })
      
      // If no exact match, log available sessions for debugging
      if (!sleepDetailed && sleepDetailedData.data.length > 0) {
        console.log('No sleep session found for date:', date, 'Available sessions:', sleepDetailedData.data.map(s => ({ 
          day: s.day, 
          bedtime_start: s.bedtime_start,
          bedtime_end: s.bedtime_end,
          total_sleep_duration: s.total_sleep_duration
        })))
      } else if (sleepDetailed) {
        console.log('Found sleep session for date:', date, {
          sessionDay: sleepDetailed.day,
          bedtimeStart: sleepDetailed.bedtime_start,
          bedtimeEnd: sleepDetailed.bedtime_end,
          totalSleepDuration: sleepDetailed.total_sleep_duration,
          deepSleep: sleepDetailed.deep_sleep_duration,
          remSleep: sleepDetailed.rem_sleep_duration,
          lightSleep: sleepDetailed.light_sleep_duration
        })
      }
    }
    
    // Find activity data that matches our target date exactly
    let dailyActivity = null
    if (activityData?.data && activityData.data.length > 0) {
      dailyActivity = activityData.data.find(activity => activity.day === date)
      
      // If no exact match, don't use fallback - we want the correct date
      if (!dailyActivity && activityData.data.length > 0) {
        console.log('No activity data found for date:', date, 'Available dates:', activityData.data.map(a => a.day))
      }
    }
    
    console.log('Parsed data:', {
      targetDate: date,
      dailyReadiness: !!dailyReadiness,
      dailyReadinessDay: dailyReadiness?.day,
      dailySleep: !!dailySleep,
      dailySleepDay: dailySleep?.day,
      sleepDetailed: !!sleepDetailed,
      sleepDetailedDay: sleepDetailed?.day || sleepDetailed?.bedtime_start,
      sleepDetailedDataArray: sleepDetailedData?.data?.map(s => ({ day: s.day, bedtime_start: s.bedtime_start })),
      dailyActivity: !!dailyActivity,
      dailyActivityDay: dailyActivity?.day,
      activityDataArray: activityData?.data?.map(a => a.day)
    })

    // Log full response structure for debugging
    console.log('Oura API Full Response:', {
      readinessFull: dailyReadiness,
      sleepFull: dailySleep,
      sleepFullKeys: dailySleep ? Object.keys(dailySleep) : null,
      sleepDetailedFull: sleepDetailed,
      sleepDetailedKeys: sleepDetailed ? Object.keys(sleepDetailed) : null,
      sleepDetailedTotalSleepDuration: sleepDetailed?.total_sleep_duration,
      sleepDetailedDuration: sleepDetailed?.duration,
      sleepDetailedDeepSleep: sleepDetailed?.deep_sleep_duration,
      sleepDetailedRemSleep: sleepDetailed?.rem_sleep_duration,
      sleepDetailedLightSleep: sleepDetailed?.light_sleep_duration,
      activityFull: dailyActivity,
      activityFullKeys: dailyActivity ? Object.keys(dailyActivity) : null
    })
    
    // Check if daily_sleep has duration fields we're missing
    if (dailySleep) {
      console.log('Daily sleep all fields:', JSON.stringify(dailySleep, null, 2))
    }
    
    // Log detailed sleep structure if available
    if (sleepDetailed) {
      console.log('Detailed sleep structure:', JSON.stringify(sleepDetailed, null, 2))
      console.log('Sleep duration calculation check:', {
        total_sleep_duration: sleepDetailed.total_sleep_duration,
        total_sleep_duration_type: typeof sleepDetailed.total_sleep_duration,
        duration: sleepDetailed.duration,
        deep_sleep_duration: sleepDetailed.deep_sleep_duration,
        rem_sleep_duration: sleepDetailed.rem_sleep_duration,
        light_sleep_duration: sleepDetailed.light_sleep_duration,
        calculatedTotal: sleepDetailed.deep_sleep_duration && sleepDetailed.rem_sleep_duration && sleepDetailed.light_sleep_duration 
          ? (sleepDetailed.deep_sleep_duration + sleepDetailed.rem_sleep_duration + sleepDetailed.light_sleep_duration) / 60
          : null,
        // Show what the calculation would be
        wouldBeMinutes: sleepDetailed.total_sleep_duration >= 240 ? sleepDetailed.total_sleep_duration : sleepDetailed.total_sleep_duration / 60,
        wouldBeHours: sleepDetailed.total_sleep_duration >= 240 ? (sleepDetailed.total_sleep_duration / 60).toFixed(1) : (sleepDetailed.total_sleep_duration / 3600).toFixed(1)
      })
    }

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
      // Sleep duration - Calculate from detailed sleep endpoint
      // Oura API v2: total_sleep_duration is in SECONDS
      // If value is between 240-1440, it's likely already in minutes (4-24 hours)
      // If value > 1440, it's definitely in minutes
      // If value < 240, it's likely in seconds (needs conversion)
      sleep_duration: (() => {
        if (sleepDetailed?.total_sleep_duration != null) {
          const rawValue = sleepDetailed.total_sleep_duration
          // If value is >= 240 (4 hours in minutes), assume it's already in minutes
          // Otherwise, assume it's in seconds and convert to minutes
          const minutes = rawValue >= 240 ? Math.round(rawValue) : Math.round(rawValue / 60)
          console.log('Sleep duration from total_sleep_duration:', minutes, 'minutes (raw:', rawValue, rawValue >= 240 ? 'assumed minutes' : 'assumed seconds)')
          return minutes
        }
        if (sleepDetailed?.duration != null) {
          const rawValue = sleepDetailed.duration
          const minutes = rawValue >= 240 ? Math.round(rawValue) : Math.round(rawValue / 60)
          console.log('Sleep duration from duration:', minutes, 'minutes (raw:', rawValue, rawValue >= 240 ? 'assumed minutes' : 'assumed seconds)')
          return minutes
        }
        // Calculate from sleep stages if all are available
        // Sleep stage durations are in SECONDS according to Oura API v2
        if (sleepDetailed?.deep_sleep_duration != null && sleepDetailed?.rem_sleep_duration != null && sleepDetailed?.light_sleep_duration != null) {
          const deep = sleepDetailed.deep_sleep_duration
          const rem = sleepDetailed.rem_sleep_duration
          const light = sleepDetailed.light_sleep_duration
          // If any value > 60, assume they're already in minutes (unlikely but possible)
          // Otherwise assume seconds
          const totalSeconds = (deep > 60 ? deep * 60 : deep) + (rem > 60 ? rem * 60 : rem) + (light > 60 ? light * 60 : light)
          const minutes = Math.round(totalSeconds / 60)
          console.log('Sleep duration calculated from stages:', minutes, 'minutes (deep:', deep, 'rem:', rem, 'light:', light, 'total seconds:', totalSeconds, ')')
          return minutes
        }
        // If we have some but not all stages, still calculate what we have
        if (sleepDetailed?.deep_sleep_duration != null || sleepDetailed?.rem_sleep_duration != null || sleepDetailed?.light_sleep_duration != null) {
          const deep = sleepDetailed?.deep_sleep_duration || 0
          const rem = sleepDetailed?.rem_sleep_duration || 0
          const light = sleepDetailed?.light_sleep_duration || 0
          const deepSec = deep > 60 ? deep * 60 : deep
          const remSec = rem > 60 ? rem * 60 : rem
          const lightSec = light > 60 ? light * 60 : light
          const totalSeconds = deepSec + remSec + lightSec
          if (totalSeconds > 0) {
            const minutes = Math.round(totalSeconds / 60)
            console.log('Sleep duration calculated from partial stages:', minutes, 'minutes (deep:', deep, 'rem:', rem, 'light:', light, 'total seconds:', totalSeconds, ')')
            return minutes
          }
        }
        console.log('No sleep duration available - sleepDetailed:', !!sleepDetailed, 'has total_sleep_duration:', !!sleepDetailed?.total_sleep_duration, 'has duration:', !!sleepDetailed?.duration, 'has stages:', {
          deep: !!sleepDetailed?.deep_sleep_duration,
          rem: !!sleepDetailed?.rem_sleep_duration,
          light: !!sleepDetailed?.light_sleep_duration
        })
        return null
      })(),
      // Sleep stages - use detailed sleep endpoint
      // Oura API v2: durations are in SECONDS, but check if already in minutes (> 60)
      deep_sleep: (() => {
        if (sleepDetailed?.deep_sleep_duration != null) {
          const rawValue = sleepDetailed.deep_sleep_duration
          return rawValue > 60 ? Math.round(rawValue) : Math.round(rawValue / 60)
        }
        if (sleepDetailed?.sleep?.deep?.duration != null) {
          const rawValue = sleepDetailed.sleep.deep.duration
          return rawValue > 60 ? Math.round(rawValue) : Math.round(rawValue / 60)
        }
        return null
      })(),
      rem_sleep: (() => {
        if (sleepDetailed?.rem_sleep_duration != null) {
          const rawValue = sleepDetailed.rem_sleep_duration
          return rawValue > 60 ? Math.round(rawValue) : Math.round(rawValue / 60)
        }
        if (sleepDetailed?.sleep?.rem?.duration != null) {
          const rawValue = sleepDetailed.sleep.rem.duration
          return rawValue > 60 ? Math.round(rawValue) : Math.round(rawValue / 60)
        }
        return null
      })(),
      light_sleep: (() => {
        if (sleepDetailed?.light_sleep_duration != null) {
          const rawValue = sleepDetailed.light_sleep_duration
          return rawValue > 60 ? Math.round(rawValue) : Math.round(rawValue / 60)
        }
        if (sleepDetailed?.sleep?.light?.duration != null) {
          const rawValue = sleepDetailed.sleep.light.duration
          return rawValue > 60 ? Math.round(rawValue) : Math.round(rawValue / 60)
        }
        return null
      })(),
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
        sleep_efficiency: sleepContributors?.efficiency != null ? sleepContributors.efficiency : 
                         dailySleep?.efficiency != null ? dailySleep.efficiency : null,
        sleep_latency: sleepContributors?.latency != null ? sleepContributors.latency : 
                      dailySleep?.sleep?.onset_latency != null ? dailySleep.sleep.onset_latency : 
                      dailySleep?.latency != null ? dailySleep.latency : null,
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
    console.log('Sleep duration calculation result:', {
      sleep_duration: ouraData.sleep_duration,
      deep_sleep: ouraData.deep_sleep,
      rem_sleep: ouraData.rem_sleep,
      light_sleep: ouraData.light_sleep,
      totalFromStages: ouraData.deep_sleep && ouraData.rem_sleep && ouraData.light_sleep 
        ? (ouraData.deep_sleep + ouraData.rem_sleep + ouraData.light_sleep)
        : null
    })

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

