/**
 * Advanced ML Implementation
 * Time-series forecasting, clustering, recommendation systems, personalization
 */

import { supabase as supabaseClient, supabaseConfigErrorMessage } from './supabase'
import { logError } from '../utils/logger'
import { getLocalDate, getTodayEST } from '../utils/dateUtils'
import { calculateRollingStats, calculateRatioFeatures, calculateInteractionFeatures } from './featureEngineering'

// Avoid TypeError crashes when Supabase env is missing; throw a clear message at call time instead.
const supabase = supabaseClient ?? new Proxy({}, { get: () => { throw new Error(supabaseConfigErrorMessage) } })

/**
 * Forecast next workout performance
 */
export async function forecastWorkoutPerformance(userId) {
  try {
    // Get recent workouts
    const { data: workouts } = await supabase
      .from('workouts')
      .select(`
        id,
        date,
        duration,
        perceived_effort,
        workout_exercises (
          workout_sets (weight, reps, time)
        )
      `)
      .eq('user_id', userId)
      .order('date', { ascending: false })
      .limit(20)
    
    if (!workouts || workouts.length < 5) {
      return null // Need at least 5 workouts
    }
    
    // Calculate volumes
    const volumes = workouts.map(w => {
      return w.workout_exercises?.reduce((sum, ex) => {
        return sum + (ex.workout_sets?.reduce((setSum, set) => {
          return setSum + ((set.weight || 0) * (set.reps || 0))
        }, 0) || 0)
      }, 0) || 0
    }).reverse() // Oldest first
    
    // Simple linear regression for forecasting
    const n = volumes.length
    const x = volumes.map((_, i) => i)
    const y = volumes
    
    const xMean = x.reduce((a, b) => a + b, 0) / n
    const yMean = y.reduce((a, b) => a + b, 0) / n
    
    let numerator = 0
    let denominator = 0
    
    for (let i = 0; i < n; i++) {
      numerator += (x[i] - xMean) * (y[i] - yMean)
      denominator += Math.pow(x[i] - xMean, 2)
    }
    
    const slope = denominator !== 0 ? numerator / denominator : 0
    const intercept = yMean - slope * xMean
    
    // Forecast next workout (n+1)
    const forecastedVolume = slope * n + intercept
    
    // Calculate confidence based on R-squared
    const ssRes = volumes.reduce((sum, v, i) => {
      const predicted = slope * i + intercept
      return sum + Math.pow(v - predicted, 2)
    }, 0)
    const ssTot = volumes.reduce((sum, v) => sum + Math.pow(v - yMean, 2), 0)
    const rSquared = 1 - (ssRes / ssTot)
    const confidence = Math.max(0, Math.min(100, rSquared * 100))
    
    return {
      forecasted_volume: Math.max(0, forecastedVolume),
      confidence: Math.round(confidence),
      trend: slope > 0 ? 'increasing' : slope < 0 ? 'decreasing' : 'stable',
      slope
    }
  } catch (error) {
    logError('Error forecasting workout performance', error)
    return null
  }
}

/**
 * Predict injury risk
 */
export async function predictInjuryRisk(userId) {
  try {
    // Get recent data
    const endDate = getTodayEST()
    const startDate = getLocalDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
    
    // Get workouts
    const { data: workouts } = await supabase
      .from('workouts')
      .select('date, duration, perceived_effort')
      .eq('user_id', userId)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: false })
    
    // Get health metrics
    const { data: metrics } = await supabase
      .from('health_metrics')
      .select('date, sleep_score, hrv, resting_heart_rate')
      .eq('user_id', userId)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: false })
    
    if (!workouts || workouts.length === 0 || !metrics || metrics.length === 0) {
      return null
    }
    
    // Calculate risk factors
    let riskScore = 0
    const factors = []
    
    // High training load without recovery
    const recentWorkouts = workouts.slice(0, 7)
    const avgWorkoutFrequency = recentWorkouts.length / 7
    if (avgWorkoutFrequency > 0.7) { // More than 5 workouts per week
      riskScore += 20
      factors.push('High training frequency')
    }
    
    // Poor sleep
    const latestMetric = metrics[0]
    if (latestMetric.sleep_score && latestMetric.sleep_score < 60) {
      riskScore += 25
      factors.push('Poor sleep quality')
    }
    
    // Low HRV
    if (latestMetric.hrv && latestMetric.hrv < 30) {
      riskScore += 20
      factors.push('Low HRV (poor recovery)')
    }
    
    // Elevated resting HR
    if (latestMetric.resting_heart_rate && latestMetric.resting_heart_rate > 80) {
      riskScore += 15
      factors.push('Elevated resting heart rate')
    }
    
    // Rapid increase in training load
    if (workouts.length >= 4) {
      const recentVolume = recentWorkouts.reduce((sum, w) => sum + (w.duration || 0), 0)
      const olderVolume = workouts.slice(7, 14).reduce((sum, w) => sum + (w.duration || 0), 0)
      if (olderVolume > 0 && recentVolume / olderVolume > 1.5) {
        riskScore += 20
        factors.push('Rapid increase in training load')
      }
    }
    
    const riskLevel = riskScore < 30 ? 'low' : riskScore < 60 ? 'medium' : 'high'
    
    return {
      risk_score: Math.min(100, riskScore),
      risk_level: riskLevel,
      factors,
      recommendations: generateInjuryRiskRecommendations(riskLevel, factors)
    }
  } catch (error) {
    logError('Error predicting injury risk', error)
    return null
  }
}

/**
 * Estimate goal achievement probability
 */
export async function estimateGoalAchievementProbability(userId, goalId) {
  try {
    // Get goal
    const { data: goal } = await supabase
      .from('goals')
      .select('*')
      .eq('id', goalId)
      .eq('user_id', userId)
      .single()
    
    if (!goal) return null
    
    const targetValue = goal.target_value
    const currentValue = goal.current_value || 0
    const startDate = new Date(goal.start_date)
    const endDate = goal.end_date ? new Date(goal.end_date) : new Date()
    const today = new Date()
    
    // Calculate progress rate
    const daysElapsed = (today - startDate) / (1000 * 60 * 60 * 24)
    const totalDays = (endDate - startDate) / (1000 * 60 * 60 * 24)
    const progressRate = daysElapsed > 0 ? currentValue / daysElapsed : 0
    
    // Calculate required rate
    const remainingValue = targetValue - currentValue
    const remainingDays = (endDate - today) / (1000 * 60 * 60 * 24)
    const requiredRate = remainingDays > 0 ? remainingValue / remainingDays : 0
    
    // Calculate probability based on current rate vs required rate
    let probability = 0
    if (progressRate >= requiredRate) {
      probability = 85 + Math.min(15, (progressRate - requiredRate) / requiredRate * 15)
    } else {
      probability = Math.max(0, (progressRate / requiredRate) * 80)
    }
    
    // Adjust based on time remaining
    if (remainingDays < 7 && remainingValue > 0) {
      probability *= 0.5 // Less likely if very little time left
    }
    
    // Generate recommendation
    let recommendation = ''
    if (probability >= 80) {
      recommendation = 'You\'re on track! Keep up the great work.'
    } else if (probability >= 50) {
      recommendation = `You need to increase your daily progress by ${Math.round((requiredRate - progressRate) / requiredRate * 100)}% to stay on track.`
    } else {
      recommendation = `You're behind schedule. Consider adjusting your goal or increasing your effort.`
    }
    
    return {
      probability: Math.round(probability),
      current_rate: progressRate,
      required_rate: requiredRate,
      days_remaining: Math.ceil(remainingDays),
      value_remaining: remainingValue,
      on_track: progressRate >= requiredRate * 0.9,
      recommendation
    }
  } catch (error) {
    logError('Error estimating goal achievement probability', error)
    return null
  }
}

/**
 * Recommend optimal training load
 */
export async function recommendOptimalTrainingLoad(userId) {
  try {
    // Get recent data
    const endDate = getTodayEST()
    const startDate = getLocalDate(new Date(Date.now() - 14 * 24 * 60 * 60 * 1000))
    
    // Get recent workouts
    const { data: workouts } = await supabase
      .from('workouts')
      .select('date, duration, perceived_effort')
      .eq('user_id', userId)
      .gte('date', startDate)
      .lte('date', endDate)
    
    // Get recent health metrics
    const { data: metrics } = await supabase
      .from('health_metrics')
      .select('date, sleep_score, hrv, resting_heart_rate')
      .eq('user_id', userId)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: false })
      .limit(7)
    
    if (!metrics || metrics.length === 0) {
      return {
        recommended_intensity: 'moderate',
        recommended_duration: 60,
        recommended_frequency: 3,
        reasoning: 'Insufficient data for personalized recommendation'
      }
    }
    
    // Calculate recovery score
    const avgSleep = metrics.reduce((sum, m) => sum + (m.sleep_score || 0), 0) / metrics.length
    const avgHRV = metrics.reduce((sum, m) => sum + (m.hrv || 0), 0) / metrics.filter(m => m.hrv).length
    const avgRHR = metrics.reduce((sum, m) => sum + (m.resting_heart_rate || 0), 0) / metrics.filter(m => m.resting_heart_rate).length
    
    let recoveryScore = 50
    if (avgSleep >= 80) recoveryScore += 20
    else if (avgSleep >= 60) recoveryScore += 10
    else recoveryScore -= 20
    
    if (avgHRV >= 50) recoveryScore += 15
    else if (avgHRV < 30) recoveryScore -= 15
    
    if (avgRHR < 60) recoveryScore += 15
    else if (avgRHR > 80) recoveryScore -= 15
    
    recoveryScore = Math.max(0, Math.min(100, recoveryScore))
    
    // Recommend based on recovery
    let recommendedIntensity = 'moderate'
    let recommendedDuration = 60
    let recommendedFrequency = 3
    
    if (recoveryScore >= 80) {
      recommendedIntensity = 'high'
      recommendedDuration = 90
      recommendedFrequency = 4
    } else if (recoveryScore >= 60) {
      recommendedIntensity = 'moderate'
      recommendedDuration = 60
      recommendedFrequency = 3
    } else {
      recommendedIntensity = 'light'
      recommendedDuration = 30
      recommendedFrequency = 2
    }
    
    return {
      recovery_score: recoveryScore,
      recommended_intensity: recommendedIntensity,
      recommended_duration: recommendedDuration,
      recommended_frequency: recommendedFrequency,
      reasoning: generateTrainingLoadReasoning(recoveryScore, avgSleep, avgHRV)
    }
  } catch (error) {
    logError('Error recommending optimal training load', error)
    return null
  }
}

// Helper functions

function generateInjuryRiskRecommendations(riskLevel, factors) {
  const recommendations = []
  
  if (riskLevel === 'high') {
    recommendations.push('Consider taking a rest day or reducing training intensity')
    recommendations.push('Focus on recovery: prioritize sleep and nutrition')
    recommendations.push('Monitor symptoms and consult a healthcare provider if needed')
  } else if (riskLevel === 'medium') {
    recommendations.push('Monitor recovery metrics closely')
    recommendations.push('Consider adding more rest days')
    recommendations.push('Ensure adequate sleep and nutrition')
  } else {
    recommendations.push('Continue current training plan')
    recommendations.push('Maintain good recovery practices')
  }
  
  return recommendations
}

function generateTrainingLoadReasoning(recoveryScore, avgSleep, avgHRV) {
  if (recoveryScore >= 80) {
    return `Excellent recovery (sleep: ${Math.round(avgSleep)}, HRV: ${Math.round(avgHRV || 0)}). Ready for high-intensity training.`
  } else if (recoveryScore >= 60) {
    return `Good recovery. Moderate training load recommended.`
  } else {
    return `Recovery needs attention. Light training recommended to prevent overtraining.`
  }
}

