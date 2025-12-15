/**
 * CalAI API Integration
 * Handles workout and nutrition plan generation via CalAI
 */

/**
 * Generate workout plan using CalAI
 */
export async function generateCalAIWorkout(userId, preferences, context) {
  if (!process.env.CALAI_API_KEY) {
    throw new Error('CalAI API key not configured')
  }
  
  const response = await fetch('https://api.calai.app/v1/workout/generate', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.CALAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      userId,
      preferences,
      context,
      goal: preferences.fitnessGoal || 'general_fitness'
    })
  })
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(`CalAI workout generation failed: ${error.message || 'Unknown error'}`)
  }
  
  return await response.json()
}

/**
 * Generate nutrition plan using CalAI
 */
export async function generateCalAINutrition(userId, targets, goals) {
  if (!process.env.CALAI_API_KEY) {
    throw new Error('CalAI API key not configured')
  }
  
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
    const error = await response.json().catch(() => ({}))
    throw new Error(`CalAI nutrition generation failed: ${error.message || 'Unknown error'}`)
  }
  
  return await response.json()
}

/**
 * Analyze meal from image using CalAI
 */
export async function analyzeMealImage(userId, imageData) {
  if (!process.env.CALAI_API_KEY) {
    throw new Error('CalAI API key not configured')
  }
  
  const response = await fetch('https://api.calai.app/v1/analyze', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.CALAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      userId,
      image: imageData,
      type: 'image'
    })
  })
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(`CalAI meal analysis failed: ${error.message || 'Unknown error'}`)
  }
  
  return await response.json()
}

