/**
 * Goals Database Functions
 * Save and retrieve goals data from Supabase
 */

import { supabase } from './supabase'
import { logError } from '../utils/logger'

/**
 * Save a goal to database
 */
export async function saveGoalToSupabase(userId, goal) {
  const { data, error } = await supabase
    .from('goals')
    .upsert({
      user_id: userId,
      id: goal.id || undefined,
      category: goal.category, // 'fitness', 'nutrition', 'health', 'custom'
      type: goal.type, // e.g., 'calories', 'protein', 'workouts_per_week', 'steps', 'weight'
      target_value: goal.targetValue,
      current_value: goal.currentValue || 0,
      unit: goal.unit || '',
      start_date: goal.startDate,
      end_date: goal.endDate || null,
      status: goal.status || 'active', // 'active', 'completed', 'archived'
      custom_name: goal.customName || null,
      description: goal.description || null,
      is_daily_goal: goal.isDailyGoal || false,
      daily_achievements: goal.dailyAchievements || null,
      progress_percentage: goal.progressPercentage || 0,
      last_calculated_at: goal.lastCalculatedAt || null,
      created_at: goal.createdAt || new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'id'
    })
    .select()
    .single()

  if (error) {
    logError('Error saving goal', error)
    throw error
  }
  return data
}

/**
 * Get all goals for a user
 */
export async function getGoalsFromSupabase(userId, filters = {}) {
  let query = supabase
    .from('goals')
    .select('*')
    .eq('user_id', userId)

  if (filters.category) {
    query = query.eq('category', filters.category)
  }
  if (filters.status) {
    query = query.eq('status', filters.status)
  }
  if (filters.startDate) {
    query = query.gte('start_date', filters.startDate)
  }
  if (filters.endDate) {
    query = query.lte('end_date', filters.endDate)
  }

  query = query.order('created_at', { ascending: false })

  const { data, error } = await query

  if (error) {
    logError('Error getting goals', error)
    return []
  }

  return data || []
}

/**
 * Get active goals for a user
 */
export async function getActiveGoalsFromSupabase(userId, category = null) {
  const filters = { status: 'active' }
  if (category) {
    filters.category = category
  }
  return getGoalsFromSupabase(userId, filters)
}

/**
 * Update goal progress
 */
export async function updateGoalProgress(userId, goalId, currentValue, progressPercentage = null) {
  const updateData = {
    current_value: currentValue,
    updated_at: new Date().toISOString()
  }
  
  if (progressPercentage !== null) {
    updateData.progress_percentage = progressPercentage
    updateData.last_calculated_at = new Date().toISOString()
  }
  
  const { data, error } = await supabase
    .from('goals')
    .update(updateData)
    .eq('id', goalId)
    .eq('user_id', userId)
    .select()
    .single()

  if (error) {
    logError('Error updating goal progress', error)
    throw error
  }
  return data
}

/**
 * Calculate and update goal progress using database function
 */
export async function calculateGoalProgress(goalId) {
  const { data, error } = await supabase.rpc('calculate_goal_progress', {
    p_goal_id: goalId
  })

  if (error) {
    logError('Error calculating goal progress', error)
    throw error
  }
  return data
}

/**
 * Update all active goals for a user based on current logged data
 * This should be called after saving workouts, meals, or health metrics
 */
export async function updateAllUserGoals(userId) {
  try {
    // Get all active goals for the user
    const activeGoals = await getActiveGoalsFromSupabase(userId)
    
    if (!activeGoals || activeGoals.length === 0) {
      return { updated: 0, errors: [] }
    }
    
    const errors = []
    let updated = 0
    
    // Update each goal's progress
    for (const goal of activeGoals) {
      try {
        await calculateGoalProgress(goal.id)
        updated++
      } catch (error) {
        logError(`Error updating goal ${goal.id}`, error)
        errors.push({ goalId: goal.id, error: error.message })
      }
    }
    
    return { updated, errors }
  } catch (error) {
    logError('Error updating all user goals', error)
    throw error
  }
}

/**
 * Update goals for a specific category (fitness, nutrition, health)
 * More efficient than updating all goals when you know the category
 */
export async function updateCategoryGoals(userId, category) {
  try {
    const categoryGoals = await getActiveGoalsFromSupabase(userId, category)
    
    if (!categoryGoals || categoryGoals.length === 0) {
      return { updated: 0, errors: [] }
    }
    
    const errors = []
    let updated = 0
    
    for (const goal of categoryGoals) {
      try {
        await calculateGoalProgress(goal.id)
        updated++
      } catch (error) {
        logError(`Error updating goal ${goal.id}`, error)
        errors.push({ goalId: goal.id, error: error.message })
      }
    }
    
    return { updated, errors }
  } catch (error) {
    logError(`Error updating ${category} goals`, error)
    throw error
  }
}

/**
 * Update daily goal achievement
 */
export async function updateDailyGoalAchievement(userId, goalId, date, achieved) {
  // Get current goal
  const { data: goal, error: fetchError } = await supabase
    .from('goals')
    .select('daily_achievements, is_daily_goal')
    .eq('id', goalId)
    .eq('user_id', userId)
    .single()

  if (fetchError || !goal || !goal.is_daily_goal) {
    throw new Error('Goal not found or not a daily goal')
  }

  const achievements = goal.daily_achievements || {}
  achievements[date] = achieved

  const { data, error } = await supabase
    .from('goals')
    .update({
      daily_achievements: achievements,
      updated_at: new Date().toISOString()
    })
    .eq('id', goalId)
    .eq('user_id', userId)
    .select()
    .single()

  if (error) {
    logError('Error updating daily goal achievement', error)
    throw error
  }
  return data
}

/**
 * Archive a goal
 */
export async function archiveGoal(userId, goalId) {
  const { data, error } = await supabase
    .from('goals')
    .update({
      status: 'archived',
      updated_at: new Date().toISOString()
    })
    .eq('id', goalId)
    .eq('user_id', userId)
    .select()
    .single()

  if (error) {
    logError('Error archiving goal', error)
    throw error
  }
  return data
}

/**
 * Delete a goal
 */
export async function deleteGoalFromSupabase(userId, goalId) {
  const { error } = await supabase
    .from('goals')
    .delete()
    .eq('id', goalId)
    .eq('user_id', userId)

  if (error) {
    logError('Error deleting goal', error)
    throw error
  }
}

