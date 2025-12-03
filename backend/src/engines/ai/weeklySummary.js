/**
 * AI-Powered Weekly Summary Generation
 */

export async function generateWeeklySummary(openai, userId, weekData, mlResults) {
  const systemPrompt = `You are a fitness coach providing a weekly summary to your client. Be encouraging, specific, and actionable.

Week Data:
- Workouts completed: ${weekData.workouts?.length || 0}
- Average calories: ${weekData.nutrition?.avgCalories || 'N/A'}
- Average steps: ${weekData.health?.avgSteps || 'N/A'}
- Readiness scores: ${JSON.stringify(weekData.readiness || [])}

ML Insights:
- Workout trends: ${mlResults.workoutAnalysis?.trend || 'N/A'}
- Nutrition consistency: ${mlResults.nutritionAnalysis?.consistency || 'N/A'}
- Anomalies detected: ${mlResults.anomalies?.length || 0}

Generate a weekly summary that:
1. Highlights achievements and progress
2. Identifies areas for improvement
3. Provides specific, actionable recommendations
4. Is encouraging and motivating
5. References specific data points

Keep it concise (2-3 paragraphs).`

  try {
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Generate my weekly fitness summary.' }
      ],
      temperature: 0.8,
      max_tokens: 500
    })
    
    return {
      summary: response.choices[0].message.content,
      week: weekData.week,
      highlights: extractHighlights(weekData, mlResults),
      recommendations: extractRecommendations(mlResults)
    }
  } catch (error) {
    console.error('Error generating weekly summary:', error)
    throw new Error('Failed to generate weekly summary')
  }
}

function extractHighlights(weekData, mlResults) {
  const highlights = []
  
  if (weekData.workouts?.length >= 4) {
    highlights.push(`Completed ${weekData.workouts.length} workouts this week`)
  }
  
  if (mlResults.workoutAnalysis?.trend === 'increasing') {
    highlights.push('Training volume is increasing - great progress!')
  }
  
  if (mlResults.nutritionAnalysis?.consistency > 80) {
    highlights.push('Excellent nutrition consistency')
  }
  
  return highlights
}

function extractRecommendations(mlResults) {
  const recommendations = []
  
  if (mlResults.anomalies) {
    mlResults.anomalies.forEach(anomaly => {
      if (anomaly.severity === 'critical' || anomaly.severity === 'warning') {
        recommendations.push(anomaly.message)
      }
    })
  }
  
  if (mlResults.nutritionAnalysis?.insights) {
    recommendations.push(...mlResults.nutritionAnalysis.insights)
  }
  
  return recommendations
}

