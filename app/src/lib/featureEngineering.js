/**
 * Feature Engineering Pipeline
 * Calculates derived features: rolling averages, trends, ratios, interactions
 */

import { supabase } from './supabase'
import { logError } from '../utils/logger'

/**
 * Calculate rolling statistics for a metric
 */
export async function calculateRollingStats(userId, metricType, windowDays = 7) {
  try {
    const endDate = new Date().toISOString().split('T')[0]
    const startDate = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    
    let data = []
    
    switch (metricType) {
      case 'workout_volume':
        data = await getWorkoutVolumes(userId, startDate, endDate)
        break
      case 'sleep_score':
        data = await getSleepScores(userId, startDate, endDate)
        break
      case 'hrv':
        data = await getHRVValues(userId, startDate, endDate)
        break
      case 'steps':
        data = await getStepsValues(userId, startDate, endDate)
        break
      default:
        return null
    }
    
    if (data.length === 0) return null
    
    // Calculate rolling average
    const rollingAvg = data.reduce((sum, d) => sum + d.value, 0) / data.length
    
    // Calculate rolling standard deviation
    const variance = data.reduce((sum, d) => sum + Math.pow(d.value - rollingAvg, 2), 0) / data.length
    const rollingStdDev = Math.sqrt(variance)
    
    // Calculate trend (slope)
    const trend = calculateTrend(data)
    
    // Calculate acceleration (change in trend)
    const acceleration = calculateAcceleration(data)
    
    return {
      window_days: windowDays,
      rolling_average: rollingAvg,
      rolling_std_dev: rollingStdDev,
      trend,
      acceleration,
      data_points: data.length,
      min: Math.min(...data.map(d => d.value)),
      max: Math.max(...data.map(d => d.value))
    }
  } catch (error) {
    logError('Error calculating rolling stats', error)
    return null
  }
}

/**
 * Calculate trend features (slope, acceleration)
 */
function calculateTrend(data) {
  if (data.length < 2) return 0
  
  // Simple linear regression
  const n = data.length
  const x = data.map((_, i) => i)
  const y = data.map(d => d.value)
  
  const xMean = x.reduce((a, b) => a + b, 0) / n
  const yMean = y.reduce((a, b) => a + b, 0) / n
  
  let numerator = 0
  let denominator = 0
  
  for (let i = 0; i < n; i++) {
    numerator += (x[i] - xMean) * (y[i] - yMean)
    denominator += Math.pow(x[i] - xMean, 2)
  }
  
  return denominator !== 0 ? numerator / denominator : 0
}

function calculateAcceleration(data) {
  if (data.length < 3) return 0
  
  // Calculate trend for first half and second half
  const mid = Math.floor(data.length / 2)
  const firstHalf = data.slice(0, mid)
  const secondHalf = data.slice(mid)
  
  const firstTrend = calculateTrend(firstHalf)
  const secondTrend = calculateTrend(secondHalf)
  
  return secondTrend - firstTrend
}

/**
 * Calculate ratio features
 */
export async function calculateRatioFeatures(userId, dateRange = {}) {
  try {
    const endDate = dateRange.end || new Date().toISOString().split('T')[0]
    const startDate = dateRange.start || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    
    // Get workout data
    const { data: workouts } = await supabase
      .from('workouts')
      .select(`
        id,
        date,
        duration,
        workout_exercises (
          workout_sets (weight, reps, time)
        )
      `)
      .eq('user_id', userId)
      .gte('date', startDate)
      .lte('date', endDate)
    
    if (!workouts || workouts.length === 0) return null
    
    // Calculate volume and intensity
    const volumes = workouts.map(w => {
      return w.workout_exercises?.reduce((sum, ex) => {
        return sum + (ex.workout_sets?.reduce((setSum, set) => {
          return setSum + ((set.weight || 0) * (set.reps || 0))
        }, 0) || 0)
      }, 0) || 0
    })
    
    const totalVolume = volumes.reduce((a, b) => a + b, 0)
    const avgVolume = totalVolume / workouts.length
    
    // Get health metrics
    const { data: metrics } = await supabase
      .from('health_metrics')
      .select('sleep_score, hrv, resting_heart_rate, steps')
      .eq('user_id', userId)
      .gte('date', startDate)
      .lte('date', endDate)
      .not('sleep_score', 'is', null)
    
    const avgSleepScore = metrics && metrics.length > 0
      ? metrics.reduce((sum, m) => sum + (m.sleep_score || 0), 0) / metrics.length
      : null
    
    // Calculate ratios
    const volumeIntensityRatio = avgVolume > 0 ? avgVolume / (workouts[0]?.duration || 1) : 0
    const workoutSleepRatio = avgSleepScore ? workouts.length / (avgSleepScore / 10) : null
    const volumePerWorkout = avgVolume
    
    return {
      volume_intensity_ratio: volumeIntensityRatio,
      workout_sleep_ratio: workoutSleepRatio,
      volume_per_workout: volumePerWorkout,
      avg_workout_frequency: workouts.length / ((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24))
    }
  } catch (error) {
    logError('Error calculating ratio features', error)
    return null
  }
}

/**
 * Calculate interaction features (workout × sleep, etc.)
 */
export async function calculateInteractionFeatures(userId, dateRange = {}) {
  try {
    const endDate = dateRange.end || new Date().toISOString().split('T')[0]
    const startDate = dateRange.start || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    
    // Get workouts with dates
    const { data: workouts } = await supabase
      .from('workouts')
      .select('id, date, duration, perceived_effort')
      .eq('user_id', userId)
      .gte('date', startDate)
      .lte('date', endDate)
    
    // Get health metrics
    const { data: metrics } = await supabase
      .from('health_metrics')
      .select('date, sleep_score, hrv, resting_heart_rate')
      .eq('user_id', userId)
      .gte('date', startDate)
      .lte('date', endDate)
    
    if (!workouts || workouts.length === 0 || !metrics || metrics.length === 0) {
      return null
    }
    
    // Create date-indexed metrics map
    const metricsMap = new Map()
    metrics.forEach(m => {
      metricsMap.set(m.date, m)
    })
    
    // Calculate interactions for each workout
    const interactions = workouts.map(workout => {
      const workoutDate = workout.date
      const metric = metricsMap.get(workoutDate)
      
      if (!metric) return null
      
      return {
        workout_id: workout.id,
        date: workoutDate,
        workout_sleep_interaction: (workout.duration || 0) * (metric.sleep_score || 0),
        workout_hrv_interaction: (workout.duration || 0) * (metric.hrv || 0),
        effort_sleep_interaction: (workout.perceived_effort || 5) * (metric.sleep_score || 0),
        effort_hrv_interaction: (workout.perceived_effort || 5) * (metric.hrv || 0)
      }
    }).filter(i => i !== null)
    
    // Calculate averages
    const avgWorkoutSleep = interactions.length > 0
      ? interactions.reduce((sum, i) => sum + i.workout_sleep_interaction, 0) / interactions.length
      : 0
    
    const avgWorkoutHRV = interactions.length > 0
      ? interactions.reduce((sum, i) => sum + i.workout_hrv_interaction, 0) / interactions.length
      : 0
    
    return {
      interactions,
      averages: {
        workout_sleep: avgWorkoutSleep,
        workout_hrv: avgWorkoutHRV
      }
    }
  } catch (error) {
    logError('Error calculating interaction features', error)
    return null
  }
}

/**
 * Save engineered features to database
 */
export async function saveEngineeredFeatures(userId, features) {
  try {
    const { error } = await supabase
      .from('engineered_features')
      .upsert({
        user_id: userId,
        feature_type: features.type,
        features: features.data,
        calculated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id,feature_type'
      })
    
    if (error) {
      logError('Error saving engineered features', error)
    }
  } catch (error) {
    logError('Error in saveEngineeredFeatures', error)
  }
}

// Helper functions

async function getWorkoutVolumes(userId, startDate, endDate) {
  const { data: workouts } = await supabase
    .from('workouts')
    .select(`
      date,
      workout_exercises (
        workout_sets (weight, reps)
      )
    `)
    .eq('user_id', userId)
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: true })
  
  if (!workouts) return []
  
  return workouts.map(w => {
    const volume = w.workout_exercises?.reduce((sum, ex) => {
      return sum + (ex.workout_sets?.reduce((setSum, set) => {
        return setSum + ((set.weight || 0) * (set.reps || 0))
      }, 0) || 0)
    }, 0) || 0
    
    return {
      date: w.date,
      value: volume
    }
  })
}

async function getSleepScores(userId, startDate, endDate) {
  const { data } = await supabase
    .from('health_metrics')
    .select('date, sleep_score')
    .eq('user_id', userId)
    .gte('date', startDate)
    .lte('date', endDate)
    .not('sleep_score', 'is', null)
    .order('date', { ascending: true })
  
  if (!data) return []
  
  return data.map(m => ({
    date: m.date,
    value: m.sleep_score
  }))
}

async function getHRVValues(userId, startDate, endDate) {
  const { data } = await supabase
    .from('health_metrics')
    .select('date, hrv')
    .eq('user_id', userId)
    .gte('date', startDate)
    .lte('date', endDate)
    .not('hrv', 'is', null)
    .order('date', { ascending: true })
  
  if (!data) return []
  
  return data.map(m => ({
    date: m.date,
    value: m.hrv
  }))
}

async function getStepsValues(userId, startDate, endDate) {
  const { data } = await supabase
    .from('health_metrics')
    .select('date, steps')
    .eq('user_id', userId)
    .gte('date', startDate)
    .lte('date', endDate)
    .not('steps', 'is', null)
    .order('date', { ascending: true })
  
  if (!data) return []
  
  return data.map(m => ({
    date: m.date,
    value: m.steps
  }))
}

