/**
 * Data Export System
 * Export user data in CSV, JSON, PDF formats for backup and GDPR compliance
 */

import { supabase as supabaseClient, supabaseConfigErrorMessage } from './supabase'
import { logError } from '../utils/logger'

// Avoid TypeError crashes when Supabase env is missing; throw a clear message at call time instead.
const supabase = supabaseClient ?? new Proxy({}, { get: () => { throw new Error(supabaseConfigErrorMessage) } })

/**
 * Export all user data as JSON
 */
export async function exportUserDataJSON(userId) {
  try {
    const [
      workouts,
      healthMetrics,
      nutrition,
      goals,
      preferences,
      events,
      sessions
    ] = await Promise.all([
      exportWorkouts(userId),
      exportHealthMetrics(userId),
      exportNutrition(userId),
      exportGoals(userId),
      exportPreferences(userId),
      exportEvents(userId),
      exportSessions(userId)
    ])
    
    return {
      export_date: new Date().toISOString(),
      user_id: userId,
      data: {
        workouts,
        health_metrics: healthMetrics,
        nutrition,
        goals,
        preferences,
        events,
        sessions
      }
    }
  } catch (error) {
    logError('Error exporting user data as JSON', error)
    throw error
  }
}

/**
 * Export workouts as CSV
 */
export async function exportWorkoutsCSV(userId) {
  try {
    const workouts = await exportWorkouts(userId)
    
    if (!workouts || workouts.length === 0) {
      return 'No workout data available'
    }
    
    // CSV header
    const headers = ['Date', 'Duration (min)', 'Template', 'Perceived Effort', 'Notes', 'Exercise Count']
    let csv = headers.join(',') + '\n'
    
    // CSV rows
    workouts.forEach(workout => {
      const row = [
        workout.date,
        workout.duration || '',
        workout.template_name || '',
        workout.perceived_effort || '',
        (workout.notes || '').replace(/,/g, ';'), // Replace commas in notes
        workout.exercise_count || 0
      ]
      csv += row.map(field => `"${field}"`).join(',') + '\n'
    })
    
    return csv
  } catch (error) {
    logError('Error exporting workouts as CSV', error)
    throw error
  }
}

/**
 * Export health metrics as CSV
 */
export async function exportHealthMetricsCSV(userId) {
  try {
    const metrics = await exportHealthMetrics(userId)
    
    if (!metrics || metrics.length === 0) {
      return 'No health metrics data available'
    }
    
    const headers = ['Date', 'Sleep Score', 'Sleep Duration (min)', 'HRV (ms)', 'Steps', 'Weight (lbs)', 'Resting HR (bpm)', 'Calories Burned']
    let csv = headers.join(',') + '\n'
    
    metrics.forEach(metric => {
      const row = [
        metric.date,
        metric.sleep_score || '',
        metric.sleep_duration || '',
        metric.hrv || '',
        metric.steps || '',
        metric.weight || '',
        metric.resting_heart_rate || '',
        metric.calories_burned || ''
      ]
      csv += row.map(field => `"${field}"`).join(',') + '\n'
    })
    
    return csv
  } catch (error) {
    logError('Error exporting health metrics as CSV', error)
    throw error
  }
}

/**
 * Download exported data as file
 */
export function downloadData(data, filename, mimeType = 'application/json') {
  const blob = new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 2)], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

// Helper functions

async function exportWorkouts(userId) {
  const { data, error } = await supabase
    .from('workouts')
    .select(`
      id,
      date,
      duration,
      template_name,
      perceived_effort,
      notes,
      created_at,
      workout_exercises (
        name,
        body_part,
        workout_sets (
          set_number,
          weight,
          reps,
          time
        )
      )
    `)
    .eq('user_id', userId)
    .order('date', { ascending: false })
  
  if (error) throw error
  
  return data?.map(w => ({
    ...w,
    exercise_count: w.workout_exercises?.length || 0
  })) || []
}

async function exportHealthMetrics(userId) {
  const { data, error } = await supabase
    .from('health_metrics')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: false })
  
  if (error) throw error
  return data || []
}

async function exportNutrition(userId) {
  const { data, error } = await supabase
    .from('health_metrics')
    .select('date, calories_consumed, macros, water, meals')
    .eq('user_id', userId)
    .not('calories_consumed', 'is', null)
    .order('date', { ascending: false })
  
  if (error) throw error
  return data || []
}

async function exportGoals(userId) {
  const { data, error } = await supabase
    .from('goals')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  
  if (error) throw error
  return data || []
}

async function exportPreferences(userId) {
  const { data, error } = await supabase
    .from('user_preferences')
    .select('*')
    .eq('user_id', userId)
    .single()
  
  if (error && error.code !== 'PGRST116') throw error // PGRST116 = no rows
  return data || null
}

async function exportEvents(userId) {
  const { data, error } = await supabase
    .from('user_events')
    .select('*')
    .eq('user_id', userId)
    .order('timestamp', { ascending: false })
    .limit(10000) // Limit to prevent huge exports
  
  if (error) throw error
  return data || []
}

async function exportSessions(userId) {
  const { data, error } = await supabase
    .from('user_sessions')
    .select('*')
    .eq('user_id', userId)
    .order('start_time', { ascending: false })
  
  if (error) throw error
  return data || []
}

