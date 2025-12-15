import { supabase as supabaseClient, supabaseConfigErrorMessage } from './supabase'

// Avoid TypeError crashes when Supabase env is missing; throw a clear message at call time instead.
const supabase = supabaseClient ?? new Proxy({}, { get: () => { throw new Error(supabaseConfigErrorMessage) } })

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

export async function getWorkouts(userId) {
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

export async function getWorkoutsByDateRange(userId, startDate, endDate) {
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
    .gte('date', startDate)
    .lte('date', endDate)
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

// ============ DAILY METRICS ============

import { toInteger, toNumber } from '../utils/numberUtils'

export async function saveMetricsToSupabase(date, metrics, userId) {
  const { data, error } = await supabase
    .from('health_metrics')
    .upsert({
      user_id: userId,
      date,
      sleep_score: toNumber(metrics.sleepScore),
      sleep_duration: toNumber(metrics.sleepTime), // Map sleepTime to sleep_duration
      hrv: toNumber(metrics.hrv),
      steps: toInteger(metrics.steps), // INTEGER - must be whole number
      calories_burned: toNumber(metrics.caloriesBurned),
      weight: toNumber(metrics.weight),
      source_provider: 'manual',
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id,date' })
    .select()

  if (error) throw error
  return data
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

export async function getAllMetrics(userId) {
  const { data, error } = await supabase
    .from('health_metrics')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: true })

  if (error) throw error
  return data
}

// ============ SCHEDULED WORKOUTS ============

export async function scheduleWorkoutSupabase(date, templateId, userId) {
  const { data, error } = await supabase
    .from('scheduled_workouts')
    .upsert({
      user_id: userId,
      date,
      template_id: templateId
    }, { onConflict: 'user_id,date' })
    .select()

  if (error) throw error
  return data
}

export async function getScheduledWorkouts(userId) {
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
    const workouts = await getWorkouts(userId)
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

export async function getWorkoutStreak(userId) {
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

