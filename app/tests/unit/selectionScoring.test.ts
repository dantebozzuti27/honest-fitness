/**
 * Characterization coverage for the exercise selection/scoring stage
 * (`stepSelectExercises`). The engine exposes its scoring rationale via
 * `exerciseDecisions` (top candidates per muscle group, with score + factors),
 * which is the stable observation point for the factor stack.
 *
 * Asserts unconditional invariants: well-formed decisions, determinism for a
 * fixed seed, hard exclusion of avoided exercises, and that selection never
 * invents an exercise outside the supplied library. Fourth brick of the engine
 * characterization net.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { generateWorkout, type GeneratedWorkout, type UserPreferences } from '../../src/lib/workoutEngine';
import { LIBRARY, buildPreferences, buildProfile, PLANNING_DATE } from './engineHarness';

async function session(
  prefsOverride: Partial<UserPreferences> = {},
  overrides: Record<string, unknown> = {},
): Promise<GeneratedWorkout> {
  const prefs = buildPreferences(prefsOverride);
  const profile = buildProfile(prefs);
  return generateWorkout(
    profile,
    { planningDate: PLANNING_DATE, regenerationSeed: 3, anchorMuscleGroups: ['mid_chest'], ...overrides } as never,
    { preferences: prefs, exerciseLibrary: LIBRARY },
  );
}

const LIBRARY_NAMES = new Set(LIBRARY.map((e) => e.name.toLowerCase()));

test('selection: every decision is well-formed (finite score, non-empty factors, group)', async () => {
  const w = await session();
  assert.ok((w.exerciseDecisions ?? []).length >= 1, 'at least one scoring decision recorded');
  for (const d of w.exerciseDecisions) {
    assert.ok(typeof d.exerciseName === 'string' && d.exerciseName.length > 0, 'decision has an exercise name');
    assert.ok(Number.isFinite(d.score), `score is finite for ${d.exerciseName}`);
    assert.ok(typeof d.muscleGroup === 'string' && d.muscleGroup.length > 0, `decision has a muscle group for ${d.exerciseName}`);
    assert.ok(Array.isArray(d.factors) && d.factors.length >= 1, `decision records >=1 factor for ${d.exerciseName}`);
  }
});

test('selection: the full decision log is deterministic for a fixed seed', async () => {
  const fingerprint = (w: GeneratedWorkout) =>
    (w.exerciseDecisions ?? []).map((d) => `${d.muscleGroup}|${d.exerciseName}|${d.score}|${d.factors.join(';')}`);
  const a = await session();
  const b = await session();
  assert.deepEqual(fingerprint(a), fingerprint(b), 'same profile + seed ⇒ identical scoring decisions');
});

test('selection: avoided exercises are hard-excluded from both scoring and selection', async () => {
  const w = await session({ exercises_to_avoid: ['Barbell Bench Press', 'Barbell Back Squat'] });
  const avoided = ['barbell bench press', 'barbell back squat'];
  for (const d of w.exerciseDecisions) {
    assert.ok(!avoided.includes(d.exerciseName.toLowerCase()), `${d.exerciseName} must not be scored when avoided`);
  }
  for (const ex of w.exercises) {
    assert.ok(!avoided.includes(ex.exerciseName.toLowerCase()), `${ex.exerciseName} must not be selected when avoided`);
  }
});

test('selection: never invents an exercise outside the supplied library', async () => {
  const w = await session();
  for (const ex of w.exercises) {
    assert.ok(
      LIBRARY_NAMES.has(ex.exerciseName.toLowerCase()),
      `selected exercise "${ex.exerciseName}" must come from the supplied library`,
    );
  }
});
