/**
 * Anomaly Detection
 * Detects unusual patterns in user data
 */

export async function detectAnomalies(userId, dataContext) {
  const anomalies = []
  
  // Check for workout anomalies
  if (dataContext.workouts && dataContext.workouts.length > 0) {
    const recentWorkouts = dataContext.workouts.slice(-10)
    const volumes = recentWorkouts.map(w => {
      return w.workout_exercises?.reduce((sum, ex) => {
        return sum + (ex.workout_sets?.reduce((setSum, set) => {
          return setSum + ((set.weight || 0) * (set.reps || 0))
        }, 0) || 0)
      }, 0) || 0
    })
    
    if (volumes.length > 3) {
      const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length
      const latestVolume = volumes[volumes.length - 1]
      
      if (latestVolume > avgVolume * 1.5) {
        anomalies.push({
          type: 'workout',
          severity: 'warning',
          message: 'Unusually high training volume detected - risk of overtraining',
          data: { latestVolume, avgVolume }
        })
      }
    }
  }
  
  // Check for nutrition anomalies
  if (dataContext.nutrition && dataContext.nutrition.length > 0) {
    const recentNutrition = dataContext.nutrition.slice(-7)
    const calories = recentNutrition.map(n => n.calories || 0)
    const avgCalories = calories.reduce((a, b) => a + b, 0) / calories.length
    
    // Check for extreme calorie deficits or surpluses
    if (avgCalories < 1000) {
      anomalies.push({
        type: 'nutrition',
        severity: 'critical',
        message: 'Extremely low calorie intake detected - may impact recovery and performance',
        data: { avgCalories }
      })
    } else if (avgCalories > 5000) {
      anomalies.push({
        type: 'nutrition',
        severity: 'warning',
        message: 'Very high calorie intake detected',
        data: { avgCalories }
      })
    }
  }
  
  // Check for health anomalies
  if (dataContext.health) {
    const latest = Array.isArray(dataContext.health) 
      ? dataContext.health[dataContext.health.length - 1] 
      : dataContext.health
    
    if (latest.sleep_duration && latest.sleep_duration < 300) {
      anomalies.push({
        type: 'health',
        severity: 'warning',
        message: 'Insufficient sleep detected - less than 5 hours',
        data: { sleepDuration: latest.sleep_duration }
      })
    }
    
    if (latest.resting_heart_rate && latest.resting_heart_rate > 90) {
      anomalies.push({
        type: 'health',
        severity: 'warning',
        message: 'Elevated resting heart rate - may indicate stress or insufficient recovery',
        data: { restingHR: latest.resting_heart_rate }
      })
    }
  }
  
  return anomalies
}

