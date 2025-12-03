/**
 * Personalization Engine
 * Generates and adjusts personalized recommendations
 */

import { generateWorkout } from './workoutGenerator.js'
import { generateNutritionStrategy } from './nutritionStrategy.js'
import { generateAdjustments } from './adjustmentStrategy.js'

/**
 * Main personalization function
 */
export async function personalize(userId, dataContext, mlResults, aiResults) {
  const personalization = {
    workout: null,
    nutrition: null,
    adjustments: null
  }
  
  try {
    // Generate workout recommendations
    personalization.workout = await generateWorkout(
      userId,
      dataContext,
      mlResults,
      aiResults
    )
    
    // Generate nutrition strategy
    personalization.nutrition = await generateNutritionStrategy(
      userId,
      dataContext,
      mlResults,
      aiResults
    )
    
    // Generate adjustments
    personalization.adjustments = await generateAdjustments(
      userId,
      dataContext,
      mlResults,
      aiResults
    )
    
    return personalization
  } catch (error) {
    console.error('Personalization error:', error)
    throw error
  }
}

