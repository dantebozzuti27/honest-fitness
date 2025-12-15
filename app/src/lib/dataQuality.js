/**
 * Data Quality Monitoring and Tracking
 * Tracks data completeness, freshness, accuracy, and consistency
 */

import { supabase as supabaseClient, supabaseConfigErrorMessage } from './supabase'
import { logError } from '../utils/logger'

// Avoid TypeError crashes when Supabase env is missing; throw a clear message at call time instead.
const supabase = supabaseClient ?? new Proxy({}, { get: () => { throw new Error(supabaseConfigErrorMessage) } })

/**
 * Calculate data completeness score for a user
 */
export async function calculateDataCompleteness(userId, dateRange = { start: null, end: null }) {
  try {
    const startDate = dateRange.start || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const endDate = dateRange.end || new Date().toISOString().split('T')[0]
    
    // Get all expected data points
    const expectedDays = getDaysBetween(startDate, endDate)
    
    // Get actual data points
    const [workouts, metrics, nutrition] = await Promise.all([
      getWorkoutCount(userId, startDate, endDate),
      getMetricsCount(userId, startDate, endDate),
      getNutritionCount(userId, startDate, endDate)
    ])
    
    // Calculate completeness for each data type
    const workoutCompleteness = (workouts / expectedDays) * 100
    const metricsCompleteness = (metrics / expectedDays) * 100
    const nutritionCompleteness = (nutrition / expectedDays) * 100
    
    // Overall completeness (weighted average)
    const overallCompleteness = (
      workoutCompleteness * 0.3 +
      metricsCompleteness * 0.4 +
      nutritionCompleteness * 0.3
    )
    
    // Identify gaps
    const gaps = await identifyDataGaps(userId, startDate, endDate)
    
    return {
      overall_score: Math.round(overallCompleteness),
      workout_completeness: Math.round(workoutCompleteness),
      metrics_completeness: Math.round(metricsCompleteness),
      nutrition_completeness: Math.round(nutritionCompleteness),
      gaps,
      recommendations: generateCompletenessRecommendations({
        workoutCompleteness,
        metricsCompleteness,
        nutritionCompleteness,
        gaps
      })
    }
  } catch (error) {
    logError('Error calculating data completeness', error)
    return null
  }
}

/**
 * Track data freshness (how recent is the data)
 */
export async function calculateDataFreshness(userId) {
  try {
    const [lastWorkout, lastMetric, lastNutrition] = await Promise.all([
      getLastWorkoutDate(userId),
      getLastMetricDate(userId),
      getLastNutritionDate(userId)
    ])
    
    const now = new Date()
    
    const workoutAge = lastWorkout ? Math.floor((now - new Date(lastWorkout)) / (1000 * 60 * 60 * 24)) : null
    const metricAge = lastMetric ? Math.floor((now - new Date(lastMetric)) / (1000 * 60 * 60 * 24)) : null
    const nutritionAge = lastNutrition ? Math.floor((now - new Date(lastNutrition)) / (1000 * 60 * 60 * 24)) : null
    
    return {
      workout_age_days: workoutAge,
      metric_age_days: metricAge,
      nutrition_age_days: nutritionAge,
      is_fresh: workoutAge !== null && workoutAge <= 7 && metricAge !== null && metricAge <= 1
    }
  } catch (error) {
    logError('Error calculating data freshness', error)
    return null
  }
}

/**
 * Detect data quality issues
 */
export async function detectDataQualityIssues(userId, dateRange = { start: null, end: null }) {
  try {
    const startDate = dateRange.start || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const endDate = dateRange.end || new Date().toISOString().split('T')[0]
    
    const issues = []
    
    // Check for missing required fields
    const missingFields = await checkMissingFields(userId, startDate, endDate)
    if (missingFields.length > 0) {
      issues.push({
        type: 'missing_fields',
        severity: 'medium',
        count: missingFields.length,
        details: missingFields
      })
    }
    
    // Check for outliers
    const outliers = await detectOutliers(userId, startDate, endDate)
    if (outliers.length > 0) {
      issues.push({
        type: 'outliers',
        severity: 'high',
        count: outliers.length,
        details: outliers
      })
    }
    
    // Check for duplicates
    const duplicates = await detectDuplicates(userId, startDate, endDate)
    if (duplicates.length > 0) {
      issues.push({
        type: 'duplicates',
        severity: 'medium',
        count: duplicates.length,
        details: duplicates
      })
    }
    
    // Check for inconsistencies
    const inconsistencies = await detectInconsistencies(userId, startDate, endDate)
    if (inconsistencies.length > 0) {
      issues.push({
        type: 'inconsistencies',
        severity: 'low',
        count: inconsistencies.length,
        details: inconsistencies
      })
    }
    
    return {
      total_issues: issues.length,
      issues,
      quality_score: calculateQualityScore(issues)
    }
  } catch (error) {
    logError('Error detecting data quality issues', error)
    return null
  }
}

/**
 * Save data quality metrics
 */
export async function saveDataQualityMetrics(userId, metrics) {
  try {
    const { error } = await supabase
      .from('data_quality_metrics')
      .upsert({
        user_id: userId,
        completeness_score: metrics.completeness_score,
        freshness_score: metrics.freshness_score,
        accuracy_score: metrics.accuracy_score,
        consistency_score: metrics.consistency_score,
        overall_score: metrics.overall_score,
        issues_count: metrics.issues_count,
        metrics_date: new Date().toISOString().split('T')[0],
        details: metrics.details || {}
      }, {
        onConflict: 'user_id,metrics_date'
      })
    
    if (error) {
      logError('Error saving data quality metrics', error)
    }
  } catch (error) {
    logError('Error in saveDataQualityMetrics', error)
  }
}

// Helper functions

function getDaysBetween(start, end) {
  const startDate = new Date(start)
  const endDate = new Date(end)
  const diffTime = Math.abs(endDate - startDate)
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1
}

async function getWorkoutCount(userId, startDate, endDate) {
  const { count } = await supabase
    .from('workouts')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('date', startDate)
    .lte('date', endDate)
  
  return count || 0
}

async function getMetricsCount(userId, startDate, endDate) {
  const { count } = await supabase
    .from('health_metrics')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('date', startDate)
    .lte('date', endDate)
  
  return count || 0
}

async function getNutritionCount(userId, startDate, endDate) {
  const { count } = await supabase
    .from('health_metrics')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('date', startDate)
    .lte('date', endDate)
    .not('calories_consumed', 'is', null)
  
  return count || 0
}

async function identifyDataGaps(userId, startDate, endDate) {
  // Get all dates with data
  const { data: workouts } = await supabase
    .from('workouts')
    .select('date')
    .eq('user_id', userId)
    .gte('date', startDate)
    .lte('date', endDate)
  
  const workoutDates = new Set(workouts?.map(w => w.date) || [])
  
  // Find gaps (consecutive days without workouts)
  const gaps = []
  const start = new Date(startDate)
  const end = new Date(endDate)
  
  let currentDate = new Date(start)
  let gapStart = null
  
  while (currentDate <= end) {
    const dateStr = currentDate.toISOString().split('T')[0]
    const hasData = workoutDates.has(dateStr)
    
    if (!hasData && !gapStart) {
      gapStart = dateStr
    } else if (hasData && gapStart) {
      gaps.push({
        start: gapStart,
        end: new Date(currentDate.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        days: Math.ceil((new Date(gapStart) - new Date(gapStart)) / (1000 * 60 * 60 * 24))
      })
      gapStart = null
    }
    
    currentDate.setDate(currentDate.getDate() + 1)
  }
  
  return gaps
}

function generateCompletenessRecommendations({ workoutCompleteness, metricsCompleteness, nutritionCompleteness, gaps }) {
  const recommendations = []
  
  if (workoutCompleteness < 50) {
    recommendations.push('Log workouts more consistently to improve data completeness')
  }
  
  if (metricsCompleteness < 70) {
    recommendations.push('Track health metrics daily for better insights')
  }
  
  if (nutritionCompleteness < 60) {
    recommendations.push('Log meals regularly to get accurate nutrition data')
  }
  
  if (gaps.length > 0) {
    recommendations.push(`You have ${gaps.length} data gaps - try to fill them for better analytics`)
  }
  
  return recommendations
}

async function getLastWorkoutDate(userId) {
  const { data } = await supabase
    .from('workouts')
    .select('date')
    .eq('user_id', userId)
    .order('date', { ascending: false })
    .limit(1)
    .single()
  
  return data?.date || null
}

async function getLastMetricDate(userId) {
  const { data } = await supabase
    .from('health_metrics')
    .select('date')
    .eq('user_id', userId)
    .order('date', { ascending: false })
    .limit(1)
    .single()
  
  return data?.date || null
}

async function getLastNutritionDate(userId) {
  const { data } = await supabase
    .from('health_metrics')
    .select('date')
    .eq('user_id', userId)
    .not('calories_consumed', 'is', null)
    .order('date', { ascending: false })
    .limit(1)
    .single()
  
  return data?.date || null
}

async function checkMissingFields(userId, startDate, endDate) {
  // Check for workouts without exercises
  const { data: workouts } = await supabase
    .from('workouts')
    .select('id, date')
    .eq('user_id', userId)
    .gte('date', startDate)
    .lte('date', endDate)
  
  const missing = []
  
  for (const workout of workouts || []) {
    const { count } = await supabase
      .from('workout_exercises')
      .select('*', { count: 'exact', head: true })
      .eq('workout_id', workout.id)
    
    if (count === 0) {
      missing.push({
        type: 'workout',
        id: workout.id,
        date: workout.date,
        issue: 'No exercises'
      })
    }
  }
  
  return missing
}

async function detectOutliers(userId, startDate, endDate) {
  // This would use statistical methods - simplified here
  const { data: workouts } = await supabase
    .from('workouts')
    .select('id, date, duration')
    .eq('user_id', userId)
    .gte('date', startDate)
    .lte('date', endDate)
  
  if (!workouts || workouts.length < 3) return []
  
  const durations = workouts.map(w => w.duration || 0).filter(d => d > 0)
  if (durations.length < 3) return []
  
  const avg = durations.reduce((a, b) => a + b, 0) / durations.length
  const stdDev = Math.sqrt(durations.reduce((sum, d) => sum + Math.pow(d - avg, 2), 0) / durations.length)
  
  const outliers = workouts.filter(w => {
    const duration = w.duration || 0
    if (duration === 0) return false
    const zScore = Math.abs((duration - avg) / stdDev)
    return zScore > 3 // More than 3 standard deviations
  })
  
  return outliers.map(w => ({
    type: 'workout',
    id: w.id,
    date: w.date,
    issue: `Duration outlier: ${w.duration} minutes (avg: ${Math.round(avg)})`
  }))
}

async function detectDuplicates(userId, startDate, endDate) {
  // Check for duplicate workouts on same date
  const { data: workouts } = await supabase
    .from('workouts')
    .select('id, date')
    .eq('user_id', userId)
    .gte('date', startDate)
    .lte('date', endDate)
  
  const dateCounts = {}
  workouts?.forEach(w => {
    dateCounts[w.date] = (dateCounts[w.date] || 0) + 1
  })
  
  const duplicates = Object.entries(dateCounts)
    .filter(([date, count]) => count > 1)
    .map(([date, count]) => ({
      type: 'workout',
      date,
      issue: `${count} workouts on same date`
    }))
  
  return duplicates
}

async function detectInconsistencies(userId, startDate, endDate) {
  // Check for logical inconsistencies
  const inconsistencies = []
  
  // Example: workout duration longer than 24 hours
  const { data: workouts } = await supabase
    .from('workouts')
    .select('id, date, duration')
    .eq('user_id', userId)
    .gte('date', startDate)
    .lte('date', endDate)
    .gt('duration', 1440) // More than 24 hours
  
  workouts?.forEach(w => {
    inconsistencies.push({
      type: 'workout',
      id: w.id,
      date: w.date,
      issue: `Duration seems incorrect: ${w.duration} minutes`
    })
  })
  
  return inconsistencies
}

function calculateQualityScore(issues) {
  let score = 100
  
  issues.forEach(issue => {
    switch (issue.severity) {
      case 'high':
        score -= issue.count * 10
        break
      case 'medium':
        score -= issue.count * 5
        break
      case 'low':
        score -= issue.count * 2
        break
    }
  })
  
  return Math.max(0, Math.min(100, score))
}

