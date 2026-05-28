import test from 'node:test'
import assert from 'node:assert/strict'
import {
  classifySessionMuscleGroups,
  expandWithSynergists,
  muscleGroupsForSplitSlot,
  muscleGroupsForMovementPattern,
  PUSH_DAY_GROUPS,
  PULL_DAY_GROUPS,
  SPLIT_TYPE_ROTATIONS,
} from '../../src/lib/splitOntology.ts'

test('muscleGroupsForSplitSlot: push returns chest + delts + triceps', () => {
  const groups = muscleGroupsForSplitSlot('push')
  assert.ok(groups.includes('mid_chest'))
  assert.ok(groups.includes('triceps'))
})

test('expandWithSynergists: pull day includes biceps synergist', () => {
  const expanded = expandWithSynergists(['back_lats'])
  assert.ok(expanded.has('biceps'))
  assert.ok(expanded.has('core'))
})

test('muscleGroupsForMovementPattern: hip_hinge aliases to hamstrings', () => {
  const groups = muscleGroupsForMovementPattern('hip_hinge')
  assert.ok(groups.includes('hamstrings'))
})

test('SPLIT_TYPE_ROTATIONS: bro_split has 5 slots', () => {
  assert.equal(SPLIT_TYPE_ROTATIONS.bro_split.length, 5)
})

test('classifySessionMuscleGroups: push day detected', () => {
  assert.equal(
    classifySessionMuscleGroups(['mid_chest', 'anterior_deltoid', 'triceps']),
    'push',
  )
})

test('PULL_DAY_GROUPS: includes forearms and rotator_cuff', () => {
  assert.ok(PULL_DAY_GROUPS.has('forearms'))
  assert.ok(PULL_DAY_GROUPS.has('rotator_cuff'))
})

test('PUSH_DAY_GROUPS: aligned with SPLIT_MUSCLE_MAPPING.push', () => {
  assert.ok(PUSH_DAY_GROUPS.has('mid_chest'))
  assert.ok(PUSH_DAY_GROUPS.has('triceps'))
})
