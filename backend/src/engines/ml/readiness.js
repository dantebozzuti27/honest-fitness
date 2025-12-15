/**
 * Readiness Score Computation
 * Combines HRV, sleep, training load, and other factors
 */

export async function computeReadiness(userId, healthData) {
  if (!healthData) {
    return null
  }
  
  // Extract latest health metrics
  const latest = Array.isArray(healthData) ? healthData[healthData.length - 1] : healthData
  
  // Component scores (0-100)
  const sleepScore = calculateSleepScore(latest.sleep_duration, latest.sleep_efficiency)
  const hrvScore = calculateHRVScore(latest.hrv)
  const activityScore = calculateActivityScore(latest.steps, latest.active_calories)
  const recoveryScore = calculateRecoveryScore(latest.resting_heart_rate)
  
  // Weighted readiness score
  const readiness = Math.round(
    sleepScore * 0.3 +
    hrvScore * 0.3 +
    activityScore * 0.2 +
    recoveryScore * 0.2
  )
  
  // Determine zone
  let zone = 'green'
  if (readiness < 50) zone = 'red'
  else if (readiness < 70) zone = 'yellow'
  
  return {
    score: readiness,
    zone,
    components: {
      sleep: sleepScore,
      hrv: hrvScore,
      activity: activityScore,
      recovery: recoveryScore
    },
    factors: {
      sleepDuration: latest.sleep_duration,
      sleepEfficiency: latest.sleep_efficiency,
      hrv: latest.hrv,
      steps: latest.steps,
      restingHR: latest.resting_heart_rate
    }
  }
}

function calculateSleepScore(duration, efficiency) {
  if (!duration) return 50 // Default if no data
  
  // Optimal sleep: 7-9 hours
  let score = 100
  if (duration < 360) score = 30 // < 6 hours
  else if (duration < 420) score = 60 // 6-7 hours
  else if (duration > 600) score = 70 // > 10 hours
  
  // Adjust for efficiency
  if (efficiency) {
    const efficiencyScore = efficiency
    score = (score + efficiencyScore) / 2
  }
  
  return Math.round(score)
}

function calculateHRVScore(hrv) {
  if (!hrv) return 50
  
  // Normal HRV range varies by person, but generally 20-60ms is common
  // Higher is generally better
  if (hrv < 20) return 30
  if (hrv < 30) return 50
  if (hrv < 50) return 70
  if (hrv < 70) return 85
  return 100
}

function calculateActivityScore(steps, activeCalories) {
  if (!steps && !activeCalories) return 50
  
  let score = 50
  
  if (steps) {
    if (steps >= 10000) score = 100
    else if (steps >= 7500) score = 80
    else if (steps >= 5000) score = 60
    else score = 40
  }
  
  if (activeCalories) {
    const calorieScore = activeCalories >= 500 ? 100 : (activeCalories / 500 * 100)
    score = (score + calorieScore) / 2
  }
  
  return Math.round(score)
}

function calculateRecoveryScore(restingHR) {
  if (!restingHR) return 50
  
  // Lower resting HR generally indicates better recovery
  // Normal range: 60-100 bpm
  if (restingHR < 60) return 100 // Excellent
  if (restingHR < 70) return 85
  if (restingHR < 80) return 70
  if (restingHR < 90) return 55
  return 40 // Elevated
}

