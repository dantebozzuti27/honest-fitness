import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assertDayStatusTransition,
  canTransitionDayStatus,
  normalizeWeeklyPlanDayForPersist,
} from '../../src/lib/weekPlanDayStatus.ts'

test('canTransitionDayStatus allows planned to adapted', () => {
  assert.equal(canTransitionDayStatus('planned', 'adapted'), true)
})

test('canTransitionDayStatus blocks completed to planned', () => {
  assert.equal(canTransitionDayStatus('completed', 'planned'), false)
})

test('assertDayStatusTransition throws on invalid transition', () => {
  assert.throws(() => assertDayStatusTransition('completed', 'adapted'), /Invalid plan day status/)
})

test('normalizeWeeklyPlanDayForPersist strips actuals on planned days', () => {
  const norm = normalizeWeeklyPlanDayForPersist({
    dayStatus: 'planned',
    actualWorkoutId: '550e8400-e29b-41d4-a716-446655440000',
    actualWorkout: { id: '550e8400-e29b-41d4-a716-446655440000' },
  })
  assert.equal(norm.dayStatus, 'planned')
  assert.equal(norm.actualWorkoutId, null)
  assert.equal(norm.actualWorkout, null)
})

test('normalizeWeeklyPlanDayForPersist keeps workout id on completed days', () => {
  const id = '550e8400-e29b-41d4-a716-446655440001'
  const norm = normalizeWeeklyPlanDayForPersist({
    dayStatus: 'completed',
    actualWorkout: { id },
  })
  assert.equal(norm.dayStatus, 'completed')
  assert.equal(norm.actualWorkoutId, id)
})
