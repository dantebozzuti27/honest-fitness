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
    
    // Compute readiness score
    if (dataContext.health) {
      results.readiness = await computeReadiness(userId, dataContext.health)
    }
    
    // Detect anomalies
    results.anomalies = await detectAnomalies(userId, dataContext)
    
    // Predict performance
    if (dataContext.workouts && dataContext.workouts.length > 0) {
      results.predictions = await predictPerformance(userId, dataContext)
    }
    
    return results
  } catch (error) {
    console.error('ML processing error:', error)
    throw error
  }
}

