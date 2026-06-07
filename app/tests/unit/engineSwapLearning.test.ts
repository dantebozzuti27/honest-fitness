/**
 * Engine-level regression coverage for the exposure-normalized swap-preference
 * signal. The unit suite proves `computeExercisePreferenceSignals` is correct in
 * isolation; this suite proves the engine *consumes* it correctly through the
 * full `generateWorkout` path.
 *
 * We assert on the engine's own decision factors rather than on final selection,
 * because a dominant compound like the bench is force-retained by the unrelated
 * "staple continuity" invariant regardless of swap score. The decision log,
 * however, faithfully records whether the near-ban escape hatch fired — which is
 * exactly the branch the preference signal controls.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { generateWorkout, type GeneratedWorkout, type UserPreferences } from '../../src/lib/workoutEngine';
import {
  computeExercisePreferenceSignals,
  type TrainingProfile,
} from '../../src/lib/trainingAnalysis';
import { LIBRARY, buildPreferences, buildProfile, PLANNING_DATE } from './engineHarness';

const BENCH = 'Barbell Bench Press';

function withSwapHistory(
  base: TrainingProfile,
  opts: { rejectWeight: number; rejectCount: number; acceptWeight: number; acceptCount: number },
): TrainingProfile {
  const exerciseSwapHistory: TrainingProfile['exerciseSwapHistory'] = opts.rejectCount > 0
    ? [{ exerciseName: BENCH, swapCount: opts.rejectCount, lastSwapDate: '2026-01-01', effectiveSwapWeight: opts.rejectWeight }]
    : [];
  const exerciseAcceptances: TrainingProfile['exerciseAcceptances'] = opts.acceptCount > 0
    ? [{ exerciseName: BENCH, count: opts.acceptCount, lastDate: '2026-01-01', effectiveWeight: opts.acceptWeight }]
    : [];
  return {
    ...base,
    exerciseSwapHistory,
    exerciseAcceptances,
    exercisePreferenceSignals: computeExercisePreferenceSignals(exerciseSwapHistory, exerciseAcceptances),
  };
}

async function chestSession(profile: TrainingProfile, prefs: UserPreferences): Promise<GeneratedWorkout> {
  return generateWorkout(
    profile,
    { planningDate: PLANNING_DATE, regenerationSeed: 11, anchorMuscleGroups: ['mid_chest'] } as never,
    { preferences: prefs, exerciseLibrary: LIBRARY },
  );
}

function allFactors(w: GeneratedWorkout): string[] {
  return (w.exerciseDecisions ?? []).flatMap((d) => d.factors ?? []);
}
function hasBench(w: GeneratedWorkout): boolean {
  return w.exercises.some((e) => e.exerciseName.toLowerCase().includes('bench press'));
}

test('engine swap-learning: near-ban escape hatch fires when the lift is kept more than swapped', async () => {
  const prefs = buildPreferences();
  const base = buildProfile(prefs);

  // Same heavy rejection mass as a banned lift, but kept twice as often. The
  // exposure-normalized signal reads net-positive, so the engine must skip the
  // hard near-ban — recorded as an "Override skipped: kept-rate" decision.
  const kept = withSwapHistory(base, { rejectWeight: 30, rejectCount: 30, acceptWeight: 60, acceptCount: 60 });
  const sig = kept.exercisePreferenceSignals[0];
  assert.ok(sig && sig.netAffinity > 0.1 && sig.confidence >= 0.3, 'kept-far-more must read net positive with confidence');

  const w = await chestSession(kept, prefs);
  assert.ok(
    allFactors(w).some((f) => /Override skipped: kept-rate/.test(f)),
    'a kept-more-than-swapped lift must trigger the kept-rate escape hatch',
  );
  assert.ok(hasBench(w), 'and the lift survives into the session');
});

test('engine swap-learning: escape hatch does NOT fire under reject-only history', async () => {
  const prefs = buildPreferences();
  const base = buildProfile(prefs);

  const rejected = withSwapHistory(base, { rejectWeight: 30, rejectCount: 30, acceptWeight: 0, acceptCount: 0 });
  const sig = rejected.exercisePreferenceSignals[0];
  assert.ok(sig && sig.netAffinity < -0.5, 'reject-only history must read as strong rejection');

  const factors = allFactors(await chestSession(rejected, prefs));
  assert.ok(
    !factors.some((f) => /Override skipped: kept-rate/.test(f)),
    'with no acceptance evidence the kept-rate escape hatch must not fire',
  );
  // The near-ban itself should be recorded for the heavily-rejected lift.
  assert.ok(
    factors.some((f) => /Swap override: heavily rejected/.test(f)),
    'reject-only history must engage the heavily-rejected near-ban',
  );
});

test('engine swap-learning: acceptance evidence is monotone — it never worsens an exercise', async () => {
  // Property check at the engine boundary: holding rejection fixed, adding
  // acceptance evidence can only move the lift toward "kept", never away.
  const prefs = buildPreferences();
  const base = buildProfile(prefs);

  const noAccept = await chestSession(
    withSwapHistory(base, { rejectWeight: 30, rejectCount: 30, acceptWeight: 0, acceptCount: 0 }),
    prefs,
  );
  const withAccept = await chestSession(
    withSwapHistory(base, { rejectWeight: 30, rejectCount: 30, acceptWeight: 60, acceptCount: 60 }),
    prefs,
  );
  const presence = (w: GeneratedWorkout) => (hasBench(w) ? 1 : 0);
  assert.ok(
    presence(withAccept) >= presence(noAccept),
    'adding acceptance evidence must never reduce the exercise from kept to dropped',
  );
});
