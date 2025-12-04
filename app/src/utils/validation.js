/**
 * Input Validation Utilities
 * Provides validation functions for form inputs
 */

/**
 * Validate number input
 */
export function validateNumber(value, min = null, max = null) {
  const num = Number(value)
  if (isNaN(num)) return { valid: false, error: 'Must be a number' }
  if (min !== null && num < min) return { valid: false, error: `Must be at least ${min}` }
  if (max !== null && num > max) return { valid: false, error: `Must be at most ${max}` }
  return { valid: true, value: num }
}

/**
 * Validate date input
 */
export function validateDate(value) {
  const date = new Date(value)
  if (isNaN(date.getTime())) return { valid: false, error: 'Invalid date' }
  // Don't allow future dates
  if (date > new Date()) return { valid: false, error: 'Date cannot be in the future' }
  return { valid: true, value: value }
}

/**
 * Validate required field
 */
export function validateRequired(value) {
  if (!value || (typeof value === 'string' && value.trim() === '')) {
    return { valid: false, error: 'This field is required' }
  }
  return { valid: true, value }
}

/**
 * Validate email
 */
export function validateEmail(value) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(value)) {
    return { valid: false, error: 'Invalid email address' }
  }
  return { valid: true, value }
}

/**
 * Validate weight (lbs)
 */
export function validateWeight(value) {
  const result = validateNumber(value, 50, 1000)
  if (!result.valid) return result
  return { valid: true, value: result.value }
}

/**
 * Validate calories
 */
export function validateCalories(value) {
  const result = validateNumber(value, 0, 10000)
  if (!result.valid) return result
  return { valid: true, value: result.value }
}

/**
 * Validate macros (protein, carbs, fat)
 */
export function validateMacro(value) {
  const result = validateNumber(value, 0, 1000)
  if (!result.valid) return result
  return { valid: true, value: result.value }
}

/**
 * Validate sleep score (0-100)
 */
export function validateSleepScore(value) {
  const result = validateNumber(value, 0, 100)
  if (!result.valid) return result
  return { valid: true, value: result.value }
}

/**
 * Validate HRV (ms)
 */
export function validateHRV(value) {
  const result = validateNumber(value, 0, 200)
  if (!result.valid) return result
  return { valid: true, value: result.value }
}

/**
 * Validate steps
 */
export function validateSteps(value) {
  const result = validateNumber(value, 0, 100000)
  if (!result.valid) return result
  return { valid: true, value: result.value }
}

/**
 * Validate resting heart rate (bpm)
 */
export function validateRestingHeartRate(value) {
  const result = validateNumber(value, 30, 200)
  if (!result.valid) return result
  return { valid: true, value: result.value }
}

/**
 * Validate body temperature (°F)
 */
export function validateBodyTemperature(value) {
  const result = validateNumber(value, 90, 110)
  if (!result.valid) return result
  return { valid: true, value: result.value }
}

