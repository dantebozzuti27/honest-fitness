/**
 * User Prompt Interpreter
 * Interprets free-text user prompts and routes to appropriate handlers
 */

export async function interpretUserPrompt(openai, userId, prompt, dataContext) {
  const systemPrompt = `You are an AI fitness assistant. Interpret user prompts and determine the intent and required action.

User prompt: "${prompt}"

Available context:
- Workout history: ${dataContext.workouts?.length || 0} workouts
- Nutrition data: ${dataContext.nutrition ? 'Available' : 'Not available'}
- Health metrics: ${dataContext.health ? 'Available' : 'Not available'}

Determine:
1. Intent (workout_plan, nutrition_plan, insight, question, other)
2. Required data
3. Suggested response approach

Return JSON:
{
  "intent": "workout_plan",
  "confidence": 0.9,
  "requiredData": ["workout_history", "preferences"],
  "suggestedAction": "generate_workout_plan",
  "parameters": {}
}`

  try {
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 200
    })
    
    const content = response.choices[0].message.content
    
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0])
      }
    } catch (e) {
      console.error('Failed to parse prompt interpretation:', e)
    }
    
    // Fallback: simple keyword matching
    return fallbackInterpretation(prompt)
  } catch (error) {
    console.error('Error interpreting prompt:', error)
    return fallbackInterpretation(prompt)
  }
}

function fallbackInterpretation(prompt) {
  const lower = prompt.toLowerCase()
  
  if (lower.includes('workout') || lower.includes('exercise') || lower.includes('training')) {
    return {
      intent: 'workout_plan',
      confidence: 0.7,
      requiredData: ['workout_history', 'preferences'],
      suggestedAction: 'generate_workout_plan',
      parameters: {}
    }
  }
  
  if (lower.includes('nutrition') || lower.includes('meal') || lower.includes('diet') || lower.includes('calorie')) {
    return {
      intent: 'nutrition_plan',
      confidence: 0.7,
      requiredData: ['nutrition_history', 'goals'],
      suggestedAction: 'generate_nutrition_plan',
      parameters: {}
    }
  }
  
  return {
    intent: 'question',
    confidence: 0.5,
    requiredData: [],
    suggestedAction: 'generate_insight',
    parameters: {}
  }
}

