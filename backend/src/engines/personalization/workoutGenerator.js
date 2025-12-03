/**
 * Workout Generator
 * Generates and scales workout programming
 */

import { generateAIWorkoutPlan } from '../ai/index.js'

export async function generateWorkout(userId, dataContext, mlResults, aiResults) {
  // Get user preferences
  const preferences = dataContext.user?.preferences || {}
  
  // Determine workout difficulty based on readiness and trends
  let difficulty = 'moderate'
  if (mlResults.readiness?.zone === 'green') {
    difficulty = 'hard'
  } else if (mlResults.readiness?.zone === 'red') {
    difficulty = 'easy'
  }
  
  // Scale based on performance data
  const scaling = calculateScaling(dataContext, mlResults)
  
  // Generate workout plan (using AI or CalAI)
  let workoutPlan = null
  
  // Try CalAI first if available
  if (process.env.CALAI_API_KEY) {
    try {
      workoutPlan = await generateCalAIWorkout(userId, preferences, difficulty)
    } catch (error) {
      console.error('CalAI workout generation failed:', error)
    }
  }
  
  // Fallback to OpenAI if CalAI fails
  if (!workoutPlan) {
    workoutPlan = await generateAIWorkoutPlan(userId, dataContext, preferences)
  }
  
  // Apply scaling
  if (workoutPlan && scaling) {
    workoutPlan = applyScaling(workoutPlan, scaling)
  }
  
  return {
    plan: workoutPlan,
    difficulty,
    scaling,
    generatedAt: new Date().toISOString()
  }
}

async function generateCalAIWorkout(userId, preferences, difficulty) {
  // CalAI API integration for workout generation
  const response = await fetch('https://api.calai.app/v1/workout/generate', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.CALAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      userId,
      preferences,
      difficulty,
      goal: preferences.fitnessGoal || 'general_fitness'
    })
  })
  
  if (!response.ok) {
    throw new Error('CalAI workout generation failed')
  }
  
  return await response.json()
}

function calculateScaling(dataContext, mlResults) {
  const scaling = {
    volume: 1.0,
    intensity: 1.0,
    frequency: 1.0
  }
  
  // Adjust based on readiness
  if (mlResults.readiness) {
    if (mlResults.readiness.zone === 'green') {
      scaling.volume = 1.1
      scaling.intensity = 1.1
    } else if (mlResults.readiness.zone === 'red') {
      scaling.volume = 0.8
      scaling.intensity = 0.8
    }
  }
  
  // Adjust based on workout trends
  if (mlResults.workoutAnalysis) {
    if (mlResults.workoutAnalysis.trend === 'increasing') {
      scaling.volume = Math.min(scaling.volume * 1.05, 1.2)
    }
  }
  
  // Adjust based on anomalies
  if (mlResults.anomalies) {
    const overtrainingAnomaly = mlResults.anomalies.find(a => 
      a.type === 'workout' && a.message.includes('overtraining')
    )
    if (overtrainingAnomaly) {
      scaling.volume = 0.7
      scaling.intensity = 0.7
    }
  }
  
  return scaling
}

function applyScaling(workoutPlan, scaling) {
  if (!workoutPlan.exercises) return workoutPlan
  
  workoutPlan.exercises = workoutPlan.exercises.map(exercise => {
    // Scale sets
    if (exercise.sets) {
      exercise.sets = Math.round(exercise.sets * scaling.volume)
    }
    
    // Scale reps (if it's a range, adjust both)
    if (exercise.reps) {
      if (typeof exercise.reps === 'string' && exercise.reps.includes('-')) {
        const [min, max] = exercise.reps.split('-').map(Number)
        exercise.reps = `${Math.round(min * scaling.intensity)}-${Math.round(max * scaling.intensity)}`
      } else if (typeof exercise.reps === 'number') {
        exercise.reps = Math.round(exercise.reps * scaling.intensity)
      }
    }
    
    return exercise
  })
  
  return workoutPlan
}

