/**
 * End-to-end generation smoke suite — the first tests that actually drive
 * `generateWorkout()` rather than isolated sub-modules.
 *
 * Strategy: synthesize a realistic 6-week push/pull/legs history, run it
 * through the REAL `computeTrainingProfileFromData` to get an internally
 * consistent TrainingProfile, then call `generateWorkout` with a prefetched
 * preferences + library so the engine performs zero network/DB IO.
 *
 * Assertions deliberately target engine *guarantees* (structural validity,
 * determinism, constraint honoring) rather than specific exercise picks, so
 * the suite is a regression net without being brittle to scoring tweaks.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  generateWorkout,
  type UserPreferences,
  type GeneratedWorkout,
} from '../../src/lib/workoutEngine';
import { LIBRARY, buildPreferences, buildProfile, PLANNING_DATE } from './engineHarness';

async function generate(
  prefs: UserPreferences,
  overrides: Record<string, unknown> = {},
): Promise<GeneratedWorkout> {
  const profile = buildProfile(prefs);
  return generateWorkout(
    profile,
    { planningDate: PLANNING_DATE, ...overrides } as never,
    { preferences: prefs, exerciseLibrary: LIBRARY },
  );
}

function assertStructurallyValid(w: GeneratedWorkout) {
  assert.ok(w, 'workout returned');
  assert.ok(Array.isArray(w.exercises), 'exercises is an array');
  assert.ok(w.exercises.length >= 1, 'at least one exercise prescribed');
  const names = new Set<string>();
  for (const ex of w.exercises) {
    assert.ok(ex.exerciseName && ex.exerciseName.length > 0, 'exercise has a name');
    assert.ok(!names.has(ex.exerciseName), `no duplicate exercise: ${ex.exerciseName}`);
    names.add(ex.exerciseName);
    assert.ok(ex.sets >= 1, `${ex.exerciseName}: sets >= 1`);
    if (!ex.isCardio) {
      assert.ok(ex.targetReps > 0, `${ex.exerciseName}: targetReps > 0`);
      assert.ok(ex.restSeconds > 0, `${ex.exerciseName}: restSeconds > 0`);
      assert.ok((ex.targetWeight ?? 0) >= 0, `${ex.exerciseName}: targetWeight non-negative`);
    }
  }
  assert.ok(w.estimatedDurationMinutes > 0, 'estimated duration positive');
}

test('generateWorkout: produces a structurally valid session from real history', async () => {
  const prefs = buildPreferences();
  const w = await generate(prefs);
  assertStructurallyValid(w);
  // A 60-minute full-gym session should program several exercises.
  assert.ok(w.exercises.length >= 3, `expected >=3 exercises, got ${w.exercises.length}`);
  // History established e1RM on the compounds → at least one loaded lift.
  assert.ok(
    w.exercises.some((e) => !e.isCardio && (e.targetWeight ?? 0) > 0),
    'at least one weighted exercise has a prescribed load',
  );
});

test('generateWorkout: respects the duration budget', async () => {
  const w = await generate(buildPreferences({ session_duration_minutes: 45 }));
  assertStructurallyValid(w);
  // Allow modest overage for warmups/rounding, but the engine must not blow
  // past the budget by a wide margin.
  assert.ok(
    w.estimatedDurationMinutes <= 45 * 1.6,
    `duration ${w.estimatedDurationMinutes} exceeds budget tolerance`,
  );
});

test('generateWorkout: never prescribes an avoided exercise', async () => {
  const prefs = buildPreferences({ exercises_to_avoid: ['Barbell Bench Press', 'Barbell Back Squat'] });
  // Anchor each split day across a week — none should surface the avoided lifts.
  for (const anchor of [['mid_chest'], ['quadriceps'], ['back_lats']]) {
    const w = await generate(prefs, { anchorMuscleGroups: anchor });
    assertStructurallyValid(w);
    const names = w.exercises.map((e) => e.exerciseName);
    assert.ok(!names.includes('Barbell Bench Press'), `avoided bench surfaced for ${anchor}`);
    assert.ok(!names.includes('Barbell Back Squat'), `avoided squat surfaced for ${anchor}`);
  }
});

test('generateWorkout: is deterministic for a fixed regeneration seed', async () => {
  const prefs = buildPreferences();
  const a = await generate(prefs, { regenerationSeed: 42, anchorMuscleGroups: ['mid_chest'] });
  const b = await generate(prefs, { regenerationSeed: 42, anchorMuscleGroups: ['mid_chest'] });
  assert.deepEqual(
    a.exercises.map((e) => e.exerciseName),
    b.exercises.map((e) => e.exerciseName),
    'same seed + inputs must yield the same exercise sequence',
  );
});

test('generateWorkout: goal override propagates to the prescribed session', async () => {
  const bulk = await generate(buildPreferences(), { goalOverride: 'bulk' });
  assertStructurallyValid(bulk);
  assert.equal(bulk.trainingGoal, 'bulk', 'goalOverride must drive the session training goal');

  const cut = await generate(buildPreferences(), { goalOverride: 'cut' });
  assert.equal(cut.trainingGoal, 'cut');
});

test('generateWorkout: a larger time budget programs at least as much work', async () => {
  const short = await generate(buildPreferences({ session_duration_minutes: 30 }));
  const long = await generate(buildPreferences({ session_duration_minutes: 75 }));
  assertStructurallyValid(short);
  assertStructurallyValid(long);
  const setsOf = (w: GeneratedWorkout) => w.exercises.reduce((s, e) => s + e.sets, 0);
  // More available time must never reduce total prescribed volume.
  assert.ok(
    setsOf(long) >= setsOf(short),
    `long session (${setsOf(long)} sets) should be >= short (${setsOf(short)} sets)`,
  );
});
