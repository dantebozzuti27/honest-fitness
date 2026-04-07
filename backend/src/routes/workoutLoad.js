import express from 'express'
import { query } from '../database/pg.js'

export const workoutLoadRouter = express.Router()

function stitchWorkouts(workouts, exercises, sets) {
  const setsByExId = new Map()
  for (const s of sets) {
    const key = s.workout_exercise_id
    if (!setsByExId.has(key)) setsByExId.set(key, [])
    setsByExId.get(key).push(s)
  }
  const exByWId = new Map()
  for (const ex of exercises) {
    ex.workout_sets = setsByExId.get(ex.id) || []
    const key = ex.workout_id
    if (!exByWId.has(key)) exByWId.set(key, [])
    exByWId.get(key).push(ex)
  }
  return workouts.map(w => ({
    ...w,
    workout_exercises: exByWId.get(w.id) || [],
  }))
}

function safeQuery(text, params) {
  return query(text, params).then(r => r.rows).catch(err => {
    const code = err?.code || ''
    if (code === '42P01' || code === '42703' || /does not exist|column.*not found/i.test(err?.message || '')) {
      return []
    }
    throw err
  })
}

workoutLoadRouter.get('/', async (req, res) => {
  const t0 = Date.now()
  try {
    const userId = req.userId
    if (!userId) return res.status(401).json({ error: { message: 'Not authenticated' } })

    const targetDate = req.query.date || new Date().toISOString().slice(0, 10)
    const sinceDate = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString()

    // Phase 1: all independent queries in parallel
    const [
      prefsRes,
      workoutsRes, exercisesRes, setsRes,
      healthRes,
      libraryRes,
      feedbackRows,
      accountsRows,
      cardioRows,
      swapsRows,
      genWorkoutsRows,
      outcomesRows,
      execEventsRows,
      pausedRows,
      sessionRows,
    ] = await Promise.all([
      // 1. User preferences (critical — propagate connection errors)
      query('SELECT * FROM user_preferences WHERE user_id = $1', [userId])
        .then(r => r.rows[0] || null),

      // 2-4. Workout history with exercises and sets (critical)
      query(
        `SELECT * FROM workouts WHERE user_id = $1 AND date >= $2 ORDER BY date ASC`,
        [userId, sinceDate]
      ).then(r => r.rows),

      query(
        `SELECT we.* FROM workout_exercises we
         JOIN workouts w ON we.workout_id = w.id
         WHERE w.user_id = $1 AND w.date >= $2
         ORDER BY we.exercise_order ASC`,
        [userId, sinceDate]
      ).then(r => r.rows),

      query(
        `SELECT ws.* FROM workout_sets ws
         JOIN workout_exercises we ON ws.workout_exercise_id = we.id
         JOIN workouts w ON we.workout_id = w.id
         WHERE w.user_id = $1 AND w.date >= $2
         ORDER BY ws.set_number ASC`,
        [userId, sinceDate]
      ).then(r => r.rows),

      // 5. Health metrics (critical)
      query(
        `SELECT * FROM health_metrics WHERE user_id = $1 AND date >= $2 ORDER BY date ASC`,
        [userId, sinceDate]
      ).then(r => r.rows),

      // 6. Exercise library (critical)
      query(
        `SELECT id, name, body_part, category, primary_muscles, secondary_muscles,
                stabilizer_muscles, movement_pattern, ml_exercise_type, force_type,
                difficulty, default_tempo, equipment
         FROM exercise_library WHERE is_custom = false`
      ).then(r => r.rows),

      // 7. Model feedback (30 days)
      safeQuery(
        `SELECT feedback_data, feedback_source, feedback_quality, verified_by_user, created_at
         FROM model_feedback
         WHERE user_id = $1 AND feedback_type = 'pattern_observation' AND created_at >= $2
         ORDER BY created_at DESC LIMIT 10`,
        [userId, thirtyDaysAgo]
      ),

      // 8. Connected accounts
      safeQuery('SELECT * FROM connected_accounts WHERE user_id = $1', [userId]),

      // 9. Cardio capability profiles
      safeQuery(
        `SELECT modality, max_speed, comfortable_speed, max_incline,
                preferred_hr_zone_low, preferred_hr_zone_high, confidence_score, observed_sessions
         FROM cardio_capability_profiles WHERE user_id = $1`,
        [userId]
      ),

      // 10. Exercise swaps
      safeQuery(
        `SELECT exercise_name, swap_date, created_at, replacement_exercise_name
         FROM exercise_swaps WHERE user_id = $1`,
        [userId]
      ),

      // 11. Generated workouts (for prescribed-vs-actual; uses subquery)
      safeQuery(
        `SELECT id, exercises FROM generated_workouts
         WHERE id IN (
           SELECT DISTINCT generated_workout_id FROM workouts
           WHERE user_id = $1 AND generated_workout_id IS NOT NULL AND date >= $2
         ) LIMIT 20`,
        [userId, sinceDate]
      ),

      // 12. Workout outcomes
      safeQuery(
        `SELECT generated_workout_id, session_outcome_score FROM workout_outcomes
         WHERE user_id = $1 AND generated_workout_id IN (
           SELECT DISTINCT generated_workout_id FROM workouts
           WHERE user_id = $1 AND generated_workout_id IS NOT NULL AND date >= $2
         )`,
        [userId, sinceDate]
      ),

      // 13. Prescription execution events
      safeQuery(
        `SELECT execution_accuracy, generated_workout_id FROM prescription_execution_events
         WHERE user_id = $1 AND generated_workout_id IN (
           SELECT DISTINCT generated_workout_id FROM workouts
           WHERE user_id = $1 AND generated_workout_id IS NOT NULL AND date >= $2
         )`,
        [userId, sinceDate]
      ),

      // 14. Paused workout
      safeQuery('SELECT * FROM paused_workouts WHERE user_id = $1', [userId]),

      // 15. Active workout session
      safeQuery('SELECT * FROM active_workout_sessions WHERE user_id = $1', [userId]),
    ])

    // Stitch workout history into nested format
    const workouts = stitchWorkouts(workoutsRes, exercisesRes, setsRes)

    // Extract today's workout from the history (avoid duplicate query)
    const todayWorkout = workouts.find(w => w.date === targetDate) || null

    const elapsed = Date.now() - t0
    console.log(`[workout-load] OK ${elapsed}ms | ${workouts.length} workouts | ${libraryRes.length} exercises`)

    return res.json({
      preferences: prefsRes,
      workouts,
      healthMetrics: healthRes,
      exerciseLibrary: libraryRes,
      modelFeedback: feedbackRows,
      connectedAccounts: accountsRows,
      cardioCapabilities: cardioRows,
      exerciseSwaps: swapsRows,
      generatedWorkouts: genWorkoutsRows,
      workoutOutcomes: outcomesRows,
      executionEvents: execEventsRows,
      todayWorkout,
      pausedWorkout: pausedRows[0] || null,
      activeSession: sessionRows[0] || null,
    })
  } catch (err) {
    console.error(`[workout-load] FAIL ${Date.now() - t0}ms:`, err.message)
    return res.status(500).json({ error: { message: err.message } })
  }
})
