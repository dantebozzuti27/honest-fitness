import { supabase } from './supabase'
import { getTodayEST, getYesterdayEST } from '../utils/dateUtils'

// ============ WORKOUTS ============

export async function saveWorkoutToSupabase(workout, userId) {
  // Insert workout
  const { data: workoutData, error: workoutError } = await supabase
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

  // Insert exercises
  for (let i = 0; i < workout.exercises.length; i++) {
    const ex = workout.exercises[i]
    
    const { data: exerciseData, error: exerciseError } = await supabase
      .from('workout_exercises')
      .insert({
        workout_id: workoutData.id,
        exercise_name: ex.name,
        category: ex.category,
        body_part: ex.bodyPart,
        equipment: ex.equipment,
        exercise_order: i
      })
      .select()
      .single()

    if (exerciseError) throw exerciseError

    // Insert sets
    if (ex.sets && ex.sets.length > 0) {
      const setsToInsert = ex.sets.map((set, idx) => ({
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
  return data
}

export async function getWorkoutDatesFromSupabase(userId) {
  const { data, error } = await supabase
    .from('workouts')
    .select('date')
    .eq('user_id', userId)

  if (error) throw error
  return [...new Set(data.map(w => w.date))]
}

export async function getWorkoutsByDateFromSupabase(userId, date) {
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
    .eq('date', date)

  if (error) throw error
  return data
}

export async function updateWorkoutInSupabase(workoutId, workout, userId) {
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
      day_of_week: workout.dayOfWeek ?? null
    })
    .eq('id', workoutId)

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

  // Insert new exercises
  for (let i = 0; i < workout.exercises.length; i++) {
    const ex = workout.exercises[i]
    
    const { data: exerciseData, error: exerciseError } = await supabase
      .from('workout_exercises')
      .insert({
        workout_id: workoutId,
        exercise_name: ex.name,
        category: ex.category,
        body_part: ex.bodyPart,
        equipment: ex.equipment,
        exercise_order: i
      })
      .select()
      .single()

    if (exerciseError) throw exerciseError

    // Insert sets
    if (ex.sets && ex.sets.length > 0) {
      const setsToInsert = ex.sets.map((set, idx) => ({
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

export async function deleteWorkoutFromSupabase(workoutId) {
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

  // Delete workout
  const { error } = await supabase.from('workouts').delete().eq('id', workoutId)
  if (error) throw error
}

// ============ DAILY METRICS ============

export async function saveMetricsToSupabase(userId, date, metrics) {
  console.log('saveMetricsToSupabase called with:', { userId, date, metrics })
  
  const metricsToSave = {
    user_id: userId,
    date: date,
    sleep_score: metrics.sleepScore !== null && metrics.sleepScore !== undefined && metrics.sleepScore !== '' ? Number(metrics.sleepScore) : null,
    sleep_time: metrics.sleepTime !== null && metrics.sleepTime !== undefined && metrics.sleepTime !== '' ? Number(metrics.sleepTime) : null,
    hrv: metrics.hrv !== null && metrics.hrv !== undefined && metrics.hrv !== '' ? Number(metrics.hrv) : null,
    steps: metrics.steps !== null && metrics.steps !== undefined && metrics.steps !== '' ? Number(metrics.steps) : null,
    calories: metrics.caloriesBurned !== null && metrics.caloriesBurned !== undefined && metrics.caloriesBurned !== '' ? Number(metrics.caloriesBurned) : null,
    weight: metrics.weight !== null && metrics.weight !== undefined && metrics.weight !== '' ? Number(metrics.weight) : null,
    resting_heart_rate: metrics.restingHeartRate !== null && metrics.restingHeartRate !== undefined && metrics.restingHeartRate !== '' ? Number(metrics.restingHeartRate) : null,
    body_temp: metrics.bodyTemp !== null && metrics.bodyTemp !== undefined && metrics.bodyTemp !== '' ? Number(metrics.bodyTemp) : null
  }
  
  console.log('saveMetricsToSupabase: Prepared data:', metricsToSave)
  
  const { data, error } = await supabase
    .from('daily_metrics')
    .upsert(metricsToSave, { onConflict: 'user_id,date' })
    .select()

  if (error) {
    console.error('saveMetricsToSupabase: Error from Supabase:', error)
    throw error
  }
  
  console.log('saveMetricsToSupabase: Success, returned data:', data)
  return data
}

export async function getMetricsFromSupabase(userId, startDate, endDate) {
  const { data, error } = await supabase
    .from('daily_metrics')
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
    .from('daily_metrics')
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
  // Get all workouts with exercises
  const workouts = await getWorkoutsFromSupabase(userId)
  const bodyPartCounts = {}
  
  console.log('getBodyPartStats - workouts:', workouts.length)
  
  workouts.forEach(w => {
    w.workout_exercises?.forEach(ex => {
      const bp = ex.body_part || 'Other'
      console.log('Exercise:', ex.exercise_name, 'Body part:', bp)
      bodyPartCounts[bp] = (bodyPartCounts[bp] || 0) + 1
    })
  })
  
  console.log('Body part counts:', bodyPartCounts)
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
  const startDate = new Date(Date.now() - days * 86400000).toISOString().split('T')[0]
  
  const { data, error } = await supabase
    .from('workouts')
    .select('date')
    .eq('user_id', userId)
    .gte('date', startDate)

  if (error) throw error
  
  // Group by date
  const frequency = {}
  data.forEach(w => {
    frequency[w.date] = (frequency[w.date] || 0) + 1
  })
  
  return frequency
}

export async function getExerciseStats(userId) {
  const workouts = await getWorkoutsFromSupabase(userId)
  const exerciseCounts = {}
  
  workouts.forEach(w => {
    w.workout_exercises?.forEach(ex => {
      exerciseCounts[ex.exercise_name] = (exerciseCounts[ex.exercise_name] || 0) + 1
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
  const { data, error } = await supabase
    .from('user_preferences')
    .upsert({
      user_id: userId,
      plan_name: prefs.planName || null,
      fitness_goal: prefs.fitnessGoal,
      experience_level: prefs.experienceLevel,
      available_days: prefs.availableDays,
      session_duration: prefs.sessionDuration,
      equipment_available: prefs.equipmentAvailable,
      injuries: prefs.injuries,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' })
    .select()

  if (error) throw error
  return data
}

// ============ WORKOUT PLAN GENERATOR ============

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
  
  // Process all workouts
  workouts.forEach(w => {
    w.workout_exercises?.forEach(ex => {
      const bp = ex.body_part || 'Other'
      if (!stats[bp]) return
      
      // Track dates
      if (!stats[bp].dates.includes(w.date)) {
        stats[bp].dates.push(w.date)
      }
      
      // Track exercise counts
      stats[bp].exerciseCounts[ex.exercise_name] = (stats[bp].exerciseCounts[ex.exercise_name] || 0) + 1
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
