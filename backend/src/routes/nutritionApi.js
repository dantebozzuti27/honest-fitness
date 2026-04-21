import express from 'express'
import { randomUUID } from 'node:crypto'
import OpenAI from 'openai'
import { query, transaction } from '../database/pg.js'

export const nutritionApiRouter = express.Router()

let openai = null
function getOpenAI() {
  if (openai) return openai
  const key = process.env.OPENAI_API_KEY
  if (!key) return null
  openai = new OpenAI({ apiKey: key })
  return openai
}

// ── POST /parse — AI text-to-macros ────────────────────────────────────────
nutritionApiRouter.post('/parse', async (req, res) => {
  try {
    const userId = req.userId
    if (!userId) return res.status(401).json({ error: 'Not authenticated' })

    const { text } = req.body
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ error: 'text is required' })
    }

    const ai = getOpenAI()
    if (!ai) return res.status(503).json({ error: 'AI service not configured' })

    const completion = await ai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are a nutrition analysis assistant. Parse the user's meal description into structured data.
Return JSON with this exact schema:
{
  "meal_name": "string — short name for the meal (e.g. 'Post-workout shake', 'Chicken and rice')",
  "foods": [
    {
      "name": "string — food item name",
      "quantity": "string — amount with unit (e.g. '8 oz', '1 cup', '2 large')",
      "calories": number,
      "protein_g": number,
      "carbs_g": number,
      "fat_g": number,
      "fiber_g": number
    }
  ],
  "total_calories": number,
  "total_protein_g": number,
  "total_carbs_g": number,
  "total_fat_g": number,
  "total_fiber_g": number
}
Be accurate with portions. If the user is vague (e.g. "chicken breast"), use typical serving sizes.
Round all numbers to 1 decimal place. Never return negative values.`
        },
        { role: 'user', content: text }
      ],
    })

    const raw = completion.choices?.[0]?.message?.content
    if (!raw) return res.status(502).json({ error: 'AI returned empty response' })

    const parsed = JSON.parse(raw)
    return res.json({ parsed, source: 'ai_parsed' })
  } catch (err) {
    console.error('[nutrition/parse] Error:', err.message)
    return res.status(500).json({ error: err.message })
  }
})

// ── POST /log — save a meal ────────────────────────────────────────────────
nutritionApiRouter.post('/log', async (req, res) => {
  try {
    const userId = req.userId
    if (!userId) return res.status(401).json({ error: 'Not authenticated' })

    const {
      date, meal_name, meal_time, foods, total_calories, total_protein_g,
      total_carbs_g, total_fat_g, total_fiber_g, notes, source
    } = req.body

    if (!date || !meal_name) {
      return res.status(400).json({ error: 'date and meal_name are required' })
    }

    const id = randomUUID()
    const safeSource = ['manual', 'ai_parsed', 'quick_add'].includes(source) ? source : 'manual'

    await query(
      `INSERT INTO meal_logs
        (id, user_id, date, meal_name, meal_time, foods, total_calories,
         total_protein_g, total_carbs_g, total_fat_g, total_fiber_g, notes, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        id, userId, date, meal_name, meal_time || null,
        JSON.stringify(foods || []),
        total_calories || 0, total_protein_g || 0, total_carbs_g || 0,
        total_fat_g || 0, total_fiber_g || 0, notes || null, safeSource
      ]
    )

    return res.json({ id, saved: true })
  } catch (err) {
    console.error('[nutrition/log] Error:', err.message)
    return res.status(500).json({ error: err.message })
  }
})

// ── GET /daily?date=YYYY-MM-DD — day summary ──────────────────────────────
nutritionApiRouter.get('/daily', async (req, res) => {
  try {
    const userId = req.userId
    if (!userId) return res.status(401).json({ error: 'Not authenticated' })

    const date = req.query.date
    if (!date) return res.status(400).json({ error: 'date query param required' })

    const { rows: meals } = await query(
      `SELECT id, meal_name, meal_time, foods, total_calories, total_protein_g,
              total_carbs_g, total_fat_g, total_fiber_g, notes, source, created_at
       FROM meal_logs WHERE user_id = $1 AND date = $2
       ORDER BY meal_time ASC NULLS LAST, created_at ASC`,
      [userId, date]
    )

    const totals = meals.reduce((acc, m) => ({
      calories: acc.calories + Number(m.total_calories || 0),
      protein_g: acc.protein_g + Number(m.total_protein_g || 0),
      carbs_g: acc.carbs_g + Number(m.total_carbs_g || 0),
      fat_g: acc.fat_g + Number(m.total_fat_g || 0),
      fiber_g: acc.fiber_g + Number(m.total_fiber_g || 0),
    }), { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 })

    return res.json({ date, meals, totals })
  } catch (err) {
    console.error('[nutrition/daily] Error:', err.message)
    return res.status(500).json({ error: err.message })
  }
})

// ── PUT /meal/:id — edit a meal ────────────────────────────────────────────
nutritionApiRouter.put('/meal/:id', async (req, res) => {
  try {
    const userId = req.userId
    if (!userId) return res.status(401).json({ error: 'Not authenticated' })

    const { id } = req.params
    const {
      meal_name, meal_time, foods, total_calories, total_protein_g,
      total_carbs_g, total_fat_g, total_fiber_g, notes
    } = req.body

    const { rowCount } = await query(
      `UPDATE meal_logs SET
        meal_name = COALESCE($1, meal_name),
        meal_time = $2,
        foods = COALESCE($3, foods),
        total_calories = COALESCE($4, total_calories),
        total_protein_g = COALESCE($5, total_protein_g),
        total_carbs_g = COALESCE($6, total_carbs_g),
        total_fat_g = COALESCE($7, total_fat_g),
        total_fiber_g = COALESCE($8, total_fiber_g),
        notes = $9,
        updated_at = NOW()
       WHERE id = $10 AND user_id = $11`,
      [
        meal_name, meal_time || null, foods ? JSON.stringify(foods) : null,
        total_calories, total_protein_g, total_carbs_g, total_fat_g,
        total_fiber_g, notes || null, id, userId
      ]
    )

    if (rowCount === 0) return res.status(404).json({ error: 'Meal not found' })
    return res.json({ updated: true })
  } catch (err) {
    console.error('[nutrition/meal/update] Error:', err.message)
    return res.status(500).json({ error: err.message })
  }
})

// ── DELETE /meal/:id ───────────────────────────────────────────────────────
nutritionApiRouter.delete('/meal/:id', async (req, res) => {
  try {
    const userId = req.userId
    if (!userId) return res.status(401).json({ error: 'Not authenticated' })

    const { id } = req.params
    const { rowCount } = await query(
      'DELETE FROM meal_logs WHERE id = $1 AND user_id = $2',
      [id, userId]
    )

    if (rowCount === 0) return res.status(404).json({ error: 'Meal not found' })
    return res.json({ deleted: true })
  } catch (err) {
    console.error('[nutrition/meal/delete] Error:', err.message)
    return res.status(500).json({ error: err.message })
  }
})

// ── GET /history?days=30 — daily summaries for trending ────────────────────
nutritionApiRouter.get('/history', async (req, res) => {
  try {
    const userId = req.userId
    if (!userId) return res.status(401).json({ error: 'Not authenticated' })

    const days = Math.min(90, Math.max(1, parseInt(req.query.days) || 30))
    const { rows } = await query(
      `SELECT date,
              COUNT(*)::int AS meal_count,
              SUM(total_calories)::numeric AS calories,
              SUM(total_protein_g)::numeric AS protein_g,
              SUM(total_carbs_g)::numeric AS carbs_g,
              SUM(total_fat_g)::numeric AS fat_g,
              SUM(total_fiber_g)::numeric AS fiber_g
       FROM meal_logs
       WHERE user_id = $1 AND date >= CURRENT_DATE - $2::int
       GROUP BY date
       ORDER BY date DESC`,
      [userId, days]
    )

    return res.json({ days: rows })
  } catch (err) {
    console.error('[nutrition/history] Error:', err.message)
    return res.status(500).json({ error: err.message })
  }
})

// ── GET /targets — compute Apollo-aware macro targets from weight goal timeline ─
nutritionApiRouter.get('/targets', async (req, res) => {
  try {
    const userId = req.userId
    if (!userId) return res.status(401).json({ error: 'Not authenticated' })

    const [prefsResult, recentWeightResult, fitbitResult] = await Promise.all([
      query(
        `SELECT body_weight_lbs, gender, age, training_goal, job_activity_level,
                available_days_per_week, session_duration_minutes,
                height_feet, height_inches, weight_goal_lbs, weight_goal_date
         FROM user_preferences WHERE user_id = $1 LIMIT 1`,
        [userId]
      ),
      query(
        `SELECT weight FROM health_metrics
         WHERE user_id = $1 AND weight IS NOT NULL
         ORDER BY date DESC LIMIT 1`,
        [userId]
      ),
      query(
        `SELECT AVG(calories_burned)::numeric AS avg_total_cal,
                AVG(steps)::numeric AS avg_steps,
                AVG(sleep_duration)::numeric AS avg_sleep,
                AVG(COALESCE(active_minutes_fairly, 0) + COALESCE(active_minutes_very, 0))::numeric AS avg_active_min
         FROM health_metrics
         WHERE user_id = $1
           AND date >= CURRENT_DATE - 14
           AND calories_burned IS NOT NULL`,
        [userId]
      ),
    ])
    const prefs = prefsResult.rows[0]

    if (!prefs) return res.json({ targets: null, reason: 'No preferences set' })

    const measuredWeight = recentWeightResult.rows[0]?.weight != null
      ? Number(recentWeightResult.rows[0].weight)
      : null
    const bw = measuredWeight || Number(prefs.body_weight_lbs) || 170
    const bwKg = bw * 0.453592
    const age = Number(prefs.age) || 30
    const gender = (prefs.gender || 'male').toLowerCase()
    const phase = prefs.training_goal || 'maintain'
    const activityLevel = (prefs.job_activity_level || 'moderate').toLowerCase()

    // Height: use actual data, fall back to population averages
    const heightFt = Number(prefs.height_feet) || 0
    const heightIn = Number(prefs.height_inches) || 0
    const totalInches = heightFt > 0 ? heightFt * 12 + heightIn : (gender === 'female' ? 64 : 69)
    const heightCm = totalInches * 2.54

    // Mifflin-St Jeor BMR
    const bmr = gender === 'female'
      ? 10 * bwKg + 6.25 * heightCm - 5 * age - 161
      : 10 * bwKg + 6.25 * heightCm - 5 * age + 5

    const activityMultipliers = {
      sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9,
    }
    const estimatedTdee = bmr * (activityMultipliers[activityLevel] || 1.55)

    // Prefer actual Fitbit TDEE when available
    const fitbitStats = fitbitResult.rows[0] || {}
    const fitbitTdee = fitbitStats.avg_total_cal ? Math.round(Number(fitbitStats.avg_total_cal)) : null
    const tdee = fitbitTdee || estimatedTdee
    const tdeeSource = fitbitTdee ? 'fitbit' : 'estimated'

    // Timeline-aware caloric adjustment
    const goalWeight = Number(prefs.weight_goal_lbs) || null
    const goalDateStr = prefs.weight_goal_date || null
    let calAdjust = 0
    let weeklyRateLbs = 0
    let weeksRemaining = null
    let lbsToGoal = null
    let timelineStatus = null

    if (goalWeight && goalDateStr && bw) {
      const goalDate = new Date(goalDateStr + 'T12:00:00')
      const now = new Date()
      const msRemaining = goalDate.getTime() - now.getTime()
      weeksRemaining = Math.max(0.5, msRemaining / (7 * 24 * 60 * 60 * 1000))
      lbsToGoal = goalWeight - bw

      if (Math.abs(lbsToGoal) < 1) {
        calAdjust = 0
        weeklyRateLbs = 0
        timelineStatus = 'at_goal'
      } else if (weeksRemaining <= 0) {
        calAdjust = lbsToGoal > 0 ? 300 : -500
        weeklyRateLbs = lbsToGoal > 0 ? 0.5 : -1.0
        timelineStatus = 'past_deadline'
      } else {
        weeklyRateLbs = lbsToGoal / weeksRemaining

        if (lbsToGoal < 0) {
          const maxLossPerWk = bw * 0.01
          const minLossPerWk = bw * 0.003
          const clampedRate = Math.max(-maxLossPerWk, Math.min(-minLossPerWk, weeklyRateLbs))
          calAdjust = Math.round(clampedRate * 3500 / 7)
          weeklyRateLbs = clampedRate
          timelineStatus = weeklyRateLbs < -maxLossPerWk ? 'aggressive' : 'on_track'
        } else {
          const maxGainPerWk = 0.75
          const clampedRate = Math.min(maxGainPerWk, weeklyRateLbs)
          calAdjust = Math.round(clampedRate * 3500 / 7)
          weeklyRateLbs = clampedRate
          timelineStatus = 'on_track'
        }
      }
    } else {
      const phaseCalAdjust = { bulk: 300, cut: -500, maintain: 0 }
      calAdjust = phaseCalAdjust[phase] || 0
    }

    const targetCal = Math.round(tdee + calAdjust)

    // Protein per lb — evidence-based
    const baseProteinPerLb = { bulk: 0.9, cut: 1.0, maintain: 0.8 }
    let proteinMultiplier = baseProteinPerLb[phase] || 0.9
    if (phase === 'cut' && calAdjust < -600) proteinMultiplier = 1.1
    const proteinG = Math.round(bw * proteinMultiplier)

    const fatPct = phase === 'cut' ? 0.30 : 0.25
    const fatG = Math.round((targetCal * fatPct) / 9)
    const carbG = Math.round((targetCal - proteinG * 4 - fatG * 9) / 4)

    // Fitbit actuals for display
    const fitbitAvgSteps = fitbitStats.avg_steps ? Math.round(Number(fitbitStats.avg_steps)) : null
    const fitbitAvgSleep = fitbitStats.avg_sleep ? Math.round(Number(fitbitStats.avg_sleep) / 60 * 10) / 10 : null
    const fitbitAvgActiveMins = fitbitStats.avg_active_min ? Math.round(Number(fitbitStats.avg_active_min)) : null

    return res.json({
      targets: {
        calories: targetCal,
        protein_g: proteinG,
        carbs_g: Math.max(0, carbG),
        fat_g: fatG,
        fiber_g: gender === 'female' ? 25 : 30,
      },
      phase,
      body_weight_lbs: bw,
      bmr: Math.round(bmr),
      tdee: Math.round(tdee),
      tdee_source: tdeeSource,
      tdee_estimated: Math.round(estimatedTdee),
      tdee_fitbit: fitbitTdee,
      caloric_adjustment: calAdjust,
      fitbit: {
        avg_steps: fitbitAvgSteps,
        avg_sleep_hours: fitbitAvgSleep,
        avg_active_minutes: fitbitAvgActiveMins,
        avg_calories_burned: fitbitTdee,
      },
      weight_goal: goalWeight ? {
        target_lbs: goalWeight,
        target_date: goalDateStr,
        lbs_to_goal: lbsToGoal != null ? Math.round(lbsToGoal * 10) / 10 : null,
        weeks_remaining: weeksRemaining != null ? Math.round(weeksRemaining * 10) / 10 : null,
        weekly_rate_lbs: Math.round(weeklyRateLbs * 100) / 100,
        timeline_status: timelineStatus,
      } : null,
    })
  } catch (err) {
    console.error('[nutrition/targets] Error:', err.message)
    return res.status(500).json({ error: err.message })
  }
})

// ── GET /phase-plan — compute full phase plan with milestones ──────────────
nutritionApiRouter.get('/phase-plan', async (req, res) => {
  try {
    const userId = req.userId
    if (!userId) return res.status(401).json({ error: 'Not authenticated' })

    const [prefsResult, weightHistoryResult, workoutStatsResult, nutritionStatsResult, fitbitStatsResult] = await Promise.all([
      query(
        `SELECT body_weight_lbs, gender, age, training_goal, job_activity_level,
                available_days_per_week, session_duration_minutes,
                height_feet, height_inches, weight_goal_lbs, weight_goal_date,
                phase_start_date, experience_level, created_at
         FROM user_preferences WHERE user_id = $1 LIMIT 1`,
        [userId]
      ),
      query(
        `SELECT date, weight FROM health_metrics
         WHERE user_id = $1 AND weight IS NOT NULL
         ORDER BY date ASC`,
        [userId]
      ),
      query(
        `SELECT COUNT(*)::int AS total_workouts,
                COUNT(DISTINCT date)::int AS training_days,
                MIN(date) AS first_workout,
                MAX(date) AS last_workout,
                AVG(duration)::numeric AS avg_duration
         FROM workouts WHERE user_id = $1`,
        [userId]
      ),
      query(
        `SELECT COUNT(DISTINCT date)::int AS days_logged,
                AVG(total_calories)::numeric AS avg_calories,
                AVG(total_protein_g)::numeric AS avg_protein
         FROM meal_logs WHERE user_id = $1
         AND date >= CURRENT_DATE - 30`,
        [userId]
      ),
      query(
        `SELECT AVG(calories_burned)::numeric AS avg_total_cal,
                AVG(steps)::numeric AS avg_steps,
                AVG(sleep_duration)::numeric AS avg_sleep,
                AVG(COALESCE(active_minutes_fairly, 0) + COALESCE(active_minutes_very, 0))::numeric AS avg_active_min
         FROM health_metrics
         WHERE user_id = $1
           AND date >= CURRENT_DATE - 14
           AND calories_burned IS NOT NULL`,
        [userId]
      ),
    ])

    const prefs = prefsResult.rows[0]
    if (!prefs) return res.json({ plan: null, reason: 'No preferences set' })

    const phase = prefs.training_goal || 'maintain'
    if (phase === 'maintain') {
      return res.json({ plan: null, reason: 'No active cut or bulk phase — currently maintaining' })
    }

    const goalWeight = Number(prefs.weight_goal_lbs) || null
    const goalDateStr = prefs.weight_goal_date || null
    if (!goalWeight || !goalDateStr) {
      return res.json({ plan: null, reason: 'Set a goal weight and target date in your Profile to activate phase planning' })
    }

    const weightHistory = weightHistoryResult.rows
    const workoutStats = workoutStatsResult.rows[0] || {}
    const nutritionStats = nutritionStatsResult.rows[0] || {}
    const fitbitStats = fitbitStatsResult.rows[0] || {}

    const phaseStartDateStr = prefs.phase_start_date || null
    const phaseStartDate = phaseStartDateStr
      ? new Date(phaseStartDateStr + 'T12:00:00')
      : null

    const latestWeight = weightHistory.length > 0
      ? Number(weightHistory[weightHistory.length - 1].weight)
      : Number(prefs.body_weight_lbs) || 170

    // Start weight: use weight at phase start date if available, else first weight log, else prefs
    let startWeight = Number(prefs.body_weight_lbs) || latestWeight
    if (phaseStartDate && weightHistory.length > 0) {
      const atStart = weightHistory.find(w => new Date(w.date + 'T12:00:00') >= phaseStartDate)
      if (atStart) startWeight = Number(atStart.weight)
      else startWeight = Number(weightHistory[0].weight)
    } else if (weightHistory.length > 0) {
      startWeight = Number(weightHistory[0].weight)
    }

    const goalDate = new Date(goalDateStr + 'T12:00:00')
    const now = new Date()
    const phaseOrigin = phaseStartDate || new Date(prefs.created_at || goalDateStr)
    const totalLbsToChange = goalWeight - startWeight
    const lbsRemaining = goalWeight - latestWeight
    const lbsCompleted = latestWeight - startWeight
    const msTotal = goalDate.getTime() - phaseOrigin.getTime()
    const msRemaining = goalDate.getTime() - now.getTime()
    const weeksRemaining = Math.max(0, msRemaining / (7 * 24 * 60 * 60 * 1000))
    const weeksTotal = Math.max(1, msTotal / (7 * 24 * 60 * 60 * 1000))
    const progressPct = totalLbsToChange !== 0
      ? Math.min(100, Math.max(0, Math.round((lbsCompleted / totalLbsToChange) * 100)))
      : (Math.abs(lbsRemaining) < 1 ? 100 : 0)

    // Compute actual rate from recent weight trend (last 14 days)
    const recentWeights = weightHistory.filter(w => {
      const d = new Date(w.date)
      return d >= new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
    })
    let actualWeeklyRate = 0
    if (recentWeights.length >= 2) {
      const first = Number(recentWeights[0].weight)
      const last = Number(recentWeights[recentWeights.length - 1].weight)
      const daySpan = (new Date(recentWeights[recentWeights.length - 1].date).getTime() - new Date(recentWeights[0].date).getTime()) / (24 * 60 * 60 * 1000)
      if (daySpan > 0) actualWeeklyRate = Math.round(((last - first) / daySpan) * 7 * 100) / 100
    }

    const neededRate = weeksRemaining > 0 ? Math.round((lbsRemaining / weeksRemaining) * 100) / 100 : 0

    // Pacing status
    let pacing = 'no_data'
    if (recentWeights.length >= 2) {
      if (phase === 'cut') {
        const absActual = Math.abs(actualWeeklyRate)
        const absNeeded = Math.abs(neededRate)
        if (actualWeeklyRate > 0) pacing = 'off_track'
        else if (absActual >= absNeeded * 0.85) pacing = 'on_track'
        else if (absActual >= absNeeded * 0.5) pacing = 'behind'
        else pacing = 'off_track'
      } else {
        if (actualWeeklyRate < 0) pacing = 'off_track'
        else if (actualWeeklyRate >= neededRate * 0.7) pacing = 'on_track'
        else if (actualWeeklyRate > 0) pacing = 'behind'
        else pacing = 'off_track'
      }
    }

    // Generate milestones
    const milestones = []
    const milestoneCount = Math.min(5, Math.max(2, Math.ceil(Math.abs(totalLbsToChange) / 5)))
    for (let i = 1; i <= milestoneCount; i++) {
      const fraction = i / milestoneCount
      const milestoneWeight = Math.round((startWeight + totalLbsToChange * fraction) * 10) / 10
      const milestoneDate = new Date(phaseOrigin.getTime() + msTotal * fraction)
      const reached = phase === 'cut'
        ? latestWeight <= milestoneWeight
        : latestWeight >= milestoneWeight
      milestones.push({
        label: i === milestoneCount ? 'Goal' : `Milestone ${i}`,
        target_weight: milestoneWeight,
        target_date: milestoneDate.toISOString().slice(0, 10),
        reached,
        is_final: i === milestoneCount,
      })
    }

    // Phase-specific checklist
    const checklist = []
    const cutProteinTarget = Math.round(latestWeight * 1.0)
    const bulkProteinTarget = Math.round(latestWeight * 0.9)
    if (phase === 'cut') {
      checklist.push({ key: 'deficit', label: 'Maintain caloric deficit', status: nutritionStats.avg_calories && nutritionStats.avg_calories < 2500 ? 'on_track' : 'needs_attention' })
      checklist.push({ key: 'protein', label: `Hit protein target (${cutProteinTarget}g+/day)`, status: nutritionStats.avg_protein && nutritionStats.avg_protein >= cutProteinTarget * 0.9 ? 'on_track' : 'needs_attention' })
      checklist.push({ key: 'strength', label: 'Preserve strength on key lifts', status: 'monitor' })
      checklist.push({ key: 'training', label: `Train ${prefs.available_days_per_week || 4}+ days/week`, status: workoutStats.training_days >= (prefs.available_days_per_week || 4) * 2 ? 'on_track' : 'needs_attention' })
      checklist.push({ key: 'logging', label: 'Log weight daily', status: recentWeights.length >= 10 ? 'on_track' : 'needs_attention' })
      checklist.push({ key: 'nutrition_logging', label: 'Log meals consistently', status: nutritionStats.days_logged >= 20 ? 'on_track' : 'needs_attention' })
      checklist.push({ key: 'rate', label: 'Lose 0.5-1% bodyweight/week', status: pacing === 'on_track' ? 'on_track' : pacing === 'behind' ? 'needs_attention' : 'monitor' })
    } else {
      checklist.push({ key: 'surplus', label: 'Maintain caloric surplus', status: nutritionStats.avg_calories && nutritionStats.avg_calories > 2800 ? 'on_track' : 'needs_attention' })
      checklist.push({ key: 'protein', label: `Hit protein target (${bulkProteinTarget}g+/day)`, status: nutritionStats.avg_protein && nutritionStats.avg_protein >= bulkProteinTarget * 0.9 ? 'on_track' : 'needs_attention' })
      checklist.push({ key: 'progressive', label: 'Progressive overload on compounds', status: 'monitor' })
      checklist.push({ key: 'training', label: `Train ${prefs.available_days_per_week || 5}+ days/week`, status: workoutStats.training_days >= (prefs.available_days_per_week || 5) * 2 ? 'on_track' : 'needs_attention' })
      checklist.push({ key: 'logging', label: 'Log weight weekly', status: recentWeights.length >= 2 ? 'on_track' : 'needs_attention' })
      checklist.push({ key: 'rate', label: 'Gain 0.25-0.75 lbs/week (lean)', status: pacing === 'on_track' ? 'on_track' : pacing === 'behind' ? 'needs_attention' : 'monitor' })
    }

    // Weight history for chart (last 90 days)
    const weightChart = weightHistory
      .filter(w => new Date(w.date) >= new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000))
      .map(w => ({ date: typeof w.date === 'string' ? w.date.slice(0, 10) : w.date, weight: Number(w.weight) }))

    // ── Compute daily targets (Fitbit-data-driven when available) ─────────
    const age = Number(prefs.age) || 30
    const gender = (prefs.gender || 'male').toLowerCase()
    const activityLevel = (prefs.job_activity_level || 'moderate').toLowerCase()
    const heightFt = Number(prefs.height_feet) || 0
    const heightIn = Number(prefs.height_inches) || 0
    const totalInches = heightFt > 0 ? heightFt * 12 + heightIn : (gender === 'female' ? 64 : 69)
    const heightCm = totalInches * 2.54
    const bwKg = latestWeight * 0.453592
    const bmr = gender === 'female'
      ? 10 * bwKg + 6.25 * heightCm - 5 * age - 161
      : 10 * bwKg + 6.25 * heightCm - 5 * age + 5
    const activityMultipliers = {
      sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9,
    }
    const estimatedTdee = bmr * (activityMultipliers[activityLevel] || 1.55)

    // Prefer actual Fitbit TDEE (calories_burned = total daily burn from Fitbit)
    const fitbitTdee = fitbitStats.avg_total_cal ? Math.round(Number(fitbitStats.avg_total_cal)) : null
    const tdee = fitbitTdee || estimatedTdee
    const tdeeSource = fitbitTdee ? 'fitbit' : 'estimated'

    // Actual Fitbit averages for display
    const fitbitAvgSteps = fitbitStats.avg_steps ? Math.round(Number(fitbitStats.avg_steps)) : null
    const fitbitAvgSleep = fitbitStats.avg_sleep ? Math.round(Number(fitbitStats.avg_sleep) * 10) / 10 : null
    const fitbitAvgActiveMins = fitbitStats.avg_active_min ? Math.round(Number(fitbitStats.avg_active_min)) : null

    // Caloric targets
    let calAdjust = 0
    if (weeksRemaining > 0 && Math.abs(lbsRemaining) >= 1) {
      const rawRate = lbsRemaining / weeksRemaining
      if (phase === 'cut') {
        const maxLoss = latestWeight * 0.01
        const clamped = Math.max(-maxLoss, Math.min(-latestWeight * 0.003, rawRate))
        calAdjust = Math.round(clamped * 3500 / 7)
      } else {
        const clamped = Math.min(0.75, rawRate)
        calAdjust = Math.round(clamped * 3500 / 7)
      }
    } else {
      calAdjust = phase === 'cut' ? -500 : phase === 'bulk' ? 300 : 0
    }
    const targetCalories = Math.round(tdee + calAdjust)

    // Macros
    const proteinPerLb = phase === 'cut' ? 1.0 : phase === 'bulk' ? 0.9 : 0.8
    const proteinG = Math.round(latestWeight * proteinPerLb)
    const fatPct = phase === 'cut' ? 0.30 : 0.25
    const fatG = Math.round((targetCalories * fatPct) / 9)
    const carbG = Math.max(0, Math.round((targetCalories - proteinG * 4 - fatG * 9) / 4))

    // Calories to burn target: derived from actual Fitbit TDEE or estimated
    // Total burn target = TDEE that supports the desired caloric intake + deficit/surplus
    // For cuts: target burn should be enough that (burn - intake) = desired deficit
    const totalBurnTarget = Math.round(targetCalories - calAdjust)
    // Exercise-specific burn: the delta the user needs from exercise beyond sedentary baseline
    const sedentaryBaseline = Math.round(bmr * 1.2)
    const exerciseBurnTarget = Math.max(0, totalBurnTarget - sedentaryBaseline)

    // Steps target based on Fitbit actuals + phase goals
    let stepsTarget = phase === 'cut' ? 10000 : phase === 'bulk' ? 7500 : 8000
    if (fitbitAvgSteps) {
      if (phase === 'cut') {
        stepsTarget = Math.max(10000, Math.round(fitbitAvgSteps * 1.1 / 500) * 500)
      } else {
        stepsTarget = Math.max(7500, Math.round(fitbitAvgSteps / 500) * 500)
      }
    }

    // Sleep target (hours) — Fitbit sleep is in minutes
    const sleepTargetHours = phase === 'bulk' ? 8.0 : 7.5
    const fitbitAvgSleepHours = fitbitAvgSleep ? Math.round(fitbitAvgSleep / 60 * 10) / 10 : null

    // Training days per week
    const trainingDaysTarget = Number(prefs.available_days_per_week) || (phase === 'bulk' ? 5 : 4)

    // Session duration
    const sessionDurationTarget = Number(prefs.session_duration_minutes) || (phase === 'bulk' ? 90 : 75)

    // Water intake (oz)
    const waterOz = Math.round(latestWeight * 0.5) + (phase === 'cut' ? 16 : 0)

    // Active minutes target
    let activeMinTarget = phase === 'cut' ? 45 : 30
    if (fitbitAvgActiveMins && phase === 'cut') {
      activeMinTarget = Math.max(45, Math.round(fitbitAvgActiveMins * 1.1))
    }

    const dailyTargets = {
      calories_eat: targetCalories,
      calories_burn: totalBurnTarget,
      exercise_burn: exerciseBurnTarget,
      tdee_source: tdeeSource,
      tdee_actual: fitbitTdee,
      tdee_estimated: Math.round(estimatedTdee),
      protein_g: proteinG,
      carbs_g: carbG,
      fat_g: fatG,
      steps: stepsTarget,
      steps_actual: fitbitAvgSteps,
      sleep_hours: sleepTargetHours,
      sleep_actual_hours: fitbitAvgSleepHours,
      active_minutes: activeMinTarget,
      active_minutes_actual: fitbitAvgActiveMins,
      training_days_per_week: trainingDaysTarget,
      session_duration_min: sessionDurationTarget,
      water_oz: waterOz,
    }

    // ── Workout milestones ─────────────────────────────────────────────────
    const workoutMilestones = []
    const totalWorkouts = workoutStats.total_workouts || 0
    if (phase === 'cut') {
      workoutMilestones.push({
        label: 'Maintain strength on all compound lifts',
        detail: 'Squat, bench, deadlift within 5% of pre-cut maxes',
        status: 'monitor',
      })
      workoutMilestones.push({
        label: `Complete ${trainingDaysTarget} workouts/week consistently`,
        detail: `${totalWorkouts} total workouts logged`,
        status: totalWorkouts > 0 ? 'on_track' : 'needs_attention',
      })
      workoutMilestones.push({
        label: 'Hit cardio targets',
        detail: `${phase === 'cut' ? '3-5' : '2-3'} sessions/week, ${phase === 'cut' ? '20-40' : '15-25'} min each`,
        status: 'monitor',
      })
      workoutMilestones.push({
        label: 'Maintain training volume',
        detail: 'Keep total weekly sets stable — reduce load before dropping sets',
        status: 'monitor',
      })
    } else {
      workoutMilestones.push({
        label: 'Progressive overload on compounds',
        detail: 'Increase weight or reps on squat, bench, deadlift, OHP each mesocycle',
        status: 'monitor',
      })
      workoutMilestones.push({
        label: `Complete ${trainingDaysTarget}+ workouts/week`,
        detail: `${totalWorkouts} total workouts logged`,
        status: totalWorkouts > 0 ? 'on_track' : 'needs_attention',
      })
      workoutMilestones.push({
        label: 'Increase training volume over time',
        detail: 'Add 1-2 sets per muscle group per mesocycle as capacity allows',
        status: 'monitor',
      })
      workoutMilestones.push({
        label: 'Bring up weak points',
        detail: 'Extra volume on lagging muscle groups identified by aesthetic scoring',
        status: 'monitor',
      })
    }

    return res.json({
      plan: {
        phase,
        phase_start_date: phaseStartDateStr,
        start_weight: Math.round(startWeight * 10) / 10,
        current_weight: Math.round(latestWeight * 10) / 10,
        goal_weight: goalWeight,
        goal_date: goalDateStr,
        lbs_remaining: Math.round(lbsRemaining * 10) / 10,
        progress_pct: progressPct,
        weeks_remaining: Math.round(weeksRemaining * 10) / 10,
        actual_weekly_rate: actualWeeklyRate,
        needed_weekly_rate: neededRate,
        pacing,
        milestones,
        checklist,
        daily_targets: dailyTargets,
        workout_milestones: workoutMilestones,
        weight_chart: weightChart,
        workout_stats: {
          total: workoutStats.total_workouts || 0,
          avg_duration: workoutStats.avg_duration ? Math.round(Number(workoutStats.avg_duration)) : null,
        },
        nutrition_stats: {
          days_logged_30d: nutritionStats.days_logged || 0,
          avg_calories: nutritionStats.avg_calories ? Math.round(Number(nutritionStats.avg_calories)) : null,
          avg_protein: nutritionStats.avg_protein ? Math.round(Number(nutritionStats.avg_protein)) : null,
        },
      },
    })
  } catch (err) {
    console.error('[nutrition/phase-plan] Error:', err.message)
    return res.status(500).json({ error: err.message })
  }
})
