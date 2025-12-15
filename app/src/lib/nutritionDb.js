/**
 * Nutrition Database Functions
 * Save and retrieve food/meal data from Supabase
 */

import { supabase } from './supabase'
import { logError, logDebug, logWarn } from '../utils/logger'
import { saveEnrichedData } from './dataEnrichment'
import { trackEvent } from './eventTracking'
import { enqueueOutboxItem } from './syncOutbox'

// Ensure logDebug is always available (fallback for build issues)
const safeLogDebug = logDebug || (() => {})

/**
 * Save meal data to database
 */
// IMPORTANT: Meals are ONLY created through explicit user action (adding a meal).
// This function is ONLY called when the user manually adds a meal.
// NEVER call this function automatically or with dummy/test data.

export async function saveMealToSupabase(userId, date, meal, options = {}) {
  const allowOutbox = options?.allowOutbox !== false
  // Data pipeline: Validate -> Clean -> Save -> Enrich
  
  // Step 1: Validate data (dynamic import for code-splitting)
  let validation = { valid: true, errors: [] }
  try {
    const validationModule = await import('./dataValidation')
    const { validateNutrition } = validationModule || {}
    if (validateNutrition && typeof validateNutrition === 'function') {
      validation = validateNutrition({ meals: [meal], date })
      if (!validation.valid) {
        logError('Nutrition validation failed', validation.errors)
        throw new Error(`Nutrition validation failed: ${validation.errors.join(', ')}`)
      }
    } else {
      logError('validateNutrition is not a function', { validationModule })
      // Continue without validation if function is not available
    }
  } catch (validationError) {
    logError('Error importing or calling validateNutrition', validationError)
    // Continue without validation if import fails
  }
  
  // Step 2: Clean and normalize data (dynamic import for code-splitting)
  let cleanedMeal = meal
  try {
    const cleaningModule = await import('./dataCleaning')
    const { cleanNutritionData } = cleaningModule || {}
    if (cleanNutritionData && typeof cleanNutritionData === 'function') {
      cleanedMeal = cleanNutritionData(meal)
    } else {
      logError('cleanNutritionData is not a function', { cleaningModule })
      // Use original meal if cleaning function is not available
    }
  } catch (cleaningError) {
    logError('Error importing or calling cleanNutritionData', cleaningError)
    // Use original meal if import fails
  }
  
  // Validate that this is a real meal with data (after cleaning)
  const mealName = cleanedMeal.name || cleanedMeal.description || (cleanedMeal.foods && cleanedMeal.foods.length > 0 ? cleanedMeal.foods[0] : null)
  if (!mealName || (!cleanedMeal.calories && cleanedMeal.calories !== 0)) {
    throw new Error('Cannot save meal without name and calories')
  }
  
  // Track event
  trackEvent('meal_saved', {
    category: 'nutrition',
    action: 'save',
    properties: {
      calories: cleanedMeal.calories
    }
  })
  
  // Use cleaned meal from here on
  const mealToSave = cleanedMeal
  
  // Ensure meal has a name field for consistency
  if (!mealToSave.name) {
    mealToSave.name = mealName
  }
  // Save to a nutrition/meals table
  // For now, we'll use daily_metrics and store meals as JSON
  // In production, you'd want a separate meals table
  
  try {
    // First, get existing data for the date from health_metrics
    const { data: existing, error: fetchError } = await supabase
      .from('health_metrics')
      .select('*')
      .eq('user_id', userId)
      .eq('date', date)
      .maybeSingle()

    if (fetchError && fetchError.code !== 'PGRST116') {
      throw fetchError
    }
  
  let meals = []
  let totalCalories = 0
  let totalMacros = { protein: 0, carbs: 0, fat: 0 }
  
  if (existing && existing.meals) {
    try {
      meals = typeof existing.meals === 'string' ? JSON.parse(existing.meals) : existing.meals
      if (!Array.isArray(meals)) meals = []
      // Use calories_consumed if available, fallback to calories for backward compatibility
      totalCalories = Number(existing.calories_consumed || existing.calories) || 0
      if (existing.macros) {
        totalMacros = typeof existing.macros === 'string' ? JSON.parse(existing.macros) : existing.macros
        if (!totalMacros || typeof totalMacros !== 'object') {
          totalMacros = { protein: 0, carbs: 0, fat: 0 }
        }
      }
    } catch (e) {
      logError('Error parsing existing meals', e)
      meals = []
      totalCalories = 0
      totalMacros = { protein: 0, carbs: 0, fat: 0 }
    }
  }
  
  // Add new meal (don't duplicate if already has id)
  const mealToAdd = mealToSave.id 
    ? { ...mealToSave } 
    : {
        ...mealToSave,
        id: Date.now().toString(),
        timestamp: new Date().toISOString()
      }
  
  // Ensure meal has a name field (from name, description, or foods[0])
  if (!mealToAdd.name) {
    mealToAdd.name = mealToAdd.description || (mealToAdd.foods && mealToAdd.foods.length > 0 ? mealToAdd.foods[0] : 'Meal')
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
  // Use calories_consumed instead of calories to avoid overwriting calories burned (health metrics)
  const upsertData = {
      user_id: userId,
      date: date,
      calories_consumed: totalCalories,
      meals: meals, // JSONB accepts objects/arrays directly
      macros: totalMacros // JSONB accepts objects directly
    }
  
  // Only include updated_at if the column exists (to avoid schema errors)
  // The migration will add this column, but we handle gracefully if it doesn't exist yet
    const { data, error } = await supabase
      .from('health_metrics')
      .upsert({
        ...upsertData,
        source_provider: existing?.source_provider || 'manual',
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,date' })
      .select()
      .single()
    
    if (error) {
      logError('Error saving meal to Supabase', { code: error.code, message: error.message })
      throw error
    }
    
    // Step 3: Enrich data (after saving)
    try {
      await saveEnrichedData('nutrition', { ...data, meals, macros: totalMacros }, userId)
    } catch (enrichError) {
      // Don't fail the save if enrichment fails
      logError('Error enriching nutrition data', enrichError)
    }
    
    // Update nutrition goals based on the saved meal (non-blocking)
    try {
      const { updateCategoryGoals } = await import('./goalsDb')
      updateCategoryGoals(userId, 'nutrition').catch(error => {
        logError('Error updating nutrition goals after meal save', error)
      })
    } catch (error) {
      // Silently fail - goal updates shouldn't block meal saves
      logError('Error importing goalsDb for meal goal update', error)
    }
    
    return data
  } catch (err) {
    // If we can't reach Supabase (offline / transient), queue for eventual sync.
    logWarn('Meal save failed; queuing for sync', { message: err?.message, code: err?.code })
    if (allowOutbox && userId) {
      enqueueOutboxItem({ userId, kind: 'meal', payload: { date, meal } })
      return { queued: true }
    }
    logError('Error saving meal to Supabase', err)
    throw err
  }
}

/**
 * Get meals for a date
 */
export async function getMealsFromSupabase(userId, date) {
  const { data, error } = await supabase
    .from('health_metrics')
    .select('*')
    .eq('user_id', userId)
    .eq('date', date)
    .maybeSingle()
  
  if (error && error.code !== 'PGRST116') {
    logError('Error getting meals', { code: error.code, message: error.message })
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
        logWarn('Meals is not an array', { type: typeof meals })
        meals = []
      }
    } catch (e) {
      logWarn('Error parsing meals', { message: e?.message })
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
        logError('Macros is not an object', { macros, type: typeof macros })
        macros = { protein: 0, carbs: 0, fat: 0 }
      }
    } catch (e) {
      logError('Error parsing macros', { error: e, rawData: data.macros })
      macros = { protein: 0, carbs: 0, fat: 0 }
    }
  }
  
  safeLogDebug(`Loaded meals for ${date}: ${meals.length} meals`)
  
    return {
      meals: meals || [],
      calories: Number(data.calories_consumed) || 0,
      macros: macros || { protein: 0, carbs: 0, fat: 0 },
      water: Number(data.water) || 0
    }
}

/**
 * Get all nutrition data for date range
 */
export async function getNutritionRangeFromSupabase(userId, startDate, endDate) {
  const { data, error } = await supabase
    .from('health_metrics')
    .select('*')
    .eq('user_id', userId)
    .gte('date', startDate)
    .lte('date', endDate)
    .not('calories_consumed', 'is', null)
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
      calories: item.calories_consumed || 0,
      macros,
      water: item.water || 0
    }
  })
}

/**
 * Update water intake
 */
export async function updateWaterIntake(userId, date, water) {
  const upsertData = {
    user_id: userId,
    date: date,
    water: water
  }
  
  try {
    const { data, error } = await supabase
      .from('health_metrics')
      .upsert({
        ...upsertData,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,date' })
      .select()
      .single()
    
    if (error) throw error
    return data
  } catch (err) {
    logError('Error updating water intake', err)
    throw err
  }
}

/**
 * Delete a meal
 */
export async function deleteMealFromSupabase(userId, date, mealId) {
  // Get existing data from health_metrics
  const { data: existing, error: fetchError } = await supabase
    .from('health_metrics')
    .select('*')
    .eq('user_id', userId)
    .eq('date', date)
    .maybeSingle()
  
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
  
  // Save updated data to health_metrics
  const upsertData = {
    user_id: userId,
    date: date,
    calories_consumed: totalCalories,
    meals: meals, // JSONB accepts objects/arrays directly
    macros: totalMacros, // JSONB accepts objects directly
    source_provider: existing?.source_provider || 'manual',
    updated_at: new Date().toISOString()
  }
  
  try {
    const { error } = await supabase
      .from('health_metrics')
      .upsert(upsertData, { onConflict: 'user_id,date' })
    
    if (error) throw error
  } catch (err) {
    logError('Error deleting meal from Supabase', err)
    throw err
  }
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
        logWarn('nutrition_settings column does not exist yet. Run migration.')
        return null
      }
      if (error.code !== 'PGRST116') {
        logError('Error getting nutrition settings', { code: error?.code, message: error?.message })
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
      logError('Error parsing nutrition settings', e)
      return null
    }
  } catch (e) {
    logError('Error getting nutrition settings', e)
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
        logWarn('weekly_meal_plan column does not exist yet. Run migration.')
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
      logError('Error parsing weekly meal plan', e)
      return null
    }
  } catch (e) {
    logError('Error getting weekly meal plan', e)
    return null
  }
}

