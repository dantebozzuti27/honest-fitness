import test from 'node:test'
import assert from 'node:assert/strict'
import {
  computeSwapLearningFeaturesFromData,
  computeExerciseAcceptancesFromData,
  type WorkoutRecord,
} from '../../src/lib/trainingAnalysis.ts'
import { preferenceAggregationKey } from '../../src/lib/exerciseOntology.ts'

test('swap learning merges barbell and dumbbell curl swaps under biceps_curl family', () => {
  const result = computeSwapLearningFeaturesFromData([
    {
      exercise_name: 'Barbell Biceps Curl',
      replacement_exercise_name: 'Hammer Curl',
      swap_date: '2026-05-01',
      created_at: '2026-05-01T12:00:00Z',
    },
    {
      exercise_name: 'Dumbbell Biceps Curl',
      replacement_exercise_name: 'Cable Curl',
      swap_date: '2026-05-02',
      created_at: '2026-05-02T12:00:00Z',
    },
  ])

  assert.equal(result.exerciseSwapHistory.length, 1)
  assert.equal(result.exerciseSwapHistory[0].exerciseName, 'biceps_curl')
  assert.equal(result.exerciseSwapHistory[0].swapCount, 2)

  assert.equal(result.substitutionAffinities.length, 2)
  for (const affinity of result.substitutionAffinities) {
    assert.equal(affinity.fromExercise, 'biceps_curl')
    assert.ok(
      affinity.toExercise === preferenceAggregationKey('Hammer Curl')
        || affinity.toExercise === preferenceAggregationKey('Cable Curl'),
    )
  }
})

test('acceptance excluded when swap history has sibling variant in same family', () => {
  const swapHistory = computeSwapLearningFeaturesFromData([
    {
      exercise_name: 'Barbell Biceps Curl',
      replacement_exercise_name: 'Hammer Curl',
      swap_date: '2026-05-20',
      created_at: '2026-05-20T12:00:00Z',
    },
  ]).exerciseSwapHistory

  const workout: WorkoutRecord = {
    id: 'w1',
    date: '2026-05-15',
    created_at: '2026-05-15T12:00:00Z',
    duration: 45,
    template_name: null,
    perceived_effort: null,
    session_rpe: null,
    session_type: 'strength',
    workout_avg_hr: null,
    workout_peak_hr: null,
    workout_hr_zones: null,
    workout_calories_burned: null,
    generated_workout_id: null,
    workout_exercises: [
      {
        exercise_name: 'Dumbbell Biceps Curl',
        body_part: 'biceps',
        exercise_library_id: null,
        workout_sets: [{ set_number: 1, weight: 20, reps: 10, time: null, is_warmup: false }],
      },
    ],
  }

  const acceptances = computeExerciseAcceptancesFromData([workout], swapHistory)
  assert.equal(acceptances.length, 0)
})
