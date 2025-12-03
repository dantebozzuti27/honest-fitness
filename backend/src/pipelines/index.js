/**
 * Data Pipelines
 * Normalizes, validates, and stores data from all sources
 */

import { normalizeData } from '../layers/abstraction/index.js'
import { saveToDatabase } from '../database/index.js'

/**
 * Process and store data from any source
 */
export async function processDataPipeline(type, rawData, source = 'manual') {
  try {
    // Normalize data
    const normalized = await normalizeData(type, {
      ...rawData,
      source
    })
    
    // Validate
    if (!normalized.user_id || !normalized.date) {
      throw new Error('Missing required fields: user_id and date')
    }
    
    // Store in appropriate database
    const result = await saveToDatabase(type, normalized)
    
    return {
      success: true,
      data: result,
      normalizedAt: normalized.normalized_at
    }
  } catch (error) {
    console.error('Pipeline error:', error)
    throw error
  }
}

/**
 * Batch process multiple data points
 */
export async function processBatchPipeline(type, rawDataArray, source = 'manual') {
  const results = []
  
  for (const rawData of rawDataArray) {
    try {
      const result = await processDataPipeline(type, rawData, source)
      results.push(result)
    } catch (error) {
      results.push({
        success: false,
        error: error.message,
        data: rawData
      })
    }
  }
  
  return {
    processed: results.length,
    successful: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    results
  }
}

