/**
 * Database Layer
 * Handles all database operations via RDS (pg pool)
 */

import { query } from './pg.js'

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
        notes: normalizedData.notes,
        template_name: normalizedData.template_name || null
      }
      break

    case 'nutrition':
      tableName = 'health_metrics'
      dataToSave = {
        user_id: normalizedData.user_id,
        date: normalizedData.date,
        calories_consumed: normalizedData.calories || 0,
        meals: normalizedData.meals ? (typeof normalizedData.meals === 'string' ? normalizedData.meals : JSON.stringify(normalizedData.meals)) : null,
        macros: normalizedData.macros ? (typeof normalizedData.macros === 'string' ? normalizedData.macros : JSON.stringify(normalizedData.macros)) : null,
        water: normalizedData.water || null,
        source_provider: 'manual'
      }
      break

    case 'health':
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
        source_data: JSON.stringify({
          active_calories: normalizedData.active_calories,
          distance: normalizedData.distance,
          floors: normalizedData.floors,
          sleep_efficiency: normalizedData.sleep_efficiency
        })
      }
      break

    case 'user':
      tableName = 'user_preferences'
      dataToSave = {
        user_id: normalizedData.user_id,
        age: normalizedData.age,
        date_of_birth: normalizedData.date_of_birth || null,
        gender: normalizedData.gender || null,
        height_inches: normalizedData.height_inches || null,
        height_feet: normalizedData.height_feet || null,
        updated_at: normalizedData.updated_at || new Date().toISOString()
      }
      break

    default:
      throw new Error(`Unknown data type: ${type}`)
  }

  const keys = Object.keys(dataToSave)
  const values = keys.map((k) => dataToSave[k])
  const cols = keys.map((k) => `"${k}"`).join(', ')
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ')
  const conflictTarget = type === 'workout' ? 'id' : 'user_id, date'
  const updateSet = keys
    .filter((k) => k !== 'user_id' && k !== 'id')
    .map((k) => `"${k}" = EXCLUDED."${k}"`)
    .join(', ')

  const sql = `INSERT INTO "${tableName}" (${cols}) VALUES (${placeholders}) ON CONFLICT (${conflictTarget}) DO UPDATE SET ${updateSet} RETURNING *`
  const result = await query(sql, values)
  return result.rows[0] || null
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
    case 'health':
      tableName = 'health_metrics'
      break
    case 'user':
      tableName = 'user_preferences'
      break
    default:
      throw new Error(`Unknown data type: ${type}`)
  }

  const params = [userId]
  let sql = `SELECT * FROM "${tableName}" WHERE user_id = $1`

  if (type !== 'user') {
    if (filters.startDate) {
      params.push(filters.startDate)
      sql += ` AND date >= $${params.length}`
    }
    if (filters.endDate) {
      params.push(filters.endDate)
      sql += ` AND date <= $${params.length}`
    }
  }

  if (type !== 'user') {
    sql += ' ORDER BY date ASC, created_at ASC'
  }

  if (filters.limit) {
    sql += ` LIMIT ${parseInt(filters.limit, 10)}`
  }

  const result = await query(sql, params)
  let data = result.rows || []

  if (type === 'nutrition' && Array.isArray(data)) {
    return data.map((item) => {
      if (item.meals && typeof item.meals === 'string') {
        try { item.meals = JSON.parse(item.meals) } catch { item.meals = [] }
      }
      if (item.macros && typeof item.macros === 'string') {
        try { item.macros = JSON.parse(item.macros) } catch { item.macros = { protein: 0, carbs: 0, fat: 0 } }
      }
      return item
    })
  }

  return data
}

