/**
 * Database Layer
 * Handles all database operations
 */

import { createClient } from '@supabase/supabase-js'

/**
 * IMPORTANT:
 * Do NOT throw at import time if env is missing.
 * - Vercel (and other serverless platforms) may build/bundle without runtime env present.
 * - We validate env lazily when a DB function is actually called.
 */
let supabase = null
let didInit = false

function getSupabaseClient() {
  if (supabase) return supabase
  if (didInit) return null
  didInit = true

  const url = process.env.SUPABASE_URL
  // SECURITY: use service role only for server-side DB operations.
  // Do not fall back to anon keys in backend runtime.
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null

  supabase = createClient(url, key)
  return supabase
}

/**
 * Save data to appropriate database table
 */
export async function saveToDatabase(type, normalizedData) {
  const client = getSupabaseClient()
  if (!client) {
    throw new Error('Database client not initialized (missing SUPABASE_URL / SUPABASE_*_KEY)')
  }
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
      tableName = 'health_metrics' // Store nutrition in health_metrics
      dataToSave = {
        user_id: normalizedData.user_id,
        date: normalizedData.date,
        calories_consumed: normalizedData.calories || 0,
        meals: normalizedData.meals ? (typeof normalizedData.meals === 'string' ? normalizedData.meals : normalizedData.meals) : null,
        macros: normalizedData.macros ? (typeof normalizedData.macros === 'string' ? normalizedData.macros : normalizedData.macros) : null,
        water: normalizedData.water || null,
        source_provider: 'manual'
      }
      break
      
    case 'health':
      // Store in unified health_metrics table
      tableName = 'health_metrics'
      dataToSave = {
        user_id: normalizedData.user_id,
        date: normalizedData.date,
        steps: normalizedData.steps,
        hrv: normalizedData.hrv,
        sleep_duration: normalizedData.sleep_duration,
        sleep_score: normalizedData.sleep_efficiency ? Math.round(normalizedData.sleep_efficiency) : null,
        calories_burned: normalizedData.calories,
        resting_heart_rate: normalizedData.resting_heart_rate,
        body_temp: normalizedData.body_temp,
        source_provider: normalizedData.source || 'manual',
        source_data: {
          active_calories: normalizedData.active_calories,
          distance: normalizedData.distance,
          floors: normalizedData.floors,
          sleep_efficiency: normalizedData.sleep_efficiency
        }
      }
      break
      
    case 'user':
      tableName = 'user_preferences'
      dataToSave = {
        user_id: normalizedData.user_id,
        age: normalizedData.age,
        weight: normalizedData.weight,
        height: normalizedData.height,
        date_of_birth: normalizedData.date_of_birth || null,
        gender: normalizedData.gender || null,
        height_inches: normalizedData.height_inches || null,
        height_feet: normalizedData.height_feet || null,
        goals: normalizedData.goals,
        preferences: normalizedData.preferences,
        updated_at: normalizedData.updated_at
      }
      break
      
    default:
      throw new Error(`Unknown data type: ${type}`)
  }
  
  // Upsert data
  const { data, error } = await client
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
  const client = getSupabaseClient()
  if (!client) {
    throw new Error('Database client not initialized (missing SUPABASE_URL / SUPABASE_*_KEY)')
  }
  let tableName
  
  switch (type) {
    case 'workout':
      tableName = 'workouts'
      break
    case 'nutrition':
      tableName = 'health_metrics'
      break
    case 'health':
      tableName = 'health_metrics'
      break
    case 'user':
      tableName = 'user_preferences'
      break
    default:
      throw new Error(`Unknown data type: ${type}`)
  }
  
  let query = client
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
  
  // Parse JSON fields for nutrition data
  if (type === 'nutrition' && data && Array.isArray(data)) {
    return data.map(item => {
      if (item.meals && typeof item.meals === 'string') {
        try {
          item.meals = JSON.parse(item.meals)
        } catch (e) {
          item.meals = []
        }
      }
      if (item.macros && typeof item.macros === 'string') {
        try {
          item.macros = JSON.parse(item.macros)
        } catch (e) {
          item.macros = { protein: 0, carbs: 0, fat: 0 }
        }
      }
      return item
    })
  }
  
  return data || []
}

