import test from 'node:test'
import assert from 'node:assert/strict'
import {
  GENERATED_WORKOUT_SESSION_KEY,
  clearGeneratedWorkoutHandoff,
  generatedWorkoutPendingKey,
  parseGeneratedWorkoutPayload,
  peekGeneratedWorkoutPayload,
  stageGeneratedWorkoutPayload,
} from '../../src/lib/generatedWorkoutHandoff.ts'

class MemoryStorage {
  private store = new Map<string, string>()
  getItem(key: string) { return this.store.has(key) ? this.store.get(key)! : null }
  setItem(key: string, value: string) { this.store.set(key, value) }
  removeItem(key: string) { this.store.delete(key) }
}

test('generatedWorkoutHandoff: stages to sessionStorage and localStorage pending', () => {
  const sessionStorage = new MemoryStorage()
  const localStorage = new MemoryStorage()
  const userId = 'user-1'
  const payload = { exercises: [{ name: 'Bench Press' }], templateName: 'Chest' }

  stageGeneratedWorkoutPayload(userId, payload, sessionStorage as any, localStorage as any)

  assert.equal(sessionStorage.getItem(GENERATED_WORKOUT_SESSION_KEY), JSON.stringify(payload))
  assert.equal(localStorage.getItem(generatedWorkoutPendingKey(userId)), JSON.stringify(payload))
})

test('generatedWorkoutHandoff: peek copies session payload into pending for remount recovery', () => {
  const sessionStorage = new MemoryStorage()
  const localStorage = new MemoryStorage()
  const userId = 'user-2'
  const raw = JSON.stringify({ exercises: [{ name: 'Squat' }] })
  sessionStorage.setItem(GENERATED_WORKOUT_SESSION_KEY, raw)

  assert.equal(peekGeneratedWorkoutPayload(userId, sessionStorage as any, localStorage as any), raw)
  assert.equal(localStorage.getItem(generatedWorkoutPendingKey(userId)), raw)
})

test('generatedWorkoutHandoff: peek falls back to pending when sessionStorage is empty', () => {
  const sessionStorage = new MemoryStorage()
  const localStorage = new MemoryStorage()
  const userId = 'user-3'
  const raw = JSON.stringify({ exercises: [{ name: 'Deadlift' }] })
  localStorage.setItem(generatedWorkoutPendingKey(userId), raw)

  assert.equal(peekGeneratedWorkoutPayload(userId, sessionStorage as any, localStorage as any), raw)
})

test('generatedWorkoutHandoff: clear removes both handoff stores', () => {
  const sessionStorage = new MemoryStorage()
  const localStorage = new MemoryStorage()
  const userId = 'user-4'
  stageGeneratedWorkoutPayload(userId, { exercises: [] }, sessionStorage as any, localStorage as any)

  clearGeneratedWorkoutHandoff(userId, sessionStorage as any, localStorage as any)

  assert.equal(sessionStorage.getItem(GENERATED_WORKOUT_SESSION_KEY), null)
  assert.equal(localStorage.getItem(generatedWorkoutPendingKey(userId)), null)
})

test('generatedWorkoutHandoff: parse rejects invalid payloads', () => {
  assert.equal(parseGeneratedWorkoutPayload(null), null)
  assert.equal(parseGeneratedWorkoutPayload('not-json'), null)
  assert.deepEqual(parseGeneratedWorkoutPayload('{"exercises":[]}'), { exercises: [] })
})
