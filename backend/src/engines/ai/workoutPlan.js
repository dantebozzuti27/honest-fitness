/**
 * AI-Powered Workout Plan Generation
 */

export async function generateWorkoutPlan(openai, userId, context, preferences) {
  const systemPrompt = `You are an expert fitness coach. Generate personalized workout plans based on user data, preferences, and goals.

Context:
- User preferences: ${JSON.stringify(preferences)}
- Recent workout history: ${context.workouts?.length || 0} workouts logged
- Current readiness: ${context.readiness?.score || 'N/A'}
- Training load: ${context.mlResults?.workoutAnalysis?.avgVolume || 'N/A'}

Generate a structured workout plan that:
1. Matches the user's fitness goals and experience level
2. Accounts for their available equipment
3. Considers their current readiness and recovery status
4. Progresses appropriately from their current level
5. Includes 5-7 exercises per workout
6. Specifies sets, reps, and weight ranges

Return JSON format:
{
  "name": "Workout Name",
  "exercises": [
    {
      "name": "Exercise Name",
      "sets": 3,
      "reps": "8-12",
      "bodyPart": "Chest",
      "equipment": "Barbell",
      "notes": "Focus on form"
    }
  ],
  "estimatedDuration": 45,
  "difficulty": "intermediate"
}`

  try {
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Generate a personalized workout plan for me.' }
      ],
      temperature: 0.7,
      max_tokens: 1000
    })
    
    const content = response.choices[0].message.content
    
    // Try to parse JSON from response
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0])
      }
    } catch (e) {
      console.error('Failed to parse workout plan JSON:', e)
    }
    
    // Fallback: return structured format
    return {
      name: 'AI Generated Workout',
      exercises: [],
      estimatedDuration: 45,
      difficulty: 'intermediate',
      rawResponse: content
    }
  } catch (error) {
    console.error('Error generating workout plan:', error)
    throw new Error('Failed to generate workout plan')
  }
}

