import { supabase } from './supabase'
import { getTodayEST, getYesterdayEST } from '../utils/dateUtils'
import { toInteger, toNumber } from '../utils/numberUtils'
import { logError, logDebug } from '../utils/logger'

// Ensure logDebug is always available (fallback for build issues)
const safeLogDebug = logDebug || (() => {})

// ============ WORKOUTS ============
// IMPORTANT: Workouts are ONLY created through explicit user action (finishing a workout).
// This function is ONLY called from ActiveWorkout.jsx when the user finishes a workout.
// NEVER call this function automatically or with dummy/test data.

export async function saveWorkoutToSupabase(workout, userId) {
  // Validate that this is a real workout with exercises
  if (!workout.exercises || workout.exercises.length === 0) {
    throw new Error('Cannot save workout with no exercises')
  }
  
  // Validate that exercises have actual data (sets with weight/reps/time)
  const hasValidData = workout.exercises.some(ex => 
    ex.sets && ex.sets.length > 0 && ex.sets.some(s => s.weight || s.reps || s.time)
  )
  if (!hasValidData) {
    throw new Error('Cannot save workout with no exercise data')
  }
  
  // Check for duplicate workouts on the same date (prevent duplicates)
  const { data: existingWorkouts, error: checkError } = await supabase
    .from('workouts')
    .select('id, date, created_at')
    .eq('user_id', userId)
    .eq('date', workout.date)
    .order('created_at', { ascending: false })

  if (checkError) throw checkError

  let workoutData
  
  // If duplicates exist, delete the older ones and update the most recent
  if (existingWorkouts && existingWorkouts.length > 0) {
    const duplicates = existingWorkouts.slice(1) // Keep the first (most recent), delete the rest
    for (const dup of duplicates) {
      await deleteWorkoutFromSupabase(dup.id)
    }
    
    // Update the existing workout instead of creating a new one
    const existingId = existingWorkouts[0].id
    
    // Delete old exercises and sets for this workout
    const { data: oldExercises } = await supabase
      .from('workout_exercises')
      .select('id')
      .eq('workout_id', existingId)
    
    if (oldExercises) {
      for (const ex of oldExercises) {
        await supabase.from('workout_sets').delete().eq('workout_exercise_id', ex.id)
      }
      await supabase.from('workout_exercises').delete().eq('workout_id', existingId)
    }
    
    // Update the workout
    const { data: updatedWorkout, error: updateError } = await supabase
      .from('workouts')
      .update({
        duration: workout.duration,
        template_name: workout.templateName || null,
        perceived_effort: workout.perceivedEffort || null,
        mood_after: workout.moodAfter || null,
        notes: workout.notes || null,
        day_of_week: workout.dayOfWeek ?? null,
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
        date: workout.date,
        duration: workout.duration,
        template_name: workout.templateName || null,
        perceived_effort: workout.perceivedEffort || null,
        mood_after: workout.moodAfter || null,
        notes: workout.notes || null,
        day_of_week: workout.dayOfWeek ?? null
      })
      .select()
      .single()

    if (workoutError) throw workoutError
    workoutData = newWorkout
  }

  // Insert exercises (only those with valid sets data)
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
        workout_id: workoutData.id,
        exercise_name: ex.name,
        category: ex.category,
        body_part: ex.bodyPart,
        equipment: ex.equipment,
        exercise_order: exerciseOrder++,
        exercise_type: exerciseType,
        exercise_library_id: exerciseLibraryId,
        distance: ex.distance || null,
        distance_unit: ex.distanceUnit || 'km'
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
  
  // Filter out workouts without valid exercise data (dummy data cleanup)
  const validWorkouts = (data || []).filter(workout => {
    // Must have exercises
    if (!workout.workout_exercises || workout.workout_exercises.length === 0) {
      return false
    }
    
    // Must have at least one exercise with sets that have actual data
    const hasValidExercise = workout.workout_exercises.some(ex => {
      if (!ex.workout_sets || ex.workout_sets.length === 0) return false
      return ex.workout_sets.some(s => s.weight || s.reps || s.time)
    })
    
    return hasValidExercise
  })
  
  // Deduplicate by date (keep most recent) and auto-delete duplicates/invalid data
  const deduplicated = []
  const seenDates = new Set()
  const workoutsToDelete = []
  
  for (const workout of validWorkouts) {
    if (!seenDates.has(workout.date)) {
      seenDates.add(workout.date)
      deduplicated.push(workout)
    } else {
      // Found duplicate - mark for deletion (keep the one we already added)
      workoutsToDelete.push(workout.id)
    }
  }
  
  // Auto-delete duplicates in background (don't wait for it)
  if (workoutsToDelete.length > 0) {
    workoutsToDelete.forEach(workoutId => {
      deleteWorkoutFromSupabase(workoutId, userId).catch(err => {
        // Silently fail - cleanup is best effort
        safeLogDebug('Auto-cleanup: Failed to delete duplicate workout', workoutId)
      })
    })
  }
  
  // Also auto-delete invalid workouts in background
  const invalidWorkouts = (data || []).filter(workout => {
    if (!workout.workout_exercises || workout.workout_exercises.length === 0) {
      return true
    }
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
  
  return deduplicated
}

export async function getWorkoutDatesFromSupabase(userId) {
  // Use getWorkoutsFromSupabase to get filtered workouts (no dummy data)
  const workouts = await getWorkoutsFromSupabase(userId)
  return [...new Set(workouts.map(w => w.date))]
}

export async function getWorkoutsByDateFromSupabase(userId, date) {
  // Use getWorkoutsFromSupabase to get filtered workouts, then filter by date
  const workouts = await getWorkoutsFromSupabase(userId)
  return workouts.filter(w => w.date === date)
}

export async function updateWorkoutInSupabase(workoutId, workout, userId) {
  // Validate that this is a real workout with exercises (same validation as saveWorkoutToSupabase)
  if (!workout.exercises || workout.exercises.length === 0) {
    throw new Error('Cannot update workout with no exercises')
  }
  
  // Validate that exercises have actual data (sets with weight/reps/time)
  const hasValidData = workout.exercises.some(ex => 
    ex.sets && ex.sets.length > 0 && ex.sets.some(s => s.weight || s.reps || s.time)
  )
  if (!hasValidData) {
    throw new Error('Cannot update workout with no exercise data')
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
        distance_unit: ex.distanceUnit || 'km'
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
  
  // Validate that we have at least one metric value
  const hasData = Object.values(metrics).some(val => val !== null && val !== undefined && val !== '')
  if (!hasData) {
    throw new Error('Cannot save metrics with no data')
  }
  
  // Map to health_metrics table structure
  const healthMetricsData = {
    user_id: userId,
    date: date,
    sleep_score: toNumber(metrics.sleepScore),
    sleep_duration: toNumber(metrics.sleepTime), // Map sleepTime to sleep_duration
    hrv: toNumber(metrics.hrv),
    steps: toInteger(metrics.steps), // INTEGER column - must be whole number
    weight: toNumber(metrics.weight), // NUMERIC column - can be decimal
    calories_burned: toNumber(metrics.caloriesBurned),
    resting_heart_rate: toNumber(metrics.restingHeartRate),
    body_temp: toNumber(metrics.bodyTemp),
    body_fat_percentage: toNumber(metrics.bodyFatPercentage),
    breathing_rate: toNumber(metrics.breathingRate),
    spo2: toNumber(metrics.spo2),
    strain: toNumber(metrics.strain),
    source_provider: metrics.sourceProvider || 'manual',
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
