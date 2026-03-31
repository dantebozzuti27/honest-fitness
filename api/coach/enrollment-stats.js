import { extractUser } from '../_shared/auth.js'
import { query } from '../_shared/db.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: { message: 'Method not allowed', status: 405 } })
  }

  try {
    const user = extractUser(req)
    if (!user) {
      return res.status(401).json({ success: false, error: { message: 'Invalid or expired token', status: 401 } })
    }

    const programId = (req.query?.programId || '').toString().trim()
    if (!programId) {
      return res.status(400).json({ success: false, error: { message: 'Missing programId', status: 400 } })
    }

    const { rows: programRows } = await query(
      `SELECT id, coach_id FROM coach_programs WHERE id = $1`,
      [programId]
    )
    const program = programRows[0] || null
    if (!program || program.coach_id !== user.id) {
      return res.status(403).json({ success: false, error: { message: 'Not allowed', status: 403 } })
    }

    const isoDay = (d) => new Date(d).toISOString().slice(0, 10)
    const today = isoDay(Date.now())
    const start7 = isoDay(Date.now() - 7 * 86400000)
    const start30 = isoDay(Date.now() - 30 * 86400000)

    const { rows: enrollments } = await query(
      `SELECT id, program_id, user_id, start_date, status, scheduled_count, updated_at
       FROM coach_program_enrollments
       WHERE program_id = $1 AND status = $2
       ORDER BY updated_at DESC
       LIMIT 200`,
      [programId, 'enrolled']
    )

    const userIds = (Array.isArray(enrollments) ? enrollments : []).map(r => r.user_id).filter(Boolean)
    if (userIds.length === 0) {
      return res.status(200).json({ success: true, programId, today, enrollments: [], statsByUserId: {} })
    }

    const { rows: workouts } = await query(
      `SELECT id, user_id, date FROM workouts
       WHERE user_id = ANY($1::uuid[]) AND date >= $2
       ORDER BY date DESC
       LIMIT 5000`,
      [userIds, start30]
    )

    const workoutById = {}
    for (const w of Array.isArray(workouts) ? workouts : []) {
      if (w?.id) workoutById[w.id] = w
    }
    const workoutIds = Object.keys(workoutById)

    let exercises = []
    if (workoutIds.length > 0) {
      const { rows: exRows } = await query(
        `SELECT id, workout_id FROM workout_exercises
         WHERE workout_id = ANY($1::uuid[])
         LIMIT 20000`,
        [workoutIds]
      )
      exercises = Array.isArray(exRows) ? exRows : []
    }

    const exerciseById = {}
    for (const ex of exercises) {
      if (ex?.id) exerciseById[ex.id] = ex
    }
    const exerciseIds = Object.keys(exerciseById)

    let sets = []
    if (exerciseIds.length > 0) {
      const { rows: setRows } = await query(
        `SELECT workout_exercise_id, weight, reps FROM workout_sets
         WHERE workout_exercise_id = ANY($1::uuid[])
         LIMIT 50000`,
        [exerciseIds]
      )
      sets = Array.isArray(setRows) ? setRows : []
    }

    const statsByUserId = {}
    for (const uid of userIds) {
      statsByUserId[uid] = {
        workouts7d: 0,
        workouts30d: 0,
        tonnage7d: 0,
        tonnage30d: 0,
        lastWorkoutDate: null
      }
    }

    for (const w of Array.isArray(workouts) ? workouts : []) {
      const uid = w?.user_id
      const date = (w?.date || '').toString()
      if (!uid || !statsByUserId[uid] || !date) continue
      statsByUserId[uid].workouts30d += 1
      if (date >= start7) statsByUserId[uid].workouts7d += 1
      if (!statsByUserId[uid].lastWorkoutDate || date > statsByUserId[uid].lastWorkoutDate) {
        statsByUserId[uid].lastWorkoutDate = date
      }
    }

    for (const s of Array.isArray(sets) ? sets : []) {
      const exId = s?.workout_exercise_id
      const ex = exerciseById[exId]
      const w = ex ? workoutById[ex.workout_id] : null
      const uid = w?.user_id
      const date = (w?.date || '').toString()
      if (!uid || !statsByUserId[uid] || !date) continue

      const weight = Number(s?.weight)
      const reps = Number(s?.reps)
      if (!Number.isFinite(weight) || !Number.isFinite(reps) || weight <= 0 || reps <= 0) continue
      const tonnage = weight * reps
      statsByUserId[uid].tonnage30d += tonnage
      if (date >= start7) statsByUserId[uid].tonnage7d += tonnage
    }

    let profilesByUserId = {}
    try {
      const { rows: profiles } = await query(
        `SELECT user_id, username, display_name, profile_picture FROM user_profiles
         WHERE user_id = ANY($1::uuid[])
         LIMIT 500`,
        [userIds]
      )
      for (const p of Array.isArray(profiles) ? profiles : []) {
        profilesByUserId[p.user_id] = p
      }
    } catch {
      // ignore
    }

    return res.status(200).json({
      success: true,
      programId,
      today,
      enrollments: enrollments || [],
      profilesByUserId,
      statsByUserId
    })
  } catch (e) {
    console.error('coach/enrollment-stats error', e)
    return res.status(500).json({ success: false, error: { message: 'Server error', status: 500 } })
  }
}
