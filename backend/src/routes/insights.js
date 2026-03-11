/**
 * Insights Routes (authenticated)
 * Provides /api/insights for LLM-powered training analysis.
 * Read-only — the LLM analyzes data but makes no training decisions.
 */

import express from 'express'
import rateLimit from 'express-rate-limit'
import { sendError, sendSuccess, wrapAsync } from '../utils/http.js'

export const insightsRouter = express.Router()

const TRAINING_SUMMARY_PROMPT = `You are an elite sports scientist and strength coach analyzing a lifter's training data.
You have access to their complete training profile computed from real workout logs, wearable data, and ML features.

Your job:
1. Synthesize the data into a clear, honest narrative about their training
2. Identify the most important patterns, risks, and opportunities
3. Be specific — reference actual numbers from the data
4. Be direct and actionable — no motivational fluff
5. Structure your response as JSON

IMPORTANT CONSTRAINTS:
- You are ANALYSIS ONLY. Do not prescribe workouts or make training decisions.
- Do not suggest specific exercises, sets, or reps.
- Focus on what the data tells you about the lifter's trajectory, recovery, and adaptation.

Respond with ONLY this JSON format:
{
  "overallAssessment": "2-3 sentence executive summary of where this lifter stands",
  "keyFindings": [
    {
      "category": "strength|recovery|consistency|volume|progression|health",
      "title": "Short finding title",
      "detail": "1-2 sentence explanation with specific data references",
      "sentiment": "positive|neutral|warning|negative"
    }
  ],
  "blindSpots": ["Things the data suggests but the lifter might not realize"],
  "dataQuality": "Brief note on data completeness and confidence level"
}

Include 4-6 key findings. Be ruthlessly honest.`

const WORKOUT_REVIEW_PROMPT = `You are an elite sports scientist reviewing a generated workout plan.
You have access to the lifter's training profile AND the workout that was prescribed for them.

Your job:
1. Analyze how well the workout matches the lifter's current state
2. Note anything that stands out — good or concerning
3. Explain the training stimulus this workout will produce
4. Be specific and reference actual exercises, volumes, and intensities

IMPORTANT CONSTRAINTS:
- You are ANALYSIS ONLY. Do not modify the workout or suggest alternatives.
- Do not say "you should do X instead" — just explain what the current prescription will do.
- Be honest about both strengths and weaknesses of the programming.

Respond with ONLY this JSON format:
{
  "verdict": "well_programmed|acceptable|has_concerns|problematic",
  "summary": "2-3 sentence assessment of this workout",
  "observations": [
    {
      "aspect": "volume|intensity|exercise_selection|recovery_alignment|time_efficiency|progression",
      "note": "Specific observation about this aspect",
      "sentiment": "positive|neutral|concern"
    }
  ],
  "expectedStimulus": "What adaptation this workout is driving and why",
  "recoveryImpact": "How this session will affect the next 24-48 hours"
}

Include 3-5 observations.`

const insightsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.userId ? `user:${req.userId}` : 'anon',
  message: { error: { message: 'Rate limit exceeded. Please wait a minute.', status: 429 } }
})

insightsRouter.post('/', insightsLimiter, wrapAsync(async (req, res) => {
  const { type, trainingProfile, workoutData } = req.body || {}

  if (!type || !trainingProfile) {
    return sendError(res, { status: 400, message: 'Missing required fields: type, trainingProfile' })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return sendError(res, { status: 500, message: 'AI service not configured' })
  }

  let systemPrompt
  let userContent

  if (type === 'summary') {
    systemPrompt = TRAINING_SUMMARY_PROMPT
    userContent = `Here is the lifter's complete training profile:\n${JSON.stringify(trainingProfile, null, 2)}`
  } else if (type === 'workout_review') {
    if (!workoutData) {
      return sendError(res, { status: 400, message: 'workout_review requires workoutData' })
    }
    systemPrompt = WORKOUT_REVIEW_PROMPT
    userContent = `Training Profile:\n${JSON.stringify(trainingProfile, null, 2)}\n\nGenerated Workout:\n${JSON.stringify(workoutData, null, 2)}`
  } else {
    return sendError(res, { status: 400, message: 'Invalid type. Must be "summary" or "workout_review"' })
  }

  if (userContent.length > 12000) {
    userContent = userContent.slice(0, 12000) + '\n... (data truncated for token limits)'
  }

  let completion
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ],
        max_tokens: 1200,
        temperature: 0.4,
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('OpenAI API error:', response.status, errorText)
      return sendError(res, { status: 502, message: 'AI service temporarily unavailable' })
    }

    completion = await response.json()
  } catch (err) {
    return sendError(res, { status: 502, message: 'AI service temporarily unavailable' })
  }

  const content = completion?.choices?.[0]?.message?.content?.trim?.()
  if (!content) {
    return sendError(res, { status: 502, message: 'Empty response from AI' })
  }

  try {
    let jsonStr = content
    if (content.includes('```')) {
      const match = content.match(/```(?:json)?\s*([\s\S]*?)```/)
      if (match) jsonStr = match[1].trim()
    }
    const parsed = JSON.parse(jsonStr)
    return sendSuccess(res, { data: parsed, type })
  } catch {
    return sendSuccess(res, { data: { raw: content }, type })
  }
}))
