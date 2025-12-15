/**
 * Achievement and Milestone Utilities
 * Calculates achievements, milestones, and personal records
 */

/**
 * Calculate workout achievements
 */
export function calculateWorkoutAchievements(workout, userStats = {}) {
  const achievements = []
  
  if (!workout) return achievements
  
  const duration = workout.duration || 0
  const exercises = workout.exercises || []
  const exerciseCount = exercises.length
  
  // Calculate total volume
  let totalVolume = 0
  exercises.forEach(ex => {
    const sets = ex.sets || []
    sets.forEach(set => {
      const weight = Number(set.weight) || 0
      const reps = Number(set.reps) || 0
      totalVolume += weight * reps
    })
  })
  
  // Duration milestones
  if (duration >= 3600) {
    achievements.push({ type: 'milestone', label: '1+ Hour Workout', icon: 'DURATION' })
  } else if (duration >= 1800) {
    achievements.push({ type: 'milestone', label: '30+ Min Workout', icon: 'DURATION' })
  }
  
  // Exercise count milestones
  if (exerciseCount >= 10) {
    achievements.push({ type: 'milestone', label: '10+ Exercises', icon: 'EXERCISES' })
  } else if (exerciseCount >= 5) {
    achievements.push({ type: 'milestone', label: '5+ Exercises', icon: 'EXERCISES' })
  }
  
  // Volume milestones (in pounds)
  if (totalVolume >= 10000) {
    achievements.push({ type: 'milestone', label: '10K+ Volume', icon: 'VOLUME' })
  } else if (totalVolume >= 5000) {
    achievements.push({ type: 'milestone', label: '5K+ Volume', icon: 'VOLUME' })
  }
  
  // Compare with previous workouts for PRs
  if (userStats.previousWorkout) {
    const prevDuration = userStats.previousWorkout.duration || 0
    const prevVolume = userStats.previousWorkout.totalVolume || 0
    
    if (duration > prevDuration * 1.1) {
      achievements.push({ type: 'pr', label: 'Duration PR', icon: 'PR' })
    }
    
    if (totalVolume > prevVolume * 1.1) {
      achievements.push({ type: 'pr', label: 'Volume PR', icon: 'PR' })
    }
  }
  
  // Streak achievements
  if (userStats.currentStreak >= 7) {
    achievements.push({ type: 'streak', label: `${userStats.currentStreak} Day Streak`, icon: 'STREAK' })
  }
  
  // Workout count milestones
  if (userStats.totalWorkouts >= 100) {
    achievements.push({ type: 'milestone', label: '100th Workout', icon: 'MILESTONE' })
  } else if (userStats.totalWorkouts >= 50) {
    achievements.push({ type: 'milestone', label: '50th Workout', icon: 'MILESTONE' })
  }
  
  return achievements
}

/**
 * Calculate nutrition achievements
 */
export function calculateNutritionAchievements(nutrition, userStats = {}) {
  const achievements = []
  
  if (!nutrition) return achievements
  
  const calories = Number(nutrition.calories) || 0
  const protein = Number(nutrition.protein) || 0
  
  // Calorie milestones
  if (calories >= 3000) {
    achievements.push({ type: 'milestone', label: '3K+ Calories', icon: 'CALORIES' })
  } else if (calories >= 2000) {
    achievements.push({ type: 'milestone', label: '2K+ Calories', icon: 'CALORIES' })
  }
  
  // Protein milestones
  if (protein >= 200) {
    achievements.push({ type: 'milestone', label: '200g+ Protein', icon: 'PROTEIN' })
  } else if (protein >= 150) {
    achievements.push({ type: 'milestone', label: '150g+ Protein', icon: 'PROTEIN' })
  }
  
  return achievements
}

/**
 * Calculate health achievements
 */
export function calculateHealthAchievements(health, userStats = {}) {
  const achievements = []
  
  if (!health) return achievements
  
  const steps = Number(health.steps) || 0
  const sleepTime = Number(health.sleep_time) || 0
  
  // Steps milestones
  if (steps >= 15000) {
    achievements.push({ type: 'milestone', label: '15K+ Steps', icon: 'STEPS' })
  } else if (steps >= 10000) {
    achievements.push({ type: 'milestone', label: '10K+ Steps', icon: 'STEPS' })
  }
  
  // Sleep milestones
  if (sleepTime >= 480) {
    achievements.push({ type: 'milestone', label: '8+ Hours Sleep', icon: 'SLEEP' })
  }
  
  return achievements
}

/**
 * Generate achievement-focused share text
 */
export function generateAchievementShareText(type, data, achievements = []) {
  if (type === 'workout') {
    const { workout } = data
    const duration = workout?.duration || 0
    const totalMinutes = Math.floor(duration / 60)
    const exercises = workout?.exercises?.length || 0
    
    // Calculate volume
    let totalVolume = 0
    if (workout?.exercises) {
      workout.exercises.forEach(ex => {
        const sets = ex.sets || []
        sets.forEach(set => {
          const weight = Number(set.weight) || 0
          const reps = Number(set.reps) || 0
          totalVolume += weight * reps
        })
      })
    }
    const volumeK = totalVolume >= 1000 ? `${(totalVolume / 1000).toFixed(1)}k` : Math.round(totalVolume)
    
    // Build achievement-focused text
    const parts = []
    if (achievements.length > 0) {
      const prAchievement = achievements.find(a => a.type === 'pr')
      if (prAchievement) {
        parts.push(`New ${prAchievement.label}!`)
      }
      const milestone = achievements.find(a => a.type === 'milestone')
      if (milestone) {
        parts.push(milestone.label)
      }
    }
    
    parts.push(`${totalMinutes}min workout`)
    parts.push(`${exercises} exercises`)
    if (totalVolume > 0) {
      parts.push(`${volumeK} lbs volume`)
    }
    
    return parts.join(' | ')
  }
  
  if (type === 'nutrition') {
    const { nutrition } = data
    const calories = Number(nutrition?.calories) || 0
    const protein = Number(nutrition?.protein) || 0
    
    const parts = []
    if (achievements.length > 0) {
      parts.push(achievements[0].label)
    }
    parts.push(`${calories.toLocaleString()} calories`)
    if (protein > 0) {
      parts.push(`${Math.round(protein)}g protein`)
    }
    
    return parts.join(' | ')
  }
  
  if (type === 'health') {
    const { health } = data
    const steps = Number(health?.steps) || 0
    
    const parts = []
    if (achievements.length > 0) {
      parts.push(achievements[0].label)
    }
    if (steps > 0) {
      parts.push(`${steps.toLocaleString()} steps`)
    }
    
    return parts.join(' | ')
  }
  
  return 'Check out my progress on Echelon'
}

