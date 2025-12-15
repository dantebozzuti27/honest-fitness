/**
 * Food Library Database Functions
 * Manage food library, custom foods, favorites, and recent foods
 */

import { supabase as supabaseClient, supabaseConfigErrorMessage } from './supabase'
import { logError } from '../utils/logger'

// Avoid TypeError crashes when Supabase env is missing; throw a clear message at call time instead.
const supabase = supabaseClient ?? new Proxy({}, { get: () => { throw new Error(supabaseConfigErrorMessage) } })

/**
 * Get all system foods (non-custom)
 */
export async function getSystemFoods(filters = {}) {
  // Keep queries cheap when the library grows large.
  // Default: 50 for search, 200 for browse.
  const limit =
    Number.isFinite(Number(filters.limit))
      ? Number(filters.limit)
      : (filters.search ? 50 : 200)
  const finalLimit = Math.max(1, Math.min(500, limit))

  // Prefer Postgres full-text search when available (`name_tsv`), fall back to ILIKE when not.
  const rawSearch = (filters.search || '').toString().trim()
  const hasSearch = rawSearch.length > 0

  if (hasSearch) {
    try {
      let ftsQuery = supabase
        .from('food_library')
        .select('*')
        .eq('is_custom', false)

      if (filters.categoryId) {
        ftsQuery = ftsQuery.eq('category_id', filters.categoryId)
      }

      const { data: ftsData, error: ftsError } = await ftsQuery
        // `websearch` makes multi-word search behave naturally ("chicken breast").
        .textSearch('name_tsv', rawSearch, { type: 'websearch', config: 'simple' })
        .order('name', { ascending: true })
        .limit(finalLimit)

      if (!ftsError) {
        const rows = ftsData || []
        const categoryIds = [...new Set(rows.map(r => r?.category_id).filter(Boolean))]
        if (categoryIds.length === 0) return rows
        try {
          const { data: cats } = await supabase
            .from('food_categories')
            .select('id, name, description')
            .in('id', categoryIds)
          const map = new Map((cats || []).map(c => [c.id, c]))
          return rows.map(r => ({ ...r, food_categories: r?.category_id ? (map.get(r.category_id) || null) : null }))
        } catch {
          return rows
        }
      }
      // If `name_tsv` isn't present (or any FTS issue), fall through to ILIKE.
    } catch {
      // Fall through to ILIKE.
    }
  }

  // Prefer a plain select first to avoid PostgREST schema-cache relationship issues (PGRST200).
  let query = supabase
    .from('food_library')
    .select('*')
    .eq('is_custom', false)

  if (filters.categoryId) {
    query = query.eq('category_id', filters.categoryId)
  }
  if (hasSearch) {
    query = query.ilike('name', `%${rawSearch}%`)
  }

  query = query.order('name', { ascending: true }).limit(finalLimit)

  const { data, error } = await query

  if (error) {
    logError('Error getting system foods', error)
    return []
  }

  // Attach category info (best-effort)
  const rows = data || []
  const categoryIds = [...new Set(rows.map(r => r?.category_id).filter(Boolean))]
  if (categoryIds.length === 0) return rows
  try {
    const { data: cats } = await supabase
      .from('food_categories')
      .select('id, name, description')
      .in('id', categoryIds)
    const map = new Map((cats || []).map(c => [c.id, c]))
    return rows.map(r => ({ ...r, food_categories: r?.category_id ? (map.get(r.category_id) || null) : null }))
  } catch {
    return rows
  }
}

/**
 * Get all food categories
 */
export async function getFoodCategories() {
  const { data, error } = await supabase
    .from('food_categories')
    .select('*')
    .order('name', { ascending: true })
  
  if (error) {
    logError('Error getting food categories', error)
    return []
  }
  
  return data || []
}

/**
 * Get user's custom foods
 */
export async function getCustomFoods(userId) {
  const { data, error } = await supabase
    .from('food_library')
    .select('*')
    .eq('is_custom', true)
    .eq('created_by_user_id', userId)
    .order('name', { ascending: true })
    .limit(500)
  
  if (error) {
    logError('Error getting custom foods', error)
    return []
  }

  const rows = data || []
  const categoryIds = [...new Set(rows.map(r => r?.category_id).filter(Boolean))]
  if (categoryIds.length === 0) return rows
  try {
    const { data: cats } = await supabase
      .from('food_categories')
      .select('id, name, description')
      .in('id', categoryIds)
    const map = new Map((cats || []).map(c => [c.id, c]))
    return rows.map(r => ({ ...r, food_categories: r?.category_id ? (map.get(r.category_id) || null) : null }))
  } catch {
    return rows
  }
}

/**
 * Create a custom food
 */
export async function createCustomFood(userId, food) {
  const { data, error } = await supabase
    .from('food_library')
    .insert({
      name: food.name,
      brand: food.brand || null,
      barcode: food.barcode || null,
      category_id: food.categoryId || null,
      calories_per_100g: food.caloriesPer100g,
      protein_per_100g: food.proteinPer100g || 0,
      carbs_per_100g: food.carbsPer100g || 0,
      fat_per_100g: food.fatPer100g || 0,
      fiber_per_100g: food.fiberPer100g || 0,
      sugar_per_100g: food.sugarPer100g || 0,
      sodium_per_100g: food.sodiumPer100g || 0,
      micros_per_100g: food.microsPer100g || {},
      is_custom: true,
      created_by_user_id: userId,
      description: food.description || null
    })
    .select()
    .single()
  
  if (error) {
    logError('Error creating custom food', error)
    throw error
  }
  
  return data
}

/**
 * Update a custom food
 */
export async function updateCustomFood(userId, foodId, updates) {
  const { data, error } = await supabase
    .from('food_library')
    .update({
      name: updates.name,
      brand: updates.brand || null,
      barcode: updates.barcode || null,
      category_id: updates.categoryId,
      calories_per_100g: updates.caloriesPer100g,
      protein_per_100g: updates.proteinPer100g,
      carbs_per_100g: updates.carbsPer100g,
      fat_per_100g: updates.fatPer100g,
      fiber_per_100g: updates.fiberPer100g,
      sugar_per_100g: updates.sugarPer100g,
      sodium_per_100g: updates.sodiumPer100g,
      micros_per_100g: updates.microsPer100g || {},
      description: updates.description,
      updated_at: new Date().toISOString()
    })
    .eq('id', foodId)
    .eq('created_by_user_id', userId)
    .eq('is_custom', true)
    .select()
    .single()
  
  if (error) {
    logError('Error updating custom food', error)
    throw error
  }
  
  return data
}

/**
 * Delete a custom food
 */
export async function deleteCustomFood(userId, foodId) {
  const { error } = await supabase
    .from('food_library')
    .delete()
    .eq('id', foodId)
    .eq('created_by_user_id', userId)
    .eq('is_custom', true)
  
  if (error) {
    logError('Error deleting custom food', error)
    throw error
  }
}

/**
 * Get user's favorite foods
 */
export async function getFavoriteFoods(userId) {
  const { data, error } = await supabase
    .from('user_food_preferences')
    .select(`
      *,
      food_library (
        *,
        food_categories (
          id,
          name,
          description
        )
      )
    `)
    .eq('user_id', userId)
    .eq('is_favorite', true)
    .order('created_at', { ascending: false })
  
  if (error) {
    logError('Error getting favorite foods', error)
    return []
  }
  
  return (data || []).map(item => item.food_library).filter(Boolean)
}

/**
 * Add food to favorites
 */
export async function addFavoriteFood(userId, foodId) {
  const { data, error } = await supabase
    .from('user_food_preferences')
    .upsert({
      user_id: userId,
      food_id: foodId,
      is_favorite: true,
      last_used_at: new Date().toISOString()
    }, { onConflict: 'user_id,food_id' })
    .select()
    .single()
  
  if (error) {
    logError('Error adding favorite food', error)
    throw error
  }
  
  return data
}

/**
 * Remove food from favorites
 */
export async function removeFavoriteFood(userId, foodId) {
  const { error } = await supabase
    .from('user_food_preferences')
    .update({
      is_favorite: false
    })
    .eq('user_id', userId)
    .eq('food_id', foodId)
  
  if (error) {
    logError('Error removing favorite food', error)
    throw error
  }
}

/**
 * Get recent foods (last used)
 */
export async function getRecentFoods(userId, limit = 10) {
  const { data, error } = await supabase
    .from('user_food_preferences')
    .select(`
      *,
      food_library (
        *,
        food_categories (
          id,
          name,
          description
        )
      )
    `)
    .eq('user_id', userId)
    .order('last_used_at', { ascending: false })
    .limit(limit)
  
  if (error) {
    logError('Error getting recent foods', error)
    return []
  }
  
  return (data || []).map(item => item.food_library).filter(Boolean)
}

/**
 * Update food last used timestamp (for recent foods)
 */
export async function updateFoodLastUsed(userId, foodId) {
  const { data, error } = await supabase
    .from('user_food_preferences')
    .upsert({
      user_id: userId,
      food_id: foodId,
      last_used_at: new Date().toISOString()
    }, { onConflict: 'user_id,food_id' })
    .select()
    .single()
  
  if (error) {
    logError('Error updating food last used', error)
    throw error
  }
  
  return data
}

