/**
 * Advanced Analytics Capabilities
 * Cohort analysis, funnel analysis, retention analysis, user segmentation
 */

import { supabase } from './supabase'
import { logError } from '../utils/logger'

/**
 * Cohort Analysis - User retention by signup date
 * Uses user_events to infer user activity since auth.users is not accessible
 */
export async function analyzeCohorts(userId = null, startDate = null, endDate = null) {
  try {
    // Use user_events to get first activity date (proxy for signup)
    // Get unique users and their first event timestamp
    let query = supabase
      .from('user_events')
      .select('user_id, timestamp')
      .order('timestamp', { ascending: true })
    
    if (startDate) {
      query = query.gte('timestamp', startDate)
    }
    if (endDate) {
      query = query.lte('timestamp', endDate)
    }
    
    const { data: events, error } = await query
    
    if (error) {
      // If user_events table doesn't exist, return null gracefully
      if (error.code === 'PGRST205' || error.message?.includes('Could not find the table')) {
        return null
      }
      throw error
    }
    
    if (!events || events.length === 0) return null
    
    // Group by user and get first event (proxy for signup)
    const userFirstEvent = {}
    events.forEach(event => {
      if (!userFirstEvent[event.user_id]) {
        userFirstEvent[event.user_id] = event.timestamp
      } else if (new Date(event.timestamp) < new Date(userFirstEvent[event.user_id])) {
        userFirstEvent[event.user_id] = event.timestamp
      }
    })
    
    // Group users by signup month (cohort)
    const cohorts = {}
    Object.entries(userFirstEvent).forEach(([uid, firstTimestamp]) => {
      const signupDate = new Date(firstTimestamp)
      const cohortMonth = `${signupDate.getFullYear()}-${String(signupDate.getMonth() + 1).padStart(2, '0')}`
      
      if (!cohorts[cohortMonth]) {
        cohorts[cohortMonth] = {
          signup_month: cohortMonth,
          total_users: 0,
          user_ids: [],
          retention: {}
        }
      }
      cohorts[cohortMonth].total_users++
      cohorts[cohortMonth].user_ids.push(uid)
    })
    
    // Calculate retention for each cohort
    for (const cohortMonth of Object.keys(cohorts)) {
      const cohortUserIds = cohorts[cohortMonth].user_ids
      
      // Check retention at different time periods
      const retentionPeriods = [7, 30, 90] // days
      
      for (const period of retentionPeriods) {
        const activeUsers = await countActiveUsersFromEvents(cohortUserIds, cohortMonth, period)
        cohorts[cohortMonth].retention[`day_${period}`] = {
          active_users: activeUsers,
          retention_rate: cohortUserIds.length > 0 ? (activeUsers / cohortUserIds.length) * 100 : 0
        }
      }
      
      // Clean up user_ids from response
      delete cohorts[cohortMonth].user_ids
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
 * Uses workouts table instead of auth.users
 */
export async function segmentUsers(segmentationCriteria) {
  try {
    // Get unique users from workouts table
    const { data: workouts } = await supabase
      .from('workouts')
      .select('user_id, date')
      .gte('date', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
    
    if (!workouts || workouts.length === 0) return null
    
    // Count workouts per user
    const userWorkoutCounts = {}
    workouts.forEach(workout => {
      userWorkoutCounts[workout.user_id] = (userWorkoutCounts[workout.user_id] || 0) + 1
    })
    
    const segments = {}
    
    Object.entries(userWorkoutCounts).forEach(([userId, workoutCount]) => {
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
      
      segments[segment].users.push(userId)
      segments[segment].count++
    })
    
    // Calculate averages for each segment
    Object.keys(segments).forEach(segmentName => {
      const segment = segments[segmentName]
      const totalWorkouts = segment.users.reduce((sum, uid) => sum + (userWorkoutCounts[uid] || 0), 0)
      segment.avg_workouts = segment.count > 0 ? totalWorkouts / segment.count : 0
    })
    
    return Object.values(segments)
  } catch (error) {
    logError('Error segmenting users', error)
    return null
  }
}

// Helper functions

async function countActiveUsersFromEvents(userIds, cohortMonth, daysAfterSignup) {
  if (!userIds || userIds.length === 0) return 0
  
  // Calculate the check date based on cohort month + daysAfterSignup
  const [year, month] = cohortMonth.split('-').map(Number)
  const cohortStartDate = new Date(year, month - 1, 1)
  const checkDate = new Date(cohortStartDate.getTime() + daysAfterSignup * 24 * 60 * 60 * 1000)
  
  // Check if users had activity after checkDate
  const { data: events } = await supabase
    .from('user_events')
    .select('user_id')
    .in('user_id', userIds)
    .gte('timestamp', checkDate.toISOString())
  
  if (!events || events.length === 0) return 0
  
  // Count unique active users
  const activeUserIds = [...new Set(events.map(e => e.user_id))]
  return activeUserIds.length
}

