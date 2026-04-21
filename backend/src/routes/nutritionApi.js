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

// ── GET /targets — compute Apollo-aware macro targets ──────────────────────
nutritionApiRouter.get('/targets', async (req, res) => {
  try {
    const userId = req.userId
    if (!userId) return res.status(401).json({ error: 'Not authenticated' })

    const { rows: [prefs] } = await query(
      `SELECT body_weight_lbs, gender, age, training_goal, job_activity_level,
              available_days_per_week, session_duration_minutes
       FROM user_preferences WHERE user_id = $1 LIMIT 1`,
      [userId]
    )

    if (!prefs) return res.json({ targets: null, reason: 'No preferences set' })

    const bw = Number(prefs.body_weight_lbs) || 170
    const bwKg = bw * 0.453592
    const age = Number(prefs.age) || 30
    const gender = (prefs.gender || 'male').toLowerCase()
    const phase = prefs.training_goal || 'maintain'
    const activityLevel = (prefs.job_activity_level || 'moderate').toLowerCase()

    // Mifflin-St Jeor BMR
    const bmr = gender === 'female'
      ? 10 * bwKg + 6.25 * (bwKg / 0.453592 / 2.20462 * 2.54 * 69 / 100) - 5 * age - 161
      : 10 * bwKg + 6.25 * (bwKg / 0.453592 / 2.20462 * 2.54 * 69 / 100) - 5 * age + 5

    const activityMultipliers = {
      sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9,
    }
    const tdee = bmr * (activityMultipliers[activityLevel] || 1.55)

    const phaseCalAdjust = { bulk: 300, cut: -500, maintain: 0 }
    const targetCal = Math.round(tdee + (phaseCalAdjust[phase] || 0))

    // Protein: 1g/lb for bulk, 1.2g/lb for cut (preserve muscle), 0.9g/lb maintain
    const proteinPerLb = { bulk: 1.0, cut: 1.2, maintain: 0.9 }
    const proteinG = Math.round(bw * (proteinPerLb[phase] || 1.0))

    // Fat: 25% of calories for bulk/maintain, 30% for cut
    const fatPct = phase === 'cut' ? 0.30 : 0.25
    const fatG = Math.round((targetCal * fatPct) / 9)

    // Carbs: remaining calories
    const carbG = Math.round((targetCal - proteinG * 4 - fatG * 9) / 4)

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
    })
  } catch (err) {
    console.error('[nutrition/targets] Error:', err.message)
    return res.status(500).json({ error: err.message })
  }
})
