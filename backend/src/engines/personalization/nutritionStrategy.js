/**
 * Nutrition Strategy
 * Calculates macro targets and builds meal plans
 */

import { generateAINutritionPlan } from '../ai/index.js'

export async function generateNutritionStrategy(userId, dataContext, mlResults, aiResults) {
  // Calculate base targets
  const baseTargets = calculateBaseTargets(dataContext.user, dataContext.health)
  
  // Adjust based on goals
  const adjustedTargets = adjustForGoals(baseTargets, dataContext.user?.goals || [])
  
  // Adjust based on activity level
  const finalTargets = adjustForActivity(adjustedTargets, dataContext.health, mlResults)
  
  // Generate meal plan (using AI or CalAI)
  let mealPlan = null
  
  // Try CalAI first if available
  if (process.env.CALAI_API_KEY) {
    try {
      mealPlan = await generateCalAIMealPlan(userId, finalTargets, dataContext.user?.goals || [])
    } catch (error) {
      console.error('CalAI meal plan generation failed:', error)
    }
  }
  
  // Fallback to OpenAI if CalAI fails
  if (!mealPlan) {
    mealPlan = await generateAINutritionPlan(userId, dataContext, dataContext.user?.goals || [])
  }
  
  return {
    targets: finalTargets,
    mealPlan,
    guidance: generateNutritionGuidance(dataContext, mlResults),
    generatedAt: new Date().toISOString()
  }
}

function calculateBaseTargets(user, health) {
  // Base calculation (simplified - would use more sophisticated formulas in production)
  const weight = user?.weight || 70 // kg
  const height = user?.height || 170 // cm
  const age = user?.age || 30
  
  // BMR calculation (Mifflin-St Jeor)
  const bmr = 10 * weight + 6.25 * height - 5 * age + 5 // Male formula (simplified)
  
  // TDEE (Total Daily Energy Expenditure)
  const activityMultiplier = health?.steps > 10000 ? 1.55 : 1.375
  const tdee = bmr * activityMultiplier
  
  // Base macros (simplified)
  const protein = weight * 2.2 // 2.2g per kg bodyweight
  const fat = (tdee * 0.25) / 9 // 25% of calories from fat
  const carbs = (tdee - (protein * 4) - (fat * 9)) / 4 // Remaining calories from carbs
  
  return {
    calories: Math.round(tdee),
    protein: Math.round(protein),
    carbs: Math.round(carbs),
    fat: Math.round(fat)
  }
}

function adjustForGoals(targets, goals) {
  let adjusted = { ...targets }
  
  if (goals.includes('weight_loss') || goals.includes('fat_loss')) {
    adjusted.calories = Math.round(adjusted.calories * 0.85) // 15% deficit
    adjusted.protein = Math.round(adjusted.protein * 1.1) // Increase protein
  } else if (goals.includes('muscle_gain') || goals.includes('bulk')) {
    adjusted.calories = Math.round(adjusted.calories * 1.15) // 15% surplus
    adjusted.protein = Math.round(adjusted.protein * 1.2) // Higher protein
    adjusted.carbs = Math.round(adjusted.carbs * 1.1) // More carbs for energy
  }
  
  return adjusted
}

function adjustForActivity(targets, health, mlResults) {
  let adjusted = { ...targets }
  
  // Adjust based on daily activity
  if (health?.active_calories) {
    const activityCalories = health.active_calories
    adjusted.calories = Math.round(adjusted.calories + (activityCalories * 0.5)) // Add 50% of activity calories
  }
  
  // Adjust based on workout volume
  if (mlResults.workoutAnalysis?.avgVolume) {
    const volume = mlResults.workoutAnalysis.avgVolume
    if (volume > 10000) {
      adjusted.calories = Math.round(adjusted.calories * 1.1)
      adjusted.carbs = Math.round(adjusted.carbs * 1.15) // More carbs for high volume
    }
  }
  
  return adjusted
}

async function generateCalAIMealPlan(userId, targets, goals) {
  const response = await fetch('https://api.calai.app/v1/nutrition/plan', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.CALAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      userId,
      targets,
      goals
    })
  })
  
  if (!response.ok) {
    throw new Error('CalAI meal plan generation failed')
  }
  
  return await response.json()
}

function generateNutritionGuidance(dataContext, mlResults) {
  const guidance = []
  
  if (mlResults.nutritionAnalysis) {
    if (mlResults.nutritionAnalysis.consistency < 70) {
      guidance.push('Focus on consistent daily calorie intake for better results')
    }
    
    if (mlResults.nutritionAnalysis.insights) {
      guidance.push(...mlResults.nutritionAnalysis.insights)
    }
  }
  
  return guidance
}

