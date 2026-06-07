/**
 * Characterization coverage for the prescription/load path — the stage that
 * turns a selected exercise list into concrete sets × reps × weight × RIR.
 *
 * Asserts per-prescription invariants that must always hold (reps inside the
 * role's rep band, RIR inside its band, sane rest/sets, finite non-negative
 * load) plus prescription determinism for a fixed seed across goal phases.
 * Third brick of the engine characterization net.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { generateWorkout, type GeneratedWorkout, type UserPreferences } from '../../src/lib/workoutEngine';
import { LIBRARY, buildPreferences, buildProfile, PLANNING_DATE } from './engineHarness';

async function session(
  prefsOverride: Partial<UserPreferences>,
  overrides: Record<string, unknown> = {},
): Promise<GeneratedWorkout> {
  const prefs = buildPreferences(prefsOverride);
  const profile = buildProfile(prefs);
  return generateWorkout(
    profile,
    { planningDate: PLANNING_DATE, regenerationSeed: 5, ...overrides } as never,
    { preferences: prefs, exerciseLibrary: LIBRARY },
  );
}

function assertPrescriptionValid(w: GeneratedWorkout) {
  for (const ex of w.exercises) {
    if (ex.isCardio) continue;
    assert.ok(ex.sets >= 1 && ex.sets <= 12, `${ex.exerciseName}: sane set count (${ex.sets})`);
    assert.ok(ex.restSeconds > 0 && ex.restSeconds <= 600, `${ex.exerciseName}: sane rest (${ex.restSeconds}s)`);
    assert.ok(Number.isFinite(ex.targetWeight ?? 0) && (ex.targetWeight ?? 0) >= 0, `${ex.exerciseName}: finite, non-negative load`);

    if (ex.targetRepRange) {
      const { min, max } = ex.targetRepRange;
      assert.ok(min >= 1 && max >= min, `${ex.exerciseName}: coherent rep range [${min}, ${max}]`);
      assert.ok(
        ex.targetReps >= min && ex.targetReps <= max,
        `${ex.exerciseName}: targetReps ${ex.targetReps} inside band [${min}, ${max}]`,
      );
    } else {
      assert.ok(ex.targetReps > 0, `${ex.exerciseName}: positive target reps`);
    }

    if (ex.rirRange && ex.targetRir != null) {
      const [lo, hi] = ex.rirRange;
      assert.ok(
        ex.targetRir >= lo && ex.targetRir <= hi,
        `${ex.exerciseName}: targetRir ${ex.targetRir} inside band [${lo}, ${hi}]`,
      );
    }
  }
}

test('prescription: every loaded set is internally coherent (reps/RIR in band, sane rest/sets)', async () => {
  for (const goal of ['bulk', 'cut', 'maintain'] as const) {
    const w = await session({}, { goalOverride: goal });
    assert.equal(w.trainingGoal, goal);
    assertPrescriptionValid(w);
  }
});

test('prescription: deterministic for a fixed seed within a goal phase', async () => {
  const a = await session({}, { goalOverride: 'bulk' });
  const b = await session({}, { goalOverride: 'bulk' });
  const fingerprint = (w: GeneratedWorkout) =>
    w.exercises.map((e) => `${e.exerciseName}|${e.sets}x${e.targetReps}@${e.targetWeight ?? 'bw'}|rir${e.targetRir ?? '-'}`);
  assert.deepEqual(fingerprint(a), fingerprint(b), 'same seed + goal ⇒ identical prescription');
});

test('prescription: a tighter time budget never inflates per-exercise set counts', async () => {
  // Volume is allocated within a time bank; shrinking the bank must not somehow
  // increase the sets prescribed on a given exercise (a guard against the
  // budget allocator inverting under pressure).
  const long = await session({ session_duration_minutes: 75 });
  const short = await session({ session_duration_minutes: 30 });
  const setsByName = (w: GeneratedWorkout) => new Map(w.exercises.map((e) => [e.exerciseName, e.sets]));
  const longSets = setsByName(long);
  const shortSets = setsByName(short);
  for (const [name, s] of shortSets) {
    const l = longSets.get(name);
    if (l != null) {
      assert.ok(s <= l, `${name}: short-session sets (${s}) must not exceed long-session sets (${l})`);
    }
  }
});
