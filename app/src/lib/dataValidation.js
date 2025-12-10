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
  
  if (!workout.exercises || !Array.isArray(workout.exercises) || workout.exercises.length === 0) {
    errors.push('Workout must have at least one exercise')
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
 * Validate nutrition data
 */
export function validateNutrition(nutrition) {
  const errors = []
  
  // Range validation
  if (nutrition.calories_consumed !== null && nutrition.calories_consumed !== undefined) {
    if (nutrition.calories_consumed < 0) {
      errors.push('Calories consumed cannot be negative')
    }
    if (nutrition.calories_consumed > 10000) { // 10k calories seems like an outlier
      errors.push('Calories consumed seems incorrect (more than 10,000)')
    }
  }
  
  if (nutrition.macros) {
    const { protein, carbs, fat } = nutrition.macros
    
    if (protein !== null && protein !== undefined) {
      if (protein < 0) {
        errors.push('Protein cannot be negative')
      }
      if (protein > 1000) { // 1000g seems like an outlier
        errors.push('Protein seems incorrect (more than 1000g)')
      }
    }
    
    if (carbs !== null && carbs !== undefined) {
      if (carbs < 0) {
        errors.push('Carbs cannot be negative')
      }
      if (carbs > 2000) { // 2000g seems like an outlier
        errors.push('Carbs seems incorrect (more than 2000g)')
      }
    }
    
    if (fat !== null && fat !== undefined) {
      if (fat < 0) {
        errors.push('Fat cannot be negative')
      }
      if (fat > 500) { // 500g seems like an outlier
        errors.push('Fat seems incorrect (more than 500g)')
      }
    }
    
    // Cross-field validation: macros should roughly match calories
    if (nutrition.calories_consumed && protein && carbs && fat) {
      const calculatedCalories = (protein * 4) + (carbs * 4) + (fat * 9)
      const difference = Math.abs(calculatedCalories - nutrition.calories_consumed)
      const percentDifference = (difference / nutrition.calories_consumed) * 100
      
      if (percentDifference > 20) { // More than 20% difference
        errors.push(`Macros don't match calories (calculated: ${Math.round(calculatedCalories)}, entered: ${nutrition.calories_consumed})`)
      }
    }
  }
  
  if (nutrition.water !== null && nutrition.water !== undefined) {
    if (nutrition.water < 0) {
      errors.push('Water cannot be negative')
    }
    if (nutrition.water > 20) { // 20L seems like an outlier
      errors.push('Water seems incorrect (more than 20L)')
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  }
}

/**
 * Validate goal data
 */
export function validateGoal(goal) {
  const errors = []
  
  // Schema validation
  if (!goal.category) {
    errors.push('Goal category is required')
  }
  
  if (!goal.type) {
    errors.push('Goal type is required')
  }
  
  if (goal.target_value === null || goal.target_value === undefined) {
    errors.push('Target value is required')
  }
  
  if (!goal.start_date) {
    errors.push('Start date is required')
  }
  
  // Range validation
  if (goal.target_value !== null && goal.target_value !== undefined) {
    if (goal.target_value <= 0) {
      errors.push('Target value must be greater than 0')
    }
  }
  
  // Cross-field validation
  if (goal.start_date && goal.end_date) {
    const startDate = new Date(goal.start_date)
    const endDate = new Date(goal.end_date)
    
    if (endDate <= startDate) {
      errors.push('End date must be after start date')
    }
  }
  
  // Business rule validation
  if (goal.start_date) {
    const startDate = new Date(goal.start_date)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    
    // Allow goals starting up to 1 year in the past
    const oneYearAgo = new Date()
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
    
    if (startDate < oneYearAgo) {
      errors.push('Goal start date cannot be more than 1 year in the past')
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
    case 'nutrition':
      return validateNutrition(data)
    case 'goal':
      return validateGoal(data)
    default:
      return {
        valid: true,
        errors: []
      }
  }
}

