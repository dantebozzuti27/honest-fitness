/**
 * User Data Normalization
 */

import { z } from 'zod'

const UserSchema = z.object({
  userId: z.string().uuid(),
  age: z.number().min(13).max(120).optional(),
  weight: z.number().min(30).max(500).optional(), // kg
  height: z.number().min(100).max(250).optional(), // cm
  goals: z.array(z.string()).optional(),
  preferences: z.object({
    fitnessGoal: z.string().optional(),
    experienceLevel: z.string().optional(),
    availableDays: z.array(z.string()).optional(),
    sessionDuration: z.number().optional(),
    equipmentAvailable: z.array(z.string()).optional(),
    injuries: z.array(z.string()).optional()
  }).optional()
})

export async function normalizeUserData(rawData) {
  const validated = UserSchema.parse(rawData)
  
  return {
    user_id: validated.userId,
    age: validated.age || null,
    weight: validated.weight || null,
    height: validated.height || null,
    goals: validated.goals || [],
    preferences: validated.preferences || {},
    updated_at: new Date().toISOString()
  }
}

