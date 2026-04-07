import express from 'express'
import { randomUUID } from 'node:crypto'
import { transaction, query } from '../database/pg.js'

export const workoutSaveRouter = express.Router()

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function isUuidV4(s) { return typeof s === 'string' && UUID_V4_RE.test(s) }

function getWeekStartMonday(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`)
  if (isNaN(d.getTime())) return dateStr
  const dow = d.getDay()
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow))
  return d.toISOString().slice(0, 10)
}

function buildBatchInsert(table, columns, rows) {
  let idx = 1
  const groups = rows.map(() => {
    const ph = columns.map(() => `$${idx++}`)
    return `(${ph.join(', ')})`
  })
  const params = rows.flatMap(row => columns.map(col => row[col] ?? null))
  const colList = columns.map(c => `"${c}"`).join(', ')
  return { text: `INSERT INTO "${table}" (${colList}) VALUES ${groups.join(', ')}`, params }
}

workoutSaveRouter.post('/', async (req, res) => {
  const t0 = Date.now()
  try {
    const userId = req.userId
    if (!userId) return res.status(401).json({ error: { message: 'Not authenticated' } })

    const { workout, exercises: rawEx, executionEvents: rawEv } = req.body
    if (!workout?.date) return res.status(400).json({ error: { message: 'Missing workout.date' } })

    const workoutId = isUuidV4(workout.id) ? workout.id : randomUUID()
    const exercises = Array.isArray(rawEx) ? rawEx : []
    const genId = isUuidV4(workout.generatedWorkoutId) ? workout.generatedWorkoutId : null
    const sessionType = String(workout.sessionType || workout.session_type || 'workout').toLowerCase() === 'recovery' ? 'recovery' : 'workout'

    const result = await transaction(async (client) => {
      // 1. Batch library lookup
      const names = [...new Set(exercises.map(e => e.name).filter(Boolean))]
      const libMap = new Map()
      if (names.length > 0) {
        const lib = await client.query(
          'SELECT id, name FROM exercise_library WHERE name = ANY($1) AND is_custom = false',
          [names]
        )
        for (const r of lib.rows) libMap.set(r.name, r.id)
      }

      // 2. Upsert workout row
      const wRes = await client.query(
        `INSERT INTO workouts (id, user_id, date, duration, completed, template_name,
           perceived_effort, session_rpe, training_density, mood_after, notes, day_of_week,
           workout_calories_burned, workout_steps, generated_workout_id, updated_at,
           workout_start_time, workout_end_time, session_type)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         ON CONFLICT (id) DO UPDATE SET
           date=EXCLUDED.date, duration=EXCLUDED.duration, completed=EXCLUDED.completed,
           template_name=EXCLUDED.template_name, perceived_effort=EXCLUDED.perceived_effort,
           session_rpe=EXCLUDED.session_rpe, training_density=EXCLUDED.training_density,
           mood_after=EXCLUDED.mood_after, notes=EXCLUDED.notes, day_of_week=EXCLUDED.day_of_week,
           workout_calories_burned=EXCLUDED.workout_calories_burned, workout_steps=EXCLUDED.workout_steps,
           generated_workout_id=EXCLUDED.generated_workout_id, updated_at=EXCLUDED.updated_at,
           workout_start_time=EXCLUDED.workout_start_time, workout_end_time=EXCLUDED.workout_end_time,
           session_type=EXCLUDED.session_type
         RETURNING *`,
        [
          workoutId, userId, workout.date, workout.duration ?? null, true,
          workout.templateName || null,
          workout.perceivedEffort ?? null, workout.perceivedEffort ?? null,
          workout.trainingDensity != null ? Number(workout.trainingDensity) : null,
          workout.moodAfter || null, workout.notes || null, workout.dayOfWeek ?? null,
          workout.workoutCaloriesBurned != null ? Number(workout.workoutCaloriesBurned) : null,
          workout.workoutSteps != null ? Number(workout.workoutSteps) : null,
          genId, new Date().toISOString(),
          workout.workoutStartTime || null, workout.workoutEndTime || null,
          sessionType,
        ]
      )
      const workoutRow = wRes.rows[0]

      // 3. Delete old exercises/sets (safe inside transaction — rolls back if insert fails)
      await client.query(
        `DELETE FROM workout_sets WHERE workout_exercise_id IN
         (SELECT id FROM workout_exercises WHERE workout_id = $1)`,
        [workoutId]
      )
      await client.query('DELETE FROM workout_exercises WHERE workout_id = $1', [workoutId])

      if (exercises.length === 0) return workoutRow

      // 4. Batch insert exercises
      const exCols = ['workout_id', 'exercise_name', 'category', 'body_part', 'equipment',
        'exercise_order', 'exercise_type', 'exercise_library_id', 'distance', 'distance_unit',
        'stacked', 'stack_group']
      const exData = exercises.map((ex, i) => ({
        workout_id: workoutId,
        exercise_name: ex.name,
        category: ex.category || null,
        body_part: ex.bodyPart || null,
        equipment: ex.equipment || null,
        exercise_order: i,
        exercise_type: ex.exerciseType || 'weightlifting',
        exercise_library_id: libMap.get(ex.name) || null,
        distance: ex.distance || null,
        distance_unit: ex.distanceUnit || 'km',
        stacked: ex.stacked || false,
        stack_group: ex.stackGroup || null,
      }))
      const exIns = buildBatchInsert('workout_exercises', exCols, exData)
      const exRes = await client.query(exIns.text + ' RETURNING id, exercise_order', exIns.params)
      const exIdByOrder = new Map()
      for (const r of exRes.rows) exIdByOrder.set(r.exercise_order, r.id)

      // 5. Batch insert all sets
      const setCols = ['workout_exercise_id', 'set_number', 'weight', 'is_bodyweight',
        'weight_label', 'reps', 'time', 'speed', 'incline', 'is_warmup',
        'is_unilateral', 'load_interpretation', 'reps_interpretation',
        'logged_at', 'rest_seconds_before']
      const allSets = []
      for (let i = 0; i < exercises.length; i++) {
        const exId = exIdByOrder.get(i)
        if (!exId) continue
        const sets = Array.isArray(exercises[i].sets) ? exercises[i].sets : []
        for (let si = 0; si < sets.length; si++) {
          const s = sets[si]
          allSets.push({
            workout_exercise_id: exId,
            set_number: si + 1,
            weight: s.weight ?? null,
            is_bodyweight: s.is_bodyweight || false,
            weight_label: s.weight_label || null,
            reps: s.reps != null ? Number(s.reps) : null,
            time: s.time ?? null,
            speed: s.speed != null ? Number(s.speed) : null,
            incline: s.incline != null ? Number(s.incline) : null,
            is_warmup: s.is_warmup || false,
            is_unilateral: s.is_unilateral || false,
            load_interpretation: s.load_interpretation || null,
            reps_interpretation: s.reps_interpretation || null,
            logged_at: s.logged_at || null,
            rest_seconds_before: s.rest_seconds_before ?? null,
          })
        }
      }
      if (allSets.length > 0) {
        const sIns = buildBatchInsert('workout_sets', setCols, allSets)
        try {
          await client.query(sIns.text, sIns.params)
        } catch (setErr) {
          if (setErr.code === '42703') {
            const minCols = ['workout_exercise_id', 'set_number', 'weight', 'reps', 'time',
              'speed', 'incline', 'logged_at', 'rest_seconds_before']
            const minSets = allSets.map(s => {
              const o = {}
              for (const c of minCols) o[c] = s[c] ?? null
              return o
            })
            const sIns2 = buildBatchInsert('workout_sets', minCols, minSets)
            await client.query(sIns2.text, sIns2.params)
          } else {
            throw setErr
          }
        }
      }

      // 6. Batch insert execution events
      const events = Array.isArray(rawEv) ? rawEv : []
      if (events.length > 0) {
        const evCols = ['user_id', 'workout_id', 'workout_exercise_id', 'generated_workout_id',
          'workout_date', 'exercise_name', 'set_number', 'target_weight', 'actual_weight',
          'target_reps', 'actual_reps', 'target_time_seconds', 'actual_time_seconds',
          'target_rir', 'actual_rir', 'execution_accuracy', 'idempotency_key']
        const evData = events.map(ev => {
          const exId = exIdByOrder.get(ev._exercise_order) || null
          const key = [workoutId, exId || ev._exercise_order, ev.set_number,
            ev.target_weight ?? 'x', ev.actual_weight ?? 'x',
            ev.target_reps ?? 'x', ev.actual_reps ?? 'x',
            ev.target_time_seconds ?? 'x', ev.actual_time_seconds ?? 'x'].join(':')
          return {
            user_id: userId, workout_id: workoutId,
            workout_exercise_id: exId, generated_workout_id: genId,
            workout_date: workout.date, exercise_name: ev.exercise_name || null,
            set_number: ev.set_number ?? null, target_weight: ev.target_weight ?? null,
            actual_weight: ev.actual_weight ?? null, target_reps: ev.target_reps ?? null,
            actual_reps: ev.actual_reps ?? null, target_time_seconds: ev.target_time_seconds ?? null,
            actual_time_seconds: ev.actual_time_seconds ?? null, target_rir: ev.target_rir ?? null,
            actual_rir: ev.actual_rir ?? null, execution_accuracy: ev.execution_accuracy ?? null,
            idempotency_key: key,
          }
        })
        const evIns = buildBatchInsert('prescription_execution_events', evCols, evData)
        try {
          await client.query(evIns.text + ' ON CONFLICT (user_id, idempotency_key) DO NOTHING', evIns.params)
        } catch (evErr) {
          console.warn('[workout-save] Execution events skipped:', evErr.message)
        }
      }

      return workoutRow
    })

    // Post-transaction best-effort: weekly plan reconciliation
    try {
      const ws = getWeekStartMonday(workout.date)
      const v = await query(
        `SELECT id FROM weekly_plan_versions WHERE user_id=$1 AND week_start_date=$2 AND status='active' ORDER BY created_at DESC LIMIT 1`,
        [userId, ws]
      )
      if (v.rows[0]?.id) {
        await query(
          `UPDATE weekly_plan_days SET day_status='completed', actual_workout_id=$1, last_reconciled_at=$2
           WHERE weekly_plan_id=$3 AND user_id=$4 AND plan_date=$5`,
          [workoutId, new Date().toISOString(), v.rows[0].id, userId, workout.date]
        )
      }
    } catch (e) {
      console.warn('[workout-save] Weekly plan reconciliation skipped:', e.message)
    }

    const ms = Date.now() - t0
    const setCount = exercises.reduce((n, e) => n + (e.sets?.length || 0), 0)
    console.log(`[workout-save] OK ${ms}ms | ${exercises.length} exercises | ${setCount} sets`)
    return res.json({ data: result, error: null })
  } catch (err) {
    console.error(`[workout-save] FAIL ${Date.now() - t0}ms:`, err.message)
    return res.status(500).json({ data: null, error: { message: err.message } })
  }
})
