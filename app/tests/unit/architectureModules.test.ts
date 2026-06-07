import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateExerciseExecutionDeltas,
  buildExerciseCapacity,
  buildExerciseCapacityIndex,
  capacityToWorkingWeight,
} from '../../src/lib/liftCapacity';
import { computePrescriptionController } from '../../src/lib/prescriptionController';
import { classifyProgressionStatus } from '../../src/lib/trainingAnalysis';
import { buildFocusWeeklyBudget, focusSetBudgetForDate } from '../../src/lib/focusVolumeBudget';
import {
  buildWeekPlanConstraints,
  hashConstraintsPayload,
  isWeeklyPlanDayStale,
} from '../../src/lib/weekPlanConstraints';
import { pickSwapReplacement } from '../../src/lib/surgicalSwap';
import type { TrainingProfile } from '../../src/lib/trainingAnalysis';
import type { GeneratedWorkout } from '../../src/lib/workoutEngine';
import { WORKOUT_ENGINE_VERSION } from '../../src/lib/modelConfig';

test('aggregateExerciseExecutionDeltas: positive weight deviation raises signal', () => {
  const deltas = aggregateExerciseExecutionDeltas([
    {
      exerciseName: 'Bench Press',
      prescribedWeight: 200,
      actualWeight: 220,
      prescribedReps: 8,
      actualReps: 8,
      completed: true,
    },
    {
      exerciseName: 'Bench Press',
      prescribedWeight: 200,
      actualWeight: 210,
      prescribedReps: 8,
      actualReps: 9,
      completed: true,
    },
  ]);
  assert.ok(deltas['bench press'].avgWeightDeviation > 0.04);
  assert.equal(deltas['bench press'].sampleSize, 2);
});

test('aggregateExerciseExecutionDeltas: shrinks a lone outlier toward zero', () => {
  const deltas = aggregateExerciseExecutionDeltas([
    { exerciseName: 'Outlier Lift', prescribedWeight: 100, actualWeight: 130, prescribedReps: 5, actualReps: 5, completed: true },
  ]);
  const d = deltas['outlier lift'];
  // Raw deviation is +0.30; with a k=1 zero-prior and n=1 it halves to +0.15,
  // so a single heroic session cannot fully move capacity.
  assert.ok(Math.abs(d.avgWeightDeviation - 0.15) < 1e-9, `got ${d.avgWeightDeviation}`);
  // One observation is worth exactly the zero-prior: reliability n/(n+k)=0.5.
  assert.ok((d.confidence ?? 1) <= 0.5, 'a single sample must not be high confidence');
});

test('aggregateExerciseExecutionDeltas: confidence rises with consistent evidence, falls with noise', () => {
  const consistent = aggregateExerciseExecutionDeltas(
    Array.from({ length: 6 }, () => ({
      exerciseName: 'Steady', prescribedWeight: 100, actualWeight: 110,
      prescribedReps: 5, actualReps: 5, completed: true,
    })),
  );
  const noisy = aggregateExerciseExecutionDeltas([
    { exerciseName: 'Jumpy', prescribedWeight: 100, actualWeight: 140, prescribedReps: 5, actualReps: 5, completed: true },
    { exerciseName: 'Jumpy', prescribedWeight: 100, actualWeight: 80, prescribedReps: 5, actualReps: 5, completed: true },
  ]);
  assert.ok((consistent['steady'].confidence ?? 0) > 0.7);
  assert.ok((consistent['steady'].confidence ?? 0) > (noisy['jumpy'].confidence ?? 1));
});

test('buildExerciseCapacity: low confidence pulls estimate toward demonstrated peak', () => {
  const delta = { avgWeightDeviation: 0.1, avgRepsDeviation: 0, sampleSize: 4, completionRate: 0.9, confidence: 0.6 };
  const progLow = {
    exerciseName: 'a', estimated1RM: 300, lastWeight: 225, lastReps: 5,
    bestSet: { weight: 225, reps: 5 }, status: 'progressing' as const,
    progressionSlope: 0.02, sessionsTracked: 3,
  };
  const progHigh = { ...progLow, sessionsTracked: 12 };
  const lowConf = buildExerciseCapacity('a', progLow, null, delta, 0, 0.8)!;
  const highConf = buildExerciseCapacity('a', progHigh, null, delta, 0, 0.8)!;
  // Demonstrated peak (Epley on 225×5 @ RIR1) ≈ 270 lb.
  assert.ok(lowConf.estimated1RM < highConf.estimated1RM, 'fewer sessions → more conservative');
  assert.ok(lowConf.estimated1RM >= 270, 'shrinkage never drops below demonstrated capacity');
});

test('classifyProgressionStatus: small noisy sample resists a regressing call', () => {
  const { status } = classifyProgressionStatus(-0.02, 3, 0.2);
  assert.notEqual(status, 'regressing');
});

test('classifyProgressionStatus: clean sustained decline is regressing', () => {
  assert.equal(classifyProgressionStatus(-0.03, 12, 0.95).status, 'regressing');
});

test('classifyProgressionStatus: strong clean uptrend progresses', () => {
  assert.equal(classifyProgressionStatus(0.03, 10, 0.9).status, 'progressing');
});

test('buildExerciseCapacity: execution boost raises e1RM when user lifts heavy', () => {
  const cap = buildExerciseCapacity(
    'squat',
    {
      exerciseName: 'squat',
      estimated1RM: 300,
      lastWeight: 225,
      lastReps: 5,
      bestSet: { weight: 225, reps: 5 },
      status: 'progressing',
      progressionSlope: 0.02,
      sessionsTracked: 6,
    },
    null,
    { avgWeightDeviation: 0.1, avgRepsDeviation: 1, sampleSize: 4, completionRate: 0.9 },
    0,
    0.8,
  );
  assert.ok(cap);
  assert.ok(cap!.estimated1RM > 300);
  assert.equal(cap!.source, 'execution_boost');
});

test('buildExerciseCapacityIndex merges profile signals', () => {
  const profile = {
    exerciseProgressions: [{
      exerciseName: 'deadlift',
      estimated1RM: 400,
      lastWeight: 315,
      lastReps: 5,
      bestSet: { weight: 315, reps: 5 },
      status: 'progressing',
      progressionSlope: 0.01,
      sessionsTracked: 8,
    }],
    exercisePreferences: [],
    prescribedVsActual: { avgWeightDeviation: 0, complianceRate: 0.7 },
    exerciseExecutionDeltas: {},
  } as unknown as TrainingProfile;
  const index = buildExerciseCapacityIndex(profile);
  assert.equal(index.get('deadlift')?.estimated1RM, 400);
});

test('capacityToWorkingWeight inverts Epley at RIR', () => {
  const w = capacityToWorkingWeight(300, 8, 2);
  assert.ok(w > 0 && w < 300);
});

test('computePrescriptionController: high execution deviation increases weight bias', () => {
  const profile = {
    canonicalModelContext: { objectiveUtility: 0.6 },
    fitnessFatigueModel: { readiness: 0.6 },
    prescribedVsActual: { complianceRate: 0.75, avgWeightDeviation: 0.12, avgRepsDeviation: 2 },
    exerciseProgressions: [],
  } as unknown as TrainingProfile;
  const out = computePrescriptionController(profile, { training_goal: 'maintain' } as never);
  assert.ok(out.weightBias > 1);
  assert.ok(out.rationale.some(r => r.includes('Execution above prescription')));
});

test('buildFocusWeeklyBudget allocates sets across training days', () => {
  const budget = buildFocusWeeklyBudget(
    { month: '2026-05', fitness_muscles: ['biceps'] },
    [
      { planDate: '2026-05-12', isRestDay: false, scheduledGroups: ['back_lats', 'biceps'] },
      { planDate: '2026-05-13', isRestDay: false, scheduledGroups: ['quadriceps'] },
      { planDate: '2026-05-14', isRestDay: true, scheduledGroups: [] },
    ],
  );
  assert.ok(budget);
  assert.equal(budget!.muscle, 'biceps');
  assert.ok(budget!.totalDirectSets >= 14);
  assert.ok((budget!.allocatedByDate['2026-05-12'] ?? 0) > (budget!.allocatedByDate['2026-05-13'] ?? 0));
});

test('focusSetBudgetForDate halves on split-guard days', () => {
  const budget = buildFocusWeeklyBudget(
    { month: '2026-05', fitness_muscles: ['biceps'] },
    [{ planDate: '2026-05-12', isRestDay: false, scheduledGroups: ['biceps'] }],
  );
  const raw = focusSetBudgetForDate(budget, '2026-05-12', false);
  const guarded = focusSetBudgetForDate(budget, '2026-05-12', true);
  assert.ok(guarded < raw);
});

test('week plan constraints hash changes when prefs drift', () => {
  const a = buildWeekPlanConstraints(
    { training_goal: 'cut', session_duration_minutes: 60, rest_days: [0], exercises_to_avoid: [] } as never,
    '2026-05-12',
    [0],
  );
  const b = buildWeekPlanConstraints(
    { training_goal: 'bulk', session_duration_minutes: 60, rest_days: [0], exercises_to_avoid: [] } as never,
    '2026-05-12',
    [0],
  );
  assert.notEqual(a.constraintsHash, b.constraintsHash);
  assert.equal(a.engineVersion, WORKOUT_ENGINE_VERSION);
  assert.equal(isWeeklyPlanDayStale(a.engineVersion, a.constraintsHash, b), true);
});

test('isWeeklyPlanDayStale: missing stored hash is stale', () => {
  const current = buildWeekPlanConstraints(
    { training_goal: 'maintain' } as never,
    '2026-05-12',
    [],
  );
  assert.equal(isWeeklyPlanDayStale(null, null, current), true);
});

test('pickSwapReplacement prefers substitution affinity', () => {
  const workout = {
    exercises: [{
      exerciseName: 'Barbell Curl',
      targetMuscleGroup: 'biceps',
      sets: 3,
      targetReps: 10,
    }],
  } as unknown as GeneratedWorkout;
  const profile = {
    substitutionAffinities: [{ fromExercise: 'barbell curl', toExercise: 'hammer curl', affinity: 20, eventCount: 5 }],
    exerciseAcceptances: [{ exerciseName: 'hammer curl', count: 3, lastDate: '2026-05-01', effectiveWeight: 5 }],
    exerciseSwapHistory: [],
  } as unknown as TrainingProfile;
  const library = [
    { id: '1', name: 'Hammer Curl', primary_muscles: ['biceps'], body_part: 'arms', ml_exercise_type: 'isolation' },
    { id: '2', name: 'Cable Curl', primary_muscles: ['biceps'], body_part: 'arms', ml_exercise_type: 'isolation' },
  ] as never;
  const { exercise, method } = pickSwapReplacement(workout.exercises[0], profile, library, workout);
  assert.equal(exercise?.name, 'Hammer Curl');
  assert.equal(method, 'affinity');
});

test('hashConstraintsPayload is stable for same payload', () => {
  const payload = {
    version: 1 as const,
    weekStartDate: '2026-05-12',
    trainingGoal: 'maintain',
    sessionDurationMinutes: 60,
    restDays: [0],
    preferredSplit: null,
    weeklySplitSchedule: null,
    monthlyFocusState: null,
    exercisesToAvoid: [],
    mesocycleWeek: null,
  };
  assert.equal(hashConstraintsPayload(payload), hashConstraintsPayload({ ...payload }));
});
