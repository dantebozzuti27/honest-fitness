/**
 * AI-Powered Contextual Insights Generation
 */

export async function generateInsights(openai, userId, dataContext, mlResults) {
  const systemPrompt = `You are an AI fitness coach. Generate personalized, contextual insights based on the user's data.

Current Context:
- Readiness score: ${mlResults.readiness?.score || 'N/A'} (${mlResults.readiness?.zone || 'N/A'})
- Recent workouts: ${dataContext.workouts?.length || 0}
- Sleep quality: ${dataContext.health?.sleep_efficiency || 'N/A'}%
- Activity level: ${dataContext.health?.steps || 'N/A'} steps today

ML Analysis:
- Workout trends: ${JSON.stringify(mlResults.workoutAnalysis || {})}
- Nutrition analysis: ${JSON.stringify(mlResults.nutritionAnalysis || {})}
- Anomalies: ${mlResults.anomalies?.length || 0} detected

Generate 2-3 personalized insights that:
1. Are specific to the user's current situation
2. Reference actual data points
3. Provide actionable guidance
4. Are encouraging and supportive

Format as an array of insight objects with "type", "message", and "action" fields.`

  try {
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'What insights do you have for me today?' }
      ],
      temperature: 0.7,
      max_tokens: 400
    })
    
    const content = response.choices[0].message.content
    
    // Try to parse as JSON array
    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0])
      }
    } catch (e) {
      // Fallback to structured format
    }
    
    // Fallback: create insights from ML results
    return generateFallbackInsights(mlResults, dataContext)
  } catch (error) {
    console.error('Error generating insights:', error)
    return generateFallbackInsights(mlResults, dataContext)
  }
}

function generateFallbackInsights(mlResults, dataContext) {
  const insights = []
  
  if (mlResults.readiness) {
    if (mlResults.readiness.zone === 'green') {
      insights.push({
        type: 'readiness',
        message: 'Your readiness score is high - perfect time to push your limits!',
        action: 'Consider increasing workout intensity today'
      })
    } else if (mlResults.readiness.zone === 'red') {
      insights.push({
        type: 'readiness',
        message: 'Your readiness score is low - prioritize recovery',
        action: 'Consider a rest day or light activity'
      })
    }
  }
  
  if (mlResults.workoutAnalysis?.insights) {
    mlResults.workoutAnalysis.insights.forEach(insight => {
      insights.push({
        type: 'workout',
        message: insight,
        action: 'Review your training balance'
      })
    })
  }
  
  return insights
}

