/**
 * Insights Routes (authenticated)
 * Provides /api/insights for LLM-powered training analysis.
 * Read-only — the LLM analyzes data but makes no training decisions.
 */

import express from 'express'
import crypto from 'crypto'
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

const VALIDATE_WORKOUT_PROMPT = `You are an exercise science reviewer auditing a machine-generated workout.
You receive the lifter's training profile (recovery, volume status, progressions, goals) AND the generated workout.

Your job: find concrete problems and return structured corrections in two categories.

CATEGORY 1 — immediate_corrections (apply NOW, before the user sees the workout):
Only flag issues that are clearly wrong based on the data. Examples:
- Weight prescribed above the lifter's known 1RM
- More than 6 working sets of a single exercise
- A muscle group trained yesterday appearing with high volume today
- Exercise ordered after a movement that would severely fatigue its prime movers
- Total session time wildly exceeding the user's budget

Each correction must include the exercise name and a specific fix (new sets, new weight, remove, reorder).

CATEGORY 2 — pattern_observations (stored for future workouts, not applied now):
Recurring patterns you notice across the profile that the engine should learn. Examples:
- "User consistently swaps out barbell rows — consider defaulting to cable rows"
- "Chest volume has been above MRV for 3 weeks — next mesocycle should reduce"
- "User never does unilateral leg work — consider adding lunges/split squats"

Respond with ONLY this JSON:
{
  "immediate_corrections": [
    {
      "exerciseName": "exact exercise name from the workout",
      "issue": "what is wrong",
      "fix": "sets|weight|remove|reorder",
      "newValue": "the corrected value (number for sets/weight, null for remove, target index for reorder)",
      "reason": "1-sentence evidence-based justification"
    }
  ],
  "pattern_observations": [
    {
      "pattern": "what you noticed",
      "suggestion": "what the engine should do differently in future",
      "confidence": "high|medium|low"
    }
  ],
  "verdict": "pass|minor_issues|major_issues"
}

RULES:
- If the workout looks good, return empty arrays and verdict "pass"
- Maximum 3 immediate corrections — only flag the most critical
- Maximum 3 pattern observations
- Never invent data — only reference values present in the profile
- Be conservative: if unsure, do not correct`

const insightsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.userId ? `user:${req.userId}` : 'anon',
  message: { error: { message: 'Rate limit exceeded. Please wait a minute.', status: 429 } }
})

const validateCache = new Map()
const CACHE_TTL_MS = 5 * 60 * 1000
const VALIDATION_SCHEMA_VERSION = 'v1'

/** Deterministic cache key for workout validation output. */
function workoutValidationCacheKey(userId, workoutData, trainingProfile) {
  try {
    const modelVersion = process.env.OPENAI_MODEL || 'gpt-4o-mini'
    const payload = JSON.stringify({ w: workoutData, p: trainingProfile, mv: modelVersion, sv: VALIDATION_SCHEMA_VERSION })
    const hash = crypto.createHash('sha256').update(payload).digest('hex').slice(0, 20)
    return `${userId}:validate:${hash}`
  } catch {
    return `${userId}:validate:fallback:${VALIDATION_SCHEMA_VERSION}`
  }
}

function summarizeProfileForLLM(profile) {
  return {
    goal: profile.goalProgress?.primaryGoal,
    trainingFrequency: profile.trainingFrequency,
    avgSessionDuration: profile.avgSessionDuration,
    consistencyScore: profile.consistencyScore,
    muscleGroupFrequency: profile.muscleGroupFrequency,
    muscleVolumeStatuses: (profile.muscleVolumeStatuses || []).map(v => ({
      muscleGroup: v.muscleGroup, status: v.status, weeklyDirectSets: v.weeklyDirectSets, mrv: v.mrv,
    })),
    recoveryContext: profile.recoveryContext,
    muscleRecovery: (profile.muscleRecovery || []).filter(r => r.recoveryPercent < 90).map(r => ({
      muscleGroup: r.muscleGroup, recoveryPercent: r.recoveryPercent, hoursSinceLastTrained: r.hoursSinceLastTrained,
    })),
    exerciseProgressions: (profile.exerciseProgressions || []).slice(0, 15).map(p => ({
      exerciseName: p.exerciseName, estimated1RM: p.estimated1RM, lastWeight: p.lastWeight, trend: p.trend,
    })),
    bodyWeightTrend: profile.bodyWeightTrend,
    deloadRecommendation: profile.deloadRecommendation,
    fitnessFatigueModel: profile.fitnessFatigueModel,
  }
}

insightsRouter.post('/', insightsLimiter, wrapAsync(async (req, res) => {
  const { type, trainingProfile, workoutData } = req.body || {}

  if (!type || !trainingProfile) {
    return sendError(res, { status: 400, message: 'Missing required fields: type, trainingProfile' })
  }

  if (type === 'validate-workout' && req.userId && workoutData) {
    const cacheKey = workoutValidationCacheKey(req.userId, workoutData, trainingProfile)
    const cached = validateCache.get(cacheKey)
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return sendSuccess(res, { data: cached.data, type, cached: true })
    }
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
  } else if (type === 'validate-workout') {
    if (!workoutData) {
      return sendError(res, { status: 400, message: 'validate-workout requires workoutData' })
    }
    systemPrompt = VALIDATE_WORKOUT_PROMPT
    const summary = summarizeProfileForLLM(trainingProfile)
    userContent = `Training Profile (summarized):\n${JSON.stringify(summary, null, 2)}\n\nGenerated Workout:\n${JSON.stringify(workoutData, null, 2)}`
  } else {
    return sendError(res, { status: 400, message: 'Invalid type. Must be "summary", "workout_review", or "validate-workout"' })
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

    if (type === 'validate-workout') {
      const safe = {
        immediate_corrections: Array.isArray(parsed.immediate_corrections)
          ? parsed.immediate_corrections.slice(0, 3).filter(c => c && typeof c.exerciseName === 'string')
          : [],
        pattern_observations: Array.isArray(parsed.pattern_observations)
          ? parsed.pattern_observations.slice(0, 3).filter(o => o && typeof o.pattern === 'string')
          : [],
        verdict: ['pass', 'minor_issues', 'major_issues'].includes(parsed.verdict)
          ? parsed.verdict
          : 'pass',
        schema_version: VALIDATION_SCHEMA_VERSION,
      }
      if (req.userId && workoutData) {
        const cacheKey = workoutValidationCacheKey(req.userId, workoutData, trainingProfile)
        validateCache.set(cacheKey, { data: safe, ts: Date.now() })
      }
      return sendSuccess(res, { data: safe, type })
    }

    return sendSuccess(res, { data: parsed, type })
  } catch {
    if (type === 'validate-workout') {
      return sendSuccess(res, { data: { immediate_corrections: [], pattern_observations: [], verdict: 'pass', schema_version: VALIDATION_SCHEMA_VERSION }, type })
    }
    return sendSuccess(res, { data: { raw: content }, type })
  }
}))
