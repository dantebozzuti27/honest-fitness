/**
 * Regressions for two budget/cardio defects:
 *
 *  1. effectiveSessionDurationMinutes silently collapsed an explicit long
 *     session (e.g. 120 min) toward the observed average (~70% weight), so the
 *     week-ahead/next-week preview showed ~80-min workouts for a 120-min user.
 *
 *  2. An UNSET cardio_duration_minutes preference (`Number(null) === 0`, which
 *     is finite) was read as a hard 8-minute total-cardio cap, so every user
 *     who never set a cardio duration had ALL cardio clamped to 8 min — even on
 *     a cut with a large time budget.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { generateWorkout, type GeneratedWorkout, type UserPreferences } from '../../src/lib/workoutEngine';
import { effectiveSessionDurationMinutes } from '../../src/lib/enginePersonalization';
import { LIBRARY, buildPreferences, buildProfile, PLANNING_DATE } from './engineHarness';

// ── effectiveSessionDurationMinutes ────────────────────────────────────────

test('session budget: stated budget dominates the blend and is never gutted', () => {
  const prefs = { session_duration_minutes: 120 } as UserPreferences;
  const profile = { avgSessionDuration: 72 } as never;
  const eff = effectiveSessionDurationMinutes(prefs, profile);
  // Floor is 88% of stated → must be >= 106, never the old ~87.
  assert.ok(eff >= Math.round(120 * 0.88), `expected >= 106, got ${eff}`);
  assert.ok(eff <= 120, `must not exceed stated budget, got ${eff}`);
});

test('session budget: future/preview planning honors the FULL stated budget', () => {
  const prefs = { session_duration_minutes: 120 } as UserPreferences;
  const profile = { avgSessionDuration: 72 } as never;
  const eff = effectiveSessionDurationMinutes(prefs, profile, { honorStatedBudget: true });
  assert.equal(eff, 120, 'a week not yet trained has no observed duration to blend against');
});

test('session budget: no observed history returns the stated budget unchanged', () => {
  const prefs = { session_duration_minutes: 90 } as UserPreferences;
  const profile = { avgSessionDuration: 0 } as never;
  assert.equal(effectiveSessionDurationMinutes(prefs, profile), 90);
});

test('session budget: behavioral trim is bounded (cannot halve a long session)', () => {
  // Even a wildly low observed average cannot drag a 120 budget below 88%.
  const prefs = { session_duration_minutes: 120 } as UserPreferences;
  const profile = { avgSessionDuration: 20 } as never;
  const eff = effectiveSessionDurationMinutes(prefs, profile);
  assert.equal(eff, Math.round(120 * 0.88), `floor must hold, got ${eff}`);
});

// ── Cardio is not clamped to 8 minutes when the preference is unset ─────────

async function cutSession(prefsOverride: Partial<UserPreferences>): Promise<GeneratedWorkout> {
  const prefs = buildPreferences({ training_goal: 'cut', session_duration_minutes: 120, ...prefsOverride });
  const profile = buildProfile(prefs);
  return generateWorkout(
    profile,
    { planningDate: PLANNING_DATE, regenerationSeed: 5 } as never,
    { preferences: prefs, exerciseLibrary: LIBRARY },
  );
}

test('cardio: an unset duration preference does NOT clamp cardio to 8 minutes on a cut', async () => {
  const w = await cutSession({ cardio_duration_minutes: null });
  const cardio = w.exercises.filter((e) => e.isCardio);
  assert.ok(cardio.length >= 1, 'a cut must carry cardio');
  const totalCardioMin = cardio.reduce(
    (s, e) => s + (e.cardioDurationSeconds ?? 0) / 60,
    0,
  );
  // The old bug pinned this at ~8 min. A cut with a 120-min budget should get a
  // meaningful goal-based dose well above 8.
  assert.ok(totalCardioMin > 12, `cardio should exceed the old 8-min clamp, got ${totalCardioMin.toFixed(1)} min`);
});

test('cardio: an explicit cardio duration preference is still respected as a target', async () => {
  const w = await cutSession({ cardio_duration_minutes: 15 });
  const cardio = w.exercises.filter((e) => e.isCardio);
  assert.ok(cardio.length >= 1, 'cardio present');
  const totalCardioMin = cardio.reduce(
    (s, e) => s + (e.cardioDurationSeconds ?? 0) / 60,
    0,
  );
  // Explicit 15-min target → cap is ~15*1.05; allow a small tolerance band.
  assert.ok(totalCardioMin <= 20, `explicit target should bound cardio near 15, got ${totalCardioMin.toFixed(1)}`);
  assert.ok(totalCardioMin >= 8, `but not below the floor, got ${totalCardioMin.toFixed(1)}`);
});
