/**
 * Exercise Library Database Functions
 * Manage exercise library and custom exercises
 */

import { db } from './dbClient'
import { logError } from '../utils/logger'

const supabase: any = db as any

/**
 * Get all system exercises (non-custom)
 */
export async function getSystemExercises(filters: { category?: string; bodyPart?: string; search?: string } = {}) {
  let query = supabase
    .from('exercise_library')
    .select('*')
    .eq('is_custom', false)
  
  if (filters.category) {
    query = query.eq('category', filters.category)
  }
  if (filters.bodyPart) {
    query = query.ilike('body_part', filters.bodyPart)
  }
  if (filters.search) {
    query = query.ilike('name', `%${filters.search}%`)
  }
  
  query = query.order('name', { ascending: true })
  
  const { data, error } = await query
  
  if (error) {
    logError('Error getting system exercises', error)
    return []
  }
  
  return data || []
}

/**
 * Get user's custom exercises
 */
export async function getCustomExercises(userId: string) {
  const { data, error } = await supabase
    .from('exercise_library')
    .select('*')
    .eq('is_custom', true)
    .eq('created_by_user_id', userId)
    .order('name', { ascending: true })
  
  if (error) {
    logError('Error getting custom exercises', error)
    return []
  }
  
  return data || []
}

/**
 * Create a custom exercise
 */
export async function createCustomExercise(userId: string, exercise: any) {
  const insertPayload: Record<string, any> = {
    name: exercise.name,
    category: exercise.category || 'strength',
    body_part: exercise.bodyPart || 'Other',
    sub_body_parts: exercise.subBodyParts || [],
    equipment: exercise.equipment || [],
    is_custom: true,
    created_by_user_id: userId,
    description: exercise.description || null,
    instructions: exercise.instructions || null
  }

  if (exercise.primary_muscles) insertPayload.primary_muscles = exercise.primary_muscles
  if (exercise.secondary_muscles) insertPayload.secondary_muscles = exercise.secondary_muscles
  if (exercise.movement_pattern) insertPayload.movement_pattern = exercise.movement_pattern
  if (exercise.ml_exercise_type) insertPayload.ml_exercise_type = exercise.ml_exercise_type

  const { data, error } = await supabase
    .from('exercise_library')
    .insert(insertPayload)
    .select()
    .single()
  
  if (error) {
    logError('Error creating custom exercise', error)
    throw error
  }
  
  return data
}

/**
 * Update a custom exercise
 */
export async function updateCustomExercise(userId: string, exerciseId: string, updates: any) {
  const { data, error } = await supabase
    .from('exercise_library')
    .update({
      name: updates.name,
      category: updates.category,
      body_part: updates.bodyPart,
      sub_body_parts: updates.subBodyParts,
      equipment: updates.equipment,
      description: updates.description,
      instructions: updates.instructions,
      updated_at: new Date().toISOString()
    })
    .eq('id', exerciseId)
    .eq('created_by_user_id', userId)
    .eq('is_custom', true)
    .select()
    .single()
  
  if (error) {
    logError('Error updating custom exercise', error)
    throw error
  }
  
  return data
}

/**
 * Delete a custom exercise
 */
export async function deleteCustomExercise(userId: string, exerciseId: string) {
  const { error } = await supabase
    .from('exercise_library')
    .delete()
    .eq('id', exerciseId)
    .eq('created_by_user_id', userId)
    .eq('is_custom', true)
  
  if (error) {
    logError('Error deleting custom exercise', error)
    throw error
  }
}

/**
 * Get exercise by name (system or custom for user)
 */
export async function getExerciseByName(userId: string, exerciseName: string) {
  // Try system exercise first (case-insensitive to handle casing mismatches)
  const { data: systemExercise } = await supabase
    .from('exercise_library')
    .select('*')
    .ilike('name', exerciseName)
    .eq('is_custom', false)
    .maybeSingle()
  
  if (systemExercise) return systemExercise
  
  // Try user's custom exercise
  const { data: customExercise } = await supabase
    .from('exercise_library')
    .select('*')
    .ilike('name', exerciseName)
    .eq('is_custom', true)
    .eq('created_by_user_id', userId)
    .maybeSingle()
  
  return customExercise
}

