/**
 * Backend API Client
 * Handles all communication with the new backend system
 * 
 * @module backend
 * @description Provides functions to interact with the HonestFitness backend API
 * @requires ./supabase
 */

import { requireSupabase } from './supabase'
import { getApiBaseUrl } from './urlConfig'

// Web prod defaults to same-origin; native builds should set VITE_BACKEND_URL or VITE_PUBLIC_SITE_URL.
const API_BASE = getApiBaseUrl()

/**
 * Check if backend is available
 * @returns {Promise<boolean>} True if backend is healthy, false otherwise
 */
const HEALTH_OK_TTL_MS = 2 * 60 * 1000
const HEALTH_FAIL_TTL_MS = 15 * 1000
let healthCache = { ok: null, checkedAt: 0 }
let healthInFlight = null

async function checkBackendHealthCached() {
  const now = Date.now()

  // Cache hit: OK
  if (healthCache.ok === true && now - healthCache.checkedAt < HEALTH_OK_TTL_MS) {
    return true
  }

  // Cache hit: FAIL (avoid hammering when backend is down)
  if (healthCache.ok === false && now - healthCache.checkedAt < HEALTH_FAIL_TTL_MS) {
    return false
  }

  // De-dupe concurrent checks
  if (healthInFlight) return healthInFlight

  healthInFlight = (async () => {
    try {
      const response = await fetch(`${API_BASE}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000)
      })
      healthCache = { ok: Boolean(response.ok), checkedAt: Date.now() }
      return Boolean(response.ok)
    } catch {
      healthCache = { ok: false, checkedAt: Date.now() }
      return false
    } finally {
      healthInFlight = null
    }
  })()

  return healthInFlight
}

/**
 * Generic API request handler with authentication
 * @param {string} endpoint - API endpoint path (e.g., '/api/ml/analyze')
 * @param {Object} options - Request options (method, body, headers)
 * @returns {Promise<Object>} API response data
 * @throws {Error} If request fails or backend is unavailable
 */
async function apiRequest(endpoint, options = {}) {
  // Cached probe (avoids an extra roundtrip on every request).
  const isHealthy = await checkBackendHealthCached()
  if (!isHealthy) {
    throw new Error('Backend service is unavailable. Please try again later.')
  }

  // Get auth token
  const supabase = requireSupabase()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) {
    throw new Error('Authentication required. Please log in again.')
  }

  const url = `${API_BASE}${endpoint}`
  const config = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
      ...options.headers
    },
    ...options
  }

  if (options.body && typeof options.body === 'object') {
    config.body = JSON.stringify(options.body)
  }

  try {
    const response = await fetch(url, config)
    
    // Handle non-JSON responses
    const contentType = response.headers.get('content-type')
    let data
    if (contentType && contentType.includes('application/json')) {
      data = await response.json()
    } else {
      const text = await response.text()
      throw new Error(text || 'API request failed')
    }

    if (!response.ok) {
      throw new Error(data.error?.message || data.message || `API request failed with status ${response.status}`)
    }

    return data
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Request timeout. Please check your connection.')
    }
    // Network-level failures usually mean the backend is unreachable. Mark health as failed briefly.
    if (error instanceof TypeError) {
      healthCache = { ok: false, checkedAt: Date.now() }
    }
    // Error is already handled by caller, no need to log here
    throw error
  }
}

/**
 * Input Layer - Submit workout data
 * @param {Object} workoutData - Workout data object
 * @param {string} workoutData.user_id - User ID
 * @param {string} workoutData.date - Workout date (YYYY-MM-DD)
 * @param {number} workoutData.duration - Duration in seconds
 * @param {Array} workoutData.exercises - Array of exercise objects
 * @returns {Promise<Object>} API response
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
 * @param {string} userId - User ID
 * @param {Object} dateRange - Date range for analysis
 * @param {string} [dateRange.startDate] - Start date (YYYY-MM-DD)
 * @param {string} [dateRange.endDate] - End date (YYYY-MM-DD)
 * @returns {Promise<Object>} ML analysis results
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
 * @param {string} userId - User ID
 * @returns {Promise<Object>} AI-generated insights
 */
export async function getInsights(userId) {
  return apiRequest('/api/ml/insights', {
    method: 'POST',
    body: { userId }
  })
}

/**
 * ML Engine - Get page-specific insights
 * @param {string} page - Page key, e.g. 'Nutrition', 'Health'
 * @param {Object} context - lightweight page context (selected date, totals, etc.)
 */
export async function getPageInsights(page, context = {}) {
  return apiRequest('/api/ml/page-insights', {
    method: 'POST',
    body: { page, context }
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
 * @param {string} userId - User ID
 * @param {Object} dateRange - Date range for dashboard data
 * @param {string} [dateRange.startDate] - Start date (YYYY-MM-DD)
 * @param {string} [dateRange.endDate] - End date (YYYY-MM-DD)
 * @returns {Promise<Object>} Analytics dashboard data
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

