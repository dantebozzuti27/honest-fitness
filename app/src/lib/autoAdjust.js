import { getReadinessScore } from './readiness'
import { getTodayEST } from '../utils/dateUtils'
import { logError } from '../utils/logger'

/**
 * Auto-adjust workout program based on readiness score
 * Red zone (0-49) → 70% weights
 * Yellow zone (50-69) → 85% weights
 * Green zone (70-100) → 100% weights
 */

export async function getAutoAdjustmentFactor(userId, date = null) {
  const targetDate = date || getTodayEST()
  
  try {
    const readiness = await getReadinessScore(userId, targetDate)
    
    if (!readiness) {
      // No readiness data, default to 100%
      return { factor: 1.0, zone: 'unknown', message: 'No readiness data available' }
    }
    
    const score = readiness.score || 0
    const zone = readiness.zone || 'green'
    
    let factor = 1.0
    let message = 'Full intensity'
    
    if (zone === 'red' || score < 50) {
      factor = 0.70
      message = 'Reduced intensity (70%) - Low readiness'
    } else if (zone === 'yellow' || score < 70) {
      factor = 0.85
      message = 'Moderate intensity (85%) - Moderate readiness'
    } else {
      factor = 1.0
      message = 'Full intensity (100%) - High readiness'
    }
    
    return {
      factor,
      zone,
      score,
      message
    }
  } catch (error) {
    logError('Error getting auto-adjustment', error)
    return { factor: 1.0, zone: 'unknown', message: 'Error calculating adjustment' }
  }
}

/**
 * Apply auto-adjustment to workout weights
 * Note: This adjusts suggested weights, but doesn't modify existing logged weights
 */
export function applyAutoAdjustment(exercises, adjustmentFactor) {
  if (adjustmentFactor === 1.0) {
    return exercises // No adjustment needed
  }
  
  // Only adjust if weights aren't already set (for new workouts)
  // If weights are already logged, we don't want to change them
  return exercises.map(exercise => ({
    ...exercise,
    sets: exercise.sets.map(set => {
      // If weight is already set, keep it (user may have logged it)
      // Otherwise, we'll suggest the adjusted weight when they start logging
      const hasWeight = set.weight && set.weight !== ''
      return {
        ...set,
        // Store adjustment factor for UI to show suggested weight
        suggestedWeight: hasWeight ? null : adjustmentFactor,
        // Don't modify existing weights
        weight: set.weight
      }
    })
  }))
}

/**
 * Get workout recommendation based on readiness
 */
export async function getWorkoutRecommendation(userId, date = null) {
  const adjustment = await getAutoAdjustmentFactor(userId, date)
  
  const recommendations = {
    red: {
      message: 'Consider a light session or rest day',
      suggestions: ['Light cardio', 'Mobility work', 'Active recovery', 'Rest day']
    },
    yellow: {
      message: 'Moderate intensity workout recommended',
      suggestions: ['Reduce volume by 15%', 'Focus on technique', 'Extra rest between sets']
    },
    green: {
      message: 'Full intensity workout - Go hard!',
      suggestions: ['Push your limits', 'Add extra sets', 'Try new PRs']
    }
  }
  
  const rec = recommendations[adjustment.zone] || recommendations.green
  
  return {
    ...adjustment,
    recommendation: rec.message,
    suggestions: rec.suggestions
  }
}

