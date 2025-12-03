/**
 * Abstraction Layer
 * Normalizes and validates all incoming data
 */

import { z } from 'zod'
import { normalizeWorkoutData } from './workout.js'
import { normalizeNutritionData } from './nutrition.js'
import { normalizeHealthData } from './health.js'
import { normalizeUserData } from './user.js'

/**
 * Normalize and validate incoming data based on type
 */
export async function normalizeData(type, rawData) {
  switch (type) {
    case 'workout':
      return await normalizeWorkoutData(rawData)
    case 'nutrition':
      return await normalizeNutritionData(rawData)
    case 'health':
      return await normalizeHealthData(rawData)
    case 'user':
      return await normalizeUserData(rawData)
    default:
      throw new Error(`Unknown data type: ${type}`)
  }
}

/**
 * Validate data against schema
 */
export function validateSchema(schema, data) {
  try {
    return schema.parse(data)
  } catch (error) {
    throw new Error(`Validation failed: ${error.message}`)
  }
}

