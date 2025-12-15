/**
 * Data Cleaning Pipeline
 * Normalizes units, corrects timezones, standardizes formats, fixes typos
 */

import { logError } from '../utils/logger'

/**
 * Clean and normalize workout data
 */
export function cleanWorkoutData(workout) {
  const cleaned = { ...workout }
  
  // Normalize date format
  if (cleaned.date) {
    cleaned.date = normalizeDate(cleaned.date)
  }
  
  // Normalize duration (ensure it's in minutes)
  if (cleaned.duration !== null && cleaned.duration !== undefined) {
    cleaned.duration = Math.round(cleaned.duration)
  }
  
  // Clean exercises
  if (cleaned.exercises && Array.isArray(cleaned.exercises)) {
    cleaned.exercises = cleaned.exercises.map(exercise => cleanExerciseData(exercise))
  }
  
  return cleaned
}

/**
 * Clean exercise data
 */
function cleanExerciseData(exercise) {
  const cleaned = { ...exercise }
  
  // Normalize exercise name (trim, capitalize)
  if (cleaned.name) {
    cleaned.name = normalizeExerciseName(cleaned.name)
  }
  
  // Clean sets
  if (cleaned.sets && Array.isArray(cleaned.sets)) {
    cleaned.sets = cleaned.sets.map(set => cleanSetData(set))
  }
  
  return cleaned
}

/**
 * Clean set data
 */
function cleanSetData(set) {
  const cleaned = { ...set }
  
  // Normalize weight (convert kg to lbs if needed, round to 2 decimals)
  if (cleaned.weight !== null && cleaned.weight !== undefined) {
    // Assume weight > 500 is in kg, convert to lbs
    if (cleaned.weight > 500) {
      cleaned.weight = Math.round((cleaned.weight * 2.20462) * 100) / 100
    } else {
      cleaned.weight = Math.round(cleaned.weight * 100) / 100
    }
  }
  
  // Normalize reps (round to whole number)
  if (cleaned.reps !== null && cleaned.reps !== undefined) {
    cleaned.reps = Math.round(cleaned.reps)
  }
  
  // Normalize time (ensure it's in seconds)
  if (cleaned.time !== null && cleaned.time !== undefined) {
    // If time > 3600, might be in milliseconds, convert to seconds
    if (cleaned.time > 3600 && cleaned.time < 3600000) {
      cleaned.time = Math.round(cleaned.time / 1000)
    } else {
      cleaned.time = Math.round(cleaned.time)
    }
  }
  
  return cleaned
}

/**
 * Clean and normalize health metrics
 */
export function cleanHealthMetrics(metrics) {
  const cleaned = { ...metrics }
  
  // Normalize date
  if (cleaned.date) {
    cleaned.date = normalizeDate(cleaned.date)
  }
  
  // Normalize weight (convert kg to lbs if needed)
  if (cleaned.weight !== null && cleaned.weight !== undefined) {
    if (cleaned.weight > 500) { // Assume kg if > 500
      cleaned.weight = Math.round((cleaned.weight * 2.20462) * 100) / 100
    } else {
      cleaned.weight = Math.round(cleaned.weight * 100) / 100
    }
  }
  
  // Normalize steps (round to whole number)
  if (cleaned.steps !== null && cleaned.steps !== undefined) {
    cleaned.steps = Math.round(cleaned.steps)
  }
  
  // Normalize HRV (round to 1 decimal)
  if (cleaned.hrv !== null && cleaned.hrv !== undefined) {
    cleaned.hrv = Math.round(cleaned.hrv * 10) / 10
  }
  
  // Normalize sleep duration (ensure minutes)
  if (cleaned.sleep_duration !== null && cleaned.sleep_duration !== undefined) {
    // If > 24, might be in hours, convert to minutes
    if (cleaned.sleep_duration < 24) {
      cleaned.sleep_duration = Math.round(cleaned.sleep_duration * 60)
    } else {
      cleaned.sleep_duration = Math.round(cleaned.sleep_duration)
    }
  }
  
  // Normalize sleep score (round to whole number, ensure 0-100)
  if (cleaned.sleep_score !== null && cleaned.sleep_score !== undefined) {
    cleaned.sleep_score = Math.max(0, Math.min(100, Math.round(cleaned.sleep_score)))
  }
  
  // Normalize resting heart rate (round to whole number)
  if (cleaned.resting_heart_rate !== null && cleaned.resting_heart_rate !== undefined) {
    cleaned.resting_heart_rate = Math.round(cleaned.resting_heart_rate)
  }
  
  // Normalize calories burned (round to whole number)
  if (cleaned.calories_burned !== null && cleaned.calories_burned !== undefined) {
    cleaned.calories_burned = Math.round(cleaned.calories_burned)
  }
  
  return cleaned
}

/**
 * Clean and normalize nutrition data
 */
export function cleanNutritionData(nutrition) {
  const cleaned = { ...nutrition }
  
  // Normalize date
  if (cleaned.date) {
    cleaned.date = normalizeDate(cleaned.date)
  }
  
  // Normalize calories (round to whole number)
  if (cleaned.calories_consumed !== null && cleaned.calories_consumed !== undefined) {
    cleaned.calories_consumed = Math.round(cleaned.calories_consumed)
  }
  
  // Clean macros
  if (cleaned.macros) {
    cleaned.macros = {
      protein: cleaned.macros.protein ? Math.round(cleaned.macros.protein * 10) / 10 : 0,
      carbs: cleaned.macros.carbs ? Math.round(cleaned.macros.carbs * 10) / 10 : 0,
      fat: cleaned.macros.fat ? Math.round(cleaned.macros.fat * 10) / 10 : 0
    }
  }
  
  // Normalize water (convert to liters if needed)
  if (cleaned.water !== null && cleaned.water !== undefined) {
    // If > 20, might be in ounces, convert to liters
    if (cleaned.water > 20) {
      cleaned.water = Math.round((cleaned.water * 0.0295735) * 100) / 100
    } else {
      cleaned.water = Math.round(cleaned.water * 100) / 100
    }
  }
  
  return cleaned
}

// Helper functions

function normalizeDate(date) {
  if (!date) return date
  
  // If it's already a string in YYYY-MM-DD format, return as is
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return date
  }
  
  // Try to parse and format
  try {
    const d = new Date(date)
    if (isNaN(d.getTime())) return date
    
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    
    return `${year}-${month}-${day}`
  } catch (e) {
    return date
  }
}

function normalizeExerciseName(name) {
  if (!name) return name
  
  // Trim whitespace
  let normalized = name.trim()
  
  // Fix common typos (simple dictionary)
  const typos = {
    'bench press': 'Bench Press',
    'squat': 'Squat',
    'deadlift': 'Deadlift',
    'overhead press': 'Overhead Press',
    'barbell row': 'Barbell Row',
    'pull up': 'Pull Up',
    'push up': 'Push Up',
    'sit up': 'Sit Up'
  }
  
  const lower = normalized.toLowerCase()
  if (typos[lower]) {
    normalized = typos[lower]
  } else {
    // Capitalize first letter of each word
    normalized = normalized.split(' ').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    ).join(' ')
  }
  
  return normalized
}

/**
 * Clean timezone (convert to UTC)
 */
export function normalizeTimezone(date, timezone) {
  if (!date || !timezone) return date
  
  try {
    // This is simplified - in production, use a proper timezone library
    const d = new Date(date)
    return d.toISOString()
  } catch (e) {
    return date
  }
}

/**
 * Comprehensive cleaning wrapper
 */
export function cleanData(type, data) {
  switch (type) {
    case 'workout':
      return cleanWorkoutData(data)
    case 'health':
    case 'metrics':
      return cleanHealthMetrics(data)
    case 'nutrition':
      return cleanNutritionData(data)
    default:
      return data
  }
}

