/**
 * Comprehensive Data Access Library
 * Provides access to all user data with filtering, trends, and slicing
 */

import { supabase } from './supabase'
import { getTodayEST } from '../utils/dateUtils'

/**
 * Get Fitbit data with date range filter
 */
export async function getFitbitDataRange(userId, startDate, endDate) {
  const { data, error } = await supabase
    .from('fitbit_daily')
    .select('*')
    .eq('user_id', userId)
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: true })
  
  if (error) throw error
  return data || []
}

/**
 * Get all Fitbit data for a user
 */
export async function getAllFitbitData(userId) {
  const { data, error } = await supabase
    .from('fitbit_daily')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: false })
  
  if (error) throw error
  return data || []
}

/**
 * Get daily metrics with date range filter
 */
export async function getDailyMetricsRange(userId, startDate, endDate) {
  const { data, error } = await supabase
    .from('daily_metrics')
    .select('*')
    .eq('user_id', userId)
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: true })
  
  if (error) throw error
  return data || []
}

/**
 * Get workouts with date range filter
 */
export async function getWorkoutsRange(userId, startDate, endDate) {
  const { data, error } = await supabase
    .from('workouts')
    .select('*')
    .eq('user_id', userId)
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: false })
  
  if (error) throw error
  return data || []
}

/**
 * Get nutrition data with date range filter
 */
export async function getNutritionDataRange(userId, startDate, endDate) {
  // Nutrition data might be in daily_metrics or a separate table
  // For now, we'll get it from daily_metrics
  const { data, error } = await supabase
    .from('daily_metrics')
    .select('date, calories, weight')
    .eq('user_id', userId)
    .gte('date', startDate)
    .lte('date', endDate)
    .not('calories', 'is', null)
    .order('date', { ascending: true })
  
  if (error) throw error
  return data || []
}

/**
 * Calculate trends for a metric over time
 */
export function calculateTrend(data, metricKey, period = 'week') {
  if (!data || data.length === 0) return null
  
  const sorted = [...data].sort((a, b) => new Date(a.date) - new Date(b.date))
  
  // Group by period
  const grouped = {}
  sorted.forEach(item => {
    const date = new Date(item.date)
    let key
    
    if (period === 'day') {
      key = date.toISOString().split('T')[0]
    } else if (period === 'week') {
      const weekStart = new Date(date)
      weekStart.setDate(date.getDate() - date.getDay())
      key = weekStart.toISOString().split('T')[0]
    } else if (period === 'month') {
      key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    } else if (period === 'year') {
      key = String(date.getFullYear())
    }
    
    if (!grouped[key]) {
      grouped[key] = []
    }
    grouped[key].push(item[metricKey])
  })
  
  // Calculate averages per period
  const trends = Object.entries(grouped).map(([period, values]) => {
    const numericValues = values.filter(v => v != null && !isNaN(v)).map(Number)
    return {
      period,
      average: numericValues.length > 0 
        ? numericValues.reduce((a, b) => a + b, 0) / numericValues.length 
        : null,
      min: numericValues.length > 0 ? Math.min(...numericValues) : null,
      max: numericValues.length > 0 ? Math.max(...numericValues) : null,
      count: numericValues.length
    }
  })
  
  // Calculate trend direction
  if (trends.length >= 2) {
    const recent = trends[trends.length - 1].average
    const previous = trends[trends.length - 2].average
    if (recent != null && previous != null) {
      const change = ((recent - previous) / previous) * 100
      trends[trends.length - 1].trend = change > 5 ? 'up' : change < -5 ? 'down' : 'stable'
      trends[trends.length - 1].changePercent = change
    }
  }
  
  return trends
}

/**
 * Get data slice by time period
 */
export function sliceDataByPeriod(data, period = 'week') {
  if (!data || data.length === 0) return {}
  
  const sorted = [...data].sort((a, b) => new Date(a.date) - new Date(b.date))
  const sliced = {}
  
  sorted.forEach(item => {
    const date = new Date(item.date)
    let key
    
    if (period === 'day') {
      key = date.toISOString().split('T')[0]
    } else if (period === 'week') {
      const weekStart = new Date(date)
      weekStart.setDate(date.getDate() - date.getDay())
      key = weekStart.toISOString().split('T')[0]
    } else if (period === 'month') {
      key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    } else if (period === 'year') {
      key = String(date.getFullYear())
    }
    
    if (!sliced[key]) {
      sliced[key] = []
    }
    sliced[key].push(item)
  })
  
  return sliced
}

/**
 * Compare two time periods
 */
export function comparePeriods(data, period1Start, period1End, period2Start, period2End, metricKey) {
  const period1Data = data.filter(item => {
    const date = new Date(item.date)
    return date >= new Date(period1Start) && date <= new Date(period1End)
  })
  
  const period2Data = data.filter(item => {
    const date = new Date(item.date)
    return date >= new Date(period2Start) && date <= new Date(period2End)
  })
  
  const period1Avg = period1Data
    .map(item => Number(item[metricKey]))
    .filter(v => !isNaN(v))
    .reduce((a, b) => a + b, 0) / period1Data.length || 0
  
  const period2Avg = period2Data
    .map(item => Number(item[metricKey]))
    .filter(v => !isNaN(v))
    .reduce((a, b) => a + b, 0) / period2Data.length || 0
  
  return {
    period1: {
      start: period1Start,
      end: period1End,
      average: period1Avg,
      count: period1Data.length
    },
    period2: {
      start: period2Start,
      end: period2End,
      average: period2Avg,
      count: period2Data.length
    },
    change: period1Avg > 0 ? ((period2Avg - period1Avg) / period1Avg) * 100 : 0,
    changeAbsolute: period2Avg - period1Avg
  }
}

/**
 * Get summary statistics for a metric
 */
export function getMetricSummary(data, metricKey) {
  if (!data || data.length === 0) return null
  
  const values = data
    .map(item => Number(item[metricKey]))
    .filter(v => !isNaN(v) && v != null)
  
  if (values.length === 0) return null
  
  const sorted = [...values].sort((a, b) => a - b)
  const sum = values.reduce((a, b) => a + b, 0)
  const avg = sum / values.length
  
  return {
    count: values.length,
    average: avg,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    median: sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)],
    sum: sum,
    stdDev: calculateStdDev(values, avg)
  }
}

function calculateStdDev(values, mean) {
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2))
  const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / values.length
  return Math.sqrt(avgSquaredDiff)
}

/**
 * Get all user data with filters
 */
export async function getAllUserData(userId, filters = {}) {
  const {
    startDate = null,
    endDate = null,
    dataTypes = ['fitbit', 'workouts', 'metrics', 'nutrition'],
    metrics = []
  } = filters
  
  const end = endDate || getTodayEST()
  const start = startDate || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  
  const results = {}
  
  if (dataTypes.includes('fitbit')) {
    results.fitbit = await getFitbitDataRange(userId, start, end)
  }
  
  if (dataTypes.includes('workouts')) {
    results.workouts = await getWorkoutsRange(userId, start, end)
  }
  
  if (dataTypes.includes('metrics')) {
    results.metrics = await getDailyMetricsRange(userId, start, end)
  }
  
  if (dataTypes.includes('nutrition')) {
    results.nutrition = await getNutritionDataRange(userId, start, end)
  }
  
  return results
}

/**
 * Get correlation between two metrics
 */
export function getCorrelation(data, metric1Key, metric2Key) {
  if (!data || data.length < 2) return null
  
  const pairs = data
    .map(item => ({
      x: Number(item[metric1Key]),
      y: Number(item[metric2Key])
    }))
    .filter(pair => !isNaN(pair.x) && !isNaN(pair.y) && pair.x != null && pair.y != null)
  
  if (pairs.length < 2) return null
  
  const n = pairs.length
  const sumX = pairs.reduce((sum, p) => sum + p.x, 0)
  const sumY = pairs.reduce((sum, p) => sum + p.y, 0)
  const sumXY = pairs.reduce((sum, p) => sum + p.x * p.y, 0)
  const sumX2 = pairs.reduce((sum, p) => sum + p.x * p.x, 0)
  const sumY2 = pairs.reduce((sum, p) => sum + p.y * p.y, 0)
  
  const numerator = n * sumXY - sumX * sumY
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY))
  
  if (denominator === 0) return null
  
  return numerator / denominator
}

/**
 * Get top/bottom days for a metric
 */
export function getExtremes(data, metricKey, count = 5, direction = 'top') {
  if (!data || data.length === 0) return []
  
  const valid = data
    .map(item => ({
      ...item,
      value: Number(item[metricKey])
    }))
    .filter(item => !isNaN(item.value) && item.value != null)
    .sort((a, b) => direction === 'top' ? b.value - a.value : a.value - b.value)
  
  return valid.slice(0, count)
}

/**
 * Get data for specific date range with all metrics
 */
export async function getDataForDateRange(userId, startDate, endDate) {
  const [fitbit, metrics, workouts, nutrition] = await Promise.all([
    getFitbitDataRange(userId, startDate, endDate),
    getDailyMetricsRange(userId, startDate, endDate),
    getWorkoutsRange(userId, startDate, endDate),
    getNutritionDataRange(userId, startDate, endDate)
  ])
  
  return {
    fitbit,
    metrics,
    workouts,
    nutrition,
    dateRange: { start: startDate, end: endDate }
  }
}

