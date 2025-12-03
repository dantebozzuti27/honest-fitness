/**
 * Adjustment Strategy
 * Dynamically adjusts goals and produces weekly summaries
 */

import { generateAIWeeklySummary } from '../ai/index.js'

export async function generateAdjustments(userId, dataContext, mlResults, aiResults) {
  const adjustments = {
    goalAdjustments: [],
    behaviorCorrections: [],
    weeklySummary: null,
    recommendations: []
  }
  
  // Analyze goal adherence
  const goalAnalysis = analyzeGoalAdherence(dataContext, mlResults)
  adjustments.goalAdjustments = goalAnalysis.adjustments
  
  // Detect behavior deviations
  const behaviorAnalysis = detectBehaviorDeviations(dataContext, mlResults)
  adjustments.behaviorCorrections = behaviorAnalysis.corrections
  
  // Generate weekly summary
  if (dataContext.weekData) {
    adjustments.weeklySummary = await generateAIWeeklySummary(
      userId,
      dataContext.weekData,
      mlResults
    )
  }
  
  // Generate recommendations
  adjustments.recommendations = generateRecommendations(dataContext, mlResults, goalAnalysis, behaviorAnalysis)
  
  return adjustments
}

function analyzeGoalAdherence(dataContext, mlResults) {
  const adjustments = []
  const userGoals = dataContext.user?.goals || []
  
  // Check workout goal adherence
  if (userGoals.includes('workout_consistency')) {
    const workoutFrequency = mlResults.workoutAnalysis?.avgFrequency || 0
    if (workoutFrequency > 4) {
      adjustments.push({
        type: 'workout_frequency',
        current: workoutFrequency,
        recommended: 3,
        action: 'Reduce frequency to allow better recovery',
        reason: 'Training too frequently may lead to overtraining'
      })
    } else if (workoutFrequency < 1.5) {
      adjustments.push({
        type: 'workout_frequency',
        current: workoutFrequency,
        recommended: 3,
        action: 'Increase workout frequency for better progress',
        reason: 'Current frequency may be too low for optimal results'
      })
    }
  }
  
  // Check nutrition goal adherence
  if (userGoals.includes('weight_loss') && mlResults.nutritionAnalysis) {
    const avgCalories = mlResults.nutritionAnalysis.avgCalories
    const targetCalories = dataContext.user?.preferences?.targetCalories || 2000
    
    if (avgCalories > targetCalories * 1.1) {
      adjustments.push({
        type: 'calorie_target',
        current: avgCalories,
        recommended: targetCalories,
        action: 'Reduce daily calorie intake to meet weight loss goals',
        reason: 'Current intake exceeds target by more than 10%'
      })
    }
  }
  
  return { adjustments, adherence: calculateAdherenceScore(adjustments) }
}

function detectBehaviorDeviations(dataContext, mlResults) {
  const corrections = []
  
  // Check for workout deviations
  if (mlResults.anomalies) {
    mlResults.anomalies.forEach(anomaly => {
      if (anomaly.type === 'workout' && anomaly.severity === 'critical') {
        corrections.push({
          type: 'workout',
          issue: anomaly.message,
          correction: 'Reduce training volume and prioritize recovery',
          priority: 'high'
        })
      }
    })
  }
  
  // Check for nutrition deviations
  if (mlResults.nutritionAnalysis) {
    if (mlResults.nutritionAnalysis.consistency < 60) {
      corrections.push({
        type: 'nutrition',
        issue: 'Inconsistent nutrition patterns',
        correction: 'Establish regular meal times and consistent portion sizes',
        priority: 'medium'
      })
    }
  }
  
  // Check for recovery issues
  if (mlResults.readiness?.zone === 'red') {
    corrections.push({
      type: 'recovery',
      issue: 'Low readiness score indicates insufficient recovery',
      correction: 'Prioritize sleep, reduce training intensity, and ensure adequate nutrition',
      priority: 'high'
    })
  }
  
  return { corrections, severity: corrections.length > 0 ? 'moderate' : 'low' }
}

function generateRecommendations(dataContext, mlResults, goalAnalysis, behaviorAnalysis) {
  const recommendations = []
  
  // Add ML-based recommendations
  if (mlResults.workoutAnalysis?.insights) {
    recommendations.push(...mlResults.workoutAnalysis.insights.map(insight => ({
      category: 'workout',
      message: insight,
      priority: 'medium'
    })))
  }
  
  if (mlResults.nutritionAnalysis?.insights) {
    recommendations.push(...mlResults.nutritionAnalysis.insights.map(insight => ({
      category: 'nutrition',
      message: insight,
      priority: 'medium'
    })))
  }
  
  // Add goal adjustment recommendations
  goalAnalysis.adjustments.forEach(adj => {
    recommendations.push({
      category: adj.type,
      message: adj.action,
      priority: 'high',
      reason: adj.reason
    })
  })
  
  // Add behavior correction recommendations
  behaviorAnalysis.corrections.forEach(corr => {
    recommendations.push({
      category: corr.type,
      message: corr.correction,
      priority: corr.priority,
      issue: corr.issue
    })
  })
  
  return recommendations
}

function calculateAdherenceScore(adjustments) {
  if (adjustments.length === 0) return 100
  
  // Lower score if more adjustments needed
  const baseScore = 100
  const penalty = adjustments.length * 10
  return Math.max(0, baseScore - penalty)
}

