import test from 'node:test'
import assert from 'node:assert/strict'
import { EXERCISE_MUSCLE_MAP } from '../../src/lib/exerciseMuscleMap.ts'
import {
  exerciseFamilyKey,
  familyDiversityBonus,
  inferMuscleEmphasis,
  inferBicepsHeadEmphasis,
  isOntologyFamilyKey,
  findByExerciseFamily,
  ONTOLOGY_VERSION,
  resolveExerciseCanonicalGroups,
  resolveExerciseIdentity,
  resolveMuscleToken,
  substitutionCompatibilityScore,
} from '../../src/lib/exerciseOntology.ts'

test('resolveMuscleToken: plain canonical group biceps resolves', () => {
  assert.equal(resolveMuscleToken('biceps'), 'biceps')
  assert.equal(resolveMuscleToken('Biceps'), 'biceps')
})

test('resolveMuscleToken: anatomical head resolves', () => {
  assert.equal(resolveMuscleToken('biceps_brachii_long_head'), 'biceps')
})

test('resolveExerciseCanonicalGroups: library coarse tag biceps works', () => {
  const { primary } = resolveExerciseCanonicalGroups('Test Curl', ['biceps'])
  assert.deepEqual(primary, ['biceps'])
})

test('exerciseFamilyKey: curl variants map to distinct families', () => {
  assert.equal(exerciseFamilyKey('Incline Dumbbell Curl'), 'biceps_long_head')
  assert.equal(exerciseFamilyKey('Preacher Curl'), 'biceps_short_head')
  assert.equal(exerciseFamilyKey('Hammer Curl'), 'biceps_hammer')
  assert.equal(exerciseFamilyKey('Barbell Biceps Curl'), 'biceps_curl')
})

test('inferBicepsHeadEmphasis: from mapping metadata', () => {
  assert.equal(inferBicepsHeadEmphasis('Incline Dumbbell Curl'), 'long_head')
  assert.equal(inferBicepsHeadEmphasis('Preacher Curl'), 'short_head')
  assert.equal(inferBicepsHeadEmphasis('Hammer Curl'), 'brachialis')
})

test('familyDiversityBonus: rewards different biceps head on second pick', () => {
  const bonus = familyDiversityBonus('Hammer Curl', ['Barbell Biceps Curl'], 'biceps')
  assert.ok(bonus > 0, `expected positive diversity bonus, got ${bonus}`)
})

test('substitutionCompatibilityScore: different head emphasis scores higher than identical', () => {
  const same = substitutionCompatibilityScore('Barbell Biceps Curl', 'Dumbbell Biceps Curl', 'biceps')
  const diff = substitutionCompatibilityScore('Barbell Biceps Curl', 'Incline Dumbbell Curl', 'biceps')
  assert.ok(diff >= same, `head variation should score >= same family: ${diff} vs ${same}`)
})

test('resolveExerciseIdentity: full identity for mapped exercise', () => {
  const id = resolveExerciseIdentity('Barbell Biceps Curl')
  assert.equal(id.familyKey, 'biceps_curl')
  assert.ok(id.primaryGroups.includes('biceps'))
  assert.equal(id.bicepsHeadEmphasis, 'balanced')
})

test('EXERCISE_MUSCLE_MAP: every primary muscle resolves to a canonical group', () => {
  const failures: string[] = []
  for (const [name, mapping] of Object.entries(EXERCISE_MUSCLE_MAP)) {
    for (const m of mapping.primary_muscles ?? []) {
      if (!resolveMuscleToken(m)) {
        failures.push(`${name}: ${m}`)
      }
    }
  }
  assert.equal(failures.length, 0, `unmapped primaries: ${failures.slice(0, 8).join('; ')}`)
})

test('inferMuscleEmphasis: triceps pushdown vs overhead differ', () => {
  const pushdown = inferMuscleEmphasis('Triceps Pushdown', 'triceps')
  const overhead = inferMuscleEmphasis('Overhead Triceps Extension', 'triceps')
  assert.notEqual(pushdown, overhead)
})

test('familyDiversityBonus: hamstrings hip vs knee dominant', () => {
  const bonus = familyDiversityBonus('Romanian Deadlift', ['Lying Leg Curl'], 'hamstrings')
  assert.ok(bonus >= 10, `expected diversity bonus, got ${bonus}`)
})

test('familyDiversityBonus: rear delt face pull after reverse fly', () => {
  const bonus = familyDiversityBonus('Face Pull', ['Reverse Fly'], 'posterior_deltoid')
  assert.ok(bonus >= 10)
})

test('exerciseFamilyKey: triceps families distinct', () => {
  assert.equal(exerciseFamilyKey('Triceps Pushdown'), 'triceps_pushdown')
  assert.equal(exerciseFamilyKey('Overhead Triceps Extension'), 'triceps_overhead')
})

test('exerciseFamilyKey: new movement families classify correctly', () => {
  assert.equal(exerciseFamilyKey('Dumbbell Fly'), 'chest_fly')
  assert.equal(exerciseFamilyKey('Upright Row'), 'upright_row')
  assert.equal(exerciseFamilyKey('Wrist Curl'), 'forearm_wrist')
  assert.equal(exerciseFamilyKey('Shrug'), 'trap_shrug')
  assert.equal(exerciseFamilyKey('Hip Abduction Machine'), 'hip_abduction')
  assert.equal(exerciseFamilyKey('Farmer Carry'), 'loaded_carry')
  assert.equal(exerciseFamilyKey('Hiking'), 'cardio')
})

test('exerciseFamilyKey: plural plyometric and recovery names resolve', () => {
  assert.equal(exerciseFamilyKey('Burpees'), 'plyometric_cardio')
  assert.equal(exerciseFamilyKey('Box Jumps'), 'plyometric_cardio')
  assert.equal(exerciseFamilyKey('Foam Rolling'), 'recovery_mobility')
  assert.equal(exerciseFamilyKey('Cold Shower'), 'recovery_mobility')
})

test('findByExerciseFamily: matches alias variants', () => {
  const prefs = [
    { exerciseName: 'biceps_curl', totalSessions: 5 },
    { exerciseName: 'triceps_pushdown', totalSessions: 3 },
  ]
  assert.equal(findByExerciseFamily(prefs, 'Barbell Biceps Curl')?.totalSessions, 5)
  assert.equal(findByExerciseFamily(prefs, 'Rope Triceps Pushdown')?.totalSessions, 3)
  assert.equal(findByExerciseFamily(prefs, 'Squat'), undefined)
})

test('resolveMuscleToken: stabilizer aliases resolve', () => {
  assert.equal(resolveMuscleToken('obliques'), 'core')
  assert.equal(resolveMuscleToken('peroneus_longus'), 'calves')
})

test('isOntologyFamilyKey: canonical fallthrough is not a family', () => {
  assert.equal(isOntologyFamilyKey('biceps_curl'), true)
  assert.equal(isOntologyFamilyKey('some unknown exercise'), false)
})
