/**
 * Nutrition Trend Analysis
 */

export async function analyzeNutritionTrends(userId, nutritionData) {
  if (!nutritionData || nutritionData.length === 0) {
    return null
  }
  
  // Calculate averages
  const totalDays = nutritionData.length
  const avgCalories = nutritionData.reduce((sum, day) => sum + (day.calories || 0), 0) / totalDays
  const avgProtein = nutritionData.reduce((sum, day) => sum + (day.macros?.protein || 0), 0) / totalDays
  const avgCarbs = nutritionData.reduce((sum, day) => sum + (day.macros?.carbs || 0), 0) / totalDays
  const avgFat = nutritionData.reduce((sum, day) => sum + (day.macros?.fat || 0), 0) / totalDays
  
  // Calculate consistency
  const calorieVariance = nutritionData.reduce((sum, day) => {
    const diff = (day.calories || 0) - avgCalories
    return sum + (diff * diff)
  }, 0) / totalDays
  const consistency = Math.max(0, 100 - (Math.sqrt(calorieVariance) / avgCalories * 100))
  
  // Macro balance
  const totalMacros = avgProtein + avgCarbs + avgFat
  const macroBalance = {
    protein: (avgProtein / totalMacros * 100).toFixed(1),
    carbs: (avgCarbs / totalMacros * 100).toFixed(1),
    fat: (avgFat / totalMacros * 100).toFixed(1)
  }
  
  // Trend analysis
  const recentDays = nutritionData.slice(-7)
  const recentAvg = recentDays.reduce((sum, day) => sum + (day.calories || 0), 0) / recentDays.length
  const trend = recentAvg > avgCalories * 1.1 ? 'increasing' 
    : recentAvg < avgCalories * 0.9 ? 'decreasing' 
    : 'stable'
  
  return {
    avgCalories: Math.round(avgCalories),
    avgMacros: {
      protein: Math.round(avgProtein),
      carbs: Math.round(avgCarbs),
      fat: Math.round(avgFat)
    },
    macroBalance,
    consistency: Math.round(consistency),
    trend,
    insights: generateNutritionInsights(avgCalories, macroBalance, consistency)
  }
}

function generateNutritionInsights(avgCalories, macroBalance, consistency) {
  const insights = []
  
  if (consistency < 70) {
    insights.push('Calorie intake is inconsistent - aim for more regular eating patterns')
  }
  
  const proteinPct = parseFloat(macroBalance.protein)
  if (proteinPct < 20) {
    insights.push('Protein intake is low - consider increasing to support muscle recovery')
  } else if (proteinPct > 40) {
    insights.push('Protein intake is very high - ensure adequate carbs for energy')
  }
  
  return insights
}

