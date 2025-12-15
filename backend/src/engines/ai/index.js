/**
 * AI Wrapper (LLM Layer)
 * Generates natural language insights, plans, and guidance
 */

import OpenAI from 'openai'
import { generateWorkoutPlan } from './workoutPlan.js'
import { generateNutritionPlan } from './nutritionPlan.js'
import { generateWeeklySummary } from './weeklySummary.js'
import { generateInsights } from './insights.js'
import { generatePageInsights } from './pageInsights.js'
import { interpretUserPrompt } from './promptInterpreter.js'

let openaiClient = null

function getOpenAIClient() {
  if (openaiClient) return openaiClient

  const apiKey = process.env.OPENAI_API_KEY

  // In tests or local dev without AI enabled, we should not crash at import time.
  if (!apiKey) {
    return null
  }

  openaiClient = new OpenAI({ apiKey })
  return openaiClient
}

/**
 * Generate workout plan using AI
 */
export async function generateAIWorkoutPlan(userId, context, preferences) {
  const client = getOpenAIClient()
  if (!client) throw new Error('OPENAI_API_KEY is missing; AI features are not available.')
  return await generateWorkoutPlan(client, userId, context, preferences)
}

/**
 * Generate nutrition plan using AI
 */
export async function generateAINutritionPlan(userId, context, goals) {
  const client = getOpenAIClient()
  if (!client) throw new Error('OPENAI_API_KEY is missing; AI features are not available.')
  return await generateNutritionPlan(client, userId, context, goals)
}

/**
 * Generate weekly summary
 */
export async function generateAIWeeklySummary(userId, weekData, mlResults) {
  const client = getOpenAIClient()
  if (!client) throw new Error('OPENAI_API_KEY is missing; AI features are not available.')
  return await generateWeeklySummary(client, userId, weekData, mlResults)
}

/**
 * Generate contextual insights
 */
export async function generateAIInsights(userId, dataContext, mlResults) {
  const client = getOpenAIClient()
  if (!client) throw new Error('OPENAI_API_KEY is missing; AI features are not available.')
  return await generateInsights(client, userId, dataContext, mlResults)
}

/**
 * Generate page-specific insights
 */
export async function generateAIPageInsights(userId, dataContext, mlResults, page, extraContext) {
  const client = getOpenAIClient()
  if (!client) throw new Error('OPENAI_API_KEY is missing; AI features are not available.')
  return await generatePageInsights(client, userId, dataContext, mlResults, page, extraContext)
}

/**
 * Interpret user's free-text prompt
 */
export async function interpretPrompt(userId, prompt, dataContext) {
  const client = getOpenAIClient()
  if (!client) throw new Error('OPENAI_API_KEY is missing; AI features are not available.')
  return await interpretUserPrompt(client, userId, prompt, dataContext)
}

