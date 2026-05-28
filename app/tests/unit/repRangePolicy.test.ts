import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_MODEL_CONFIG } from '../../src/lib/modelConfig.ts'
import {
  getRepRangeByRole,
  resolveDayOccurrenceIndex,
  resolveTargetRepsForRole,
} from '../../src/lib/repRangePolicy.ts'

test('resolveDayOccurrenceIndex: bulk defaults to moderate reps at 1x/wk frequency', () => {
  assert.equal(resolveDayOccurrenceIndex('bulk', 1.0), 1)
  assert.equal(resolveDayOccurrenceIndex('bulk', 2.0), 0)
})

test('resolveDayOccurrenceIndex: cut keeps heavy day when frequency is low', () => {
  assert.equal(resolveDayOccurrenceIndex('cut', 1.0), 0)
  assert.equal(resolveDayOccurrenceIndex('cut', 2.0), 1)
})

test('getRepRangeByRole: bulk primary on moderate day stays in hypertrophy band', () => {
  const range = getRepRangeByRole('primary', 'bulk', null, 1, DEFAULT_MODEL_CONFIG, 'compound')
  assert.ok(range.min >= 8, `expected min >= 8, got ${range.min}`)
  assert.ok(range.max <= 12, `expected max <= 12, got ${range.max}`)
  assert.equal(range.target, 10)
})

test('getRepRangeByRole: bulk primary on heavy day uses hypertrophy band (not 6–8 strength)', () => {
  const range = getRepRangeByRole('primary', 'bulk', null, 0, DEFAULT_MODEL_CONFIG, 'compound')
  assert.equal(range.min, 8)
  assert.equal(range.max, 12)
  assert.equal(range.target, 10)
})

test('getRepRangeByRole: bulk primary without cycling uses table hypertrophy band', () => {
  const range = getRepRangeByRole('primary', 'bulk', null, undefined, DEFAULT_MODEL_CONFIG, 'compound')
  assert.equal(range.min, 8)
  assert.equal(range.max, 12)
  assert.equal(range.target, 10)
})

test('getRepRangeByRole: bulk isolation uses table range not metabolic 12–20', () => {
  const range = getRepRangeByRole('isolation', 'bulk', null, 0, DEFAULT_MODEL_CONFIG, null)
  assert.equal(range.min, 10)
  assert.equal(range.max, 15)
  assert.equal(range.target, 12)
})

test('getRepRangeByRole: cut isolation still uses metabolic range', () => {
  const range = getRepRangeByRole('isolation', 'cut', null, 0, DEFAULT_MODEL_CONFIG, null)
  assert.equal(range.min, 12)
  assert.equal(range.max, 20)
})

test('getRepRangeByRole: cut primary heavy day keeps strength band', () => {
  const range = getRepRangeByRole('primary', 'cut', null, 0, DEFAULT_MODEL_CONFIG, 'compound')
  assert.equal(range.min, 4)
  assert.equal(range.max, 6)
})

test('resolveTargetRepsForRole: bulk primary respects table floor over low learned reps', () => {
  const reps = resolveTargetRepsForRole(
    'primary',
    'bulk',
    null,
    1,
    DEFAULT_MODEL_CONFIG,
    'compound',
    5,
    true,
  )
  assert.ok(reps >= 8 && reps <= 12, `expected hypertrophy band, got ${reps}`)
})
