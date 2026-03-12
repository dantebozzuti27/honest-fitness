/**
 * Minimal offline backtest harness for prediction baseline.
 * Uses rolling-origin evaluation against expectedVolume.
 */

import { getFromDatabase } from '../../database/index.js'
import { predictPerformance, computeWorkoutVolume } from './prediction.js'

function mean(values) {
  if (!values.length) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

function computeMSErrors(actuals, forecasts) {
  const absErrors = []
  const absPctErrors = []
  for (let i = 0; i < actuals.length; i++) {
    const actual = Number(actuals[i])
    const pred = Number(forecasts[i])
    if (!Number.isFinite(actual) || !Number.isFinite(pred)) continue
    const absErr = Math.abs(actual - pred)
    absErrors.push(absErr)
    if (actual > 0) absPctErrors.push(absErr / actual)
  }
  return {
    mae: mean(absErrors),
    mape: mean(absPctErrors),
    sampleSize: absErrors.length
  }
}

function cohortFromWorkoutCount(count) {
  if (count < 20) return 'beginner_data'
  if (count < 80) return 'intermediate_data'
  return 'advanced_data'
}

export async function runPredictionBacktest(userId, options = {}) {
  const lookbackDays = Math.max(30, Math.min(365, Number(options.lookbackDays) || 180))
  const windowSize = Math.max(5, Math.min(30, Number(options.windowSize) || 10))
  const endDate = new Date().toISOString().split('T')[0]
  const startDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const workoutsDesc = await getFromDatabase('workout', userId, { startDate, endDate, limit: 500 })
  const workouts = [...(workoutsDesc || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)))

  if (workouts.length < windowSize + 2) {
    return {
      userId,
      cohort: cohortFromWorkoutCount(workouts.length),
      windowSize,
      lookbackDays,
      metrics: { mae: 0, mape: 0, sampleSize: 0 },
      note: 'Insufficient workout history for rolling-origin backtest'
    }
  }

  const forecasts = []
  const actuals = []
  for (let i = windowSize; i < workouts.length; i++) {
    const trainSlice = workouts.slice(Math.max(0, i - windowSize), i)
    const nextWorkout = workouts[i]
    const prediction = await predictPerformance(userId, { workouts: trainSlice, health: [] })
    const expectedVolume = prediction?.performance?.expectedVolume
    const actualVolume = computeWorkoutVolume(nextWorkout)
    if (Number.isFinite(expectedVolume) && Number.isFinite(actualVolume)) {
      forecasts.push(expectedVolume)
      actuals.push(actualVolume)
    }
  }

  return {
    userId,
    cohort: cohortFromWorkoutCount(workouts.length),
    windowSize,
    lookbackDays,
    metrics: computeMSErrors(actuals, forecasts)
  }
}

