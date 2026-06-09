import test from 'node:test'
import assert from 'node:assert/strict'
import { EXERCISE_MUSCLE_MAP, getExerciseMapping } from '../../src/lib/exerciseMuscleMap.ts'
import {
  exerciseFamilyKey,
  resolveExerciseIdentity,
  resolveMuscleToken,
  prewarmOntologyCaches,
} from '../../src/lib/exerciseOntology.ts'

test('prewarmOntologyCaches warms the whole library and is idempotent', () => {
  const n1 = prewarmOntologyCaches()
  const n2 = prewarmOntologyCaches()
  assert.ok(n1 >= Object.keys(EXERCISE_MUSCLE_MAP).length, `warmed ${n1} < library size`)
  assert.equal(n1, n2, 'second prewarm must be a no-op returning the same size')
})

test('memoized family keys are stable and correct across repeated calls', () => {
  const cases: [string, string][] = [
    ['Pendulum Squat', 'squat_pattern'],
    ['Hack Squat Machine', 'squat_pattern'],
    ['Barbell Back Squat', 'squat_pattern'],
    ['Incline Dumbbell Bench Press', 'incline_press'],
    ['Leg Extension', 'leg_extension'],
    // Priority-promoted: these singular "curl" names were shadowed by the
    // generic biceps_curl rule before the priority matcher.
    ['Lying Leg Curl', 'leg_curl'],
    ['Seated Leg Curl', 'leg_curl'],
    ['Nordic Hamstring Curl', 'leg_curl'],
    ['Reverse Wrist Curl', 'forearm_wrist'],
    // Unchanged biceps curls must still resolve to biceps families.
    ['Barbell Biceps Curl', 'biceps_curl'],
    ['Hammer Curl', 'biceps_hammer'],
    ['Preacher Curl', 'biceps_short_head'],
    // Priority-promoted: split/Bulgarian squats are a unilateral lunge pattern,
    // not the bilateral squat the generic "squats?" rule was assigning.
    ['Bulgarian Split Squat', 'lunge_pattern'],
    ['Split Squat', 'lunge_pattern'],
    // ...but a real bilateral squat stays squat_pattern.
    ['Barbell Back Squat', 'squat_pattern'],
    // Priority-promoted: rear delt flies are posterior delt, not chest.
    ['Dumbbell Rear Delt Fly', 'rear_delt_fly'],
  ]
  for (const [name, expected] of cases) {
    const a = exerciseFamilyKey(name)
    const b = exerciseFamilyKey(name)
    assert.equal(a, expected, `${name} → ${a}, expected ${expected}`)
    assert.equal(a, b, 'repeated call must return the identical cached value')
  }
})

test('cacheable identity resolution is reference-stable (true memoization)', () => {
  const first = resolveExerciseIdentity('Barbell Back Squat')
  const second = resolveExerciseIdentity('Barbell Back Squat')
  assert.strictEqual(first, second, 'name-only identity must return the cached object reference')
})

test('identity with explicit muscle overrides bypasses the cache', () => {
  const cached = resolveExerciseIdentity('Barbell Back Squat')
  const overridden = resolveExerciseIdentity('Barbell Back Squat', ['biceps_brachii_long_head'])
  assert.notStrictEqual(cached, overridden, 'override path must not return the cached reference')
  assert.ok(overridden.primaryGroups.includes('biceps'), 'override muscles must take effect')
})

test('memoized getExerciseMapping fallback equals the canonical resolution', () => {
  // "barbell back squats" misses the exact key but canonicalizes to
  // "barbell back squat", which the canonical index resolves to the library
  // entry. The cached fallback must return that same mapping object.
  const viaMessy = getExerciseMapping('barbell back squats')
  const direct = EXERCISE_MUSCLE_MAP['Barbell Back Squat']
  assert.ok(viaMessy, 'pluralized name should still resolve via canonicalization')
  assert.strictEqual(viaMessy, direct, 'fallback must resolve to the same mapping object')
  // Repeated call hits the cache and returns the same reference.
  assert.strictEqual(getExerciseMapping('barbell back squats'), viaMessy)
})

test('resolveMuscleToken memoization preserves correctness', () => {
  assert.equal(resolveMuscleToken('vastus_lateralis'), resolveMuscleToken('vastus_lateralis'))
  assert.equal(resolveMuscleToken('quadriceps'), 'quadriceps')
  assert.equal(resolveMuscleToken('definitely_not_a_muscle_xyz'), null)
  // null is a real cached value, not "uncached" — second call must also be null.
  assert.equal(resolveMuscleToken('definitely_not_a_muscle_xyz'), null)
})
