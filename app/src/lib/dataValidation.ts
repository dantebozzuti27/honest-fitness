/**
 * Enhanced Data Validation
 * Multi-layer validation: schema, range, business rules, cross-field validation
 */

import { logError } from '../utils/logger'

/**
 * Validate workout data
 */
export function validateWorkout(workout) {
  const errors = []
  
  // Schema validation
  if (!workout.date) {
    errors.push('Workout date is required')
  }
  
  // Allow workouts with 0 exercises (user may want to log a workout session without exercises)
  // Only validate that exercises is an array if it exists
  if (workout.exercises !== undefined && workout.exercises !== null && !Array.isArray(workout.exercises)) {
    errors.push('Workout exercises must be an array')
  }
  
  // Range validation
  if (workout.duration !== null && workout.duration !== undefined) {
    if (workout.duration < 0) {
      errors.push('Workout duration cannot be negative')
    }
    if (workout.duration > 1440) { // 24 hours
      errors.push('Workout duration seems incorrect (more than 24 hours)')
    }
  }
  
  if (workout.perceived_effort !== null && workout.perceived_effort !== undefined) {
    if (workout.perceived_effort < 1 || workout.perceived_effort > 10) {
      errors.push('Perceived effort must be between 1 and 10')
    }
  }
  
  // Exercise validation
  if (workout.exercises) {
    workout.exercises.forEach((exercise, index) => {
      if (!exercise.name || exercise.name.trim() === '') {
        errors.push(`Exercise ${index + 1}: Name is required`)
      }
      
      if (exercise.sets && Array.isArray(exercise.sets)) {
        exercise.sets.forEach((set, setIndex) => {
          // Range validation for sets
          if (set.weight !== null && set.weight !== undefined) {
            if (set.weight < 0) {
              errors.push(`Exercise ${index + 1}, Set ${setIndex + 1}: Weight cannot be negative`)
            }
            if (set.weight > 2000) { // 2000 lbs seems like an outlier
              errors.push(`Exercise ${index + 1}, Set ${setIndex + 1}: Weight seems incorrect (${set.weight} lbs)`)
            }
          }
          
          if (set.reps !== null && set.reps !== undefined) {
            if (set.reps < 0) {
              errors.push(`Exercise ${index + 1}, Set ${setIndex + 1}: Reps cannot be negative`)
            }
            if (set.reps > 1000) { // 1000 reps seems like an outlier
              errors.push(`Exercise ${index + 1}, Set ${setIndex + 1}: Reps seems incorrect (${set.reps})`)
            }
          }
          
          if (set.time !== null && set.time !== undefined) {
            if (set.time < 0) {
              errors.push(`Exercise ${index + 1}, Set ${setIndex + 1}: Time cannot be negative`)
            }
            if (set.time > 3600) { // 1 hour per set seems excessive
              errors.push(`Exercise ${index + 1}, Set ${setIndex + 1}: Time seems incorrect (${set.time} seconds)`)
            }
          }
          
          // Cross-field validation: at least one of weight, reps, or time must be provided
          if (!set.weight && !set.reps && !set.time) {
            errors.push(`Exercise ${index + 1}, Set ${setIndex + 1}: Must have at least weight, reps, or time`)
          }
        })
      }
    })
  }
  
  // Business rule validation
  if (workout.date) {
    const workoutDate = new Date(workout.date)
    const today = new Date()
    today.setHours(23, 59, 59, 999)
    
    if (workoutDate > today) {
      errors.push('Workout date cannot be in the future')
    }
    
    // Allow workouts up to 1 year in the past (for data entry)
    const oneYearAgo = new Date()
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
    
    if (workoutDate < oneYearAgo) {
      errors.push('Workout date cannot be more than 1 year in the past')
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  }
}

/**
 * Validate health metrics
 */
export function validateHealthMetrics(metrics) {
  const errors = []
  
  // Range validation
  if (metrics.weight !== null && metrics.weight !== undefined) {
    if (metrics.weight < 50 || metrics.weight > 1000) { // lbs
      errors.push('Weight must be between 50 and 1000 lbs')
    }
  }
  
  if (metrics.steps !== null && metrics.steps !== undefined) {
    if (metrics.steps < 0) {
      errors.push('Steps cannot be negative')
    }
    if (metrics.steps > 100000) { // 100k steps seems like an outlier
      errors.push('Steps seems incorrect (more than 100,000)')
    }
  }
  
  if (metrics.hrv !== null && metrics.hrv !== undefined) {
    if (metrics.hrv < 0) {
      errors.push('HRV cannot be negative')
    }
    if (metrics.hrv > 200) { // 200ms seems like an outlier
      errors.push('HRV seems incorrect (more than 200ms)')
    }
  }
  
  if (metrics.sleep_score !== null && metrics.sleep_score !== undefined) {
    if (metrics.sleep_score < 0 || metrics.sleep_score > 100) {
      errors.push('Sleep score must be between 0 and 100')
    }
  }
  
  if (metrics.sleep_duration !== null && metrics.sleep_duration !== undefined) {
    if (metrics.sleep_duration < 0) {
      errors.push('Sleep duration cannot be negative')
    }
    if (metrics.sleep_duration > 1440) { // 24 hours
      errors.push('Sleep duration seems incorrect (more than 24 hours)')
    }
  }
  
  if (metrics.resting_heart_rate !== null && metrics.resting_heart_rate !== undefined) {
    if (metrics.resting_heart_rate < 30 || metrics.resting_heart_rate > 200) {
      errors.push('Resting heart rate must be between 30 and 200 bpm')
    }
  }
  
  if (metrics.calories_burned !== null && metrics.calories_burned !== undefined) {
    if (metrics.calories_burned < 0) {
      errors.push('Calories burned cannot be negative')
    }
    if (metrics.calories_burned > 10000) { // 10k calories seems like an outlier
      errors.push('Calories burned seems incorrect (more than 10,000)')
    }
  }
  
  // Business rule validation
  if (metrics.date) {
    const metricDate = new Date(metrics.date)
    const today = new Date()
    today.setHours(23, 59, 59, 999)
    
    if (metricDate > today) {
      errors.push('Metric date cannot be in the future')
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  }
}

/**
 * Comprehensive validation wrapper
 */
export function validateData(type, data) {
  switch (type) {
    case 'workout':
      return validateWorkout(data)
    case 'health':
    case 'metrics':
      return validateHealthMetrics(data)
    default:
      return {
        valid: true,
        errors: []
      }
  }
}

