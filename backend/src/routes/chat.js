/**
 * Chat Routes (authenticated)
 * Provides /api/chat for the frontend.
 *
 * Security:
 * - Auth is enforced by apiRouter (req.userId is trusted).
 * - Rate limited per user (falls back to IP).
 * - Input validation + size limits.
 */

import express from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import OpenAI from 'openai'
import { sendError, sendSuccess, wrapAsync } from '../utils/http.js'

export const chatRouter = express.Router()

let openaiClient = null
function getOpenAIClient() {
  if (openaiClient) return openaiClient
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null
  openaiClient = new OpenAI({ apiKey })
  return openaiClient
}

// Per-user limiter (fallback to IP). This is intentionally strict because it can be expensive.
const chatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    if (req.userId) return `user:${req.userId}`
    return ipKeyGenerator(req.ip)
  },
  message: {
    error: {
      message: 'Rate limit exceeded. Please wait a minute and try again.',
      status: 429
    }
  }
})

chatRouter.post('/', chatLimiter, wrapAsync(async (req, res) => {
  const { messages, context } = req.body || {}

  if (!Array.isArray(messages) || messages.length === 0) {
    return sendError(res, { status: 400, message: 'Invalid request' })
  }
  if (messages.length > 30) {
    return sendError(res, { status: 400, message: 'Too many messages' })
  }

  const last = messages[messages.length - 1]
  if (!last || typeof last.content !== 'string' || last.content.length > 8000) {
    return sendError(res, { status: 400, message: 'Invalid message content' })
  }

  const openai = getOpenAIClient()
  if (!openai) {
    return sendError(res, { status: 500, message: 'AI service is not configured (missing OPENAI_API_KEY)' })
  }

  const lastMessage = (last?.content || '').toString().toLowerCase()
  const isWorkoutRequest =
    (lastMessage.includes('workout') || lastMessage.includes('routine') || lastMessage.includes('exercise')) &&
    (lastMessage.includes('generate') || lastMessage.includes('create') || lastMessage.includes('give') ||
      lastMessage.includes('make') || lastMessage.includes('build') || lastMessage.includes('suggest') ||
      lastMessage.includes('leg') || lastMessage.includes('arm') || lastMessage.includes('chest') ||
      lastMessage.includes('back') || lastMessage.includes('shoulder') || lastMessage.includes('full body') ||
      lastMessage.includes('push') || lastMessage.includes('pull') || lastMessage.includes('upper') || lastMessage.includes('lower'))

  const systemPrompt = isWorkoutRequest
    ? `You are HonestFitness AI, a fitness coach. The user wants a workout.

RESPOND WITH ONLY THIS JSON FORMAT, NO OTHER TEXT:
{
  "type": "workout",
  "name": "Descriptive Workout Name",
  "exercises": [
    {"name": "Exercise Name", "sets": 3, "reps": 10, "bodyPart": "Chest"}
  ]
}

Rules:
- Include 5-7 exercises
- Use real exercise names (Barbell Squat, Bench Press, Lat Pulldown, etc.)
- bodyPart must be: Chest, Back, Shoulders, Arms, Legs, or Core
- Match the workout to what they asked for (leg day = leg exercises, etc.)
- Vary sets (3-5) and reps (6-15) based on exercise type
${context ? `\nUser context: ${context}` : ''}`
    : `You are HonestFitness AI, a knowledgeable fitness and health assistant.

You help with:
- Workout advice and exercise form
- Training programs and periodization
- Nutrition and diet guidance
- Recovery, sleep, and injury prevention
- Fitness goal setting and motivation
- Health and wellness tips

Keep responses helpful, concise, and actionable. If asked about non-fitness topics, politely redirect to health and fitness.
${context ? `\nUser context: ${context}` : ''}`

  let completion = null
  try {
    completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages
      ],
      max_tokens: 800,
      temperature: 0.7
    })
  } catch (err) {
    return sendError(res, {
      status: 502,
      message: 'AI service temporarily unavailable. Please try again.',
      details: process.env.NODE_ENV === 'development' ? { upstream: err?.message } : undefined
    })
  }

  const content = completion?.choices?.[0]?.message?.content?.trim?.()
  if (!content) {
    return sendError(res, { status: 502, message: 'Received invalid response from AI. Please try again.' })
  }

  // Try to parse workout JSON response when requested.
  if (isWorkoutRequest) {
    try {
      let jsonStr = content
      if (content.includes('```')) {
        const match = content.match(/```(?:json)?\s*([\s\S]*?)```/)
        if (match) jsonStr = match[1].trim()
      }
      const workout = JSON.parse(jsonStr)
      if (workout?.type === 'workout' && Array.isArray(workout.exercises) && workout.exercises.length > 0) {
        return sendSuccess(res, { message: content, workout })
      }
    } catch {
      // Fall through to plain message.
    }
  }

  return sendSuccess(res, { message: content })
}))


