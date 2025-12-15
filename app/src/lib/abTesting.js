/**
 * A/B Testing Infrastructure
 * Random assignment, feature flags, metric tracking, statistical significance testing
 */

import { supabase } from './supabase'
import { logError } from '../utils/logger'

/**
 * Assign user to A/B test variant
 */
export async function assignToVariant(userId, testName) {
  try {
    // Check if user already assigned
    const { data: existing } = await supabase
      .from('ab_test_assignments')
      .select('variant')
      .eq('user_id', userId)
      .eq('test_name', testName)
      .single()
    
    if (existing) {
      return existing.variant
    }
    
    // Random assignment (50/50 split)
    const variant = Math.random() < 0.5 ? 'A' : 'B'
    
    // Save assignment
    const { error } = await supabase
      .from('ab_test_assignments')
      .insert({
        user_id: userId,
        test_name: testName,
        variant,
        assigned_at: new Date().toISOString()
      })
    
    if (error) {
      logError('Error assigning to variant', error)
      return 'A' // Default to control
    }
    
    return variant
  } catch (error) {
    logError('Error in assignToVariant', error)
    return 'A'
  }
}

/**
 * Track A/B test event
 */
export async function trackABTestEvent(userId, testName, eventName, value = null) {
  try {
    // Get user's variant
    const { data: assignment } = await supabase
      .from('ab_test_assignments')
      .select('variant')
      .eq('user_id', userId)
      .eq('test_name', testName)
      .single()
    
    if (!assignment) {
      // Auto-assign if not assigned
      const variant = await assignToVariant(userId, testName)
      assignment = { variant }
    }
    
    // Track event
    const { error } = await supabase
      .from('ab_test_events')
      .insert({
        user_id: userId,
        test_name: testName,
        variant: assignment.variant,
        event_name: eventName,
        value,
        timestamp: new Date().toISOString()
      })
    
    if (error) {
      logError('Error tracking A/B test event', error)
    }
  } catch (error) {
    logError('Error in trackABTestEvent', error)
  }
}

/**
 * Get A/B test results with statistical significance
 */
export async function getABTestResults(testName, metric = 'conversion') {
  try {
    // Get all events for this test
    const { data: events } = await supabase
      .from('ab_test_events')
      .select('variant, event_name, value')
      .eq('test_name', testName)
      .eq('event_name', metric)
    
    if (!events || events.length === 0) {
      return null
    }
    
    // Group by variant
    const variantA = events.filter(e => e.variant === 'A')
    const variantB = events.filter(e => e.variant === 'B')
    
    // Calculate metrics
    const aCount = variantA.length
    const bCount = variantB.length
    const aValue = variantA.reduce((sum, e) => sum + (e.value || 1), 0)
    const bValue = variantB.reduce((sum, e) => sum + (e.value || 1), 0)
    
    const aRate = aCount > 0 ? aValue / aCount : 0
    const bRate = bCount > 0 ? bValue / bCount : 0
    
    // Calculate statistical significance (Z-test)
    const significance = calculateStatisticalSignificance(aCount, aRate, bCount, bRate)
    
    // Determine winner
    let winner = null
    if (significance.pValue < 0.05) {
      winner = bRate > aRate ? 'B' : 'A'
    }
    
    return {
      test_name: testName,
      variant_a: {
        count: aCount,
        rate: aRate,
        value: aValue
      },
      variant_b: {
        count: bCount,
        rate: bRate,
        value: bValue
      },
      improvement: aRate > 0 ? ((bRate - aRate) / aRate) * 100 : 0,
      significance,
      winner,
      recommendation: winner ? `Variant ${winner} is statistically significant winner` : 'No significant difference'
    }
  } catch (error) {
    logError('Error getting A/B test results', error)
    return null
  }
}

/**
 * Calculate statistical significance (Z-test)
 */
function calculateStatisticalSignificance(n1, p1, n2, p2) {
  if (n1 === 0 || n2 === 0) {
    return {
      pValue: 1,
      zScore: 0,
      significant: false
    }
  }
  
  // Pooled proportion
  const pooledP = (p1 * n1 + p2 * n2) / (n1 + n2)
  
  // Standard error
  const se = Math.sqrt(pooledP * (1 - pooledP) * (1/n1 + 1/n2))
  
  if (se === 0) {
    return {
      pValue: 1,
      zScore: 0,
      significant: false
    }
  }
  
  // Z-score
  const zScore = (p2 - p1) / se
  
  // P-value (two-tailed test)
  // Simplified - in production use proper statistical library
  const pValue = 2 * (1 - normalCDF(Math.abs(zScore)))
  
  return {
    pValue,
    zScore,
    significant: pValue < 0.05
  }
}

/**
 * Normal CDF approximation
 */
function normalCDF(z) {
  // Approximation using error function
  return 0.5 * (1 + erf(z / Math.sqrt(2)))
}

function erf(x) {
  // Error function approximation
  const a1 = 0.254829592
  const a2 = -0.284496736
  const a3 = 1.421413741
  const a4 = -1.453152027
  const a5 = 1.061405429
  const p = 0.3275911
  
  const sign = x < 0 ? -1 : 1
  x = Math.abs(x)
  
  const t = 1.0 / (1.0 + p * x)
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x)
  
  return sign * y
}

/**
 * Create A/B test
 */
export async function createABTest(testName, description, variants = ['A', 'B']) {
  try {
    const { error } = await supabase
      .from('ab_tests')
      .upsert({
        test_name: testName,
        description,
        variants: variants,
        status: 'active',
        created_at: new Date().toISOString()
      }, {
        onConflict: 'test_name'
      })
    
    if (error) {
      logError('Error creating A/B test', error)
      return false
    }
    
    return true
  } catch (error) {
    logError('Error in createABTest', error)
    return false
  }
}

