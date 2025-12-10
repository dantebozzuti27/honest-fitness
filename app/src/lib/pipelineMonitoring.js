/**
 * Data Pipeline Monitoring
 * Track pipeline health, data flow, processing times, failures
 */

import { supabase } from './supabase'
import { logError } from '../utils/logger'

/**
 * Record pipeline job execution
 */
export async function recordPipelineJob(jobName, status, metadata = {}) {
  try {
    const { error } = await supabase
      .from('pipeline_jobs')
      .insert({
        job_name: jobName,
        status, // 'success', 'failure', 'running'
        started_at: metadata.started_at || new Date().toISOString(),
        completed_at: status !== 'running' ? new Date().toISOString() : null,
        duration_seconds: metadata.duration_seconds || null,
        records_processed: metadata.records_processed || 0,
        error_message: metadata.error_message || null,
        metadata: metadata.metadata || {}
      })
    
    if (error) {
      logError('Error recording pipeline job', error)
    }
  } catch (error) {
    logError('Error in recordPipelineJob', error)
  }
}

/**
 * Get pipeline health metrics
 */
export async function getPipelineHealth(jobName = null, days = 7) {
  try {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
    
    let query = supabase
      .from('pipeline_jobs')
      .select('*')
      .gte('started_at', startDate)
    
    if (jobName) {
      query = query.eq('job_name', jobName)
    }
    
    const { data: jobs, error } = await query
    
    if (error) throw error
    if (!jobs || jobs.length === 0) return null
    
    // Calculate metrics
    const totalJobs = jobs.length
    const successfulJobs = jobs.filter(j => j.status === 'success').length
    const failedJobs = jobs.filter(j => j.status === 'failure').length
    const runningJobs = jobs.filter(j => j.status === 'running').length
    
    const successRate = (successfulJobs / totalJobs) * 100
    const failureRate = (failedJobs / totalJobs) * 100
    
    const durations = jobs
      .filter(j => j.duration_seconds !== null)
      .map(j => j.duration_seconds)
    
    const avgDuration = durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0
    
    const totalRecords = jobs.reduce((sum, j) => sum + (j.records_processed || 0), 0)
    
    // Recent failures
    const recentFailures = jobs
      .filter(j => j.status === 'failure')
      .sort((a, b) => new Date(b.started_at) - new Date(a.started_at))
      .slice(0, 10)
    
    return {
      total_jobs: totalJobs,
      successful_jobs: successfulJobs,
      failed_jobs: failedJobs,
      running_jobs: runningJobs,
      success_rate: Math.round(successRate * 100) / 100,
      failure_rate: Math.round(failureRate * 100) / 100,
      avg_duration_seconds: Math.round(avgDuration * 100) / 100,
      total_records_processed: totalRecords,
      recent_failures: recentFailures
    }
  } catch (error) {
    logError('Error getting pipeline health', error)
    return null
  }
}

/**
 * Check for pipeline alerts
 */
export async function checkPipelineAlerts() {
  try {
    const health = await getPipelineHealth(null, 1) // Last 24 hours
    
    if (!health) return []
    
    const alerts = []
    
    // Check failure rate
    if (health.failure_rate > 10) {
      alerts.push({
        severity: 'high',
        type: 'high_failure_rate',
        message: `Pipeline failure rate is ${health.failure_rate}% (threshold: 10%)`,
        value: health.failure_rate
      })
    }
    
    // Check for stuck jobs
    if (health.running_jobs > 0) {
      // Check if jobs have been running too long
      const { data: runningJobs } = await supabase
        .from('pipeline_jobs')
        .select('job_name, started_at')
        .eq('status', 'running')
        .lt('started_at', new Date(Date.now() - 60 * 60 * 1000).toISOString()) // Running > 1 hour
      
      if (runningJobs && runningJobs.length > 0) {
        alerts.push({
          severity: 'medium',
          type: 'stuck_jobs',
          message: `${runningJobs.length} pipeline job(s) appear to be stuck`,
          jobs: runningJobs
        })
      }
    }
    
    // Check average duration
    if (health.avg_duration_seconds > 3600) { // > 1 hour
      alerts.push({
        severity: 'medium',
        type: 'slow_processing',
        message: `Average pipeline duration is ${Math.round(health.avg_duration_seconds / 60)} minutes`,
        value: health.avg_duration_seconds
      })
    }
    
    return alerts
  } catch (error) {
    logError('Error checking pipeline alerts', error)
    return []
  }
}

