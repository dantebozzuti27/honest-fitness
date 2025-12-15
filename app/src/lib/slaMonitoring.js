/**
 * SLA Monitoring
 * Monitor data freshness, availability, processing times
 */

import { supabase as supabaseClient, supabaseConfigErrorMessage } from './supabase'
import { logError } from '../utils/logger'

// Avoid TypeError crashes when Supabase env is missing; throw a clear message at call time instead.
const supabase = supabaseClient ?? new Proxy({}, { get: () => { throw new Error(supabaseConfigErrorMessage) } })

/**
 * SLA Definitions
 */
export const SLA_DEFINITIONS = {
  data_freshness: {
    real_time: 5 * 60, // 5 minutes in seconds
    batch: 60 * 60, // 1 hour in seconds
    description: 'Maximum age of data before considered stale'
  },
  availability: {
    target: 99.9, // 99.9% uptime
    description: 'System availability percentage'
  },
  processing_time: {
    etl_job: 60 * 60, // 1 hour in seconds
    ml_processing: 5 * 60, // 5 minutes in seconds
    description: 'Maximum processing time for jobs'
  },
  query_performance: {
    p95: 100, // 100ms for 95th percentile
    p99: 500, // 500ms for 99th percentile
    description: 'Query response time targets'
  }
}

/**
 * Check data freshness SLA
 */
export async function checkDataFreshnessSLA(dataType = 'all') {
  try {
    const now = new Date()
    const violations = []
    
    if (dataType === 'all' || dataType === 'workouts') {
      // Check latest workout
      const { data: latestWorkout } = await supabase
        .from('workouts')
        .select('updated_at')
        .order('updated_at', { ascending: false })
        .limit(1)
        .single()
      
      if (latestWorkout) {
        const age = (now - new Date(latestWorkout.updated_at)) / 1000 // seconds
        if (age > SLA_DEFINITIONS.data_freshness.batch) {
          violations.push({
            data_type: 'workouts',
            age_seconds: age,
            threshold: SLA_DEFINITIONS.data_freshness.batch,
            status: 'violation'
          })
        }
      }
    }
    
    if (dataType === 'all' || dataType === 'health_metrics') {
      // Check latest health metrics
      const { data: latestMetric } = await supabase
        .from('health_metrics')
        .select('updated_at')
        .order('updated_at', { ascending: false })
        .limit(1)
        .single()
      
      if (latestMetric) {
        const age = (now - new Date(latestMetric.updated_at)) / 1000
        if (age > SLA_DEFINITIONS.data_freshness.real_time) {
          violations.push({
            data_type: 'health_metrics',
            age_seconds: age,
            threshold: SLA_DEFINITIONS.data_freshness.real_time,
            status: 'violation'
          })
        }
      }
    }
    
    return {
      status: violations.length === 0 ? 'compliant' : 'violation',
      violations,
      sla_definition: SLA_DEFINITIONS.data_freshness
    }
  } catch (error) {
    logError('Error checking data freshness SLA', error)
    return null
  }
}

/**
 * Check processing time SLA
 */
export async function checkProcessingTimeSLA(jobName = null, hours = 24) {
  try {
    const startDate = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
    
    let query = supabase
      .from('pipeline_jobs')
      .select('job_name, duration_seconds, status')
      .gte('started_at', startDate)
      .eq('status', 'success')
    
    if (jobName) {
      query = query.eq('job_name', jobName)
    }
    
    const { data: jobs, error } = await query
    
    if (error) throw error
    if (!jobs || jobs.length === 0) return null
    
    // Determine SLA threshold based on job type
    const getSLAThreshold = (jobName) => {
      if (jobName?.includes('ml') || jobName?.includes('prediction')) {
        return SLA_DEFINITIONS.processing_time.ml_processing
      }
      return SLA_DEFINITIONS.processing_time.etl_job
    }
    
    const violations = jobs
      .filter(j => {
        const threshold = getSLAThreshold(j.job_name)
        return j.duration_seconds && j.duration_seconds > threshold
      })
      .map(j => ({
        job_name: j.job_name,
        duration_seconds: j.duration_seconds,
        threshold: getSLAThreshold(j.job_name),
        status: 'violation'
      }))
    
    return {
      status: violations.length === 0 ? 'compliant' : 'violation',
      violations,
      total_jobs: jobs.length,
      sla_definition: SLA_DEFINITIONS.processing_time
    }
  } catch (error) {
    logError('Error checking processing time SLA', error)
    return null
  }
}

/**
 * Save SLA metrics
 */
export async function saveSLAMetrics(metrics) {
  try {
    const { error } = await supabase
      .from('sla_metrics')
      .insert({
        metric_type: metrics.type,
        metric_value: metrics.value,
        threshold: metrics.threshold,
        status: metrics.status,
        measured_at: new Date().toISOString()
      })
    
    if (error) {
      logError('Error saving SLA metrics', error)
    }
  } catch (error) {
    logError('Error in saveSLAMetrics', error)
  }
}

/**
 * Get SLA compliance report
 */
export async function getSLAComplianceReport(days = 7) {
  try {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
    
    const { data: metrics, error } = await supabase
      .from('sla_metrics')
      .select('*')
      .gte('measured_at', startDate)
      .order('measured_at', { ascending: false })
    
    if (error) throw error
    if (!metrics || metrics.length === 0) return null
    
    // Group by metric type
    const byType = {}
    metrics.forEach(m => {
      if (!byType[m.metric_type]) {
        byType[m.metric_type] = {
          total_measurements: 0,
          compliant: 0,
          violations: 0,
          compliance_rate: 0
        }
      }
      
      byType[m.metric_type].total_measurements++
      if (m.status === 'compliant') {
        byType[m.metric_type].compliant++
      } else {
        byType[m.metric_type].violations++
      }
    })
    
    // Calculate compliance rates
    Object.keys(byType).forEach(type => {
      const stats = byType[type]
      stats.compliance_rate = (stats.compliant / stats.total_measurements) * 100
    })
    
    return {
      period_days: days,
      metrics_by_type: byType,
      overall_compliance: Object.values(byType).reduce((sum, stats) => sum + stats.compliance_rate, 0) / Object.keys(byType).length
    }
  } catch (error) {
    logError('Error getting SLA compliance report', error)
    return null
  }
}

