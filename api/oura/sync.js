import { extractUser } from '../_shared/auth.js'
import { query } from '../_shared/db.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: { message: 'Method not allowed', status: 405 } })
  }

  const { date } = req.body || {}
  if (!date) {
    return res.status(400).json({ success: false, error: { message: 'Missing date', status: 400 } })
  }

  try {
    const user = extractUser(req)
    if (!user) {
      return res.status(401).json({ success: false, error: { message: 'Invalid or expired token', status: 401 } })
    }
    const userId = user.id

    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, error: { message: 'Invalid date format (expected YYYY-MM-DD)', status: 400 } })
    }

    const { rows: accountRows } = await query(
      `SELECT * FROM connected_accounts WHERE user_id = $1 AND provider = $2`,
      [userId, 'oura']
    )
    const account = accountRows[0] || null

    if (!account) {
      return res.status(404).json({
        success: false,
        error: { message: 'Oura account not connected', status: 404 }
      })
    }

    // Check if token needs refresh
    const expiresAt = account.expires_at ? new Date(account.expires_at) : null
    const now = new Date()
    let accessToken = account.access_token

    if (!expiresAt || expiresAt <= new Date(now.getTime() + 10 * 60 * 1000)) {
      if (account.refresh_token) {
        try {
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

            const newExpiresAt = new Date()
            newExpiresAt.setSeconds(newExpiresAt.getSeconds() + (tokenData.expires_in || 86400))

            await query(
              `UPDATE connected_accounts
               SET access_token = $1, refresh_token = $2, expires_at = $3, updated_at = $4
               WHERE user_id = $5 AND provider = $6`,
              [
                tokenData.access_token,
                tokenData.refresh_token || account.refresh_token,
                newExpiresAt.toISOString(),
                new Date().toISOString(),
                userId,
                'oura'
              ]
            )
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
          success: false,
          error: { message: 'Oura token expired. Please reconnect your account.', status: 401 }
        })
      }
      const errorText = await readinessResponse.text()
      return res.status(readinessResponse.status).json({
        success: false,
        error: { message: `Oura API error: ${readinessResponse.statusText}`, status: readinessResponse.status },
        details: process.env.NODE_ENV === 'development' ? errorText : undefined
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

    // Fetch detailed sleep data (has actual durations)
    const sleepStartDate = new Date(date)
    sleepStartDate.setDate(sleepStartDate.getDate() - 1)
    const sleepEndDate = new Date(date)
    sleepEndDate.setDate(sleepEndDate.getDate() + 1)

    const sleepDetailedResponse = await fetch(
      `https://api.ouraring.com/v2/usercollection/sleep?start_date=${sleepStartDate.toISOString().split('T')[0]}&end_date=${sleepEndDate.toISOString().split('T')[0]}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      }
    )

    let sleepDetailedData = null
    if (sleepDetailedResponse.ok) {
      sleepDetailedData = await sleepDetailedResponse.json()
    }

    // Fetch daily activity data
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
    if (activityResponse.ok) {
      activityData = await activityResponse.json()
    }

    // Parse and combine Oura data
    const dailyReadiness = readinessData.data?.find(r => r.day === date) || null
    const dailySleep = sleepData?.data?.find(s => s.day === date) || null

    let sleepDetailed = null
    if (sleepDetailedData?.data && sleepDetailedData.data.length > 0) {
      sleepDetailed = sleepDetailedData.data.find(session => {
        if (session.day === date) {
          return true
        }

        if (session.bedtime_start) {
          const bedtimeStartDate = new Date(session.bedtime_start).toISOString().split('T')[0]
          if (bedtimeStartDate === date) {
            return true
          }
        }

        if (session.bedtime_end) {
          const bedtimeEndDate = new Date(session.bedtime_end).toISOString().split('T')[0]
          if (bedtimeEndDate === date) {
            return true
          }
        }

        if (session.bedtime_start && session.bedtime_end) {
          const startDate = new Date(session.bedtime_start).toISOString().split('T')[0]
          const endDate = new Date(session.bedtime_end).toISOString().split('T')[0]
          const targetDateObj = new Date(date)
          const startDateObj = new Date(startDate)
          const endDateObj = new Date(endDate)

          if (startDateObj <= targetDateObj && endDateObj >= targetDateObj) {
            return true
          }
        }

        return false
      })

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

    let dailyActivity = null
    if (activityData?.data && activityData.data.length > 0) {
      dailyActivity = activityData.data.find(activity => activity.day === date)

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

    if (dailySleep) {
      console.log('Daily sleep all fields:', JSON.stringify(dailySleep, null, 2))
    }

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
        wouldBeMinutes: sleepDetailed.total_sleep_duration >= 240 ? sleepDetailed.total_sleep_duration : sleepDetailed.total_sleep_duration / 60,
        wouldBeHours: sleepDetailed.total_sleep_duration >= 240 ? (sleepDetailed.total_sleep_duration / 60).toFixed(1) : (sleepDetailed.total_sleep_duration / 3600).toFixed(1)
      })
    }

    const readinessContributors = dailyReadiness?.contributors || {}
    const sleepContributors = dailySleep?.contributors || {}

    console.log('Contributors structure:', {
      readinessContributorsKeys: Object.keys(readinessContributors),
      readinessContributors: readinessContributors,
      sleepContributorsKeys: Object.keys(sleepContributors),
      sleepContributors: sleepContributors
    })

    const ouraData = {
      date: date,
      hrv: readinessContributors?.hrv_balance ||
           readinessContributors?.hrv?.balance ||
           dailyReadiness?.score?.hrv_balance?.middle ||
           dailyReadiness?.score?.hrv_balance?.average || null,
      resting_heart_rate: readinessContributors?.resting_heart_rate ||
                          readinessContributors?.heart_rate?.resting ||
                          dailyReadiness?.score?.resting_heart_rate ||
                          dailyActivity?.heart_rate?.resting || null,
      body_temp: readinessContributors?.body_temperature ||
                 readinessContributors?.temperature?.deviation ||
                 dailyReadiness?.score?.body_temperature?.deviation || null,
      sleep_score: typeof dailySleep?.score === 'number' ? dailySleep.score :
                   readinessContributors?.sleep_balance ||
                   dailyReadiness?.score?.sleep_balance || null,
      sleep_duration: (() => {
        if (sleepDetailed?.total_sleep_duration != null) {
          const rawSeconds = sleepDetailed.total_sleep_duration
          const minutes = Math.round(rawSeconds / 60)
          return minutes
        }
        if (sleepDetailed?.duration != null) {
          const rawSeconds = sleepDetailed.duration
          return Math.round(rawSeconds / 60)
        }
        if (sleepDetailed?.deep_sleep_duration != null && sleepDetailed?.rem_sleep_duration != null && sleepDetailed?.light_sleep_duration != null) {
          const totalSeconds = sleepDetailed.deep_sleep_duration + sleepDetailed.rem_sleep_duration + sleepDetailed.light_sleep_duration
          return Math.round(totalSeconds / 60)
        }
        if (sleepDetailed?.deep_sleep_duration != null || sleepDetailed?.rem_sleep_duration != null || sleepDetailed?.light_sleep_duration != null) {
          const deep = sleepDetailed?.deep_sleep_duration || 0
          const rem = sleepDetailed?.rem_sleep_duration || 0
          const light = sleepDetailed?.light_sleep_duration || 0
          const totalSeconds = deep + rem + light
          if (totalSeconds > 0) return Math.round(totalSeconds / 60)
        }
        return null
      })(),
      deep_sleep: sleepDetailed?.deep_sleep_duration != null ? Math.round(sleepDetailed.deep_sleep_duration / 60) : (sleepDetailed?.sleep?.deep?.duration != null ? Math.round(sleepDetailed.sleep.deep.duration / 60) : null),
      rem_sleep: sleepDetailed?.rem_sleep_duration != null ? Math.round(sleepDetailed.rem_sleep_duration / 60) : (sleepDetailed?.sleep?.rem?.duration != null ? Math.round(sleepDetailed.sleep.rem.duration / 60) : null),
      light_sleep: sleepDetailed?.light_sleep_duration != null ? Math.round(sleepDetailed.light_sleep_duration / 60) : (sleepDetailed?.sleep?.light?.duration != null ? Math.round(sleepDetailed.sleep.light.duration / 60) : null),
      calories_burned: dailyActivity?.total_calories || dailyActivity?.calories?.total || null,
      steps: dailyActivity?.steps || null,
      source_provider: 'oura',
      source_data: {
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

    try {
      const { rows: savedRows } = await query(
        `INSERT INTO health_metrics (
           user_id, date, resting_heart_rate, hrv, body_temp,
           sleep_score, sleep_duration, deep_sleep, rem_sleep, light_sleep,
           calories_burned, steps, source_provider, source_data, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (user_id, date) DO UPDATE SET
           resting_heart_rate = $3,
           hrv = $4,
           body_temp = $5,
           sleep_score = $6,
           sleep_duration = $7,
           deep_sleep = $8,
           rem_sleep = $9,
           light_sleep = $10,
           calories_burned = $11,
           steps = $12,
           source_provider = $13,
           source_data = $14,
           updated_at = $15
         RETURNING *`,
        [
          dataToSave.user_id,
          dataToSave.date,
          dataToSave.resting_heart_rate,
          dataToSave.hrv,
          dataToSave.body_temp,
          dataToSave.sleep_score,
          dataToSave.sleep_duration,
          dataToSave.deep_sleep,
          dataToSave.rem_sleep,
          dataToSave.light_sleep,
          dataToSave.calories_burned,
          dataToSave.steps,
          dataToSave.source_provider,
          JSON.stringify(dataToSave.source_data),
          dataToSave.updated_at
        ]
      )
      const result = savedRows[0] || null

      return res.status(200).json({
        success: true,
        synced: true,
        date: date,
        data: ouraData,
        saved: result
      })
    } catch (saveError) {
      console.error('Error saving Oura data:', saveError)
      return res.status(500).json({
        success: false,
        error: { message: 'Failed to save data', status: 500 },
        details: process.env.NODE_ENV === 'development' ? saveError.message : undefined
      })
    }

  } catch (error) {
    console.error('Oura sync error:', error)
    return res.status(500).json({
      success: false,
      error: { message: 'Internal server error', status: 500 },
      details: process.env.NODE_ENV === 'development' ? error?.message : undefined
    })
  }
}
