/**
 * Health Data Normalization
 * Normalizes data from Fitbit, Apple Health, Google Fit, etc.
 */

import { z } from 'zod'

const HealthSchema = z.object({
  userId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: z.enum(['fitbit', 'apple_health', 'google_fit', 'manual']),
  steps: z.number().nullable().optional(),
  hrv: z.number().nullable().optional(),
  sleepDuration: z.number().nullable().optional(), // minutes
  sleepEfficiency: z.number().nullable().optional(),
  caloriesBurned: z.number().nullable().optional(),
  activeCalories: z.number().nullable().optional(),
  restingHeartRate: z.number().nullable().optional(),
  distance: z.number().nullable().optional(), // km
  floors: z.number().nullable().optional(),
  bodyTemp: z.number().nullable().optional(),
  rawData: z.record(z.any()).optional() // Store raw API response
})

export async function normalizeHealthData(rawData) {
  const validated = HealthSchema.parse(rawData)
  
  return {
    user_id: validated.userId,
    date: validated.date,
    source: validated.source,
    steps: validated.steps || null,
    hrv: validated.hrv || null,
    sleep_duration: validated.sleepDuration || null,
    sleep_efficiency: validated.sleepEfficiency || null,
    calories: validated.caloriesBurned || null,
    active_calories: validated.activeCalories || null,
    resting_heart_rate: validated.restingHeartRate || null,
    distance: validated.distance || null,
    floors: validated.floors || null,
    body_temp: validated.bodyTemp || null,
    raw_data: validated.rawData || null,
    normalized_at: new Date().toISOString()
  }
}

