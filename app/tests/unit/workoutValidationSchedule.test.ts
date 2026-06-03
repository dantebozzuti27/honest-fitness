import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  workoutValidationFingerprint,
  clearWorkoutValidationCache,
} from '../../src/lib/workoutValidationSchedule.ts'

describe('workoutValidationSchedule', () => {
  it('workoutValidationFingerprint is stable for same prescription', () => {
    const w = {
      id: 'gen-1',
      estimatedDurationMinutes: 65,
      exercises: [
        { exerciseName: 'Bench Press', sets: 4, targetReps: 8, targetWeight: 185, targetMuscleGroup: 'mid_chest' },
      ],
    }
    const a = workoutValidationFingerprint(w)
    const b = workoutValidationFingerprint({ ...w, exercises: [...w.exercises] })
    assert.equal(a, b)
  })

  it('workoutValidationFingerprint changes when sets change', () => {
    const base = {
      id: 'gen-1',
      estimatedDurationMinutes: 65,
      exercises: [{ exerciseName: 'Bench Press', sets: 4, targetReps: 8, targetWeight: 185 }],
    }
    const changed = {
      ...base,
      exercises: [{ exerciseName: 'Bench Press', sets: 3, targetReps: 8, targetWeight: 185 }],
    }
    assert.notEqual(workoutValidationFingerprint(base), workoutValidationFingerprint(changed))
  })

  it('clearWorkoutValidationCache does not throw', () => {
    assert.doesNotThrow(() => clearWorkoutValidationCache())
  })
})
