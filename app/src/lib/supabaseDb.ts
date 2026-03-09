import { supabase as supabaseClient, supabaseConfigErrorMessage } from './supabase'
import { getLocalDate, getTodayEST, getYesterdayEST } from '../utils/dateUtils'
import { toInteger, toNumber } from '../utils/numberUtils'
import { logError, logDebug, logWarn } from '../utils/logger'
import { isUuidV4, uuidv4 } from '../utils/uuid'
import { enqueueOutboxItem } from './syncOutbox'

// Avoid TypeError crashes when Supabase env is missing; throw a clear message at call time instead.
const supabase: any = supabaseClient ?? new Proxy({}, { get: () => { throw new Error(supabaseConfigErrorMessage) } })

// Ensure logDebug is always available (fallback for build issues)
const safeLogDebug = logDebug || (() => {})

// Simple TTL cache for frequent Supabase reads
const readCache = new Map<string, { data: any; ts: number }>()
const CACHE_TTL_MS = 60_000

function getCached<T>(key: string): T | undefined {
  const entry = readCache.get(key)
  if (entry && Date.now() - entry.ts < CACHE_TTL_MS) return entry.data as T
  if (entry) readCache.delete(key)
  return undefined
}

function setCache(key: string, data: any) {
  readCache.set(key, { data, ts: Date.now() })
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
  // Data pipeline: Validate -> Clean -> Enrich -> Save
  
  // Step 1: Validate data (dynamic import for code-splitting)
  let validation: { valid: boolean; errors: string[] } = { valid: true, errors: [] }
  try {
    const validationModule = await import('./dataValidation')
    const { validateWorkout } = validationModule || {}
    if (validateWorkout && typeof validateWorkout === 'function') {
      validation = validateWorkout(workout)
      if (!validation.valid) {
        logError('Workout validation failed', validation.errors)
        throw new Error(`Workout validation failed: ${validation.errors.join(', ')}`)
      }
    } else {
      logError('validateWorkout is not a function', { validationModule })
      // Continue without validation if function is not available
    }
  } catch (validationError) {
    logError('Error importing or calling validateWorkout', validationError)
    // Continue without validation if import fails
  }
  
  // Step 2: Clean and normalize data (dynamic import for code-splitting)
  let cleanedWorkout = workout
  try {
    const cleaningModule = await import('./dataCleaning')
    const { cleanWorkoutData } = cleaningModule || {}
    if (cleanWorkoutData && typeof cleanWorkoutData === 'function') {
      cleanedWorkout = cleanWorkoutData(workout)
    } else {
      logError('cleanWorkoutData is not a function', { cleaningModule })
      // Use original workout if cleaning function is not available
    }
  } catch (cleaningError) {
    logError('Error importing or calling cleanWorkoutData', cleaningError)
    // Use original workout if import fails
  }
  
  // Allow workouts with 0 exercises (user may want to log a workout session without exercises)
  // Only validate that exercises is an array if it exists
  if (cleanedWorkout.exercises && !Array.isArray(cleanedWorkout.exercises)) {
    throw new Error('Workout exercises must be an array')
  }
  
  // If exercises exist, ensure they have valid structure (but allow empty array)
  if (cleanedWorkout.exercises && cleanedWorkout.exercises.length > 0) {
    // Validate exercise structure if exercises are provided
    const hasInvalidExercise = cleanedWorkout.exercises.some((ex: any) => 
      !ex || typeof ex !== 'object' || !ex.name
    )
    if (hasInvalidExercise) {
      throw new Error('All exercises must have a name')
    }
  }
  
  // Use cleaned workout from here on
  const workoutToSave = cleanedWorkout

  // -------------------------
  // Session type: 'workout' | 'recovery'
  // - If caller provided a sessionType, use it.
  // - Otherwise infer: recovery if ALL exercises are Recovery category.
  // -------------------------
  const inferSessionType = () => {
    const exs = Array.isArray(workoutToSave.exercises) ? workoutToSave.exercises : []
    if (exs.length === 0) return 'workout'
    const nonRecovery = exs.some((e: any) => (e?.category || '').toString().toLowerCase() !== 'recovery')
    return nonRecovery ? 'workout' : 'recovery'
  }
  const sessionType = (workoutToSave.sessionType || workoutToSave.session_type || inferSessionType())
    .toString()
    .toLowerCase() === 'recovery'
    ? 'recovery'
    : 'workout'
  
  // Idempotency: always persist workouts with a stable UUID so retries don't create duplicates.
  // - If caller provided a valid UUID, keep it.
  // - Otherwise generate one (and use it for this write).
  const workoutId = isUuidV4(workoutToSave?.id) ? workoutToSave.id : uuidv4()

  const upsertPayload = {
    id: workoutId,
    user_id: userId,
    date: workoutToSave.date,
    duration: workoutToSave.duration,
    template_name: workoutToSave.templateName || null,
    perceived_effort: workoutToSave.perceivedEffort || null,
    session_rpe: workoutToSave.perceivedEffort || null,
    training_density: workoutToSave.trainingDensity != null ? Number(workoutToSave.trainingDensity) : null,
    mood_after: workoutToSave.moodAfter || null,
    notes: workoutToSave.notes || null,
    day_of_week: workoutToSave.dayOfWeek ?? null,
    workout_calories_burned: workoutToSave.workoutCaloriesBurned != null ? Number(workoutToSave.workoutCaloriesBurned) : null,
    workout_steps: workoutToSave.workoutSteps != null ? Number(workoutToSave.workoutSteps) : null,
    generated_workout_id: workoutToSave.generatedWorkoutId || null,
    updated_at: new Date().toISOString()
  }

  let workoutData = null
  let workoutError = null
  try {
    const { data, error } = await supabase
      .from('workouts')
      .upsert({ ...upsertPayload, session_type: sessionType }, { onConflict: 'id' })
      .select()
      .single()
    workoutData = data
    workoutError = error
    if (workoutError && (workoutError.code === '42703' || `${workoutError.message || ''}`.toLowerCase().includes('session_type'))) {
      const retry = await supabase
        .from('workouts')
        .upsert(upsertPayload, { onConflict: 'id' })
        .select()
        .single()
      workoutData = retry.data
      workoutError = retry.error
    }
  } catch (e: any) {
    workoutError = e
  }

  if (workoutError) throw workoutError

  // Replace exercises/sets for this workout id (safe for both new inserts and retries).
  const { data: oldExercises, error: exercisesError } = await supabase
    .from('workout_exercises')
    .select('id')
    .eq('workout_id', workoutData.id)

  if (exercisesError) {
    logError('Error fetching old exercises for workout upsert', exercisesError)
    throw exercisesError
  }

  if (oldExercises && Array.isArray(oldExercises) && oldExercises.length > 0) {
    const exerciseIds = oldExercises.map(ex => ex?.id).filter(id => id != null)
    if (exerciseIds.length > 0) {
      const { error: setsDeleteError } = await supabase
        .from('workout_sets')
        .delete()
        .in('workout_exercise_id', exerciseIds)
      if (setsDeleteError) {
        logError('Error deleting workout sets', setsDeleteError)
        throw setsDeleteError
      }

      const { error: exercisesDeleteError } = await supabase
        .from('workout_exercises')
        .delete()
        .in('id', exerciseIds)
      if (exercisesDeleteError) {
        logError('Error deleting workout exercises', exercisesDeleteError)
        throw exercisesDeleteError
      }
    }
  }
  
  // Step 3: Enrich data (after saving to get workout ID)
  try {
    // Fetch full workout with exercises for enrichment
    const { data: fullWorkout } = await supabase
      .from('workouts')
      .select(`
        *,
        workout_exercises (
          *,
          workout_sets (*)
        )
      `)
      .eq('id', workoutData.id)
      .single()
    
  } catch (enrichError) {
    // Non-critical
  }

  // Insert exercises (only those with valid sets data)
  let exerciseOrder = 0
  for (let i = 0; i < workoutToSave.exercises.length; i++) {
    const ex = workoutToSave.exercises[i]
    
    const exSets = Array.isArray(ex.sets) ? ex.sets : []
    if (exSets.length === 0 || !exSets.some((s: any) =>
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
        // Create custom exercise in library
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
    
    // Determine exercise type (weightlifting vs cardio)
    const exerciseType = ex.exerciseType || (ex.distance || ex.time ? 'cardio' : 'weightlifting')
    
    const { data: exerciseData, error: exerciseError } = await supabase
      .from('workout_exercises')
      .insert({
        workout_id: workoutData.id,
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

    // Insert sets (only sets with actual data — including cardio fields)
    const validSets = ex.sets.filter((s: any) => s.weight || s.reps || s.time || s.time_seconds || s.speed || s.incline)
    if (validSets.length > 0) {
      const setsToInsert = validSets.map((set: any, idx: number) => {
        // Resolve time: prefer time string, fall back to time_seconds
        let timeVal = set.time || null
        if (!timeVal && set.time_seconds != null && Number(set.time_seconds) > 0) {
          const ts = Math.floor(Number(set.time_seconds))
          timeVal = String(ts)
        }
        return {
          workout_exercise_id: exerciseData.id,
          set_number: idx + 1,
          weight: (String(set?.weight || '').trim().toUpperCase() === 'BW') ? null : (set.weight ? Number(set.weight) : null),
          is_bodyweight: String(set?.weight || '').trim().toUpperCase() === 'BW',
          weight_label: String(set?.weight || '').trim().toUpperCase() === 'BW' ? 'BW' : null,
          reps: set.reps ? Number(set.reps) : null,
          time: timeVal,
          speed: set.speed ? Number(set.speed) : null,
          incline: set.incline ? Number(set.incline) : null
        }
      })

      const tryInsert = async (rows: any[]) => supabase.from('workout_sets').insert(rows)
      let { error: setsError } = await tryInsert(setsToInsert)
      if (setsError && (setsError.code === '42703' || `${setsError.message || ''}`.toLowerCase().includes('column'))) {
        // Retry without optional BW columns for older schemas.
        const stripped = setsToInsert.map(({ is_bodyweight, weight_label, ...rest }: any) => rest)
        const retry = await tryInsert(stripped)
        setsError = retry.error
      }
      if (setsError) throw setsError
    }
  }

  return workoutData
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

  // Fallback: fetch workouts without embeds so the UI can still show history rows.
  safeLogDebug('getWorkoutsFromSupabase: embedded select failed; retrying without embeds', {
    code: embedded.error?.code,
    message: embedded.error?.message
  })

  const plain = await supabase
    .from('workouts')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: false })

  if (plain.error) throw plain.error

  const result = (plain.data || []).map((w: any) => ({ ...w, workout_exercises: w.workout_exercises || [] }))
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

  const { data, error } = await supabase
    .from('workouts')
    .select(`
      id,
      date,
      created_at,
      workout_exercises (
        exercise_name,
        body_part,
        exercise_type,
        workout_sets (
          weight,
          reps,
          time,
          speed,
          incline
        )
      )
    `)
    .eq('user_id', userId)
    .order('date', { ascending: false })
    .limit(safeLimit)

  if (error) {
    // Fallback: some deployments may not have reliable date ordering; use created_at.
    const { data: d2, error: e2 } = await supabase
      .from('workouts')
      .select(`
        id,
        date,
        created_at,
        workout_exercises (
          exercise_name,
          body_part,
          exercise_type,
          workout_sets (
            weight,
            reps,
            time,
            speed,
            incline
          )
        )
      `)
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
  
  // Update workout
  const { error: workoutError } = await supabase
    .from('workouts')
    .update({
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
      generated_workout_id: workout.generatedWorkoutId || null,
      updated_at: new Date().toISOString()
    })
    .eq('id', workoutId)
    .eq('user_id', userId)

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
  let exerciseOrder = 0
  for (let i = 0; i < workout.exercises.length; i++) {
    const ex = workout.exercises[i]
    
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
      const setsToInsert = validSets2.map((set: any, idx: number) => ({
        workout_exercise_id: exerciseData.id,
        set_number: idx + 1,
        weight: (String(set?.weight || '').trim().toUpperCase() === 'BW') ? null : (set.weight ? Number(set.weight) : null),
        is_bodyweight: String(set?.weight || '').trim().toUpperCase() === 'BW',
        weight_label: String(set?.weight || '').trim().toUpperCase() === 'BW' ? 'BW' : null,
        reps: set.reps ? Number(set.reps) : null,
        time: set.time ?? set.time_seconds ?? null,
        speed: set.speed ? Number(set.speed) : null,
        incline: set.incline ? Number(set.incline) : null
      }))

      const tryInsert = async (rows: any[]) => supabase.from('workout_sets').insert(rows)
      let { error: setsError } = await tryInsert(setsToInsert)
      if (setsError && (setsError.code === '42703' || `${setsError.message || ''}`.toLowerCase().includes('column'))) {
        const stripped = setsToInsert.map(({ is_bodyweight, weight_label, ...rest }: any) => rest)
        const retry = await tryInsert(stripped)
        setsError = retry.error
      }
      if (setsError) throw setsError
    }
  }
}

export async function deleteWorkoutFromSupabase(workoutId: string, userId: string | null = null) {
  // Security: If userId provided, verify workout belongs to user
  if (userId) {
    const { data: workout, error: checkError } = await supabase
      .from('workouts')
      .select('user_id')
      .eq('id', workoutId)
      .single()
    
    if (checkError) throw checkError
    if (workout.user_id !== userId) {
      throw new Error('Unauthorized: Workout does not belong to user')
    }
  }
  
  // Delete sets first (due to foreign key)
  const { data: exercises } = await supabase
    .from('workout_exercises')
    .select('id')
    .eq('workout_id', workoutId)

  if (exercises) {
    for (const ex of exercises) {
      await supabase.from('workout_sets').delete().eq('workout_exercise_id', ex.id)
    }
  }

  // Delete exercises
  await supabase.from('workout_exercises').delete().eq('workout_id', workoutId)

  // Delete workout (with userId check if provided)
  let deleteQuery = supabase.from('workouts').delete().eq('id', workoutId)
  if (userId) {
    deleteQuery = deleteQuery.eq('user_id', userId)
  }
  const { error } = await deleteQuery
  if (error) throw error
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
    // Upsert to health_metrics table
    const { data, error } = await supabase
      .from('health_metrics')
      .upsert(healthMetricsData, { onConflict: 'user_id,date' })
      .select()

    if (error) {
      logError('saveMetricsToSupabase: Error from Supabase', error)
      throw error
    }
    
    safeLogDebug('saveMetricsToSupabase: Success', data)
    
    // Post-save enrichment removed (simplified)
    try {
      // placeholder
    } catch (enrichError) {
      // Non-critical
    }
    
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
      // ONLY count exercises with valid sets data (double-check)
      const setsArr = Array.isArray(ex.workout_sets) ? ex.workout_sets : []
      const hasValidSets = setsArr.length > 0 && 
        setsArr.some((s: any) => s.weight || s.reps || s.time)
      
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
      // ONLY count exercises that have actual sets with data (no dummy data)
      const setsArr = Array.isArray(ex.workout_sets) ? ex.workout_sets : []
      const hasValidSets = setsArr.length > 0 && 
        setsArr.some((s: any) => s.weight || s.reps || s.time)
      
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
  // Only include fields that the caller explicitly provided (non-undefined).
  // This prevents overwriting fields the caller didn't intend to change.
  const upsertData: any = {
    user_id: userId,
    updated_at: new Date().toISOString()
  }

  // ML-v2 training profile fields (snake_case — sent by Profile.tsx)
  const directFields = [
    'training_goal', 'session_duration_minutes', 'equipment_access',
    'available_days_per_week', 'job_activity_level', 'injuries',
    'exercises_to_avoid', 'performance_goals', 'preferred_split',
    'date_of_birth', 'gender', 'height_feet', 'height_inches',
    'body_weight_lbs', 'experience_level',
    'cardio_preference', 'cardio_frequency_per_week', 'cardio_duration_minutes',
    'preferred_exercises',
    'recovery_speed', 'weight_goal_lbs', 'weight_goal_date',
    'primary_goal', 'secondary_goal', 'priority_muscles',
    'weekday_deadlines', 'gym_profiles', 'active_gym_profile', 'age',
    'rest_days',
  ]
  for (const key of directFields) {
    if (prefs[key] !== undefined) {
      upsertData[key] = prefs[key] ?? null
    }
  }

  // Legacy camelCase fields (sent by onboarding / other callers)
  if (prefs.planName !== undefined) upsertData.plan_name = prefs.planName || null
  if (prefs.fitnessGoal !== undefined) upsertData.fitness_goal = prefs.fitnessGoal || null
  if (prefs.experienceLevel !== undefined) upsertData.experience_level = prefs.experienceLevel || null
  if (prefs.availableDays !== undefined) upsertData.available_days = prefs.availableDays || null
  if (prefs.sessionDuration !== undefined) upsertData.session_duration = prefs.sessionDuration || null
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
  const maxAttempts = 15

  while (attempts < maxAttempts) {
    attempts++
    const { data, error } = await supabase
      .from('user_preferences')
      .upsert(upsertData, { onConflict: 'user_id' })
      .select()

    if (!error) return data

    if (error.code === '42703') {
      // Parse the missing column name from the error message
      // Format: 'column "rest_days" of relation "user_preferences" does not exist'
      const match = error.message?.match(/column "([^"]+)"/)
      const badCol = match?.[1]
      if (badCol && badCol in upsertData) {
        missingCols.push(badCol)
        delete upsertData[badCol]
        logWarn(`Column "${badCol}" not in DB — stripped and retrying (attempt ${attempts})`)
        continue
      }
      // Couldn't parse — fall back to stripping everything non-essential
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

  // Final attempt after all stripping
  const { data: finalData, error: finalError } = await supabase
    .from('user_preferences')
    .upsert(upsertData, { onConflict: 'user_id' })
    .select()

  if (finalError) throw finalError
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
  
  const bodyParts = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Core', 'Legs', 'Cardio', 'Recovery']
  
  bodyParts.forEach(bp => {
    stats[bp] = {
      lastTrained: null,
      topExercise: null,
      avgPerWeek: 0,
      exerciseCounts: {},
      dates: []
    }
  })
  
  // Process all workouts (already filtered by getWorkoutsFromSupabase)
  workouts.forEach((w: any) => {
    w.workout_exercises?.forEach((ex: any) => {
      // ONLY count exercises with valid sets data (double-check)
      const setsArr = Array.isArray(ex.workout_sets) ? ex.workout_sets : []
      const hasValidSets = setsArr.length > 0 && 
        setsArr.some((s: any) => s.weight || s.reps || s.time)
      
      if (!hasValidSets) return
      
      const bp = ex.body_part || 'Other'
      if (!stats[bp]) return
      
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
      workout_start_time: sessionData.workoutStartTime,
      paused_time_ms: sessionData.pausedTimeMs || 0,
      rest_start_time: sessionData.restStartTime || null,
      rest_duration_seconds: sessionData.restDurationSeconds || null,
      is_resting: sessionData.isResting || false,
      updated_at: new Date().toISOString()
    }

    // Include exercises if provided (for auto-save)
    // Only include if column exists (graceful degradation)
    if (sessionData.exercises !== undefined) {
      sessionPayload.exercises = sessionData.exercises
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
      // Check if error is due to missing table (expected error)
      const isExpectedError = error.code === 'PGRST205' || 
                              error.code === '42P01' ||
                              error.message?.includes('Could not find the table')
      
      if (isExpectedError) {
        // Silently fail for expected errors
        safeLogDebug('Active workout sessions table not available')
        return null
      }
      
      // Log unexpected errors
      logError('Error getting active workout session', error)
      return null
    }
    return data
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

