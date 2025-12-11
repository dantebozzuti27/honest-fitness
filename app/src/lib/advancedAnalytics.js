/**
 * Advanced Analytics Capabilities
 * Cohort analysis, funnel analysis, retention analysis, user segmentation
 */

import { supabase } from './supabase'
import { logError } from '../utils/logger'

/**
 * Cohort Analysis - User retention by signup date
 */
export async function analyzeCohorts(userId = null, startDate = null, endDate = null) {
  try {
    let query = supabase
      .from('auth.users')
      .select('id, created_at')
      .order('created_at', { ascending: true })
    
    if (startDate) {
      query = query.gte('created_at', startDate)
    }
    if (endDate) {
      query = query.lte('created_at', endDate)
    }
    
    const { data: users, error } = await query
    
    if (error) throw error
    if (!users || users.length === 0) return null
    
    // Group users by signup month (cohort)
    const cohorts = {}
    users.forEach(user => {
      const signupDate = new Date(user.created_at)
      const cohortMonth = `${signupDate.getFullYear()}-${String(signupDate.getMonth() + 1).padStart(2, '0')}`
      
      if (!cohorts[cohortMonth]) {
        cohorts[cohortMonth] = {
          signup_month: cohortMonth,
          total_users: 0,
          retention: {}
        }
      }
      cohorts[cohortMonth].total_users++
    })
    
    // Calculate retention for each cohort
    for (const cohortMonth of Object.keys(cohorts)) {
      const cohortUsers = users.filter(u => {
        const signupDate = new Date(u.created_at)
        const userCohort = `${signupDate.getFullYear()}-${String(signupDate.getMonth() + 1).padStart(2, '0')}`
        return userCohort === cohortMonth
      })
      
      // Check retention at different time periods
      const retentionPeriods = [7, 14, 30, 60, 90] // days
      
      for (const period of retentionPeriods) {
        const activeUsers = await countActiveUsers(cohortUsers.map(u => u.id), period)
        cohorts[cohortMonth].retention[`day_${period}`] = {
          active_users: activeUsers,
          retention_rate: (activeUsers / cohortUsers.length) * 100
        }
      }
    }
    
    return Object.values(cohorts)
  } catch (error) {
    logError('Error analyzing cohorts', error)
    return null
  }
}

/**
 * Funnel Analysis - Conversion funnels
 */
export async function analyzeFunnel(funnelSteps, dateRange = {}) {
  try {
    const startDate = dateRange.start || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const endDate = dateRange.end || new Date().toISOString()
    
    const funnel = []
    let previousCount = null
    
    for (let i = 0; i < funnelSteps.length; i++) {
      const step = funnelSteps[i]
      
      // Count users who reached this step
      const { count, error } = await supabase
        .from('user_events')
        .select('*', { count: 'exact', head: true })
        .eq('event_name', step.event_name)
        .gte('timestamp', startDate)
        .lte('timestamp', endDate)
      
      if (error) throw error
      
      const userCount = count || 0
      const conversionRate = previousCount !== null && previousCount > 0
        ? (userCount / previousCount) * 100
        : 100
      
      funnel.push({
        step: step.name,
        event_name: step.event_name,
        user_count: userCount,
        conversion_rate: Math.round(conversionRate * 100) / 100,
        drop_off: previousCount !== null ? previousCount - userCount : 0
      })
      
      previousCount = userCount
    }
    
    return {
      funnel,
      overall_conversion: funnel.length > 0 && funnel[0].user_count > 0
        ? (funnel[funnel.length - 1].user_count / funnel[0].user_count) * 100
        : 0
    }
  } catch (error) {
    logError('Error analyzing funnel', error)
    return null
  }
}

/**
 * Retention Analysis
 */
export async function analyzeRetention(userId = null, period = 30) {
  try {
    const endDate = new Date()
    const startDate = new Date(endDate.getTime() - period * 24 * 60 * 60 * 1000)
    
    // Get all users who were active in the period
    const { data: activeUsers } = await supabase
      .from('user_events')
      .select('user_id')
      .gte('timestamp', startDate.toISOString())
      .lte('timestamp', endDate.toISOString())
    
    if (!activeUsers || activeUsers.length === 0) return null
    
    const uniqueUsers = [...new Set(activeUsers.map(u => u.user_id))]
    
    // Calculate return rate (users who came back)
    const returnRates = {}
    for (const uid of uniqueUsers) {
      const { data: events } = await supabase
        .from('user_events')
        .select('timestamp')
        .eq('user_id', uid)
        .gte('timestamp', startDate.toISOString())
        .lte('timestamp', endDate.toISOString())
        .order('timestamp', { ascending: true })
      
      if (events && events.length > 1) {
        // Calculate days between first and last visit
        const firstVisit = new Date(events[0].timestamp)
        const lastVisit = new Date(events[events.length - 1].timestamp)
        const daysBetween = (lastVisit - firstVisit) / (1000 * 60 * 60 * 24)
        
        // Calculate return rate (visits per week)
        const weeks = daysBetween / 7
        const returnRate = weeks > 0 ? events.length / weeks : events.length
        
        returnRates[uid] = {
          total_visits: events.length,
          days_active: daysBetween,
          return_rate: returnRate
        }
      }
    }
    
    // Calculate statistics
    const returnRateValues = Object.values(returnRates).map(r => r.return_rate)
    const avgReturnRate = returnRateValues.length > 0
      ? returnRateValues.reduce((a, b) => a + b, 0) / returnRateValues.length
      : 0
    
    return {
      total_active_users: uniqueUsers.length,
      returning_users: Object.keys(returnRates).length,
      avg_return_rate: avgReturnRate,
      retention_rate: (Object.keys(returnRates).length / uniqueUsers.length) * 100
    }
  } catch (error) {
    logError('Error analyzing retention', error)
    return null
  }
}

/**
 * User Segmentation
 */
export async function segmentUsers(segmentationCriteria) {
  try {
    // Get all users
    const { data: users } = await supabase
      .from('auth.users')
      .select('id, created_at')
    
    if (!users || users.length === 0) return null
    
    const segments = {}
    
    for (const user of users) {
      // Get user activity data
      const { data: workouts } = await supabase
        .from('workouts')
        .select('date')
        .eq('user_id', user.id)
        .gte('date', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
      
      const workoutCount = workouts?.length || 0
      
      // Segment based on criteria
      let segment = 'inactive'
      
      if (workoutCount >= 10) {
        segment = 'highly_active'
      } else if (workoutCount >= 5) {
        segment = 'active'
      } else if (workoutCount >= 1) {
        segment = 'occasional'
      }
      
      if (!segments[segment]) {
        segments[segment] = {
          name: segment,
          users: [],
          count: 0,
          avg_workouts: 0
        }
      }
      
      segments[segment].users.push(user.id)
      segments[segment].count++
    }
    
    // Calculate averages for each segment
    Object.keys(segments).forEach(segmentName => {
      const segment = segments[segmentName]
      // Calculate average workouts (simplified)
      segment.avg_workouts = segment.count > 0 ? segment.count : 0
    })
    
    return Object.values(segments)
  } catch (error) {
    logError('Error segmenting users', error)
    return null
  }
}

// Helper functions

async function countActiveUsers(userIds, daysAfterSignup) {
  if (!userIds || userIds.length === 0) return 0
  
  // Get signup dates
  const { data: users } = await supabase
    .from('auth.users')
    .select('id, created_at')
    .in('id', userIds)
  
  if (!users) return 0
  
  let activeCount = 0
  
  for (const user of users) {
    const signupDate = new Date(user.created_at)
    const checkDate = new Date(signupDate.getTime() + daysAfterSignup * 24 * 60 * 60 * 1000)
    
    // Check if user had activity after checkDate
    const { count } = await supabase
      .from('user_events')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('timestamp', checkDate.toISOString())
    
    if (count && count > 0) {
      activeCount++
    }
  }
  
  return activeCount
}

