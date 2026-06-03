/**
 * Machine Learning Engine
 * Analyzes data, detects trends, predicts performance, computes readiness
 */

import { analyzeWorkoutTrends } from './workoutAnalysis.js'
import { analyzeNutritionTrends } from './nutritionAnalysis.js'
import { computeReadiness } from './readiness.js'
import { detectAnomalies } from './anomalyDetection.js'
import { predictPerformance } from './prediction.js'
import {
  analyzeE1rmInflation,
  analyzePrescriptionBias,
  detectVolumeAnomalies,
  detectSwapOscillation,
} from './strengthForensics.js'

/**
 * Main ML processing function
 */
export async function processML(userId, dataContext) {
  const results = {
    workoutAnalysis: null,
    nutritionAnalysis: null,
    readiness: null,
    anomalies: null,
    predictions: null,
    strengthForensics: null,
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
    
    // Strength science: e1RM inflation, prescription bias, volume MAD, swap oscillation
    if (dataContext.workouts?.length) {
      const volumeAnomalies = detectVolumeAnomalies(dataContext.workouts)
      results.strengthForensics = {
        e1rm: analyzeE1rmInflation(dataContext.workouts),
        prescription: analyzePrescriptionBias(dataContext.executionEvents),
        volume: volumeAnomalies,
        swaps: detectSwapOscillation(dataContext.swaps),
      }
    }

    // Detect anomalies (merge volume MAD + legacy checks)
    results.anomalies = await detectAnomalies(userId, dataContext)
    if (results.strengthForensics?.volume?.anomalies?.length) {
      results.anomalies = [
        ...(results.anomalies || []),
        ...results.strengthForensics.volume.anomalies,
      ]
    }
    if (results.strengthForensics?.e1rm?.inflatedExercises?.length) {
      const top = results.strengthForensics.e1rm.inflatedExercises[0]
      results.anomalies = [
        ...(results.anomalies || []),
        {
          type: 'strength',
          severity: top.inflationPct >= 15 ? 'warning' : 'info',
          message: `e1RM model may overestimate ${top.exercise} by ~${top.inflationPct}% vs robust session-best`,
          data: top,
        },
      ]
    }
    if (results.strengthForensics?.swaps?.oscillationPairs?.length) {
      const top = results.strengthForensics.swaps.oscillationPairs[0]
      results.anomalies = [
        ...(results.anomalies || []),
        {
          type: 'swap',
          severity: 'info',
          message: `Repeated swap oscillation detected (${top.pair}, ${top.total} events)`,
          data: top,
        },
      ]
    }
    
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

