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
import { authenticate } from '../middleware/auth.js'
import { query } from '../database/pg.js'

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
    const allowedCols = [
      'training_goal', 'session_duration_minutes', 'equipment_access',
      'available_days_per_week', 'job_activity_level', 'injuries',
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
        fields[col] = prefs[col] !== null && typeof prefs[col] === 'object'
          ? JSON.stringify(prefs[col]) : (prefs[col] ?? null)
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

