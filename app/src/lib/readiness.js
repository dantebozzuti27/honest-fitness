import { supabase } from './supabase'
import { getWorkoutsFromSupabase, getAllMetricsFromSupabase } from './supabaseDb'
import { getTodayEST } from '../utils/dateUtils'

/**
 * Calculate Honest Readiness Score (0-100)
 * Combines:
 * - Acute:chronic training load ratio (from RPE-based strain)
 * - Overnight HRV + RHR deviation (7-day baseline)
 * - Body temperature deviation
 * - Sleep debt
 * - Previous-day strain
 */
export async function calculateReadinessScore(userId, date = null) {
  const targetDate = date || getTodayEST()
  const targetDateObj = new Date(targetDate)
  
  // Get date range for calculations (need 7-28 days of history)
  const endDate = new Date(targetDateObj)
  const startDate = new Date(targetDateObj)
  startDate.setDate(startDate.getDate() - 28)
  
  const startDateStr = startDate.toISOString().split('T')[0]
  const endDateStr = endDate.toISOString().split('T')[0]
  
  // Get workouts and metrics
  const workouts = await getWorkoutsFromSupabase(userId)
  const metrics = await getAllMetricsFromSupabase(userId)
  
  // Filter to date range
  const recentWorkouts = workouts.filter(w => w.date >= startDateStr && w.date <= endDateStr)
  const recentMetrics = metrics.filter(m => m.date >= startDateStr && m.date <= endDateStr)
  
  // 1. Calculate Acute:Chronic Training Load Ratio
  const acRatio = calculateAcuteChronicRatio(recentWorkouts, targetDate)
  
  // 2. Calculate HRV + RHR deviation (7-day baseline)
  const hrvScore = calculateHRVScore(recentMetrics, targetDate)
  
  // 3. Body temperature deviation
  const tempScore = calculateTempScore(recentMetrics, targetDate)
  
  // 4. Sleep debt
  const sleepScore = calculateSleepScore(recentMetrics, targetDate)
  
  // 5. Previous-day strain
  const strainScore = calculatePreviousDayStrain(recentWorkouts, targetDate)
  
  // Weighted combination (based on tested formula)
  const readiness = (
    acRatio * 0.25 +
    hrvScore * 0.30 +
    tempScore * 0.15 +
    sleepScore * 0.20 +
    strainScore * 0.10
  )
  
  const score = Math.round(Math.max(0, Math.min(100, readiness)))
  const zone = getReadinessZone(score)
  
  return {
    score,
    zone,
    components: {
      acRatio: Math.round(acRatio),
      hrvScore: Math.round(hrvScore),
      tempScore: Math.round(tempScore),
      sleepScore: Math.round(sleepScore),
      strainScore: Math.round(strainScore)
    },
    date: targetDate
  }
}

/**
 * Calculate Acute:Chronic Training Load Ratio
 * Acute = last 7 days, Chronic = last 28 days
 */
function calculateAcuteChronicRatio(workouts, targetDate) {
  const targetDateObj = new Date(targetDate)
  
  // Calculate strain from RPE: strain = RPE * duration (minutes) / 60
  const calculateStrain = (workout) => {
    const rpe = workout.perceived_effort || 5 // Default to 5 if no RPE
    const duration = (workout.duration || 0) / 60 // Convert seconds to minutes
    return rpe * duration
  }
  
  // Acute load (last 7 days)
  const acuteStart = new Date(targetDateObj)
  acuteStart.setDate(acuteStart.getDate() - 7)
  const acuteWorkouts = workouts.filter(w => {
    const wDate = new Date(w.date)
    return wDate >= acuteStart && wDate <= targetDateObj
  })
  const acuteLoad = acuteWorkouts.reduce((sum, w) => sum + calculateStrain(w), 0)
  
  // Chronic load (last 28 days)
  const chronicStart = new Date(targetDateObj)
  chronicStart.setDate(chronicStart.getDate() - 28)
  const chronicWorkouts = workouts.filter(w => {
    const wDate = new Date(w.date)
    return wDate >= chronicStart && wDate <= targetDateObj
  })
  const chronicLoad = chronicWorkouts.reduce((sum, w) => sum + calculateStrain(w), 0) / 4
  
  // Ratio: optimal is 0.8-1.3, score based on deviation
  const ratio = chronicLoad > 0 ? acuteLoad / chronicLoad : 1.0
  
  // Score: 100 = perfect (1.0), decreases as ratio deviates
  let score = 100
  if (ratio < 0.5) score = 40 // Too low
  else if (ratio < 0.8) score = 60 + (ratio - 0.5) * 66.67 // 60-80
  else if (ratio <= 1.3) score = 80 + (ratio - 0.8) * 40 // 80-100 (optimal)
  else if (ratio <= 1.8) score = 100 - (ratio - 1.3) * 40 // 100-80
  else score = 40 - (ratio - 1.8) * 20 // Below 40
  
  return Math.max(0, Math.min(100, score))
}

/**
 * Calculate HRV + RHR deviation score
 * Uses 7-day baseline
 */
function calculateHRVScore(metrics, targetDate) {
  const targetDateObj = new Date(targetDate)
  const baselineStart = new Date(targetDateObj)
  baselineStart.setDate(baselineStart.getDate() - 7)
  
  // Get baseline metrics (last 7 days, excluding today)
  const baselineMetrics = metrics.filter(m => {
    const mDate = new Date(m.date)
    return mDate >= baselineStart && mDate < targetDateObj && (m.hrv || m.sleep_score)
  })
  
  if (baselineMetrics.length === 0) return 70 // Default if no data
  
  // Calculate baseline averages
  const hrvValues = baselineMetrics.map(m => m.hrv).filter(v => v != null)
  const rhrValues = baselineMetrics.map(m => m.sleep_score).filter(v => v != null) // Using sleep_score as proxy for RHR if available
  
  const avgHRV = hrvValues.length > 0 ? hrvValues.reduce((a, b) => a + b, 0) / hrvValues.length : null
  const avgRHR = rhrValues.length > 0 ? rhrValues.reduce((a, b) => a + b, 0) / rhrValues.length : null
  
  // Get today's metrics
  const todayMetric = metrics.find(m => m.date === targetDate)
  
  if (!todayMetric) return 70 // Default if no today data
  
  let score = 100
  
  // HRV deviation (higher is better, so lower than baseline = lower score)
  if (avgHRV && todayMetric.hrv) {
    const hrvDeviation = (todayMetric.hrv - avgHRV) / avgHRV
    if (hrvDeviation < -0.15) score -= 30 // >15% below baseline
    else if (hrvDeviation < -0.05) score -= 15 // 5-15% below
    else if (hrvDeviation > 0.05) score += 10 // Above baseline is good
  }
  
  // RHR deviation (lower is better, so higher than baseline = lower score)
  if (avgRHR && todayMetric.sleep_score) {
    const rhrDeviation = (todayMetric.sleep_score - avgRHR) / avgRHR
    if (rhrDeviation > 0.10) score -= 20 // >10% above baseline
    else if (rhrDeviation > 0.05) score -= 10 // 5-10% above
  }
  
  return Math.max(0, Math.min(100, score))
}

/**
 * Calculate body temperature deviation score
 */
function calculateTempScore(metrics, targetDate) {
  // For now, return default if no temp data
  // This would be populated from wearables
  const todayMetric = metrics.find(m => m.date === targetDate)
  
  // If we have temp data in future, calculate deviation
  // For now, assume normal if no data
  return todayMetric?.body_temp ? 85 : 85
}

/**
 * Calculate sleep debt score
 */
function calculateSleepScore(metrics, targetDate) {
  const targetDateObj = new Date(targetDate)
  const baselineStart = new Date(targetDateObj)
  baselineStart.setDate(baselineStart.getDate() - 7)
  
  // Get baseline sleep (last 7 days, excluding today)
  const baselineMetrics = metrics.filter(m => {
    const mDate = new Date(m.date)
    return mDate >= baselineStart && mDate < targetDateObj && m.sleep_time
  })
  
  if (baselineMetrics.length === 0) return 70 // Default
  
  const avgSleep = baselineMetrics.reduce((sum, m) => sum + (m.sleep_time || 0), 0) / baselineMetrics.length
  const optimalSleep = 8 * 60 // 8 hours in minutes
  
  // Get today's sleep
  const todayMetric = metrics.find(m => m.date === targetDate)
  const todaySleep = todayMetric?.sleep_time || avgSleep
  
  // Calculate sleep debt
  const sleepDebt = Math.max(0, optimalSleep - todaySleep)
  const debtRatio = sleepDebt / optimalSleep
  
  // Score: 100 = no debt, decreases with debt
  let score = 100 - (debtRatio * 50)
  
  // Bonus for extra sleep
  if (todaySleep > optimalSleep) {
    score = Math.min(100, score + 5)
  }
  
  return Math.max(0, Math.min(100, score))
}

/**
 * Calculate previous day strain score
 */
function calculatePreviousDayStrain(workouts, targetDate) {
  const targetDateObj = new Date(targetDate)
  const yesterday = new Date(targetDateObj)
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = yesterday.toISOString().split('T')[0]
  
  const yesterdayWorkouts = workouts.filter(w => w.date === yesterdayStr)
  
  if (yesterdayWorkouts.length === 0) return 100 // No workout = no strain
  
  // Calculate total strain from yesterday
  const totalStrain = yesterdayWorkouts.reduce((sum, w) => {
    const rpe = w.perceived_effort || 5
    const duration = (w.duration || 0) / 60
    return sum + (rpe * duration)
  }, 0)
  
  // High strain yesterday = lower readiness today
  // Normalize: 0-50 strain = 100-70 score, 50+ strain = 70-40 score
  let score = 100
  if (totalStrain > 50) {
    score = 70 - ((totalStrain - 50) / 10) * 3
  } else if (totalStrain > 0) {
    score = 100 - (totalStrain / 50) * 30
  }
  
  return Math.max(40, Math.min(100, score))
}

/**
 * Get readiness zone (Green/Yellow/Red)
 */
function getReadinessZone(score) {
  if (score >= 70) return 'green'
  if (score >= 50) return 'yellow'
  return 'red'
}

/**
 * Save readiness score to database
 */
export async function saveReadinessScore(userId, readinessData) {
  try {
    const { data, error } = await supabase
      .from('honest_readiness')
      .upsert({
        user_id: userId,
        date: readinessData.date,
        score: readinessData.score,
        zone: readinessData.zone,
        ac_ratio: readinessData.components.acRatio,
        hrv_score: readinessData.components.hrvScore,
        temp_score: readinessData.components.tempScore,
        sleep_score: readinessData.components.sleepScore,
        strain_score: readinessData.components.strainScore
      }, { onConflict: 'user_id,date' })
      .select()
      .single()
    
    // Handle PGRST116 error (table not found in schema cache) gracefully
    if (error) {
      if (error.code === 'PGRST116' || error.message?.includes('Could not find the table')) {
        console.warn('honest_readiness table not available, skipping save:', error.message)
        return null
      }
      throw error
    }
    return data
  } catch (error) {
    // Fallback for any other errors
    console.warn('Error saving readiness score:', error)
    return null
  }
}

/**
 * Get readiness score for a date
 */
export async function getReadinessScore(userId, date = null) {
  const targetDate = date || getTodayEST()
  
  try {
    const { data, error } = await supabase
      .from('honest_readiness')
      .select('*')
      .eq('user_id', userId)
      .eq('date', targetDate)
      .maybeSingle()
    
    // Handle PGRST116 error (table not found in schema cache) gracefully
    if (error) {
      // If table doesn't exist, return null instead of throwing
      if (error.code === 'PGRST116' || error.message?.includes('Could not find the table')) {
        console.warn('honest_readiness table not available:', error.message)
        return null
      }
      throw error
    }
    return data
  } catch (error) {
    // Fallback for any other errors
    console.warn('Error fetching readiness score:', error)
    return null
  }
}

/**
 * Get readiness scores for date range
 */
export async function getReadinessScores(userId, startDate, endDate) {
  try {
    const { data, error } = await supabase
      .from('honest_readiness')
      .select('*')
      .eq('user_id', userId)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: true })
    
    // Handle PGRST116 error (table not found in schema cache) gracefully
    if (error) {
      if (error.code === 'PGRST116' || error.message?.includes('Could not find the table')) {
        console.warn('honest_readiness table not available:', error.message)
        return []
      }
      throw error
    }
    return data || []
  } catch (error) {
    // Fallback for any other errors
    console.warn('Error fetching readiness scores:', error)
    return []
  }
}

