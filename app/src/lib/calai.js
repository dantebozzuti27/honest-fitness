/**
 * Cal AI Integration
 * Docs: https://docs.calai.app
 * Endpoint: POST image or text → instant calories + macros
 */

const CALAI_API_URL = 'https://api.calai.app/v1/analyze'
const CALAI_API_KEY = import.meta.env.VITE_CALAI_API_KEY || ''

/**
 * Analyze meal from image or text
 * @param {File|string} input - Image file or text description
 * @returns {Promise<{calories: number, macros: {protein: number, carbs: number, fat: number}, foods: Array}>}
 */
export async function analyzeMeal(input) {
  if (!CALAI_API_KEY) {
    throw new Error('Cal AI API key not configured. Set VITE_CALAI_API_KEY in environment variables.')
  }
  
  let formData
  let contentType
  
  if (input instanceof File) {
    // Image upload
    formData = new FormData()
    formData.append('image', input)
    contentType = undefined // Let browser set Content-Type with boundary
  } else {
    // Text description
    formData = new FormData()
    formData.append('text', input)
    contentType = undefined
  }
  
  try {
    const response = await fetch(CALAI_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CALAI_API_KEY}`
      },
      body: formData
    })
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }))
      throw new Error(error.message || `API error: ${response.status}`)
    }
    
    const data = await response.json()
    
    // Parse Cal AI response format
    // Adjust based on actual API response structure
    return {
      calories: data.calories || 0,
      macros: {
        protein: data.protein || data.macros?.protein || 0,
        carbs: data.carbs || data.macros?.carbs || 0,
        fat: data.fat || data.macros?.fat || 0
      },
      foods: data.foods || data.items || [],
      confidence: data.confidence || null
    }
  } catch (error) {
    // Re-throw with original error for caller to handle
    throw error
  }
}

/**
 * Analyze meal from image file
 */
export async function analyzeMealFromImage(imageFile) {
  return analyzeMeal(imageFile)
}

/**
 * Analyze meal from text description
 */
export async function analyzeMealFromText(text) {
  return analyzeMeal(text)
}

/**
 * Calculate calories needed to burn based on current deficit/surplus
 * Used for Ghost Mode recommendations
 */
export function calculateActivityNeeded(currentCalories, targetCalories, caloriesPerMinute = 5) {
  const difference = currentCalories - targetCalories
  
  if (difference <= 0) {
    return { minutes: 0, message: 'You\'re on track!' }
  }
  
  const minutesNeeded = Math.ceil(difference / caloriesPerMinute)
  
  return {
    minutes: minutesNeeded,
    message: `Walk ${minutesNeeded} more minutes or reduce intake by ${difference} calories`
  }
}

