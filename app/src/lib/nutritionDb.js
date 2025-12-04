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
    .maybeSingle()
  
  let meals = []
  let totalCalories = 0
  let totalMacros = { protein: 0, carbs: 0, fat: 0 }
  
  if (existing && existing.meals) {
    try {
      meals = typeof existing.meals === 'string' ? JSON.parse(existing.meals) : existing.meals
      if (!Array.isArray(meals)) meals = []
      totalCalories = Number(existing.calories) || 0
      if (existing.macros) {
        totalMacros = typeof existing.macros === 'string' ? JSON.parse(existing.macros) : existing.macros
        if (!totalMacros || typeof totalMacros !== 'object') {
          totalMacros = { protein: 0, carbs: 0, fat: 0 }
        }
      }
    } catch (e) {
      console.error('Error parsing existing meals:', e)
      meals = []
      totalCalories = 0
      totalMacros = { protein: 0, carbs: 0, fat: 0 }
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
      protein: Number(mealToAdd.protein) || 0,
      carbs: Number(mealToAdd.carbs) || 0,
      fat: Number(mealToAdd.fat) || 0
    }
  } else if (!mealToAdd.macros) {
    mealToAdd.macros = { protein: 0, carbs: 0, fat: 0 }
  }
  
  // Ensure calories is a number
  mealToAdd.calories = Number(mealToAdd.calories) || 0
  
  // Check if meal with this ID already exists
  const existingMealIndex = meals.findIndex(m => m.id === mealToAdd.id)
  if (existingMealIndex >= 0) {
    // Update existing meal
    meals[existingMealIndex] = mealToAdd
  } else {
    // Add new meal
    meals.push(mealToAdd)
  }
  
  // Recalculate totals
  totalCalories = meals.reduce((sum, m) => sum + (Number(m.calories) || 0), 0)
  totalMacros = meals.reduce((macros, m) => {
    const mMacros = m.macros || {}
    return {
      protein: macros.protein + (Number(mMacros.protein) || Number(m.protein) || 0),
      carbs: macros.carbs + (Number(mMacros.carbs) || Number(m.carbs) || 0),
      fat: macros.fat + (Number(mMacros.fat) || Number(m.fat) || 0)
    }
  }, { protein: 0, carbs: 0, fat: 0 })
  
  // Save to database - JSONB columns can accept objects directly
  // But we'll stringify to ensure compatibility
  const { data, error } = await supabase
    .from('daily_metrics')
    .upsert({
      user_id: userId,
      date: date,
      calories: totalCalories,
      meals: meals, // JSONB accepts objects/arrays directly
      macros: totalMacros, // JSONB accepts objects directly
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id,date' })
    .select()
    .single()
  
  if (error) {
    console.error('Error saving meal to Supabase:', error)
    console.error('Meal data:', mealToAdd)
    console.error('Meals array:', meals)
    throw error
  }
  
  console.log('Meal saved successfully:', data)
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
    .maybeSingle()
  
  if (error && error.code !== 'PGRST116') {
    console.error('Error getting meals:', error)
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
      // Handle both JSONB (object/array) and JSON string formats
      if (typeof data.meals === 'string') {
        meals = JSON.parse(data.meals)
      } else if (Array.isArray(data.meals)) {
        meals = data.meals
      } else {
        // If it's an object but not an array, try to extract array
        meals = []
      }
      // Ensure meals is an array
      if (!Array.isArray(meals)) {
        console.warn('Meals is not an array:', meals, 'Type:', typeof meals)
        meals = []
      }
    } catch (e) {
      console.error('Error parsing meals:', e, 'Raw data:', data.meals)
      meals = []
    }
  }
  
  let macros = { protein: 0, carbs: 0, fat: 0 }
  if (data.macros) {
    try {
      // Handle both JSONB (object) and JSON string formats
      if (typeof data.macros === 'string') {
        macros = JSON.parse(data.macros)
      } else if (typeof data.macros === 'object' && !Array.isArray(data.macros)) {
        macros = data.macros
      } else {
        macros = { protein: 0, carbs: 0, fat: 0 }
      }
      // Ensure macros is an object
      if (!macros || typeof macros !== 'object' || Array.isArray(macros)) {
        console.warn('Macros is not an object:', macros, 'Type:', typeof macros)
        macros = { protein: 0, carbs: 0, fat: 0 }
      }
    } catch (e) {
      console.error('Error parsing macros:', e, 'Raw data:', data.macros)
      macros = { protein: 0, carbs: 0, fat: 0 }
    }
  }
  
  console.log('Loaded meals for', date, ':', meals.length, 'meals')
  
  return {
    meals: meals || [],
    calories: Number(data.calories) || 0,
    macros: macros || { protein: 0, carbs: 0, fat: 0 },
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
  try {
    const { data, error } = await supabase
      .from('user_preferences')
      .select('nutrition_settings')
      .eq('user_id', userId)
      .maybeSingle()
    
    if (error) {
      // If column doesn't exist, return null instead of throwing
      if (error.code === '42703' || error.message?.includes('does not exist')) {
        console.warn('nutrition_settings column does not exist yet. Run migration.')
        return null
      }
      if (error.code !== 'PGRST116') {
        console.error('Error getting nutrition settings:', error)
        return null
      }
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
  } catch (e) {
    console.error('Error getting nutrition settings:', e)
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
  try {
    const { data, error } = await supabase
      .from('user_preferences')
      .select('weekly_meal_plan')
      .eq('user_id', userId)
      .maybeSingle()
    
    if (error) {
      // If column doesn't exist, return null instead of throwing
      if (error.code === '42703' || error.message?.includes('does not exist')) {
        console.warn('weekly_meal_plan column does not exist yet. Run migration.')
        return null
      }
      if (error.code !== 'PGRST116') {
        logError('Error getting weekly meal plan', error)
        return null
      }
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
  } catch (e) {
    logError('Error getting weekly meal plan', e)
    return null
  }
}

