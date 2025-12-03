/**
 * Backend API Client
 * Handles all communication with the new backend system
 */

const API_BASE = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001'

/**
 * Generic API request handler
 */
async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`
  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    ...options
  }

  if (options.body && typeof options.body === 'object') {
    config.body = JSON.stringify(options.body)
  }

  try {
    const response = await fetch(url, config)
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || data.message || 'API request failed')
    }

    return data
  } catch (error) {
    console.error('API request error:', error)
    throw error
  }
}

/**
 * Input Layer - Submit workout data
 */
export async function submitWorkout(workoutData) {
  return apiRequest('/api/input/workout', {
    method: 'POST',
    body: workoutData
  })
}

/**
 * Input Layer - Submit nutrition data
 */
export async function submitNutrition(nutritionData) {
  return apiRequest('/api/input/nutrition', {
    method: 'POST',
    body: nutritionData
  })
}

/**
 * Input Layer - Submit health data
 */
export async function submitHealth(healthData) {
  return apiRequest('/api/input/health', {
    method: 'POST',
    body: healthData
  })
}

/**
 * Input Layer - Submit user profile data
 */
export async function submitUserProfile(userData) {
  return apiRequest('/api/input/user', {
    method: 'POST',
    body: userData
  })
}

/**
 * ML Engine - Get analysis
 */
export async function getMLAnalysis(userId, dateRange = {}) {
  return apiRequest('/api/ml/analyze', {
    method: 'POST',
    body: { userId, dateRange }
  })
}

/**
 * ML Engine - Generate workout plan
 */
export async function generateWorkoutPlan(userId, preferences = {}) {
  return apiRequest('/api/ml/workout-plan', {
    method: 'POST',
    body: { userId, preferences }
  })
}

/**
 * ML Engine - Generate nutrition plan
 */
export async function generateNutritionPlan(userId, goals = []) {
  return apiRequest('/api/ml/nutrition-plan', {
    method: 'POST',
    body: { userId, goals }
  })
}

/**
 * ML Engine - Get insights
 */
export async function getInsights(userId) {
  return apiRequest('/api/ml/insights', {
    method: 'POST',
    body: { userId }
  })
}

/**
 * ML Engine - Generate weekly summary
 */
export async function getWeeklySummary(userId, week) {
  return apiRequest('/api/ml/weekly-summary', {
    method: 'POST',
    body: { userId, week }
  })
}

/**
 * Personalization - Generate personalized recommendations
 */
export async function getPersonalization(userId) {
  return apiRequest('/api/personalization/generate', {
    method: 'POST',
    body: { userId }
  })
}

/**
 * Output Layer - Get AI Coach guidance
 */
export async function getCoachGuidance(userId) {
  return apiRequest('/api/output/coach/guidance', {
    method: 'POST',
    body: { userId }
  })
}

/**
 * Output Layer - Get analytics dashboard
 */
export async function getAnalyticsDashboard(userId, dateRange = {}) {
  return apiRequest('/api/output/analytics/dashboard', {
    method: 'POST',
    body: { userId, dateRange }
  })
}

/**
 * Pipeline - Process data
 */
export async function processData(type, data, source = 'manual') {
  return apiRequest('/api/pipeline/process', {
    method: 'POST',
    body: { type, data, source }
  })
}

