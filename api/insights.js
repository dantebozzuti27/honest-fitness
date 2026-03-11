/**
 * LLM Training Insights Endpoint
 *
 * Auth-protected Vercel serverless function that takes the full training profile
 * and ML model outputs, then asks the LLM for a narrative analysis.
 *
 * The LLM is read-only — it analyzes data and produces insights but makes no decisions.
 *
 * POST /api/insights
 * Body: { trainingProfile, type: 'summary' | 'workout_review', workoutData? }
 * Headers: Authorization: Bearer <supabase_access_token>
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

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

Include 4-6 key findings. Be ruthlessly honest.`;

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

Include 3-5 observations.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: { message: 'Method not allowed', status: 405 } });
  }

  try {
    const authHeader = req.headers?.authorization || req.headers?.Authorization;
    if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: { message: 'Missing authorization', status: 401 } });
    }
    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) {
      return res.status(401).json({ success: false, error: { message: 'Missing authorization token', status: 401 } });
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return res.status(500).json({ success: false, error: { message: 'Server configuration error', status: 500 } });
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !user) {
      return res.status(401).json({ success: false, error: { message: 'Invalid or expired token', status: 401 } });
    }

    // Rate limit (best-effort in-memory)
    globalThis.__HF_INSIGHTS_RL__ = globalThis.__HF_INSIGHTS_RL__ || new Map();
    const rlKey = `${user.id}:${Math.floor(Date.now() / 60000)}`;
    const used = globalThis.__HF_INSIGHTS_RL__.get(rlKey) || 0;
    if (used >= 10) {
      return res.status(429).json({ success: false, error: { message: 'Rate limit exceeded. Please wait a minute.', status: 429 } });
    }
    globalThis.__HF_INSIGHTS_RL__.set(rlKey, used + 1);

    const { type, trainingProfile, workoutData } = req.body;

    if (!type || !trainingProfile) {
      return res.status(400).json({ success: false, error: { message: 'Missing required fields: type, trainingProfile', status: 400 } });
    }

    if (!OPENAI_API_KEY) {
      return res.status(500).json({ success: false, error: { message: 'AI service not configured', status: 500 } });
    }

    let systemPrompt;
    let userContent;

    if (type === 'summary') {
      systemPrompt = TRAINING_SUMMARY_PROMPT;
      userContent = `Here is the lifter's complete training profile:\n${JSON.stringify(trainingProfile, null, 2)}`;
    } else if (type === 'workout_review') {
      if (!workoutData) {
        return res.status(400).json({ success: false, error: { message: 'workout_review requires workoutData', status: 400 } });
      }
      systemPrompt = WORKOUT_REVIEW_PROMPT;
      userContent = `Training Profile:\n${JSON.stringify(trainingProfile, null, 2)}\n\nGenerated Workout:\n${JSON.stringify(workoutData, null, 2)}`;
    } else {
      return res.status(400).json({ success: false, error: { message: 'Invalid type. Must be "summary" or "workout_review"', status: 400 } });
    }

    // Truncate user content to avoid token limits (keep under ~12k chars)
    if (userContent.length > 12000) {
      userContent = userContent.slice(0, 12000) + '\n... (data truncated for token limits)';
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
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
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', response.status, errorText);
      return res.status(502).json({ success: false, error: { message: 'AI service temporarily unavailable', status: 502 } });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim?.();

    if (!content) {
      return res.status(502).json({ success: false, error: { message: 'Empty response from AI', status: 502 } });
    }

    // Parse JSON response
    try {
      let jsonStr = content;
      if (content.includes('```')) {
        const match = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (match) jsonStr = match[1].trim();
      }
      const parsed = JSON.parse(jsonStr);
      return res.status(200).json({ success: true, data: parsed, type });
    } catch {
      // If JSON parsing fails, return the raw text
      return res.status(200).json({ success: true, data: { raw: content }, type });
    }

  } catch (error) {
    console.error('Insights handler error:', error);
    return res.status(500).json({ success: false, error: { message: 'Something went wrong. Please try again.', status: 500 } });
  }
}
