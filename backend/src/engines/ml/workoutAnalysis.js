/**
 * Workout Trend Analysis
 */

export async function analyzeWorkoutTrends(userId, workouts) {
  if (!workouts || workouts.length === 0) {
    return null
  }
  
  // Calculate trends
  const totalWorkouts = workouts.length
  const recentWorkouts = workouts.slice(-7) // Last 7 workouts
  
  // Calculate volume trends
  const totalVolume = workouts.reduce((sum, w) => {
    return sum + (w.workout_exercises?.reduce((exSum, ex) => {
      return exSum + (ex.workout_sets?.reduce((setSum, set) => {
        return setSum + ((set.weight || 0) * (set.reps || 0))
      }, 0) || 0)
    }, 0) || 0)
  }, 0)
  
  const avgVolume = totalVolume / totalWorkouts
  
  // Body part distribution
  const bodyPartCounts = {}
  workouts.forEach(w => {
    w.workout_exercises?.forEach(ex => {
      const bp = ex.body_part || 'Other'
      bodyPartCounts[bp] = (bodyPartCounts[bp] || 0) + 1
    })
  })
  
  // Frequency analysis
  const workoutDates = workouts.map(w => new Date(w.date))
  const daysBetween = []
  for (let i = 1; i < workoutDates.length; i++) {
    const diff = (workoutDates[i] - workoutDates[i - 1]) / (1000 * 60 * 60 * 24)
    daysBetween.push(diff)
  }
  const avgFrequency = daysBetween.length > 0 
    ? daysBetween.reduce((a, b) => a + b, 0) / daysBetween.length 
    : 0
  
  return {
    totalWorkouts,
    recentWorkoutCount: recentWorkouts.length,
    totalVolume,
    avgVolume,
    bodyPartDistribution: bodyPartCounts,
    avgFrequency,
    trend: recentWorkouts.length >= 5 ? 'increasing' : 'stable',
    insights: generateWorkoutInsights(workouts, bodyPartCounts, avgFrequency)
  }
}

function generateWorkoutInsights(workouts, bodyPartCounts, frequency) {
  const insights = []
  
  if (frequency > 4) {
    insights.push('Consider adding rest days - current frequency may lead to overtraining')
  } else if (frequency < 2) {
    insights.push('Increasing workout frequency could accelerate progress')
  }
  
  const mostTrained = Object.entries(bodyPartCounts).sort((a, b) => b[1] - a[1])[0]
  const leastTrained = Object.entries(bodyPartCounts).sort((a, b) => a[1] - b[1])[0]
  
  if (mostTrained && leastTrained && mostTrained[1] > leastTrained[1] * 2) {
    insights.push(`Consider balancing training - ${leastTrained[0]} is undertrained compared to ${mostTrained[0]}`)
  }
  
  return insights
}

