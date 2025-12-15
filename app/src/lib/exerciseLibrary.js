/**
 * Exercise Library Database Functions
 * Manage exercise library and custom exercises
 */

import { supabase } from './supabase'
import { logError } from '../utils/logger'

/**
 * Get all system exercises (non-custom)
 */
export async function getSystemExercises(filters = {}) {
  let query = supabase
    .from('exercise_library')
    .select('*')
    .eq('is_custom', false)
  
  if (filters.category) {
    query = query.eq('category', filters.category)
  }
  if (filters.bodyPart) {
    query = query.eq('body_part', filters.bodyPart)
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
export async function getCustomExercises(userId) {
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
export async function createCustomExercise(userId, exercise) {
  const { data, error } = await supabase
    .from('exercise_library')
    .insert({
      name: exercise.name,
      category: exercise.category || 'strength',
      body_part: exercise.bodyPart || 'Other',
      sub_body_parts: exercise.subBodyParts || [],
      equipment: exercise.equipment || [],
      is_custom: true,
      created_by_user_id: userId,
      description: exercise.description || null,
      instructions: exercise.instructions || null
    })
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
export async function updateCustomExercise(userId, exerciseId, updates) {
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
export async function deleteCustomExercise(userId, exerciseId) {
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
export async function getExerciseByName(userId, exerciseName) {
  // Try system exercise first
  const { data: systemExercise } = await supabase
    .from('exercise_library')
    .select('*')
    .eq('name', exerciseName)
    .eq('is_custom', false)
    .maybeSingle()
  
  if (systemExercise) return systemExercise
  
  // Try user's custom exercise
  const { data: customExercise } = await supabase
    .from('exercise_library')
    .select('*')
    .eq('name', exerciseName)
    .eq('is_custom', true)
    .eq('created_by_user_id', userId)
    .maybeSingle()
  
  return customExercise
}

