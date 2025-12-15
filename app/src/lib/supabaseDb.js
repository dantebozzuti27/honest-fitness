import { supabase } from './supabase'
import { getTodayEST, getYesterdayEST } from '../utils/dateUtils'
import { toInteger, toNumber } from '../utils/numberUtils'
import { logError, logDebug } from '../utils/logger'
import { saveEnrichedData } from './dataEnrichment'
import { trackEvent } from './eventTracking'

// Ensure logDebug is always available (fallback for build issues)
const safeLogDebug = logDebug || (() => {})

// ============ WORKOUTS ============
// IMPORTANT: Workouts are ONLY created through explicit user action (finishing a workout).
// This function is ONLY called from ActiveWorkout.jsx when the user finishes a workout.
// NEVER call this function automatically or with dummy/test data.

export async function saveWorkoutToSupabase(workout, userId) {
  // Data pipeline: Validate -> Clean -> Enrich -> Save
  
  // Step 1: Validate data (dynamic import for code-splitting)
  let validation = { valid: true, errors: [] }
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
    const hasInvalidExercise = cleanedWorkout.exercises.some(ex => 
      !ex || typeof ex !== 'object' || !ex.name
    )
    if (hasInvalidExercise) {
      throw new Error('All exercises must have a name')
    }
  }
  
  // Track event
  trackEvent('workout_saved', {
    category: 'workout',
    action: 'save',
    properties: {
      exercise_count: cleanedWorkout.exercises.length,
      duration: cleanedWorkout.duration
    }
  })
  
  // Use cleaned workout from here on
  const workoutToSave = cleanedWorkout
  
  // Use upsert with conflict resolution to prevent race conditions
  // First, check for existing workouts to handle duplicates
  // Add null checks to prevent errors
  const { data: existingWorkouts, error: checkError } = await supabase
    .from('workouts')
    .select('id, date, created_at')
    .eq('user_id', userId)
    .eq('date', workoutToSave.date)
    .order('created_at', { ascending: false })

  if (checkError) {
    logError('Error checking for existing workouts', checkError)
    throw checkError
  }

  let workoutData
  
  // If duplicates exist, delete the older ones and update the most recent
  // Add null check for existingWorkouts
  if (existingWorkouts && Array.isArray(existingWorkouts) && existingWorkouts.length > 0) {
    const duplicates = existingWorkouts.slice(1) // Keep the first (most recent), delete the rest
    // Batch delete duplicates in parallel for performance
    if (duplicates.length > 0) {
      await Promise.all(duplicates.map(dup => deleteWorkoutFromSupabase(dup.id)))
    }
    
    // Update the existing workout instead of creating a new one
    const existingId = existingWorkouts[0]?.id
    if (!existingId) {
      throw new Error('Existing workout ID not found')
    }
    
    // Batch delete old exercises and sets for this workout
    const { data: oldExercises, error: exercisesError } = await supabase
      .from('workout_exercises')
      .select('id')
      .eq('workout_id', existingId)
    
    if (exercisesError) {
      logError('Error fetching old exercises for workout update', exercisesError)
      throw exercisesError
    }
    
    if (oldExercises && Array.isArray(oldExercises) && oldExercises.length > 0) {
      const exerciseIds = oldExercises.map(ex => ex?.id).filter(id => id != null)
      if (exerciseIds.length > 0) {
        // Batch delete all sets
        const { error: setsDeleteError } = await supabase
          .from('workout_sets')
          .delete()
          .in('workout_exercise_id', exerciseIds)
        if (setsDeleteError) {
          logError('Error deleting workout sets', setsDeleteError)
          throw setsDeleteError
        }
        
        // Batch delete all exercises
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
    
    // Update the workout
    const { data: updatedWorkout, error: updateError } = await supabase
      .from('workouts')
      .update({
        duration: workoutToSave.duration,
        template_name: workoutToSave.templateName || null,
        perceived_effort: workoutToSave.perceivedEffort || null,
        mood_after: workoutToSave.moodAfter || null,
        notes: workoutToSave.notes || null,
        day_of_week: workoutToSave.dayOfWeek ?? null,
        workout_calories_burned: workoutToSave.workoutCaloriesBurned != null ? Number(workoutToSave.workoutCaloriesBurned) : null,
        workout_steps: workoutToSave.workoutSteps != null ? Number(workoutToSave.workoutSteps) : null,
        updated_at: new Date().toISOString()
      })
      .eq('id', existingId)
      .select()
      .single()

    if (updateError) throw updateError
    workoutData = updatedWorkout
  } else {
    // No duplicate, insert new workout
    const { data: newWorkout, error: workoutError } = await supabase
      .from('workouts')
      .insert({
        user_id: userId,
        date: workoutToSave.date,
        duration: workoutToSave.duration,
        template_name: workoutToSave.templateName || null,
        perceived_effort: workoutToSave.perceivedEffort || null,
        mood_after: workoutToSave.moodAfter || null,
        notes: workoutToSave.notes || null,
        day_of_week: workoutToSave.dayOfWeek ?? null,
        workout_calories_burned: workoutToSave.workoutCaloriesBurned != null ? Number(workoutToSave.workoutCaloriesBurned) : null,
        workout_steps: workoutToSave.workoutSteps != null ? Number(workoutToSave.workoutSteps) : null
      })
      .select()
      .single()

    if (workoutError) throw workoutError
    workoutData = newWorkout
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
    
    if (fullWorkout) {
      // Save enriched data (this will enrich and save to data_enrichments table)
      await saveEnrichedData('workout', fullWorkout, userId)
    }
  } catch (enrichError) {
    // Don't fail the save if enrichment fails
    logError('Error enriching workout data', enrichError)
  }

  // Insert exercises (only those with valid sets data)
  let exerciseOrder = 0
  for (let i = 0; i < workoutToSave.exercises.length; i++) {
    const ex = workoutToSave.exercises[i]
    
    // Skip exercises without valid sets data (prevent dummy data)
    if (!ex.sets || ex.sets.length === 0 || !ex.sets.some(s => s.weight || s.reps || s.time)) {
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

    // Insert sets (only sets with actual data)
    const validSets = ex.sets.filter(s => s.weight || s.reps || s.time)
    if (validSets.length > 0) {
      const setsToInsert = validSets.map((set, idx) => ({
        workout_exercise_id: exerciseData.id,
        set_number: idx + 1,
        weight: set.weight ? Number(set.weight) : null,
        reps: set.reps ? Number(set.reps) : null,
        time: set.time || null,
        speed: set.speed ? Number(set.speed) : null,
        incline: set.incline ? Number(set.incline) : null
      }))

      const { error: setsError } = await supabase
        .from('workout_sets')
        .insert(setsToInsert)

      if (setsError) throw setsError
    }
  }

  // Automatically create feed item for ALL workouts (not just shared ones)
  try {
    const today = workout.date || getTodayEST()
    const minutes = Math.floor((workout.duration || 0) / 60)
    const seconds = (workout.duration || 0) % 60
    const title = workout.templateName || 'Freestyle Workout'
    const subtitle = `${minutes}:${String(seconds).padStart(2, '0')}`

    const feedItem = {
      type: 'workout',
      date: today,
      title,
      subtitle,
      data: {
        ...workout,
        id: workoutData.id,
        date: workoutData.date,
        duration: workoutData.duration,
        templateName: workout.templateName,
        exercises: workout.exercises
      },
      shared: true, // All workouts are automatically shared
      visibility: 'public' // Default to public for all workouts
    }

    await saveFeedItemToSupabase(feedItem, userId)
    
    // Trigger feed update event
    window.dispatchEvent(new CustomEvent('feedUpdated'))
  } catch (feedError) {
    // Don't fail workout save if feed item creation fails
    safeLogDebug('Error auto-creating feed item for workout', feedError)
  }

  // Update fitness goals based on the saved workout (non-blocking)
  try {
    const { updateCategoryGoals } = await import('./goalsDb')
    updateCategoryGoals(userId, 'fitness').catch(error => {
      logError('Error updating fitness goals after workout save', error)
    })
  } catch (error) {
    // Silently fail - goal updates shouldn't block workout saves
    logError('Error importing goalsDb for workout goal update', error)
  }

  return workoutData
}

export async function getWorkoutsFromSupabase(userId) {
  const { data, error } = await supabase
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

  if (error) throw error
  
  // Allow workouts with 0 exercises (user may want to log a workout session without exercises)
  // Filter out only workouts that are clearly invalid (have exercises but no valid sets data)
  const validWorkouts = (data || []).filter(workout => {
    // If workout has no exercises, that's valid (allow 0 exercises)
    if (!workout.workout_exercises || workout.workout_exercises.length === 0) {
      return true
    }
    
    // If workout has exercises, at least one must have valid sets data
    const hasValidExercise = workout.workout_exercises.some(ex => {
      if (!ex.workout_sets || ex.workout_sets.length === 0) return false
      return ex.workout_sets.some(s => s.weight || s.reps || s.time)
    })
    
    return hasValidExercise
  })
  
  // Auto-delete invalid workouts in background (don't wait for it)
  // Only delete workouts that have exercises but no valid sets data (dummy data)
  const invalidWorkouts = (data || []).filter(workout => {
    // Workouts with 0 exercises are valid, don't delete them
    if (!workout.workout_exercises || workout.workout_exercises.length === 0) {
      return false
    }
    // Only delete if workout has exercises but none have valid sets data
    const hasValidExercise = workout.workout_exercises.some(ex => {
      if (!ex.workout_sets || ex.workout_sets.length === 0) return false
      return ex.workout_sets.some(s => s.weight || s.reps || s.time)
    })
    return !hasValidExercise
  })
  
  if (invalidWorkouts.length > 0) {
    invalidWorkouts.forEach(workout => {
      deleteWorkoutFromSupabase(workout.id, userId).catch(err => {
        // Silently fail - cleanup is best effort
        safeLogDebug('Auto-cleanup: Failed to delete invalid workout', workout.id)
      })
    })
  }
  
  // Return all valid workouts (users can have multiple workouts per day)
  return validWorkouts
}

export async function getWorkoutDatesFromSupabase(userId) {
  // Use getWorkoutsFromSupabase to get filtered workouts (no dummy data)
  const workouts = await getWorkoutsFromSupabase(userId)
  return [...new Set(workouts.map(w => w.date))]
}

// ============ PAUSED WORKOUTS ============

/**
 * Save a paused workout (draft) to Supabase
 * This allows users to pause and resume workouts later
 */
export async function savePausedWorkoutToSupabase(workoutState, userId) {
  const pausedWorkout = {
    user_id: userId,
    date: workoutState.date || getTodayEST(),
    exercises: JSON.stringify(workoutState.exercises || []),
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
    .single()

  // If table doesn't exist, silently fail (migration not run)
  if (checkError && (checkError.code === 'PGRST205' || checkError.message?.includes('Could not find the table'))) {
    safeLogDebug('paused_workouts table does not exist yet - migration not run')
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
export async function getPausedWorkoutFromSupabase(userId) {
  try {
    const { data, error } = await supabase
      .from('paused_workouts')
      .select('*')
      .eq('user_id', userId)
      .single()

    if (error && error.code === 'PGRST116') {
      // No paused workout found
      return null
    }
    // If table doesn't exist (migration not run), return null gracefully
    if (error && (error.code === 'PGRST205' || error.message?.includes('Could not find the table'))) {
      safeLogDebug('paused_workouts table does not exist yet - migration not run')
      return null
    }
    if (error) throw error

    if (data) {
      return {
        ...data,
        exercises: JSON.parse(data.exercises || '[]')
      }
    }
    return null
  } catch (error) {
    // If table doesn't exist, return null gracefully
    if (error.code === 'PGRST205' || error.message?.includes('Could not find the table')) {
      safeLogDebug('paused_workouts table does not exist yet - migration not run')
      return null
    }
    throw error
  }
}

/**
 * Delete paused workout (called when workout is finished or resumed)
 */
export async function deletePausedWorkoutFromSupabase(userId) {
  try {
    const { error } = await supabase
      .from('paused_workouts')
      .delete()
      .eq('user_id', userId)

    // If table doesn't exist, silently succeed (migration not run)
    if (error && (error.code === 'PGRST205' || error.message?.includes('Could not find the table'))) {
      safeLogDebug('paused_workouts table does not exist yet - migration not run')
      return
    }
    if (error) throw error
  } catch (error) {
    // If table doesn't exist, silently succeed
    if (error.code === 'PGRST205' || error.message?.includes('Could not find the table')) {
      safeLogDebug('paused_workouts table does not exist yet - migration not run')
      return
    }
    throw error
  }
}

export async function getWorkoutsByDateFromSupabase(userId, date) {
  // Use getWorkoutsFromSupabase to get filtered workouts, then filter by date
  const workouts = await getWorkoutsFromSupabase(userId)
  return workouts.filter(w => w.date === date)
}

export async function updateWorkoutInSupabase(workoutId, workout, userId) {
  // Allow workouts with 0 exercises (user may want to log a workout session without exercises)
  // Only validate that exercises is an array if it exists
  if (workout.exercises !== undefined && workout.exercises !== null && !Array.isArray(workout.exercises)) {
    throw new Error('Workout exercises must be an array')
  }
  
  // If exercises exist, ensure they have valid structure (but allow empty array)
  if (workout.exercises && workout.exercises.length > 0) {
    // Validate exercise structure if exercises are provided
    const hasInvalidExercise = workout.exercises.some(ex => 
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
      updated_at: new Date().toISOString()
    })
    .eq('id', workoutId)
    .eq('user_id', userId) // Additional security: ensure user_id matches

  if (workoutError) throw workoutError

  // Delete existing exercises and sets
  const { data: exercises } = await supabase
    .from('workout_exercises')
    .select('id')
    .eq('workout_id', workoutId)

  if (exercises) {
    for (const ex of exercises) {
      await supabase.from('workout_sets').delete().eq('workout_exercise_id', ex.id)
    }
    await supabase.from('workout_exercises').delete().eq('workout_id', workoutId)
  }

  // Insert new exercises (only those with valid sets data)
  let exerciseOrder = 0
  for (let i = 0; i < workout.exercises.length; i++) {
    const ex = workout.exercises[i]
    
    // Skip exercises without valid sets data (prevent dummy data)
    if (!ex.sets || ex.sets.length === 0 || !ex.sets.some(s => s.weight || s.reps || s.time)) {
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

    // Insert sets (only sets with actual data)
    const validSets = ex.sets.filter(s => s.weight || s.reps || s.time)
    if (validSets.length > 0) {
      const setsToInsert = validSets.map((set, idx) => ({
        workout_exercise_id: exerciseData.id,
        set_number: idx + 1,
        weight: set.weight ? Number(set.weight) : null,
        reps: set.reps ? Number(set.reps) : null,
        time: set.time || null,
        speed: set.speed ? Number(set.speed) : null,
        incline: set.incline ? Number(set.incline) : null
      }))

      const { error: setsError } = await supabase
        .from('workout_sets')
        .insert(setsToInsert)

      if (setsError) throw setsError
    }
  }
}

export async function deleteWorkoutFromSupabase(workoutId, userId = null) {
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

export async function deleteAllWorkoutsFromSupabase(userId) {
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
export async function cleanupDuplicateWorkouts(userId) {
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
    const hasValidExercise = workout.workout_exercises?.some(ex => {
      if (!ex.workout_sets || ex.workout_sets.length === 0) return false
      return ex.workout_sets.some(s => s.weight || s.reps || s.time)
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
  const validWorkouts = allWorkouts.filter(w => {
    const hasValidExercise = w.workout_exercises?.some(ex => {
      if (!ex.workout_sets || ex.workout_sets.length === 0) return false
      return ex.workout_sets.some(s => s.weight || s.reps || s.time)
    })
    return hasValidExercise
  })
  
  const dateGroups = {}
  validWorkouts.forEach(w => {
    if (!dateGroups[w.date]) {
      dateGroups[w.date] = []
    }
    dateGroups[w.date].push(w)
  })
  
  // For each date with multiple workouts, keep only the most recent
  for (const [date, dateWorkouts] of Object.entries(dateGroups)) {
    if (dateWorkouts.length > 1) {
      // Sort by created_at (most recent first)
      dateWorkouts.sort((a, b) => {
        const aTime = a.created_at ? new Date(a.created_at).getTime() : 0
        const bTime = b.created_at ? new Date(b.created_at).getTime() : 0
        return bTime - aTime
      })
      
      // Keep the first (most recent), delete the rest
      const duplicates = dateWorkouts.slice(1)
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

export async function saveMetricsToSupabase(userId, date, metrics) {
  safeLogDebug('saveMetricsToSupabase called with:', { userId, date, metrics })
  
  // Data pipeline: Validate -> Clean -> Save -> Enrich
  
  // Step 1: Validate data
  let validation = { valid: true, errors: [] }
  try {
    const validationModule = await import('./dataValidation')
    const { validateHealthMetrics } = validationModule || {}
    if (validateHealthMetrics && typeof validateHealthMetrics === 'function') {
      validation = validateHealthMetrics({ ...metrics, date })
      if (!validation.valid) {
        logError('Health metrics validation failed', validation.errors)
        throw new Error(`Health metrics validation failed: ${validation.errors.join(', ')}`)
      }
    } else {
      logError('validateHealthMetrics is not a function', { validationModule })
      // Continue without validation if function is not available
    }
  } catch (validationError) {
    logError('Error importing or calling validateHealthMetrics', validationError)
    // Continue without validation if import fails
  }
  
  // Step 2: Clean and normalize data
  let cleanedMetrics = metrics
  try {
    const cleaningModule = await import('./dataCleaning')
    const { cleanHealthMetricsData } = cleaningModule || {}
    if (cleanHealthMetricsData && typeof cleanHealthMetricsData === 'function') {
      cleanedMetrics = cleanHealthMetricsData(metrics)
    } else {
      logError('cleanHealthMetricsData is not a function', { cleaningModule })
      // Use original metrics if cleaning function is not available
    }
  } catch (cleaningError) {
    logError('Error importing or calling cleanHealthMetricsData', cleaningError)
    // Use original metrics if import fails
  }
  
  // Validate that we have at least one metric value (after cleaning)
  const hasData = Object.values(cleanedMetrics).some(val => val !== null && val !== undefined && val !== '')
  if (!hasData) {
    throw new Error('Cannot save metrics with no data')
  }
  
  // Track event
  trackEvent('health_metrics_saved', {
    category: 'health',
    action: 'save',
    properties: {
      metrics_count: Object.values(cleanedMetrics).filter(v => v !== null && v !== undefined).length
    }
  })
  
  // Use cleaned metrics from here on
  const metricsToSave = cleanedMetrics
  
  // Map to health_metrics table structure
  const healthMetricsData = {
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
    
    // Step 3: Enrich data (after saving)
    try {
      const savedMetric = Array.isArray(data) ? data[0] : data
      if (savedMetric) {
        await saveEnrichedData('health', savedMetric, userId)
      }
    } catch (enrichError) {
      // Don't fail the save if enrichment fails
      logError('Error enriching health metrics data', enrichError)
    }
    
    // Update health goals based on the saved metrics (non-blocking)
    try {
      const { updateCategoryGoals } = await import('./goalsDb')
      updateCategoryGoals(userId, 'health').catch(error => {
        logError('Error updating health goals after metrics save', error)
      })
    } catch (error) {
      // Silently fail - goal updates shouldn't block metrics saves
      logError('Error importing goalsDb for metrics goal update', error)
    }
    
    return data
  } catch (err) {
    logError('saveMetricsToSupabase: Error', err)
    throw err
  }
}

export async function getMetricsFromSupabase(userId, startDate, endDate) {
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

export async function getAllMetricsFromSupabase(userId) {
  const { data, error } = await supabase
    .from('health_metrics')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: true })

  if (error) throw error
  return data
}

// ============ SCHEDULED WORKOUTS ============

export async function scheduleWorkoutSupabase(userId, date, templateId) {
  const { data, error } = await supabase
    .from('scheduled_workouts')
    .upsert({
      user_id: userId,
      date: date,
      template_id: templateId
    }, { onConflict: 'user_id,date' })
    .select()

  if (error) throw error
  return data
}

export async function getScheduledWorkoutsFromSupabase(userId) {
  const { data, error } = await supabase
    .from('scheduled_workouts')
    .select('*')
    .eq('user_id', userId)
    .gte('date', new Date().toISOString().split('T')[0])
    .order('date', { ascending: true })

  if (error) throw error
  return data
}

export async function getScheduledWorkoutByDateFromSupabase(userId, date) {
  const { data, error } = await supabase
    .from('scheduled_workouts')
    .select('*')
    .eq('user_id', userId)
    .eq('date', date)
    .single()

  if (error && error.code !== 'PGRST116') throw error // PGRST116 is "not found" which is OK
  return data
}

// ============ ANALYTICS ============

export async function getBodyPartStats(userId) {
  // Get all workouts with exercises (already filtered by getWorkoutsFromSupabase)
  const workouts = await getWorkoutsFromSupabase(userId)
  const bodyPartCounts = {}
  
  safeLogDebug('getBodyPartStats - workouts', workouts.length)
  
  workouts.forEach(w => {
    w.workout_exercises?.forEach(ex => {
      // ONLY count exercises with valid sets data (double-check)
      const hasValidSets = ex.workout_sets && ex.workout_sets.length > 0 && 
        ex.workout_sets.some(s => s.weight || s.reps || s.time)
      
      if (!hasValidSets) return
      
      const bp = ex.body_part || 'Other'
      safeLogDebug('Exercise body part', { exercise: ex.exercise_name, bodyPart: bp })
      bodyPartCounts[bp] = (bodyPartCounts[bp] || 0) + 1
    })
  })
  
  safeLogDebug('Body part counts', bodyPartCounts)
  return bodyPartCounts
}

export async function calculateStreakFromSupabase(userId) {
  const dates = await getWorkoutDatesFromSupabase(userId)
  if (dates.length === 0) return 0

  const sortedDates = dates.sort((a, b) => new Date(b) - new Date(a))
  const today = getTodayEST()
  const yesterday = getYesterdayEST()

  if (sortedDates[0] !== today && sortedDates[0] !== yesterday) {
    return 0
  }

  let streak = 1
  for (let i = 1; i < sortedDates.length; i++) {
    const current = new Date(sortedDates[i - 1])
    const prev = new Date(sortedDates[i])
    const diffDays = (current - prev) / 86400000

    if (diffDays === 1) {
      streak++
    } else {
      break
    }
  }

  return streak
}

export async function getWorkoutFrequency(userId, days = 30) {
  // Use getWorkoutsFromSupabase to get filtered workouts (no dummy data)
  const workouts = await getWorkoutsFromSupabase(userId)
  const startDate = new Date(Date.now() - days * 86400000).toISOString().split('T')[0]
  
  // Group by date (only valid workouts)
  const frequency = {}
  workouts.forEach(w => {
    if (w.date >= startDate) {
      frequency[w.date] = (frequency[w.date] || 0) + 1
    }
  })
  
  return frequency
}

export async function getExerciseStats(userId) {
  const workouts = await getWorkoutsFromSupabase(userId)
  const exerciseCounts = {}
  
  workouts.forEach(w => {
    w.workout_exercises?.forEach(ex => {
      // ONLY count exercises that have actual sets with data (no dummy data)
      const hasValidSets = ex.workout_sets && ex.workout_sets.length > 0 && 
        ex.workout_sets.some(s => s.weight || s.reps || s.time)
      
      if (hasValidSets && ex.exercise_name) {
        exerciseCounts[ex.exercise_name] = (exerciseCounts[ex.exercise_name] || 0) + 1
      }
    })
  })
  
  // Sort by count
  const sorted = Object.entries(exerciseCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
  
  return sorted
}

// ============ USER PREFERENCES ============

export async function getUserPreferences(userId) {
  const { data, error } = await supabase
    .from('user_preferences')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (error && error.code !== 'PGRST116') throw error
  return data
}

export async function saveUserPreferences(userId, prefs) {
  // Build the upsert object, only including fields that exist
  const upsertData = {
    user_id: userId,
    plan_name: prefs.planName || null,
    fitness_goal: prefs.fitnessGoal,
    experience_level: prefs.experienceLevel,
    available_days: prefs.availableDays,
    session_duration: prefs.sessionDuration,
    // New profile fields
    date_of_birth: prefs.dateOfBirth || null,
    gender: prefs.gender || null,
    height_inches: prefs.heightInches || null,
    height_feet: prefs.heightFeet || null,
    equipment_available: prefs.equipmentAvailable,
    injuries: prefs.injuries,
    updated_at: new Date().toISOString()
  }
  
  // Only include username if provided (column may not exist yet)
  if (prefs.username !== undefined) {
    upsertData.username = prefs.username || null
  }
  
  // Only include profile_picture if provided (column may not exist yet)
  if (prefs.profilePicture !== undefined) {
    upsertData.profile_picture = prefs.profilePicture || null
  }
  
  // Only include onboarding_completed if provided (column may not exist yet)
  if (prefs.onboarding_completed !== undefined) {
    upsertData.onboarding_completed = prefs.onboarding_completed || false
  }
  
  const { data, error } = await supabase
    .from('user_preferences')
    .upsert(upsertData, { onConflict: 'user_id' })
    .select()

  // If error is about missing columns, try without them
  if (error && (error.message?.includes('profile_picture') || error.message?.includes('username'))) {
    // Remove the problematic fields and try again
    delete upsertData.username
    delete upsertData.profile_picture
    
    const { data: retryData, error: retryError } = await supabase
      .from('user_preferences')
      .upsert(upsertData, { onConflict: 'user_id' })
      .select()
    
    if (retryError) throw retryError
    
    // Warn user about missing columns
    console.warn('Profile columns (username/profile_picture) not found. Please run the migration: app/supabase_migrations_user_profile.sql')
    return retryData
  }

  if (error) throw error
  return data
}

// ============ WORKOUT PLAN GENERATOR ============
// NOTE: This function ONLY generates a plan structure. It NEVER creates actual workout logs.
// Workouts are ONLY created when the user explicitly finishes a workout in ActiveWorkout.jsx

export function generateWorkoutPlan(prefs, templates) {
  const { fitnessGoal, experienceLevel, availableDays, sessionDuration } = prefs
  
  // Determine split based on days available
  const daysPerWeek = availableDays.length
  let split = []
  
  if (daysPerWeek <= 2) {
    split = ['Full Body', 'Full Body']
  } else if (daysPerWeek === 3) {
    if (fitnessGoal === 'strength' || fitnessGoal === 'hypertrophy') {
      split = ['Push', 'Pull', 'Legs']
    } else {
      split = ['Full Body', 'Cardio + Core', 'Full Body']
    }
  } else if (daysPerWeek === 4) {
    split = ['Upper', 'Lower', 'Upper', 'Lower']
  } else if (daysPerWeek === 5) {
    split = ['Push', 'Pull', 'Legs', 'Upper', 'Lower']
  } else {
    split = ['Push', 'Pull', 'Legs', 'Push', 'Pull', 'Legs']
  }

  // Map exercises based on focus
  const exercisesByFocus = {
    'Push': ['Bench Press', 'Overhead Press', 'Incline Dumbbell Press', 'Tricep Pushdowns', 'Lateral Raises', 'Chest Flyes'],
    'Pull': ['Deadlift', 'Barbell Rows', 'Pull-ups', 'Face Pulls', 'Bicep Curls', 'Lat Pulldowns'],
    'Legs': ['Squats', 'Romanian Deadlift', 'Leg Press', 'Leg Curls', 'Calf Raises', 'Lunges'],
    'Upper': ['Bench Press', 'Barbell Rows', 'Overhead Press', 'Pull-ups', 'Bicep Curls', 'Tricep Pushdowns'],
    'Lower': ['Squats', 'Romanian Deadlift', 'Leg Press', 'Leg Curls', 'Hip Thrusts', 'Calf Raises'],
    'Full Body': ['Squats', 'Bench Press', 'Barbell Rows', 'Overhead Press', 'Deadlift', 'Core Work'],
    'Cardio + Core': ['Treadmill Run', 'Planks', 'Russian Twists', 'Mountain Climbers', 'Bicycle Crunches']
  }

  // Adjust volume based on experience
  const setsPerExercise = experienceLevel === 'beginner' ? 3 : experienceLevel === 'intermediate' ? 4 : 5
  
  // Build schedule
  const schedule = availableDays.map((day, idx) => {
    const focus = split[idx % split.length]
    const exercises = exercisesByFocus[focus] || []
    
    // Adjust exercise count based on session duration
    const exerciseCount = Math.min(exercises.length, Math.floor(sessionDuration / 10))
    
    return {
      day,
      focus,
      exercises: exercises.slice(0, exerciseCount),
      sets: setsPerExercise,
      restDay: false
    }
  })

  // Add rest days
  const allDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  const restDays = allDays.filter(d => !availableDays.includes(d))
  
  const fullSchedule = allDays.map(day => {
    const workoutDay = schedule.find(s => s.day === day)
    if (workoutDay) return workoutDay
    return { day, focus: 'Rest', restDay: true }
  })

  return {
    daysPerWeek,
    goal: fitnessGoal,
    experience: experienceLevel,
    schedule: fullSchedule
  }
}

export async function getDetailedBodyPartStats(userId) {
  const workouts = await getWorkoutsFromSupabase(userId)
  const stats = {}
  
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
  workouts.forEach(w => {
    w.workout_exercises?.forEach(ex => {
      // ONLY count exercises with valid sets data (double-check)
      const hasValidSets = ex.workout_sets && ex.workout_sets.length > 0 && 
        ex.workout_sets.some(s => s.weight || s.reps || s.time)
      
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
  bodyParts.forEach(bp => {
    const s = stats[bp]
    
    // Last trained (most recent date)
    if (s.dates.length > 0) {
      s.lastTrained = s.dates.sort((a, b) => new Date(b) - new Date(a))[0]
    }
    
    // Top exercise
    const exercises = Object.entries(s.exerciseCounts)
    if (exercises.length > 0) {
      exercises.sort((a, b) => b[1] - a[1])
      s.topExercise = exercises[0][0]
    }
    
    // Average per week (based on date range of all workouts)
    if (workouts.length > 0 && s.dates.length > 0) {
      const allDates = workouts.map(w => w.date).sort()
      const firstDate = new Date(allDates[0])
      const lastDate = new Date(allDates[allDates.length - 1])
      const weeks = Math.max(1, (lastDate - firstDate) / (7 * 86400000))
      s.avgPerWeek = s.dates.length / weeks
    }
    
    // Clean up
    delete s.exerciseCounts
    delete s.dates
  })
  
  return stats
}

// ============ FEED ITEMS ============

/**
 * Save a feed item to the database
 */
export async function saveFeedItemToSupabase(feedItem, userId) {
  try {
    const { data, error } = await supabase
      .from('feed_items')
      .insert({
        user_id: userId,
        type: feedItem.type,
        date: feedItem.date,
        title: feedItem.title,
        subtitle: feedItem.subtitle || null,
        data: feedItem.data,
        shared: feedItem.shared !== false, // Default to true
        visibility: feedItem.visibility || 'public' // Default to public
      })
      .select()
      .single()

    if (error) throw error
    return data
  } catch (error) {
    // If table doesn't exist (migration not run), return null gracefully
    if (error.code === 'PGRST205' || error.message?.includes('Could not find the table')) {
      safeLogDebug('feed_items table does not exist yet - migration not run')
      return null
    }
    throw error
  }
}

/**
 * Get feed items for a user (own items only)
 */
export async function getFeedItemsFromSupabase(userId, limit = 50) {
  try {
    const { data, error } = await supabase
      .from('feed_items')
      .select('*')
      .eq('user_id', userId)
      .eq('shared', true)
      .order('created_at', { ascending: false })
      .limit(limit)

    // If table doesn't exist (migration not run), return empty array gracefully
    if (error && (error.code === 'PGRST205' || error.message?.includes('Could not find the table'))) {
      safeLogDebug('feed_items table does not exist yet - migration not run')
      return []
    }
    if (error) throw error
    return data || []
  } catch (error) {
    // If table doesn't exist, return empty array
    if (error.code === 'PGRST205' || error.message?.includes('Could not find the table')) {
      safeLogDebug('feed_items table does not exist yet - migration not run')
      return []
    }
    throw error
  }
}

/**
 * Get feed items - OPTIMIZED: Single queries with JOINs, efficient friend lookups
 * Display them in Twitter-like feed format
 * @param {string} userId - Current user ID
 * @param {string} filter - 'all', 'me', or 'friends'
 * @param {number} limit - Maximum items to return (default: 20 for pagination)
 * @param {string} cursor - Optional cursor for pagination (created_at timestamp)
 */
export async function getSocialFeedItems(userId, filter = 'all', limit = 20, cursor = null) {
  try {
    // Get friend IDs efficiently (single query for both directions)
    let friendIds = []
    if (filter === 'friends') {
      try {
        // Use optimized query that checks both user_id and friend_id in one go
        const { data: friends, error: friendError } = await supabase
          .from('friends')
          .select('user_id, friend_id')
          .or(`user_id.eq.${userId},friend_id.eq.${userId}`)
          .eq('status', 'accepted')
        
        if (friendError) {
          logError('Error loading friends for feed', friendError)
          return []
        }
        
        // Extract friend IDs (both directions)
        friendIds = (friends || []).map(f => 
          f.user_id === userId ? f.friend_id : f.user_id
        ).filter(id => id !== userId)
        
        if (friendIds.length === 0) {
          return [] // No friends, return empty
        }
      } catch (friendError) {
        logError('Error loading friends for feed', friendError)
        return []
      }
    }

    // Build feed items query with user profiles JOIN
    let feedItemsQuery = supabase
      .from('feed_items')
      .select(`
        *,
        user_profiles!feed_items_user_id_fkey (
          user_id,
          username,
          display_name,
          profile_picture
        )
      `)
      .eq('shared', true)
      .order('created_at', { ascending: false })
    
    // Apply filter
    if (filter === 'me') {
      feedItemsQuery = feedItemsQuery.eq('user_id', userId)
    } else if (filter === 'friends') {
      feedItemsQuery = feedItemsQuery.in('user_id', friendIds)
        .in('visibility', ['public', 'friends'])
    } else if (filter === 'all') {
      // Show user's own items and public items from others
      feedItemsQuery = feedItemsQuery.or(`user_id.eq.${userId},visibility.eq.public`)
    }
    
    // Add pagination cursor if provided
    if (cursor) {
      feedItemsQuery = feedItemsQuery.lt('created_at', cursor)
    }
    
    feedItemsQuery = feedItemsQuery.limit(limit)
    
    const { data: feedItems, error: feedItemsError } = await feedItemsQuery
    
    if (feedItemsError && feedItemsError.code !== 'PGRST205') {
      logError('Feed items query error', feedItemsError)
      return []
    }
    
    // Build workout query with user profiles JOIN
    let workoutQuery = supabase
      .from('workouts')
      .select(`
        *,
        workout_exercises (
          *,
          workout_sets (*)
        ),
        user_profiles!workouts_user_id_fkey (
          user_id,
          username,
          display_name,
          profile_picture
        )
      `)
      .order('created_at', { ascending: false })

    // Apply filter
    if (filter === 'me') {
      workoutQuery = workoutQuery.eq('user_id', userId)
    } else if (filter === 'friends') {
      workoutQuery = workoutQuery.in('user_id', friendIds)
    } else if (filter === 'all') {
      workoutQuery = workoutQuery.eq('user_id', userId) // For now, only own workouts
    }
    
    // Add pagination cursor if provided
    if (cursor) {
      workoutQuery = workoutQuery.lt('created_at', cursor)
    }
    
    workoutQuery = workoutQuery.limit(limit)

    const { data: workouts, error: workoutError } = await workoutQuery

    if (workoutError) {
      logError('Error loading workouts for feed', workoutError)
      // Continue with feed items only
    }

    // Process user profiles from JOIN results
    const userProfiles = {}
    if (feedItems) {
      feedItems.forEach(item => {
        if (item.user_profiles) {
          userProfiles[item.user_id] = item.user_profiles
        }
      })
    }
    if (workouts) {
      workouts.forEach(workout => {
        if (workout.user_profiles) {
          userProfiles[workout.user_id] = workout.user_profiles
        }
      })
    }
    
    // Transform feed items (nutrition, health, manually shared workouts)
    const transformedFeedItems = (feedItems || []).map(item => ({
      id: item.id,
      user_id: item.user_id,
      type: item.type,
      date: item.date,
      title: item.title,
      subtitle: item.subtitle,
      data: item.data || (item.type === 'workout' ? { workout: {} } : item.type === 'nutrition' ? { nutrition: {} } : { health: {} }),
      shared: item.shared,
      visibility: item.visibility || 'public',
      created_at: item.created_at,
      user_profiles: item.user_profiles || userProfiles[item.user_id] || null
    }))
    
    // Transform workouts to feed item format
    const workoutFeedItems = workouts
      .filter(workout => {
        // Only include workouts with valid data
        if (!workout || !workout.user_id || !workout.date || !workout.created_at) {
          return false
        }
        // Must have exercises with sets
        if (!workout.workout_exercises || workout.workout_exercises.length === 0) {
          return false
        }
        // Must have at least one exercise with valid sets
        const hasValidSets = workout.workout_exercises.some(ex => 
          ex.workout_sets && ex.workout_sets.length > 0 && 
          ex.workout_sets.some(s => s.weight || s.reps || s.time)
        )
        if (!hasValidSets) {
          return false
        }
        return hasValidSets
      })
      .map(workout => {
        // Transform workout_exercises to exercises format for ShareCard
        const exercises = (workout.workout_exercises || []).map(ex => ({
          id: ex.id,
          name: ex.exercise_name || ex.name,
          category: ex.category,
          bodyPart: ex.body_part || ex.bodyPart,
          equipment: ex.equipment,
          stacked: ex.stacked || false,
          stackGroup: ex.stack_group || ex.stackGroup || null,
          sets: (ex.workout_sets || []).map(set => ({
            weight: set.weight,
            reps: set.reps,
            time: set.time,
            speed: set.speed,
            incline: set.incline
          }))
        }))

        const minutes = Math.floor((workout.duration || 0) / 60)
        const seconds = (workout.duration || 0) % 60

        return {
          id: `workout_${workout.id}`,
          user_id: workout.user_id,
          type: 'workout',
          date: workout.date,
          title: workout.template_name || 'Freestyle Workout',
          subtitle: `${minutes}:${String(seconds).padStart(2, '0')}`,
          data: {
            workout: {
              id: workout.id,
              date: workout.date,
              duration: workout.duration || 0,
              exercises: exercises,
              templateName: workout.template_name || 'Freestyle Workout',
              perceivedEffort: workout.perceived_effort,
              moodAfter: workout.mood_after,
              notes: workout.notes
            }
          },
          shared: true,
          visibility: 'public',
          created_at: workout.created_at,
          user_profiles: workout.user_profiles || userProfiles[workout.user_id] || null
        }
      })

    // Combine feed items and workout items, then sort by created_at
    const allFeedItems = [...transformedFeedItems, ...workoutFeedItems]
      .sort((a, b) => {
        const aTime = a.created_at ? new Date(a.created_at).getTime() : 0
        const bTime = b.created_at ? new Date(b.created_at).getTime() : 0
        return bTime - aTime
      })
      .slice(0, limit)
    
    return allFeedItems
  } catch (error) {
    logError('Error in getSocialFeedItems', error)
    // If table doesn't exist, return empty array
    if (error.code === 'PGRST205' || error.message?.includes('Could not find the table')) {
      safeLogDebug('Tables do not exist yet - migration not run')
      return []
    }
    return []
  }
}

// ============ ACTIVE WORKOUT SESSIONS ============

/**
 * Save or update active workout session (timer state)
 */
export async function saveActiveWorkoutSession(userId, sessionData) {
  try {
    const sessionPayload = {
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
  } catch (error) {
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
export async function getActiveWorkoutSession(userId) {
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
  } catch (error) {
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
export async function deleteActiveWorkoutSession(userId) {
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
  } catch (error) {
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
// ============ MATERIALIZED VIEWS ============

/**
 * Get daily workout summaries from materialized view
 */
export async function getDailyWorkoutSummaries(userId, startDate = null, endDate = null) {
  try {
    let query = supabase
      .from('daily_workout_summaries')
      .select('*')
      .eq('user_id', userId)
      .order('date', { ascending: false })
    
    if (startDate) {
      query = query.gte('date', startDate)
    }
    if (endDate) {
      query = query.lte('date', endDate)
    }
    
    const { data, error } = await query
    
    // If view doesn't exist, return empty array gracefully
    if (error && (error.code === 'PGRST205' || error.message?.includes('Could not find the table'))) {
      safeLogDebug('daily_workout_summaries view does not exist yet - migration not run')
      return []
    }
    if (error) throw error
    return data || []
  } catch (error) {
    if (error.code === 'PGRST205' || error.message?.includes('Could not find the table')) {
      safeLogDebug('daily_workout_summaries view does not exist yet - migration not run')
      return []
    }
    throw error
  }
}

/**
 * Get weekly workout summaries from materialized view
 */
export async function getWeeklyWorkoutSummaries(userId, startDate = null, endDate = null) {
  try {
    let query = supabase
      .from('weekly_workout_summaries')
      .select('*')
      .eq('user_id', userId)
      .order('week_start', { ascending: false })
    
    if (startDate) {
      query = query.gte('week_start', startDate)
    }
    if (endDate) {
      query = query.lte('week_start', endDate)
    }
    
    const { data, error } = await query
    
    if (error && (error.code === 'PGRST205' || error.message?.includes('Could not find the table'))) {
      safeLogDebug('weekly_workout_summaries view does not exist yet - migration not run')
      return []
    }
    if (error) throw error
    return data || []
  } catch (error) {
    if (error.code === 'PGRST205' || error.message?.includes('Could not find the table')) {
      safeLogDebug('weekly_workout_summaries view does not exist yet - migration not run')
      return []
    }
    throw error
  }
}

/**
 * Get monthly workout summaries from materialized view
 */
export async function getMonthlyWorkoutSummaries(userId, startDate = null, endDate = null) {
  try {
    let query = supabase
      .from('monthly_workout_summaries')
      .select('*')
      .eq('user_id', userId)
      .order('month_start', { ascending: false })
    
    if (startDate) {
      query = query.gte('month_start', startDate)
    }
    if (endDate) {
      query = query.lte('month_start', endDate)
    }
    
    const { data, error } = await query
    
    if (error && (error.code === 'PGRST205' || error.message?.includes('Could not find the table'))) {
      safeLogDebug('monthly_workout_summaries view does not exist yet - migration not run')
      return []
    }
    if (error) throw error
    return data || []
  } catch (error) {
    if (error.code === 'PGRST205' || error.message?.includes('Could not find the table')) {
      safeLogDebug('monthly_workout_summaries view does not exist yet - migration not run')
      return []
    }
    throw error
  }
}

/**
 * Get daily health summaries from materialized view
 */
export async function getDailyHealthSummaries(userId, startDate = null, endDate = null) {
  try {
    let query = supabase
      .from('daily_health_summaries')
      .select('*')
      .eq('user_id', userId)
      .order('date', { ascending: false })
    
    if (startDate) {
      query = query.gte('date', startDate)
    }
    if (endDate) {
      query = query.lte('date', endDate)
    }
    
    const { data, error } = await query
    
    if (error && (error.code === 'PGRST205' || error.message?.includes('Could not find the table'))) {
      safeLogDebug('daily_health_summaries view does not exist yet - migration not run')
      return []
    }
    if (error) throw error
    return data || []
  } catch (error) {
    if (error.code === 'PGRST205' || error.message?.includes('Could not find the table')) {
      safeLogDebug('daily_health_summaries view does not exist yet - migration not run')
      return []
    }
    throw error
  }
}

/**
 * Get weekly health summaries from materialized view
 */
export async function getWeeklyHealthSummaries(userId, startDate = null, endDate = null) {
  try {
    let query = supabase
      .from('weekly_health_summaries')
      .select('*')
      .eq('user_id', userId)
      .order('week_start', { ascending: false })
    
    if (startDate) {
      query = query.gte('week_start', startDate)
    }
    if (endDate) {
      query = query.lte('week_start', endDate)
    }
    
    const { data, error } = await query
    
    if (error && (error.code === 'PGRST205' || error.message?.includes('Could not find the table'))) {
      safeLogDebug('weekly_health_summaries view does not exist yet - migration not run')
      return []
    }
    if (error) throw error
    return data || []
  } catch (error) {
    if (error.code === 'PGRST205' || error.message?.includes('Could not find the table')) {
      safeLogDebug('weekly_health_summaries view does not exist yet - migration not run')
      return []
    }
    throw error
  }
}

/**
 * Get daily nutrition summaries from materialized view
 */
export async function getDailyNutritionSummaries(userId, startDate = null, endDate = null) {
  try {
    let query = supabase
      .from('daily_nutrition_summaries')
      .select('*')
      .eq('user_id', userId)
      .order('date', { ascending: false })
    
    if (startDate) {
      query = query.gte('date', startDate)
    }
    if (endDate) {
      query = query.lte('date', endDate)
    }
    
    const { data, error } = await query
    
    if (error && (error.code === 'PGRST205' || error.message?.includes('Could not find the table'))) {
      safeLogDebug('daily_nutrition_summaries view does not exist yet - migration not run')
      return []
    }
    if (error) throw error
    return data || []
  } catch (error) {
    if (error.code === 'PGRST205' || error.message?.includes('Could not find the table')) {
      safeLogDebug('daily_nutrition_summaries view does not exist yet - migration not run')
      return []
    }
    throw error
  }
}

// ============ ENGINEERED FEATURES ============

/**
 * Get engineered features for a user
 */
export async function getEngineeredFeatures(userId, featureType = null) {
  try {
    let query = supabase
      .from('engineered_features')
      .select('*')
      .eq('user_id', userId)
      .order('calculated_at', { ascending: false })
    
    if (featureType) {
      query = query.eq('feature_type', featureType)
    }
    
    const { data, error } = await query
    
    if (error && (error.code === 'PGRST205' || error.message?.includes('Could not find the table'))) {
      safeLogDebug('engineered_features table does not exist yet - migration not run')
      return []
    }
    if (error) throw error
    return data || []
  } catch (error) {
    if (error.code === 'PGRST205' || error.message?.includes('Could not find the table')) {
      safeLogDebug('engineered_features table does not exist yet - migration not run')
      return []
    }
    throw error
  }
}

// ============ USER EVENTS ============

/**
 * Get user events for analytics
 */
export async function getUserEvents(userId, startDate = null, endDate = null, eventName = null, limit = 1000) {
  try {
    let query = supabase
      .from('user_events')
      .select('*')
      .eq('user_id', userId)
      .order('timestamp', { ascending: false })
      .limit(limit)
    
    if (startDate) {
      query = query.gte('timestamp', startDate)
    }
    if (endDate) {
      query = query.lte('timestamp', endDate)
    }
    if (eventName) {
      query = query.eq('event_name', eventName)
    }
    
    const { data, error } = await query
    
    if (error && (error.code === 'PGRST205' || error.message?.includes('Could not find the table'))) {
      safeLogDebug('user_events table does not exist yet - migration not run')
      return []
    }
    if (error) throw error
    return data || []
  } catch (error) {
    if (error.code === 'PGRST205' || error.message?.includes('Could not find the table')) {
      safeLogDebug('user_events table does not exist yet - migration not run')
      return []
    }
    throw error
  }
}

/**
 * Get user event statistics
 */
export async function getUserEventStats(userId, days = 30) {
  try {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
    const events = await getUserEvents(userId, startDate, null, null, 10000)
    
    if (!events || events.length === 0) {
      return {
        totalEvents: 0,
        sessions: 0,
        mostUsedFeatures: [],
        dailyActivity: {}
      }
    }
    
    // Calculate stats
    const sessions = new Set(events.map(e => e.session_id)).size
    const featureUsage = {}
    const dailyActivity = {}
    
    events.forEach(event => {
      // Track feature usage
      if (event.event_category === 'feature' || event.event_name?.includes('_click')) {
        const feature = event.event_name || event.event_label || 'unknown'
        featureUsage[feature] = (featureUsage[feature] || 0) + 1
      }
      
      // Track daily activity
      const date = new Date(event.timestamp).toISOString().split('T')[0]
      dailyActivity[date] = (dailyActivity[date] || 0) + 1
    })
    
    const mostUsedFeatures = Object.entries(featureUsage)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }))
    
    return {
      totalEvents: events.length,
      sessions,
      mostUsedFeatures,
      dailyActivity
    }
  } catch (error) {
    logError('Error getting user event stats', error)
    return {
      totalEvents: 0,
      sessions: 0,
      mostUsedFeatures: [],
      dailyActivity: {}
    }
  }
}

export async function deleteFeedItemFromSupabase(feedItemId, userId) {
  try {
    const { error } = await supabase
      .from('feed_items')
      .delete()
      .eq('id', feedItemId)
      .eq('user_id', userId)

    // If table doesn't exist, silently succeed
    if (error && (error.code === 'PGRST205' || error.message?.includes('Could not find the table'))) {
      safeLogDebug('feed_items table does not exist yet - migration not run')
      return
    }
    if (error) throw error
  } catch (error) {
    // If table doesn't exist, silently succeed
    if (error.code === 'PGRST205' || error.message?.includes('Could not find the table')) {
      safeLogDebug('feed_items table does not exist yet - migration not run')
      return
    }
    throw error
  }
}
