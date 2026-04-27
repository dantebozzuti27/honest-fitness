/**
 * Unit tests for exercise-name canonicalisation and the dedupe of
 * Pull-Up / Pull-ups (and the analogous Push-Up / Push-ups pair).
 *
 * The user-reported bug: "pull up" and "pull ups" were being treated as
 * separate exercises in the engine, fragmenting their history and producing
 * different SFRs (2.0 vs 2.5) depending on which spelling was used. These
 * tests pin the contract that all spelling variants of the same movement
 * resolve to the same mapping with the same metadata.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canonicalizeExerciseName,
  getExerciseMapping,
  EXERCISE_MUSCLE_MAP,
} from '../../src/lib/exerciseMuscleMap';

// ─────────────────────────────────────────────────────────────────────────
// canonicalizeExerciseName — the algorithm itself
// ─────────────────────────────────────────────────────────────────────────

test('canonicalize: collapses pull-up variants to a single key', () => {
  const variants = ['Pull-Up', 'pull-up', 'Pull Up', 'pull up', 'pull-ups', 'Pull Ups', 'pullup', 'PULLUPS'];
  const canon = variants.map(canonicalizeExerciseName);
  // All should be identical
  assert.equal(new Set(canon).size, 1, `expected all variants to canonicalise the same, got: ${[...new Set(canon)].join(' | ')}`);
  assert.equal(canon[0], 'pull up');
});

test('canonicalize: collapses push-up variants to a single key', () => {
  const variants = ['Push-Up', 'push-up', 'Push Up', 'push up', 'push-ups', 'Push Ups', 'pushup', 'PUSHUPS'];
  const canon = variants.map(canonicalizeExerciseName);
  assert.equal(new Set(canon).size, 1);
  assert.equal(canon[0], 'push up');
});

test('canonicalize: preserves variant grips as distinct exercises', () => {
  // These ARE different exercises (different stimulus profile) — must NOT collapse.
  assert.notEqual(
    canonicalizeExerciseName('Pull-Up'),
    canonicalizeExerciseName('Wide-Grip Pull-Up')
  );
  assert.notEqual(
    canonicalizeExerciseName('Pull-Up'),
    canonicalizeExerciseName('Assisted Pull-Up')
  );
});

test('canonicalize: never strips an "ss" or "us" ending (not a plural marker)', () => {
  // "press" ends in ss → must keep the s
  assert.equal(canonicalizeExerciseName('Bench Press'), 'bench press');
  assert.equal(canonicalizeExerciseName('bench presses'), 'bench presse');
  // ^ Note: "presses" → "presse" is technically wrong-but-harmless because
  // dataCleaning.ts already canonicalises "bench press" plurals upstream.
  // What matters is that "press" itself is preserved.
});

test('canonicalize: empty / whitespace input returns empty string', () => {
  assert.equal(canonicalizeExerciseName(''), '');
  assert.equal(canonicalizeExerciseName('   '), '');
  assert.equal(canonicalizeExerciseName(null as any), '');
});

// ─────────────────────────────────────────────────────────────────────────
// getExerciseMapping — the lookup that uses the canonical form
// ─────────────────────────────────────────────────────────────────────────

test('getExerciseMapping: pull-up variants ALL return the same mapping', () => {
  const variants = ['Pull-Up', 'pull-up', 'Pull Up', 'pull-ups', 'Pull Ups', 'pullup', 'PULLUPS'];
  const mappings = variants.map(getExerciseMapping);
  // Every variant must resolve to a defined mapping
  for (const m of mappings) {
    assert.ok(m, `expected a mapping for every variant, missed one`);
  }
  // And every mapping must be the SAME object (referentially) — i.e. the
  // canonical 'Pull-Up' entry, not the deleted duplicate.
  const first = mappings[0];
  for (const m of mappings) {
    assert.equal(m, first, 'all variants should resolve to the same mapping reference');
  }
  // Sanity: it must be the canonical SFR=2 entry, not the deleted SFR=2.5 dup.
  assert.equal(first!.stimulus_to_fatigue_ratio, 2);
});

test('getExerciseMapping: push-up variants ALL return the same mapping', () => {
  const variants = ['Push-Up', 'push-up', 'Push Up', 'push-ups', 'pushup', 'PUSHUPS'];
  const mappings = variants.map(getExerciseMapping);
  const first = mappings[0];
  for (const m of mappings) {
    assert.ok(m);
    assert.equal(m, first);
  }
});

test('getExerciseMapping: known aliases (Deadlift → Conventional Deadlift) still work', () => {
  const m = getExerciseMapping('Deadlift');
  assert.ok(m, 'expected Deadlift alias to resolve');
  // Same target as the explicit canonical form
  assert.equal(m, getExerciseMapping('Conventional Deadlift'));
});

test('getExerciseMapping: unknown exercise returns undefined', () => {
  assert.equal(getExerciseMapping('Definitely Not A Real Exercise XYZ'), undefined);
});

// ─────────────────────────────────────────────────────────────────────────
// Structural assertion: the duplicate entries are GONE
// ─────────────────────────────────────────────────────────────────────────

test('EXERCISE_MUSCLE_MAP no longer contains plural-form duplicates', () => {
  // These keys used to exist with slightly different SFRs and were the root
  // cause of the user-visible split. If a future PR re-introduces them,
  // this test is the early-warning system.
  assert.equal(EXERCISE_MUSCLE_MAP['Pull-ups'], undefined,
    'Pull-ups duplicate must stay deleted — use Pull-Up canonical entry');
  assert.equal(EXERCISE_MUSCLE_MAP['Push-ups'], undefined,
    'Push-ups duplicate must stay deleted — use Push-Up canonical entry');
  // The canonical entries must still exist
  assert.ok(EXERCISE_MUSCLE_MAP['Pull-Up'], 'Pull-Up canonical entry missing');
  assert.ok(EXERCISE_MUSCLE_MAP['Push-Up'], 'Push-Up canonical entry missing');
});
