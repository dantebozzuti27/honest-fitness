/**
 * Comparative Analytics
 * Period-over-period comparisons, peer comparisons, population benchmarks
 */

import { supabase } from './supabase'
import { logError } from '../utils/logger'

/**
 * Compare periods (this week vs last week, etc.)
 */
export async function comparePeriods(userId, metric, period1, period2) {
  try {
    const [data1, data2] = await Promise.all([
      getPeriodData(userId, metric, period1),
      getPeriodData(userId, metric, period2)
    ])
    
    if (!data1 || !data2) return null
    
    const change = data2.value - data1.value
    const changePercent = data1.value > 0 ? (change / data1.value) * 100 : 0
    
    return {
      metric,
      period1: {
        ...period1,
        value: data1.value
      },
      period2: {
        ...period2,
        value: data2.value
      },
      change,
      change_percent: Math.round(changePercent * 100) / 100,
      trend: change > 0 ? 'increasing' : change < 0 ? 'decreasing' : 'stable'
    }
  } catch (error) {
    logError('Error comparing periods', error)
    return null
  }
}

/**
 * Compare user to peers (anonymized)
 */
export async function compareToPeers(userId, metric, period = 30) {
  try {
    // Get user's data
    const userData = await getPeriodData(userId, metric, {
      start: new Date(Date.now() - period * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      end: new Date().toISOString().split('T')[0]
    })
    
    if (!userData) return null
    
    // Get peer data (anonymized - aggregate statistics only)
    const peerStats = await getPeerStatistics(metric, period)
    
    if (!peerStats) return null
    
    const userPercentile = calculatePercentile(userData.value, peerStats.distribution)
    
    return {
      metric,
      user_value: userData.value,
      peer_average: peerStats.average,
      peer_median: peerStats.median,
      peer_percentile: userPercentile,
      comparison: userData.value > peerStats.average ? 'above_average' : 
                   userData.value < peerStats.average ? 'below_average' : 'average'
    }
  } catch (error) {
    logError('Error comparing to peers', error)
    return null
  }
}

/**
 * Compare to population benchmarks
 */
export async function compareToBenchmarks(userId, metric) {
  try {
    // Get user's current value
    const userData = await getPeriodData(userId, metric, {
      start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      end: new Date().toISOString().split('T')[0]
    })
    
    if (!userData) return null
    
    // Get benchmarks (could be from external source or calculated)
    const benchmarks = getBenchmarks(metric)
    
    return {
      metric,
      user_value: userData.value,
      benchmarks,
      comparison: compareToBenchmark(userData.value, benchmarks)
    }
  } catch (error) {
    logError('Error comparing to benchmarks', error)
    return null
  }
}

/**
 * Compare goal vs actual
 */
export async function compareGoalVsActual(userId, goalId) {
  try {
    // Get goal
    const { data: goal } = await supabase
      .from('goals')
      .select('*')
      .eq('id', goalId)
      .eq('user_id', userId)
      .single()
    
    if (!goal) return null
    
    const actual = goal.current_value || 0
    const target = goal.target_value
    const progress = goal.progress_percentage || 0
    
    const remaining = target - actual
    const onTrack = progress >= (new Date() - new Date(goal.start_date)) / (new Date(goal.end_date || new Date()) - new Date(goal.start_date)) * 100
    
    return {
      goal_id: goalId,
      goal_name: goal.custom_name || goal.type,
      target_value: target,
      current_value: actual,
      remaining,
      progress_percentage: progress,
      on_track: onTrack,
      days_remaining: goal.end_date ? Math.ceil((new Date(goal.end_date) - new Date()) / (1000 * 60 * 60 * 24)) : null
    }
  } catch (error) {
    logError('Error comparing goal vs actual', error)
    return null
  }
}

// Helper functions

async function getPeriodData(userId, metric, period) {
  const startDate = typeof period.start === 'string' ? period.start : period.start.toISOString().split('T')[0]
  const endDate = typeof period.end === 'string' ? period.end : period.end.toISOString().split('T')[0]
  
  switch (metric) {
    case 'workout_count':
      const { count } = await supabase
        .from('workouts')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('date', startDate)
        .lte('date', endDate)
      return { value: count || 0 }
    
    case 'total_volume':
      // Calculate total volume for period
      const { data: workouts } = await supabase
        .from('workouts')
        .select(`
          workout_exercises (
            workout_sets (weight, reps)
          )
        `)
        .eq('user_id', userId)
        .gte('date', startDate)
        .lte('date', endDate)
      
      if (!workouts) return { value: 0 }
      
      const volume = workouts.reduce((sum, w) => {
        return sum + (w.workout_exercises?.reduce((exSum, ex) => {
          return exSum + (ex.workout_sets?.reduce((setSum, set) => {
            return setSum + ((set.weight || 0) * (set.reps || 0))
          }, 0) || 0)
        }, 0) || 0)
      }, 0)
      
      return { value: volume }
    
    case 'avg_sleep_score':
      const { data: metrics } = await supabase
        .from('health_metrics')
        .select('sleep_score')
        .eq('user_id', userId)
        .gte('date', startDate)
        .lte('date', endDate)
        .not('sleep_score', 'is', null)
      
      if (!metrics || metrics.length === 0) return { value: 0 }
      
      const avgSleep = metrics.reduce((sum, m) => sum + (m.sleep_score || 0), 0) / metrics.length
      return { value: avgSleep }
    
    default:
      return null
  }
}

async function getPeerStatistics(metric, period) {
  // This would typically query aggregated, anonymized data
  // For now, return mock data structure
  // In production, this would query a materialized view of anonymized statistics
  
  return {
    average: 0, // Would be calculated from anonymized peer data
    median: 0,
    distribution: [] // Would contain distribution data
  }
}

function calculatePercentile(value, distribution) {
  if (!distribution || distribution.length === 0) return 50
  
  const below = distribution.filter(d => d < value).length
  return (below / distribution.length) * 100
}

function getBenchmarks(metric) {
  // Industry benchmarks (simplified - would come from research/external sources)
  const benchmarks = {
    workout_frequency: { excellent: 5, good: 3, average: 2 },
    sleep_score: { excellent: 85, good: 70, average: 60 },
    steps: { excellent: 10000, good: 7500, average: 5000 }
  }
  
  return benchmarks[metric] || {}
}

function compareToBenchmark(value, benchmarks) {
  if (!benchmarks || Object.keys(benchmarks).length === 0) return 'no_benchmark'
  
  if (value >= benchmarks.excellent) return 'excellent'
  if (value >= benchmarks.good) return 'good'
  if (value >= benchmarks.average) return 'average'
  return 'below_average'
}

