/**
 * Unit tests for the workout invariant pipeline.
 *
 * Scope and intent
 *   These tests pin the *behavioural contract* of each invariant — what they
 *   flag, what they refuse to flag, and what their auto-fix does. They are
 *   intentionally thin on plumbing fixtures: each test constructs the
 *   minimum object shape the invariant cares about, and casts the rest
 *   through `as any` to avoid coupling to the full ~30-field
 *   `GeneratedExercise` / `GeneratedWorkout` types. If you find yourself
 *   needing many fields here, the invariant is reading too much context.
 *
 * What we are NOT testing
 *   - End-to-end engine behaviour (covered by the visual/integration tests).
 *   - That the invariants are *registered* in DEFAULT_WORKOUT_INVARIANTS —
 *     trivial smoke test added at the bottom for completeness.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  themeCoherenceInvariant,
  singleExerciseVolumeCapInvariant,
  compoundBeforeIsolationInvariant,
  repLoadVs1RMInvariant,
  weeklyCardioInvariant,
  physiqueDeficitPriorityInvariant,
  dailyAbsInvariant,
  runInvariantPipeline,
  DEFAULT_WORKOUT_INVARIANTS,
  type WorkoutInvariantContext,
} from '../../src/lib/workoutInvariants';
import { DEFAULT_MODEL_CONFIG } from '../../src/lib/modelConfig';
import {
  deriveDayTheme,
  type GeneratedExercise,
  type GeneratedWorkout,
  type DayTheme,
} from '../../src/lib/workoutEngine';
import type { TrainingProfile } from '../../src/lib/trainingAnalysis';

// ─────────────────────────────────────────────────────────────────────────
// Fixture builders — keep the test bodies focused on assertions.
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
    rationale: 'test',
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

function makeCardio(overrides: Partial<GeneratedExercise> = {}): GeneratedExercise {
  return makeExercise({
    exerciseName: 'Treadmill',
    exerciseLibraryId: 'ex_tread',
    bodyPart: 'cardio',
    primaryMuscles: [],
    secondaryMuscles: [],
    movementPattern: 'cardio',
    targetMuscleGroup: 'cardio' as any,
    exerciseRole: 'isolation',
    sets: 1,
    targetReps: 0,
    targetWeight: null,
    targetRir: null,
    isCardio: true,
    cardioDurationSeconds: 1200,
    estimatedMinutes: 20,
    ...overrides,
  });
}

function makeWorkout(exercises: GeneratedExercise[]): GeneratedWorkout {
  return {
    id: 'w_test',
    date: '2026-04-27',
    trainingGoal: 'maintain',
    estimatedDurationMinutes: exercises.reduce((s, e) => s + e.estimatedMinutes, 0),
    muscleGroupsFocused: ['mid_chest'] as any,
    exercises,
    sessionRationale: '',
    recoveryStatus: 'fresh',
    adjustmentsSummary: [],
    deloadActive: false,
    decisionLog: [],
    muscleGroupDecisions: [],
    exerciseDecisions: [],
  } as GeneratedWorkout;
}

function makeProfile(overrides: Partial<TrainingProfile> = {}): TrainingProfile {
  return {
    exerciseProgressions: [],
    exercisePreferences: [],
    bodyWeightTrend: { phase: 'maintain' as any },
    muscleGroupFrequency: {},
    muscleVolumeStatuses: [],
    ...overrides,
  } as unknown as TrainingProfile;
}

function makeCtx(overrides: Partial<WorkoutInvariantContext> = {}): WorkoutInvariantContext {
  return {
    profile: makeProfile(),
    preferences: {} as any,
    cfg: DEFAULT_MODEL_CONFIG,
    bodyAssessment: null,
    dayTheme: null,
    weeklyCardio: null,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// repLoadVs1RMInvariant — the safety-critical one. The user's exact
// complaint was "11 reps at 1RM weight"; this test pins that case.
// ─────────────────────────────────────────────────────────────────────────

test('repLoadVs1RM: flags 11 reps at 1RM weight (user-reported failure mode)', () => {
  const ex = makeExercise({
    exerciseName: 'Bench Press',
    targetWeight: 200, // claimed 1RM
    targetReps: 11,
    targetRir: 2,
  });
  const workout = makeWorkout([ex]);
  const ctx = makeCtx({
    profile: makeProfile({
      exerciseProgressions: [{ exerciseName: 'bench press', estimated1RM: 200 } as any],
    }),
  });
  const violations = repLoadVs1RMInvariant.check(workout, ctx);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].severity, 'error');
  assert.match(violations[0].message, /exceeds safe ceiling/);
});

test('repLoadVs1RM: clamp brings the prescribed weight under the safe ceiling', () => {
  const ex = makeExercise({
    exerciseName: 'Bench Press',
    targetWeight: 200,
    targetReps: 11,
    targetRir: 2,
  });
  const workout = makeWorkout([ex]);
  const ctx = makeCtx({
    profile: makeProfile({
      exerciseProgressions: [{ exerciseName: 'bench press', estimated1RM: 200 } as any],
    }),
  });
  const violations = repLoadVs1RMInvariant.check(workout, ctx);
  const fix = repLoadVs1RMInvariant.autoFix!(workout, violations, ctx);
  assert.ok(fix.modifiedWorkout, 'autoFix should return a modified workout');
  const newWeight = fix.modifiedWorkout!.exercises[0].targetWeight!;
  // Re-running the check on the fixed workout MUST pass.
  const after = repLoadVs1RMInvariant.check(fix.modifiedWorkout!, ctx);
  assert.equal(after.length, 0, `clamp insufficient: weight ${newWeight} still violates`);
  assert.ok(newWeight < 200, `weight should drop below 200 (got ${newWeight})`);
});

test('repLoadVs1RM: no flag when weight × reps is well within capacity', () => {
  const ex = makeExercise({
    targetWeight: 135, // 67% of 1RM at 8 reps is comfortable
    targetReps: 8,
    targetRir: 2,
  });
  const workout = makeWorkout([ex]);
  const ctx = makeCtx({
    profile: makeProfile({
      exerciseProgressions: [{ exerciseName: 'bench press', estimated1RM: 200 } as any],
    }),
  });
  assert.equal(repLoadVs1RMInvariant.check(workout, ctx).length, 0);
});

test('repLoadVs1RM: bodyweight and cardio are exempt', () => {
  const bw = makeExercise({
    isBodyweight: true,
    targetWeight: null,
    targetReps: 20,
    exerciseName: 'Push-up',
  });
  const cardio = makeCardio();
  const workout = makeWorkout([bw, cardio]);
  const ctx = makeCtx({
    profile: makeProfile({
      exerciseProgressions: [{ exerciseName: 'push-up', estimated1RM: 200 } as any],
    }),
  });
  assert.equal(repLoadVs1RMInvariant.check(workout, ctx).length, 0);
});

test('repLoadVs1RM: missing 1RM data is treated as no-op (cannot judge safety)', () => {
  const ex = makeExercise({ targetWeight: 999, targetReps: 5, targetRir: 0 });
  const workout = makeWorkout([ex]);
  const ctx = makeCtx({ profile: makeProfile() });
  assert.equal(repLoadVs1RMInvariant.check(workout, ctx).length, 0);
});

test('repLoadVs1RM: null RIR is treated as 0 (most conservative)', () => {
  // weight at 90% of e1RM with reps=10 and RIR=null → ceiling assumes RIR=0
  // → ceiling = 0.93 × 200 / (1 + 10/30) = 0.93 × 200 / 1.333 = ~139.5
  // Prescribed 180 must flag.
  const ex = makeExercise({
    targetWeight: 180,
    targetReps: 10,
    targetRir: null,
  });
  const workout = makeWorkout([ex]);
  const ctx = makeCtx({
    profile: makeProfile({
      exerciseProgressions: [{ exerciseName: 'bench press', estimated1RM: 200 } as any],
    }),
  });
  const violations = repLoadVs1RMInvariant.check(workout, ctx);
  assert.equal(violations.length, 1);
});

// ─────────────────────────────────────────────────────────────────────────
// themeCoherenceInvariant — the "Monday is chest day" complaint
// ─────────────────────────────────────────────────────────────────────────

test('themeCoherence: drops out-of-theme exercises when source=schedule (error)', () => {
  const chest = makeExercise({ exerciseName: 'Bench Press', targetMuscleGroup: 'mid_chest' });
  const legs = makeExercise({ exerciseName: 'Squat', targetMuscleGroup: 'quadriceps' });
  const workout = makeWorkout([chest, legs]);
  const theme: DayTheme = {
    primary: 'mid_chest',
    allowedAccessories: ['triceps', 'anterior_deltoid', 'core'],
    source: 'schedule',
  };
  const ctx = makeCtx({ dayTheme: theme });

  const violations = themeCoherenceInvariant.check(workout, ctx);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].severity, 'error');

  const fix = themeCoherenceInvariant.autoFix!(workout, violations, ctx);
  assert.ok(fix.modifiedWorkout);
  const remaining = fix.modifiedWorkout!.exercises.map(e => e.exerciseName);
  assert.deepEqual(remaining, ['Bench Press']);
});

// Regression: the monthly fitness focus is a hard user contract
// ("layer this muscle into every workout, no matter what"). The contract
// is now expressed via the per-exercise `isUndroppable` flag set at
// selection time (centralised replacement for the muscle-group-specific
// carve-out we used to need across three drop sites).
test('themeCoherence: preserves any isUndroppable exercise even when off-theme', () => {
  const chest = makeExercise({ exerciseName: 'Bench Press', targetMuscleGroup: 'mid_chest' });
  const focusBiceps = makeExercise({
    exerciseName: 'Bicep Curl',
    targetMuscleGroup: 'biceps',
    exerciseRole: 'isolation',
    sets: 2,
    // Biceps is the user's monthly fitness focus; the engine marked the
    // layered slot as undroppable at selection time.
    isUndroppable: true,
    undroppableReason: 'monthly_focus',
  });
  const workout = makeWorkout([chest, focusBiceps]);
  const theme: DayTheme = {
    primary: 'mid_chest',
    // Biceps is deliberately NOT in the schedule's accessories.
    allowedAccessories: ['triceps', 'anterior_deltoid', 'core'],
    source: 'schedule',
  };

  // Baseline: same workout without the flag would still drop biceps.
  const unflagged: GeneratedExercise = { ...focusBiceps, isUndroppable: false };
  const baselineViolations = themeCoherenceInvariant.check(makeWorkout([chest, unflagged]), makeCtx({ dayTheme: theme }));
  assert.equal(baselineViolations.length, 1, 'sanity: theme guard would drop unflagged off-theme biceps');

  // With the flag set, the theme guard must skip biceps.
  const flaggedViolations = themeCoherenceInvariant.check(workout, makeCtx({ dayTheme: theme }));
  assert.equal(flaggedViolations.length, 0, 'isUndroppable exercises must be exempt from theme guard');
});

// Defense in depth: the flag is exercise-scoped, not group-scoped. A
// flagged biceps exercise does NOT also whitelist OTHER off-theme
// exercises that happen to share its target muscle group.
test('themeCoherence: undroppable flag is per-exercise, not group-wide', () => {
  const chest = makeExercise({ exerciseName: 'Bench Press', targetMuscleGroup: 'mid_chest' });
  const focusBiceps = makeExercise({
    exerciseName: 'Bicep Curl',
    targetMuscleGroup: 'biceps',
    isUndroppable: true,
  });
  const offTheme = makeExercise({
    exerciseName: 'Lat Pulldown',
    targetMuscleGroup: 'back_lats',
    isUndroppable: false,
  });
  const workout = makeWorkout([chest, focusBiceps, offTheme]);
  const theme: DayTheme = {
    primary: 'mid_chest',
    allowedAccessories: ['triceps', 'anterior_deltoid', 'core'],
    source: 'schedule',
  };
  const ctx = makeCtx({ dayTheme: theme });

  const violations = themeCoherenceInvariant.check(workout, ctx);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].severity, 'error');
  assert.match(violations[0].message, /Lat Pulldown/);
});

test('themeCoherence: drops out-of-theme exercises when source=rotation (error)', () => {
  const chest = makeExercise({ exerciseName: 'Bench Press', targetMuscleGroup: 'mid_chest' });
  const legs = makeExercise({ exerciseName: 'Squat', targetMuscleGroup: 'quadriceps' });
  const workout = makeWorkout([chest, legs]);
  const theme: DayTheme = {
    primary: 'mid_chest',
    allowedAccessories: ['triceps'],
    source: 'rotation',
  };
  const ctx = makeCtx({ dayTheme: theme });

  const violations = themeCoherenceInvariant.check(workout, ctx);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].severity, 'error');
  const fix = themeCoherenceInvariant.autoFix!(workout, violations, ctx);
  assert.ok(fix.modifiedWorkout);
  assert.deepEqual(
    fix.modifiedWorkout!.exercises.map(e => e.exerciseName),
    ['Bench Press'],
  );
});

test('themeCoherence: no theme provided → invariant is a no-op', () => {
  const workout = makeWorkout([makeExercise({ targetMuscleGroup: 'biceps' })]);
  const ctx = makeCtx({ dayTheme: null });
  assert.equal(themeCoherenceInvariant.check(workout, ctx).length, 0);
});

// ─────────────────────────────────────────────────────────────────────────
// singleExerciseVolumeCapInvariant
// ─────────────────────────────────────────────────────────────────────────

test('singleExerciseVolumeCap: flags an exercise above 40% of total sets', () => {
  // total = 10, single = 6 → 60% → flag, cap to 4 (40% of 10)
  const heavy = makeExercise({ exerciseName: 'Squat', sets: 6 });
  const light = makeExercise({ exerciseName: 'Lunge', sets: 4 });
  const workout = makeWorkout([heavy, light]);
  const v = singleExerciseVolumeCapInvariant.check(workout, makeCtx());
  assert.equal(v.length, 1);
  assert.equal(v[0].severity, 'error');
  const fix = singleExerciseVolumeCapInvariant.autoFix!(workout, v, makeCtx());
  assert.ok(fix.modifiedWorkout);
  assert.equal(fix.modifiedWorkout!.exercises[0].sets, 4);
});

test('singleExerciseVolumeCap: does not bite trivially small days (sets ≤ 3)', () => {
  // total = 4, single = 3 → 75% but sets ≤ 3 → exempt
  const a = makeExercise({ exerciseName: 'A', sets: 3 });
  const b = makeExercise({ exerciseName: 'B', sets: 1 });
  const workout = makeWorkout([a, b]);
  assert.equal(singleExerciseVolumeCapInvariant.check(workout, makeCtx()).length, 0);
});

// ─────────────────────────────────────────────────────────────────────────
// compoundBeforeIsolationInvariant
// ─────────────────────────────────────────────────────────────────────────

test('compoundBeforeIsolation: flags isolation appearing before compound, then re-orders', () => {
  const curl = makeExercise({
    exerciseName: 'Bicep Curl',
    movementPattern: 'isolation',
    targetMuscleGroup: 'biceps',
  });
  const bench = makeExercise({
    exerciseName: 'Bench Press',
    movementPattern: 'horizontal_push',
  });
  const workout = makeWorkout([curl, bench]); // wrong order
  const v = compoundBeforeIsolationInvariant.check(workout, makeCtx());
  assert.equal(v.length, 1);
  const fix = compoundBeforeIsolationInvariant.autoFix!(workout, v, makeCtx());
  assert.ok(fix.modifiedWorkout);
  const order = fix.modifiedWorkout!.exercises.map(e => e.exerciseName);
  assert.deepEqual(order, ['Bench Press', 'Bicep Curl']);
});

test('compoundBeforeIsolation: cardio is appended after the strength block', () => {
  const curl = makeExercise({
    exerciseName: 'Bicep Curl',
    movementPattern: 'isolation',
    targetMuscleGroup: 'biceps',
  });
  const cardio = makeCardio();
  const bench = makeExercise({
    exerciseName: 'Bench Press',
    movementPattern: 'horizontal_push',
  });
  const workout = makeWorkout([cardio, curl, bench]);
  const v = compoundBeforeIsolationInvariant.check(workout, makeCtx());
  // Cardio is excluded from the strength check; curl-before-bench is the violation.
  assert.equal(v.length, 1);
  const fix = compoundBeforeIsolationInvariant.autoFix!(workout, v, makeCtx());
  const order = fix.modifiedWorkout!.exercises.map(e => e.exerciseName);
  assert.deepEqual(order, ['Bench Press', 'Bicep Curl', 'Treadmill']);
});

// ─────────────────────────────────────────────────────────────────────────
// weeklyCardioInvariant — informational only
// ─────────────────────────────────────────────────────────────────────────

test('weeklyCardio: warns when policy requires cardio but none present', () => {
  const workout = makeWorkout([makeExercise()]);
  const ctx = makeCtx({
    weeklyCardio: { cardioRequiredToday: true, dayIsTrainingDay: true } as any,
  });
  const v = weeklyCardioInvariant.check(workout, ctx);
  assert.equal(v.length, 1);
  assert.equal(v[0].severity, 'warning');
});

test('weeklyCardio: silent when cardio is present', () => {
  const workout = makeWorkout([makeExercise(), makeCardio()]);
  const ctx = makeCtx({
    weeklyCardio: { cardioRequiredToday: true, dayIsTrainingDay: true } as any,
  });
  assert.equal(weeklyCardioInvariant.check(workout, ctx).length, 0);
});

// ─────────────────────────────────────────────────────────────────────────
// physiqueDeficitPriorityInvariant
// ─────────────────────────────────────────────────────────────────────────

test('physiqueDeficit: warns when chest is a deficit and chest day has <2 sets', () => {
  const lightChest = makeExercise({ exerciseName: 'Push-up', sets: 1, targetMuscleGroup: 'mid_chest' });
  const workout = makeWorkout([lightChest]);
  const ctx = makeCtx({
    bodyAssessment: { proportional_deficits: { mid_chest: -0.18 } } as any,
    dayTheme: { primary: 'mid_chest', allowedAccessories: [], source: 'schedule' },
  });
  const v = physiqueDeficitPriorityInvariant.check(workout, ctx);
  assert.equal(v.length, 1);
  assert.equal(v[0].severity, 'warning');
});

test('physiqueDeficit: silent when no body assessment is provided', () => {
  const workout = makeWorkout([makeExercise()]);
  const ctx = makeCtx({ bodyAssessment: null });
  assert.equal(physiqueDeficitPriorityInvariant.check(workout, ctx).length, 0);
});

// ─────────────────────────────────────────────────────────────────────────
// runInvariantPipeline — smoke test on the integration
// ─────────────────────────────────────────────────────────────────────────

test('pipeline: applies fixes from multiple invariants in one call', () => {
  // Out-of-theme exercise + over-volume exercise + bad order, all in one workout.
  const curl = makeExercise({
    exerciseName: 'Bicep Curl', movementPattern: 'isolation', targetMuscleGroup: 'biceps', sets: 2,
  });
  const heavyBench = makeExercise({
    exerciseName: 'Bench Press', movementPattern: 'horizontal_push', targetMuscleGroup: 'mid_chest', sets: 8,
  });
  const otherLegs = makeExercise({
    exerciseName: 'Squat', movementPattern: 'squat', targetMuscleGroup: 'quadriceps', sets: 4,
  });
  const workout = makeWorkout([curl, heavyBench, otherLegs]);
  const theme: DayTheme = {
    primary: 'mid_chest',
    allowedAccessories: ['triceps', 'anterior_deltoid'],
    source: 'schedule',
  };
  const ctx = makeCtx({ dayTheme: theme });

  const result = runInvariantPipeline(workout, ctx, DEFAULT_WORKOUT_INVARIANTS);
  // Squat dropped (theme violation), curl dropped (theme violation: biceps not allowed)
  assert.deepEqual(
    result.workout.exercises.map(e => e.exerciseName).sort(),
    ['Bench Press']
  );
  assert.ok(result.notes.length >= 1, 'pipeline should accumulate at least one note');
});

test('pipeline: terminates within maxPasses even with cascading fixes', () => {
  const heavyBench = makeExercise({
    exerciseName: 'Bench Press', sets: 9, targetMuscleGroup: 'mid_chest',
  });
  const light = makeExercise({
    exerciseName: 'Cable Fly', sets: 2, targetMuscleGroup: 'mid_chest',
  });
  const workout = makeWorkout([heavyBench, light]);
  const result = runInvariantPipeline(workout, makeCtx(), DEFAULT_WORKOUT_INVARIANTS, 3);
  assert.ok(result.passesUsed <= 3);
  assert.ok(Array.isArray(result.violations));
});

test('DEFAULT_WORKOUT_INVARIANTS exposes all seven concrete invariants by id', () => {
  const ids = DEFAULT_WORKOUT_INVARIANTS.map(i => i.id).sort();
  assert.deepEqual(ids, [
    'compound_before_isolation_order',
    'daily_abs',
    'physique_deficit_priority',
    'rep_load_vs_1rm',
    'single_exercise_volume_cap',
    'theme_coherence',
    'weekly_cardio_coverage',
  ]);
});

// ─────────────────────────────────────────────────────────────────────────
// dailyAbs — user policy: "always do one ab exercise minimum to keep
// myself honest". Enforced across all phases (cut/bulk/maintain).
// ─────────────────────────────────────────────────────────────────────────

test('dailyAbs: warns on any day with no core exercise (cut)', () => {
  const benchOnly = makeWorkout([makeExercise({ targetMuscleGroup: 'mid_chest' })]);
  const ctx = makeCtx({
    profile: makeProfile({ bodyWeightTrend: { phase: 'cutting' } as any }),
    preferences: { training_goal: 'cut' } as any,
  });
  const v = dailyAbsInvariant.check(benchOnly, ctx);
  assert.equal(v.length, 1);
  assert.equal(v[0].severity, 'warning');
});

test('dailyAbs: warns on bulk too (policy is phase-agnostic)', () => {
  const benchOnly = makeWorkout([makeExercise({ targetMuscleGroup: 'mid_chest' })]);
  const ctx = makeCtx({
    profile: makeProfile({ bodyWeightTrend: { phase: 'bulking' } as any }),
    preferences: { training_goal: 'bulk' } as any,
  });
  assert.equal(dailyAbsInvariant.check(benchOnly, ctx).length, 1,
    'bulk day with no abs should still warn — policy is "always one ab exercise"');
});

test('dailyAbs: warns on maintain too', () => {
  const benchOnly = makeWorkout([makeExercise({ targetMuscleGroup: 'mid_chest' })]);
  const ctx = makeCtx({
    profile: makeProfile({ bodyWeightTrend: { phase: 'maintain' } as any }),
    preferences: { training_goal: 'maintain' } as any,
  });
  assert.equal(dailyAbsInvariant.check(benchOnly, ctx).length, 1);
});

test('dailyAbs: silent when a core exercise is present (any phase)', () => {
  const withAbs = makeWorkout([
    makeExercise({ targetMuscleGroup: 'mid_chest' }),
    makeExercise({ exerciseName: 'Plank', targetMuscleGroup: 'core' as any }),
  ]);
  for (const phase of ['cutting', 'bulking', 'maintain'] as const) {
    const ctx = makeCtx({
      profile: makeProfile({ bodyWeightTrend: { phase } as any }),
      preferences: { training_goal: phase === 'cutting' ? 'cut' : phase === 'bulking' ? 'bulk' : 'maintain' } as any,
    });
    assert.equal(dailyAbsInvariant.check(withAbs, ctx).length, 0,
      `phase=${phase}: ab present should silence the invariant`);
  }
});

test('dailyAbs: cardio does not satisfy the requirement (must be direct ab work)', () => {
  const withCardio = makeWorkout([makeExercise(), makeCardio()]);
  const ctx = makeCtx({
    profile: makeProfile({ bodyWeightTrend: { phase: 'cutting' } as any }),
    preferences: { training_goal: 'cut' } as any,
  });
  assert.equal(dailyAbsInvariant.check(withCardio, ctx).length, 1,
    'cardio should not be counted as ab work');
});

// ─────────────────────────────────────────────────────────────────────────
// deriveDayTheme — user complaint: "the week ahead has one day that's all abs"
// ─────────────────────────────────────────────────────────────────────────

test('deriveDayTheme: refuses to make core/abs the primary focus', () => {
  // A schedule entry that lists ONLY core → must return null so the planner
  // falls through to its rotation/detected-pattern fallback and picks a
  // real strength primary instead of an "abs day".
  const t = deriveDayTheme('Abs', ['core'], 'schedule');
  assert.equal(t, null, 'core-only schedule should produce no theme — was producing "abs day"');
});

test('deriveDayTheme: demotes core to accessory when other muscles are present', () => {
  // If the schedule lists ['core', 'mid_chest'] (core first), we still
  // want the chest as the day's identity, not the abs.
  const t = deriveDayTheme('Mixed', ['core', 'mid_chest'], 'schedule');
  assert.ok(t);
  assert.equal(t!.primary, 'mid_chest', 'primary should be promoted past core');
  assert.ok(t!.allowedAccessories.includes('core'), 'core should remain as an accessory');
});

test('deriveDayTheme: refuses calves-only and cardio-only days too', () => {
  assert.equal(deriveDayTheme('Calves', ['calves'], 'schedule'), null);
  assert.equal(deriveDayTheme('Cardio', ['cardio'], 'schedule'), null);
});

test('deriveDayTheme: a normal chest day still works', () => {
  const t = deriveDayTheme('Chest', ['mid_chest', 'upper_chest'], 'schedule');
  assert.ok(t);
  assert.equal(t!.primary, 'mid_chest');
});

// Label-driven primary picking (#6). Without this, the primary was just
// `groups[0]`, which depends on the order the user happened to add muscles
// in the Profile editor. Now the user's label is the source of truth.
test('deriveDayTheme: focus label "Chest / Triceps" overrides groups[0] = traps', () => {
  const t = deriveDayTheme(
    'Chest / Triceps',
    ['upper_traps', 'mid_chest', 'triceps', 'core'],
    'schedule',
  );
  assert.ok(t);
  // Without label parsing this would be `upper_traps`. With it, the
  // user's stated intent ("Chest") wins.
  assert.equal(t!.primary, 'mid_chest');
});

test('deriveDayTheme: family synonyms — "Legs" picks quads', () => {
  const t = deriveDayTheme(
    'Legs',
    ['glutes', 'quadriceps', 'hamstrings', 'core'],
    'schedule',
  );
  assert.ok(t);
  assert.equal(t!.primary, 'quadriceps');
});

test('deriveDayTheme: "Push" maps to push family from rotation source', () => {
  const t = deriveDayTheme(
    'Push',
    ['triceps', 'mid_chest', 'anterior_deltoid'],
    'rotation',
  );
  assert.ok(t);
  assert.equal(t!.primary, 'mid_chest');
});

test('deriveDayTheme: unmatched label falls back to first eligible group', () => {
  // No tokens in label resolve to anything in eligible — prove the
  // fallback didn't change.
  const t = deriveDayTheme(
    'Custom Workout',
    ['back_lats', 'biceps'],
    'schedule',
  );
  assert.ok(t);
  assert.equal(t!.primary, 'back_lats');
});

test('deriveDayTheme: direct canonical token in label takes priority', () => {
  // "posterior_deltoid emphasis" should pin posterior_deltoid even though
  // "delts" family would otherwise prefer lateral first.
  const t = deriveDayTheme(
    'posterior_deltoid emphasis',
    ['lateral_deltoid', 'posterior_deltoid', 'mid_chest'],
    'schedule',
  );
  assert.ok(t);
  assert.equal(t!.primary, 'posterior_deltoid');
});
