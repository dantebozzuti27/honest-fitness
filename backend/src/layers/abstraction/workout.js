/**
 * Workout Data Normalization
 */

import { z } from 'zod'

const WorkoutSchema = z.object({
  userId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  exercises: z.array(z.object({
    name: z.string(),
    category: z.string().optional(),
    bodyPart: z.string().optional(),
    sets: z.array(z.object({
      weight: z.number().nullable().optional(),
      reps: z.number().nullable().optional(),
      time: z.number().nullable().optional(),
      speed: z.number().nullable().optional(),
      incline: z.number().nullable().optional()
    }))
  })),
  duration: z.number().optional(),
  perceivedEffort: z.number().min(1).max(10).optional(),
  moodAfter: z.string().optional(),
  notes: z.string().optional()
})

export async function normalizeWorkoutData(rawData) {
  // Validate schema
  const validated = WorkoutSchema.parse(rawData)
  
  // Normalize to standard format
  return {
    user_id: validated.userId,
    date: validated.date,
    exercises: validated.exercises.map(ex => ({
      name: ex.name,
      category: ex.category || 'Other',
      body_part: ex.bodyPart || 'Other',
      sets: ex.sets || []
    })),
    duration: validated.duration || null,
    perceived_effort: validated.perceivedEffort || null,
    mood_after: validated.moodAfter || null,
    notes: validated.notes || null,
    normalized_at: new Date().toISOString()
  }
}

