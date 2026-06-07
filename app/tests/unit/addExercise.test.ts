/**
 * Coverage for the user-initiated add-exercise path. Adding an exercise before
 * a session must produce a fully-coached slot (sets/reps/weight/RIR/rest) that
 * obeys the same invariants as an engine-generated one — not a raw drop-in.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { generateWorkout, addExerciseToWorkout, type GeneratedWorkout } from '../../src/lib/workoutEngine';
import { LIBRARY, buildPreferences, buildProfile, PLANNING_DATE } from './engineHarness';

const HUMAN_REP_GRID = new Set([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 20, 25]);

async function baseWorkout(): Promise<GeneratedWorkout> {
  const prefs = buildPreferences({ session_duration_minutes: 60 });
  const profile = buildProfile(prefs);
  return generateWorkout(
    profile,
    { planningDate: PLANNING_DATE, regenerationSeed: 5, goalOverride: 'bulk', anchorMuscleGroups: ['mid_chest'] } as never,
    { preferences: prefs, exerciseLibrary: LIBRARY },
  );
}

function ctx() {
  const prefs = buildPreferences({ session_duration_minutes: 60 });
  return { prefs, profile: buildProfile(prefs) };
}

test('add by muscle group: engine picks an exercise and prescribes a coherent slot', async () => {
  const w = await baseWorkout();
  const { prefs, profile } = ctx();
  const r = await addExerciseToWorkout(w, { muscleGroup: 'back_lats' }, profile, { preferences: prefs, exerciseLibrary: LIBRARY });

  assert.equal(r.reason, 'ok');
  assert.ok(r.addedName, 'an exercise was chosen');
  assert.equal(r.workout.exercises.length, w.exercises.length + 1);

  const added = r.workout.exercises[r.workout.exercises.length - 1];
  assert.ok(added.sets >= 1 && added.sets <= 6, `sane set count (${added.sets})`);
  assert.ok(HUMAN_REP_GRID.has(added.targetReps), `reps ${added.targetReps} on human grid`);
  assert.ok(added.restSeconds > 0 && added.restSeconds <= 600, `sane rest (${added.restSeconds}s)`);
  assert.ok(Number.isFinite(added.targetWeight ?? 0) && (added.targetWeight ?? 0) >= 0, 'finite, non-negative load');
  assert.ok(Number.isFinite(added.estimatedMinutes) && added.estimatedMinutes > 0 && added.estimatedMinutes < 60,
    `sane per-exercise minutes (${added.estimatedMinutes})`);
});

test('add by specific name: resolves and prescribes that exact exercise', async () => {
  const w = await baseWorkout();
  const { prefs, profile } = ctx();
  const r = await addExerciseToWorkout(w, { exerciseName: 'Barbell Curl' }, profile, { preferences: prefs, exerciseLibrary: LIBRARY });

  assert.equal(r.reason, 'ok');
  assert.equal(r.addedName, 'Barbell Curl');
  const added = r.workout.exercises.find(e => e.exerciseName === 'Barbell Curl');
  assert.ok(added, 'curl present in workout');
  assert.ok(HUMAN_REP_GRID.has(added!.targetReps), `reps ${added!.targetReps} on human grid`);
});

test('add updates the session duration by exactly the new slot', async () => {
  const w = await baseWorkout();
  const { prefs, profile } = ctx();
  const r = await addExerciseToWorkout(w, { exerciseName: 'Barbell Curl' }, profile, { preferences: prefs, exerciseLibrary: LIBRARY });
  const added = r.workout.exercises[r.workout.exercises.length - 1];
  const expected = w.exercises.reduce((s, e) => s + (e.estimatedMinutes || 0), 0) + added.estimatedMinutes;
  assert.ok(Math.abs(r.workout.estimatedDurationMinutes - expected) < 0.01, 'duration reflects the added slot');
});

test('add rejects an exercise already in the session', async () => {
  const w = await baseWorkout();
  const { prefs, profile } = ctx();
  const dup = w.exercises[0].exerciseName;
  const r = await addExerciseToWorkout(w, { exerciseName: dup }, profile, { preferences: prefs, exerciseLibrary: LIBRARY });
  assert.equal(r.reason, 'already_present');
  assert.equal(r.workout.exercises.length, w.exercises.length);
});

test('add reports not_found for an unknown exercise name', async () => {
  const w = await baseWorkout();
  const { prefs, profile } = ctx();
  const r = await addExerciseToWorkout(w, { exerciseName: 'Nonexistent Lift 9000' }, profile, { preferences: prefs, exerciseLibrary: LIBRARY });
  assert.equal(r.reason, 'not_found');
});

test('add is deterministic for a fixed profile/library (muscle-group pick)', async () => {
  const w = await baseWorkout();
  const { prefs, profile } = ctx();
  const a = await addExerciseToWorkout(w, { muscleGroup: 'back_lats' }, profile, { preferences: prefs, exerciseLibrary: LIBRARY });
  const b = await addExerciseToWorkout(w, { muscleGroup: 'back_lats' }, profile, { preferences: prefs, exerciseLibrary: LIBRARY });
  assert.equal(a.addedName, b.addedName, 'same pick for identical inputs');
});
