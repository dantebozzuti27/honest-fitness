/**
 * Unit tests for missed-day detection and redistribution.
 *
 * The redistribution module is pure, which makes it easy to test exhaustively.
 * The cases below cover:
 *   - Detection (past + planned + not completed = missed)
 *   - Theme compatibility scoring (perfect / family / accessory / none)
 *   - "No viable day" when nothing can absorb the volume
 *   - Apply behaviour (in-place set bumps with +2 per-exercise cap)
 *
 * These tests are also the implicit specification of the algorithm. If a
 * future tweak changes the scoring weights, expect several to fail —
 * good. Update with intent, not by reflex.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  detectMissedDays,
  proposeRedistributions,
  applyRedistribution,
} from '../../src/lib/missedDayRedistribution';
import type {
  WeeklyPlan,
  WeeklyPlanDay,
  GeneratedWorkout,
  GeneratedExercise,
  DayTheme,
} from '../../src/lib/workoutEngine';

// ─────────────────────────────────────────────────────────────────────────
// Fixture builders
// ─────────────────────────────────────────────────────────────────────────

function makeExercise(overrides: Partial<GeneratedExercise> = {}): GeneratedExercise {
  return {
    exerciseName: 'Bench Press',
    exerciseLibraryId: 'ex_bench',
    bodyPart: 'chest',
    primaryMuscles: ['mid_chest'],
    secondaryMuscles: ['triceps'],
    movementPattern: 'horizontal_push',
    targetMuscleGroup: 'mid_chest',
    exerciseRole: 'primary',
    sets: 3,
    targetReps: 8,
    targetWeight: 135,
    targetRir: 2,
    rirLabel: 'RIR 2',
    isBodyweight: false,
    tempo: '2-0-1-0',
    restSeconds: 120,
    rationale: '',
    adjustments: [],
    isDeload: false,
    isCardio: false,
    cardioDurationSeconds: null,
    cardioSpeed: null,
    cardioIncline: null,
    cardioSpeedLabel: null,
    targetHrZone: null,
    targetHrBpmRange: null,
    warmupSets: null,
    supersetGroupId: null,
    supersetType: null,
    rirRange: null,
    impactScore: 1,
    estimatedMinutes: 8,
    ...overrides,
  } as GeneratedExercise;
}

function makeWorkout(exercises: GeneratedExercise[], dur = 45): GeneratedWorkout {
  return {
    id: 'w', date: '', trainingGoal: 'maintain',
    estimatedDurationMinutes: dur,
    muscleGroupsFocused: [] as any, exercises, sessionRationale: '',
    recoveryStatus: '', adjustmentsSummary: [], deloadActive: false,
    decisionLog: [], muscleGroupDecisions: [], exerciseDecisions: [],
  } as GeneratedWorkout;
}

function makeDay(
  planDate: string,
  dayOfWeek: number,
  dayName: string,
  opts: Partial<WeeklyPlanDay> = {}
): WeeklyPlanDay {
  return {
    planDate,
    dayOfWeek,
    dayName,
    isRestDay: false,
    focus: '',
    muscleGroups: [],
    plannedWorkout: makeWorkout([makeExercise()]),
    estimatedExercises: 1,
    estimatedMinutes: 45,
    ...opts,
  } as WeeklyPlanDay;
}

function makePlan(days: WeeklyPlanDay[]): WeeklyPlan {
  return { weekStartDate: days[0]?.planDate ?? '', featureSnapshotId: '', days } as WeeklyPlan;
}

const CHEST_THEME: DayTheme = {
  primary: 'mid_chest',
  allowedAccessories: ['triceps', 'anterior_deltoid', 'core'],
  source: 'schedule',
};
const BACK_THEME: DayTheme = {
  primary: 'back_lats',
  allowedAccessories: ['biceps', 'posterior_deltoid', 'core'],
  source: 'schedule',
};
const LEGS_THEME: DayTheme = {
  primary: 'quadriceps',
  allowedAccessories: ['hamstrings', 'glutes', 'calves'],
  source: 'schedule',
};

// ─────────────────────────────────────────────────────────────────────────
// detectMissedDays
// ─────────────────────────────────────────────────────────────────────────

test('detectMissedDays: a past, planned, non-rest, non-completed day is missed', () => {
  const plan = makePlan([
    makeDay('2026-04-25', 6, 'Saturday', { dayTheme: CHEST_THEME }), // past
    makeDay('2026-04-26', 0, 'Sunday', { isRestDay: true }),
    makeDay('2026-04-27', 1, 'Monday', { dayTheme: BACK_THEME }),    // today
  ]);
  const missed = detectMissedDays(plan, '2026-04-27');
  assert.equal(missed.length, 1);
  assert.equal(missed[0].planDate, '2026-04-25');
});

test('detectMissedDays: completed days are NOT missed even if past', () => {
  const plan = makePlan([
    makeDay('2026-04-25', 6, 'Saturday', { dayStatus: 'completed' }),
  ]);
  assert.equal(detectMissedDays(plan, '2026-04-27').length, 0);
});

test('detectMissedDays: rest days are NEVER missed', () => {
  const plan = makePlan([
    makeDay('2026-04-25', 6, 'Saturday', { isRestDay: true, plannedWorkout: null }),
  ]);
  assert.equal(detectMissedDays(plan, '2026-04-27').length, 0);
});

test('detectMissedDays: explicit dayStatus=skipped is missed regardless of date', () => {
  const plan = makePlan([
    makeDay('2026-04-30', 4, 'Thursday', { dayStatus: 'skipped', dayTheme: CHEST_THEME }),
  ]);
  assert.equal(detectMissedDays(plan, '2026-04-27').length, 1);
});

test('detectMissedDays: future days are not missed', () => {
  const plan = makePlan([
    makeDay('2026-04-30', 4, 'Thursday', { dayTheme: CHEST_THEME }),
  ]);
  assert.equal(detectMissedDays(plan, '2026-04-27').length, 0);
});

// ─────────────────────────────────────────────────────────────────────────
// proposeRedistributions — viability and ranking
// ─────────────────────────────────────────────────────────────────────────

test('proposeRedistributions: missed chest day with future chest day → augment that day', () => {
  // Past: Mon (chest, missed). Future: Tue (back), Wed (chest), Thu (legs).
  const plan = makePlan([
    makeDay('2026-04-20', 1, 'Monday', { dayTheme: CHEST_THEME }), // missed
    makeDay('2026-04-21', 2, 'Tuesday', { dayTheme: BACK_THEME }),
    makeDay('2026-04-22', 3, 'Wednesday', { dayTheme: CHEST_THEME }),
    makeDay('2026-04-23', 4, 'Thursday', { dayTheme: LEGS_THEME }),
  ]);
  const proposals = proposeRedistributions({ plan, todayLocal: '2026-04-21' });
  assert.equal(proposals.length, 1);
  const p = proposals[0];
  assert.equal(p.suggestedAction.kind, 'augment');
  if (p.suggestedAction.kind === 'augment') {
    assert.equal(p.suggestedAction.targetDate, '2026-04-22');
    assert.equal(p.suggestedAction.primaryMuscle, 'mid_chest');
    assert.ok(p.suggestedAction.addSets >= 2 && p.suggestedAction.addSets <= 3);
  }
  // Top candidate must be Wednesday
  assert.equal(p.candidates[0].planDate, '2026-04-22');
});

test('proposeRedistributions: no viable day when no future day allows the missed primary', () => {
  // Past: Mon (chest, missed). Future: Tue (legs only, no chest in accessories).
  const plan = makePlan([
    makeDay('2026-04-20', 1, 'Monday', { dayTheme: CHEST_THEME }), // missed
    makeDay('2026-04-21', 2, 'Tuesday', { dayTheme: LEGS_THEME }), // legs accessories don't include chest family
  ]);
  const proposals = proposeRedistributions({ plan, todayLocal: '2026-04-21' });
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].suggestedAction.kind, 'no_viable_day');
  assert.equal(proposals[0].candidates.length, 0);
});

test('proposeRedistributions: recovery distance ranks well-spaced days higher', () => {
  // Two equally compatible chest days. The earlier one is also adjacent to
  // another chest day (Sat) → recovery_dist suffers → later candidate wins.
  const plan = makePlan([
    makeDay('2026-04-20', 1, 'Monday', { dayTheme: CHEST_THEME }), // missed
    makeDay('2026-04-21', 2, 'Tuesday', { dayTheme: CHEST_THEME }), // adjacent to Wed below
    makeDay('2026-04-22', 3, 'Wednesday', { dayTheme: CHEST_THEME }),
    makeDay('2026-04-25', 6, 'Saturday', { dayTheme: CHEST_THEME }),
  ]);
  const proposals = proposeRedistributions({ plan, todayLocal: '2026-04-21' });
  // The pre-existing chest density makes ALL future days score similarly on
  // theme_compat; recovery_dist is what breaks the tie. Saturday is farthest
  // from another chest day in this artificial set.
  const top = proposals[0].candidates[0];
  // Saturday should out-rank Tuesday (which is back-to-back with Wed chest).
  const tueScore = proposals[0].candidates.find(c => c.planDate === '2026-04-21')?.score ?? -1;
  const satScore = proposals[0].candidates.find(c => c.planDate === '2026-04-25')?.score ?? -1;
  assert.ok(satScore >= tueScore, `saturday (${satScore}) should outrank tuesday (${tueScore})`);
  assert.ok(top, 'expected at least one candidate');
});

test('proposeRedistributions: empty plan → empty proposals', () => {
  assert.deepEqual(proposeRedistributions({ plan: makePlan([]), todayLocal: '2026-04-27' }), []);
});

// ─────────────────────────────────────────────────────────────────────────
// applyRedistribution
// ─────────────────────────────────────────────────────────────────────────

test('applyRedistribution: bumps the matching exercise on the target day', () => {
  const targetDay = makeDay('2026-04-22', 3, 'Wednesday', {
    dayTheme: CHEST_THEME,
    plannedWorkout: makeWorkout([
      makeExercise({ exerciseName: 'Incline Press', sets: 3, targetMuscleGroup: 'mid_chest' }),
    ]),
  });
  const plan = makePlan([
    makeDay('2026-04-20', 1, 'Monday', { dayTheme: CHEST_THEME }),
    targetDay,
  ]);
  const result = applyRedistribution(plan, {
    kind: 'augment',
    targetDate: '2026-04-22',
    primaryMuscle: 'mid_chest',
    addSets: 2,
  });
  assert.equal(result.applied, true);
  assert.equal(result.modified.length, 1);
  assert.equal(result.modified[0].newSets, 5);
  // Source day untouched (immutability)
  assert.equal(plan.days[1].plannedWorkout!.exercises[0].sets, 3, 'original plan must not mutate');
});

test('applyRedistribution: no-op when target day has no matching muscle exercise', () => {
  const targetDay = makeDay('2026-04-22', 3, 'Wednesday', {
    dayTheme: LEGS_THEME,
    plannedWorkout: makeWorkout([
      makeExercise({ exerciseName: 'Squat', targetMuscleGroup: 'quadriceps' }),
    ]),
  });
  const plan = makePlan([targetDay]);
  const result = applyRedistribution(plan, {
    kind: 'augment',
    targetDate: '2026-04-22',
    primaryMuscle: 'mid_chest',
    addSets: 3,
  });
  assert.equal(result.applied, false);
  assert.equal(result.modified.length, 0);
});

test('applyRedistribution: respects +2 per-exercise cap when distributing', () => {
  const targetDay = makeDay('2026-04-22', 3, 'Wednesday', {
    dayTheme: CHEST_THEME,
    plannedWorkout: makeWorkout([
      makeExercise({ exerciseName: 'Incline Press', sets: 3, targetMuscleGroup: 'mid_chest' }),
      makeExercise({ exerciseName: 'Cable Fly', sets: 2, targetMuscleGroup: 'mid_chest' }),
    ]),
  });
  const plan = makePlan([targetDay]);
  // Try to add an absurd 8 sets — implementation must spread, never put more
  // than +2 on any single exercise.
  const result = applyRedistribution(plan, {
    kind: 'augment',
    targetDate: '2026-04-22',
    primaryMuscle: 'mid_chest',
    addSets: 8,
  });
  assert.equal(result.applied, true);
  for (const m of result.modified) {
    assert.ok(m.newSets - m.oldSets <= 2, `bump exceeded +2 on ${m.exerciseName}: ${m.oldSets}→${m.newSets}`);
  }
});

test('applyRedistribution: target day is marked as adapted post-bump', () => {
  const targetDay = makeDay('2026-04-22', 3, 'Wednesday', {
    dayTheme: CHEST_THEME,
    dayStatus: 'planned',
    plannedWorkout: makeWorkout([
      makeExercise({ exerciseName: 'Incline Press', sets: 3, targetMuscleGroup: 'mid_chest' }),
    ]),
  });
  const plan = makePlan([targetDay]);
  const result = applyRedistribution(plan, {
    kind: 'augment',
    targetDate: '2026-04-22',
    primaryMuscle: 'mid_chest',
    addSets: 2,
  });
  assert.equal(result.applied, true);
  assert.equal(result.plan.days[0].dayStatus, 'adapted');
});
