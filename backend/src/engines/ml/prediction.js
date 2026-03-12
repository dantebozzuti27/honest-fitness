/**
 * Performance Prediction
 * Predicts future performance based on historical data
 */

export async function predictPerformance(userId, dataContext) {
  if (!dataContext.workouts || dataContext.workouts.length < 5) {
    return null // Need at least 5 workouts for prediction
  }
  
  const workouts = dataContext.workouts.slice(-20) // Last 20 workouts
  
  // Calculate progression trends
  const progression = calculateProgression(workouts)
  const confidenceScore = calculateConfidenceScore(progression, workouts)
  const confidenceLevel = confidenceScore >= 0.75 ? 'high' : confidenceScore >= 0.5 ? 'medium' : 'low'
  const conservativeFallback = confidenceScore < 0.45
  
  // Predict next workout performance
  const predictedPerformance = {
    expectedVolume: progression.avgVolume * (1 + progression.trend * 0.05),
    expectedIntensity: progression.avgIntensity,
    confidence: confidenceLevel,
    confidenceScore,
    conservativeFallback
  }

  if (conservativeFallback) {
    predictedPerformance.expectedVolume = progression.avgVolume * 0.95
    predictedPerformance.expectedIntensity = Math.min(progression.avgIntensity, 6)
  }
  
  // Predict recovery needs
  const recoveryPrediction = predictRecovery(dataContext)
  
  return {
    performance: predictedPerformance,
    recovery: recoveryPrediction,
    trends: progression
  }
}

function calculateConfidenceScore(progression, workouts) {
  const consistency = Math.max(0, Math.min(1, progression.consistency || 0))
  const density = Math.max(0, Math.min(1, workouts.length / 20))
  // Penalize extreme trend magnitude as likely instability/noise.
  const trendPenalty = Math.min(0.3, Math.abs(progression.trend || 0))
  const raw = 0.15 + consistency * 0.6 + density * 0.25 - trendPenalty
  return Math.max(0, Math.min(1, raw))
}

export function computeWorkoutVolume(workout) {
  return workout?.workout_exercises?.reduce((sum, ex) => {
    return sum + (ex.workout_sets?.reduce((setSum, set) => {
      return setSum + ((set.weight || 0) * (set.reps || 0))
    }, 0) || 0)
  }, 0) || 0
}

function calculateProgression(workouts) {
  const volumes = workouts.map(computeWorkoutVolume)
  
  const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length
  
  // Calculate trend (positive = increasing, negative = decreasing)
  const firstHalf = volumes.slice(0, Math.floor(volumes.length / 2))
  const secondHalf = volumes.slice(Math.floor(volumes.length / 2))
  const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length
  const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length
  const trend = (secondAvg - firstAvg) / firstAvg
  
  // Calculate consistency (lower variance = higher consistency)
  const variance = volumes.reduce((sum, v) => sum + Math.pow(v - avgVolume, 2), 0) / volumes.length
  const consistency = Math.max(0, 1 - (variance / (avgVolume * avgVolume)))
  
  // Calculate average intensity (perceived effort)
  const intensities = workouts
    .map(w => w.perceived_effort)
    .filter(i => i != null)
  const avgIntensity = intensities.length > 0
    ? intensities.reduce((a, b) => a + b, 0) / intensities.length
    : 5
  
  return {
    avgVolume,
    trend,
    consistency,
    avgIntensity
  }
}

export function calculateProgressionForEval(workouts) {
  return calculateProgression(workouts)
}

function predictRecovery(dataContext) {
  if (!dataContext.health) {
    return { needsRest: false, recommendedActivity: 'moderate' }
  }
  
  const latest = Array.isArray(dataContext.health) 
    ? dataContext.health[dataContext.health.length - 1] 
    : dataContext.health
  
  let needsRest = false
  let recommendedActivity = 'moderate'
  
  if (latest.sleep_duration && latest.sleep_duration < 360) {
    needsRest = true
    recommendedActivity = 'light'
  }
  
  if (latest.hrv && latest.hrv < 25) {
    needsRest = true
    recommendedActivity = 'light'
  }
  
  if (latest.resting_heart_rate && latest.resting_heart_rate > 85) {
    needsRest = true
    recommendedActivity = 'light'
  }
  
  return { needsRest, recommendedActivity }
}

