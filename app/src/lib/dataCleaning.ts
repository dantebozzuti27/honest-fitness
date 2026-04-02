/**
 * Data Cleaning Pipeline
 * Normalizes units, corrects timezones, standardizes formats, fixes typos
 */

import { logError } from '../utils/logger'

/**
 * Clean and normalize workout data
 */
export function cleanWorkoutData(workout: any) {
  const cleaned = { ...workout }
  
  // Normalize date format
  if (cleaned.date) {
    cleaned.date = normalizeDate(cleaned.date)
  }
  
  // Normalize duration to minutes.
  // Legacy rows stored raw seconds (e.g. 6823 for a ~114-min session).
  // Any value > 300 is almost certainly seconds, not minutes.
  if (cleaned.duration != null) {
    const d = Number(cleaned.duration);
    cleaned.duration = d > 300 ? Math.round(d / 60) : Math.round(d);
  }
  
  // Clean exercises
  if (cleaned.exercises && Array.isArray(cleaned.exercises)) {
    cleaned.exercises = cleaned.exercises.map((exercise: any) => cleanExerciseData(exercise))
  }
  
  return cleaned
}

/**
 * Clean exercise data
 */
function cleanExerciseData(exercise: any) {
  const cleaned = { ...exercise }
  
  // Normalize exercise name (trim, canonical alias)
  if (cleaned.name) {
    cleaned.name = normalizeExerciseName(cleaned.name)
  }

  // Resolve body_part to canonical group via exercise muscle map.
  // Falls back to the original if no mapping exists.
  if (cleaned.name && (!cleaned.bodyPart || cleaned.bodyPart === 'Other')) {
    const resolved = resolveBodyPart(cleaned.name, cleaned.category);
    if (resolved) cleaned.bodyPart = resolved;
  }
  
  // Clean sets
  if (cleaned.sets && Array.isArray(cleaned.sets)) {
    cleaned.sets = cleaned.sets.map((set: any) => cleanSetData(set))
  }
  
  return cleaned
}

/**
 * Resolve an exercise's body_part to a human-readable canonical label.
 * Uses a lightweight lookup to avoid circular dependencies with exerciseMuscleMap.
 */
const EXERCISE_BODY_PART_MAP: Record<string, string> = {
  'barbell bench press': 'Mid Chest', 'incline dumbbell bench press': 'Upper Chest',
  'barbell back squat': 'Quadriceps', 'romanian deadlift': 'Hamstrings',
  'dumbbell romanian deadlift': 'Hamstrings', 'conventional deadlift': 'Hamstrings',
  'barbell overhead press': 'Front Delts', 'lat pulldown': 'Back Lats',
  'pull-up': 'Back Lats', 'chin-up': 'Back Lats',
  'barbell bent-over row': 'Back Upper', 'dumbbell lateral raise': 'Side Delts',
  'face pull': 'Rear Delts', 'tricep pushdown': 'Triceps',
  'barbell curl': 'Biceps', 'dumbbell hammer curl': 'Biceps',
  'pec deck': 'Mid Chest', 'cable crunch': 'Core',
  'leg press': 'Quadriceps', 'leg extension': 'Quadriceps',
  'lying leg curl': 'Hamstrings', 'barbell hip thrust': 'Glutes',
  'hack squat machine': 'Quadriceps', 'ab wheel rollout': 'Core',
  'preacher curl': 'Biceps', 'stairmaster': 'Cardio',
  'incline treadmill walk': 'Cardio',
};

function resolveBodyPart(exerciseName: string, category?: string): string | null {
  if (category === 'Cardio' || category === 'Recovery') return category ?? null;
  return EXERCISE_BODY_PART_MAP[exerciseName.toLowerCase()] ?? null;
}

/**
 * Clean set data
 */
function cleanSetData(set: any) {
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
export function cleanHealthMetrics(metrics: any) {
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
  
  // Normalize sleep duration to minutes.
  // Fitbit stores minutesAsleep (e.g., 420 for 7h). Manual entries may be in hours.
  // Values < 24 are almost certainly hours; 24-1440 are minutes.
  if (cleaned.sleep_duration != null) {
    const v = Number(cleaned.sleep_duration);
    if (v > 0 && v < 24) {
      cleaned.sleep_duration = Math.round(v * 60);
    } else if (v >= 24 && v <= 1440) {
      cleaned.sleep_duration = Math.round(v);
    } else {
      cleaned.sleep_duration = null;
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
export function cleanNutritionData(nutrition: any) {
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

function normalizeDate(date: any) {
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

function normalizeExerciseName(name: string) {
  if (!name) return name
  
  // Trim whitespace
  let normalized = name.trim()
  
  const CANONICAL_NAMES: Record<string, string> = {
    'pull up': 'Pull-up', 'pull-up': 'Pull-up', 'pull ups': 'Pull-up',
    'pull-ups': 'Pull-up', 'pullup': 'Pull-up', 'pullups': 'Pull-up',
    'chin up': 'Chin-up', 'chin-up': 'Chin-up', 'chin ups': 'Chin-up',
    'chin-ups': 'Chin-up', 'chinup': 'Chin-up', 'chinups': 'Chin-up',
    'push up': 'Push-up', 'push-up': 'Push-up', 'push ups': 'Push-up',
    'push-ups': 'Push-up', 'pushup': 'Push-up', 'pushups': 'Push-up',
    'sit up': 'Sit-up', 'sit-up': 'Sit-up', 'sit ups': 'Sit-up',
    'sit-ups': 'Sit-up', 'situp': 'Sit-up', 'situps': 'Sit-up',
    'bench press': 'Barbell Bench Press',
    'flat bench': 'Barbell Bench Press', 'flat bench press': 'Barbell Bench Press',
    'squat': 'Barbell Back Squat', 'back squat': 'Barbell Back Squat',
    'deadlift': 'Conventional Deadlift',
    'overhead press': 'Barbell Overhead Press', 'ohp': 'Barbell Overhead Press',
    'military press': 'Barbell Overhead Press',
    'barbell row': 'Barbell Bent-Over Row', 'bent over row': 'Barbell Bent-Over Row',
    'hammer curl': 'Dumbbell Hammer Curl', 'hammer curls': 'Dumbbell Hammer Curl',
    'dumbell hammer curls': 'Dumbbell Hammer Curl', 'dumbbell hammer curls': 'Dumbbell Hammer Curl',
    'side raise': 'Dumbbell Lateral Raise', 'lateral raise': 'Dumbbell Lateral Raise',
    'side raises': 'Dumbbell Lateral Raise', 'lateral raises': 'Dumbbell Lateral Raise',
    'dumbbell lateral raises': 'Dumbbell Lateral Raise',
    'hack squat': 'Hack Squat Machine', 'hack squats': 'Hack Squat Machine',
    'dumbell rdl': 'Dumbbell Romanian Deadlift', 'dumbbell rdl': 'Dumbbell Romanian Deadlift',
    'db rdl': 'Dumbbell Romanian Deadlift',
    'rdl': 'Romanian Deadlift', 'romanian deadlift': 'Romanian Deadlift',
    'dumbbell romanian deadlift': 'Dumbbell Romanian Deadlift',
    'incline db press': 'Incline Dumbbell Bench Press',
    'incline dumbbell press': 'Incline Dumbbell Bench Press',
    'incline dumbbell bench press': 'Incline Dumbbell Bench Press',
    'leg curl': 'Lying Leg Curl', 'leg curls': 'Lying Leg Curl',
    'hamstring curl': 'Lying Leg Curl', 'hamstring curls': 'Lying Leg Curl',
    'cable crunch': 'Cable Crunch', 'cable crunches': 'Cable Crunch',
    'ab wheel': 'Ab Wheel Rollout', 'ab wheel rollout': 'Ab Wheel Rollout',
    'face pull': 'Face Pull', 'face pulls': 'Face Pull',
    'lat pulldown': 'Lat Pulldown', 'lat pull down': 'Lat Pulldown',
    'lat pull-down': 'Lat Pulldown', 'lat pulldowns': 'Lat Pulldown',
    'pec deck': 'Pec Deck', 'pec fly': 'Pec Deck', 'pec flye': 'Pec Deck',
    'tricep pushdown': 'Tricep Pushdown', 'triceps pushdown': 'Tricep Pushdown',
    'tricep push down': 'Tricep Pushdown',
    'bicep curl': 'Barbell Curl', 'bicep curls': 'Barbell Curl',
    'preacher curl': 'Preacher Curl', 'preacher curls': 'Preacher Curl',
    'leg press': 'Leg Press', 'leg extension': 'Leg Extension',
    'leg extensions': 'Leg Extension',
    'calf raise': 'Standing Calf Raise', 'calf raises': 'Standing Calf Raise',
    'hip thrust': 'Barbell Hip Thrust', 'hip thrusts': 'Barbell Hip Thrust',
    'incline walk': 'Incline Treadmill Walk',
    'incline treadmill': 'Incline Treadmill Walk',
    'treadmill walk': 'Incline Treadmill Walk',
    'stairmaster': 'StairMaster', 'stair master': 'StairMaster',
    'stair climber': 'StairMaster',
  };

  const lower = normalized.toLowerCase();
  if (CANONICAL_NAMES[lower]) {
    normalized = CANONICAL_NAMES[lower];
  } else {
    normalized = normalized.split(/[\s]+/).map((word: string) =>
      word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    ).join(' ');
  }
  
  return normalized
}

/**
 * Clean timezone (convert to UTC)
 */
export function normalizeTimezone(date: string, timezone: string) {
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
export function cleanData(type: string, data: any) {
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

