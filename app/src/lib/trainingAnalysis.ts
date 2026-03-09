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
import { DEFAULT_MODEL_CONFIG } from './modelConfig';
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

type TrendDirection = 'up' | 'flat' | 'down';

export interface MetricTrend {
  current: number | null;
  avg30d: number | null;
  slope: number;          // units per week
  slopePct: number;       // % change per week relative to avg
  direction: TrendDirection;
  dataPoints: number;
}

export interface ExerciseTrend {
  exerciseName: string;
  estimated1RM: MetricTrend;
  volumeLoad: MetricTrend; // total weight × reps over 30 days weekly
}

export interface MuscleGroupTrend {
  muscleGroup: string;
  weeklySetsTrend: MetricTrend;
}

export interface Rolling30DayTrends {
  // Recovery inputs (from wearables)
  sleep: MetricTrend;
  hrv: MetricTrend;
  rhr: MetricTrend;
  steps: MetricTrend;

  // Body composition
  bodyWeight: MetricTrend;
  bodyFat: MetricTrend;
  estimatedLeanMass: MetricTrend;   // weight × (1 - bf%) when bf% available

  // Overall strength progress
  totalStrengthIndex: MetricTrend;  // sum of e1RM across all tracked lifts per session
  big3Total: MetricTrend;           // bench + squat + deadlift e1RM
  relativeStrength: MetricTrend;    // total strength / body weight (Wilks-like normalization)
  totalVolumeLoad: MetricTrend;     // total weight × reps per week across all exercises

  // Training outputs
  trainingFrequency: MetricTrend;   // sessions per week
  avgSessionDuration: MetricTrend;  // minutes
  totalWeeklyVolume: MetricTrend;   // total sets per week across all muscles

  // Per-exercise strength trends (top exercises by recency)
  exerciseTrends: ExerciseTrend[];

  // Per-muscle-group volume trends
  muscleGroupTrends: MuscleGroupTrend[];
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
    readyForWeightJump: boolean;
    typicalRepsBeforeJump: number;
  }>;

  // Structural
  imbalanceAlerts: ImbalanceAlert[];

  // Strength Percentiles (from OpenPowerlifting data)
  strengthPercentiles: StrengthPercentile[];
  gender: string | null;

  // Split Detection & Scheduling
  detectedSplit: DetectedSplit;
  dayOfWeekPatterns: DayOfWeekPattern[];
  exercisePreferences: ExercisePreference[];
  cardioHistory: CardioHistory[];
  exerciseOrderProfiles: ExerciseOrderProfile[];

  // Cumulative sleep debt (rolling averages)
  cumulativeSleepDebt: {
    rolling3dAvgHours: number | null;
    rolling7dAvgHours: number | null;
    sleepDebt3d: number | null; // difference from baseline
    sleepDebt7d: number | null;
    recoveryModifier: number; // 0.8 to 1.0 multiplier on training capacity
  };

  // Rolling 30-day trends (objective, all derived from measured data)
  rolling30DayTrends: Rolling30DayTrends;

  // Exercise rotation status
  exerciseRotation: Array<{
    exerciseName: string;
    consecutiveWeeksUsed: number;
    shouldRotate: boolean; // true if isolation used > 4 weeks, compound > 8 weeks
    suggestedAction: string;
  }>;

  // #1: Prescribed vs actual compliance (feedback loop)
  prescribedVsActual: {
    complianceRate: number;     // 0-1: how often user followed the prescription
    avgWeightDeviation: number; // average % deviation from prescribed weight
    avgRepsDeviation: number;   // average reps deviation
    exercisesCompleted: number; // total exercises completed from prescriptions
    exercisesSkipped: number;   // total exercises skipped
  };

  // #4: Individual muscle recovery rates (learned from performance-after-rest)
  individualRecoveryRates: Record<string, number>;

  // #20: Banister fitness-fatigue model
  fitnessFatigueModel: {
    fitnessLevel: number;    // accumulated fitness (slow-decaying)
    fatigueLevel: number;    // accumulated fatigue (fast-decaying)
    performancePrediction: number; // fitness - fatigue
    readiness: number;       // 0-1 scale
  };

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

export type SplitType = 'push_pull_legs' | 'upper_lower' | 'bro_split' | 'full_body' | 'custom';

export interface DetectedSplit {
  type: SplitType;
  confidence: number;
  typicalRotation: string[];
  nextRecommended: string[];
  evidence: string[];
}

export interface DayOfWeekPattern {
  dayOfWeek: number; // 0=Sun, 6=Sat
  dayName: string;
  muscleGroupsTypical: string[];
  templateNames: string[];
  frequency: number; // fraction of weeks this day was trained
  avgExerciseCount: number;
  isRestDay: boolean;
}

export interface ExercisePreference {
  exerciseName: string;
  totalSessions: number;
  recentSessions: number;
  recencyScore: number;
  lastUsedDaysAgo: number;
  avgSetsPerSession: number;
  isStaple: boolean;
  // Learned prescription patterns (from actual training data)
  learnedReps: number | null;       // median reps across recent sessions
  learnedSets: number | null;       // median working sets across recent sessions
  learnedWeight: number | null;     // most recent working weight
  learnedIncrement: number | null;  // median session-to-session weight change (when it changes)
  learnedRestSeconds: number | null; // median inter-set rest derived from set timestamps
}

export interface CardioHistory {
  exerciseName: string;
  totalSessions: number;
  recentSessions: number;
  avgDurationSeconds: number;
  avgSpeed: number | null;
  avgIncline: number | null;
  lastDurationSeconds: number;
  lastSpeed: number | null;
  lastIncline: number | null;
  trendDuration: 'increasing' | 'stable' | 'decreasing';
  trendIntensity: 'increasing' | 'stable' | 'decreasing';
}

export interface ExerciseOrderProfile {
  exerciseName: string;
  avgNormalizedPosition: number;
  positionCategory: 'opener' | 'early' | 'middle' | 'late' | 'closer';
  sessions: number;
  muscleGroupsUsedWith: string[];
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
  const raw = (data ?? []) as WorkoutRecord[];
  return raw.map(w => ({
    ...w,
    workout_exercises: Array.isArray(w.workout_exercises)
      ? w.workout_exercises.map(ex => ({
          ...ex,
          workout_sets: Array.isArray(ex.workout_sets) ? ex.workout_sets : [],
        }))
      : [],
  }));
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
    const bp = (exerciseBodyMap.get(d.exerciseName) ?? '').toLowerCase();
    const isLower = ['legs', 'glutes', 'calves', 'quadriceps', 'hamstrings'].includes(bp);
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

  // Only count strength exercises regressing — cardio fluctuations are normal
  const regressing = exerciseProgressions.filter(e => e.status === 'regressing');
  if (regressing.length >= 5) {
    signals.push(`${regressing.length} exercises regressing simultaneously`);
  }

  // Use 21-day window and require steeper trends to avoid false positives
  const recent21 = health.slice(-21);
  if (recent21.length >= 14) {
    const hrvs = recent21.filter(h => h.hrv != null).map(h => h.hrv!);
    if (hrvs.length >= 10) {
      const hrvSlope = linearRegressionSlope(hrvs);
      const hrvMean = mean(hrvs);
      if (hrvSlope < 0 && Math.abs(hrvSlope * 7 / hrvMean) > 0.10) {
        signals.push('HRV trending significantly down over 3+ weeks');
      }
    }

    const rhrs = recent21.filter(h => h.resting_heart_rate != null).map(h => h.resting_heart_rate!);
    if (rhrs.length >= 10) {
      const rhrSlope = linearRegressionSlope(rhrs);
      const rhrMean = mean(rhrs);
      if (rhrSlope > 0 && Math.abs(rhrSlope * 7 / rhrMean) > 0.10) {
        signals.push('Resting HR trending significantly up over 3+ weeks');
      }
    }

    const sleeps = recent21.filter(h => h.sleep_duration != null).map(h => h.sleep_duration!);
    if (sleeps.length >= 10) {
      const sleepSlope = linearRegressionSlope(sleeps);
      const sleepMean = mean(sleeps);
      if (sleepSlope < 0 && Math.abs(sleepSlope * 7 / sleepMean) > 0.10) {
        signals.push('Sleep declining significantly over 3+ weeks');
      }
    }
  }

  return {
    needed: signals.length >= 3,
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
): Array<{ exerciseName: string; accumulatedRepsAtWeight: number; breakthroughWeight: number; readyForWeightJump: boolean; typicalRepsBeforeJump: number }> {
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

  const results: Array<{
    exerciseName: string; accumulatedRepsAtWeight: number; breakthroughWeight: number;
    readyForWeightJump: boolean; typicalRepsBeforeJump: number;
  }> = [];

  for (const [name, sets] of Object.entries(exerciseSessions)) {
    if (sets.length < 10) continue;

    const maxWeight = Math.max(...sets.map(s => s.weight));
    const subMaxSets = sets.filter(s => s.weight >= maxWeight * 0.9 && s.weight < maxWeight);
    const accumulatedReps = subMaxSets.reduce((sum, s) => sum + s.reps, 0);

    // Estimate typical reps accumulated before a weight jump from historical patterns
    const weightGroups = new Map<number, number>();
    for (const s of sets) {
      weightGroups.set(s.weight, (weightGroups.get(s.weight) ?? 0) + s.reps);
    }
    const typicalRepsBeforeJump = weightGroups.size > 2
      ? mean([...weightGroups.values()].slice(0, -1))
      : 50; // default threshold

    if (accumulatedReps > 0) {
      results.push({
        exerciseName: name,
        accumulatedRepsAtWeight: accumulatedReps,
        breakthroughWeight: maxWeight,
        readyForWeightJump: accumulatedReps >= typicalRepsBeforeJump,
        typicalRepsBeforeJump: Math.round(typicalRepsBeforeJump),
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
 * Detect training split from workout history.
 * Analyzes which muscle groups appear together in sessions and the rotation pattern.
 */
function detectTrainingSplit(
  workouts: WorkoutRecord[],
  exercises: EnrichedExercise[]
): DetectedSplit {
  const exerciseToGroup = new Map<string, Set<string>>();
  for (const ex of exercises) {
    const groups = new Set<string>();
    for (const m of ex.primary_muscles ?? []) {
      const g = MUSCLE_HEAD_TO_GROUP[m];
      if (g) groups.add(g);
    }
    if (groups.size > 0) exerciseToGroup.set(ex.name.toLowerCase(), groups);
  }

  // Extract muscle group sets per session
  const sessionProfiles: Array<{ date: string; dayOfWeek: number; groups: Set<string>; template: string | null }> = [];

  for (const w of workouts) {
    const groups = new Set<string>();
    for (const ex of w.workout_exercises) {
      const exGroups = exerciseToGroup.get(ex.exercise_name.toLowerCase());
      if (exGroups) exGroups.forEach(g => groups.add(g));
    }
    sessionProfiles.push({
      date: w.date,
      dayOfWeek: new Date(w.date).getDay(),
      groups,
      template: w.template_name,
    });
  }

  if (sessionProfiles.length < 6) {
    return { type: 'custom', confidence: 0, typicalRotation: [], nextRecommended: [], evidence: ['Not enough data to detect split'] };
  }

  const PUSH_GROUPS = new Set(['chest', 'anterior_deltoid', 'lateral_deltoid', 'triceps']);
  const PULL_GROUPS = new Set(['back_lats', 'back_upper', 'biceps', 'posterior_deltoid']);
  const LEG_GROUPS = new Set(['quadriceps', 'hamstrings', 'glutes', 'calves']);
  const UPPER_GROUPS = new Set([...PUSH_GROUPS, ...PULL_GROUPS]);

  // Classify each session
  type SessionClass = 'push' | 'pull' | 'legs' | 'upper' | 'lower' | 'full' | 'other';
  const classified: SessionClass[] = [];

  for (const sp of sessionProfiles) {
    const pushCount = [...sp.groups].filter(g => PUSH_GROUPS.has(g)).length;
    const pullCount = [...sp.groups].filter(g => PULL_GROUPS.has(g)).length;
    const legCount = [...sp.groups].filter(g => LEG_GROUPS.has(g)).length;
    const upperCount = [...sp.groups].filter(g => UPPER_GROUPS.has(g)).length;
    const total = sp.groups.size;

    if (total === 0) { classified.push('other'); continue; }

    // Full body: hits upper + lower significantly
    if (upperCount >= 2 && legCount >= 2) { classified.push('full'); continue; }
    // Push: mostly push muscles
    if (pushCount >= 2 && pullCount <= 1 && legCount <= 1) { classified.push('push'); continue; }
    // Pull: mostly pull muscles
    if (pullCount >= 2 && pushCount <= 1 && legCount <= 1) { classified.push('pull'); continue; }
    // Legs: mostly leg muscles
    if (legCount >= 2 && upperCount <= 1) { classified.push('legs'); continue; }
    // Upper: mostly upper body
    if (upperCount >= 3 && legCount <= 1) { classified.push('upper'); continue; }
    // Lower: mostly lower body
    if (legCount >= 2 && upperCount <= 1) { classified.push('lower'); continue; }
    classified.push('other');
  }

  // Count session types
  const counts: Record<string, number> = {};
  for (const c of classified) counts[c] = (counts[c] ?? 0) + 1;
  const total = classified.length;
  const evidence: string[] = [];

  // Detect PPL
  const pplCount = (counts.push ?? 0) + (counts.pull ?? 0) + (counts.legs ?? 0);
  const pplPct = pplCount / total;

  // Detect Upper/Lower
  const ulCount = (counts.upper ?? 0) + (counts.lower ?? 0);
  const ulPct = ulCount / total;

  // Detect Full Body
  const fullPct = (counts.full ?? 0) / total;

  let type: SplitType = 'custom';
  let confidence = 0;

  if (pplPct >= 0.7) {
    type = 'push_pull_legs';
    confidence = pplPct;
    evidence.push(`${Math.round(pplPct * 100)}% of sessions follow push/pull/legs pattern`);
  } else if (ulPct >= 0.7) {
    type = 'upper_lower';
    confidence = ulPct;
    evidence.push(`${Math.round(ulPct * 100)}% of sessions follow upper/lower pattern`);
  } else if (fullPct >= 0.6) {
    type = 'full_body';
    confidence = fullPct;
    evidence.push(`${Math.round(fullPct * 100)}% of sessions are full body`);
  } else {
    type = 'custom';
    confidence = 0.5;
    const parts = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`);
    evidence.push(`Mixed pattern: ${parts.join(', ')}`);
  }

  // Build typical rotation from recent sessions
  const recentClassified = classified.slice(-12);
  const rotation: string[] = [];
  const seen = new Set<string>();
  for (const c of recentClassified) {
    if (c !== 'other' && !seen.has(c)) {
      rotation.push(c);
      seen.add(c);
    }
  }

  // Determine what to train next based on what was trained recently
  const last3Sessions = classified.slice(-3);
  const last3Groups = sessionProfiles.slice(-3).flatMap(sp => [...sp.groups]);
  const recentGroupCounts: Record<string, number> = {};
  for (const g of last3Groups) recentGroupCounts[g] = (recentGroupCounts[g] ?? 0) + 1;

  let nextRecommended: string[] = [];

  if (type === 'push_pull_legs') {
    const lastType = last3Sessions[last3Sessions.length - 1];
    if (lastType === 'push') nextRecommended = ['pull'];
    else if (lastType === 'pull') nextRecommended = ['legs'];
    else if (lastType === 'legs') nextRecommended = ['push'];
    else nextRecommended = ['push'];
    evidence.push(`Last session was ${lastType} → next: ${nextRecommended[0]}`);
  } else if (type === 'upper_lower') {
    const lastType = last3Sessions[last3Sessions.length - 1];
    nextRecommended = lastType === 'upper' ? ['lower'] : ['upper'];
    evidence.push(`Last session was ${lastType} → next: ${nextRecommended[0]}`);
  } else {
    // For custom/full body, find least-recently-trained major groups
    const allMajorGroups = ['chest', 'back_lats', 'quadriceps', 'hamstrings', 'anterior_deltoid', 'biceps', 'triceps'];
    const sorted = allMajorGroups.sort((a, b) => (recentGroupCounts[a] ?? 0) - (recentGroupCounts[b] ?? 0));
    nextRecommended = sorted.slice(0, 3);
  }

  return { type, confidence, typicalRotation: rotation, nextRecommended, evidence };
}

/**
 * Compute day-of-week training patterns from history.
 */
function computeDayOfWeekPatterns(
  workouts: WorkoutRecord[],
  exercises: EnrichedExercise[]
): DayOfWeekPattern[] {
  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const exerciseToGroup = new Map<string, Set<string>>();
  for (const ex of exercises) {
    const groups = new Set<string>();
    for (const m of ex.primary_muscles ?? []) {
      const g = MUSCLE_HEAD_TO_GROUP[m];
      if (g) groups.add(g);
    }
    if (groups.size > 0) exerciseToGroup.set(ex.name.toLowerCase(), groups);
  }

  // Count weeks in history
  if (workouts.length === 0) return DAY_NAMES.map((name, i) => ({
    dayOfWeek: i, dayName: name, muscleGroupsTypical: [], templateNames: [],
    frequency: 0, avgExerciseCount: 0, isRestDay: true,
  }));

  const firstDate = new Date(workouts[0].date);
  const lastDate = new Date(workouts[workouts.length - 1].date);
  const totalWeeks = Math.max(1, Math.ceil((lastDate.getTime() - firstDate.getTime()) / (7 * 24 * 60 * 60 * 1000)));

  const dayData: Record<number, {
    workoutCount: number;
    muscleGroupCounts: Record<string, number>;
    templateCounts: Record<string, number>;
    exerciseCounts: number[];
  }> = {};

  for (let i = 0; i < 7; i++) {
    dayData[i] = { workoutCount: 0, muscleGroupCounts: {}, templateCounts: {}, exerciseCounts: [] };
  }

  for (const w of workouts) {
    const dow = new Date(w.date).getDay();
    const dd = dayData[dow];
    dd.workoutCount++;
    dd.exerciseCounts.push(w.workout_exercises.length);

    if (w.template_name) {
      dd.templateCounts[w.template_name] = (dd.templateCounts[w.template_name] ?? 0) + 1;
    }

    for (const ex of w.workout_exercises) {
      const groups = exerciseToGroup.get(ex.exercise_name.toLowerCase());
      if (groups) {
        for (const g of groups) {
          dd.muscleGroupCounts[g] = (dd.muscleGroupCounts[g] ?? 0) + 1;
        }
      }
    }
  }

  return DAY_NAMES.map((name, i) => {
    const dd = dayData[i];
    const frequency = dd.workoutCount / totalWeeks;
    const isRestDay = frequency < 0.25;

    // Get top muscle groups by frequency
    const sortedGroups = Object.entries(dd.muscleGroupCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([g]) => g);

    const sortedTemplates = Object.entries(dd.templateCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([t]) => t);

    return {
      dayOfWeek: i,
      dayName: name,
      muscleGroupsTypical: sortedGroups,
      templateNames: sortedTemplates,
      frequency: Math.round(frequency * 100) / 100,
      avgExerciseCount: dd.exerciseCounts.length > 0 ? Math.round(mean(dd.exerciseCounts) * 10) / 10 : 0,
      isRestDay,
    };
  });
}

/**
 * Compute exercise preferences with recency weighting.
 * More recent usage scores higher (exponential decay, half-life = 14 days).
 */
function computeExercisePreferences(workouts: WorkoutRecord[]): ExercisePreference[] {
  const now = Date.now();
  const HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;
  const LN2 = Math.log(2);

  interface SessionSnapshot {
    date: string;
    reps: number[];
    weights: number[];
    setCount: number;
    setTimestamps: number[];
  }

  const exerciseData: Record<string, {
    totalSessions: number;
    recentSessions: number;
    recencySum: number;
    lastUsed: number;
    totalSets: number;
    sessions: SessionSnapshot[];
  }> = {};

  const fourWeeksAgo = now - 28 * 24 * 60 * 60 * 1000;

  for (const w of workouts) {
    const wDate = new Date(w.date).getTime();
    const decayFactor = Math.exp(-LN2 * (now - wDate) / HALF_LIFE_MS);
    const isRecent = wDate >= fourWeeksAgo;

    for (const ex of w.workout_exercises) {
      const key = ex.exercise_name.toLowerCase();
      if (!exerciseData[key]) {
        exerciseData[key] = { totalSessions: 0, recentSessions: 0, recencySum: 0, lastUsed: 0, totalSets: 0, sessions: [] };
      }
      const d = exerciseData[key];
      d.totalSessions++;
      d.recencySum += decayFactor;
      d.totalSets += ex.workout_sets.length;
      if (isRecent) d.recentSessions++;
      if (wDate > d.lastUsed) d.lastUsed = wDate;

      const reps: number[] = [];
      const weights: number[] = [];
      const setTimestamps: number[] = [];
      let workingSets = 0;

      for (const s of ex.workout_sets) {
        if (s.reps != null && s.reps > 0) reps.push(s.reps);
        if (s.weight != null && s.weight > 0) weights.push(s.weight);
        if (s.logged_at) setTimestamps.push(new Date(s.logged_at).getTime());
        if ((s.weight != null && s.weight > 0) || (s.reps != null && s.reps > 0)) workingSets++;
      }

      d.sessions.push({ date: w.date, reps, weights, setCount: workingSets, setTimestamps });
    }
  }

  return Object.entries(exerciseData)
    .map(([name, d]) => {
      // Sort sessions chronologically for increment calculation
      const sorted = [...d.sessions].sort((a, b) => a.date.localeCompare(b.date));
      const recent = sorted.slice(-6); // last 6 sessions for learning

      // Learned reps: median of all reps across recent sessions
      const allRecentReps = recent.flatMap(s => s.reps);
      const learnedReps = allRecentReps.length >= 3
        ? median(allRecentReps)
        : null;

      // Learned sets: median working set count across recent sessions
      const recentSetCounts = recent.map(s => s.setCount).filter(c => c > 0);
      const learnedSets = recentSetCounts.length >= 2
        ? median(recentSetCounts)
        : null;

      // Learned weight: most recent session's median working weight
      const lastSession = recent[recent.length - 1];
      const learnedWeight = lastSession && lastSession.weights.length > 0
        ? median(lastSession.weights)
        : null;

      // Learned increment: median of non-zero weight changes between consecutive sessions
      const increments: number[] = [];
      for (let i = 1; i < sorted.length; i++) {
        const prevW = sorted[i - 1].weights;
        const currW = sorted[i].weights;
        if (prevW.length > 0 && currW.length > 0) {
          const prevMax = Math.max(...prevW);
          const currMax = Math.max(...currW);
          const diff = currMax - prevMax;
          if (diff !== 0) increments.push(Math.abs(diff));
        }
      }
      const learnedIncrement = increments.length >= 2
        ? median(increments)
        : null;

      // Learned rest: median inter-set gap from timestamps
      const allRestGaps: number[] = [];
      for (const s of recent) {
        const ts = s.setTimestamps.sort((a, b) => a - b);
        for (let i = 1; i < ts.length; i++) {
          const gap = (ts[i] - ts[i - 1]) / 1000;
          if (gap > 15 && gap < 600) allRestGaps.push(gap);
        }
      }
      const learnedRestSeconds = allRestGaps.length >= 3
        ? Math.round(median(allRestGaps))
        : null;

      return {
        exerciseName: name,
        totalSessions: d.totalSessions,
        recentSessions: d.recentSessions,
        recencyScore: Math.round(d.recencySum * 100) / 100,
        lastUsedDaysAgo: Math.round((now - d.lastUsed) / (24 * 60 * 60 * 1000)),
        avgSetsPerSession: Math.round((d.totalSets / d.totalSessions) * 10) / 10,
        isStaple: d.recentSessions >= 2,
        learnedReps,
        learnedSets,
        learnedWeight,
        learnedIncrement,
        learnedRestSeconds,
      };
    })
    .sort((a, b) => b.recencyScore - a.recencyScore);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Compute cardio exercise history — duration trends, intensity (speed/level/incline).
 */
function computeCardioHistory(
  workouts: WorkoutRecord[],
  exercises: EnrichedExercise[]
): CardioHistory[] {
  // Build cardio set from multiple sources — don't rely on a single tag
  const cardioNames = new Set(
    exercises.filter(e => e.ml_exercise_type === 'cardio').map(e => e.name.toLowerCase())
  );

  // Source 2: local muscle map (always has cardio tagged correctly)
  for (const w of workouts) {
    for (const ex of w.workout_exercises) {
      const key = ex.exercise_name.toLowerCase();
      if (cardioNames.has(key)) continue;
      const mapping = getExerciseMapping(ex.exercise_name);
      if (mapping?.exercise_type === 'cardio') {
        cardioNames.add(key);
      }
    }
  }

  // Source 3: heuristic — exercises with time data but no weight/reps are cardio
  for (const w of workouts) {
    for (const ex of w.workout_exercises) {
      const key = ex.exercise_name.toLowerCase();
      if (cardioNames.has(key)) continue;
      const sets = Array.isArray(ex.workout_sets) ? ex.workout_sets : [];
      const hasTime = sets.some(s => s.time != null && s.time > 0);
      const hasWeightOrReps = sets.some(s =>
        (s.weight != null && Number(s.weight) > 0) || (s.reps != null && Number(s.reps) > 0)
      );
      if (hasTime && !hasWeightOrReps) {
        cardioNames.add(key);
      }
    }
  }

  const data: Record<string, {
    durations: number[];
    speeds: number[];
    inclines: number[];
    dates: number[];
  }> = {};

  const fourWeeksAgo = Date.now() - 28 * 24 * 60 * 60 * 1000;

  for (const w of workouts) {
    const wTime = new Date(w.date).getTime();
    for (const ex of w.workout_exercises) {
      const key = ex.exercise_name.toLowerCase();
      if (!cardioNames.has(key)) continue;

      if (!data[key]) data[key] = { durations: [], speeds: [], inclines: [], dates: [] };
      const d = data[key];
      d.dates.push(wTime);

      let totalTime = 0;
      const sessSpeed: number[] = [];
      const sessIncline: number[] = [];

      for (const s of ex.workout_sets) {
        if (s.time != null && s.time > 0) totalTime += s.time;
        if (s.speed != null && s.speed > 0) sessSpeed.push(s.speed);
        if (s.incline != null && s.incline > 0) sessIncline.push(s.incline);
      }

      if (totalTime > 0) d.durations.push(totalTime);
      if (sessSpeed.length > 0) d.speeds.push(mean(sessSpeed));
      if (sessIncline.length > 0) d.inclines.push(mean(sessIncline));
    }
  }

  return Object.entries(data)
    .filter(([, d]) => d.durations.length >= 1)
    .map(([name, d]) => {
      const recentCount = d.dates.filter(t => t >= fourWeeksAgo).length;
      const avgDur = mean(d.durations);
      const lastDur = d.durations[d.durations.length - 1] ?? avgDur;

      const durSlope = d.durations.length >= 3 ? linearRegressionSlope(d.durations) : 0;
      const durMean = avgDur || 1;
      const normDurSlope = durSlope / durMean;

      const speedSlope = d.speeds.length >= 3 ? linearRegressionSlope(d.speeds) : 0;
      const speedMean = d.speeds.length > 0 ? mean(d.speeds) : 1;
      const normSpeedSlope = speedMean > 0 ? speedSlope / speedMean : 0;

      return {
        exerciseName: name,
        totalSessions: d.durations.length,
        recentSessions: recentCount,
        avgDurationSeconds: Math.round(avgDur),
        avgSpeed: d.speeds.length > 0 ? Math.round(mean(d.speeds) * 10) / 10 : null,
        avgIncline: d.inclines.length > 0 ? Math.round(mean(d.inclines) * 10) / 10 : null,
        lastDurationSeconds: Math.round(lastDur),
        lastSpeed: d.speeds.length > 0 ? d.speeds[d.speeds.length - 1] : null,
        lastIncline: d.inclines.length > 0 ? d.inclines[d.inclines.length - 1] : null,
        trendDuration: (normDurSlope > 0.02 ? 'increasing' : normDurSlope < -0.02 ? 'decreasing' : 'stable') as CardioHistory['trendDuration'],
        trendIntensity: (normSpeedSlope > 0.02 ? 'increasing' : normSpeedSlope < -0.02 ? 'decreasing' : 'stable') as CardioHistory['trendIntensity'],
      };
    })
    .sort((a, b) => b.recentSessions - a.recentSessions);
}

/**
 * Learn the user's preferred exercise ordering from their actual workout history.
 * For each exercise, computes normalized position (0 = always first, 1 = always last)
 * and categorizes it as opener/early/middle/late/closer.
 * This powers the workout engine's exercise sequencing.
 */
function computeExerciseOrderProfiles(
  workouts: WorkoutRecord[],
  exercises: EnrichedExercise[]
): ExerciseOrderProfile[] {
  const positionData: Record<string, { positions: number[]; coExercises: Set<string> }> = {};

  const exerciseGroupLookup = new Map<string, string[]>();
  for (const ex of exercises) {
    const groups = (ex.primary_muscles ?? [])
      .map(m => MUSCLE_HEAD_TO_GROUP[m])
      .filter(Boolean);
    exerciseGroupLookup.set(ex.name.toLowerCase(), groups);
  }

  for (const w of workouts) {
    const exList = w.workout_exercises;
    if (exList.length < 2) continue;

    const cardioFiltered = exList.filter(ex => {
      const enriched = exercises.find(e => e.name.toLowerCase() === ex.exercise_name.toLowerCase());
      return enriched?.ml_exercise_type !== 'cardio';
    });
    if (cardioFiltered.length < 2) continue;

    const allNamesInSession = new Set(cardioFiltered.map(e => e.exercise_name.toLowerCase()));

    for (let i = 0; i < cardioFiltered.length; i++) {
      const key = cardioFiltered[i].exercise_name.toLowerCase();
      const normalized = i / (cardioFiltered.length - 1);

      if (!positionData[key]) {
        positionData[key] = { positions: [], coExercises: new Set() };
      }
      positionData[key].positions.push(normalized);

      for (const other of allNamesInSession) {
        if (other !== key) positionData[key].coExercises.add(other);
      }
    }
  }

  return Object.entries(positionData)
    .map(([name, d]) => {
      const avg = mean(d.positions);
      let category: ExerciseOrderProfile['positionCategory'];
      if (avg <= 0.15) category = 'opener';
      else if (avg <= 0.35) category = 'early';
      else if (avg <= 0.65) category = 'middle';
      else if (avg <= 0.85) category = 'late';
      else category = 'closer';

      const groups = exerciseGroupLookup.get(name) ?? [];
      const coGroups = new Set<string>();
      for (const coEx of d.coExercises) {
        for (const g of exerciseGroupLookup.get(coEx) ?? []) coGroups.add(g);
      }

      return {
        exerciseName: name,
        avgNormalizedPosition: Math.round(avg * 1000) / 1000,
        positionCategory: category,
        sessions: d.positions.length,
        muscleGroupsUsedWith: Array.from(coGroups),
      };
    })
    .sort((a, b) => a.avgNormalizedPosition - b.avgNormalizedPosition);
}

/**
 * Compute structural imbalances.
 */
// ─── Rolling 30-Day Trends ────────────────────────────────────────────────

function classifyTrend(slopePct: number): TrendDirection {
  if (slopePct > 2) return 'up';
  if (slopePct < -2) return 'down';
  return 'flat';
}

function buildMetricTrend(dailyValues: number[]): MetricTrend {
  if (dailyValues.length === 0) {
    return { current: null, avg30d: null, slope: 0, slopePct: 0, direction: 'flat', dataPoints: 0 };
  }
  const current = dailyValues[dailyValues.length - 1];
  const avg = mean(dailyValues);
  const slope = linearRegressionSlope(dailyValues);
  const slopePerWeek = slope * 7;
  const slopePct = avg !== 0 ? (slopePerWeek / avg) * 100 : 0;
  return {
    current,
    avg30d: Math.round(avg * 100) / 100,
    slope: Math.round(slopePerWeek * 100) / 100,
    slopePct: Math.round(slopePct * 10) / 10,
    direction: classifyTrend(slopePct),
    dataPoints: dailyValues.length,
  };
}

function computeRolling30DayTrends(
  workouts: WorkoutRecord[],
  health: HealthRecord[],
  exercises: EnrichedExercise[],
  exerciseProgressions: ExerciseProgression[]
): Rolling30DayTrends {
  const today = new Date().toISOString().split('T')[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000).toISOString().split('T')[0];

  const recentHealth = health.filter(h => h.date >= thirtyDaysAgo && h.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  const recentWorkouts = workouts.filter(w => w.date >= thirtyDaysAgo && w.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date));

  // Health metric trends
  const sleepValues = recentHealth.filter(h => h.sleep_duration != null).map(h => h.sleep_duration!);
  const hrvValues = recentHealth.filter(h => h.hrv != null).map(h => h.hrv!);
  const rhrValues = recentHealth.filter(h => h.resting_heart_rate != null).map(h => h.resting_heart_rate!);
  const stepsValues = recentHealth.filter(h => h.steps != null).map(h => h.steps!);
  const weightValues = recentHealth.filter(h => h.weight != null).map(h => h.weight!);

  // Training frequency: sessions per week (bucket into 4 weeks)
  const weekBuckets: number[] = [0, 0, 0, 0];
  for (const w of recentWorkouts) {
    const daysAgo = daysBetween(w.date, today);
    const weekIdx = Math.min(Math.floor(daysAgo / 7), 3);
    weekBuckets[3 - weekIdx]++;
  }

  // Session duration trend (per workout)
  const durationValues = recentWorkouts.filter(w => w.duration != null).map(w => w.duration!);

  // Total weekly volume (sets per week)
  const weeklySetCounts: number[] = [0, 0, 0, 0];
  for (const w of recentWorkouts) {
    const daysAgo = daysBetween(w.date, today);
    const weekIdx = Math.min(Math.floor(daysAgo / 7), 3);
    const totalSets = w.workout_exercises.reduce((sum, ex) => {
      const sets = Array.isArray(ex.workout_sets) ? ex.workout_sets.length : 0;
      return sum + sets;
    }, 0);
    weeklySetCounts[3 - weekIdx] += totalSets;
  }

  // Body fat & lean mass
  const bfValues = recentHealth.filter(h => h.body_fat_percentage != null).map(h => h.body_fat_percentage!);
  const leanMassValues: number[] = [];
  for (const h of recentHealth) {
    if (h.weight != null && h.body_fat_percentage != null) {
      leanMassValues.push(h.weight * (1 - h.body_fat_percentage / 100));
    }
  }

  // Per-exercise strength trends (top 10 by recency from progressions)
  const topExercises = [...exerciseProgressions]
    .sort((a, b) => b.sessionsTracked - a.sessionsTracked)
    .slice(0, 10);

  // Track per-session aggregate strength for overall index
  const sessionStrengthIndices: number[] = [];
  const weeklyVolumeLoad: number[] = [0, 0, 0, 0];

  // Big 3 tracking
  const big3Patterns = {
    bench: /\bbench press\b/i,
    squat: /\b(?:back |barbell )?squat\b(?!.*front)/i,
    deadlift: /\b(?:conventional |barbell )?deadlift\b(?!.*romanian|.*rdl|.*sumo)/i,
  };
  const big3SessionValues: number[] = [];

  const exerciseTrends: ExerciseTrend[] = topExercises.map(prog => {
    const exWorkouts = recentWorkouts.filter(w =>
      w.workout_exercises.some(e => e.exercise_name.toLowerCase() === prog.exerciseName)
    );

    const e1rmValues: number[] = [];
    const volumeLoadByWeek: number[] = [0, 0, 0, 0];

    for (const w of exWorkouts) {
      const exRecord = w.workout_exercises.find(e => e.exercise_name.toLowerCase() === prog.exerciseName);
      if (!exRecord || !Array.isArray(exRecord.workout_sets)) continue;

      let sessionMax1RM = 0;
      let sessionVolLoad = 0;

      for (const s of exRecord.workout_sets) {
        if (s.weight != null && s.reps != null && s.reps > 0) {
          const e1rm = s.weight * (1 + s.reps / 30);
          if (e1rm > sessionMax1RM) sessionMax1RM = e1rm;
          sessionVolLoad += s.weight * s.reps;
        }
      }

      if (sessionMax1RM > 0) e1rmValues.push(sessionMax1RM);

      const daysAgo = daysBetween(w.date, today);
      const weekIdx = Math.min(Math.floor(daysAgo / 7), 3);
      volumeLoadByWeek[3 - weekIdx] += sessionVolLoad;
    }

    return {
      exerciseName: prog.exerciseName,
      estimated1RM: buildMetricTrend(e1rmValues),
      volumeLoad: buildMetricTrend(volumeLoadByWeek.filter(v => v > 0)),
    };
  });

  // Overall strength index + big 3 total + volume load — computed per session
  for (const w of recentWorkouts) {
    let sessionTotalE1RM = 0;
    let exerciseCount = 0;
    let sessionVolLoad = 0;
    const big3: Record<string, number> = {};

    for (const ex of w.workout_exercises) {
      if (!Array.isArray(ex.workout_sets)) continue;
      let bestE1RM = 0;

      for (const s of ex.workout_sets) {
        if (s.weight != null && s.reps != null && s.reps > 0) {
          const e1rm = s.weight * (1 + s.reps / 30);
          if (e1rm > bestE1RM) bestE1RM = e1rm;
          sessionVolLoad += s.weight * s.reps;
        }
      }

      if (bestE1RM > 0) {
        sessionTotalE1RM += bestE1RM;
        exerciseCount++;
      }

      const exName = ex.exercise_name.toLowerCase();
      for (const [lift, pattern] of Object.entries(big3Patterns)) {
        if (pattern.test(exName) && bestE1RM > (big3[lift] ?? 0)) {
          big3[lift] = bestE1RM;
        }
      }
    }

    if (exerciseCount > 0) {
      sessionStrengthIndices.push(sessionTotalE1RM);
    }

    if (Object.keys(big3).length === 3) {
      big3SessionValues.push(big3.bench + big3.squat + big3.deadlift);
    }

    const daysAgo = daysBetween(w.date, today);
    const weekIdx = Math.min(Math.floor(daysAgo / 7), 3);
    weeklyVolumeLoad[3 - weekIdx] += sessionVolLoad;
  }

  // Relative strength: total strength index / body weight (per session, using closest weight)
  const relativeStrengthValues: number[] = [];
  if (weightValues.length > 0) {
    const latestWeight = weightValues[weightValues.length - 1];
    for (const si of sessionStrengthIndices) {
      relativeStrengthValues.push(Math.round((si / latestWeight) * 100) / 100);
    }
  }

  // Per-muscle-group weekly sets trend
  const muscleGroupWeekly: Record<string, number[]> = {};

  for (const w of recentWorkouts) {
    const daysAgo = daysBetween(w.date, today);
    const weekIdx = Math.min(Math.floor(daysAgo / 7), 3);

    for (const ex of w.workout_exercises) {
      const mapping = getExerciseMapping(ex.exercise_name);
      if (!mapping) continue;

      const groups = (mapping.primary_muscles || []).map(m => MUSCLE_HEAD_TO_GROUP[m]).filter(Boolean);
      const uniqueGroups = [...new Set(groups)];
      const setCount = Array.isArray(ex.workout_sets) ? ex.workout_sets.filter((s: SetRecord) => s.weight != null || s.reps != null).length : 0;

      for (const g of uniqueGroups) {
        if (!muscleGroupWeekly[g]) muscleGroupWeekly[g] = [0, 0, 0, 0];
        muscleGroupWeekly[g][3 - weekIdx] += setCount;
      }
    }
  }

  const muscleGroupTrends: MuscleGroupTrend[] = Object.entries(muscleGroupWeekly)
    .map(([muscleGroup, weeklySets]) => ({
      muscleGroup,
      weeklySetsTrend: buildMetricTrend(weeklySets),
    }))
    .sort((a, b) => (b.weeklySetsTrend.avg30d ?? 0) - (a.weeklySetsTrend.avg30d ?? 0));

  return {
    sleep: buildMetricTrend(sleepValues),
    hrv: buildMetricTrend(hrvValues),
    rhr: buildMetricTrend(rhrValues),
    steps: buildMetricTrend(stepsValues),
    bodyWeight: buildMetricTrend(weightValues),
    bodyFat: buildMetricTrend(bfValues),
    estimatedLeanMass: buildMetricTrend(leanMassValues),
    totalStrengthIndex: buildMetricTrend(sessionStrengthIndices),
    big3Total: buildMetricTrend(big3SessionValues),
    relativeStrength: buildMetricTrend(relativeStrengthValues),
    totalVolumeLoad: buildMetricTrend(weeklyVolumeLoad),
    trainingFrequency: buildMetricTrend(weekBuckets),
    avgSessionDuration: buildMetricTrend(durationValues),
    totalWeeklyVolume: buildMetricTrend(weeklySetCounts),
    exerciseTrends,
    muscleGroupTrends,
  };
}

// ─── Cumulative Sleep Debt ─────────────────────────────────────────────────

function computeCumulativeSleepDebt(health: HealthRecord[]): TrainingProfile['cumulativeSleepDebt'] {
  const sorted = [...health].filter(h => h.sleep_duration != null).sort(
    (a, b) => b.date.localeCompare(a.date)
  );

  if (sorted.length < 7) {
    return { rolling3dAvgHours: null, rolling7dAvgHours: null, sleepDebt3d: null, sleepDebt7d: null, recoveryModifier: 1.0 };
  }

  const recent3 = sorted.slice(0, 3).map(h => h.sleep_duration!);
  const recent7 = sorted.slice(0, 7).map(h => h.sleep_duration!);
  const baseline30 = sorted.slice(0, 30).map(h => h.sleep_duration!);

  const avg3 = recent3.reduce((a, b) => a + b, 0) / recent3.length;
  const avg7 = recent7.reduce((a, b) => a + b, 0) / recent7.length;
  const baselineAvg = baseline30.reduce((a, b) => a + b, 0) / baseline30.length;

  const debt3 = avg3 - baselineAvg;
  const debt7 = avg7 - baselineAvg;

  // Recovery modifier: each hour of cumulative sleep debt below baseline reduces capacity
  const debtHours = Math.min(0, debt7);
  const recoveryModifier = Math.max(0.75, 1.0 + debtHours * 0.05);

  return {
    rolling3dAvgHours: Math.round(avg3 * 10) / 10,
    rolling7dAvgHours: Math.round(avg7 * 10) / 10,
    sleepDebt3d: Math.round(debt3 * 10) / 10,
    sleepDebt7d: Math.round(debt7 * 10) / 10,
    recoveryModifier: Math.round(recoveryModifier * 100) / 100,
  };
}

// ─── Exercise Rotation Status ─────────────────────────────────────────────

function computeExerciseRotation(
  workouts: WorkoutRecord[],
  exercises: EnrichedExercise[]
): TrainingProfile['exerciseRotation'] {
  const sorted = [...workouts].sort((a, b) => b.date.localeCompare(a.date));
  const now = new Date();

  const exerciseMap = new Map<string, { weeks: Set<number>; lastSeen: string; type: string }>();

  for (const w of sorted) {
    const weekNum = Math.floor(daysBetween(w.date, now.toISOString().split('T')[0]) / 7);
    if (weekNum > 12) break; // only look at last 12 weeks

    for (const ex of w.workout_exercises) {
      const key = ex.exercise_name.toLowerCase();
      if (!exerciseMap.has(key)) {
        const libEx = exercises.find(e => e.name.toLowerCase() === key);
        exerciseMap.set(key, {
          weeks: new Set(),
          lastSeen: w.date,
          type: libEx?.ml_exercise_type ?? 'unknown',
        });
      }
      exerciseMap.get(key)!.weeks.add(weekNum);
    }
  }

  const results: TrainingProfile['exerciseRotation'] = [];
  for (const [name, data] of exerciseMap) {
    const weeksArr = Array.from(data.weeks).sort((a, b) => a - b);
    let consecutiveFromRecent = 0;
    for (let i = 0; i < weeksArr.length; i++) {
      if (weeksArr[i] === i) consecutiveFromRecent++;
      else break;
    }

    const rotationThreshold = data.type === 'compound' ? 8 : 4;
    const shouldRotate = consecutiveFromRecent >= rotationThreshold;

    let suggestedAction = '';
    if (shouldRotate && data.type === 'compound') {
      suggestedAction = `Used ${consecutiveFromRecent} consecutive weeks — consider a variation for 2-4 weeks`;
    } else if (shouldRotate) {
      suggestedAction = `Used ${consecutiveFromRecent} consecutive weeks — rotate for a fresh stimulus`;
    }

    if (consecutiveFromRecent >= 3) {
      results.push({
        exerciseName: name,
        consecutiveWeeksUsed: consecutiveFromRecent,
        shouldRotate,
        suggestedAction,
      });
    }
  }

  return results.sort((a, b) => b.consecutiveWeeksUsed - a.consecutiveWeeksUsed);
}

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
    supabase.from('user_preferences').select('*').eq('user_id', userId).maybeSingle(),
  ]);
  const userGender = prefsResult?.data?.gender ?? null;
  const userRecoverySpeed = prefsResult?.data?.recovery_speed != null ? Number(prefsResult.data.recovery_speed) : 1.0;
  const userExperienceLevel: string | null = prefsResult?.data?.experience_level ?? null;
  const userBodyWeightLbs = prefsResult?.data?.body_weight_lbs != null ? Number(prefsResult.data.body_weight_lbs) : null;
  const userWeightGoalLbs = prefsResult?.data?.weight_goal_lbs != null ? Number(prefsResult.data.weight_goal_lbs) : null;

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
        category: isCardio ? 'Cardio' : undefined,
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

  // #4: Compute individual recovery rates first, pass into recovery model
  const individualRecoveryRates = computeIndividualRecoveryRates(workouts, exercises);

  const muscleRecovery = computeAllRecoveryStatuses(
    Array.from(latestRecords.values()),
    recoveryCtx,
    individualRecoveryRates,
    new Date(),
    userRecoverySpeed,
    DEFAULT_MODEL_CONFIG.muscleReadyThreshold * 100
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
    gender: userGender,

    detectedSplit: detectTrainingSplit(workouts, exercises),
    dayOfWeekPatterns: computeDayOfWeekPatterns(workouts, exercises),
    exercisePreferences: computeExercisePreferences(workouts),
    cardioHistory: computeCardioHistory(workouts, exercises),
    exerciseOrderProfiles: computeExerciseOrderProfiles(workouts, exercises),

    cumulativeSleepDebt: computeCumulativeSleepDebt(health),
    exerciseRotation: computeExerciseRotation(workouts, exercises),

    rolling30DayTrends: computeRolling30DayTrends(workouts, health, exercises, exerciseProgressions),

    // #1: Prescribed vs actual feedback loop
    prescribedVsActual: await computePrescribedVsActual(userId, workouts),

    // #4: Individual muscle recovery rates
    individualRecoveryRates: computeIndividualRecoveryRates(workouts, exercises),

    // #20: Banister fitness-fatigue model
    fitnessFatigueModel: computeFitnessFatigueModel(workouts),

    trainingFrequency: Math.round(trainingFrequency * 10) / 10,
    avgSessionDuration: Math.round(avgSessionDuration),
    trainingAgeDays: Math.round(trainingAgeDays),
    consistencyScore: Math.round(consistencyScore * 100) / 100,
  };
}

// #1: Compute prescribed vs actual compliance from generated_workouts
async function computePrescribedVsActual(userId: string, workouts: WorkoutRecord[]) {
  const defaultResult = { complianceRate: 1, avgWeightDeviation: 0, avgRepsDeviation: 0, exercisesCompleted: 0, exercisesSkipped: 0 };
  try {
    const supabase = requireSupabase();
    const linkedWorkouts = workouts.filter(w => (w as any).generated_workout_id);
    if (linkedWorkouts.length === 0) return defaultResult;

    const genIds = linkedWorkouts.map(w => (w as any).generated_workout_id).filter(Boolean);
    const { data: generated } = await supabase
      .from('generated_workouts')
      .select('id, exercises')
      .in('id', genIds.slice(0, 20));

    if (!generated || generated.length === 0) return defaultResult;

    let totalPrescribed = 0, totalCompleted = 0, totalSkipped = 0;
    let weightDeviations: number[] = [], repsDeviations: number[] = [];

    for (const gen of generated) {
      const actual = linkedWorkouts.find(w => (w as any).generated_workout_id === gen.id);
      if (!actual) continue;
      const prescribedExercises: any[] = Array.isArray(gen.exercises) ? gen.exercises : [];
      const actualExNames = new Set(actual.workout_exercises.map(e => e.exercise_name.toLowerCase()));

      for (const pe of prescribedExercises) {
        if (!pe.exerciseName) continue;
        totalPrescribed++;
        if (actualExNames.has(pe.exerciseName.toLowerCase())) {
          totalCompleted++;
          const actualEx = actual.workout_exercises.find(
            e => e.exercise_name.toLowerCase() === pe.exerciseName.toLowerCase()
          );
          if (actualEx && pe.targetWeight && pe.targetWeight > 0) {
            const actualSets = Array.isArray(actualEx.workout_sets) ? actualEx.workout_sets : [];
            const actualWeight = actualSets.find(s => s.weight)?.weight;
            if (actualWeight) weightDeviations.push((actualWeight - pe.targetWeight) / pe.targetWeight);
            const actualReps = actualSets.find(s => s.reps)?.reps;
            if (actualReps && pe.targetReps) repsDeviations.push(actualReps - pe.targetReps);
          }
        } else {
          totalSkipped++;
        }
      }
    }

    return {
      complianceRate: totalPrescribed > 0 ? totalCompleted / totalPrescribed : 1,
      avgWeightDeviation: weightDeviations.length > 0 ? mean(weightDeviations) : 0,
      avgRepsDeviation: repsDeviations.length > 0 ? mean(repsDeviations) : 0,
      exercisesCompleted: totalCompleted,
      exercisesSkipped: totalSkipped,
    };
  } catch {
    return defaultResult;
  }
}

// #4: Learn individual muscle group recovery rates from performance-after-rest patterns
function computeIndividualRecoveryRates(workouts: WorkoutRecord[], exercises: EnrichedExercise[]): Record<string, number> {
  const rates: Record<string, number> = {};
  if (workouts.length < 10) return rates;

  const exerciseBodyMap = new Map<string, string>();
  for (const ex of exercises) {
    const groups = (Array.isArray(ex.primary_muscles) ? ex.primary_muscles : [])
      .map(m => MUSCLE_HEAD_TO_GROUP[m])
      .filter(Boolean);
    if (groups.length > 0) exerciseBodyMap.set(ex.name.toLowerCase(), groups[0]);
  }

  // Track rest days between sessions for each muscle group
  const muscleLastTrained = new Map<string, string>();
  const muscleRestPerformance = new Map<string, Array<{ restDays: number; performedWell: boolean }>>();

  for (const w of workouts) {
    const musclesThisSession = new Set<string>();
    for (const ex of w.workout_exercises) {
      const group = exerciseBodyMap.get(ex.exercise_name.toLowerCase());
      if (!group) continue;
      musclesThisSession.add(group);

      const lastDate = muscleLastTrained.get(group);
      if (lastDate) {
        const restDays = daysBetween(lastDate, w.date);
        if (restDays > 0 && restDays < 14) {
          const sets = Array.isArray(ex.workout_sets) ? ex.workout_sets : [];
          const hasGoodPerformance = sets.some(s => s.reps && s.reps >= 6);
          if (!muscleRestPerformance.has(group)) muscleRestPerformance.set(group, []);
          muscleRestPerformance.get(group)!.push({ restDays, performedWell: hasGoodPerformance });
        }
      }
    }
    for (const group of musclesThisSession) muscleLastTrained.set(group, w.date);
  }

  for (const [group, data] of muscleRestPerformance) {
    if (data.length < 5) continue;
    const goodRest = data.filter(d => d.performedWell).map(d => d.restDays);
    const badRest = data.filter(d => !d.performedWell).map(d => d.restDays);
    if (goodRest.length >= 3) {
      const avgGoodRest = mean(goodRest);
      const avgBadRest = badRest.length > 0 ? mean(badRest) : avgGoodRest;
      // If user performs well with shorter rest, they recover faster (multiplier > 1)
      const baselineRecoveryDays = 2; // ~48h for most groups
      rates[group] = Math.max(0.5, Math.min(2.0, baselineRecoveryDays / Math.max(avgGoodRest, 0.5)));
    }
  }

  return rates;
}

// #20: Banister fitness-fatigue model — dual-factor model for readiness
function computeFitnessFatigueModel(workouts: WorkoutRecord[]) {
  const FITNESS_TAU = 42; // fitness time constant (days) — slow decay
  const FATIGUE_TAU = 7;  // fatigue time constant (days) — fast decay

  let fitness = 0, fatigue = 0;
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  const sorted = [...workouts].sort((a, b) => a.date.localeCompare(b.date));

  for (const w of sorted) {
    const daysAgo = daysBetween(w.date, todayStr);
    if (daysAgo < 0) continue;

    // Training impulse: duration × perceived effort (or estimate from volume)
    const duration = w.duration ? w.duration / 60 : 45;
    const effort = (w as any).perceived_effort ?? 6;
    const impulse = duration * effort / 60; // normalized training load

    fitness += impulse * Math.exp(-daysAgo / FITNESS_TAU);
    fatigue += impulse * Math.exp(-daysAgo / FATIGUE_TAU);
  }

  const performance = fitness - fatigue;
  const maxPerformance = Math.max(fitness, 1);
  const readiness = Math.max(0, Math.min(1, 0.5 + (performance / maxPerformance) * 0.5));

  return {
    fitnessLevel: Math.round(fitness * 10) / 10,
    fatigueLevel: Math.round(fatigue * 10) / 10,
    performancePrediction: Math.round(performance * 10) / 10,
    readiness: Math.round(readiness * 100) / 100,
  };
}
