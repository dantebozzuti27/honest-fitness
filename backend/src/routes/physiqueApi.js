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

const VISION_PROMPT = `You are an expert sports physiologist and competitive bodybuilding judge analyzing physique photos for automated training programming.

Photos may include up to 4 angles. Evaluate each angle for what it reveals best:
- FRONT RELAXED: chest thickness/separation, anterior deltoids, biceps/forearms, quad sweep, V-taper width, waist width, shoulder-to-waist ratio, ab definition, body fat
- BACK RELAXED: lat width/taper, rear delts, upper back thickness (rhomboids/traps), lower back (erector spinae), glute development, hamstrings, calf width
- SIDE PROFILE: chest depth, tricep size, anterior deltoid mass, ab thickness, lat depth, quad/hamstring separation from the side, glute protrusion, overall posture
- FLEXED/POSED: peak muscle detail, separation, vascularity, muscular maturity indicators

Return a JSON object with EXACTLY this schema:

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
  "muscle_maturity": <number 1-10 — density, hardness, separation quality>,
  "v_taper_score": <number 1-10 — shoulder width relative to waist>,
  "weak_points": [<string — muscle group keys from scores, ordered by severity, max 5>],
  "strong_points": [<string — muscle group keys from scores, max 3>],
  "analysis_notes": "<string — 2-3 sentence summary of overall physique assessment and top priorities>"
}

Scoring guidelines (1-10 scale calibrated to natural lifters, not enhanced):
- 1-2: Untrained, minimal visible development
- 3-4: Beginner, some mass but limited shape/separation
- 5: Average gym-goer, reasonable development
- 6-7: Intermediate to advanced, good mass and shape
- 8: Advanced, impressive development with visible separation
- 9: Elite natural, near genetic ceiling for the group
- 10: Peak natural development, competition-ready

Be honest, critical, and precise. Scores drive automated volume allocation — overscoring a group reduces the training stimulus it receives. When multiple angles are provided, synthesize across all views before scoring. More angles = higher confidence = use the full scoring range rather than defaulting to conservative estimates.`

// ── Apollo Score computation ──────────────────────────────────────────
// Composite 0–100 score: single number representing overall physique quality
// toward the Apollo ideal (hybrid strength + aesthetics).
//
// Components:
//   40% — Muscle development average (mean of all 18 scores / 10)
//   20% — Adonis Index proximity (how close shoulder:waist is to φ = 1.618)
//   10% — Left/right symmetry
//   15% — Body fat quality (phase-aware — lower BF in cut is better, moderate in bulk)
//   15% — Proportional balance (inverse of Reeves deficit variance)
function computeApolloScore({ scores, shoulderToWaist, symmetry, bodyFatPct, deficits, phase }) {
  let muscleComponent = 0
  const scoreValues = Object.values(scores || {}).map(Number).filter(v => !isNaN(v))
  if (scoreValues.length > 0) {
    muscleComponent = (scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length) / 10
  }

  let adonisComponent = 0
  if (shoulderToWaist != null) {
    const PHI = 1.618
    const deviation = Math.abs(shoulderToWaist - PHI) / PHI
    adonisComponent = Math.max(0, 1 - deviation * 3)
  }

  const symmetryComponent = symmetry != null ? Number(symmetry) : 0.85

  let bodyFatComponent = 0.5
  if (bodyFatPct != null) {
    const bf = Number(bodyFatPct)
    if (phase === 'cut') {
      if (bf <= 8) bodyFatComponent = 1.0
      else if (bf <= 12) bodyFatComponent = 0.85
      else if (bf <= 15) bodyFatComponent = 0.65
      else if (bf <= 20) bodyFatComponent = 0.4
      else bodyFatComponent = 0.2
    } else {
      if (bf <= 10) bodyFatComponent = 0.8
      else if (bf <= 14) bodyFatComponent = 1.0
      else if (bf <= 18) bodyFatComponent = 0.7
      else if (bf <= 22) bodyFatComponent = 0.45
      else bodyFatComponent = 0.25
    }
  }

  let proportionComponent = 0.5
  const deficitValues = Object.values(deficits || {}).map(Number).filter(v => !isNaN(v))
  if (deficitValues.length > 0) {
    const variance = deficitValues.reduce((acc, d) => acc + d * d, 0) / deficitValues.length
    proportionComponent = Math.max(0, 1 - Math.sqrt(variance) * 4)
  }

  const raw = muscleComponent * 40
    + adonisComponent * 20
    + symmetryComponent * 10
    + bodyFatComponent * 15
    + proportionComponent * 15

  return {
    overall: Math.round(Math.min(100, Math.max(0, raw)) * 10) / 10,
    components: {
      muscle_development: Math.round(muscleComponent * 100) / 100,
      adonis_index: Math.round(adonisComponent * 100) / 100,
      symmetry: Math.round(symmetryComponent * 100) / 100,
      body_composition: Math.round(bodyFatComponent * 100) / 100,
      proportional_balance: Math.round(proportionComponent * 100) / 100,
    },
  }
}

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

    const { labels } = req.body
    const photoLabels = Array.isArray(labels) ? labels : []

    const imageContents = images.map(img => ({
      type: 'image_url',
      image_url: {
        url: img.startsWith('data:') ? img : `data:image/jpeg;base64,${img}`,
        detail: 'high',
      },
    }))

    const angleList = photoLabels.length > 0
      ? photoLabels.join(', ')
      : `${images.length} photo${images.length > 1 ? 's' : ''}`
    const userText = `Analyzing ${angleList}. ${images.length < 4
      ? 'Not all angles are provided — score visible groups with full confidence, estimate non-visible groups conservatively based on overall development patterns and visible proportions.'
      : 'All 4 angles provided — use full scoring range with high confidence.'} Return the structured JSON assessment.`

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
            { type: 'text', text: userText },
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
    const [existingResult, prefsResult] = await Promise.all([
      query(
        `SELECT measurements, reeves_ideals FROM body_assessments
         WHERE user_id = $1 AND date = CURRENT_DATE`,
        [userId]
      ),
      query(
        `SELECT training_goal FROM user_preferences WHERE user_id = $1 LIMIT 1`,
        [userId]
      ),
    ])
    const existing = existingResult.rows[0] || {}
    const measurements = existing.measurements || {}
    const reevesIdeals = existing.reeves_ideals || computeReevesIdeals(measurements)
    const phase = prefsResult.rows[0]?.training_goal || 'maintain'

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

    const apolloScore = computeApolloScore({
      scores,
      shoulderToWaist: analysis.shoulder_to_waist_ratio,
      symmetry: analysis.left_right_symmetry,
      bodyFatPct: analysis.estimated_body_fat_pct,
      deficits: combinedDeficits,
      phase,
    })

    const scoresWithMeta = {
      ...scores,
      _apollo_score: apolloScore.overall,
      _score_components: apolloScore.components,
      _muscle_maturity: analysis.muscle_maturity ?? null,
      _v_taper_score: analysis.v_taper_score ?? null,
      _photos_used: images.length,
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
        JSON.stringify(scoresWithMeta),
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

    return res.json({ assessment: result.rows[0], apollo_score: apolloScore })
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
      const v = measurements[k]
      if (v !== undefined && v !== null && v !== '') {
        const n = Number(v)
        // Reject NaN and absurd values; tape measurement of 0 or 100+ inches
        // is almost certainly a typo. Fail loudly so the front-end shows an
        // error rather than silently dropping the value.
        if (Number.isFinite(n) && n > 0 && n < 100) {
          clean[k] = Math.round(n * 100) / 100
        }
      }
    }
    if (Object.keys(clean).length === 0) {
      return res.status(400).json({ error: 'At least one valid measurement is required' })
    }

    const reevesIdeals = computeReevesIdeals(clean)
    const measurementDeficits = computeProportionalDeficits(clean, reevesIdeals)
    const muscleDeficits = mapMeasurementDeficitsToMuscleGroups(measurementDeficits)

    const [existingResult, prefsResultM] = await Promise.all([
      query(
        `SELECT scores, proportional_deficits, source, shoulder_to_waist_ratio,
                left_right_symmetry, estimated_body_fat_pct
         FROM body_assessments WHERE user_id = $1 AND date = CURRENT_DATE`,
        [userId]
      ),
      query(
        `SELECT training_goal FROM user_preferences WHERE user_id = $1 LIMIT 1`,
        [userId]
      ),
    ])
    const existing = existingResult.rows[0]
    const phaseM = prefsResultM.rows[0]?.training_goal || 'maintain'
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

    const existingScores = existing?.scores || {}
    const pureScores = {}
    for (const [k, v] of Object.entries(existingScores)) {
      if (!k.startsWith('_')) pureScores[k] = v
    }

    const apolloScoreM = computeApolloScore({
      scores: pureScores,
      shoulderToWaist: existing?.shoulder_to_waist_ratio ?? null,
      symmetry: existing?.left_right_symmetry ?? null,
      bodyFatPct: existing?.estimated_body_fat_pct ?? null,
      deficits: combinedDeficits,
      phase: phaseM,
    })

    const scoresWithMetaM = {
      ...pureScores,
      _apollo_score: apolloScoreM.overall,
      _score_components: apolloScoreM.components,
      ...(existingScores._muscle_maturity != null ? { _muscle_maturity: existingScores._muscle_maturity } : {}),
      ...(existingScores._v_taper_score != null ? { _v_taper_score: existingScores._v_taper_score } : {}),
      ...(existingScores._photos_used != null ? { _photos_used: existingScores._photos_used } : {}),
    }

    const result = await query(
      `INSERT INTO body_assessments (
        user_id, date, scores, measurements, reeves_ideals,
        proportional_deficits, weak_points, strong_points, source
      ) VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (user_id, date) DO UPDATE SET
        scores = EXCLUDED.scores,
        measurements = EXCLUDED.measurements,
        reeves_ideals = EXCLUDED.reeves_ideals,
        proportional_deficits = EXCLUDED.proportional_deficits,
        weak_points = EXCLUDED.weak_points,
        strong_points = EXCLUDED.strong_points,
        source = EXCLUDED.source
      RETURNING *`,
      [
        userId,
        JSON.stringify(scoresWithMetaM),
        JSON.stringify(clean),
        JSON.stringify(reevesIdeals),
        JSON.stringify(combinedDeficits),
        JSON.stringify(weakPoints),
        JSON.stringify(strongPoints),
        source,
      ]
    )

    return res.json({ assessment: result.rows[0], apollo_score: apolloScoreM })
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
