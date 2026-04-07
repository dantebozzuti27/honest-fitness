/**
 * Main API Router
 * Routes all API requests to appropriate handlers
 */

import express from 'express'
import { inputRouter } from './input.js'
import { mlRouter } from './ml.js'
import { personalizationRouter } from './personalization.js'
import { outputRouter } from './output.js'
import { pipelineRouter } from './pipeline.js'
import { chatRouter } from './chat.js'
import { insightsRouter } from './insights.js'
import { dbRouter } from './db.js'
import { rpcRouter } from './rpc.js'
import { workoutSaveRouter } from './workoutSave.js'
import { workoutLoadRouter } from './workoutLoad.js'
import { authenticate } from '../middleware/auth.js'
import { query, transaction } from '../database/pg.js'

export const apiRouter = express.Router()

// Unauthenticated ping — used by the client to wake the serverless container
// (triggers JWKS pre-fetch + DB pool warm-up at module load) before critical writes.
apiRouter.get('/ping', (_req, res) => res.json({ ok: true }))

// Apply authentication to all API routes
apiRouter.use(authenticate)

// Returns the resolved user (maps cognito_sub → historical users.id)
apiRouter.get('/auth/me', (req, res) => {
  res.json({ id: req.userId, email: req.user?.email || '' })
})

// Dedicated preferences save — lightweight, no generic proxy overhead
apiRouter.post('/preferences', async (req, res) => {
  try {
    const userId = req.userId
    const prefs = req.body || {}
    if (!userId) return res.status(401).json({ data: null, error: { message: 'Not authenticated' } })

    const fields = { user_id: userId, updated_at: new Date().toISOString() }
    // TEXT[] columns — pass raw JS arrays, pg handles the conversion
    const textArrayCols = new Set(['exercises_to_avoid', 'preferred_exercises', 'available_days'])
    const allowedCols = [
      'training_goal', 'session_duration_minutes', 'equipment_access',
      'available_days_per_week', 'available_days', 'job_activity_level', 'injuries',
      'exercises_to_avoid', 'performance_goals', 'preferred_split',
      'date_of_birth', 'gender', 'height_feet', 'height_inches',
      'body_weight_lbs', 'experience_level', 'cardio_preference',
      'cardio_frequency_per_week', 'cardio_duration_minutes',
      'preferred_exercises', 'recovery_speed', 'weight_goal_lbs',
      'weight_goal_date', 'primary_goal', 'secondary_goal',
      'priority_muscles', 'weekday_deadlines', 'gym_profiles',
      'active_gym_profile', 'age', 'rest_days', 'sport_focus',
      'sport_season', 'hotel_mode',
    ]
    for (const col of allowedCols) {
      if (prefs[col] !== undefined) {
        const v = prefs[col]
        if (v === null || v === undefined) {
          fields[col] = null
        } else if (textArrayCols.has(col)) {
          fields[col] = Array.isArray(v) ? v : null
        } else if (typeof v === 'object') {
          fields[col] = JSON.stringify(v)
        } else {
          fields[col] = v
        }
      }
    }

    const keys = Object.keys(fields)
    const cols = keys.map(k => `"${k}"`).join(', ')
    const vals = keys.map((_, i) => `$${i + 1}`).join(', ')
    const updates = keys.filter(k => k !== 'user_id').map(k => `"${k}" = EXCLUDED."${k}"`).join(', ')
    const params = keys.map(k => fields[k])

    const result = await query(
      `INSERT INTO "user_preferences" (${cols}) VALUES (${vals}) ON CONFLICT ("user_id") DO UPDATE SET ${updates} RETURNING *`,
      params
    )
    return res.json({ data: result.rows[0] || null, error: null })
  } catch (err) {
    console.error('[preferences] Save error:', err.message)
    return res.status(500).json({ data: null, error: { message: err.message } })
  }
})

// Dedicated workout save — single request, transaction-safe, batch inserts
apiRouter.use('/workout-save', workoutSaveRouter)

// Dedicated workout load — all TodayWorkout data in one response
apiRouter.use('/workout-load', workoutLoadRouter)

// TEMPORARY: One-time recovery for corrupted 2026-04-07 leg day workout. Remove after use.
apiRouter.post('/recover-0407', async (req, res) => {
  try {
    const userId = req.userId
    if (!userId) return res.status(401).json({ error: 'Not authenticated' })

    const result = await transaction(async (client) => {
      const existing = await client.query(
        `SELECT id FROM workouts WHERE user_id = $1 AND date = '2026-04-07' LIMIT 1`, [userId]
      )
      let workoutId
      if (existing.rows.length > 0) {
        workoutId = existing.rows[0].id
        await client.query(
          `DELETE FROM workout_sets WHERE workout_exercise_id IN
           (SELECT id FROM workout_exercises WHERE workout_id = $1)`, [workoutId]
        )
        await client.query('DELETE FROM workout_exercises WHERE workout_id = $1', [workoutId])
        await client.query(
          `UPDATE workouts SET duration=100, completed=true, template_name='Legs',
           session_type='workout', day_of_week='Tuesday', updated_at=$1,
           workout_start_time='2026-04-07T10:00:00Z', workout_end_time='2026-04-07T11:40:00Z'
           WHERE id=$2`, [new Date().toISOString(), workoutId]
        )
      } else {
        const ins = await client.query(
          `INSERT INTO workouts (user_id, date, duration, completed, template_name, session_type,
             day_of_week, updated_at, workout_start_time, workout_end_time)
           VALUES ($1,'2026-04-07',100,true,'Legs','workout','Tuesday',$2,
             '2026-04-07T10:00:00Z','2026-04-07T11:40:00Z') RETURNING id`,
          [userId, new Date().toISOString()]
        )
        workoutId = ins.rows[0].id
      }

      const lib = await client.query(
        `SELECT id, name FROM exercise_library WHERE name = ANY($1)`,
        [['Barbell Back Squat','Leg Press','Dumbbell Romanian Deadlift','Leg Extension','Seated Leg Curl','Standing Calf Raise','Treadmill Walk']]
      )
      const lm = new Map()
      for (const r of lib.rows) lm.set(r.name, r.id)

      const exercises = [
        { n:'Barbell Back Squat', c:'strength', bp:'legs', eq:'barbell', t:'weightlifting', sets:[{w:185,r:8},{w:225,r:5},{w:245,r:4},{w:255,r:3},{w:265,r:3}] },
        { n:'Leg Press', c:'strength', bp:'legs', eq:'machine', t:'weightlifting', sets:[{w:360,r:12},{w:410,r:12},{w:455,r:11},{w:500,r:11}] },
        { n:'Dumbbell Romanian Deadlift', c:'strength', bp:'legs', eq:'dumbbell', t:'weightlifting', sets:[{w:70,r:10},{w:70,r:10},{w:70,r:10},{w:70,r:10}] },
        { n:'Leg Extension', c:'strength', bp:'legs', eq:'machine', t:'weightlifting', sets:[{w:120,r:12},{w:130,r:12},{w:140,r:10},{w:150,r:10}] },
        { n:'Seated Leg Curl', c:'strength', bp:'legs', eq:'machine', t:'weightlifting', sets:[{w:90,r:12},{w:100,r:12},{w:110,r:10},{w:110,r:10}] },
        { n:'Standing Calf Raise', c:'strength', bp:'legs', eq:'machine', t:'weightlifting', sets:[{w:180,r:15},{w:200,r:15},{w:200,r:12},{w:200,r:12}] },
        { n:'Treadmill Walk', c:'cardio', bp:'cardio', eq:'treadmill', t:'cardio', sets:[{time:'1800'}] },
      ]

      const exCols = ['workout_id','exercise_name','category','body_part','equipment','exercise_order','exercise_type','exercise_library_id']
      let pi = 1
      const exVals = exercises.map(() => { const p = exCols.map(() => `$${pi++}`); return `(${p.join(',')})` })
      const exParams = exercises.flatMap((ex, i) => [workoutId, ex.n, ex.c, ex.bp, ex.eq, i, ex.t, lm.get(ex.n) || null])
      const exRes = await client.query(
        `INSERT INTO workout_exercises (${exCols.map(c=>`"${c}"`).join(',')}) VALUES ${exVals.join(',')} RETURNING id, exercise_order`,
        exParams
      )
      const eid = new Map()
      for (const r of exRes.rows) eid.set(r.exercise_order, r.id)

      const allSets = []
      exercises.forEach((ex, ei) => {
        const exId = eid.get(ei)
        ex.sets.forEach((s, si) => {
          allSets.push([exId, si+1, s.w ?? null, s.r ?? null, s.time ?? null])
        })
      })
      let si = 1
      const sVals = allSets.map(() => { const p = [1,2,3,4,5].map(() => `$${si++}`); return `(${p.join(',')})` })
      await client.query(
        `INSERT INTO workout_sets (workout_exercise_id, set_number, weight, reps, time) VALUES ${sVals.join(',')}`,
        allSets.flat()
      )

      return { workoutId, exercises: exercises.length, sets: allSets.length }
    })

    console.log('[recover-0407] Success:', result)
    return res.json({ ok: true, ...result })
  } catch (err) {
    console.error('[recover-0407] Error:', err)
    return res.status(500).json({ error: err.message })
  }
})

// Generic CRUD proxy (RDS)
apiRouter.use('/db', dbRouter)

// RPC endpoints (RDS)
apiRouter.use('/rpc', rpcRouter)

// Route to input layer
apiRouter.use('/input', inputRouter)

// Route to ML/AI engine
apiRouter.use('/ml', mlRouter)

// Route to personalization engine
apiRouter.use('/personalization', personalizationRouter)

// Route to output layer
apiRouter.use('/output', outputRouter)

// Route to data pipelines
apiRouter.use('/pipeline', pipelineRouter)

// Chat (frontend /api/chat)
apiRouter.use('/chat', chatRouter)

// LLM insights (frontend /api/insights)
apiRouter.use('/insights', insightsRouter)

