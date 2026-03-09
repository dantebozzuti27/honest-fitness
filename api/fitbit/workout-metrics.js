/**
 * Fitbit Workout Metrics — Intraday Data
 *
 * Fetches minute-level heart rate, steps, and calories for a specific
 * time window (the workout duration), then aggregates them into
 * per-workout metrics: avg/peak HR, HR zone distribution, total steps,
 * total calories, and active minutes.
 *
 * POST { date: "YYYY-MM-DD", startTime: "HH:mm", endTime: "HH:mm" }
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: { message: 'Method not allowed' } })
  }

  const { date, startTime, endTime } = req.body || {}

  if (!date || !startTime || !endTime) {
    return res.status(400).json({ success: false, error: { message: 'Missing date, startTime, or endTime' } })
  }

  const timeRe = /^\d{2}:\d{2}$/
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !timeRe.test(startTime) || !timeRe.test(endTime)) {
    return res.status(400).json({ success: false, error: { message: 'Invalid format. date=YYYY-MM-DD, startTime/endTime=HH:mm' } })
  }

  try {
    const authHeader = req.headers?.authorization || req.headers?.Authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: { message: 'Missing authorization' } })
    }
    const token = authHeader.slice('Bearer '.length).trim()

    const { createClient } = await import('@supabase/supabase-js')
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ success: false, error: { message: 'Server configuration error' } })
    }
    const supabase = createClient(supabaseUrl, supabaseKey)

    const { data: { user }, error: userErr } = await supabase.auth.getUser(token)
    if (userErr || !user?.id) {
      return res.status(401).json({ success: false, error: { message: 'Invalid or expired token' } })
    }
    const userId = user.id

    const { data: account } = await supabase
      .from('connected_accounts')
      .select('access_token, refresh_token, expires_at')
      .eq('user_id', userId)
      .eq('provider', 'fitbit')
      .maybeSingle()

    if (!account?.access_token) {
      return res.status(404).json({ success: false, error: { message: 'Fitbit not connected' } })
    }

    let accessToken = account.access_token

    // Refresh token if expiring within 10 minutes
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
            await supabase
              .from('connected_accounts')
              .update({ access_token: td.access_token, refresh_token: td.refresh_token, expires_at: newExpires.toISOString(), updated_at: new Date().toISOString() })
              .eq('user_id', userId)
              .eq('provider', 'fitbit')
          }
        } catch (_) { /* proceed with existing token */ }
      }
    }

    const headers = { Authorization: `Bearer ${accessToken}` }

    // Fetch intraday data in parallel
    const [hrRes, stepsRes, caloriesRes] = await Promise.all([
      fetch(`https://api.fitbit.com/1/user/-/activities/heart/date/${date}/1d/1min/time/${startTime}/${endTime}.json`, { headers }).catch(() => null),
      fetch(`https://api.fitbit.com/1/user/-/activities/steps/date/${date}/1d/1min/time/${startTime}/${endTime}.json`, { headers }).catch(() => null),
      fetch(`https://api.fitbit.com/1/user/-/activities/calories/date/${date}/1d/1min/time/${startTime}/${endTime}.json`, { headers }).catch(() => null),
    ])

    const metrics = {
      avgHr: null,
      peakHr: null,
      totalSteps: null,
      totalCalories: null,
      activeMinutes: null,
      hrZones: null,
      hrTimeline: null,
      durationMinutes: null,
    }

    // --- Heart Rate ---
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

            // Compute HR zones (standard Fitbit zones based on 220-age estimate)
            // We'll use absolute thresholds: <100 rest, 100-119 fat burn, 120-139 cardio, 140-159 peak, 160+ max
            const zones = { rest: 0, fatBurn: 0, cardio: 0, peak: 0 }
            for (const v of values) {
              if (v < 100) zones.rest++
              else if (v < 130) zones.fatBurn++
              else if (v < 155) zones.cardio++
              else zones.peak++
            }
            metrics.hrZones = zones

            // Sparse timeline for charting (every 5 minutes)
            const timeline = []
            for (let i = 0; i < dataset.length; i += 5) {
              timeline.push({ time: dataset[i].time, hr: dataset[i].value })
            }
            if (dataset.length > 0 && (dataset.length - 1) % 5 !== 0) {
              const last = dataset[dataset.length - 1]
              timeline.push({ time: last.time, hr: last.value })
            }
            metrics.hrTimeline = timeline

            // Active minutes = minutes with HR >= 100
            metrics.activeMinutes = values.filter(v => v >= 100).length
          }
        }
      } catch (e) {
        console.error('Error parsing HR intraday:', e)
      }
    }

    // --- Steps ---
    if (stepsRes?.ok) {
      try {
        const stepsJson = await stepsRes.json()
        const dataset = stepsJson?.['activities-steps-intraday']?.dataset || []
        if (dataset.length > 0) {
          metrics.totalSteps = dataset.reduce((sum, d) => sum + (Number(d.value) || 0), 0)
        }
      } catch (e) {
        console.error('Error parsing steps intraday:', e)
      }
    }

    // --- Calories ---
    if (caloriesRes?.ok) {
      try {
        const calJson = await caloriesRes.json()
        const dataset = calJson?.['activities-calories-intraday']?.dataset || []
        if (dataset.length > 0) {
          metrics.totalCalories = Math.round(dataset.reduce((sum, d) => sum + (Number(d.value) || 0), 0))
        }
      } catch (e) {
        console.error('Error parsing calories intraday:', e)
      }
    }

    return res.status(200).json({ success: true, metrics })
  } catch (error) {
    console.error('workout-metrics error:', error)
    return res.status(500).json({ success: false, error: { message: error?.message || 'Failed to fetch workout metrics' } })
  }
}
