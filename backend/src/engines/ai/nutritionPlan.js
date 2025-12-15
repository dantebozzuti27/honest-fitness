/**
 * AI-Powered Nutrition Plan Generation
 */

export async function generateNutritionPlan(openai, userId, context, goals) {
  const systemPrompt = `You are a nutrition expert. Generate personalized nutrition plans based on user goals, current intake, and preferences.

Context:
- User goals: ${JSON.stringify(goals)}
- Current average calories: ${context.nutrition?.avgCalories || 'N/A'}
- Current macros: ${JSON.stringify(context.nutrition?.avgMacros || {})}
- Activity level: ${context.health?.steps ? 'Active' : 'Moderate'}

Generate a nutrition plan that:
1. Aligns with the user's fitness goals (weight loss, muscle gain, maintenance)
2. Provides appropriate calorie and macro targets
3. Includes meal suggestions
4. Considers their preferences and restrictions

Return JSON format:
{
  "dailyTargets": {
    "calories": 2000,
    "protein": 150,
    "carbs": 200,
    "fat": 65
  },
  "meals": [
    {
      "name": "Breakfast",
      "calories": 500,
      "protein": 30,
      "carbs": 50,
      "fat": 15,
      "suggestions": ["Oatmeal with protein", "Greek yogurt with berries"]
    }
  ],
  "guidance": "Focus on protein intake to support muscle recovery"
}`

  try {
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Generate a personalized nutrition plan for me.' }
      ],
      temperature: 0.7,
      max_tokens: 1000
    })
    
    const content = response.choices[0].message.content
    
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0])
      }
    } catch (e) {
      console.error('Failed to parse nutrition plan JSON:', e)
    }
    
    return {
      dailyTargets: {
        calories: 2000,
        protein: 150,
        carbs: 200,
        fat: 65
      },
      meals: [],
      guidance: content,
      rawResponse: content
    }
  } catch (error) {
    console.error('Error generating nutrition plan:', error)
    throw new Error('Failed to generate nutrition plan')
  }
}

