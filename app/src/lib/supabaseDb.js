import { supabase } from './supabase'

// ============ WORKOUTS ============

export async function saveWorkoutToSupabase(workout, userId) {
  // Insert workout
  const { data: workoutData, error: workoutError } = await supabase
    .from('workouts')
    .insert({
      user_id: userId,
      date: workout.date,
      duration: workout.duration
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

// ============ DAILY METRICS ============

export async function saveMetricsToSupabase(userId, date, metrics) {
  const { data, error } = await supabase
    .from('daily_metrics')
    .upsert({
      user_id: userId,
      date: date,
      sleep_score: metrics.sleepScore || null,
      sleep_time: metrics.sleepTime || null,
      hrv: metrics.hrv || null,
      steps: metrics.steps || null,
      calories: metrics.caloriesBurned || null,
      weight: metrics.weight || null
    }, { onConflict: 'user_id,date' })
    .select()

  if (error) throw error
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
  const { data, error } = await supabase
    .from('workout_exercises')
    .select('body_part, workout_id')
    .in('workout_id', 
      supabase.from('workouts').select('id').eq('user_id', userId)
    )

  if (error) {
    // Fallback: get all workouts first
    const workouts = await getWorkoutsFromSupabase(userId)
    const bodyPartCounts = {}
    
    workouts.forEach(w => {
      w.workout_exercises?.forEach(ex => {
        const bp = ex.body_part || 'Other'
        bodyPartCounts[bp] = (bodyPartCounts[bp] || 0) + 1
      })
    })
    
    return bodyPartCounts
  }

  const bodyPartCounts = {}
  data.forEach(ex => {
    const bp = ex.body_part || 'Other'
    bodyPartCounts[bp] = (bodyPartCounts[bp] || 0) + 1
  })
  
  return bodyPartCounts
}

export async function calculateStreakFromSupabase(userId) {
  const dates = await getWorkoutDatesFromSupabase(userId)
  if (dates.length === 0) return 0

  const sortedDates = dates.sort((a, b) => new Date(b) - new Date(a))
  const today = new Date().toISOString().split('T')[0]
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]

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
