/**
 * Training Analysis Engine — 12 Intelligence Features
 *
 * Computes a comprehensive TrainingProfile from the user's workout history,
 * health metrics, and enriched exercise data. This profile drives the
 * workout generator's decisions.
 *
 * Features:
 *   1.  Sleep → Performance correlation
 *   2.  Time-of-day effects
 *   3.  Steps/NEAT impact
 *   4.  Consecutive training days impact
 *   5.  Session duration / intra-session fatigue
 *   6.  Exercise ordering interference
 *   7.  Body weight trend impact
 *   8.  Auto-deload detection
 *   9.  Plateau detection
 *   10. Individual MRV detection
 *   11. Individual progression pattern learning
 *   12. Rep-weight tradeoff tracking
 */

import { requireSupabase } from './supabase';
import { MUSCLE_HEAD_TO_GROUP, VOLUME_GUIDELINES, SYNERGIST_FATIGUE } from './volumeGuidelines';
import {
  computeAllRecoveryStatuses,
  exercisesToMuscleGroupRecords,
  type RecoveryContext,
  type MuscleRecoveryStatus,
  type MuscleGroupTrainingRecord,
} from './recoveryModel';
import { getExerciseMapping } from './exerciseMuscleMap';
import strengthStandardsData from './strengthStandards.json';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WorkoutRecord {
  id: string;
  date: string;
  created_at: string;
  duration: number | null;
  template_name: string | null;
  perceived_effort: number | null;
  session_type: string;
  workout_exercises: ExerciseRecord[];
}

export interface ExerciseRecord {
  exercise_name: string;
  body_part: string;
  exercise_library_id: string | null;
  order_index?: number;
  workout_sets: SetRecord[];
}

export interface SetRecord {
  set_number: number;
  weight: number | null;
  reps: number | null;
  time: number | null;
  is_bodyweight: boolean;
  logged_at: string | null;
  tempo_eccentric_sec: number | null;
  tempo_pause_sec: number | null;
  tempo_concentric_sec: number | null;
  speed: number | null;
  incline: number | null;
}

export interface HealthRecord {
  date: string;
  weight: number | null;
  sleep_duration: number | null;
  sleep_score: number | null;
  hrv: number | null;
  resting_heart_rate: number | null;
  steps: number | null;
  calories_burned: number | null;
  body_fat_percentage: number | null;
}

export interface EnrichedExercise {
  id: string;
  name: string;
  body_part: string;
  primary_muscles: string[] | null;
  secondary_muscles: string[] | null;
  stabilizer_muscles: string[] | null;
  movement_pattern: string | null;
  ml_exercise_type: string | null;
  force_type: string | null;
  difficulty: string | null;
  default_tempo: string | null;
  equipment: string[] | null;
}

export interface PerformanceDelta {
  exerciseName: string;
  workoutDate: string;
  workoutCreatedAt: string;
  actualVolumeLoad: number;
  expectedVolumeLoad: number;
  delta: number; // (actual - expected) / expected
  sleepDeltaFromBaseline: number | null;
  hrvDeltaFromBaseline: number | null;
  rhrDeltaFromBaseline: number | null;
  stepsDeltaPreviousDay: number | null;
  timeOfDay: string; // morning, midday, afternoon, evening
  consecutiveTrainingDays: number;
  exercisePositionInSession: number;
  elapsedSessionMinutes: number;
  bodyWeightTrendSlope: number | null;
}

export interface SleepPerformanceCoefficients {
  upperBody: number;
  lowerBody: number;
  dataPoints: number;
  confidence: 'low' | 'medium' | 'high';
}

export interface TimeOfDayEffect {
  bucket: string;
  avgDelta: number;
  dataPoints: number;
}

export interface ConsecutiveDaysEffect {
  dayIndex: number;
  avgDelta: number;
  dataPoints: number;
}

export interface SessionFatigueEffect {
  positionBucket: string;
  avgDelta: number;
  dataPoints: number;
}

export interface ExerciseOrderingEffect {
  precedingExercise: string;
  affectedExercise: string;
  deltaWhenPreceded: number;
  deltaWhenNotPreceded: number;
  interference: number;
  dataPoints: number;
}

export interface PlateauDetection {
  exerciseName: string;
  sessionsSinceProgress: number;
  isPlateaued: boolean;
  suggestedStrategy: string | null;
}

export interface DeloadRecommendation {
  needed: boolean;
  signals: string[];
  suggestedDurationDays: number;
  suggestedVolumeMultiplier: number;
}

export interface MuscleVolumeStatus {
  muscleGroup: string;
  weeklyDirectSets: number;
  weeklyIndirectSets: number;
  mev: number;
  mavLow: number;
  mavHigh: number;
  mrv: number;
  individualMrv: number | null;
  status: 'below_mev' | 'in_mev_mav' | 'in_mav' | 'approaching_mrv' | 'above_mrv';
  volumeTrend: 'increasing' | 'stable' | 'decreasing';
  daysSinceLastTrained: number;
}

export interface ExerciseProgression {
  exerciseName: string;
  estimated1RM: number;
  progressionSlope: number;
  status: 'progressing' | 'stalled' | 'regressing';
  sessionsTracked: number;
  bestSet: { weight: number; reps: number };
  lastWeight: number;
  progressionPattern: 'linear' | 'double_progression' | 'undulating' | 'unknown';
}

export interface BodyWeightTrend {
  currentWeight: number | null;
  sevenDayAvg: number | null;
  slope: number; // lbs per week
  phase: 'cutting' | 'maintaining' | 'bulking';
}

export interface ImbalanceAlert {
  type: string;
  description: string;
  ratio: number;
  targetRatio: number;
}

export interface TrainingProfile {
  userId: string;
  computedAt: string;

  // Recovery
  muscleRecovery: MuscleRecoveryStatus[];
  recoveryContext: RecoveryContext;

  // Volume
  muscleVolumeStatuses: MuscleVolumeStatus[];

  // Progression
  exerciseProgressions: ExerciseProgression[];

  // Feature 1: Sleep-Performance
  sleepCoefficients: SleepPerformanceCoefficients;

  // Feature 2: Time-of-Day
  timeOfDayEffects: TimeOfDayEffect[];

  // Feature 3: Steps/NEAT
  stepsPerformanceCorrelation: { coefficient: number; dataPoints: number } | null;

  // Feature 4: Consecutive Days
  consecutiveDaysEffects: ConsecutiveDaysEffect[];

  // Feature 5: Intra-Session Fatigue
  sessionFatigueEffects: SessionFatigueEffect[];

  // Feature 6: Exercise Ordering
  exerciseOrderingEffects: ExerciseOrderingEffect[];

  // Feature 7: Body Weight Trend
  bodyWeightTrend: BodyWeightTrend;

  // Feature 8: Auto-Deload
  deloadRecommendation: DeloadRecommendation;

  // Feature 9: Plateaus
  plateauDetections: PlateauDetection[];

  // Feature 10: Individual MRV
  individualMrvEstimates: Record<string, number>;

  // Feature 11: Progression Pattern Learning (per movement pattern)
  bestProgressionPatterns: Record<string, string>;

  // Feature 12: Rep-Weight Tradeoff
  repWeightBreakthroughs: Array<{
    exerciseName: string;
    accumulatedRepsAtWeight: number;
    breakthroughWeight: number;
  }>;

  // Structural
  imbalanceAlerts: ImbalanceAlert[];

  // Strength Percentiles (from OpenPowerlifting data)
  strengthPercentiles: StrengthPercentile[];

  // Global
  trainingFrequency: number;
  avgSessionDuration: number;
  trainingAgeDays: number;
  consistencyScore: number;
}

export interface StrengthPercentile {
  lift: 'squat' | 'bench' | 'deadlift';
  estimated1RM: number;
  percentile: number;
  bodyWeightClass: string;
}

// ─── Data Fetching ──────────────────────────────────────────────────────────

async function fetchWorkoutHistory(userId: string, days: number = 120): Promise<WorkoutRecord[]> {
  const supabase = requireSupabase();
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('workouts')
    .select(`
      id, date, created_at, duration, template_name, perceived_effort, session_type,
      workout_exercises (
        exercise_name, body_part, exercise_library_id,
        workout_sets ( set_number, weight, reps, time, is_bodyweight, logged_at,
          tempo_eccentric_sec, tempo_pause_sec, tempo_concentric_sec, speed, incline )
      )
    `)
    .eq('user_id', userId)
    .gte('date', sinceStr)
    .eq('session_type', 'workout')
    .order('date', { ascending: true });

  if (error) throw error;
  return (data as WorkoutRecord[]) || [];
}

async function fetchHealthHistory(userId: string, days: number = 120): Promise<HealthRecord[]> {
  const supabase = requireSupabase();
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('health_metrics')
    .select('date, weight, sleep_duration, sleep_score, hrv, resting_heart_rate, steps, calories_burned, body_fat_percentage')
    .eq('user_id', userId)
    .gte('date', sinceStr)
    .order('date', { ascending: true });

  if (error) throw error;
  return (data as HealthRecord[]) || [];
}

async function fetchEnrichedExercises(): Promise<EnrichedExercise[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('exercise_library')
    .select('id, name, body_part, primary_muscles, secondary_muscles, stabilizer_muscles, movement_pattern, ml_exercise_type, force_type, difficulty, default_tempo, equipment')
    .eq('is_custom', false);

  if (error) throw error;
  return (data as EnrichedExercise[]) || [];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getTimeOfDayBucket(isoTimestamp: string): string {
  const hour = new Date(isoTimestamp).getHours();
  if (hour < 10) return 'morning';
  if (hour < 14) return 'midday';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

function linearRegressionSlope(values: number[]): number {
  if (values.length < 2) return 0;
  const n = values.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumXX += i * i;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function epley1RM(weight: number, reps: number): number {
  if (reps <= 0 || weight <= 0) return 0;
  if (reps === 1) return weight;
  return weight * (1 + reps / 30);
}

/**
 * Fraction of bodyweight used per exercise. Pull-ups ≈ 100%, push-ups ≈ 64%,
 * dips ≈ 85%, inverted rows ≈ 60%, etc. For unrecognized exercises default to 70%.
 */
const BW_LOAD_FRACTION: Record<string, number> = {
  'pull-up': 1.0, 'chin-up': 1.0, 'muscle-up': 1.0, 'neutral grip pull-up': 1.0,
  'push-up': 0.64, 'push-ups': 0.64, 'diamond push-up': 0.64, 'decline push-up': 0.72,
  'incline push-up': 0.50, 'pike push-up': 0.68, 'handstand push-up': 0.90,
  'dip': 0.85, 'dips': 0.85, 'bench dip': 0.55, 'ring dip': 0.90,
  'bodyweight squat': 0.70, 'pistol squat': 0.95,
  'inverted row': 0.60, 'bodyweight row': 0.60,
  'hanging leg raise': 0.35, 'l-sit': 0.40,
  'plank': 0.50, 'side plank': 0.40,
  'glute bridge': 0.50, 'single-leg glute bridge': 0.65,
  'lunge': 0.50, 'bodyweight lunge': 0.50,
  'calf raise': 0.70, 'bodyweight calf raise': 0.70,
  'back extension': 0.50, 'hip thrust (bodyweight)': 0.55,
};

function getBWFraction(exerciseName: string): number {
  const lower = exerciseName.toLowerCase();
  for (const [key, fraction] of Object.entries(BW_LOAD_FRACTION)) {
    if (lower.includes(key)) return fraction;
  }
  return 0.70;
}

function computeVolumeLoad(sets: SetRecord[], exerciseName?: string, userBodyWeight?: number | null): number {
  let total = 0;
  for (const s of sets) {
    if (s.is_bodyweight && s.reps != null && s.reps > 0 && userBodyWeight && userBodyWeight > 0) {
      const effectiveWeight = userBodyWeight * getBWFraction(exerciseName ?? '');
      total += effectiveWeight * s.reps;
    } else if (s.weight != null && s.reps != null && s.weight > 0 && s.reps > 0) {
      total += s.weight * s.reps;
    }
  }
  return total;
}

function daysBetween(a: string, b: string): number {
  return Math.abs(
    (new Date(a).getTime() - new Date(b).getTime()) / (1000 * 60 * 60 * 24)
  );
}

// ─── Feature Computations ───────────────────────────────────────────────────

function computePerformanceDeltas(
  workouts: WorkoutRecord[],
  healthByDate: Map<string, HealthRecord>,
  healthBaselines: { sleep: number; hrv: number; rhr: number; steps: number }
): PerformanceDelta[] {
  const exerciseHistory: Record<string, number[]> = {};
  const deltas: PerformanceDelta[] = [];

  // Get most recent body weight for bodyweight exercise calculations
  const weightRecordsAll = Array.from(healthByDate.values())
    .filter(h => h.weight != null)
    .sort((a, b) => a.date.localeCompare(b.date));
  const userBodyWeight = weightRecordsAll.length > 0
    ? weightRecordsAll[weightRecordsAll.length - 1].weight
    : null;

  let consecutiveDays = 0;
  let lastWorkoutDate: string | null = null;

  for (const workout of workouts) {
    if (lastWorkoutDate) {
      const gap = daysBetween(workout.date, lastWorkoutDate);
      consecutiveDays = gap <= 1.5 ? consecutiveDays + 1 : 1;
    } else {
      consecutiveDays = 1;
    }
    lastWorkoutDate = workout.date;

    const prevDate = new Date(workout.date);
    prevDate.setDate(prevDate.getDate() - 1);
    const prevDateStr = prevDate.toISOString().split('T')[0];
    const health = healthByDate.get(workout.date);
    const prevHealth = healthByDate.get(prevDateStr);

    const sleepDelta = health?.sleep_duration != null && healthBaselines.sleep > 0
      ? (health.sleep_duration - healthBaselines.sleep) / healthBaselines.sleep
      : null;
    const hrvDelta = health?.hrv != null && healthBaselines.hrv > 0
      ? (health.hrv - healthBaselines.hrv) / healthBaselines.hrv
      : null;
    const rhrDelta = health?.resting_heart_rate != null && healthBaselines.rhr > 0
      ? (health.resting_heart_rate - healthBaselines.rhr) / healthBaselines.rhr
      : null;
    const stepsDelta = prevHealth?.steps != null && healthBaselines.steps > 0
      ? (prevHealth.steps - healthBaselines.steps) / healthBaselines.steps
      : null;

    const timeOfDay = getTimeOfDayBucket(workout.created_at);
    const sessionStartMs = new Date(workout.created_at).getTime();

    const recentWeights = weightRecordsAll.slice(-14).map(w => w.weight!);
    const weightSlope = recentWeights.length >= 3
      ? linearRegressionSlope(recentWeights) * 7
      : null;

    for (let exIdx = 0; exIdx < workout.workout_exercises.length; exIdx++) {
      const ex = workout.workout_exercises[exIdx];
      const volumeLoad = computeVolumeLoad(ex.workout_sets, ex.exercise_name, userBodyWeight);
      if (volumeLoad === 0) continue;

      const key = ex.exercise_name.toLowerCase();
      if (!exerciseHistory[key]) exerciseHistory[key] = [];

      const history = exerciseHistory[key];
      let expected = volumeLoad;

      if (history.length >= 3) {
        const recentHistory = history.slice(-8);
        expected = mean(recentHistory) * (1 + linearRegressionSlope(recentHistory) * 0.01);
        if (expected <= 0) expected = mean(recentHistory);
      }

      const delta = history.length >= 3 ? (volumeLoad - expected) / expected : 0;

      const firstSetTime = ex.workout_sets[0]?.logged_at;
      const elapsedMin = firstSetTime
        ? (new Date(firstSetTime).getTime() - sessionStartMs) / 60000
        : exIdx * 8;

      deltas.push({
        exerciseName: key,
        workoutDate: workout.date,
        workoutCreatedAt: workout.created_at,
        actualVolumeLoad: volumeLoad,
        expectedVolumeLoad: expected,
        delta,
        sleepDeltaFromBaseline: sleepDelta,
        hrvDeltaFromBaseline: hrvDelta,
        rhrDeltaFromBaseline: rhrDelta,
        stepsDeltaPreviousDay: stepsDelta,
        timeOfDay,
        consecutiveTrainingDays: consecutiveDays,
        exercisePositionInSession: exIdx + 1,
        elapsedSessionMinutes: Math.max(0, elapsedMin),
        bodyWeightTrendSlope: weightSlope,
      });

      history.push(volumeLoad);
    }
  }

  return deltas;
}

/**
 * Feature 1: Sleep → Performance correlation.
 * Simple linear regression of performance delta on sleep delta.
 */
function computeSleepCoefficients(
  deltas: PerformanceDelta[],
  exercises: EnrichedExercise[]
): SleepPerformanceCoefficients {
  const exerciseBodyMap = new Map<string, string>();
  for (const ex of exercises) {
    exerciseBodyMap.set(ex.name.toLowerCase(), ex.body_part);
  }

  const upper: Array<{ sleep: number; delta: number }> = [];
  const lower: Array<{ sleep: number; delta: number }> = [];

  for (const d of deltas) {
    if (d.sleepDeltaFromBaseline == null || d.delta === 0) continue;
    const bp = exerciseBodyMap.get(d.exerciseName) ?? '';
    const isLower = ['legs'].includes(bp);
    const bucket = isLower ? lower : upper;
    bucket.push({ sleep: d.sleepDeltaFromBaseline, delta: d.delta });
  }

  const regress = (points: Array<{ sleep: number; delta: number }>): number => {
    if (points.length < 5) return 0;
    const n = points.length;
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (const p of points) {
      sx += p.sleep;
      sy += p.delta;
      sxy += p.sleep * p.delta;
      sxx += p.sleep * p.sleep;
    }
    const denom = n * sxx - sx * sx;
    return denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
  };

  const totalPoints = upper.length + lower.length;
  return {
    upperBody: regress(upper),
    lowerBody: regress(lower),
    dataPoints: totalPoints,
    confidence: totalPoints < 20 ? 'low' : totalPoints < 50 ? 'medium' : 'high',
  };
}

/**
 * Feature 2: Time-of-day performance effects.
 */
function computeTimeOfDayEffects(deltas: PerformanceDelta[]): TimeOfDayEffect[] {
  const buckets: Record<string, number[]> = {
    morning: [], midday: [], afternoon: [], evening: [],
  };
  for (const d of deltas) {
    if (d.delta !== 0) buckets[d.timeOfDay]?.push(d.delta);
  }
  return Object.entries(buckets).map(([bucket, vals]) => ({
    bucket,
    avgDelta: mean(vals),
    dataPoints: vals.length,
  }));
}

/**
 * Feature 3: Steps/NEAT → leg performance correlation.
 */
function computeStepsCorrelation(
  deltas: PerformanceDelta[],
  exercises: EnrichedExercise[]
): { coefficient: number; dataPoints: number } | null {
  const legExercises = new Set(
    exercises.filter(e => e.body_part === 'legs').map(e => e.name.toLowerCase())
  );

  const points = deltas.filter(
    d => d.stepsDeltaPreviousDay != null && legExercises.has(d.exerciseName)
  );
  if (points.length < 10) return null;

  const n = points.length;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (const p of points) {
    const x = p.stepsDeltaPreviousDay!;
    sx += x; sy += p.delta; sxy += x * p.delta; sxx += x * x;
  }
  const denom = n * sxx - sx * sx;
  return {
    coefficient: denom === 0 ? 0 : (n * sxy - sx * sy) / denom,
    dataPoints: n,
  };
}

/**
 * Feature 4: Consecutive training days impact.
 */
function computeConsecutiveDaysEffects(deltas: PerformanceDelta[]): ConsecutiveDaysEffect[] {
  const byDay: Record<number, number[]> = {};
  for (const d of deltas) {
    if (d.delta !== 0) {
      const key = Math.min(d.consecutiveTrainingDays, 6);
      if (!byDay[key]) byDay[key] = [];
      byDay[key].push(d.delta);
    }
  }
  return Object.entries(byDay)
    .map(([day, vals]) => ({
      dayIndex: Number(day),
      avgDelta: mean(vals),
      dataPoints: vals.length,
    }))
    .sort((a, b) => a.dayIndex - b.dayIndex);
}

/**
 * Feature 5: Intra-session fatigue.
 */
function computeSessionFatigueEffects(deltas: PerformanceDelta[]): SessionFatigueEffect[] {
  const buckets: Record<string, number[]> = {
    '0-30min': [], '30-60min': [], '60-90min': [], '90+min': [],
  };
  for (const d of deltas) {
    if (d.delta === 0) continue;
    const m = d.elapsedSessionMinutes;
    const key = m < 30 ? '0-30min' : m < 60 ? '30-60min' : m < 90 ? '60-90min' : '90+min';
    buckets[key].push(d.delta);
  }
  return Object.entries(buckets).map(([bucket, vals]) => ({
    positionBucket: bucket,
    avgDelta: mean(vals),
    dataPoints: vals.length,
  }));
}

/**
 * Feature 6: Exercise ordering interference.
 */
function computeExerciseOrderingEffects(workouts: WorkoutRecord[], userBodyWeight?: number | null): ExerciseOrderingEffect[] {
  const exerciseHistory: Record<string, number[]> = {};
  // Pass 1: build per-workout exercise deltas and predecessor sets.
  const workoutSnapshots: { exerciseKey: string; delta: number; predecessors: Set<string> }[][] = [];
  const knownPredecessors: Record<string, Set<string>> = {};

  for (const workout of workouts) {
    const snap: typeof workoutSnapshots[0] = [];
    for (let i = 0; i < workout.workout_exercises.length; i++) {
      const ex = workout.workout_exercises[i];
      const key = ex.exercise_name.toLowerCase();
      const vol = computeVolumeLoad(ex.workout_sets, ex.exercise_name, userBodyWeight);
      if (vol === 0) continue;

      if (!exerciseHistory[key]) exerciseHistory[key] = [];
      const hist = exerciseHistory[key];
      const expected = hist.length >= 3 ? mean(hist.slice(-5)) : vol;
      const delta = hist.length >= 3 ? (vol - expected) / expected : 0;
      hist.push(vol);

      const predecessors = new Set<string>();
      for (let j = 0; j < i; j++) {
        const pName = workout.workout_exercises[j].exercise_name.toLowerCase();
        predecessors.add(pName);
        if (!knownPredecessors[key]) knownPredecessors[key] = new Set();
        knownPredecessors[key].add(pName);
      }
      snap.push({ exerciseKey: key, delta, predecessors });
    }
    workoutSnapshots.push(snap);
  }

  // Pass 2: for each exercise with a non-zero delta, classify into preceded/notPreceded
  // for every known predecessor of that exercise.
  const pairData: Record<string, { preceded: number[]; notPreceded: number[] }> = {};
  for (const snap of workoutSnapshots) {
    for (const { exerciseKey, delta, predecessors } of snap) {
      if (delta === 0) continue;
      const allPredecessors = knownPredecessors[exerciseKey];
      if (!allPredecessors) continue;
      for (const pred of allPredecessors) {
        const pairKey = `${pred}→${exerciseKey}`;
        if (!pairData[pairKey]) pairData[pairKey] = { preceded: [], notPreceded: [] };
        if (predecessors.has(pred)) {
          pairData[pairKey].preceded.push(delta);
        } else {
          pairData[pairKey].notPreceded.push(delta);
        }
      }
    }
  }

  return Object.entries(pairData)
    .filter(([, v]) => v.preceded.length >= 3 && v.notPreceded.length >= 3)
    .map(([pair, v]) => {
      const [preceding, affected] = pair.split('→');
      return {
        precedingExercise: preceding,
        affectedExercise: affected,
        deltaWhenPreceded: mean(v.preceded),
        deltaWhenNotPreceded: mean(v.notPreceded),
        interference: mean(v.preceded) - mean(v.notPreceded),
        dataPoints: v.preceded.length + v.notPreceded.length,
      };
    })
    .sort((a, b) => a.interference - b.interference)
    .slice(0, 20);
}

/**
 * Feature 7: Body weight trend.
 */
function computeBodyWeightTrend(health: HealthRecord[]): BodyWeightTrend {
  const withWeight = health.filter(h => h.weight != null).slice(-30);
  if (withWeight.length === 0) {
    return { currentWeight: null, sevenDayAvg: null, slope: 0, phase: 'maintaining' };
  }

  const last7 = withWeight.slice(-7);
  const sevenDayAvg = mean(last7.map(h => h.weight!));
  const currentWeight = withWeight[withWeight.length - 1].weight;

  const weights = withWeight.map(h => h.weight!);
  const slopePerDay = linearRegressionSlope(weights);
  const slopePerWeek = slopePerDay * 7;

  let phase: 'cutting' | 'maintaining' | 'bulking';
  if (slopePerWeek < -0.5) phase = 'cutting';
  else if (slopePerWeek > 0.5) phase = 'bulking';
  else phase = 'maintaining';

  return { currentWeight, sevenDayAvg, slope: Math.round(slopePerWeek * 100) / 100, phase };
}

/**
 * Feature 8: Auto-deload detection.
 */
function computeDeloadRecommendation(
  exerciseProgressions: ExerciseProgression[],
  health: HealthRecord[]
): DeloadRecommendation {
  const signals: string[] = [];

  const regressing = exerciseProgressions.filter(e => e.status === 'regressing');
  if (regressing.length >= 3) {
    signals.push(`${regressing.length} exercises regressing simultaneously`);
  }

  const recent14 = health.slice(-14);
  if (recent14.length >= 10) {
    const hrvs = recent14.filter(h => h.hrv != null).map(h => h.hrv!);
    if (hrvs.length >= 7) {
      const hrvSlope = linearRegressionSlope(hrvs);
      const hrvMean = mean(hrvs);
      if (hrvSlope < 0 && Math.abs(hrvSlope * 7 / hrvMean) > 0.05) {
        signals.push('HRV trending down over 2+ weeks');
      }
    }

    const rhrs = recent14.filter(h => h.resting_heart_rate != null).map(h => h.resting_heart_rate!);
    if (rhrs.length >= 7) {
      const rhrSlope = linearRegressionSlope(rhrs);
      const rhrMean = mean(rhrs);
      if (rhrSlope > 0 && Math.abs(rhrSlope * 7 / rhrMean) > 0.05) {
        signals.push('Resting HR trending up over 2+ weeks');
      }
    }

    const sleeps = recent14.filter(h => h.sleep_duration != null).map(h => h.sleep_duration!);
    if (sleeps.length >= 7) {
      const sleepSlope = linearRegressionSlope(sleeps);
      const sleepMean = mean(sleeps);
      if (sleepSlope < 0 && Math.abs(sleepSlope * 7 / sleepMean) > 0.05) {
        signals.push('Sleep quality trending down over 2+ weeks');
      }
    }
  }

  return {
    needed: signals.length >= 2,
    signals,
    suggestedDurationDays: 7,
    suggestedVolumeMultiplier: 0.5,
  };
}

/**
 * Feature 9: Plateau detection per exercise.
 */
function computePlateauDetections(
  workouts: WorkoutRecord[]
): PlateauDetection[] {
  const exerciseSessions: Record<string, Array<{ date: string; best1RM: number }>> = {};

  for (const w of workouts) {
    for (const ex of w.workout_exercises) {
      const key = ex.exercise_name.toLowerCase();
      if (!exerciseSessions[key]) exerciseSessions[key] = [];

      let best = 0;
      for (const s of ex.workout_sets) {
        if (s.weight != null && s.reps != null) {
          best = Math.max(best, epley1RM(s.weight, s.reps));
        }
      }
      if (best > 0) {
        exerciseSessions[key].push({ date: w.date, best1RM: best });
      }
    }
  }

  const results: PlateauDetection[] = [];

  for (const [name, sessions] of Object.entries(exerciseSessions)) {
    if (sessions.length < 4) continue;

    const recent = sessions.slice(-6);
    const values = recent.map(s => s.best1RM);
    const slope = linearRegressionSlope(values);
    const avg = mean(values);
    const normalizedSlope = avg > 0 ? slope / avg : 0;

    const isPlateaued = Math.abs(normalizedSlope) < 0.005 && recent.length >= 4;
    const isRegressing = normalizedSlope < -0.01;
    const sessionsSinceProgress = countSessionsSinceProgress(values);

    let strategy: string | null = null;
    if (isPlateaued || isRegressing) {
      if (isRegressing) {
        strategy = 'Deload: reduce weight to 90% for 1 week, then resume';
      } else if (sessionsSinceProgress >= 6) {
        strategy = 'Swap to a variation targeting the same muscle heads from a different angle';
      } else if (sessionsSinceProgress >= 4) {
        strategy = 'Change rep range: if stuck at 5 reps, try 8-10 at lower weight for 3 weeks';
      } else {
        strategy = 'Add eccentric emphasis: 3-4 second negatives for 2 weeks';
      }
    }

    results.push({
      exerciseName: name,
      sessionsSinceProgress,
      isPlateaued: isPlateaued || isRegressing,
      suggestedStrategy: strategy,
    });
  }

  return results;
}

function countSessionsSinceProgress(values: number[]): number {
  if (values.length < 2) return 0;
  const peak = Math.max(...values.slice(0, -1));
  let count = 0;
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i] > peak * 1.005) break;
    count++;
  }
  return count;
}

/**
 * Feature 10: Individual MRV detection.
 * Looks for the inflection point where more volume stops producing gains.
 */
function computeIndividualMRV(
  workouts: WorkoutRecord[],
  exercises: EnrichedExercise[],
  userBodyWeight?: number | null
): Record<string, number> {
  const exerciseToGroup = new Map<string, string>();
  for (const ex of exercises) {
    const primaryGroup = ex.primary_muscles?.[0]
      ? MUSCLE_HEAD_TO_GROUP[ex.primary_muscles[0]]
      : null;
    if (primaryGroup) exerciseToGroup.set(ex.name.toLowerCase(), primaryGroup);
  }

  // Group workouts into 4-week mesocycles
  if (workouts.length < 12) return {};

  const weeklyData: Record<string, Array<{ weekIdx: number; sets: number; avgDelta: number }>> = {};
  const exerciseHistory: Record<string, number[]> = {};

  let weekIdx = 0;
  let weekStart = workouts[0]?.date;
  const weeklySets: Record<string, number> = {};
  const weeklyDeltas: Record<string, number[]> = {};

  for (const w of workouts) {
    if (daysBetween(w.date, weekStart) >= 7) {
      for (const [group, sets] of Object.entries(weeklySets)) {
        const groupDeltas = weeklyDeltas[group] ?? [];
        if (!weeklyData[group]) weeklyData[group] = [];
        weeklyData[group].push({
          weekIdx,
          sets,
          avgDelta: groupDeltas.length > 0 ? mean(groupDeltas) : 0,
        });
      }
      weekIdx++;
      weekStart = w.date;
      for (const k of Object.keys(weeklySets)) { weeklySets[k] = 0; }
      for (const k of Object.keys(weeklyDeltas)) { weeklyDeltas[k] = []; }
    }

    for (const ex of w.workout_exercises) {
      const group = exerciseToGroup.get(ex.exercise_name.toLowerCase());
      if (!group) continue;
      const sets = ex.workout_sets.length;
      weeklySets[group] = (weeklySets[group] ?? 0) + sets;

      const vol = computeVolumeLoad(ex.workout_sets, ex.exercise_name, userBodyWeight);
      const key = ex.exercise_name.toLowerCase();
      if (!exerciseHistory[key]) exerciseHistory[key] = [];
      const hist = exerciseHistory[key];
      if (hist.length >= 3 && vol > 0) {
        const expected = mean(hist.slice(-5));
        const delta = (vol - expected) / expected;
        if (!weeklyDeltas[group]) weeklyDeltas[group] = [];
        weeklyDeltas[group].push(delta);
      }
      if (vol > 0) hist.push(vol);
    }
  }

  const mrvEstimates: Record<string, number> = {};

  for (const [group, weeks] of Object.entries(weeklyData)) {
    if (weeks.length < 6) continue;

    // Find the volume level above which performance starts declining
    const sorted = [...weeks].sort((a, b) => a.sets - b.sets);
    const midpoint = Math.floor(sorted.length / 2);
    const lowVolumePerf = mean(sorted.slice(0, midpoint).map(w => w.avgDelta));
    const highVolumePerf = mean(sorted.slice(midpoint).map(w => w.avgDelta));

    if (highVolumePerf < lowVolumePerf - 0.02) {
      const inflection = sorted[midpoint]?.sets;
      if (inflection) mrvEstimates[group] = inflection;
    }
  }

  return mrvEstimates;
}

/**
 * Feature 11: Progression pattern learning.
 */
function computeBestProgressionPatterns(
  workouts: WorkoutRecord[],
  exercises: EnrichedExercise[]
): Record<string, string> {
  const exerciseToPattern = new Map<string, string>();
  for (const ex of exercises) {
    if (ex.movement_pattern) exerciseToPattern.set(ex.name.toLowerCase(), ex.movement_pattern);
  }

  const exerciseSessions: Record<string, Array<{ weight: number; reps: number; date: string }>> = {};

  for (const w of workouts) {
    for (const ex of w.workout_exercises) {
      const key = ex.exercise_name.toLowerCase();
      if (!exerciseSessions[key]) exerciseSessions[key] = [];
      const best = ex.workout_sets
        .filter(s => s.weight != null && s.reps != null && s.weight! > 0)
        .sort((a, b) => epley1RM(b.weight!, b.reps!) - epley1RM(a.weight!, a.reps!))[0];
      if (best) {
        exerciseSessions[key].push({ weight: best.weight!, reps: best.reps!, date: w.date });
      }
    }
  }

  const patternBreakthroughs: Record<string, Record<string, number>> = {};

  for (const [exName, sessions] of Object.entries(exerciseSessions)) {
    if (sessions.length < 6) continue;
    const movementPattern = exerciseToPattern.get(exName) ?? 'unknown';

    for (let i = 3; i < sessions.length; i++) {
      const prev3 = sessions.slice(i - 3, i);
      const current = sessions[i];
      const prev1RM = Math.max(...prev3.map(s => epley1RM(s.weight, s.reps)));
      const curr1RM = epley1RM(current.weight, current.reps);

      if (curr1RM > prev1RM * 1.02) {
        // Breakthrough detected — classify what preceded it
        const weightChanges = prev3.map((s, j) => j > 0 ? s.weight - prev3[j - 1].weight : 0);
        const repChanges = prev3.map((s, j) => j > 0 ? s.reps - prev3[j - 1].reps : 0);

        let pattern = 'unknown';
        const avgWeightChange = mean(weightChanges.slice(1));
        const avgRepChange = mean(repChanges.slice(1));

        if (avgWeightChange > 0.5 && Math.abs(avgRepChange) < 1) {
          pattern = 'linear';
        } else if (Math.abs(avgWeightChange) < 0.5 && avgRepChange > 0.3) {
          pattern = 'double_progression';
        } else if (Math.abs(avgWeightChange) > 0 && Math.abs(avgRepChange) > 0) {
          pattern = 'undulating';
        }

        if (!patternBreakthroughs[movementPattern]) patternBreakthroughs[movementPattern] = {};
        patternBreakthroughs[movementPattern][pattern] =
          (patternBreakthroughs[movementPattern][pattern] ?? 0) + 1;
      }
    }
  }

  const best: Record<string, string> = {};
  for (const [mp, counts] of Object.entries(patternBreakthroughs)) {
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    if (sorted[0]) best[mp] = sorted[0][0];
  }
  return best;
}

/**
 * Feature 12: Rep-weight breakthrough tracking.
 */
function computeRepWeightBreakthroughs(
  workouts: WorkoutRecord[]
): Array<{ exerciseName: string; accumulatedRepsAtWeight: number; breakthroughWeight: number }> {
  const exerciseSessions: Record<string, Array<{ weight: number; reps: number }>> = {};

  for (const w of workouts) {
    for (const ex of w.workout_exercises) {
      const key = ex.exercise_name.toLowerCase();
      if (!exerciseSessions[key]) exerciseSessions[key] = [];
      for (const s of ex.workout_sets) {
        if (s.weight != null && s.reps != null && s.weight > 0 && s.reps > 0) {
          exerciseSessions[key].push({ weight: s.weight, reps: s.reps });
        }
      }
    }
  }

  const results: Array<{ exerciseName: string; accumulatedRepsAtWeight: number; breakthroughWeight: number }> = [];

  for (const [name, sets] of Object.entries(exerciseSessions)) {
    if (sets.length < 10) continue;

    const maxWeight = Math.max(...sets.map(s => s.weight));
    const subMaxSets = sets.filter(s => s.weight >= maxWeight * 0.9 && s.weight < maxWeight);
    const accumulatedReps = subMaxSets.reduce((sum, s) => sum + s.reps, 0);

    if (accumulatedReps > 0) {
      results.push({
        exerciseName: name,
        accumulatedRepsAtWeight: accumulatedReps,
        breakthroughWeight: maxWeight,
      });
    }
  }

  return results;
}

/**
 * Compute muscle volume statuses.
 */
function computeMuscleVolumeStatuses(
  workouts: WorkoutRecord[],
  exercises: EnrichedExercise[],
  individualMrv: Record<string, number>
): MuscleVolumeStatus[] {
  const exerciseToMuscles = new Map<string, { primary: string[]; secondary: string[]; mlType: string | null }>();
  for (const ex of exercises) {
    exerciseToMuscles.set(ex.name.toLowerCase(), {
      primary: ex.primary_muscles ?? [],
      secondary: ex.secondary_muscles ?? [],
      mlType: ex.ml_exercise_type ?? null,
    });
  }

  const now = new Date();
  const fourWeeksAgo = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);
  const recentWorkouts = workouts.filter(w => new Date(w.date) >= fourWeeksAgo);

  const groupDirectSets: Record<string, number[]> = {};
  const groupIndirectSets: Record<string, number> = {};
  const lastTrained: Record<string, string> = {};

  // Build 4-week rolling data, split into weekly buckets
  const weekBuckets: Record<string, Record<number, number>> = {};

  for (const w of recentWorkouts) {
    const weekIdx = Math.floor(daysBetween(w.date, fourWeeksAgo.toISOString().split('T')[0]) / 7);

    for (const ex of w.workout_exercises) {
      const muscles = exerciseToMuscles.get(ex.exercise_name.toLowerCase());
      if (!muscles) continue;

      // Cardio and recovery don't count toward hypertrophy volume (sets).
      // They DO count toward recovery fatigue (handled separately below).
      if (muscles.mlType === 'cardio' || muscles.mlType === 'recovery') continue;

      const sets = ex.workout_sets.length;

      for (const m of muscles.primary) {
        const group = MUSCLE_HEAD_TO_GROUP[m];
        if (!group) continue;
        if (!weekBuckets[group]) weekBuckets[group] = {};
        weekBuckets[group][weekIdx] = (weekBuckets[group][weekIdx] ?? 0) + sets;

        if (!lastTrained[group] || w.date > lastTrained[group]) {
          lastTrained[group] = w.date;
        }
      }

      for (const m of muscles.secondary) {
        const group = MUSCLE_HEAD_TO_GROUP[m];
        if (!group) continue;
        groupIndirectSets[group] = (groupIndirectSets[group] ?? 0) + sets * 0.5;
      }
    }
  }

  return VOLUME_GUIDELINES.map(guide => {
    const weekData = weekBuckets[guide.muscleGroup] ?? {};
    const weekValues = Object.values(weekData);
    const weeksWithData = Math.max(weekValues.length, 1);
    const totalSets = weekValues.reduce((a, b) => a + b, 0);
    const weeklyDirect = totalSets / Math.min(4, weeksWithData);
    const weeklyIndirect = (groupIndirectSets[guide.muscleGroup] ?? 0) / 4;
    const mrv = individualMrv[guide.muscleGroup] ?? guide.mrv;

    let status: MuscleVolumeStatus['status'];
    if (weeklyDirect < guide.mev) status = 'below_mev';
    else if (weeklyDirect < guide.mavLow) status = 'in_mev_mav';
    else if (weeklyDirect <= guide.mavHigh) status = 'in_mav';
    else if (weeklyDirect <= mrv) status = 'approaching_mrv';
    else status = 'above_mrv';

    const trendValues = Object.entries(weekData)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([, v]) => v);
    const trendSlope = linearRegressionSlope(trendValues);
    let volumeTrend: 'increasing' | 'stable' | 'decreasing';
    if (trendSlope > 0.5) volumeTrend = 'increasing';
    else if (trendSlope < -0.5) volumeTrend = 'decreasing';
    else volumeTrend = 'stable';

    const lt = lastTrained[guide.muscleGroup];
    const daysSince = lt ? daysBetween(now.toISOString().split('T')[0], lt) : Infinity;

    return {
      muscleGroup: guide.muscleGroup,
      weeklyDirectSets: Math.round(weeklyDirect * 10) / 10,
      weeklyIndirectSets: Math.round(weeklyIndirect * 10) / 10,
      mev: guide.mev,
      mavLow: guide.mavLow,
      mavHigh: guide.mavHigh,
      mrv: guide.mrv,
      individualMrv: individualMrv[guide.muscleGroup] ?? null,
      status,
      volumeTrend,
      daysSinceLastTrained: Math.round(daysSince),
    };
  });
}

/**
 * Compute exercise progression metrics.
 */
function computeExerciseProgressions(workouts: WorkoutRecord[], userBodyWeight?: number | null): ExerciseProgression[] {
  const exerciseSessions: Record<string, Array<{
    date: string;
    best1RM: number;
    bestWeight: number;
    bestReps: number;
    lastWeight: number;
  }>> = {};

  for (const w of workouts) {
    for (const ex of w.workout_exercises) {
      const key = ex.exercise_name.toLowerCase();
      if (!exerciseSessions[key]) exerciseSessions[key] = [];

      let best1RM = 0;
      let bestWeight = 0;
      let bestReps = 0;
      let lastWeight = 0;

      for (const s of ex.workout_sets) {
        let effectiveWeight = s.weight;

        // For bodyweight exercises, estimate load from user's body weight
        if (s.is_bodyweight && userBodyWeight && userBodyWeight > 0) {
          effectiveWeight = Math.round(userBodyWeight * getBWFraction(ex.exercise_name));
        }

        if (effectiveWeight != null && s.reps != null && effectiveWeight > 0) {
          const e1rm = epley1RM(effectiveWeight, s.reps);
          if (e1rm > best1RM) {
            best1RM = e1rm;
            bestWeight = effectiveWeight;
            bestReps = s.reps;
          }
          lastWeight = effectiveWeight;
        }
      }

      if (best1RM > 0) {
        exerciseSessions[key].push({ date: w.date, best1RM, bestWeight, bestReps, lastWeight });
      }
    }
  }

  return Object.entries(exerciseSessions)
    .filter(([, sessions]) => sessions.length >= 3)
    .map(([name, sessions]) => {
      const values = sessions.map(s => s.best1RM);
      const slope = linearRegressionSlope(values);
      const avg = mean(values);
      const normalizedSlope = avg > 0 ? slope / avg : 0;

      let status: 'progressing' | 'stalled' | 'regressing';
      if (normalizedSlope > 0.005) status = 'progressing';
      else if (normalizedSlope < -0.01) status = 'regressing';
      else status = 'stalled';

      const last = sessions[sessions.length - 1];

      return {
        exerciseName: name,
        estimated1RM: Math.round(last.best1RM * 10) / 10,
        progressionSlope: Math.round(normalizedSlope * 10000) / 10000,
        status,
        sessionsTracked: sessions.length,
        bestSet: { weight: last.bestWeight, reps: last.bestReps },
        lastWeight: last.lastWeight,
        progressionPattern: 'unknown' as const,
      };
    });
}

/**
 * Compute strength percentiles against OpenPowerlifting population data.
 * Maps the user's best estimated 1RM for squat, bench, and deadlift against
 * their body weight class to produce a percentile ranking.
 */
function computeStrengthPercentiles(
  exerciseProgressions: ExerciseProgression[],
  bodyWeight: number | null | undefined,
  gender: string | null | undefined
): StrengthPercentile[] {
  if (!bodyWeight || bodyWeight <= 0) return [];

  const sex = (gender || 'M').toUpperCase().startsWith('F') ? 'F' : 'M';
  const standards = (strengthStandardsData as any)[sex];
  if (!standards) return [];

  // Find closest body weight class
  const classes = Object.keys(standards).map(Number).sort((a, b) => a - b);
  let bestClass = classes[0];
  for (const c of classes) {
    if (Math.abs(c - bodyWeight) < Math.abs(bestClass - bodyWeight)) {
      bestClass = c;
    }
  }
  const classData = standards[String(bestClass)];
  if (!classData) return [];

  const liftMappings: { lift: 'squat' | 'bench' | 'deadlift'; patterns: string[] }[] = [
    { lift: 'squat', patterns: ['squat', 'back squat', 'front squat'] },
    { lift: 'bench', patterns: ['bench press', 'barbell bench press'] },
    { lift: 'deadlift', patterns: ['deadlift', 'conventional deadlift', 'sumo deadlift'] },
  ];

  const results: StrengthPercentile[] = [];
  for (const { lift, patterns } of liftMappings) {
    const liftData = classData[lift];
    if (!liftData) continue;

    // Find best e1RM across matching exercise names
    let best1RM = 0;
    for (const prog of exerciseProgressions) {
      const name = prog.exerciseName.toLowerCase();
      if (patterns.some(p => name.includes(p)) && prog.estimated1RM > best1RM) {
        best1RM = prog.estimated1RM;
      }
    }
    if (best1RM <= 0) continue;

    // Interpolate percentile
    const percentiles = [
      { pct: 25, val: liftData.p25 },
      { pct: 50, val: liftData.p50 },
      { pct: 75, val: liftData.p75 },
      { pct: 90, val: liftData.p90 },
      { pct: 95, val: liftData.p95 },
    ];

    let pct = 10;
    if (best1RM >= percentiles[percentiles.length - 1].val) {
      pct = 97;
    } else if (best1RM <= percentiles[0].val) {
      pct = Math.round((best1RM / percentiles[0].val) * 25);
    } else {
      for (let i = 0; i < percentiles.length - 1; i++) {
        if (best1RM >= percentiles[i].val && best1RM < percentiles[i + 1].val) {
          const range = percentiles[i + 1].val - percentiles[i].val;
          const t = range > 0 ? (best1RM - percentiles[i].val) / range : 0;
          pct = Math.round(percentiles[i].pct + t * (percentiles[i + 1].pct - percentiles[i].pct));
          break;
        }
      }
    }

    results.push({
      lift,
      estimated1RM: Math.round(best1RM),
      percentile: pct,
      bodyWeightClass: `${bestClass} lbs`,
    });
  }

  return results;
}

/**
 * Compute structural imbalances.
 */
function computeImbalanceAlerts(volumeStatuses: MuscleVolumeStatus[]): ImbalanceAlert[] {
  const alerts: ImbalanceAlert[] = [];
  const byGroup: Record<string, number> = {};
  for (const v of volumeStatuses) {
    byGroup[v.muscleGroup] = v.weeklyDirectSets;
  }

  // Push:Pull ratio
  const pushVolume = (byGroup['chest'] ?? 0) + (byGroup['anterior_deltoid'] ?? 0) + (byGroup['triceps'] ?? 0);
  const pullVolume = (byGroup['back_lats'] ?? 0) + (byGroup['back_upper'] ?? 0) + (byGroup['biceps'] ?? 0) + (byGroup['posterior_deltoid'] ?? 0);

  if (pullVolume > 0) {
    const ratio = pushVolume / pullVolume;
    if (ratio > 1.3 || ratio < 0.7) {
      alerts.push({
        type: 'push_pull',
        description: ratio > 1.3
          ? 'Push volume significantly exceeds pull volume — shoulder injury risk'
          : 'Pull volume significantly exceeds push volume — consider more pressing',
        ratio: Math.round(ratio * 100) / 100,
        targetRatio: 1.0,
      });
    }
  }

  // Anterior:Posterior ratio
  const anterior = (byGroup['chest'] ?? 0) + (byGroup['anterior_deltoid'] ?? 0) + (byGroup['quadriceps'] ?? 0);
  const posterior = (byGroup['back_lats'] ?? 0) + (byGroup['back_upper'] ?? 0) + (byGroup['hamstrings'] ?? 0) + (byGroup['posterior_deltoid'] ?? 0) + (byGroup['glutes'] ?? 0);

  if (posterior > 0) {
    const ratio = anterior / posterior;
    if (ratio > 1.4) {
      alerts.push({
        type: 'anterior_posterior',
        description: 'Anterior chain dominates posterior — posture and injury risk',
        ratio: Math.round(ratio * 100) / 100,
        targetRatio: 1.0,
      });
    }
  }

  // Upper:Lower ratio
  const upper = (byGroup['chest'] ?? 0) + (byGroup['back_lats'] ?? 0) + (byGroup['back_upper'] ?? 0)
    + (byGroup['anterior_deltoid'] ?? 0) + (byGroup['lateral_deltoid'] ?? 0) + (byGroup['posterior_deltoid'] ?? 0)
    + (byGroup['biceps'] ?? 0) + (byGroup['triceps'] ?? 0);
  const lower = (byGroup['quadriceps'] ?? 0) + (byGroup['hamstrings'] ?? 0) + (byGroup['glutes'] ?? 0) + (byGroup['calves'] ?? 0);

  if (lower > 0) {
    const ratio = upper / lower;
    if (ratio > 2.5) {
      alerts.push({
        type: 'upper_lower',
        description: 'Upper body volume significantly exceeds lower body',
        ratio: Math.round(ratio * 100) / 100,
        targetRatio: 1.5,
      });
    }
  }

  // Below MEV alerts
  for (const v of volumeStatuses) {
    if (v.status === 'below_mev' && v.mev > 0 && v.weeklyDirectSets > 0) {
      alerts.push({
        type: 'below_mev',
        description: `${v.muscleGroup}: ${v.weeklyDirectSets} sets/week is below MEV (${v.mev})`,
        ratio: v.weeklyDirectSets,
        targetRatio: v.mev,
      });
    }
  }

  return alerts;
}

// ─── Main Entry Point ───────────────────────────────────────────────────────

export async function computeTrainingProfile(userId: string): Promise<TrainingProfile> {
  const supabase = requireSupabase();
  const [workouts, health, exercises, prefsResult] = await Promise.all([
    fetchWorkoutHistory(userId),
    fetchHealthHistory(userId),
    fetchEnrichedExercises(),
    supabase.from('user_preferences').select('gender').eq('user_id', userId).maybeSingle(),
  ]);
  const userGender = prefsResult?.data?.gender ?? null;

  const healthByDate = new Map<string, HealthRecord>();
  for (const h of health) healthByDate.set(h.date, h);

  // Compute baselines (30-day averages)
  const last30 = health.slice(-30);
  const sleepVals = last30.filter(h => h.sleep_duration != null).map(h => h.sleep_duration!);
  const hrvVals = last30.filter(h => h.hrv != null).map(h => h.hrv!);
  const rhrVals = last30.filter(h => h.resting_heart_rate != null).map(h => h.resting_heart_rate!);
  const stepsVals = last30.filter(h => h.steps != null).map(h => h.steps!);

  const baselines = {
    sleep: mean(sleepVals),
    hrv: mean(hrvVals),
    rhr: mean(rhrVals),
    steps: mean(stepsVals),
  };

  // Recovery context from most recent data
  const lastHealth = health.length > 0 ? health[health.length - 1] : null;
  const recoveryCtx: RecoveryContext = {
    sleepDurationLastNight: lastHealth?.sleep_duration ?? null,
    sleepBaseline30d: baselines.sleep || null,
    hrvLastNight: lastHealth?.hrv ?? null,
    hrvBaseline30d: baselines.hrv || null,
    rhrLastNight: lastHealth?.resting_heart_rate ?? null,
    rhrBaseline30d: baselines.rhr || null,
    stepsYesterday: lastHealth?.steps ?? null,
    stepsBaseline30d: baselines.steps || null,
  };

  // User's body weight for bodyweight exercise calculations
  const weightRecords = health.filter(h => h.weight != null).sort((a, b) => a.date.localeCompare(b.date));
  const userBodyWeight = weightRecords.length > 0 ? weightRecords[weightRecords.length - 1].weight : null;

  // Performance deltas (foundation for features 1-7)
  const deltas = computePerformanceDeltas(workouts, healthByDate, baselines);

  // Exercise progressions
  const exerciseProgressions = computeExerciseProgressions(workouts, userBodyWeight);

  // Individual MRV
  const individualMrvEstimates = computeIndividualMRV(workouts, exercises, userBodyWeight);

  // Volume statuses
  const muscleVolumeStatuses = computeMuscleVolumeStatuses(workouts, exercises, individualMrvEstimates);

  // Recovery per muscle group — includes cardio fatigue equivalent sets
  const recentMuscleRecords: MuscleGroupTrainingRecord[] = [];
  const recentWorkoutsSlice = workouts.slice(-10);
  for (const w of recentWorkoutsSlice) {
    const exRecords = w.workout_exercises.map(ex => {
      const enriched = exercises.find(e => e.name.toLowerCase() === ex.exercise_name.toLowerCase());
      const mapping = getExerciseMapping(ex.exercise_name);
      const isCardio = enriched?.ml_exercise_type === 'cardio' || mapping?.exercise_type === 'cardio';

      let effectiveSets = ex.workout_sets.length;
      if (isCardio && mapping?.cardio_fatigue_factor) {
        // Convert time-based cardio to equivalent fatigue sets
        // cardio_fatigue_factor is calibrated per 30 minutes of activity
        const totalTimeSeconds = ex.workout_sets.reduce((sum, s) => sum + (s.time ?? 0), 0);
        const thirtyMinBlocks = totalTimeSeconds > 0 ? totalTimeSeconds / 1800 : 1;
        effectiveSets = Math.round(mapping.cardio_fatigue_factor * thirtyMinBlocks * 10) / 10;
      }

      return {
        primary_muscles: enriched?.primary_muscles ?? mapping?.primary_muscles ?? undefined,
        secondary_muscles: enriched?.secondary_muscles ?? mapping?.secondary_muscles ?? undefined,
        sets: effectiveSets,
      };
    });
    const records = exercisesToMuscleGroupRecords(exRecords, new Date(w.created_at));
    recentMuscleRecords.push(...records);
  }

  // Deduplicate: keep most recent per group
  const latestRecords = new Map<string, MuscleGroupTrainingRecord>();
  for (const r of recentMuscleRecords) {
    const existing = latestRecords.get(r.muscleGroup);
    if (!existing || r.lastTrainedAt > existing.lastTrainedAt) {
      latestRecords.set(r.muscleGroup, r);
    }
  }

  const muscleRecovery = computeAllRecoveryStatuses(
    Array.from(latestRecords.values()),
    recoveryCtx
  );

  // Global stats
  const trainingDates = [...new Set(workouts.map(w => w.date))];
  const last4Weeks = trainingDates.filter(
    d => daysBetween(d, new Date().toISOString().split('T')[0]) <= 28
  );
  const trainingFrequency = last4Weeks.length / 4;
  const durations = workouts.filter(w => w.duration).map(w => w.duration!);
  const avgSessionDuration = mean(durations);
  const trainingAgeDays = workouts.length > 0
    ? daysBetween(workouts[0].date, new Date().toISOString().split('T')[0])
    : 0;

  // Consistency: count weeks with 0 workouts in last 12 weeks
  const last12Weeks: boolean[] = [];
  for (let i = 0; i < 12; i++) {
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - (i + 1) * 7);
    const weekEnd = new Date();
    weekEnd.setDate(weekEnd.getDate() - i * 7);
    const weekStartStr = weekStart.toISOString().split('T')[0];
    const weekEndStr = weekEnd.toISOString().split('T')[0];
    const hasWorkout = trainingDates.some(d => d >= weekStartStr && d < weekEndStr);
    last12Weeks.push(hasWorkout);
  }
  const weeksWithWorkouts = last12Weeks.filter(Boolean).length;
  const consistencyScore = weeksWithWorkouts / 12;

  return {
    userId,
    computedAt: new Date().toISOString(),

    muscleRecovery,
    recoveryContext: recoveryCtx,
    muscleVolumeStatuses,
    exerciseProgressions,

    sleepCoefficients: computeSleepCoefficients(deltas, exercises),
    timeOfDayEffects: computeTimeOfDayEffects(deltas),
    stepsPerformanceCorrelation: computeStepsCorrelation(deltas, exercises),
    consecutiveDaysEffects: computeConsecutiveDaysEffects(deltas),
    sessionFatigueEffects: computeSessionFatigueEffects(deltas),
    exerciseOrderingEffects: computeExerciseOrderingEffects(workouts, userBodyWeight),
    bodyWeightTrend: computeBodyWeightTrend(health),
    deloadRecommendation: computeDeloadRecommendation(exerciseProgressions, health),
    plateauDetections: computePlateauDetections(workouts),
    individualMrvEstimates,
    bestProgressionPatterns: computeBestProgressionPatterns(workouts, exercises),
    repWeightBreakthroughs: computeRepWeightBreakthroughs(workouts),
    imbalanceAlerts: computeImbalanceAlerts(muscleVolumeStatuses),
    strengthPercentiles: computeStrengthPercentiles(exerciseProgressions, userBodyWeight, userGender),

    trainingFrequency: Math.round(trainingFrequency * 10) / 10,
    avgSessionDuration: Math.round(avgSessionDuration),
    trainingAgeDays: Math.round(trainingAgeDays),
    consistencyScore: Math.round(consistencyScore * 100) / 100,
  };
}
