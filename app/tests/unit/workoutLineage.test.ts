import test from 'node:test'
import assert from 'node:assert/strict'
import {
  attachGeneratedWorkoutId,
  extractGeneratedWorkoutId,
} from '../../src/lib/workoutLineage.ts'

test('extractGeneratedWorkoutId reads camelCase and snake_case', () => {
  const id = 'a1b2c3d4-e5f6-4789-a012-3456789abcde'
  assert.equal(extractGeneratedWorkoutId({ generatedWorkoutId: id }), id)
  assert.equal(extractGeneratedWorkoutId({ generated_workout_id: id }), id)
})

test('attachGeneratedWorkoutId normalizes both fields', () => {
  const id = 'a1b2c3d4-e5f6-4789-a012-3456789abcde'
  const out = attachGeneratedWorkoutId({ generated_workout_id: id, date: '2026-06-03' })
  assert.equal(out.generatedWorkoutId, id)
  assert.equal(out.generated_workout_id, id)
})
