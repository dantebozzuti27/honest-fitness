import test from 'node:test'
import assert from 'node:assert/strict'
import { projectMuscleRecoveryForward, type MuscleRecoveryStatus } from '../../src/lib/recoveryModel.ts'

const baseStatus = (overrides: Partial<MuscleRecoveryStatus>): MuscleRecoveryStatus => ({
  muscleGroup: 'mid_chest',
  hoursSinceLastTrained: 12,
  baselineRecoveryHours: 48,
  directSetsLastSession: 12,
  synergistFatiguePenalty: 0,
  cardioMechanicalPenalty: 0,
  recoveryModifier: 1,
  recoveryPercent: 25,
  readyToTrain: false,
  ...overrides,
})

test('projectMuscleRecoveryForward: advances recovery toward 100% over horizon', () => {
  const projected = projectMuscleRecoveryForward([baseStatus({})], 72, 85)[0]
  assert.ok(projected.recoveryPercent > 25, `expected > 25%, got ${projected.recoveryPercent}`)
  assert.ok(projected.recoveryPercent <= 100)
  assert.equal(projected.readyToTrain, projected.recoveryPercent >= 85)
})

test('projectMuscleRecoveryForward: long horizon marks trained muscle ready', () => {
  const projected = projectMuscleRecoveryForward([baseStatus({})], 120, 85)[0]
  assert.equal(projected.recoveryPercent, 100)
  assert.equal(projected.readyToTrain, true)
})

test('projectMuscleRecoveryForward: cardio penalty extends effective recovery horizon', () => {
  const without = projectMuscleRecoveryForward([baseStatus({ cardioMechanicalPenalty: 0 })], 48, 85)[0]
  const withCardio = projectMuscleRecoveryForward([baseStatus({ cardioMechanicalPenalty: 12 })], 48, 85)[0]
  assert.ok(withCardio.recoveryPercent <= without.recoveryPercent)
})
