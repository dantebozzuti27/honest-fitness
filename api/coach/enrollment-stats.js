export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' })
  }

  try {
    // -----------------------------
    // Auth (required)
    // -----------------------------
    const authHeader = req.headers?.authorization || req.headers?.Authorization
    if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Missing authorization', success: false })
    }
    const token = authHeader.slice('Bearer '.length).trim()
    if (!token) {
      return res.status(401).json({ message: 'Missing authorization token', success: false })
    }

    const programId = (req.query?.programId || '').toString().trim()
    if (!programId) {
      return res.status(400).json({ message: 'Missing programId', success: false })
    }

    const { createClient } = await import('@supabase/supabase-js')
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ message: 'Server configuration error', success: false })
    }
    const supabase = createClient(supabaseUrl, supabaseKey)

    const { data: { user }, error: userErr } = await supabase.auth.getUser(token)
    if (userErr || !user) {
      return res.status(401).json({ message: 'Invalid or expired token', success: false })
    }

    // Verify caller owns the program.
    const { data: program, error: programErr } = await supabase
      .from('coach_programs')
      .select('id, coach_id')
      .eq('id', programId)
      .maybeSingle()
    if (programErr) throw programErr
    if (!program || program.coach_id !== user.id) {
      return res.status(403).json({ message: 'Not allowed', success: false })
    }

    const isoDay = (d) => {
      // Use UTC date key for backend aggregation; DB `date` columns are DATE (no TZ).
      return new Date(d).toISOString().slice(0, 10)
    }
    const today = isoDay(Date.now())
    const start7 = isoDay(Date.now() - 7 * 86400000)
    const start30 = isoDay(Date.now() - 30 * 86400000)

    const { data: enrollments, error: enrollErr } = await supabase
      .from('coach_program_enrollments')
      .select('id, program_id, user_id, start_date, status, scheduled_count, updated_at')
      .eq('program_id', programId)
      .eq('status', 'enrolled')
      .order('updated_at', { ascending: false })
      .limit(200)
    if (enrollErr) throw enrollErr

    const userIds = (Array.isArray(enrollments) ? enrollments : []).map(r => r.user_id).filter(Boolean)
    if (userIds.length === 0) {
      return res.status(200).json({ success: true, programId, today, enrollments: [], statsByUserId: {} })
    }

    // Workouts (last 30d)
    const { data: workouts, error: workoutsErr } = await supabase
      .from('workouts')
      .select('id, user_id, date')
      .in('user_id', userIds)
      .gte('date', start30)
      .order('date', { ascending: false })
      .limit(5000)
    if (workoutsErr) throw workoutsErr

    const workoutById = {}
    for (const w of Array.isArray(workouts) ? workouts : []) {
      if (w?.id) workoutById[w.id] = w
    }
    const workoutIds = Object.keys(workoutById)

    // Exercises for those workouts
    let exercises = []
    if (workoutIds.length > 0) {
      const { data: exRows, error: exErr } = await supabase
        .from('workout_exercises')
        .select('id, workout_id')
        .in('workout_id', workoutIds)
        .limit(20000)
      if (exErr) throw exErr
      exercises = Array.isArray(exRows) ? exRows : []
    }

    const exerciseById = {}
    for (const ex of exercises) {
      if (ex?.id) exerciseById[ex.id] = ex
    }
    const exerciseIds = Object.keys(exerciseById)

    // Sets for those exercises (strength tonnage only)
    let sets = []
    if (exerciseIds.length > 0) {
      const { data: setRows, error: setsErr } = await supabase
        .from('workout_sets')
        .select('workout_exercise_id, weight, reps')
        .in('workout_exercise_id', exerciseIds)
        .limit(50000)
      if (setsErr) throw setsErr
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

    // Workout counts + last date
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

    // Tonnage from sets
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

    // Profiles (best-effort)
    let profilesByUserId = {}
    try {
      const { data: profiles, error: profErr } = await supabase
        .from('user_profiles')
        .select('user_id, username, display_name, profile_picture')
        .in('user_id', userIds)
        .limit(500)
      if (!profErr) {
        for (const p of Array.isArray(profiles) ? profiles : []) {
          profilesByUserId[p.user_id] = p
        }
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
    return res.status(500).json({ success: false, message: 'Server error' })
  }
}


