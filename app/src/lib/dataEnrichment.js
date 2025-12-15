/**
 * Data Enrichment Layer
 * Enriches raw data with derived metrics, scores, and recommendations
 */

import { supabase as supabaseClient, supabaseConfigErrorMessage } from './supabase'
import { logError } from '../utils/logger'

// Avoid TypeError crashes when Supabase env is missing; throw a clear message at call time instead.
const supabase = supabaseClient ?? new Proxy({}, { get: () => { throw new Error(supabaseConfigErrorMessage) } })

/**
 * Enrich workout data with derived metrics
 */
export async function enrichWorkoutData(workout) {
  if (!workout || !workout.workout_exercises) return workout
  
  const enriched = { ...workout }
  
  // Calculate total volume (weight × reps)
  let totalVolume = 0
  let totalSets = 0
  let totalReps = 0
  let maxWeight = 0
  let avgWeight = 0
  let weightSum = 0
  let weightCount = 0
  
  workout.workout_exercises.forEach(exercise => {
    if (exercise.workout_sets) {
      exercise.workout_sets.forEach(set => {
        const weight = Number(set.weight) || 0
        const reps = Number(set.reps) || 0
        
        if (weight > 0 && reps > 0) {
          totalVolume += weight * reps
          totalSets++
          totalReps += reps
          
          if (weight > maxWeight) maxWeight = weight
          weightSum += weight
          weightCount++
        }
      })
    }
  })
  
  avgWeight = weightCount > 0 ? weightSum / weightCount : 0
  
  // Calculate intensity (average weight relative to max)
  const intensity = maxWeight > 0 ? (avgWeight / maxWeight) * 100 : 0
  
  // Calculate difficulty score (0-100)
  const difficultyScore = calculateDifficultyScore({
    volume: totalVolume,
    sets: totalSets,
    intensity,
    duration: workout.duration || 0
  })
  
  // Calculate RPE if not provided
  const estimatedRPE = estimateRPE({
    volume: totalVolume,
    intensity,
    duration: workout.duration || 0
  })
  
  enriched.derived_metrics = {
    total_volume: totalVolume,
    total_sets: totalSets,
    total_reps: totalReps,
    max_weight: maxWeight,
    avg_weight: avgWeight,
    intensity_percentage: intensity,
    difficulty_score: difficultyScore,
    estimated_rpe: estimatedRPE
  }
  
  return enriched
}

/**
 * Enrich nutrition data with quality scores
 */
export async function enrichNutritionData(nutrition) {
  if (!nutrition) return nutrition
  
  const enriched = { ...nutrition }
  
  const calories = Number(nutrition.calories_consumed) || 0
  const macros = nutrition.macros || {}
  const protein = Number(macros.protein) || 0
  const carbs = Number(macros.carbs) || 0
  const fat = Number(macros.fat) || 0
  
  // Calculate macro balance
  const totalMacros = protein + carbs + fat
  const proteinPercent = totalMacros > 0 ? (protein / totalMacros) * 100 : 0
  const carbsPercent = totalMacros > 0 ? (carbs / totalMacros) * 100 : 0
  const fatPercent = totalMacros > 0 ? (fat / totalMacros) * 100 : 0
  
  // Calculate nutrition quality score (0-100)
  const qualityScore = calculateNutritionQualityScore({
    calories,
    protein,
    carbs,
    fat,
    proteinPercent,
    carbsPercent,
    fatPercent
  })
  
  // Generate recommendations
  const recommendations = generateNutritionRecommendations({
    calories,
    protein,
    carbs,
    fat,
    qualityScore
  })
  
  enriched.derived_metrics = {
    macro_balance: {
      protein_percent: proteinPercent,
      carbs_percent: carbsPercent,
      fat_percent: fatPercent
    },
    quality_score: qualityScore,
    recommendations
  }
  
  return enriched
}

/**
 * Enrich health metrics with recovery recommendations
 */
export async function enrichHealthMetrics(metrics) {
  if (!metrics) return metrics
  
  const enriched = { ...metrics }
  
  const sleepScore = Number(metrics.sleep_score) || 0
  const hrv = Number(metrics.hrv) || 0
  const restingHR = Number(metrics.resting_heart_rate) || 0
  const steps = Number(metrics.steps) || 0
  
  // Calculate recovery score (0-100)
  const recoveryScore = calculateRecoveryScore({
    sleepScore,
    hrv,
    restingHR,
    steps
  })
  
  // Generate recovery recommendations
  const recommendations = generateRecoveryRecommendations({
    recoveryScore,
    sleepScore,
    hrv,
    restingHR
  })
  
  enriched.derived_metrics = {
    recovery_score: recoveryScore,
    recommendations
  }
  
  return enriched
}

// Helper functions

function calculateDifficultyScore({ volume, sets, intensity, duration }) {
  // Normalize values (0-1 scale)
  const volumeScore = Math.min(volume / 10000, 1) // Max 10,000 lbs
  const setsScore = Math.min(sets / 30, 1) // Max 30 sets
  const intensityScore = intensity / 100
  const durationScore = Math.min(duration / 120, 1) // Max 120 minutes
  
  // Weighted average
  const difficulty = (
    volumeScore * 0.3 +
    setsScore * 0.2 +
    intensityScore * 0.3 +
    durationScore * 0.2
  ) * 100
  
  return Math.round(difficulty)
}

function estimateRPE({ volume, intensity, duration }) {
  // Simple RPE estimation based on volume, intensity, and duration
  const volumeFactor = Math.min(volume / 5000, 1)
  const intensityFactor = intensity / 100
  const durationFactor = Math.min(duration / 60, 1)
  
  // RPE scale: 6-10
  const rpe = 6 + (volumeFactor * 0.5 + intensityFactor * 0.3 + durationFactor * 0.2) * 4
  
  return Math.round(rpe * 10) / 10 // Round to 1 decimal
}

function calculateNutritionQualityScore({ calories, protein, carbs, fat, proteinPercent, carbsPercent, fatPercent }) {
  let score = 50 // Base score
  
  // Protein adequacy (target: 20-30% of calories)
  if (proteinPercent >= 20 && proteinPercent <= 30) {
    score += 15
  } else if (proteinPercent >= 15 && proteinPercent < 20) {
    score += 10
  } else if (proteinPercent > 30 && proteinPercent <= 35) {
    score += 10
  }
  
  // Carb balance (target: 40-50% of calories)
  if (carbsPercent >= 40 && carbsPercent <= 50) {
    score += 15
  } else if (carbsPercent >= 35 && carbsPercent < 40) {
    score += 10
  } else if (carbsPercent > 50 && carbsPercent <= 55) {
    score += 10
  }
  
  // Fat balance (target: 20-30% of calories)
  if (fatPercent >= 20 && fatPercent <= 30) {
    score += 15
  } else if (fatPercent >= 15 && fatPercent < 20) {
    score += 10
  } else if (fatPercent > 30 && fatPercent <= 35) {
    score += 10
  }
  
  // Calorie adequacy (penalize extreme values)
  if (calories < 800 || calories > 5000) {
    score -= 10
  } else if (calories >= 1200 && calories <= 3000) {
    score += 5
  }
  
  return Math.max(0, Math.min(100, score))
}

function generateNutritionRecommendations({ calories, protein, carbs, fat, qualityScore }) {
  const recommendations = []
  
  if (qualityScore < 60) {
    recommendations.push('Consider balancing your macros for better nutrition quality')
  }
  
  if (protein < 100) {
    recommendations.push('Increase protein intake for better muscle recovery')
  }
  
  if (carbs < 150) {
    recommendations.push('Add more carbohydrates for energy')
  }
  
  if (fat < 50) {
    recommendations.push('Include healthy fats in your diet')
  }
  
  return recommendations
}

function calculateRecoveryScore({ sleepScore, hrv, restingHR, steps }) {
  let score = 50 // Base score
  
  // Sleep quality (0-100 scale)
  if (sleepScore >= 80) {
    score += 20
  } else if (sleepScore >= 60) {
    score += 10
  } else if (sleepScore < 40) {
    score -= 15
  }
  
  // HRV (higher is better, but relative to baseline)
  // This is simplified - would need baseline comparison
  if (hrv > 50) {
    score += 10
  } else if (hrv < 30) {
    score -= 10
  }
  
  // Resting HR (lower is better, but relative to baseline)
  if (restingHR < 60) {
    score += 10
  } else if (restingHR > 80) {
    score -= 10
  }
  
  // Activity level (steps)
  if (steps >= 10000) {
    score += 10
  } else if (steps < 3000) {
    score -= 10
  }
  
  return Math.max(0, Math.min(100, score))
}

function generateRecoveryRecommendations({ recoveryScore, sleepScore, hrv, restingHR }) {
  const recommendations = []
  
  if (recoveryScore < 60) {
    recommendations.push('Focus on recovery: prioritize sleep and rest')
  }
  
  if (sleepScore < 60) {
    recommendations.push('Improve sleep quality: aim for 7-9 hours of quality sleep')
  }
  
  if (hrv < 30) {
    recommendations.push('Your HRV is low - consider reducing training intensity')
  }
  
  if (restingHR > 80) {
    recommendations.push('Your resting heart rate is elevated - prioritize recovery')
  }
  
  return recommendations
}

/**
 * Save enriched data to database
 */
export async function saveEnrichedData(type, data, userId) {
  try {
    const enriched = await enrichDataByType(type, data)
    
    // Save derived metrics to a separate table or add to existing record
    const { error } = await supabase
      .from('data_enrichments')
      .upsert({
        user_id: userId,
        data_type: type,
        data_id: data.id,
        derived_metrics: enriched.derived_metrics,
        enriched_at: new Date().toISOString()
      }, {
        onConflict: 'user_id,data_type,data_id'
      })
    
    if (error) {
      logError('Error saving enriched data', error)
    }
    
    return enriched
  } catch (error) {
    logError('Error in saveEnrichedData', error)
    return data
  }
}

async function enrichDataByType(type, data) {
  switch (type) {
    case 'workout':
      return await enrichWorkoutData(data)
    case 'nutrition':
      return await enrichNutritionData(data)
    case 'health':
      return await enrichHealthMetrics(data)
    default:
      return data
  }
}

