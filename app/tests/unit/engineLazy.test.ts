/**
 * Integration coverage for the lazy engine boundary (`engineLazy.ts`).
 *
 * The TodayWorkout route no longer statically imports the generation engine;
 * it routes every runtime call through `engineLazy`'s memoized dynamic import.
 * The compiler verifies the wrapper *signatures*, but not that each wrapper
 * actually delegates to the real engine function. These tests close that gap by
 * asserting the lazy wrappers produce byte-for-byte the same output as calling
 * the engine module directly, plus that the loader memoizes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import * as engine from '../../src/lib/workoutEngine';
import * as lazy from '../../src/lib/engineLazy';
import { LIBRARY, buildPreferences, buildProfile, PLANNING_DATE } from './engineHarness';

test('engineLazy.loadEngine: memoizes and resolves the real module', async () => {
  const a = await lazy.loadEngine();
  const b = await lazy.loadEngine();
  assert.strictEqual(a, b, 'loadEngine must return the same module instance on repeat calls');
  assert.strictEqual(a, engine, 'lazy loader must resolve to the actual workoutEngine module');
  assert.equal(typeof a.generateWorkout, 'function');
});

test('engineLazy.parseRawPreferences: delegates to the engine (async wrapper)', async () => {
  const raw = {
    training_goal: 'bulk',
    session_duration_minutes: 50,
    equipment_access: 'full_gym',
    experience_level: 'advanced',
  };
  const direct = engine.parseRawPreferences(raw);
  const viaLazy = await lazy.parseRawPreferences(raw);
  assert.deepEqual(viaLazy, direct, 'lazy parseRawPreferences must match the direct engine result');
});

test('engineLazy.generateWorkout: delegates and preserves determinism', async () => {
  const prefs = buildPreferences();
  const profile = buildProfile(prefs);
  const overrides = { planningDate: PLANNING_DATE, regenerationSeed: 7, anchorMuscleGroups: ['mid_chest'] } as never;
  const prefetch = { preferences: prefs, exerciseLibrary: LIBRARY };

  const direct = await engine.generateWorkout(profile, overrides, prefetch);
  const viaLazy = await lazy.generateWorkout(profile, overrides, prefetch);

  // Same inputs + seed through the lazy path must produce the same prescription.
  assert.deepEqual(
    viaLazy.exercises.map((e) => [e.exerciseName, e.sets, e.targetReps, e.targetWeight]),
    direct.exercises.map((e) => [e.exerciseName, e.sets, e.targetReps, e.targetWeight]),
    'lazy generateWorkout must match the direct engine prescription',
  );
  assert.equal(viaLazy.trainingGoal, direct.trainingGoal);
});
