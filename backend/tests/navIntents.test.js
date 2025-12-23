import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getDefaultMealType,
  openGoals,
  openHealthLog,
  openMealLog,
  openNutrition,
  startWorkout
} from '../../app/src/utils/navIntents.js'

test('navIntents: getDefaultMealType returns a reasonable default', () => {
  const breakfast = getDefaultMealType(new Date('2025-01-01T08:00:00Z'))
  assert.equal(typeof breakfast, 'string')
})

test('navIntents: openMealLog navigates with openMealModal + mealType', () => {
  const calls = []
  const navigate = (path, opts) => calls.push({ path, opts })
  openMealLog(navigate, { mealType: 'Lunch' })
  assert.deepEqual(calls[0], { path: '/nutrition', opts: { state: { openMealModal: true, mealType: 'Lunch' } } })
})

test('navIntents: openHealthLog navigates with openLogModal', () => {
  const calls = []
  const navigate = (path, opts) => calls.push({ path, opts })
  openHealthLog(navigate)
  assert.deepEqual(calls[0], { path: '/health', opts: { state: { openLogModal: true } } })
})

test('navIntents: openNutrition navigates to /nutrition (optionally with meal modal state)', () => {
  const calls = []
  const navigate = (path, opts) => calls.push({ path, opts })
  openNutrition(navigate)
  assert.deepEqual(calls[0], { path: '/nutrition', opts: { state: {} } })
})

test('navIntents: openGoals navigates to /goals (with optional state)', () => {
  const calls = []
  const navigate = (path, opts) => calls.push({ path, opts })
  openGoals(navigate, { state: { createMealPlan: true } })
  assert.deepEqual(calls[0], { path: '/goals', opts: { state: { createMealPlan: true } } })
})

test('navIntents: startWorkout resume navigates without state', () => {
  const calls = []
  const navigate = (path, opts) => calls.push({ path, opts })
  startWorkout(navigate, { mode: 'resume' })
  assert.deepEqual(calls[0], { path: '/workout/active', opts: undefined })
})

test('navIntents: startWorkout picker sets openPicker and sessionType', () => {
  const calls = []
  const navigate = (path, opts) => calls.push({ path, opts })
  startWorkout(navigate, { mode: 'picker', sessionType: 'recovery' })
  assert.deepEqual(calls[0], { path: '/workout/active', opts: { state: { sessionType: 'recovery', openPicker: true } } })
})

test('navIntents: startWorkout template passes templateId + scheduledDate', () => {
  const calls = []
  const navigate = (path, opts) => calls.push({ path, opts })
  startWorkout(navigate, { mode: 'template', sessionType: 'workout', templateId: 'tpl_123', scheduledDate: '2025-01-02' })
  assert.deepEqual(calls[0], {
    path: '/workout/active',
    opts: { state: { sessionType: 'workout', templateId: 'tpl_123', scheduledDate: '2025-01-02' } }
  })
})


