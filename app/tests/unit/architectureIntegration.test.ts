/**
 * Integration-style checks for the architectural modules — exercises
 * cross-module contracts that unit tests in isolation might miss.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateExerciseExecutionDeltas,
  buildExerciseCapacity,
  buildExerciseCapacityIndex,
  capacityToWorkingWeight,
} from '../../src/lib/liftCapacity';
import { computePrescriptionController } from '../../src/lib/prescriptionController';
import {
  buildFocusWeeklyBudget,
  focusSetBudgetForDate,
} from '../../src/lib/focusVolumeBudget';
import {
  buildWeekPlanConstraints,
  isWeeklyPlanDayStale,
} from '../../src/lib/weekPlanConstraints';
import {
  applySurgicalSwap,
  pickSwapReplacement,
} from '../../src/lib/surgicalSwap';
import type { TrainingProfile } from '../../src/lib/trainingAnalysis';
import type { GeneratedWorkout } from '../../src/lib/workoutEngine';
import { WORKOUT_ENGINE_VERSION } from '../../src/lib/modelConfig';

function baseProfile(overrides: Partial<TrainingProfile> = {}): TrainingProfile {
  return {
    userId: 'u1',
    computedAt: new Date().toISOString(),
    featureSnapshotId: 'snap1',
    canonicalModelContext: {
      version: '1',
      adherenceScore: 0.7,
      progressionScore: 0.6,
      sessionFitScore: 0.65,
      recoveryReadinessScore: 0.6,
      evidenceConfidence: 0.7,
      objectiveUtility: 0.65,
    },
    muscleRecovery: [],
    recoveryContext: {} as TrainingProfile['recoveryContext'],
    muscleVolumeStatuses: [],
    exerciseProgressions: [],
    exercisePreferences: [],
    prescribedVsActual: {
      complianceRate: 0.72,
      avgWeightDeviation: 0.08,
      avgRepsDeviation: 1.2,
      exercisesCompleted: 40,
      exercisesSkipped: 5,
      avgSessionOutcomeScore: 0.7,
      outcomeSampleSize: 10,
      avgSetExecutionAccuracy: 0.75,
      executionSampleSize: 20,
      muscleGroupExecutionDeltas: {},
    },
    exerciseExecutionDeltas: {},
    bodyWeightTrend: { phase: 'maintaining', currentWeight: 180 } as TrainingProfile['bodyWeightTrend'],
    fitnessFatigueModel: { readiness: 0.62, fitnessLevel: 1, fatigueLevel: 0.5, performancePrediction: 0.5 },
    ...overrides,
  } as TrainingProfile;
}

test('integration: execution deltas flow into capacity index and raise prescribe weight', () => {
  const deltas = aggregateExerciseExecutionDeltas([
    { exerciseName: 'Bench Press', prescribedWeight: 185, actualWeight: 205, prescribedReps: 8, actualReps: 8, completed: true },
    { exerciseName: 'Bench Press', prescribedWeight: 185, actualWeight: 200, prescribedReps: 8, actualReps: 9, completed: true },
    { exerciseName: 'Bench Press', prescribedWeight: 185, actualWeight: 195, prescribedReps: 8, actualReps: 8, completed: true },
  ]);
  const profile = baseProfile({
    exerciseProgressions: [{
      exerciseName: 'bench press',
      estimated1RM: 250,
      lastWeight: 185,
      lastReps: 8,
      bestSet: { weight: 185, reps: 8 },
      status: 'progressing',
      progressionSlope: 0.02,
      sessionsTracked: 10,
    }],
    exerciseExecutionDeltas: deltas,
  });
  const index = buildExerciseCapacityIndex(profile);
  const cap = index.get('bench press')!;
  const baseline = buildExerciseCapacity('bench press', profile.exerciseProgressions[0], null, null, 0, 0.7)!;
  assert.ok(cap.estimated1RM > baseline.estimated1RM, 'execution loop should boost e1RM');
  const working = capacityToWorkingWeight(cap.estimated1RM, 8, 1);
  const baselineWorking = capacityToWorkingWeight(baseline.estimated1RM, 8, 1);
  assert.ok(working > baselineWorking);
});

test('integration: controller + capacity compound for under-prescribed user', () => {
  const profile = baseProfile({
    prescribedVsActual: {
      complianceRate: 0.8,
      avgWeightDeviation: 0.15,
      avgRepsDeviation: 2,
      exercisesCompleted: 50,
      exercisesSkipped: 3,
      avgSessionOutcomeScore: 0.8,
      outcomeSampleSize: 15,
      avgSetExecutionAccuracy: 0.82,
      executionSampleSize: 30,
      muscleGroupExecutionDeltas: {},
    },
    canonicalModelContext: {
      version: '1',
      adherenceScore: 0.8,
      progressionScore: 0.7,
      sessionFitScore: 0.75,
      recoveryReadinessScore: 0.7,
      evidenceConfidence: 0.8,
      objectiveUtility: 0.78,
    },
    fitnessFatigueModel: { readiness: 0.7, fitnessLevel: 1, fatigueLevel: 0.4, performancePrediction: 0.6 },
  });
  const ctrl = computePrescriptionController(profile, { training_goal: 'bulk', mesocycle_week: 2 } as never);
  assert.ok(ctrl.weightBias > 1.04, `expected weight bias boost, got ${ctrl.weightBias}`);
  assert.ok(ctrl.volumeMultiplier >= 1.0);
  assert.ok(ctrl.rirOffset <= 0, 'strong utility should not add RIR');
});

test('integration: focus budget totals match weekly target across days', () => {
  const days = [
    { planDate: '2026-05-12', isRestDay: false, scheduledGroups: ['biceps', 'back_lats'] },
    { planDate: '2026-05-13', isRestDay: false, scheduledGroups: ['quadriceps'] },
    { planDate: '2026-05-14', isRestDay: false, scheduledGroups: ['mid_chest'] },
    { planDate: '2026-05-15', isRestDay: true, scheduledGroups: [] },
  ];
  const budget = buildFocusWeeklyBudget({ month: '2026-05', fitness_muscle: 'biceps' }, days)!;
  const allocated = Object.values(budget.allocatedByDate).reduce((s, v) => s + v, 0);
  assert.ok(allocated >= budget.totalDirectSets * 0.85, 'allocated should approximate weekly total');
  assert.equal(focusSetBudgetForDate(budget, '2026-05-15', false), 0);
});

test('integration: constraints stale detection triggers on engine version bump', () => {
  const prefs = { training_goal: 'maintain', session_duration_minutes: 60, rest_days: [0], exercises_to_avoid: [] } as never;
  const current = buildWeekPlanConstraints(prefs, '2026-05-12', [0]);
  assert.equal(current.engineVersion, WORKOUT_ENGINE_VERSION);
  assert.equal(isWeeklyPlanDayStale('2026-05-27.1', current.constraintsHash, current), true);
  assert.equal(isWeeklyPlanDayStale(current.engineVersion, current.constraintsHash, current), false);
});

test('integration: surgical swap preserves prescription structure and replaces slot', () => {
  const workout = {
    id: 'w1',
    exercises: [{
      exerciseName: 'Barbell Curl',
      exerciseLibraryId: 'old',
      targetMuscleGroup: 'biceps',
      sets: 4,
      targetReps: 10,
      targetWeight: 60,
      targetRir: 1,
      bodyPart: 'arms',
      primaryMuscles: ['biceps'],
      secondaryMuscles: [],
      movementPattern: 'curl',
      rationale: 'original',
      adjustments: [],
      isCardio: false,
      isBodyweight: false,
      isDeload: false,
      restSeconds: 60,
      tempo: '3010',
    }],
  } as unknown as GeneratedWorkout;
  const replacement = {
    id: 'new',
    name: 'Hammer Curl',
    body_part: 'arms',
    primary_muscles: ['biceps'],
    secondary_muscles: [],
    movement_pattern: 'curl',
    ml_exercise_type: 'isolation',
  };
  const swapped = applySurgicalSwap(workout, 0, replacement as never);
  assert.equal(swapped.exercises[0].exerciseName, 'Hammer Curl');
  assert.equal(swapped.exercises[0].sets, 4);
  assert.equal(swapped.exercises[0].targetReps, 10);
  assert.equal(swapped.exercises[0].targetWeight, 60);
  assert.ok(swapped.exercises[0].rationale?.includes('Surgical swap'));
});

test('integration: pickSwapReplacement excludes exercises already in workout', () => {
  const workout = {
    exercises: [
      { exerciseName: 'Barbell Curl', targetMuscleGroup: 'biceps', sets: 3, targetReps: 10 },
      { exerciseName: 'Hammer Curl', targetMuscleGroup: 'biceps', sets: 3, targetReps: 10 },
    ],
  } as unknown as GeneratedWorkout;
  const profile = baseProfile({
    substitutionAffinities: [{ fromExercise: 'barbell curl', toExercise: 'hammer curl', affinity: 30, eventCount: 3 }],
    exerciseAcceptances: [],
    exerciseSwapHistory: [],
  });
  const library = [
    { id: '1', name: 'Hammer Curl', primary_muscles: ['biceps'], body_part: 'arms', ml_exercise_type: 'isolation' },
    { id: '2', name: 'Cable Curl', primary_muscles: ['biceps'], body_part: 'arms', ml_exercise_type: 'isolation' },
  ] as never;
  const { exercise } = pickSwapReplacement(workout.exercises[0], profile, library, workout);
  assert.equal(exercise?.name, 'Cable Curl');
});

test('integration: negative execution delta trims capacity when compliance low', () => {
  const cap = buildExerciseCapacity(
    'ohp',
    { exerciseName: 'ohp', estimated1RM: 200, lastWeight: 135, lastReps: 5, bestSet: { weight: 135, reps: 5 }, status: 'progressing', progressionSlope: 0.01, sessionsTracked: 8 },
    null,
    { avgWeightDeviation: -0.12, avgRepsDeviation: -2, sampleSize: 4, completionRate: 0.5 },
    -0.12,
    0.55,
  );
  assert.ok(cap);
  assert.ok(cap!.estimated1RM < 200);
});

test('integration: controller forces conservative mode on low utility', () => {
  const profile = baseProfile({
    canonicalModelContext: {
      version: '1',
      adherenceScore: 0.4,
      progressionScore: 0.3,
      sessionFitScore: 0.35,
      recoveryReadinessScore: 0.4,
      evidenceConfidence: 0.5,
      objectiveUtility: 0.35,
    },
    fitnessFatigueModel: { readiness: 0.32, fitnessLevel: 0.5, fatigueLevel: 0.8, performancePrediction: 0.2 },
  });
  const ctrl = computePrescriptionController(profile, { training_goal: 'maintain' } as never);
  assert.equal(ctrl.forceConservative, true);
  assert.ok(ctrl.volumeMultiplier < 1);
  assert.ok(ctrl.rirOffset >= 1);
});
