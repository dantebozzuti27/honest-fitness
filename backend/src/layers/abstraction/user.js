/**
 * User Data Normalization
 */

import { z } from 'zod'

const UserSchema = z.object({
  userId: z.string().uuid(),
  age: z.number().min(13).max(120).optional(),
  weight: z.number().min(30).max(500).optional(), // kg
  height: z.number().min(100).max(250).optional(), // cm (legacy)
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), // YYYY-MM-DD
  gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional(),
  heightInches: z.number().min(0).max(120).optional(), // total inches
  heightFeet: z.number().min(0).max(10).optional(), // feet component
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
    height: validated.height || null, // Legacy field
    date_of_birth: validated.dateOfBirth || null,
    gender: validated.gender || null,
    height_inches: validated.heightInches || null,
    height_feet: validated.heightFeet || null,
    goals: validated.goals || [],
    preferences: validated.preferences || {},
    updated_at: new Date().toISOString()
  }
}

