import express from 'express'
import OpenAI from 'openai'
import { query } from '../database/pg.js'

export const physiqueApiRouter = express.Router()

let openai = null
function getOpenAI() {
  if (openai) return openai
  const key = process.env.OPENAI_API_KEY
  if (!key) return null
  openai = new OpenAI({ apiKey: key })
  return openai
}

const REEVES_RATIOS = {
  arm: 2.52,
  calf: 1.92,
  chest: 6.5,
  waist: 4.24,
  shoulder: null,
  thigh: null,
}

function computeReevesIdeals(measurements) {
  const wrist = measurements.wrist
  const ankle = measurements.ankle
  if (!wrist || !ankle) return {}

  const ideals = {}
  ideals.arm = Math.round(wrist * REEVES_RATIOS.arm * 100) / 100
  ideals.calf = Math.round(ankle * REEVES_RATIOS.calf * 100) / 100
  ideals.chest = Math.round(wrist * REEVES_RATIOS.chest * 100) / 100
  ideals.waist = Math.round(wrist * REEVES_RATIOS.waist * 100) / 100
  ideals.shoulder = Math.round(ideals.waist * 1.618 * 100) / 100
  if (measurements.knee) {
    ideals.thigh = Math.round(measurements.knee * 1.75 * 100) / 100
  }
  ideals.forearm = Math.round(wrist * 1.88 * 100) / 100
  ideals.neck = measurements.neck ? Math.round(measurements.neck * 100) / 100 : null

  return ideals
}

function computeProportionalDeficits(measurements, ideals) {
  const deficits = {}
  for (const [part, ideal] of Object.entries(ideals)) {
    if (!ideal || !measurements[part]) continue
    deficits[part] = Math.round(((measurements[part] - ideal) / ideal) * 1000) / 1000
  }
  return deficits
}

function mapMeasurementDeficitsToMuscleGroups(deficits) {
  const muscleDeficits = {}
  const mapping = {
    arm: ['biceps', 'triceps'],
    forearm: ['forearms'],
    chest: ['mid_chest', 'upper_chest', 'lower_chest'],
    shoulder: ['lateral_deltoid', 'anterior_deltoid', 'posterior_deltoid'],
    thigh: ['quadriceps', 'hamstrings'],
    calf: ['calves'],
    waist: ['core'],
  }
  for (const [part, groups] of Object.entries(mapping)) {
    if (deficits[part] === undefined) continue
    for (const g of groups) {
      muscleDeficits[g] = deficits[part]
    }
  }
  return muscleDeficits
}

const VISION_PROMPT = `You are an expert sports physiologist analyzing physique photos for training programming.

Analyze the provided photos and return a JSON object with EXACTLY this schema:

{
  "scores": {
    "mid_chest": <number 1-10>,
    "upper_chest": <number 1-10>,
    "lower_chest": <number 1-10>,
    "back_lats": <number 1-10>,
    "back_upper": <number 1-10>,
    "upper_traps": <number 1-10>,
    "lateral_deltoid": <number 1-10>,
    "anterior_deltoid": <number 1-10>,
    "posterior_deltoid": <number 1-10>,
    "quadriceps": <number 1-10>,
    "hamstrings": <number 1-10>,
    "glutes": <number 1-10>,
    "biceps": <number 1-10>,
    "triceps": <number 1-10>,
    "calves": <number 1-10>,
    "core": <number 1-10>,
    "forearms": <number 1-10>,
    "erector_spinae": <number 1-10>
  },
  "shoulder_to_waist_ratio": <number — estimated visual ratio>,
  "left_right_symmetry": <number 0-1 — 1.0 is perfect symmetry>,
  "estimated_body_fat_pct": <number — estimated body fat percentage>,
  "weak_points": [<string — ordered by severity, max 5>],
  "strong_points": [<string — max 3>],
  "analysis_notes": "<string — 2-3 sentence summary of overall physique assessment and top priorities>"
}

Scoring guidelines:
- 1-3: Underdeveloped, minimal visible muscle mass for the group
- 4-5: Below average development, noticeable deficit
- 6-7: Average to good development, proportionate
- 8-9: Well-developed, above average
- 10: Elite, competition-level development

Be honest and precise. This data drives automated workout programming — inaccurate scores lead to suboptimal training.
For muscle groups not clearly visible (e.g. posterior_deltoid from front-only photo), estimate conservatively based on overall development patterns.`

// ── POST /analyze — Photo-based physique analysis ─────────────────────
physiqueApiRouter.post('/analyze', async (req, res) => {
  try {
    const userId = req.userId
    if (!userId) return res.status(401).json({ error: 'Not authenticated' })

    const { images } = req.body
    if (!images || !Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: 'At least one base64 image is required' })
    }
    if (images.length > 4) {
      return res.status(400).json({ error: 'Maximum 4 images allowed' })
    }

    const ai = getOpenAI()
    if (!ai) return res.status(503).json({ error: 'AI service not configured' })

    const imageContents = images.map(img => ({
      type: 'image_url',
      image_url: {
        url: img.startsWith('data:') ? img : `data:image/jpeg;base64,${img}`,
        detail: 'high',
      },
    }))

    const completion = await ai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.2,
      max_tokens: 2000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: VISION_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Analyze these physique photos for training programming. Return the structured JSON assessment.' },
            ...imageContents,
          ],
        },
      ],
    })

    const raw = completion.choices?.[0]?.message?.content
    if (!raw) return res.status(502).json({ error: 'No response from AI' })

    let analysis
    try {
      analysis = JSON.parse(raw)
    } catch {
      return res.status(502).json({ error: 'Failed to parse AI response' })
    }

    const scores = analysis.scores || {}
    const existingResult = await query(
      `SELECT measurements, reeves_ideals FROM body_assessments
       WHERE user_id = $1 AND date = CURRENT_DATE`,
      [userId]
    )
    const existing = existingResult.rows[0] || {}
    const measurements = existing.measurements || {}
    const reevesIdeals = existing.reeves_ideals || computeReevesIdeals(measurements)

    const measurementDeficits = computeProportionalDeficits(measurements, reevesIdeals)
    const muscleDeficits = mapMeasurementDeficitsToMuscleGroups(measurementDeficits)

    const combinedDeficits = { ...muscleDeficits }
    for (const [group, score] of Object.entries(scores)) {
      const visualDeficit = -((10 - Number(score)) / 10)
      if (combinedDeficits[group] !== undefined) {
        combinedDeficits[group] = combinedDeficits[group] * 0.4 + visualDeficit * 0.6
      } else {
        combinedDeficits[group] = visualDeficit
      }
    }

    const result = await query(
      `INSERT INTO body_assessments (
        user_id, date, scores, shoulder_to_waist_ratio,
        left_right_symmetry, estimated_body_fat_pct,
        measurements, reeves_ideals,
        weak_points, strong_points, proportional_deficits,
        analysis_notes, photos_used, source
      ) VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (user_id, date) DO UPDATE SET
        scores = EXCLUDED.scores,
        shoulder_to_waist_ratio = EXCLUDED.shoulder_to_waist_ratio,
        left_right_symmetry = EXCLUDED.left_right_symmetry,
        estimated_body_fat_pct = EXCLUDED.estimated_body_fat_pct,
        proportional_deficits = EXCLUDED.proportional_deficits,
        weak_points = EXCLUDED.weak_points,
        strong_points = EXCLUDED.strong_points,
        analysis_notes = EXCLUDED.analysis_notes,
        photos_used = EXCLUDED.photos_used,
        source = CASE
          WHEN body_assessments.source = 'manual' THEN 'combined'
          ELSE EXCLUDED.source
        END
      RETURNING *`,
      [
        userId,
        JSON.stringify(scores),
        analysis.shoulder_to_waist_ratio ?? null,
        analysis.left_right_symmetry ?? null,
        analysis.estimated_body_fat_pct ?? null,
        JSON.stringify(measurements),
        JSON.stringify(reevesIdeals),
        JSON.stringify(analysis.weak_points || []),
        JSON.stringify(analysis.strong_points || []),
        JSON.stringify(combinedDeficits),
        analysis.analysis_notes || null,
        images.length,
        'photo_ai',
      ]
    )

    return res.json({ assessment: result.rows[0] })
  } catch (err) {
    console.error('[physique/analyze] Error:', err.message)
    return res.status(500).json({ error: err.message })
  }
})

// ── POST /measurements — Manual tape measurement entry ────────────────
physiqueApiRouter.post('/measurements', async (req, res) => {
  try {
    const userId = req.userId
    if (!userId) return res.status(401).json({ error: 'Not authenticated' })

    const { measurements } = req.body
    if (!measurements || typeof measurements !== 'object') {
      return res.status(400).json({ error: 'measurements object is required' })
    }

    const allowed = ['wrist', 'ankle', 'neck', 'knee', 'chest', 'waist', 'shoulder', 'arm', 'forearm', 'thigh', 'calf']
    const clean = {}
    for (const k of allowed) {
      if (measurements[k] !== undefined && measurements[k] !== null) {
        clean[k] = Number(measurements[k])
      }
    }

    const reevesIdeals = computeReevesIdeals(clean)
    const measurementDeficits = computeProportionalDeficits(clean, reevesIdeals)
    const muscleDeficits = mapMeasurementDeficitsToMuscleGroups(measurementDeficits)

    const existingResult = await query(
      `SELECT scores, proportional_deficits, source FROM body_assessments
       WHERE user_id = $1 AND date = CURRENT_DATE`,
      [userId]
    )
    const existing = existingResult.rows[0]
    let combinedDeficits = { ...muscleDeficits }
    let source = 'manual'

    if (existing?.scores && Object.keys(existing.scores).length > 0) {
      source = 'combined'
      for (const [group, score] of Object.entries(existing.scores)) {
        const visualDeficit = -((10 - Number(score)) / 10)
        if (combinedDeficits[group] !== undefined) {
          combinedDeficits[group] = combinedDeficits[group] * 0.4 + visualDeficit * 0.6
        } else {
          combinedDeficits[group] = visualDeficit
        }
      }
    }

    const weakPoints = Object.entries(combinedDeficits)
      .filter(([, d]) => d < -0.05)
      .sort((a, b) => a[1] - b[1])
      .map(([g]) => g)
      .slice(0, 5)
    const strongPoints = Object.entries(combinedDeficits)
      .filter(([, d]) => d > 0.05)
      .sort((a, b) => b[1] - a[1])
      .map(([g]) => g)
      .slice(0, 3)

    const result = await query(
      `INSERT INTO body_assessments (
        user_id, date, scores, measurements, reeves_ideals,
        proportional_deficits, weak_points, strong_points, source
      ) VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (user_id, date) DO UPDATE SET
        measurements = EXCLUDED.measurements,
        reeves_ideals = EXCLUDED.reeves_ideals,
        proportional_deficits = EXCLUDED.proportional_deficits,
        weak_points = EXCLUDED.weak_points,
        strong_points = EXCLUDED.strong_points,
        source = EXCLUDED.source
      RETURNING *`,
      [
        userId,
        JSON.stringify(existing?.scores || {}),
        JSON.stringify(clean),
        JSON.stringify(reevesIdeals),
        JSON.stringify(combinedDeficits),
        JSON.stringify(weakPoints),
        JSON.stringify(strongPoints),
        source,
      ]
    )

    return res.json({ assessment: result.rows[0] })
  } catch (err) {
    console.error('[physique/measurements] Error:', err.message)
    return res.status(500).json({ error: err.message })
  }
})

// ── GET /latest — Most recent assessment (for workout engine) ─────────
physiqueApiRouter.get('/latest', async (req, res) => {
  try {
    const userId = req.userId
    if (!userId) return res.status(401).json({ error: 'Not authenticated' })

    const result = await query(
      `SELECT * FROM body_assessments
       WHERE user_id = $1
       ORDER BY date DESC
       LIMIT 1`,
      [userId]
    )

    return res.json({ assessment: result.rows[0] || null })
  } catch (err) {
    console.error('[physique/latest] Error:', err.message)
    return res.status(500).json({ error: err.message })
  }
})

// ── GET /history — All assessments for trend tracking ─────────────────
physiqueApiRouter.get('/history', async (req, res) => {
  try {
    const userId = req.userId
    if (!userId) return res.status(401).json({ error: 'Not authenticated' })

    const limit = Math.min(Number(req.query.limit) || 30, 100)

    const result = await query(
      `SELECT * FROM body_assessments
       WHERE user_id = $1
       ORDER BY date DESC
       LIMIT $2`,
      [userId, limit]
    )

    return res.json({ assessments: result.rows })
  } catch (err) {
    console.error('[physique/history] Error:', err.message)
    return res.status(500).json({ error: err.message })
  }
})
