import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assertDayStatusTransition,
  canTransitionDayStatus,
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
