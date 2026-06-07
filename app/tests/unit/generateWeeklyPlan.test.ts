/**
 * Characterization coverage for weekly-plan assembly (`generateWeeklyPlan`).
 *
 * Asserts structural invariants that must hold for ANY valid plan, not specific
 * exercise picks — a regression net that survives scoring/selection tweaks but
 * catches breakage in the plan skeleton (day count, ordering, rest handling,
 * date contiguity). This is the second brick of the engine characterization net.
 *
 * Hermetic: a prefetched preferences + library is supplied so the planner does
 * zero network/DB IO.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { generateWeeklyPlan, type WeeklyPlan, type UserPreferences } from '../../src/lib/workoutEngine';
import { LIBRARY, buildPreferences, buildProfile } from './engineHarness';

const DAY_MS = 86_400_000;

async function plan(restDays: number[], prefsOverride: Partial<UserPreferences> = {}): Promise<WeeklyPlan> {
  const prefs = buildPreferences(prefsOverride);
  const profile = buildProfile(prefs);
  return generateWeeklyPlan(profile, restDays, prefs.preferred_split ?? null, null, {
    preferences: prefs,
    exerciseLibrary: LIBRARY,
  });
}

test('generateWeeklyPlan: produces exactly 7 contiguous Monday→Sunday days', async () => {
  const p = await plan([0]);
  assert.equal(p.days.length, 7, 'a week has 7 days');
  assert.equal(p.days[0].dayOfWeek, 1, 'first day is Monday');
  assert.equal(p.days[6].dayOfWeek, 0, 'last day is Sunday');
  assert.equal(p.weekStartDate, p.days[0].planDate, 'weekStartDate is the Monday');

  for (let i = 1; i < p.days.length; i++) {
    const prev = new Date(`${p.days[i - 1].planDate}T12:00:00`).getTime();
    const cur = new Date(`${p.days[i].planDate}T12:00:00`).getTime();
    assert.ok(Number.isFinite(prev) && Number.isFinite(cur), 'dates parse');
    assert.equal(cur - prev, DAY_MS, `day ${i} is exactly one day after day ${i - 1}`);
  }
});

test('generateWeeklyPlan: every requested rest day is a rest day with no planned workout', async () => {
  const restDays = [0, 3]; // Sunday + Wednesday
  const p = await plan(restDays);
  for (const day of p.days) {
    if (restDays.includes(day.dayOfWeek)) {
      assert.ok(day.isRestDay, `dow ${day.dayOfWeek} must be a rest day`);
      assert.equal(day.plannedWorkout, null, `rest day ${day.dayOfWeek} carries no planned workout`);
    }
  }
});

test('generateWeeklyPlan: training days carry a non-empty, self-consistent workout', async () => {
  const p = await plan([0]);
  const trainingDays = p.days.filter((d) => !d.isRestDay);
  assert.ok(trainingDays.length >= 1, 'at least one training day');
  for (const day of trainingDays) {
    assert.ok(day.plannedWorkout, `training day ${day.dayName} has a planned workout`);
    assert.ok(day.plannedWorkout!.exercises.length >= 1, `${day.dayName} programs >=1 exercise`);
    assert.equal(
      day.estimatedExercises,
      day.plannedWorkout!.exercises.length,
      `${day.dayName}: estimatedExercises matches the planned workout`,
    );
  }
});

test('generateWeeklyPlan: the rest/focus skeleton is deterministic', async () => {
  const skeleton = (p: WeeklyPlan) => p.days.map((d) => `${d.dayOfWeek}:${d.isRestDay ? 'R' : d.focus}`);
  const a = await plan([0, 3]);
  const b = await plan([0, 3]);
  assert.deepEqual(skeleton(a), skeleton(b), 'same inputs must yield the same rest/focus skeleton');
});
