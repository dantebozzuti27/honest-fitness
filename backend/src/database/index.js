/**
 * Database Layer
 * Handles all database operations
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
)

/**
 * Save data to appropriate database table
 */
export async function saveToDatabase(type, normalizedData) {
  let tableName
  let dataToSave
  
  switch (type) {
    case 'workout':
      tableName = 'workouts'
      dataToSave = {
        user_id: normalizedData.user_id,
        date: normalizedData.date,
        duration: normalizedData.duration,
        perceived_effort: normalizedData.perceived_effort,
        mood_after: normalizedData.mood_after,
        notes: normalizedData.notes,
        template_name: normalizedData.template_name || null
      }
      break
      
    case 'nutrition':
      tableName = 'daily_metrics' // Store nutrition in daily_metrics
      dataToSave = {
        user_id: normalizedData.user_id,
        date: normalizedData.date,
        calories: normalizedData.calories,
        // Note: macros would need separate table or JSON field
      }
      break
      
    case 'health':
      // Store in appropriate health table based on source
      if (normalizedData.source === 'fitbit') {
        tableName = 'fitbit_daily'
      } else {
        tableName = 'daily_metrics'
      }
      dataToSave = {
        user_id: normalizedData.user_id,
        date: normalizedData.date,
        steps: normalizedData.steps,
        hrv: normalizedData.hrv,
        sleep_duration: normalizedData.sleep_duration,
        sleep_efficiency: normalizedData.sleep_efficiency,
        calories: normalizedData.calories,
        active_calories: normalizedData.active_calories,
        resting_heart_rate: normalizedData.resting_heart_rate,
        distance: normalizedData.distance,
        floors: normalizedData.floors,
        body_temp: normalizedData.body_temp
      }
      break
      
    case 'user':
      tableName = 'user_preferences'
      dataToSave = {
        user_id: normalizedData.user_id,
        age: normalizedData.age,
        weight: normalizedData.weight,
        height: normalizedData.height,
        goals: normalizedData.goals,
        preferences: normalizedData.preferences,
        updated_at: normalizedData.updated_at
      }
      break
      
    default:
      throw new Error(`Unknown data type: ${type}`)
  }
  
  // Upsert data
  const { data, error } = await supabase
    .from(tableName)
    .upsert(dataToSave, {
      onConflict: type === 'workout' ? 'id' : 'user_id,date'
    })
    .select()
    .single()
  
  if (error) {
    throw new Error(`Database error: ${error.message}`)
  }
  
  return data
}

/**
 * Get data from database
 */
export async function getFromDatabase(type, userId, filters = {}) {
  let tableName
  
  switch (type) {
    case 'workout':
      tableName = 'workouts'
      break
    case 'nutrition':
      tableName = 'daily_metrics'
      break
    case 'health':
      tableName = filters.source === 'fitbit' ? 'fitbit_daily' : 'daily_metrics'
      break
    case 'user':
      tableName = 'user_preferences'
      break
    default:
      throw new Error(`Unknown data type: ${type}`)
  }
  
  let query = supabase
    .from(tableName)
    .select('*')
    .eq('user_id', userId)
  
  if (filters.startDate) {
    query = query.gte('date', filters.startDate)
  }
  
  if (filters.endDate) {
    query = query.lte('date', filters.endDate)
  }
  
  if (filters.limit) {
    query = query.limit(filters.limit)
  }
  
  query = query.order('date', { ascending: false })
  
  const { data, error } = await query
  
  if (error) {
    throw new Error(`Database error: ${error.message}`)
  }
  
  return data
}

