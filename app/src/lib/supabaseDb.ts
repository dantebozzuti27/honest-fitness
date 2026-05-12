import { db } from './dbClient'
import { getLocalDate, getTodayEST, getYesterdayEST } from '../utils/dateUtils'
import { toInteger, toNumber } from '../utils/numberUtils'
import { logError, logDebug, logWarn } from '../utils/logger'
import { isUuidV4, uuidv4 } from '../utils/uuid'
import { enqueueOutboxItem } from './syncOutbox'
import { DEFAULT_MODEL_CONFIG } from './modelConfig'

const supabase: any = db as any

// Ensure logDebug is always available (fallback for build issues)
const safeLogDebug = logDebug || (() => {})

// Simple TTL cache for frequent Supabase reads (shorter TTL for fresher active data)
const readCache = new Map<string, { data: any; ts: number }>()
const CACHE_TTL_MS = 30_000

function getCached<T>(key: string): T | undefined {
  const entry = readCache.get(key)
  if (entry && Date.now() - entry.ts < CACHE_TTL_MS) return entry.data as T
  if (entry) readCache.delete(key)
  return undefined
}

function setCache(key: string, data: any) {
  readCache.set(key, { data, ts: Date.now() })
}

function getWeekStartMondayFromDateString(dateStr: string): string {
  const d = new Date(`${String(dateStr)}T12:00:00`)
  if (Number.isNaN(d.getTime())) return String(dateStr)
  const dow = d.getDay() // 0 = Sunday
  const shift = dow === 0 ? -6 : 1 - dow
  d.setDate(d.getDate() + shift)
  return getLocalDate(d)
}

function isLikelyUnilateralExerciseName(name: string): boolean {
  const n = String(name || '').toLowerCase()
  return /single[\s-]*(arm|leg)|one[\s-]*(arm|leg)|unilateral|split squat|step[\s-]*up|cossack|single[\s-]*leg|single[\s-]*arm/.test(n)
}

function normalizeSetLoadForStorage(exerciseName: string, set: any): {
  normalizedWeight: number | null;
  isBodyweight: boolean;
  isUnilateral: boolean;
  loadInterpretation: 'per_hand_per_side' | 'total_both_per_side' | 'unknown';
  repsInterpretation: 'per_side' | 'total_reps';
} {
  const isBodyweight = String(set?.weight || '').trim().toUpperCase() === 'BW'
  const isUnilateral = isLikelyUnilateralExerciseName(exerciseName)
  const rawMode = String(set?._load_interpretation || set?.load_interpretation || '').toLowerCase()
  const loadInterpretation: 'per_hand_per_side' | 'total_both_per_side' | 'unknown' = isUnilateral
    ? (rawMode.includes('total') || rawMode.includes('both')
      ? 'total_both_per_side'
      : 'per_hand_per_side')
    : 'unknown'
  const repsInterpretation: 'per_side' | 'total_reps' = isUnilateral ? 'per_side' : 'total_reps'
  const parsed = isBodyweight ? null : (set?.weight != null && set.weight !== '' ? Number(set.weight) : null)
  let normalizedWeight = Number.isFinite(parsed as number) ? Number(parsed) : null
  if (normalizedWeight != null && isUnilateral && loadInterpretation === 'total_both_per_side') {
    // Canonical convention: unilateral DB load should be stored per-hand/per-side.
    normalizedWeight = Math.round((normalizedWeight / 2) * 100) / 100
  }
  return { normalizedWeight, isBodyweight, isUnilateral, loadInterpretation, repsInterpretation }
}

function inferCardioModality(exerciseName: string): 'walk' | 'run' | 'stair' | 'bike' | 'row' | 'elliptical' | 'other' {
  const n = String(exerciseName || '').toLowerCase()
  if (/stairmaster|stair master|stepmill/.test(n)) return 'stair'
  if (/bike|cycle/.test(n)) return 'bike'
  if (/row/.test(n)) return 'row'
  if (/elliptical/.test(n)) return 'elliptical'
  if (/run|jog|sprint/.test(n)) return 'run'
  if (/walk|treadmill|incline|hike|ruck/.test(n)) return 'walk'
  return 'other'
}

async function upsertCardioCapabilityFromWorkout(userId: string, workout: any) {
  try {
    const exs = Array.isArray(workout?.exercises) ? workout.exercises : []
    const byModality = new Map<string, { speeds: number[]; inclines: number[]; samples: number }>()
    for (const ex of exs) {
      const category = String(ex?.category || ex?.exerciseType || '').toLowerCase()
      const isCardio = category === 'cardio' || String(ex?.name || '').toLowerCase().includes('walk') || String(ex?.name || '').toLowerCase().includes('run')
      if (!isCardio) continue
      const modality = inferCardioModality(ex?.name || '')
      const row = byModality.get(modality) ?? { speeds: [], inclines: [], samples: 0 }
      for (const s of (Array.isArray(ex?.sets) ? ex.sets : [])) {
        const speed = s?.speed != null && s.speed !== '' ? Number(s.speed) : null
        const incline = s?.incline != null && s.incline !== '' ? Number(s.incline) : null
        if (Number.isFinite(speed as number) && (speed as number) > 0) row.speeds.push(Number(speed))
        if (Number.isFinite(incline as number) && (incline as number) >= 0) row.inclines.push(Number(incline))
        row.samples += 1
      }
      byModality.set(modality, row)
    }

    for (const [modality, sample] of byModality.entries()) {
      if (sample.speeds.length === 0 && sample.inclines.length === 0) continue
      const sampleAvgSpeed = sample.speeds.length > 0 ? sample.speeds.reduce((a, b) => a + b, 0) / sample.speeds.length : null
      const sampleMaxSpeed = sample.speeds.length > 0 ? Math.max(...sample.speeds) : null
      const sampleMaxIncline = sample.inclines.length > 0 ? Math.max(...sample.inclines) : null

      const { data: existing } = await supabase
        .from('cardio_capability_profiles')
        .select('max_speed, comfortable_speed, max_incline, observed_sessions, confidence_score')
        .eq('user_id', userId)
        .eq('modality', modality)
        .maybeSingle()

      const priorSessions = Number(existing?.observed_sessions ?? 0)
      const newSessions = priorSessions + Math.max(1, sample.samples)
      const priorComfort = existing?.comfortable_speed != null ? Number(existing.comfortable_speed) : null
      const nextComfort = sampleAvgSpeed == null
        ? priorComfort
        : (priorComfort == null
          ? sampleAvgSpeed
          : ((priorComfort * priorSessions) + (sampleAvgSpeed * Math.max(1, sample.samples))) / Math.max(newSessions, 1))
      const nextMaxSpeed = sampleMaxSpeed == null
        ? (existing?.max_speed != null ? Number(existing.max_speed) : null)
        : Math.max(Number(existing?.max_speed ?? 0), sampleMaxSpeed)
      const nextMaxIncline = sampleMaxIncline == null
        ? (existing?.max_incline != null ? Number(existing.max_incline) : null)
        : Math.max(Number(existing?.max_incline ?? 0), sampleMaxIncline)
      const confidence = Math.max(0.3, Math.min(1, newSessions / 24))

      let capMaxSpeed = nextMaxSpeed
      let capComfort = nextComfort
      if (modality === 'walk') {
        const mphCap = DEFAULT_MODEL_CONFIG.maxWalkSpeedMph
        if (capComfort != null && Number.isFinite(capComfort)) capComfort = Math.min(capComfort, mphCap)
        if (capMaxSpeed != null && Number.isFinite(capMaxSpeed)) capMaxSpeed = Math.min(capMaxSpeed, mphCap)
      }

      await supabase
        .from('cardio_capability_profiles')
        .upsert({
          user_id: userId,
          modality,
          max_speed: capMaxSpeed,
          comfortable_speed: capComfort,
          max_incline: nextMaxIncline,
          observed_sessions: newSessions,
          confidence_score: confidence,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,modality' })
    }
  } catch (err: any) {
    const msg = `${err?.message || ''}`.toLowerCase()
    if (err?.code === 'PGRST205' || msg.includes('cardio_capability_profiles') || msg.includes('column')) return
    logWarn('Failed to upsert cardio capability profile', err)
  }
}

/** Clears the Supabase read cache. Call after writes (e.g. saveWorkout) for immediate consistency. */
export function invalidateDbCache() {
  readCache.clear()
}

let pausedWorkoutsDisabled = false
function disablePausedWorkouts(reason: any) {
  if (pausedWorkoutsDisabled) return
  pausedWorkoutsDisabled = true
  safeLogDebug('Disabling paused_workouts for this session:', reason || 'paused_workouts is unavailable')
}

// ============ WORKOUTS ============
// IMPORTANT: Workouts are ONLY created through explicit user action (finishing a workout).
// This function is ONLY called from ActiveWorkout.jsx when the user finishes a workout.
// NEVER call this function automatically or with dummy/test data.

export async function saveWorkoutToSupabase(workout: any, userId: string) {
  // Data pipeline: Validate -> Clean -> Build payload -> POST to dedicated endpoint
  const allowUnvalidatedSave = (import.meta as any)?.env?.VITE_ALLOW_UNVALIDATED_WORKOUT_SAVE === '1'

  // Step 1: Validate
  try {
    const { validateWorkout } = await import('./dataValidation')
    if (typeof validateWorkout === 'function') {
      const v = validateWorkout(workout)
      if (!v.valid) {
        logError('Workout validation failed', v.errors)
        throw new Error(`Workout validation failed: ${v.errors.join(', ')}`)
      }
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Workout validation')) throw e
    logError('Validation module unavailable', e)
    if (!allowUnvalidatedSave) throw e instanceof Error ? e : new Error('Validation unavailable')
  }

  // Step 2: Clean
  let workoutToSave = workout
  try {
    const { cleanWorkoutData } = await import('./dataCleaning')
    if (typeof cleanWorkoutData === 'function') workoutToSave = cleanWorkoutData(workout)
  } catch { /* use original */ }

  if (workoutToSave.exercises && !Array.isArray(workoutToSave.exercises)) {
    throw new Error('Workout exercises must be an array')
  }
  if (workoutToSave.exercises?.length > 0 && workoutToSave.exercises.some((ex: any) => !ex?.name)) {
    throw new Error('All exercises must have a name')
  }

  // Step 3: Infer session type
  const inferSessionType = () => {
    const exs = Array.isArray(workoutToSave.exercises) ? workoutToSave.exercises : []
    if (exs.length === 0) return 'workout'
    return exs.every((e: any) => (e?.category || '').toLowerCase() === 'recovery') ? 'recovery' : 'workout'
  }
  const sessionType = String(workoutToSave.sessionType || workoutToSave.session_type || inferSessionType()).toLowerCase() === 'recovery' ? 'recovery' : 'workout'

  const workoutId = isUuidV4(workoutToSave?.id) ? workoutToSave.id : uuidv4()

  // Step 4: Build exercises payload with normalized set data
  const rawExercises = Array.isArray(workoutToSave.exercises) ? workoutToSave.exercises : []
  const exercises: any[] = []
  const executionEvents: any[] = []

  const scoreAccuracy = (target: number | null, actual: number | null) => {
    if (!Number.isFinite(target as number) || target == null || target <= 0) return null
    if (!Number.isFinite(actual as number) || actual == null) return null
    return Math.max(0, Math.min(1, Math.min(target, actual) / Math.max(target, actual)))
  }

  for (let i = 0; i < rawExercises.length; i++) {
    const ex = rawExercises[i]
    const rawSets = Array.isArray(ex.sets) ? ex.sets : []
    const validSets = rawSets.filter((s: any) =>
      s.weight || s.reps || s.time || s.time_seconds || s.speed || s.incline
    )
    if (validSets.length === 0) continue

    const exerciseType = ex.exerciseType || (ex.distance || ex.time ? 'cardio' : 'weightlifting')
    const exOrder = exercises.length

    const normalizedSets = validSets.map((set: any, idx: number) => {
      let timeVal = set.time || null
      if (!timeVal && set.time_seconds != null && Number(set.time_seconds) > 0) {
        timeVal = String(Math.floor(Number(set.time_seconds)))
      }
      const loadNorm = normalizeSetLoadForStorage(ex.name, set)
      const loggedAt = set.logged_at || set.loggedAt || null
      const prevLoggedAt = idx > 0 ? (validSets[idx - 1]?.logged_at || validSets[idx - 1]?.loggedAt || null) : null
      let restSecondsBefore: number | null = null
      if (loggedAt && prevLoggedAt) {
        const diff = (new Date(loggedAt).getTime() - new Date(prevLoggedAt).getTime()) / 1000
        if (diff > 10 && diff < 1200) restSecondsBefore = Math.round(diff)
      }

      // Build execution event data for this set
      const targetWeight = set?.target_weight != null ? Number(set.target_weight) : null
      const actualWeight = loadNorm.isBodyweight ? null : loadNorm.normalizedWeight
      const targetReps = set?.target_reps != null ? Number(set.target_reps) : null
      const actualReps = set?.reps != null && set.reps !== '' ? Number(set.reps) : null
      const targetTimeSeconds = set?.target_time_seconds != null ? Number(set.target_time_seconds) : null
      const actualTimeSeconds = set?.time_seconds != null && set.time_seconds !== '' ? Number(set.time_seconds) : null
      const targetRir = ex?._prescription?.targetRir != null ? Number(ex._prescription.targetRir) : null
      const actualRir = set?.actual_rir != null ? Number(set.actual_rir) : null
      const wAcc = scoreAccuracy(targetWeight, actualWeight)
      const rAcc = scoreAccuracy(targetReps, actualReps)
      const tAcc = scoreAccuracy(targetTimeSeconds, actualTimeSeconds)
      const accParts = [wAcc, rAcc, tAcc].filter((v): v is number => v != null)
      const execAcc = accParts.length > 0 ? accParts.reduce((a, b) => a + b, 0) / accParts.length : null

      if (targetWeight != null || targetReps != null || targetTimeSeconds != null) {
        executionEvents.push({
          _exercise_order: exOrder,
          exercise_name: ex.name || null,
          set_number: idx + 1,
          target_weight: targetWeight, actual_weight: actualWeight,
          target_reps: targetReps, actual_reps: actualReps,
          target_time_seconds: targetTimeSeconds, actual_time_seconds: actualTimeSeconds,
          target_rir: targetRir, actual_rir: actualRir,
          execution_accuracy: execAcc,
        })
      }

      return {
        weight: loadNorm.normalizedWeight,
        is_bodyweight: loadNorm.isBodyweight,
        weight_label: loadNorm.isBodyweight ? 'BW' : null,
        reps: set.reps ? Number(set.reps) : null,
        time: timeVal,
        speed: set.speed ? Number(set.speed) : null,
        incline: set.incline ? Number(set.incline) : null,
        is_warmup: set._is_warmup === true || set.is_warmup === true || false,
        is_unilateral: loadNorm.isUnilateral,
        load_interpretation: loadNorm.loadInterpretation,
        reps_interpretation: loadNorm.repsInterpretation,
        logged_at: loggedAt,
        rest_seconds_before: restSecondsBefore,
      }
    })

    exercises.push({
      name: ex.name,
      category: ex.category || null,
      bodyPart: ex.bodyPart || null,
      equipment: ex.equipment || null,
      exerciseType,
      isCustom: ex.isCustom || false,
      distance: ex.distance || null,
      distanceUnit: ex.distanceUnit || 'km',
      stacked: ex.stacked || false,
      stackGroup: ex.stackGroup || null,
      sets: normalizedSets,
    })
  }

  // Step 5: Build the full payload
  const payload = {
    workout: {
      id: workoutId,
      date: workoutToSave.date,
      duration: workoutToSave.duration,
      templateName: workoutToSave.templateName || null,
      perceivedEffort: workoutToSave.perceivedEffort || null,
      trainingDensity: workoutToSave.trainingDensity ?? null,
      moodAfter: workoutToSave.moodAfter || null,
      notes: workoutToSave.notes || null,
      dayOfWeek: workoutToSave.dayOfWeek ?? null,
      workoutCaloriesBurned: workoutToSave.workoutCaloriesBurned ?? null,
      workoutSteps: workoutToSave.workoutSteps ?? null,
      generatedWorkoutId: workoutToSave.generatedWorkoutId || null,
      workoutStartTime: workoutToSave.workoutStartTime || null,
      workoutEndTime: workoutToSave.workoutEndTime || null,
      sessionType,
    },
    exercises,
    executionEvents,
  }

  // Step 6: POST to dedicated endpoint with retry. Throws on failure — caller
  // is responsible for outbox queuing (write-ahead pattern in ActiveWorkout).
  const { getIdToken } = await import('./cognitoAuth')
  const { apiUrl } = await import('./urlConfig')

  const doPost = async (): Promise<any> => {
    const token = await getIdToken().catch(() => '')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8_000)
    try {
      const resp = await fetch(apiUrl('/api/workout-save'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      clearTimeout(timer)
      if (!resp.ok) {
        const text = await resp.text().catch(() => '')
        throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`)
      }
      const body = await resp.json()
      if (body.error) throw new Error(body.error.message || 'Server returned error')
      return body.data
    } catch (e) {
      clearTimeout(timer)
      throw e
    }
  }

  // Attempt 1
  try {
    const result = await doPost()
    await upsertCardioCapabilityFromWorkout(userId, workoutToSave).catch(() => {})
    invalidateDbCache()
    return result
  } catch (e1) {
    logWarn('Workout save attempt 1 failed:', e1 instanceof Error ? e1.message : String(e1))
  }

  // Pre-warm and retry
  await fetch(apiUrl('/api/ping')).catch(() => {})
  await new Promise(r => setTimeout(r, 500))

  const result = await doPost()
  await upsertCardioCapabilityFromWorkout(userId, workoutToSave).catch(() => {})
  invalidateDbCache()
  return result
}

export async function getWorkoutsFromSupabase(userId: string) {
  // Offline fallback: read from IndexedDB when the device has no network
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    try {
      const { getAllWorkouts } = await import('../db/index')
      const local = await getAllWorkouts()
      return Array.isArray(local) ? local : []
    } catch {
      return []
    }
  }

  const cacheKey = `workouts_${userId}`
  const cached = getCached<any[]>(cacheKey)
  if (cached) return cached

  // Prefer a single embedded query for convenience, but be resilient:
  // some deployments have missing relationships / RLS differences that can break embeds.
  const embedded = await supabase
    .from('workouts')
    .select(`
      *,
      workout_exercises (
        *,
        workout_sets (*)
      )
    `)
    .eq('user_id', userId)
    .order('date', { ascending: false })

  if (!embedded.error) {
    const result = embedded.data || []
    setCache(cacheKey, result)
    return result
  }

  // Fallback: fetch workouts then separately fetch children and stitch together.
  safeLogDebug('getWorkoutsFromSupabase: embedded select failed; fetching separately', {
    code: embedded.error?.code,
    message: embedded.error?.message
  })

  const plain = await supabase
    .from('workouts')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: false })

  if (plain.error) throw plain.error
  const workouts = plain.data || []
  if (workouts.length === 0) {
    setCache(cacheKey, [])
    return []
  }

  const workoutIds = workouts.map((w: any) => w.id)
  const { data: exRows } = await supabase
    .from('workout_exercises')
    .select('*')
    .in('workout_id', workoutIds)

  const exercises = exRows || []
  const exerciseIds = exercises.map((e: any) => e.id)

  let sets: any[] = []
  if (exerciseIds.length > 0) {
    const { data: setRows } = await supabase
      .from('workout_sets')
      .select('*')
      .in('workout_exercise_id', exerciseIds)
    sets = setRows || []
  }

  const setsByExercise: Record<string, any[]> = {}
  for (const s of sets) {
    const key = s.workout_exercise_id
    if (!setsByExercise[key]) setsByExercise[key] = []
    setsByExercise[key].push(s)
  }

  const exercisesByWorkout: Record<string, any[]> = {}
  for (const ex of exercises) {
    ex.workout_sets = setsByExercise[ex.id] || []
    const key = ex.workout_id
    if (!exercisesByWorkout[key]) exercisesByWorkout[key] = []
    exercisesByWorkout[key].push(ex)
  }

  const result = workouts.map((w: any) => ({
    ...w,
    workout_exercises: exercisesByWorkout[w.id] || []
  }))
  setCache(cacheKey, result)
  return result
}

// Lightweight query for "last-time cues" (avoid fetching all history)
export async function getRecentWorkoutsFromSupabase(userId: string, limit = 30) {
  if (!userId) return []
  const n = Number(limit || 0)
  const safeLimit = Number.isFinite(n) ? Math.max(1, Math.min(100, Math.floor(n))) : 30

  const cacheKey = `recent_workouts_${userId}_${safeLimit}`
  const cached = getCached<any[]>(cacheKey)
  if (cached) return cached

  const WORKOUT_SELECT_FULL = `
      id, date, created_at, duration, template_name,
      workout_avg_hr, workout_peak_hr,
      workout_calories_burned, workout_steps, workout_active_minutes, workout_hr_zones,
      workout_exercises (
        exercise_name, body_part, exercise_type,
        workout_sets ( weight, reps, time, speed, incline )
      )`
  const WORKOUT_SELECT_BASE = `
      id, date, created_at, duration, template_name,
      workout_exercises (
        exercise_name, body_part, exercise_type,
        workout_sets ( weight, reps, time, speed, incline )
      )`

  let { data, error } = await supabase
    .from('workouts')
    .select(WORKOUT_SELECT_FULL)
    .eq('user_id', userId)
    .order('date', { ascending: false })
    .limit(safeLimit)

  // If columns don't exist (migration not run), retry with base columns
  if (error?.code === 'PGRST204' || (error && error.message?.includes('column'))) {
    const retry = await supabase
      .from('workouts')
      .select(WORKOUT_SELECT_BASE)
      .eq('user_id', userId)
      .order('date', { ascending: false })
      .limit(safeLimit)
    data = retry.data
    error = retry.error
  }

  if (error) {
    // Fallback: use created_at ordering
    const { data: d2, error: e2 } = await supabase
      .from('workouts')
      .select(WORKOUT_SELECT_BASE)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(safeLimit)
    if (e2) throw e2
    const result = Array.isArray(d2) ? d2 : []
    setCache(cacheKey, result)
    return result
  }
  const result = Array.isArray(data) ? data : []
  setCache(cacheKey, result)
  return result
}

export async function getWorkoutDatesFromSupabase(userId: string) {
  // Use getWorkoutsFromSupabase to get filtered workouts (no dummy data)
  const workouts = await getWorkoutsFromSupabase(userId)
  return [...new Set(workouts.map((w: any) => w.date))]
}

// ============ PAUSED WORKOUTS ============

/**
 * Save a paused workout (draft) to Supabase
 * This allows users to pause and resume workouts later
 */
export async function savePausedWorkoutToSupabase(workoutState: any, userId: string) {
  if (pausedWorkoutsDisabled) return null
  const pausedWorkout = {
    user_id: userId,
    date: workoutState.date || getTodayEST(),
    // Store as JSONB (migration defines exercises JSONB).
    // NOTE: Older code stored a string; reads are now resilient to both.
    exercises: Array.isArray(workoutState.exercises) ? workoutState.exercises : [],
    workout_time: workoutState.workoutTime || 0,
    rest_time: workoutState.restTime || 0,
    is_resting: workoutState.isResting || false,
    template_id: workoutState.templateId || null,
    paused_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }

  // Check if paused workout already exists for this user
  const { data: existing, error: checkError } = await supabase
    .from('paused_workouts')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle()

  // If table doesn't exist, silently fail (migration not run)
  if (checkError && (checkError.code === 'PGRST205' || checkError.message?.includes('Could not find the table'))) {
    safeLogDebug('paused_workouts table does not exist yet - migration not run')
    disablePausedWorkouts('missing table')
    return null
  }
  if (checkError && checkError.code !== 'PGRST116') {
    throw checkError
  }

  if (existing) {
    // Update existing paused workout
    const { data, error } = await supabase
      .from('paused_workouts')
      .update(pausedWorkout)
      .eq('user_id', userId)
      .select()
      .single()

    if (error) throw error
    return data
  } else {
    // Insert new paused workout
    const { data, error } = await supabase
      .from('paused_workouts')
      .insert(pausedWorkout)
      .select()
      .single()

    if (error) throw error
    return data
  }
}

/**
 * Get paused workout for a user
 */
export async function getPausedWorkoutFromSupabase(userId: string) {
  try {
    if (pausedWorkoutsDisabled) return null
    const { data, error } = await supabase
      .from('paused_workouts')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()

    // maybeSingle returns null when no row matches; avoids 406 spam.
    // If table doesn't exist (migration not run), return null gracefully
    if (error && (error.code === 'PGRST205' || error.message?.includes('Could not find the table'))) {
      safeLogDebug('paused_workouts table does not exist yet - migration not run')
      disablePausedWorkouts('missing table')
      return null
    }
    if (error) throw error

    if (data) {
      let parsedExercises = []
      try {
        if (Array.isArray(data.exercises)) parsedExercises = data.exercises
        else if (data.exercises && typeof data.exercises === 'object') parsedExercises = data.exercises
        else if (typeof data.exercises === 'string') parsedExercises = JSON.parse(data.exercises || '[]')
      } catch {
        parsedExercises = []
      }
      return {
        ...data,
        exercises: Array.isArray(parsedExercises) ? parsedExercises : []
      }
    }
    return null
  } catch (error: any) {
    // If table doesn't exist, return null gracefully
    if (error.code === 'PGRST205' || error.message?.includes('Could not find the table')) {
      safeLogDebug('paused_workouts table does not exist yet - migration not run')
      disablePausedWorkouts('missing table')
      return null
    }
    throw error
  }
}

/**
 * Delete paused workout (called when workout is finished or resumed)
 */
export async function deletePausedWorkoutFromSupabase(userId: string) {
  try {
    if (pausedWorkoutsDisabled) return
    const { data, error } = await supabase
      .from('paused_workouts')
      .delete()
      .eq('user_id', userId)
      .select('id')

    // If table doesn't exist, silently succeed (migration not run)
    if (error && (error.code === 'PGRST205' || error.message?.includes('Could not find the table'))) {
      safeLogDebug('paused_workouts table does not exist yet - migration not run')
      disablePausedWorkouts('missing table')
      return
    }
    if (error) throw error

    // If a row existed but we couldn't delete due to RLS/auth, PostgREST can "succeed" with 0 rows affected.
    // Surface that so the UI can tell the user what’s wrong.
    if (!data || (Array.isArray(data) && data.length === 0)) {
      // It's also valid for there to be nothing to delete; callers that *know* a paused workout exists
      // can treat this as a failure.
      return { deleted: false }
    }
    return { deleted: true }
  } catch (error: any) {
    // If table doesn't exist, silently succeed
    if (error.code === 'PGRST205' || error.message?.includes('Could not find the table')) {
      safeLogDebug('paused_workouts table does not exist yet - migration not run')
      disablePausedWorkouts('missing table')
      return
    }
    throw error
  }
}

export async function getWorkoutsByDateFromSupabase(userId: string, date: string) {
  // Use getWorkoutsFromSupabase to get filtered workouts, then filter by date
  const workouts = await getWorkoutsFromSupabase(userId)
  return workouts.filter((w: any) => w.date === date)
}

export async function updateWorkoutInSupabase(workoutId: string, workout: any, userId: string) {
  // Allow workouts with 0 exercises (user may want to log a workout session without exercises)
  // Only validate that exercises is an array if it exists
  if (workout.exercises !== undefined && workout.exercises !== null && !Array.isArray(workout.exercises)) {
    throw new Error('Workout exercises must be an array')
  }
  
  // If exercises exist, ensure they have valid structure (but allow empty array)
  if (workout.exercises && workout.exercises.length > 0) {
    // Validate exercise structure if exercises are provided
    const hasInvalidExercise = workout.exercises.some((ex: any) => 
      !ex || typeof ex !== 'object' || !ex.name
    )
    if (hasInvalidExercise) {
      throw new Error('All exercises must have a name')
    }
  }
  
  // Verify workout belongs to user (security check)
  const { data: existingWorkout, error: checkError } = await supabase
    .from('workouts')
    .select('user_id')
    .eq('id', workoutId)
    .single()
  
  if (checkError) throw checkError
  if (existingWorkout.user_id !== userId) {
    throw new Error('Unauthorized: Workout does not belong to user')
  }
  
  // Update workout — build patch dynamically, stripping migration columns on failure
  const workoutPatch: Record<string, any> = {
    date: workout.date,
    duration: workout.duration,
    template_name: workout.templateName || null,
    perceived_effort: workout.perceivedEffort || null,
    mood_after: workout.moodAfter || null,
    notes: workout.notes || null,
    day_of_week: workout.dayOfWeek ?? null,
    session_rpe: workout.perceivedEffort || null,
    training_density: workout.trainingDensity != null ? Number(workout.trainingDensity) : null,
    workout_calories_burned: workout.workoutCaloriesBurned != null ? Number(workout.workoutCaloriesBurned) : null,
    workout_steps: workout.workoutSteps != null ? Number(workout.workoutSteps) : null,
    generated_workout_id: isUuidV4(workout.generatedWorkoutId) ? workout.generatedWorkoutId : null,
    updated_at: new Date().toISOString()
  }

  let { error: workoutError } = await supabase
    .from('workouts')
    .update(workoutPatch)
    .eq('id', workoutId)
    .eq('user_id', userId)

  if (workoutError?.code === 'PGRST204' || workoutError?.code === '42703') {
    const migrationCols = new Set(['workout_calories_burned', 'workout_steps', 'training_density', 'generated_workout_id'])
    for (const col of migrationCols) delete workoutPatch[col]
    const retry = await supabase.from('workouts').update(workoutPatch).eq('id', workoutId).eq('user_id', userId)
    workoutError = retry.error
  }

  if (workoutError) throw workoutError

  // Delete existing exercises and sets
  const { data: exercises, error: exFetchError } = await supabase
    .from('workout_exercises')
    .select('id')
    .eq('workout_id', workoutId)

  if (exFetchError) throw exFetchError

  if (exercises) {
    for (const ex of exercises) {
      const { error: delSetsErr } = await supabase.from('workout_sets').delete().eq('workout_exercise_id', ex.id)
      if (delSetsErr) throw delSetsErr
    }
    const { error: delExErr } = await supabase.from('workout_exercises').delete().eq('workout_id', workoutId)
    if (delExErr) throw delExErr
  }

  // Insert new exercises (only those with valid sets data)
  const exercisesToUpdate = Array.isArray(workout.exercises) ? workout.exercises : []
  let exerciseOrder = 0
  for (let i = 0; i < exercisesToUpdate.length; i++) {
    const ex = exercisesToUpdate[i]
    
    const exSets2 = Array.isArray(ex.sets) ? ex.sets : []
    if (exSets2.length === 0 || !exSets2.some((s: any) =>
      s.weight || s.reps || s.time || s.time_seconds || s.speed || s.incline
    )) {
      continue
    }
    
    // Try to find exercise in exercise_library first
    let exerciseLibraryId = null
    if (ex.name) {
      const { data: libraryExercise } = await supabase
        .from('exercise_library')
        .select('id')
        .eq('name', ex.name)
        .eq('is_custom', false)
        .maybeSingle()
      
      if (libraryExercise) {
        exerciseLibraryId = libraryExercise.id
      } else if (ex.isCustom) {
        const { data: customExercise, error: customError } = await supabase
          .from('exercise_library')
          .insert({
            name: ex.name,
            category: ex.category || 'strength',
            body_part: ex.bodyPart || 'Other',
            sub_body_parts: ex.subBodyParts || [],
            equipment: ex.equipment ? [ex.equipment] : [],
            is_custom: true,
            created_by_user_id: userId
          })
          .select()
          .single()
        
        if (!customError && customExercise) {
          exerciseLibraryId = customExercise.id
        }
      }
    }
    
    const exerciseType = ex.exerciseType || (ex.distance || ex.time ? 'cardio' : 'weightlifting')
    
    const { data: exerciseData, error: exerciseError } = await supabase
      .from('workout_exercises')
      .insert({
        workout_id: workoutId,
        exercise_name: ex.name,
        category: ex.category,
        body_part: ex.bodyPart,
        equipment: ex.equipment,
        exercise_order: exerciseOrder++,
        exercise_type: exerciseType,
        exercise_library_id: exerciseLibraryId,
        distance: ex.distance || null,
        distance_unit: ex.distanceUnit || 'km',
        stacked: ex.stacked || false,
        stack_group: ex.stackGroup || null
      })
      .select()
      .single()

    if (exerciseError) throw exerciseError

    const validSets2 = exSets2.filter((s: any) => s.weight || s.reps || s.time || s.time_seconds || s.speed || s.incline)
    if (validSets2.length > 0) {
      const setsToInsert = validSets2.map((set: any, idx: number) => {
        const loadNorm = normalizeSetLoadForStorage(ex.name, set)
        return {
          workout_exercise_id: exerciseData.id,
          set_number: idx + 1,
          weight: loadNorm.normalizedWeight,
          is_bodyweight: loadNorm.isBodyweight,
          weight_label: loadNorm.isBodyweight ? 'BW' : null,
          reps: set.reps ? Number(set.reps) : null,
          time: set.time != null ? String(Math.floor(Number(set.time))) : (set.time_seconds != null ? String(Math.floor(Number(set.time_seconds))) : null),
          speed: set.speed ? Number(set.speed) : null,
          incline: set.incline ? Number(set.incline) : null,
          is_warmup: set._is_warmup === true || set.is_warmup === true,
          is_unilateral: loadNorm.isUnilateral,
          load_interpretation: loadNorm.loadInterpretation,
          reps_interpretation: loadNorm.repsInterpretation,
        }
      })

      const tryInsert = async (rows: any[]) => supabase.from('workout_sets').insert(rows)
      let { error: setsError } = await tryInsert(setsToInsert)
      if (setsError && (setsError.code === '42703' || `${setsError.message || ''}`.toLowerCase().includes('column'))) {
        const stripped = setsToInsert.map(({ is_bodyweight, weight_label, is_unilateral, load_interpretation, reps_interpretation, ...rest }: any) => rest)
        const retry = await tryInsert(stripped)
        setsError = retry.error
      }
      if (setsError) throw setsError
    }
  }
}

export async function deleteWorkoutFromSupabase(workoutId: string, userId: string | null = null) {
  // Single DELETE — FK CASCADE on workout_exercises and workout_sets
  // handles child-row cleanup automatically.
  // The CRUD proxy auto-scopes by user_id, so we only need the id filter.
  let deleteQuery = supabase.from('workouts').delete().eq('id', workoutId)
  if (userId) {
    deleteQuery = deleteQuery.eq('user_id', userId)
  }
  const { error } = await deleteQuery
  if (error) throw error
  invalidateDbCache()
}

export async function deleteAllWorkoutsFromSupabase(userId: string) {
  // Get ALL workouts for user directly from database (no filtering)
  const { data: workouts, error: fetchError } = await supabase
    .from('workouts')
    .select('id')
    .eq('user_id', userId)

  if (fetchError) throw fetchError

  if (!workouts || workouts.length === 0) {
    return { deleted: 0 }
  }

  // Delete all workouts (cascade should handle related data, but we'll do it explicitly)
  let deletedCount = 0
  for (const workout of workouts) {
    try {
      await deleteWorkoutFromSupabase(workout.id, userId)
      deletedCount++
    } catch (error) {
      // Log error but continue deleting others
      logError(`Error deleting workout ${workout.id}`, error)
    }
  }

  return { deleted: deletedCount }
}

// Clean up duplicate workouts and invalid data
export async function cleanupDuplicateWorkouts(userId: string) {
  // SAFETY: this routine can delete user history. It is disabled by default.
  // Enable explicitly only for one-off admin recovery work:
  // set VITE_ENABLE_WORKOUT_CLEANUP=true, and consider adding a dry-run UI first.
  if (import.meta.env.VITE_ENABLE_WORKOUT_CLEANUP !== 'true') {
    return { deleted: 0, invalidDeleted: 0, skipped: true }
  }

  // Get ALL workouts directly from database (no filtering) to see duplicates and dummy data
  const { data: allWorkouts, error: fetchError } = await supabase
    .from('workouts')
    .select(`
      id,
      date,
      created_at,
      workout_exercises (
        id,
        workout_sets (
          id,
          weight,
          reps,
          time
        )
      )
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (fetchError) throw fetchError

  if (!allWorkouts || allWorkouts.length === 0) {
    return { deleted: 0, invalidDeleted: 0 }
  }

  let deletedCount = 0
  let invalidDeleted = 0
  
  // First, identify and delete invalid workouts (dummy data - no valid exercises/sets)
  for (const workout of allWorkouts) {
    const hasValidExercise = workout.workout_exercises?.some((ex: any) => {
      const ws = Array.isArray(ex.workout_sets) ? ex.workout_sets : []
      return ws.length > 0 && ws.some((s: any) => s.weight || s.reps || s.time)
    })
    
    if (!hasValidExercise) {
      try {
        await deleteWorkoutFromSupabase(workout.id, userId)
        invalidDeleted++
        deletedCount++
      } catch (error) {
        logError(`Error deleting invalid workout ${workout.id}`, error)
      }
    }
  }
  
  // Now handle duplicates - group remaining valid workouts by date
  const validWorkouts = allWorkouts.filter((w: any) => {
    const hasValidExercise = w.workout_exercises?.some((ex: any) => {
      const ws2 = Array.isArray(ex.workout_sets) ? ex.workout_sets : []
      return ws2.length > 0 && ws2.some((s: any) => s.weight || s.reps || s.time)
    })
    return hasValidExercise
  })
  
  const dateGroups: Record<string, any[]> = {}
  validWorkouts.forEach((w: any) => {
    if (!dateGroups[w.date]) {
      dateGroups[w.date] = []
    }
    dateGroups[w.date].push(w)
  })
  
  // For each date with multiple workouts, keep only the most recent
  for (const [date, dateWorkouts] of Object.entries(dateGroups)) {
    const list = Array.isArray(dateWorkouts) ? dateWorkouts : []
    if (list.length > 1) {
      // Sort by created_at (most recent first)
      list.sort((a: any, b: any) => {
        const aTime = a.created_at ? new Date(a.created_at).getTime() : 0
        const bTime = b.created_at ? new Date(b.created_at).getTime() : 0
        return bTime - aTime
      })
      
      // Keep the first (most recent), delete the rest
      const duplicates = list.slice(1)
      for (const dup of duplicates) {
        try {
          await deleteWorkoutFromSupabase(dup.id, userId)
          deletedCount++
        } catch (error) {
          logError(`Error deleting duplicate workout ${dup.id}`, error)
        }
      }
    }
  }
  
  return { deleted: deletedCount, invalidDeleted }
}

// ============ DAILY METRICS ============
// IMPORTANT: Health metrics are ONLY created through explicit user action (logging metrics).
// This function is ONLY called when the user manually logs health metrics or when Fitbit syncs real data.
// NEVER call this function automatically or with dummy/test data.

export async function saveMetricsToSupabase(userId: string, date: string, metrics: any, options: { allowOutbox?: boolean } = {}) {
  const allowOutbox = options?.allowOutbox !== false
  safeLogDebug('saveMetricsToSupabase called with:', { userId, date, metrics })
  
  // Data pipeline: Validate -> Clean -> Save -> Enrich
  
  // Step 1: Validate data
  try {
    const validationModule = await import('./dataValidation')
    const { validateHealthMetrics } = validationModule || {}
    if (validateHealthMetrics && typeof validateHealthMetrics === 'function') {
      const validation = validateHealthMetrics({ ...metrics, date })
      if (!validation.valid) {
        throw new Error(`Validation failed: ${validation.errors.join(', ')}`)
      }
    }
  } catch (validationError: any) {
    if (validationError?.message?.startsWith('Validation failed:')) {
      throw validationError
    }
    logError('Error importing validation module (continuing without validation)', validationError)
  }
  
  // Step 2: Clean and normalize data
  let cleanedMetrics = metrics
  try {
    const cleaningModule = await import('./dataCleaning')
    const { cleanHealthMetrics } = cleaningModule || ({} as any)
    if (cleanHealthMetrics && typeof cleanHealthMetrics === 'function') {
      cleanedMetrics = cleanHealthMetrics(metrics)
    } else {
      logError('cleanHealthMetrics is not a function', { cleaningModule })
      // Use original metrics if cleaning function is not available
    }
  } catch (cleaningError) {
    logError('Error importing or calling cleanHealthMetrics', cleaningError)
    // Use original metrics if import fails
  }
  
  // Validate that we have at least one metric value (after cleaning)
  const hasData = Object.values(cleanedMetrics).some(val => val !== null && val !== undefined && val !== '')
  if (!hasData) {
    throw new Error('Cannot save metrics with no data')
  }
  
  // Use cleaned metrics from here on
  const metricsToSave = cleanedMetrics
  
  // Map to health_metrics table structure
  const healthMetricsData: any = {
    user_id: userId,
    date: date,
    sleep_score: toNumber(metricsToSave.sleepScore),
    sleep_duration: toNumber(metricsToSave.sleepTime), // Map sleepTime to sleep_duration
    hrv: toNumber(metricsToSave.hrv),
    steps: toInteger(metricsToSave.steps), // INTEGER column - must be whole number
    weight: toNumber(metricsToSave.weight), // NUMERIC column - can be decimal
    calories_burned: toNumber(metricsToSave.caloriesBurned),
    resting_heart_rate: toNumber(metricsToSave.restingHeartRate),
    body_temp: toNumber(metricsToSave.bodyTemp),
    body_fat_percentage: toNumber(metricsToSave.bodyFatPercentage),
    breathing_rate: toNumber(metricsToSave.breathingRate),
    spo2: toNumber(metricsToSave.spo2),
    strain: toNumber(metricsToSave.strain),
    source_provider: metricsToSave.sourceProvider || 'manual',
    updated_at: new Date().toISOString()
  }
  
  // Remove null/undefined values to avoid overwriting existing data
  Object.keys(healthMetricsData).forEach(key => {
    if (healthMetricsData[key] === null || healthMetricsData[key] === undefined) {
      delete healthMetricsData[key]
    }
  })

  // Merge priority: don't let manual nulls overwrite Fitbit-sourced values.
  // Fetch existing row and prefer non-null values from either source.
  const fitbitFields = ['sleep_score', 'sleep_duration', 'hrv', 'resting_heart_rate', 'steps', 'calories_burned', 'max_heart_rate']
  try {
    const { data: existing } = await supabase
      .from('health_metrics')
      .select('*')
      .eq('user_id', userId)
      .eq('date', date)
      .maybeSingle()

    if (existing && existing.source_provider === 'fitbit') {
      for (const field of fitbitFields) {
        if (!(field in healthMetricsData) && existing[field] != null) {
          healthMetricsData[field] = existing[field]
        }
      }
    }
  } catch {
    // Non-critical; proceed with upsert without merge
  }
  
  safeLogDebug('saveMetricsToSupabase: Prepared data for health_metrics', healthMetricsData)
  
  try {
    let { data, error } = await supabase
      .from('health_metrics')
      .upsert(healthMetricsData, { onConflict: 'user_id,date' })
      .select()

    if (error?.code === 'PGRST204' || (error && error.message?.includes('column'))) {
      const migrationCols = new Set([
        'distance', 'floors', 'active_minutes_fairly', 'active_minutes_very',
        'active_minutes_lightly', 'hr_zones_minutes', 'max_heart_rate', 'body_temp',
        'sedentary_minutes', 'deep_sleep', 'rem_sleep', 'light_sleep', 'average_heart_rate'
      ])
      const cleaned = { ...healthMetricsData } as Record<string, unknown>
      for (const col of migrationCols) delete cleaned[col]
      const retry = await supabase
        .from('health_metrics')
        .upsert(cleaned, { onConflict: 'user_id,date' })
        .select()
      data = retry.data
      error = retry.error
    }

    if (error) {
      logError('saveMetricsToSupabase: Error from Supabase', error)
      throw error
    }
    
    safeLogDebug('saveMetricsToSupabase: Success', data)
    invalidateDbCache()
    return data
  } catch (err) {
    logError('saveMetricsToSupabase: Error', err)
    if (allowOutbox && userId) {
      enqueueOutboxItem({ userId, kind: 'metrics', payload: { date, metrics } })
      return { queued: true }
    }
    throw err
  }
}

export async function getMetricsFromSupabase(userId: string, startDate: string, endDate: string) {
  const { data, error } = await supabase
    .from('health_metrics')
    .select('*')
    .eq('user_id', userId)
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: true })

  if (error) throw error
  return data
}

export async function getAllMetricsFromSupabase(userId: string) {
  const { data, error } = await supabase
    .from('health_metrics')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: true })

  if (error) throw error
  return data
}

// ============ SCHEDULED WORKOUTS ============

export async function scheduleWorkoutSupabase(userId: string, date: string, templateId: string) {
  // Allow multiple scheduled workouts per date. Avoid inserting exact duplicates for the same template/date.
  const { data: existing, error: existingError } = await supabase
    .from('scheduled_workouts')
    .select('*')
    .eq('user_id', userId)
    .eq('date', date)
    .eq('template_id', templateId)
    .limit(1)
    .maybeSingle()
  if (existingError && existingError.code !== 'PGRST116') throw existingError
  if (existing) return existing

  const { data, error } = await supabase
    .from('scheduled_workouts')
    .insert({
      user_id: userId,
      date,
      template_id: templateId
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function getScheduledWorkoutsFromSupabase(userId: string) {
  const { data, error } = await supabase
    .from('scheduled_workouts')
    .select('*')
    .eq('user_id', userId)
    .gte('date', getTodayEST())
    .order('date', { ascending: true })

  if (error) throw error
  return data
}

export async function getScheduledWorkoutByDateFromSupabase(userId: string, date: string) {
  // Back-compat: return the most recently created scheduled workout for a date (if multiple exist).
  const { data, error } = await supabase
    .from('scheduled_workouts')
    .select('*')
    .eq('user_id', userId)
    .eq('date', date)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error && error.code !== 'PGRST116') throw error
  return data
}

export async function getScheduledWorkoutsByDateFromSupabase(userId: string, date: string) {
  const { data, error } = await supabase
    .from('scheduled_workouts')
    .select('*')
    .eq('user_id', userId)
    .eq('date', date)
    .order('created_at', { ascending: true })
  if (error) throw error
  return Array.isArray(data) ? data : []
}

export async function deleteScheduledWorkoutByDateFromSupabase(userId: string, date: string) {
  const { data, error } = await supabase
    .from('scheduled_workouts')
    .delete()
    .eq('user_id', userId)
    .eq('date', date)
    .select()
  if (error) throw error
  return data
}

export async function deleteScheduledWorkoutByIdFromSupabase(userId: string, id: string) {
  const { data, error } = await supabase
    .from('scheduled_workouts')
    .delete()
    .eq('user_id', userId)
    .eq('id', id)
    .select()
  if (error) throw error
  return Array.isArray(data) ? data[0] : null
}

export async function deleteScheduledWorkoutsByTemplatePrefixFromSupabase(userId: string, templateIdPrefix: string) {
  const prefix = String(templateIdPrefix || '')
  if (!prefix) return { deleted: 0 }
  const { data, error } = await supabase
    .from('scheduled_workouts')
    .delete()
    .eq('user_id', userId)
    .like('template_id', `${prefix}%`)
    .select('id')
  if (error) throw error
  return { deleted: Array.isArray(data) ? data.length : 0 }
}

// ============ ANALYTICS ============

export async function getBodyPartStats(userId: string) {
  // Get all workouts with exercises (already filtered by getWorkoutsFromSupabase)
  const workouts = await getWorkoutsFromSupabase(userId)
  const bodyPartCounts: Record<string, number> = {}
  
  safeLogDebug('getBodyPartStats - workouts', workouts.length)
  
  workouts.forEach((w: any) => {
    w.workout_exercises?.forEach((ex: any) => {
      const setsArr = Array.isArray(ex.workout_sets) ? ex.workout_sets : []
      const hasValidSets = setsArr.length > 0 && 
        setsArr.some((s: any) => s.weight || s.reps || s.time || s.time_seconds || s.speed || s.incline)
      
      if (!hasValidSets) return
      
      const bp = ex.body_part || 'Other'
      safeLogDebug('Exercise body part', { exercise: ex.exercise_name, bodyPart: bp })
      bodyPartCounts[bp] = (bodyPartCounts[bp] || 0) + 1
    })
  })
  
  safeLogDebug('Body part counts', bodyPartCounts)
  return bodyPartCounts
}

export async function calculateStreakFromSupabase(userId: string) {
  const dates = await getWorkoutDatesFromSupabase(userId)
  if (dates.length === 0) return 0

  const sortedDates = (dates as any[]).map((d) => String(d)).sort((a, b) => new Date(b).getTime() - new Date(a).getTime())
  const today = getTodayEST()
  const yesterday = getYesterdayEST()

  if (sortedDates[0] !== today && sortedDates[0] !== yesterday) {
    return 0
  }

  let streak = 1
  for (let i = 1; i < sortedDates.length; i++) {
    const current = new Date(sortedDates[i - 1])
    const prev = new Date(sortedDates[i])
    const diffDays = (current.getTime() - prev.getTime()) / 86400000

    if (diffDays === 1) {
      streak++
    } else {
      break
    }
  }

  return streak
}

export async function getWorkoutFrequency(userId: string, days: number = 30) {
  // Use getWorkoutsFromSupabase to get filtered workouts (no dummy data)
  const workouts = await getWorkoutsFromSupabase(userId)
  const startDate = getLocalDate(new Date(Date.now() - days * 86400000))
  
  // Group by date (only valid workouts)
  const frequency: Record<string, number> = {}
  workouts.forEach((w: any) => {
    if (w.date >= startDate) {
      frequency[w.date] = (frequency[w.date] || 0) + 1
    }
  })
  
  return frequency
}

export async function getExerciseStats(userId: string) {
  const workouts = await getWorkoutsFromSupabase(userId)
  const exerciseCounts: Record<string, number> = {}
  
  workouts.forEach((w: any) => {
    w.workout_exercises?.forEach((ex: any) => {
      const setsArr = Array.isArray(ex.workout_sets) ? ex.workout_sets : []
      const hasValidSets = setsArr.length > 0 && 
        setsArr.some((s: any) => s.weight || s.reps || s.time || s.time_seconds || s.speed || s.incline)
      
      if (hasValidSets && ex.exercise_name) {
        exerciseCounts[ex.exercise_name] = (exerciseCounts[ex.exercise_name] || 0) + 1
      }
    })
  })
  
  // Sort by count
  const sorted = Object.entries(exerciseCounts)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 10)
  
  return sorted as Array<[string, number]>
}

// ============ USER PREFERENCES ============

export async function getUserPreferences(userId: string) {
  const { data, error } = await supabase
    .from('user_preferences')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (error && error.code !== 'PGRST116') throw error
  return data
}

export async function saveUserPreferences(userId: string, prefs: any) {
  const { getIdToken } = await import('./cognitoAuth')
  const { apiUrl } = await import('./urlConfig')

  const tryFastPath = async (): Promise<any> => {
    const token = await getIdToken().catch(() => '')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8_000)
    try {
      const resp = await fetch(apiUrl('/api/preferences'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(prefs),
        signal: controller.signal,
      })
      clearTimeout(timer)
      if (resp.ok) {
        const body = await resp.json()
        if (!body.error) {
          invalidateDbCache()
          return body.data
        }
        throw new Error(body.error?.message || 'Save returned error')
      }
      const text = await resp.text().catch(() => '')
      throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`)
    } catch (e: unknown) {
      clearTimeout(timer)
      throw e
    }
  }

  // Attempt 1
  try {
    return await tryFastPath()
  } catch (e1: unknown) {
    const msg = e1 instanceof Error ? e1.message : String(e1)
    logWarn(`Preferences save attempt 1 failed: ${msg}`)
  }

  // Pre-warm and retry once
  await fetch(apiUrl('/api/ping')).catch(() => {})
  await new Promise(r => setTimeout(r, 300))
  try {
    return await tryFastPath()
  } catch (e2: unknown) {
    const msg = e2 instanceof Error ? e2.message : String(e2)
    logWarn(`Preferences save attempt 2 failed: ${msg}, falling back to db proxy`)
  }

  // Fallback: generic db proxy with column-stripping retry
  const upsertData: any = {
    user_id: userId,
    updated_at: new Date().toISOString()
  }

  const directFields = [
    'training_goal', 'session_duration_minutes', 'equipment_access',
    'sport_focus', 'sport_season',
    'available_days_per_week', 'job_activity_level', 'injuries',
    'exercises_to_avoid', 'performance_goals', 'preferred_split',
    'weekly_split_schedule',
    'date_of_birth', 'gender', 'height_feet', 'height_inches',
    'body_weight_lbs', 'experience_level',
    'cardio_preference', 'cardio_frequency_per_week', 'cardio_duration_minutes',
    'preferred_exercises',
    'recovery_speed', 'weight_goal_lbs', 'weight_goal_date',
    'primary_goal', 'secondary_goal', 'priority_muscles',
    'weekday_deadlines', 'gym_profiles', 'active_gym_profile', 'age',
    'rest_days', 'hotel_mode',
    'monthly_focus_state',
  ]
  for (const key of directFields) {
    if (prefs[key] !== undefined) {
      upsertData[key] = prefs[key] ?? null
    }
  }

  if (prefs.planName !== undefined) upsertData.plan_name = prefs.planName || null
  if (prefs.fitnessGoal !== undefined) upsertData.fitness_goal = prefs.fitnessGoal || null
  if (prefs.experienceLevel !== undefined) upsertData.experience_level = prefs.experienceLevel || null
  if (prefs.availableDays !== undefined) upsertData.available_days = prefs.availableDays || null
  if (prefs.sessionDuration !== undefined) upsertData.session_duration = prefs.sessionDuration || null
  if (prefs.sessionDuration !== undefined && prefs.session_duration_minutes === undefined) {
    const v = Number(prefs.sessionDuration)
    upsertData.session_duration_minutes = Number.isFinite(v) && v > 0 ? v : null
  }
  if (prefs.dateOfBirth !== undefined) upsertData.date_of_birth = prefs.dateOfBirth || null
  if (prefs.gender !== undefined) upsertData.gender = prefs.gender || null
  if (prefs.heightInches !== undefined) upsertData.height_inches = prefs.heightInches || null
  if (prefs.heightFeet !== undefined) upsertData.height_feet = prefs.heightFeet || null
  if (prefs.equipmentAvailable !== undefined) upsertData.equipment_available = prefs.equipmentAvailable || null
  if (prefs.trainingSplit !== undefined) upsertData.training_split = prefs.trainingSplit || null
  if (prefs.progressionModel !== undefined) upsertData.progression_model = prefs.progressionModel || null
  if (prefs.weeklySetsTargets !== undefined) {
    upsertData.weekly_sets_targets = (prefs.weeklySetsTargets && typeof prefs.weeklySetsTargets === 'object')
      ? prefs.weeklySetsTargets : {}
  }
  if (prefs.username !== undefined) upsertData.username = prefs.username || null
  if (prefs.profilePicture !== undefined) upsertData.profile_picture = prefs.profilePicture || null
  if (prefs.onboarding_completed !== undefined) upsertData.onboarding_completed = prefs.onboarding_completed || false
  if (prefs.defaultVisibility !== undefined) upsertData.default_visibility = prefs.defaultVisibility || 'public'

  const missingCols: string[] = []
  let attempts = 0
  const maxAttempts = 5

  while (attempts < maxAttempts) {
    attempts++
    const { data, error } = await supabase
      .from('user_preferences')
      .upsert(upsertData, { onConflict: 'user_id' })
      .select()

    if (!error) {
      invalidateDbCache()
      return data
    }

    if (error.code === '42703') {
      const match = error.message?.match(/column "([^"]+)"/)
      const badCol = match?.[1]
      if (badCol && badCol in upsertData) {
        missingCols.push(badCol)
        delete upsertData[badCol]
        logWarn(`Column "${badCol}" not in DB — stripped and retrying (attempt ${attempts})`)
        continue
      }
      const essentialCols = new Set(['user_id', 'updated_at'])
      for (const key of Object.keys(upsertData)) {
        if (!essentialCols.has(key)) delete upsertData[key]
      }
      logWarn('Could not parse missing column — stripped all optional fields')
      continue
    }

    throw error
  }

  if (missingCols.length > 0) {
    logWarn(`Profile saved with ${missingCols.length} columns stripped: ${missingCols.join(', ')}. Run the latest migration to add them.`)
  }

  const { data: finalData, error: finalError } = await supabase
    .from('user_preferences')
    .upsert(upsertData, { onConflict: 'user_id' })
    .select()

  if (finalError) throw finalError
  invalidateDbCache()
  return finalData
}

export async function deleteUserPreferences(userId: string) {
  if (!userId) return { deleted: false }
  const { data, error } = await supabase
    .from('user_preferences')
    .delete()
    .eq('user_id', userId)
    .select()
  if (error) throw error
  return { deleted: true, data }
}

// ============ TEMPLATE SYNC ============
// Templates are synced to Supabase via user_preferences.workout_templates (JSONB)
// so they persist across devices. IndexedDB serves as the fast local cache.

export async function getTemplatesFromSupabase(userId: string): Promise<any[]> {
  if (!userId) return []
  try {
    const prefs = await getUserPreferences(userId)
    const raw = (prefs as any)?.workout_templates
    if (Array.isArray(raw)) return raw
    if (typeof raw === 'string') {
      try { return JSON.parse(raw) } catch { return [] }
    }
    return []
  } catch {
    return []
  }
}

export async function saveTemplatesToSupabase(userId: string, templates: any[]): Promise<void> {
  if (!userId) return
  try {
    const { error } = await supabase
      .from('user_preferences')
      .upsert({
        user_id: userId,
        workout_templates: templates,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' })

    if (error) {
      // If column doesn't exist yet, try adding it via the JSON approach
      if (error.message?.includes('workout_templates')) {
        logWarn('workout_templates column not found in user_preferences. Templates will only be stored locally.')
        return
      }
      throw error
    }
  } catch (e) {
    logWarn('Failed to sync templates to Supabase:', e)
  }
}

// ============ DETAILED BODY PART STATS ============

export async function getDetailedBodyPartStats(userId: string) {
  const workouts = await getWorkoutsFromSupabase(userId)
  const stats: Record<string, any> = {}
  
  const bodyParts = ['upper_chest', 'mid_chest', 'lower_chest', 'back_lats', 'back_upper', 'upper_traps', 'mid_traps', 'lower_traps', 'shoulders', 'biceps', 'triceps', 'core', 'legs', 'cardio', 'recovery', 'arms', 'full_body', 'rotator_cuff', 'other']
  
  bodyParts.forEach(bp => {
    stats[bp] = {
      lastTrained: null,
      topExercise: null,
      avgPerWeek: 0,
      exerciseCounts: {},
      dates: []
    }
  })
  
  workouts.forEach((w: any) => {
    w.workout_exercises?.forEach((ex: any) => {
      const setsArr = Array.isArray(ex.workout_sets) ? ex.workout_sets : []
      const hasValidSets = setsArr.length > 0 && 
        setsArr.some((s: any) => s.weight || s.reps || s.time || s.time_seconds || s.speed || s.incline)
      
      if (!hasValidSets) return
      
      let bp = (ex.body_part || 'other').toLowerCase()
      if (!stats[bp]) bp = 'other'
      
      // Track dates
      if (!stats[bp].dates.includes(w.date)) {
        stats[bp].dates.push(w.date)
      }
      
      // Track exercise counts (only valid exercises)
      if (ex.exercise_name) {
        stats[bp].exerciseCounts[ex.exercise_name] = (stats[bp].exerciseCounts[ex.exercise_name] || 0) + 1
      }
    })
  })
  
  // Calculate derived stats
  bodyParts.forEach((bp: string) => {
    const s = stats[bp]
    
    // Last trained (most recent date)
    if (s.dates.length > 0) {
      s.lastTrained = s.dates.sort((a: any, b: any) => new Date(b).getTime() - new Date(a).getTime())[0]
    }
    
    // Top exercise
    const exercises = Object.entries(s.exerciseCounts as Record<string, number>)
    if (exercises.length > 0) {
      exercises.sort((a, b) => Number(b[1]) - Number(a[1]))
      s.topExercise = exercises[0][0]
    }
    
    // Average per week (based on date range of all workouts)
    if (workouts.length > 0 && s.dates.length > 0) {
      const allDates = workouts.map((w: any) => w.date).sort()
      const firstDate = new Date(allDates[0])
      const lastDate = new Date(allDates[allDates.length - 1])
      const weeks = Math.max(1, (lastDate.getTime() - firstDate.getTime()) / (7 * 86400000))
      s.avgPerWeek = s.dates.length / weeks
    }
    
    // Clean up
    delete s.exerciseCounts
    delete s.dates
  })
  
  return stats
}


// ============ ACTIVE WORKOUT SESSIONS ============

/**
 * Save or update active workout session (timer state)
 */
export async function saveActiveWorkoutSession(userId: string, sessionData: any) {
  try {
    const sessionPayload: any = {
      user_id: userId,
      session_data: {
        workout_start_time: sessionData.workoutStartTime,
        paused_time_ms: sessionData.pausedTimeMs || 0,
        rest_start_time: sessionData.restStartTime || null,
        rest_duration_seconds: sessionData.restDurationSeconds || null,
        is_resting: sessionData.isResting || false,
        workout_time: sessionData.workoutTime || 0,
        rest_time: sessionData.restTime || 0,
        exercises: sessionData.exercises || [],
      },
      updated_at: new Date().toISOString()
    }

    const { data, error } = await supabase
      .from('active_workout_sessions')
      .upsert(sessionPayload, {
        onConflict: 'user_id'
      })
      .select()
      .single()

    if (error) {
      // Check if error is due to missing table or column (expected errors)
      const isExpectedError = error.code === 'PGRST205' || 
                              error.code === '42P01' || // table doesn't exist
                              error.code === '42703' || // column doesn't exist
                              error.message?.includes('Could not find the table') ||
                              error.message?.includes('column') ||
                              error.message?.includes('does not exist')
      
      if (isExpectedError) {
        // Silently fail for expected errors - table/column may not exist yet
        safeLogDebug('Active workout sessions table/column not available, using localStorage fallback')
        return null
      }
      
      // Log unexpected errors
      logError('Error saving active workout session', error)
      throw error
    }
    return data
  } catch (error: any) {
    // Catch any unexpected errors and fail gracefully
    const isExpectedError = error.code === 'PGRST205' || 
                            error.code === '42P01' ||
                            error.code === '42703' ||
                            error.message?.includes('Could not find the table') ||
                            error.message?.includes('column') ||
                            error.message?.includes('does not exist')
    
    if (isExpectedError) {
      safeLogDebug('Active workout sessions not available, using localStorage fallback')
      return null
    }
    
    // Re-throw unexpected errors
    throw error
  }
}

/**
 * Get active workout session for user
 */
export async function getActiveWorkoutSession(userId: string) {
  try {
    const { data, error } = await supabase
      .from('active_workout_sessions')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()

    if (error) {
      const isExpectedError = error.code === 'PGRST205' || 
                              error.code === '42P01' ||
                              error.message?.includes('Could not find the table')
      
      if (isExpectedError) {
        safeLogDebug('Active workout sessions table not available')
        return null
      }
      
      logError('Error getting active workout session', error)
      return null
    }
    if (!data) return null
    const sd = data.session_data || {}
    return {
      ...data,
      workout_start_time: sd.workout_start_time || data.created_at,
      paused_time_ms: sd.paused_time_ms || 0,
      rest_start_time: sd.rest_start_time || null,
      rest_duration_seconds: sd.rest_duration_seconds || null,
      is_resting: sd.is_resting || false,
      workout_time: sd.workout_time || 0,
      rest_time: sd.rest_time || 0,
      exercises: sd.exercises || [],
    }
  } catch (error: any) {
    // Catch any unexpected errors and fail gracefully
    const isExpectedError = error.code === 'PGRST205' || 
                            error.code === '42P01' ||
                            error.message?.includes('Could not find the table')
    
    if (isExpectedError) {
      safeLogDebug('Active workout sessions table not available')
      return null
    }
    
    logError('Error getting active workout session', error)
    return null
  }
}

/**
 * Delete active workout session (when workout is finished or cancelled)
 */
export async function deleteActiveWorkoutSession(userId: string) {
  try {
    const { error } = await supabase
      .from('active_workout_sessions')
      .delete()
      .eq('user_id', userId)

    if (error) {
      // Check if error is due to missing table (expected error)
      const isExpectedError = error.code === 'PGRST205' || 
                              error.code === '42P01' ||
                              error.message?.includes('Could not find the table')
      
      if (isExpectedError) {
        // Silently fail for expected errors
        safeLogDebug('Active workout sessions table not available')
        return
      }
      
      // Log unexpected errors
      logError('Error deleting active workout session', error)
      throw error
    }
  } catch (error: any) {
    // Catch any unexpected errors and fail gracefully
    const isExpectedError = error.code === 'PGRST205' || 
                            error.code === '42P01' ||
                            error.message?.includes('Could not find the table')
    
    if (isExpectedError) {
      safeLogDebug('Active workout sessions table not available')
      return
    }
    
    // Re-throw unexpected errors
    throw error
  }
}

/**
 * Delete a feed item
 */

// ============ ADAPTIVE WEEKLY PLAN ============

async function persistWeeklyPlanProvenance(userId: string, weeklyPlanId: string | null, weeklyPlan: any): Promise<void> {
  try {
    const rows = (weeklyPlan?.days || [])
      .filter((d: any) => d?.plannedWorkout)
      .flatMap((d: any) => {
        const pw = d.plannedWorkout
        const fromWorkout = Array.isArray(pw?.decisionProvenance) ? pw.decisionProvenance : []
        if (fromWorkout.length === 0) {
          return [{
            user_id: userId,
            event_date: d.planDate,
            source_type: 'policy',
            decision_stage: 'weekly_plan',
            decision_key: 'scheduled_workout',
            decision_value: {
              date: d.planDate,
              focus: d.focus || null,
              estimatedMinutes: d.estimatedMinutes ?? pw.estimatedDurationMinutes ?? null,
            },
            confidence: 0.7,
            generated_workout_id: pw.id || null,
            weekly_plan_id: weeklyPlanId,
            model_version: 'workout_engine',
            policy_version: pw?.policyState?.policyVersion || 'policy_v4_adaptive_learning',
          }]
        }
        return fromWorkout.map((p: any) => ({
          user_id: userId,
          event_date: d.planDate,
          source_type: p.sourceType,
          decision_stage: p.stage,
          decision_key: p.key,
          decision_value: p.value ?? {},
          confidence: p.confidence ?? 0.5,
          generated_workout_id: pw.id || null,
          weekly_plan_id: weeklyPlanId,
          model_version: 'workout_engine',
          policy_version: pw?.policyState?.policyVersion || 'policy_v4_adaptive_learning',
        }))
      })
    if (rows.length === 0) return
    const { error } = await supabase.from('decision_provenance_events').insert(rows)
    if (error) logWarn('Weekly plan provenance persistence skipped', error)
  } catch (e) {
    logWarn('Weekly plan provenance persistence failed', e)
  }
}

function serializeWeeklyPlanDaysForRpc(userId: string, weeklyPlan: any): any[] {
  return (weeklyPlan.days || []).map((d: any) => ({
    weekly_plan_id: null,
    user_id: userId,
    plan_date: d.planDate,
    day_of_week: d.dayOfWeek,
    is_rest_day: !!d.isRestDay,
    focus: d.focus || null,
    muscle_groups: d.muscleGroups || [],
    planned_workout: d.plannedWorkout || null,
    estimated_minutes: d.estimatedMinutes || null,
    confidence: d.plannedWorkout?.objectiveUtility?.utility ?? 0.5,
    llm_verdict: d.llmVerdict && d.llmVerdict !== 'pending' ? d.llmVerdict : null,
    llm_corrections: d.llmCorrections || null,
    day_status: d.dayStatus || 'planned',
    actual_workout_id: d.actualWorkoutId || null,
    actual_workout: d.actualWorkout || null,
    last_reconciled_at: d.dayStatus === 'completed' ? new Date().toISOString() : null,
  }))
}

function serializeWeeklyDiffsForRpc(userId: string, diffs: any[] | undefined): any[] {
  if (!Array.isArray(diffs) || diffs.length === 0) return []
  return diffs.map((d: any) => ({
    weekly_plan_id: null,
    user_id: userId,
    plan_date: d.planDate,
    reason_codes: d.reasonCodes || [],
    before_workout: d.beforeWorkout || null,
    after_workout: d.afterWorkout || null,
    diff_summary: d.diffSummary || {},
  }))
}

async function ensureGeneratedWorkoutsForWeeklyPlan(userId: string, weeklyPlan: any): Promise<void> {
  const days = Array.isArray(weeklyPlan?.days) ? weeklyPlan.days : []
  for (const d of days) {
    const pw = d?.plannedWorkout
    if (!pw || !Array.isArray(pw.exercises)) continue
    const plannedId = isUuidV4(pw.id) ? pw.id : uuidv4()
    if (!isUuidV4(pw.id)) {
      pw.id = plannedId
    }
    const row = {
      id: plannedId,
      user_id: userId,
      date: d.planDate || pw.date || getLocalDate(),
      training_goal: pw.trainingGoal || null,
      session_duration_minutes: Number.isFinite(Number(pw.estimatedDurationMinutes))
        ? Math.round(Number(pw.estimatedDurationMinutes))
        : null,
      recovery_status: {
        status: pw.recoveryStatus ?? null,
        deload: !!pw.deloadActive,
        adjustments: Array.isArray(pw.adjustmentsSummary) ? pw.adjustmentsSummary : [],
        model_metadata: {
          feature_snapshot_id: pw.featureSnapshotId ?? null,
          objective_utility: pw.objectiveUtility ?? null,
        },
      },
      exercises: pw.exercises,
      rationale: pw.sessionRationale || null,
      adjustments: Array.isArray(pw.adjustmentsSummary) ? pw.adjustmentsSummary : [],
    }
    const { error } = await supabase.from('generated_workouts').insert(row)
    if (error) {
      // Ignore duplicates when ID already exists; surface other issues.
      if (!(error.code === '23505' || `${error.message || ''}`.toLowerCase().includes('duplicate'))) {
        logWarn('Failed to persist generated workout for weekly plan day', { date: row.date, error })
      }
    }
  }
}

export async function saveWeeklyPlanToSupabase(userId: string, weeklyPlan: any, diffs?: any[]) {
  // Ensure planned-workout lineage exists in generated_workouts.
  // This keeps generated_workout_id references valid for downstream ontology.
  await ensureGeneratedWorkoutsForWeeklyPlan(userId, weeklyPlan).catch((e) =>
    logWarn('Weekly plan generated_workouts persistence warning', e)
  )

  // Preferred path: single transactional RPC (version + days + diffs).
  // The `p_engine_input_snapshot` parameter is new (audit #3a) — older
  // RPC deployments will surface "function does not exist with these
  // args" and we fall through to the legacy path. The legacy path also
  // writes the snapshot, so coverage is identical either way.
  try {
    const rpcDays = serializeWeeklyPlanDaysForRpc(userId, weeklyPlan)
    const rpcDiffs = serializeWeeklyDiffsForRpc(userId, diffs)
    const { data, error } = await supabase.rpc('save_weekly_plan_atomic', {
      p_user_id: userId,
      p_week_start_date: weeklyPlan.weekStartDate,
      p_feature_snapshot_id: weeklyPlan.featureSnapshotId || null,
      p_days: rpcDays,
      p_diffs: rpcDiffs,
      p_engine_input_snapshot: weeklyPlan.engineInputSnapshot ?? null,
    })
    if (!error && data) {
      await persistWeeklyPlanProvenance(userId, data as string, weeklyPlan)
      return data as string
    }
    // If RPC is unavailable in older deployments, continue to legacy path.
    if (!(error && (error.code === 'PGRST202' || `${error.message || ''}`.toLowerCase().includes('function')))) {
      throw error
    }
  } catch (rpcErr: any) {
    if (!(rpcErr?.code === 'PGRST202' || `${rpcErr?.message || ''}`.toLowerCase().includes('function'))) {
      throw rpcErr
    }
  }

  // Legacy fallback path (non-transactional across tables).
  const { data: existingActive } = await supabase
    .from('weekly_plan_versions')
    .select('id')
    .eq('user_id', userId)
    .eq('week_start_date', weeklyPlan.weekStartDate)
    .eq('status', 'active')
    .maybeSingle()

  // Insert the new active version. We optimistically include the
  // engine_input_snapshot column; if the migration hasn't run yet the
  // insert will fail with PG 42703 ("undefined column") and we retry
  // without it. This pattern is used elsewhere in this file and is
  // preferable to a feature flag because it keeps the new column the
  // default on freshly migrated deployments.
  let version: { id: string } | null = null
  let versionError: any = null
  {
    const insertWithSnapshot = await supabase
      .from('weekly_plan_versions')
      .insert({
        user_id: userId,
        week_start_date: weeklyPlan.weekStartDate,
        status: 'active',
        feature_snapshot_id: weeklyPlan.featureSnapshotId || null,
        engine_input_snapshot: weeklyPlan.engineInputSnapshot ?? null,
      })
      .select('id')
      .single()
    if (insertWithSnapshot.error
      && (insertWithSnapshot.error.code === '42703'
        || `${insertWithSnapshot.error.message || ''}`.toLowerCase().includes('column'))) {
      const retry = await supabase
        .from('weekly_plan_versions')
        .insert({
          user_id: userId,
          week_start_date: weeklyPlan.weekStartDate,
          status: 'active',
          feature_snapshot_id: weeklyPlan.featureSnapshotId || null,
        })
        .select('id')
        .single()
      version = (retry.data as { id: string } | null) ?? null
      versionError = retry.error
    } else {
      version = (insertWithSnapshot.data as { id: string } | null) ?? null
      versionError = insertWithSnapshot.error
    }
  }
  if (versionError || !version) throw versionError ?? new Error('weekly_plan_versions insert returned no row')

  const rows = (weeklyPlan.days || []).map((d: any) => ({
    weekly_plan_id: version.id,
    user_id: userId,
    plan_date: d.planDate,
    day_of_week: d.dayOfWeek,
    is_rest_day: !!d.isRestDay,
    focus: d.focus || null,
    muscle_groups: d.muscleGroups || [],
    planned_workout: d.plannedWorkout || null,
    estimated_minutes: d.estimatedMinutes || null,
    confidence: d.plannedWorkout?.objectiveUtility?.utility ?? 0.5,
    llm_verdict: d.llmVerdict && d.llmVerdict !== 'pending' ? d.llmVerdict : null,
    llm_corrections: d.llmCorrections || null,
    day_status: d.dayStatus || (d.isRestDay ? 'planned' : 'planned'),
    actual_workout_id: d.actualWorkoutId || null,
    actual_workout: d.actualWorkout || null,
    last_reconciled_at: d.dayStatus === 'completed' ? new Date().toISOString() : null,
  }))

  if (rows.length > 0) {
    let { error: daysError } = await supabase
      .from('weekly_plan_days')
      .insert(rows)
    if (daysError && (daysError.code === '42703' || `${daysError.message || ''}`.toLowerCase().includes('column'))) {
      const strippedRows = rows.map(({ day_status, actual_workout_id, actual_workout, last_reconciled_at, ...rest }: any) => rest)
      const retry = await supabase
        .from('weekly_plan_days')
        .insert(strippedRows)
      daysError = retry.error
    }
    if (daysError) {
      await supabase.from('weekly_plan_versions').delete().eq('id', version.id).eq('user_id', userId)
      throw daysError
    }
  }

  if (existingActive?.id) {
    await supabase
      .from('weekly_plan_versions')
      .update({ status: 'superseded' })
      .eq('id', existingActive.id)
      .eq('user_id', userId)
  }

  if (Array.isArray(diffs) && diffs.length > 0) {
    await saveWeeklyPlanDiffsToSupabase(userId, version.id as string, diffs)
  }

  await persistWeeklyPlanProvenance(userId, version.id as string, weeklyPlan)
  return version.id as string
}

/**
 * Force the next TodayWorkout / WeekAhead visit to regenerate by removing
 * every active weekly_plan_versions row for this user.
 *
 * Why DELETE rather than UPDATE status='superseded':
 *   `weekly_plan_versions` has a unique index on
 *   `(user_id, week_start_date, status)`. Once a week has both an active
 *   row AND a superseded row (the normal state after one regeneration),
 *   flipping the active to superseded collides on the index. DELETE side-
 *   steps that entirely.
 *
 * Safety:
 *   - `weekly_plan_days.weekly_plan_id` and `weekly_plan_diffs.weekly_plan_id`
 *     have ON DELETE CASCADE, so day/diff rows tied to the deleted version
 *     follow. That's the right semantics — the diffs describe how *that*
 *     plan evolved; the regenerated plan starts a new diff history.
 *   - `decision_provenance_events.weekly_plan_id` is ON DELETE SET NULL,
 *     so provenance events survive (with the back-reference cleared).
 *   - The previous superseded row for the same week is NOT touched,
 *     preserving the historical record of what was generated.
 *
 * Returns the count of active rows removed so callers can decide whether
 * to surface a "weekly plan will refresh" toast.
 */
export async function supersedeActiveWeeklyPlanForUser(userId: string): Promise<number> {
  if (!userId) return 0
  const { data, error } = await supabase
    .from('weekly_plan_versions')
    .delete()
    .eq('user_id', userId)
    .eq('status', 'active')
    .select('id')
  if (error) throw error
  return Array.isArray(data) ? data.length : 0
}

export async function getActiveWeeklyPlanFromSupabase(userId: string, weekStartDate: string) {
  const { data: version, error: versionError } = await supabase
    .from('weekly_plan_versions')
    .select('id, week_start_date, feature_snapshot_id, created_at')
    .eq('user_id', userId)
    .eq('week_start_date', weekStartDate)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (versionError) throw versionError
  if (!version) return null

  const { data: days, error: daysError } = await supabase
    .from('weekly_plan_days')
    .select('*')
    .eq('weekly_plan_id', version.id)
    .eq('user_id', userId)
    .order('plan_date', { ascending: true })
  if (daysError) throw daysError

  return {
    id: version.id,
    weekStartDate: version.week_start_date,
    featureSnapshotId: version.feature_snapshot_id,
    days: (days || []).map((d: any) => ({
      planDate: d.plan_date,
      dayOfWeek: d.day_of_week,
      dayName: new Date(`${d.plan_date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' }),
      isRestDay: d.is_rest_day,
      focus: d.focus || '',
      muscleGroups: Array.isArray(d.muscle_groups) ? d.muscle_groups : [],
      plannedWorkout: d.planned_workout,
      dayStatus: d.day_status || 'planned',
      actualWorkoutId: d.actual_workout_id || null,
      actualWorkout: d.actual_workout || null,
      estimatedExercises: Array.isArray(d.planned_workout?.exercises) ? d.planned_workout.exercises.length : 0,
      estimatedMinutes: d.estimated_minutes || d.planned_workout?.estimatedDurationMinutes || 0,
      llmVerdict: d.llm_verdict || 'pending',
      llmCorrections: d.llm_corrections || null,
    })),
  }
}

export async function saveWeeklyPlanDiffsToSupabase(userId: string, weeklyPlanId: string, diffs: any[]) {
  if (!Array.isArray(diffs) || diffs.length === 0) return
  const rows = diffs.map((d: any) => ({
    weekly_plan_id: weeklyPlanId,
    user_id: userId,
    plan_date: d.planDate,
    reason_codes: d.reasonCodes || [],
    before_workout: d.beforeWorkout || null,
    after_workout: d.afterWorkout || null,
    diff_summary: d.diffSummary || {},
  }))
  const { error } = await supabase.from('weekly_plan_diffs').insert(rows)
  if (error) throw error
}

export async function saveLlmValidationArtifact(
  userId: string,
  generatedWorkoutId: string | null,
  validation: any,
  metadata?: { selectedVersion?: 'original' | 'adjusted'; rationale?: string | null }
) {
  const rejectionClasses = Array.isArray(validation?.rejection_classes) ? validation.rejection_classes : []
  const row = {
    user_id: userId,
    generated_workout_id: generatedWorkoutId,
    verdict: validation?.verdict || 'pass',
    rejection_classes: rejectionClasses,
    rationale: metadata?.rationale ?? null,
    immediate_corrections: Array.isArray(validation?.immediate_corrections) ? validation.immediate_corrections : [],
    pattern_observations: Array.isArray(validation?.pattern_observations) ? validation.pattern_observations : [],
    schema_version: validation?.schema_version || 'v1',
    model_version: 'gpt-4o-mini',
  }
  const { error } = await supabase.from('llm_validation_artifacts').insert(row)
  if (error) {
    logWarn('Failed to persist llm_validation_artifacts', error)
  }

  if (metadata?.selectedVersion) {
    // Also mirror as provenance for lineage between reviewed and selected versions.
    await supabase.from('decision_provenance_events').insert({
      user_id: userId,
      event_date: getLocalDate(),
      source_type: 'policy',
      decision_stage: 'llm_selection',
      decision_key: 'selected_workout_version',
      decision_value: { selectedVersion: metadata.selectedVersion },
      confidence: validation?.verdict === 'pass' ? 0.85 : 0.65,
      generated_workout_id: generatedWorkoutId,
      model_version: 'llm_validator_v1',
      policy_version: 'policy_v4_adaptive_learning',
    }).then(() => {}).catch((e: unknown) =>
      logError('Failed to persist decision_provenance for LLM version selection', e)
    )
  }
}

