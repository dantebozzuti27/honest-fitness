import test from 'node:test'
import assert from 'node:assert/strict'
import { isUuidV4 } from '../src/lib/workoutLineage.js'

test('isUuidV4 accepts v4 UUIDs', () => {
  assert.equal(isUuidV4('a1b2c3d4-e5f6-4789-a012-3456789abcde'), true)
  assert.equal(isUuidV4('not-a-uuid'), false)
})
