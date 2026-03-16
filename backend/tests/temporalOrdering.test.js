import test from 'node:test'
import assert from 'node:assert/strict'

import { computeReadiness } from '../src/engines/ml/readiness.js'
import { predictPerformance } from '../src/engines/ml/prediction.js'
import { assertChronological, sortChronological } from '../src/engines/ml/temporal.js'

test('temporal: sortChronological orders by date then created_at', () => {
  const rows = [
    { id: 'b', date: '2025-01-02', created_at: '2025-01-02T12:00:00Z' },
    { id: 'a', date: '2025-01-01', created_at: '2025-01-01T12:00:00Z' },
    { id: 'c', date: '2025-01-02', created_at: '2025-01-02T10:00:00Z' },
  ]
  const sorted = sortChronological(rows)
  assert.deepEqual(sorted.map(r => r.id), ['a', 'c', 'b'])
  assert.doesNotThrow(() => assertChronological(sorted, 'test'))
})

test('readiness: uses latest datapoint after chronological normalization', async () => {
  const unsorted = [
    { date: '2025-01-03', sleep_duration: 300, hrv: 20, steps: 3000, resting_heart_rate: 88 },
    { date: '2025-01-01', sleep_duration: 450, hrv: 40, steps: 9000, resting_heart_rate: 62 },
    { date: '2025-01-02', sleep_duration: 420, hrv: 35, steps: 7000, resting_heart_rate: 68 },
  ]
  const result = await computeReadiness('u1', unsorted)
  assert.equal(result.factors.sleepDuration, 300)
  assert.equal(typeof result.abstain, 'boolean')
})

test('prediction: accepts unsorted workouts and emits calibrated confidence', async () => {
  const makeWorkout = (date, vol, rpe) => ({
    id: `w-${date}`,
    date,
    perceived_effort: rpe,
    workout_exercises: [
      { workout_sets: [{ weight: vol / 10, reps: 10 }] }
    ]
  })

  const unsorted = [
    makeWorkout('2025-01-07', 1200, 8),
    makeWorkout('2025-01-02', 900, 7),
    makeWorkout('2025-01-05', 1100, 7),
    makeWorkout('2025-01-01', 850, 6),
    makeWorkout('2025-01-03', 1000, 7),
    makeWorkout('2025-01-06', 1150, 8),
  ]

  const result = await predictPerformance('u1', { workouts: unsorted, health: [] })
  assert.ok(result?.performance)
  assert.equal(typeof result.performance.confidenceScore, 'number')
  assert.equal(typeof result.performance.abstain, 'boolean')
})

