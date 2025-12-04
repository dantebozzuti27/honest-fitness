/**
 * Nutrition Database Functions
 * Save and retrieve food/meal data from Supabase
 */

import { supabase } from './supabase'
import { logError } from '../utils/logger'

/**
 * Save meal data to database
 */
export async function saveMealToSupabase(userId, date, meal) {
  // Save to a nutrition/meals table
  // For now, we'll use daily_metrics and store meals as JSON
  // In production, you'd want a separate meals table
  
  // First, get existing data for the date
  const { data: existing, error: fetchError } = await supabase
    .from('daily_metrics')
    .select('*')
    .eq('user_id', userId)
    .eq('date', date)
    .single()
  
  let meals = []
  let totalCalories = meal.calories || 0
  let totalMacros = { 
    protein: meal.macros?.protein || meal.protein || 0, 
    carbs: meal.macros?.carbs || meal.carbs || 0, 
    fat: meal.macros?.fat || meal.fat || 0 
  }
  
  if (existing && existing.meals) {
    try {
      meals = typeof existing.meals === 'string' ? JSON.parse(existing.meals) : existing.meals
      totalCalories = existing.calories || 0
      totalMacros = existing.macros ? (typeof existing.macros === 'string' ? JSON.parse(existing.macros) : existing.macros) : { protein: 0, carbs: 0, fat: 0 }
    } catch (e) {
      meals = []
    }
  }
  
  // Add new meal (don't duplicate if already has id)
  const mealToAdd = meal.id 
    ? meal 
    : {
        ...meal,
        id: Date.now().toString(),
        timestamp: new Date().toISOString()
      }
  
  // Ensure meal has proper structure
  if (!mealToAdd.macros && (mealToAdd.protein || mealToAdd.carbs || mealToAdd.fat)) {
    mealToAdd.macros = {
      protein: mealToAdd.protein || 0,
      carbs: mealToAdd.carbs || 0,
      fat: mealToAdd.fat || 0
    }
  }
  
  meals.push(mealToAdd)
  
  // Recalculate totals
  totalCalories = meals.reduce((sum, m) => sum + (m.calories || 0), 0)
  totalMacros = meals.reduce((macros, m) => ({
    protein: macros.protein + (m.macros?.protein || m.protein || 0),
    carbs: macros.carbs + (m.macros?.carbs || m.carbs || 0),
    fat: macros.fat + (m.macros?.fat || m.fat || 0)
  }), { protein: 0, carbs: 0, fat: 0 })
  
  // Save to database
  const { data, error } = await supabase
    .from('daily_metrics')
    .upsert({
      user_id: userId,
      date: date,
      calories: totalCalories,
      meals: JSON.stringify(meals),
      macros: JSON.stringify(totalMacros),
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id,date' })
    .select()
    .single()
  
  if (error) throw error
  return data
}

/**
 * Get meals for a date
 */
export async function getMealsFromSupabase(userId, date) {
  const { data, error } = await supabase
    .from('daily_metrics')
    .select('*')
    .eq('user_id', userId)
    .eq('date', date)
    .single()
  
  if (error && error.code !== 'PGRST116') {
    logError('Error getting meals', error)
    // Return empty data instead of throwing
    return { meals: [], calories: 0, macros: { protein: 0, carbs: 0, fat: 0 }, water: 0 }
  }
  
  if (!data) {
    return { meals: [], calories: 0, macros: { protein: 0, carbs: 0, fat: 0 }, water: 0 }
  }
  
  let meals = []
  if (data.meals) {
    try {
      meals = typeof data.meals === 'string' ? JSON.parse(data.meals) : data.meals
      // Ensure meals is an array
      if (!Array.isArray(meals)) {
        meals = []
      }
    } catch (e) {
      console.error('Error parsing meals:', e)
      meals = []
    }
  }
  
  let macros = { protein: 0, carbs: 0, fat: 0 }
  if (data.macros) {
    try {
      macros = typeof data.macros === 'string' ? JSON.parse(data.macros) : data.macros
      // Ensure macros is an object
      if (!macros || typeof macros !== 'object') {
        macros = { protein: 0, carbs: 0, fat: 0 }
      }
    } catch (e) {
      console.error('Error parsing macros:', e)
      macros = { protein: 0, carbs: 0, fat: 0 }
    }
  }
  
  return {
    meals,
    calories: Number(data.calories) || 0,
    macros,
    water: Number(data.water) || 0
  }
}

/**
 * Get all nutrition data for date range
 */
export async function getNutritionRangeFromSupabase(userId, startDate, endDate) {
  const { data, error } = await supabase
    .from('daily_metrics')
    .select('*')
    .eq('user_id', userId)
    .gte('date', startDate)
    .lte('date', endDate)
    .not('calories', 'is', null)
    .order('date', { ascending: true })
  
  if (error) throw error
  
  return (data || []).map(item => {
    let meals = []
    let macros = { protein: 0, carbs: 0, fat: 0 }
    
    if (item.meals) {
      try {
        meals = typeof item.meals === 'string' ? JSON.parse(item.meals) : item.meals
      } catch (e) {
        meals = []
      }
    }
    
    if (item.macros) {
      try {
        macros = typeof item.macros === 'string' ? JSON.parse(item.macros) : item.macros
      } catch (e) {
        macros = { protein: 0, carbs: 0, fat: 0 }
      }
    }
    
    return {
      date: item.date,
      meals,
      calories: item.calories || 0,
      macros,
      water: item.water || 0
    }
  })
}

/**
 * Update water intake
 */
export async function updateWaterIntake(userId, date, water) {
  const { data, error } = await supabase
    .from('daily_metrics')
    .upsert({
      user_id: userId,
      date: date,
      water: water,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id,date' })
    .select()
    .single()
  
  if (error) throw error
  return data
}

/**
 * Delete a meal
 */
export async function deleteMealFromSupabase(userId, date, mealId) {
  // Get existing data
  const { data: existing, error: fetchError } = await supabase
    .from('daily_metrics')
    .select('*')
    .eq('user_id', userId)
    .eq('date', date)
    .single()
  
  if (fetchError && fetchError.code !== 'PGRST116') throw fetchError
  
  if (!existing || !existing.meals) return
  
  let meals = []
  try {
    meals = typeof existing.meals === 'string' ? JSON.parse(existing.meals) : existing.meals
  } catch (e) {
    return
  }
  
  // Remove meal
  meals = meals.filter(m => m.id !== mealId)
  
  // Recalculate totals
  const totalCalories = meals.reduce((sum, m) => sum + (m.calories || 0), 0)
  const totalMacros = meals.reduce((macros, m) => ({
    protein: macros.protein + (m.macros?.protein || m.protein || 0),
    carbs: macros.carbs + (m.macros?.carbs || m.carbs || 0),
    fat: macros.fat + (m.macros?.fat || m.fat || 0)
  }), { protein: 0, carbs: 0, fat: 0 })
  
  // Save updated data
  const { error } = await supabase
    .from('daily_metrics')
    .upsert({
      user_id: userId,
      date: date,
      calories: totalCalories,
      meals: JSON.stringify(meals),
      macros: JSON.stringify(totalMacros),
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id,date' })
  
  if (error) throw error
}

/**
 * Save nutrition settings (targets, favorites, fasting) to database
 */
export async function saveNutritionSettingsToSupabase(userId, settings) {
  const { data, error } = await supabase
    .from('user_preferences')
    .upsert({
      user_id: userId,
      nutrition_settings: JSON.stringify({
        targetCalories: settings.targetCalories,
        targetMacros: settings.targetMacros,
        favorites: settings.favorites || [],
        fastingEnabled: settings.fastingEnabled || false,
        fastingStartTime: settings.fastingStartTime || null
      }),
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' })
    .select()
    .single()
  
  if (error) throw error
  return data
}

/**
 * Get nutrition settings from database
 */
export async function getNutritionSettingsFromSupabase(userId) {
  const { data, error } = await supabase
    .from('user_preferences')
    .select('nutrition_settings')
    .eq('user_id', userId)
    .single()
  
  if (error && error.code !== 'PGRST116') {
    console.error('Error getting nutrition settings:', error)
    return null
  }
  
  if (!data || !data.nutrition_settings) {
    return null
  }
  
  try {
    return typeof data.nutrition_settings === 'string' 
      ? JSON.parse(data.nutrition_settings) 
      : data.nutrition_settings
  } catch (e) {
    console.error('Error parsing nutrition settings:', e)
    return null
  }
}

/**
 * Save weekly meal plan to database
 */
export async function saveWeeklyMealPlanToSupabase(userId, mealPlan) {
  const { data, error } = await supabase
    .from('user_preferences')
    .upsert({
      user_id: userId,
      weekly_meal_plan: JSON.stringify(mealPlan),
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' })
    .select()
    .single()
  
  if (error) throw error
  return data
}

/**
 * Get weekly meal plan from database
 */
export async function getWeeklyMealPlanFromSupabase(userId) {
  const { data, error } = await supabase
    .from('user_preferences')
    .select('weekly_meal_plan')
    .eq('user_id', userId)
    .single()
  
  if (error && error.code !== 'PGRST116') {
    logError('Error getting weekly meal plan', error)
    return null
  }
  
  if (!data || !data.weekly_meal_plan) {
    return null
  }
  
  try {
    return typeof data.weekly_meal_plan === 'string' 
      ? JSON.parse(data.weekly_meal_plan) 
      : data.weekly_meal_plan
  } catch (e) {
    console.error('Error parsing weekly meal plan:', e)
    return null
  }
}

