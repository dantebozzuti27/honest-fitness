/**
 * Utility functions for safe number conversion
 * Ensures INTEGER columns get whole numbers, NUMERIC columns get proper numbers
 */

/**
 * Safely convert a value to an integer (for INTEGER database columns)
 * Handles strings, numbers, null, undefined, empty strings
 * Always rounds to nearest integer
 */
export function toInteger(value) {
  if (value === null || value === undefined || value === '') {
    return null
  }
  
  const num = Number(value)
  if (isNaN(num)) {
    return null
  }
  
  return Math.round(num)
}

/**
 * Safely convert a value to a number (for NUMERIC database columns)
 * Handles strings, numbers, null, undefined, empty strings
 */
export function toNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null
  }
  
  const num = Number(value)
  if (isNaN(num)) {
    return null
  }
  
  return num
}

/**
 * Safely convert steps to integer (specific helper for steps column)
 */
export function toStepsInteger(value) {
  return toInteger(value)
}


