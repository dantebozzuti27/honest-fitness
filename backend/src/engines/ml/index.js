/**
 * Machine Learning Engine
 * Analyzes data, detects trends, predicts performance, computes readiness
 */

import { analyzeWorkoutTrends } from './workoutAnalysis.js'
import { analyzeNutritionTrends } from './nutritionAnalysis.js'
import { computeReadiness } from './readiness.js'
import { detectAnomalies } from './anomalyDetection.js'
import { predictPerformance } from './prediction.js'

/**
 * Main ML processing function
 */
export async function processML(userId, dataContext) {
  const results = {
    workoutAnalysis: null,
    nutritionAnalysis: null,
    readiness: null,
    anomalies: null,
    predictions: null
  }
  
  try {
    // Analyze workout trends
    if (dataContext.workouts && dataContext.workouts.length > 0) {
      results.workoutAnalysis = await analyzeWorkoutTrends(userId, dataContext.workouts)
    }
    
    // Analyze nutrition trends
    if (dataContext.nutrition && dataContext.nutrition.length > 0) {
      results.nutritionAnalysis = await analyzeNutritionTrends(userId, dataContext.nutrition)
    }
    
    const modelDataQuality = Number(dataContext?.dataQuality?.score || 0)
    const modelUsable = dataContext?.dataQuality?.usableForModel !== false && modelDataQuality >= 0.4

    // Compute readiness score
    if (dataContext.health && modelUsable) {
      results.readiness = await computeReadiness(userId, dataContext.health)
    } else if (dataContext.health) {
      results.readiness = {
        score: null,
        calibratedScore: null,
        confidence: 'low',
        confidenceScore: 0,
        abstain: true,
        confidenceReason: 'Wearable/public data quality below threshold'
      }
    }
    
    // Detect anomalies
    results.anomalies = await detectAnomalies(userId, dataContext)
    
    // Predict performance
    if (dataContext.workouts && dataContext.workouts.length > 0 && modelUsable) {
      results.predictions = await predictPerformance(userId, dataContext)
    } else if (dataContext.workouts && dataContext.workouts.length > 0) {
      results.predictions = {
        performance: {
          expectedVolume: null,
          expectedIntensity: null,
          confidence: 'low',
          confidenceScore: 0,
          conservativeFallback: true,
          abstain: true,
          confidenceReason: 'Wearable/public data quality below threshold'
        },
        recovery: null,
        trends: null
      }
    }
    
    return results
  } catch (error) {
    console.error('ML processing error:', error)
    throw error
  }
}

