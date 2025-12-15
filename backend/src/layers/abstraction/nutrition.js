/**
 * Nutrition Data Normalization
 */

import { z } from 'zod'

const NutritionSchema = z.object({
  userId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  meals: z.array(z.object({
    name: z.string(),
    time: z.string().optional(),
    foods: z.array(z.object({
      name: z.string(),
      calories: z.number(),
      protein: z.number(),
      carbs: z.number(),
      fat: z.number(),
      quantity: z.number().optional(),
      unit: z.string().optional()
    }))
  })).optional(),
  calories: z.number().optional(),
  macros: z.object({
    protein: z.number(),
    carbs: z.number(),
    fat: z.number()
  }).optional(),
  water: z.number().optional()
})

export async function normalizeNutritionData(rawData) {
  const validated = NutritionSchema.parse(rawData)
  
  // Calculate totals if not provided
  let totalCalories = validated.calories || 0
  let totalMacros = validated.macros || { protein: 0, carbs: 0, fat: 0 }
  
  if (validated.meals && validated.meals.length > 0) {
    totalCalories = validated.meals.reduce((sum, meal) => {
      return sum + (meal.foods?.reduce((mealSum, food) => mealSum + food.calories, 0) || 0)
    }, 0)
    
    totalMacros = validated.meals.reduce((macros, meal) => {
      return meal.foods?.reduce((mealMacros, food) => ({
        protein: mealMacros.protein + food.protein,
        carbs: mealMacros.carbs + food.carbs,
        fat: mealMacros.fat + food.fat
      }), macros) || macros
    }, { protein: 0, carbs: 0, fat: 0 })
  }
  
  return {
    user_id: validated.userId,
    date: validated.date,
    meals: validated.meals || [],
    calories: totalCalories,
    macros: totalMacros,
    water: validated.water || 0,
    normalized_at: new Date().toISOString()
  }
}

