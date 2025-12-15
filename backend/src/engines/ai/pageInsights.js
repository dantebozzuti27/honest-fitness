/**
 * Page-specific AI insights
 * Returns a list of insight objects consumable by the frontend InsightsCard.
 */

function buildPageSystemPrompt(page, dataContext, mlResults, extraContext) {
  const ctx = extraContext && typeof extraContext === 'object' ? extraContext : {}
  const pageKey = (page || '').toString()

  const base = `You are HonestFitness AI. Generate page-specific insights for the user.

You will be given:
- page: which screen the user is on
- dataContext: last ~30 days of workouts/nutrition/health, plus user prefs
- mlResults: computed trends/anomalies/readiness (if available)
- extraContext: lightweight page-specific context (date range, selected day, etc.)

OUTPUT ONLY JSON (no markdown, no prose) with this shape:
{
  "title": "Short title for the card",
  "insights": [
    { "message": "Actionable insight in 1-2 sentences", "type": "info|warning|success" }
  ]
}

Rules:
- Return 2-4 insights max.
- Each message must reference a concrete data point when possible (numbers, dates, streak, macros, steps, etc.).
- Avoid medical claims; keep it fitness/nutrition guidance.
`

  const pageGuidanceByKey = {
    Nutrition: `Focus on food logging quality, calories/macros consistency, fiber/protein targets, and easy next meals.`,
    Health: `Focus on sleep, steps, HRV/readiness, recovery actions, and what to log next.`,
    Fitness: `Focus on training frequency, volume balance, body-part balance, and next-session suggestions.`,
    Home: `Focus on today’s best next action (workout vs recovery vs log), and high-signal reminders.`
  }

  const pageGuidance = pageGuidanceByKey[pageKey] || `Focus on the page's primary intent and show the most relevant actions.`

  return `${base}
Page guidance: ${pageGuidance}

page: ${pageKey}
extraContext: ${JSON.stringify(ctx)}

Data summary:
- workouts (count): ${dataContext?.workouts?.length || 0}
- nutrition rows (count): ${dataContext?.nutrition?.length || 0}
- health rows (count): ${dataContext?.health?.length || 0}
- readiness: ${mlResults?.readiness?.score || 'N/A'} (${mlResults?.readiness?.zone || 'N/A'})
`
}

export async function generatePageInsights(openai, userId, dataContext, mlResults, page, extraContext) {
  const systemPrompt = buildPageSystemPrompt(page, dataContext, mlResults, extraContext)

  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'Generate page insights now.' }
    ],
    temperature: 0.4,
    max_tokens: 500,
    user: userId
  })

  const content = response?.choices?.[0]?.message?.content?.trim?.() || ''
  try {
    const parsed = JSON.parse(content)
    const title = typeof parsed?.title === 'string' ? parsed.title : 'Insights'
    const insights = Array.isArray(parsed?.insights) ? parsed.insights : []
    return {
      title,
      insights: insights
        .filter(i => i && typeof i.message === 'string' && i.message.trim().length > 0)
        .slice(0, 4)
        .map(i => ({
          type: (i.type || 'info').toString(),
          message: i.message.toString().trim()
        }))
    }
  } catch {
    // Fallback: return a single generic insight so UI doesn't break.
    return {
      title: 'Insights',
      insights: [{ type: 'info', message: content || 'No insights available right now.' }].slice(0, 1)
    }
  }
}


