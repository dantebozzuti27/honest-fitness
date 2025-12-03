/**
 * AI Wrapper (LLM Layer)
 * Generates natural language insights, plans, and guidance
 */

import OpenAI from 'openai'
import { generateWorkoutPlan } from './workoutPlan.js'
import { generateNutritionPlan } from './nutritionPlan.js'
import { generateWeeklySummary } from './weeklySummary.js'
import { generateInsights } from './insights.js'
import { interpretUserPrompt } from './promptInterpreter.js'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

/**
 * Generate workout plan using AI
 */
export async function generateAIWorkoutPlan(userId, context, preferences) {
  return await generateWorkoutPlan(openai, userId, context, preferences)
}

/**
 * Generate nutrition plan using AI
 */
export async function generateAINutritionPlan(userId, context, goals) {
  return await generateNutritionPlan(openai, userId, context, goals)
}

/**
 * Generate weekly summary
 */
export async function generateAIWeeklySummary(userId, weekData, mlResults) {
  return await generateWeeklySummary(openai, userId, weekData, mlResults)
}

/**
 * Generate contextual insights
 */
export async function generateAIInsights(userId, dataContext, mlResults) {
  return await generateInsights(openai, userId, dataContext, mlResults)
}

/**
 * Interpret user's free-text prompt
 */
export async function interpretPrompt(userId, prompt, dataContext) {
  return await interpretUserPrompt(openai, userId, prompt, dataContext)
}

