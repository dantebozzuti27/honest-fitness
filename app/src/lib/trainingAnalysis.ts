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
import { getAllConnectedAccounts } from './wearables';
import {
  computeAllRecoveryStatuses,
  exercisesToMuscleGroupRecords,
  type RecoveryContext,
  type MuscleRecoveryStatus,
  type MuscleGroupTrainingRecord,
} from './recoveryModel';
import { getExerciseMapping } from './exerciseMuscleMap';
import { localDayOfWeek } from '../utils/dateUtils';
import strengthStandardsData from './strengthStandards.json';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WorkoutRecord {
  id: string;
  date: string;
  created_at: string;
  duration: number | null;
  template_name: string | null;
  perceived_effort: number | null;
  session_rpe: number | null;
  session_type: string;
  workout_avg_hr: number | null;
  workout_peak_hr: number | null;
  workout_hr_zones: Record<string, number> | null;
  workout_calories_burned: number | null;
  generated_workout_id: string | null;
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
  is_warmup?: boolean;
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
  active_minutes_fairly: number | null;
  active_minutes_very: number | null;
  active_minutes_lightly: number | null;
  hr_zones_minutes: Record<string, number> | null;
  source_data?: Record<string, any> | null;
  source_provider?: string | null;
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

  // Energy expenditure (from wearables)
  caloriesBurned: MetricTrend;      // total daily calories (Fitbit TDEE)
  activeMinutes: MetricTrend;       // fairly + very active minutes combined

  // Overall strength progress
  totalStrengthIndex: MetricTrend;  // sum of e1RM across all tracked lifts per session
  big3Total: MetricTrend;           // sum of top 3 exercise e1RMs per session (any lifts)
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
  featureSnapshotId: string;
  canonicalModelContext: {
    version: string;
    adherenceScore: number;
    progressionScore: number;
    sessionFitScore: number;
    recoveryReadinessScore: number;
    evidenceConfidence: number;
    objectiveUtility: number;
  };

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
  // Health Percentiles (population norms for HRV, RHR, sleep, steps)
  healthPercentiles: HealthPercentile[];
  // Synthesized athlete profile
  athleteProfile: AthleteProfile;
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
    avgSessionOutcomeScore: number; // 0-1 post-session label average
    outcomeSampleSize: number;  // number of post-session labels used
    avgSetExecutionAccuracy: number; // 0-1 average set-level target vs actual fidelity
    executionSampleSize: number; // number of set-level labels used
    muscleGroupExecutionDeltas: Record<string, {
      completionRate: number;
      avgWeightDeviation: number;
      avgRepsDeviation: number;
      sampleSize: number;
      prescribedCount: number;
      completedCount: number;
    }>;
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

  // ML v2: Exercise Swap Learning
  exerciseSwapHistory: Array<{
    exerciseName: string;
    swapCount: number;
    lastSwapDate: string;
  }>;

  // ML v2: HRV-Gated Intensity
  hrvIntensityModifier: {
    todayHrv: number | null;
    rolling7dHrv: number | null;
    zScore: number;
    intensityMultiplier: number;
    recommendation: string;
  };

  // ML v2: Progression Forecasting
  progressionForecasts: Array<{
    exerciseName: string;
    currentE1RM: number;
    predictedNextE1RM: number;
    predictedTargetWeight: number;
    confidence: number;
    sessionsUntilMilestone: number | null;
  }>;

  // ML v2: HR Intensity Scoring
  workoutIntensityScores: Array<{
    workoutId: string;
    date: string;
    avgHr: number | null;
    peakHr: number | null;
    hrBasedIntensity: number;
    subjectiveRpe: number | null;
    rpeCalibration: number;
  }>;
  rpeCalibrationFactor: number;

  // ML v2: Movement Pattern Fatigue
  movementPatternFatigue: Array<{
    pattern: string;
    lastTrainedDate: string | null;
    hoursSinceLastTrained: number | null;
    weeklySessionCount: number;
    fatigueLevel: 'fresh' | 'moderate' | 'high';
  }>;

  // ML v2: Sleep Quality → Volume Modifier
  sleepVolumeModifier: {
    lastNightSleepHours: number | null;
    lastNightSleepQuality: 'poor' | 'fair' | 'good' | 'excellent' | null;
    volumeMultiplier: number;
    restTimeMultiplier: number;
    reason: string;
  };

  // Goal Progress
  goalProgress: GoalProgress | null;

  // Global
  trainingFrequency: number;
  avgSessionDuration: number;
  trainingAgeDays: number;
  consistencyScore: number;

  /** Per-muscle-group training frequency (sessions/week over last 14 days) */
  muscleGroupFrequency: Record<string, number>;

  /** LLM pattern observations from recent workouts (last 30 days) */
  llmPatternObservations: Array<{ pattern: string; suggestion: string; confidence: string }>;

  /** D2.1 — Data Collection summary fields */
  totalWorkoutCount: number;
  healthDataDays: number;
  connectedWearables: string[];
}

export interface GoalProgress {
  primaryGoal: string;
  goalLabel: string;
  signals: GoalSignal[];
  workoutAlignment: WorkoutAlignmentItem[];
  overallScore: number; // 0-100: how well current trajectory aligns with goal
  summary: string;
}

export interface GoalSignal {
  label: string;
  value: string;
  trend: 'positive' | 'negative' | 'neutral';
  detail: string;
  weight: number; // 0-1: importance to goal
}

export interface WorkoutAlignmentItem {
  factor: string;
  status: 'aligned' | 'partial' | 'misaligned';
  detail: string;
}

export interface StrengthPercentile {
  lift: string;
  estimated1RM: number;
  percentile: number;
  ageAdjustedPercentile: number | null; // percentile adjusted for age (higher for older lifters)
  bodyWeightClass: string;
}

export interface HealthPercentile {
  metric: string;
  label: string;
  value: number;
  unit: string;
  percentile: number;
  ageGroup: string;
  interpretation: string;
}

export interface AthleteProfileItem {
  category: 'strength' | 'weakness' | 'opportunity' | 'watch';
  area: string;        // e.g., "Upper Body Pushing", "Sleep Quality", "Training Consistency"
  detail: string;      // human-readable explanation
  dataPoints: string;  // supporting evidence
  priority: number;    // 1-10, higher = more important
}

export interface AthleteProfile {
  summary: string;
  overallScore: number; // 0-100 composite
  items: AthleteProfileItem[];
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
  const sinceStr = localDateStr(since);

  const isColumnError = (e: any) => e?.code === 'PGRST204' || (e && e.message?.includes('column'));

  let { data, error } = await supabase
    .from('workouts')
    .select(`
      id, date, created_at, duration, template_name, perceived_effort, session_rpe, session_type,
      workout_avg_hr, workout_peak_hr, workout_hr_zones, workout_calories_burned, generated_workout_id,
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

  if (isColumnError(error)) {
    const retry1 = await supabase
      .from('workouts')
      .select(`
        id, date, created_at, duration, template_name, perceived_effort, session_rpe, session_type,
        workout_avg_hr, workout_peak_hr, workout_hr_zones,
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

    if (isColumnError(retry1.error)) {
      // session_type or other migration columns don't exist — drop ALL migration columns AND the session_type filter
      const retry2 = await supabase
        .from('workouts')
        .select(`
          id, date, created_at, duration, template_name, perceived_effort,
          workout_exercises (
            exercise_name, body_part, exercise_library_id,
            workout_sets ( set_number, weight, reps, time, is_bodyweight, logged_at )
          )
        `)
        .eq('user_id', userId)
        .gte('date', sinceStr)
        .order('date', { ascending: true });
      data = (retry2.data || []).map((w: any) => ({
        ...w,
        session_rpe: null, session_type: 'workout',
        workout_avg_hr: null, workout_peak_hr: null, workout_hr_zones: null,
        workout_calories_burned: null, generated_workout_id: null,
      })) as any;
      error = retry2.error;
    } else {
      data = (retry1.data || []).map((w: any) => ({ ...w, workout_calories_burned: null, generated_workout_id: null })) as any;
      error = retry1.error;
    }
  }

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
  const sinceStr = localDateStr(since);

  // Try with extended columns first; fall back to base columns if migration hasn't run
  let { data, error } = await supabase
    .from('health_metrics')
    .select('date, weight, sleep_duration, sleep_score, hrv, resting_heart_rate, steps, calories_burned, body_fat_percentage, active_minutes_fairly, active_minutes_very, active_minutes_lightly, hr_zones_minutes, source_provider')
    .eq('user_id', userId)
    .gte('date', sinceStr)
    .order('date', { ascending: true });

  if (error?.code === 'PGRST204' || (error && error.message?.includes('column'))) {
    const retry = await supabase
      .from('health_metrics')
      .select('date, weight, sleep_duration, sleep_score, hrv, resting_heart_rate, steps, calories_burned, body_fat_percentage, source_provider')
      .eq('user_id', userId)
      .gte('date', sinceStr)
      .order('date', { ascending: true });
    data = (retry.data || []).map((h: any) => ({
      ...h,
      active_minutes_fairly: null,
      active_minutes_very: null,
      active_minutes_lightly: null,
      hr_zones_minutes: null,
    })) as any;
    error = retry.error;
  }

  if (error) throw error;
  return ((data || []) as HealthRecord[]).map(h => ({
    ...{ active_minutes_fairly: null, active_minutes_very: null, active_minutes_lightly: null, hr_zones_minutes: null },
    ...h,
  }));
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

/**
 * Date-aware linear regression: uses actual calendar days as X-axis instead of array indices.
 * Returns slope in units-per-day, which is correct regardless of data sparsity.
 *
 * The index-based version (`linearRegressionSlope`) treats each data point as 1 day apart.
 * If a user logs weight every 3 days, 30 points span 90 days but the index version
 * treats them as 30 days, producing a slope 3x too steep.
 */
/**
 * Heuristic warmup filter: within a single exercise, sets below 65% of the session's
 * peak weight are likely warmups. Returns only working sets.
 */
function filterWorkingSets<T extends { weight: number | null; reps: number | null; is_warmup?: boolean }>(sets: T[]): T[] {
  // If explicit warmup flags exist, use them
  if (sets.some(s => s.is_warmup === true)) {
    return sets.filter(s => s.is_warmup !== true);
  }
  // Heuristic fallback: sets below 65% of peak weight are likely warmups
  const withWeight = sets.filter(s => s.weight != null && s.weight > 0);
  if (withWeight.length <= 1) return sets;
  const maxWeight = Math.max(...withWeight.map(s => s.weight!));
  if (maxWeight <= 0) return sets;
  const threshold = maxWeight * 0.65;
  return sets.filter(s => {
    if (s.weight == null || s.weight <= 0) return true;
    return s.weight >= threshold;
  });
}

/**
 * Build a date→weight lookup from health records for per-date BW exercise calculation.
 * For dates without a direct weight entry, uses the most recent prior measurement.
 */
function buildWeightByDate(health: HealthRecord[]): Map<string, number> {
  const map = new Map<string, number>();
  const sorted = health.filter(h => h.weight != null).sort((a, b) => a.date.localeCompare(b.date));
  for (const h of sorted) map.set(h.date, h.weight!);
  return map;
}

function getWeightForDate(weightMap: Map<string, number>, targetDate: string, fallback: number | null): number | null {
  if (weightMap.has(targetDate)) return weightMap.get(targetDate)!;
  let closest: number | null = fallback;
  for (const [date, weight] of weightMap) {
    if (date <= targetDate) closest = weight;
    else break;
  }
  return closest;
}

function dateAwareSlopePerDay(entries: { date: string; value: number }[]): number {
  if (entries.length < 2) return 0;
  const t0 = new Date(entries[0].date + 'T12:00:00').getTime();
  const n = entries.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    const daysSinceFirst = (new Date(entries[i].date + 'T12:00:00').getTime() - t0) / 86_400_000;
    sumX += daysSinceFirst;
    sumY += entries[i].value;
    sumXY += daysSinceFirst * entries[i].value;
    sumXX += daysSinceFirst * daysSinceFirst;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

/**
 * Normalizes sleep_duration to hours.
 * Fitbit stores minutesAsleep (e.g. 420 for 7h); manual entry stores hours (e.g. 7.5).
 * The cleaning pipeline is bypassed in both paths, so the DB has mixed units.
 * Heuristic: any value > 24 is almost certainly minutes (nobody sleeps > 24 hours).
 */
function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function normalizeSleepHours(val: number | null | undefined): number | null {
  if (val == null) return null;
  return val > 24 ? val / 60 : val;
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((sum, v) => sum + (v - m) ** 2, 0) / (arr.length - 1));
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
  const workingSets = filterWorkingSets(sets);
  for (const s of workingSets) {
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
  // Parse as noon to avoid timezone-induced off-by-one errors with midnight
  const da = new Date(a.length <= 10 ? a + 'T12:00:00' : a);
  const db = new Date(b.length <= 10 ? b + 'T12:00:00' : b);
  return Math.abs((da.getTime() - db.getTime()) / (1000 * 60 * 60 * 24));
}

// ─── Feature Computations ───────────────────────────────────────────────────

function computePerformanceDeltas(
  workouts: WorkoutRecord[],
  healthByDate: Map<string, HealthRecord>,
  healthBaselines: Record<string, number>
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

    const prevDate = new Date(workout.date + 'T12:00:00');
    prevDate.setDate(prevDate.getDate() - 1);
    const prevDateStr = localDateStr(prevDate);
    const health = healthByDate.get(workout.date);
    const prevHealth = healthByDate.get(prevDateStr);

    const sleepHrs = normalizeSleepHours(health?.sleep_duration);
    const sleepDelta = sleepHrs != null && healthBaselines.sleep > 0
      ? (sleepHrs - healthBaselines.sleep) / healthBaselines.sleep
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
        const histMean = mean(recentHistory);
        const slope = linearRegressionSlope(recentHistory);
        // Normalize slope relative to mean to prevent blow-up with large volume loads
        const normSlope = histMean > 0 ? slope / histMean : 0;
        // Cap expected to ±20% of mean to prevent wild extrapolation
        expected = histMean * (1 + Math.max(-0.2, Math.min(0.2, normSlope)));
        if (expected <= 0) expected = histMean > 0 ? histMean : volumeLoad;
      }

      const delta = (history.length >= 3 && expected > 0) ? (volumeLoad - expected) / expected : 0;

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
    if (d.sleepDeltaFromBaseline == null) continue;
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
  // Use all weight entries. Fitbit is blocked from writing to the weight column
  // (see wearables.ts merge), so values here are from manual user input.
  const withWeight = health.filter(h => h.weight != null && h.date != null).slice(-60);
  if (withWeight.length === 0) {
    return { currentWeight: null, sevenDayAvg: null, slope: 0, phase: 'maintaining' };
  }

  const last7 = withWeight.slice(-7);
  const sevenDayAvg = mean(last7.map(h => h.weight!));
  const currentWeight = withWeight[withWeight.length - 1].weight;

  // Date-aware regression: uses actual calendar days, not array indices.
  const entries = withWeight.map(h => ({ date: h.date, value: h.weight! }));
  const slopePerDay = dateAwareSlopePerDay(entries);
  const slopePerWeek = slopePerDay * 7;

  // Cross-check: simple first-half vs second-half average comparison
  const half = Math.floor(withWeight.length / 2);
  const firstHalfAvg = mean(withWeight.slice(0, half).map(h => h.weight!));
  const secondHalfAvg = mean(withWeight.slice(half).map(h => h.weight!));
  const simpleDelta = secondHalfAvg - firstHalfAvg;

  // If regression and simple comparison disagree on direction, trust the simple comparison
  let effectiveSlope = slopePerWeek;
  if ((slopePerWeek > 0 && simpleDelta < -1) || (slopePerWeek < 0 && simpleDelta > 1)) {
    const firstDate = new Date(withWeight[0].date + 'T12:00:00');
    const lastDate = new Date(withWeight[withWeight.length - 1].date + 'T12:00:00');
    const weeks = Math.max(1, (lastDate.getTime() - firstDate.getTime()) / (7 * 86_400_000));
    effectiveSlope = simpleDelta / weeks;
  }

  let phase: 'cutting' | 'maintaining' | 'bulking';
  if (effectiveSlope < -0.3) phase = 'cutting';
  else if (effectiveSlope > 0.3) phase = 'bulking';
  else phase = 'maintaining';

  return { currentWeight, sevenDayAvg, slope: Math.round(effectiveSlope * 100) / 100, phase };
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
  const regressingThreshold = DEFAULT_MODEL_CONFIG.deloadRegressingExerciseThreshold;
  if (regressing.length >= regressingThreshold) {
    signals.push(`${regressing.length} exercises regressing simultaneously`);
  }

  // Use 21-day DATE window (not record count) to avoid sparse data spanning months
  const cutoff21 = new Date();
  cutoff21.setDate(cutoff21.getDate() - 21);
  const cutoff21Str = localDateStr(cutoff21);
  const recent21 = health.filter(h => h.date >= cutoff21Str);
  if (recent21.length >= 10) {
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

    const sleeps = recent21.filter(h => h.sleep_duration != null).map(h => normalizeSleepHours(h.sleep_duration)!);
    if (sleeps.length >= 10) {
      const sleepSlope = linearRegressionSlope(sleeps);
      const sleepMean = mean(sleeps);
      if (sleepSlope < 0 && Math.abs(sleepSlope * 7 / sleepMean) > 0.10) {
        signals.push('Sleep declining significantly over 3+ weeks');
      }
    }
  }

  return {
    needed: signals.length >= DEFAULT_MODEL_CONFIG.deloadSignalCountThreshold,
    signals,
    suggestedDurationDays: 7,
    suggestedVolumeMultiplier: 0.5,
  };
}

/**
 * Feature 9: Plateau detection per exercise.
 */
function computePlateauDetections(
  workouts: WorkoutRecord[],
  userBodyWeight?: number | null,
  weightByDate?: Map<string, number>
): PlateauDetection[] {
  const exerciseSessions: Record<string, Array<{ date: string; best1RM: number }>> = {};

  for (const w of workouts) {
    // Per-date BW for bodyweight exercise plateau tracking
    const bwForDate = weightByDate
      ? getWeightForDate(weightByDate, w.date, userBodyWeight ?? null)
      : userBodyWeight ?? null;

    for (const ex of w.workout_exercises) {
      const key = ex.exercise_name.toLowerCase();
      if (!exerciseSessions[key]) exerciseSessions[key] = [];

      const workingSets = filterWorkingSets(ex.workout_sets);
      let best = 0;
      for (const s of workingSets) {
        let effectiveWeight = s.weight;
        // Handle bodyweight exercises
        if ((s.is_bodyweight || effectiveWeight == null) && s.reps != null && s.reps > 0 && bwForDate && bwForDate > 0) {
          effectiveWeight = Math.round(bwForDate * getBWFraction(ex.exercise_name));
        }
        if (effectiveWeight != null && s.reps != null && effectiveWeight > 0) {
          best = Math.max(best, epley1RM(effectiveWeight, s.reps));
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
    // Use date-aware slope for unevenly spaced sessions
    const slopePerDay = dateAwareSlopePerDay(recent.map(s => ({ date: s.date, value: s.best1RM })));
    const slopePerWeek = slopePerDay * 7;
    const avg = mean(values);
    const normalizedSlope = avg > 0 ? slopePerWeek / avg : 0;

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
      const sets = filterWorkingSets(ex.workout_sets).length;
      weeklySets[group] = (weeklySets[group] ?? 0) + sets;

      const vol = computeVolumeLoad(ex.workout_sets, ex.exercise_name, userBodyWeight);
      const key = ex.exercise_name.toLowerCase();
      if (!exerciseHistory[key]) exerciseHistory[key] = [];
      const hist = exerciseHistory[key];
      if (hist.length >= 3 && vol > 0) {
        const expected = mean(hist.slice(-5));
        if (expected > 0) {
          const delta = (vol - expected) / expected;
          if (!weeklyDeltas[group]) weeklyDeltas[group] = [];
          weeklyDeltas[group].push(delta);
        }
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
    const weekIdx = Math.floor(daysBetween(w.date, localDateStr(fourWeeksAgo)) / 7);

    for (const ex of w.workout_exercises) {
      const muscles = exerciseToMuscles.get(ex.exercise_name.toLowerCase());
      if (!muscles) continue;

      // Cardio and recovery don't count toward hypertrophy volume (sets).
      // They DO count toward recovery fatigue (handled separately below).
      if (muscles.mlType === 'cardio' || muscles.mlType === 'recovery') continue;

      // Only count working sets (exclude warmups) for hypertrophy volume tracking
      const sets = filterWorkingSets(ex.workout_sets).length;

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
        groupIndirectSets[group] = (groupIndirectSets[group] ?? 0) + sets * 0.5; // sets already warmup-filtered
      }
    }
  }

  return VOLUME_GUIDELINES.map(guide => {
    const weekData = weekBuckets[guide.muscleGroup] ?? {};
    const weekValues = Object.values(weekData);
    const weeksWithData = Math.max(weekValues.length, 1);
    const totalSets = weekValues.reduce((a, b) => a + b, 0);
    const weekDivisor = Math.min(4, weeksWithData);
    const weeklyDirect = totalSets / weekDivisor;
    const weeklyIndirect = (groupIndirectSets[guide.muscleGroup] ?? 0) / weekDivisor;
    const mrv = individualMrv[guide.muscleGroup] ?? guide.mrv;

    let status: MuscleVolumeStatus['status'];
    if (weeklyDirect < guide.mev) status = 'below_mev';
    else if (weeklyDirect < guide.mavLow) status = 'in_mev_mav';
    else if (weeklyDirect <= guide.mavHigh) status = 'in_mav';
    else if (weeklyDirect <= mrv) status = 'approaching_mrv';
    else status = 'above_mrv';

    // Ensure all weeks are represented (fill gaps with 0) so regression sees actual spacing
    const weekIndices = Object.keys(weekData).map(Number).sort((a, b) => a - b);
    const maxWeek = weekIndices.length > 0 ? Math.max(...weekIndices) : 0;
    const trendValues: number[] = [];
    for (let wi = 0; wi <= maxWeek; wi++) {
      trendValues.push(weekData[wi] ?? 0);
    }
    const trendSlope = linearRegressionSlope(trendValues);
    let volumeTrend: 'increasing' | 'stable' | 'decreasing';
    if (trendSlope > 0.5) volumeTrend = 'increasing';
    else if (trendSlope < -0.5) volumeTrend = 'decreasing';
    else volumeTrend = 'stable';

    const lt = lastTrained[guide.muscleGroup];
    const daysSince = lt ? daysBetween(localDateStr(now), lt) : Infinity;

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
function computeExerciseProgressions(
  workouts: WorkoutRecord[],
  userBodyWeight?: number | null,
  weightByDate?: Map<string, number>
): ExerciseProgression[] {
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

      // Filter warmup sets before computing progressions
      const workingSets = filterWorkingSets(ex.workout_sets);

      let best1RM = 0;
      let bestWeight = 0;
      let bestReps = 0;
      let lastWeight = 0;

      // Per-date BW for historical accuracy
      const bwForDate = weightByDate
        ? getWeightForDate(weightByDate, w.date, userBodyWeight ?? null)
        : userBodyWeight ?? null;

      for (const s of workingSets) {
        let effectiveWeight = s.weight;

        if (s.is_bodyweight && bwForDate && bwForDate > 0) {
          effectiveWeight = Math.round(bwForDate * getBWFraction(ex.exercise_name));
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
/**
 * Age adjustment for strength percentiles.
 * OpenPowerlifting data is dominated by 20-35 year olds. A 50-year-old at the
 * raw 50th percentile is actually stronger relative to age peers.
 * Strength peaks at ~27 and declines ~0.5-1% per year after 35 (Meltzer, 1994;
 * Rana et al., 2008). We boost the percentile for older lifters accordingly.
 */
function ageStrengthAdjustment(rawPct: number, age: number | null): number | null {
  if (age == null || age <= 0) return null;
  if (age >= 25 && age <= 35) return rawPct; // peak years, no adjustment
  if (age < 25) {
    // Slightly reduce — hasn't reached peak yet, so same percentile is less impressive
    const yearsToReach = 25 - age;
    return Math.max(1, Math.round(rawPct - yearsToReach * 0.3));
  }
  // Over 35: boost because the reference population skews younger
  const yearsOver35 = age - 35;
  const boost = Math.min(15, yearsOver35 * 0.5);
  return Math.min(99, Math.round(rawPct + boost));
}

function computeStrengthPercentiles(
  exerciseProgressions: ExerciseProgression[],
  bodyWeight: number | null | undefined,
  gender: string | null | undefined,
  age: number | null = null,
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

  // ── Big 3 from OpenPowerlifting data ────────────────────────────────
  const big3Mappings: { lift: string; patterns: string[] }[] = [
    { lift: 'squat', patterns: ['squat', 'back squat', 'front squat'] },
    { lift: 'bench', patterns: ['bench press', 'barbell bench press'] },
    { lift: 'deadlift', patterns: ['deadlift', 'conventional deadlift', 'sumo deadlift'] },
  ];

  const results: StrengthPercentile[] = [];

  const findBest1RM = (patterns: string[]): number => {
    let best = 0;
    for (const prog of exerciseProgressions) {
      const name = prog.exerciseName.toLowerCase();
      if (patterns.some(p => name.includes(p)) && prog.estimated1RM > best) {
        best = prog.estimated1RM;
      }
    }
    return best;
  };

  const interpolateFromTable = (
    value: number,
    table: { p25: number; p50: number; p75: number; p90: number; p95: number }
  ): number => {
    const pts = [
      { pct: 25, val: table.p25 }, { pct: 50, val: table.p50 },
      { pct: 75, val: table.p75 }, { pct: 90, val: table.p90 }, { pct: 95, val: table.p95 },
    ];
    if (value >= pts[pts.length - 1].val) return 97;
    if (value <= pts[0].val) return Math.max(1, Math.round((value / pts[0].val) * 25));
    for (let i = 0; i < pts.length - 1; i++) {
      if (value >= pts[i].val && value < pts[i + 1].val) {
        const range = pts[i + 1].val - pts[i].val;
        const t = range > 0 ? (value - pts[i].val) / range : 0;
        return Math.round(pts[i].pct + t * (pts[i + 1].pct - pts[i].pct));
      }
    }
    return 50;
  };

  for (const { lift, patterns } of big3Mappings) {
    const liftData = classData[lift];
    if (!liftData) continue;
    const best1RM = findBest1RM(patterns);
    if (best1RM <= 0) continue;
    const rawPct = interpolateFromTable(best1RM, liftData);
    results.push({
      lift, estimated1RM: Math.round(best1RM),
      percentile: rawPct,
      ageAdjustedPercentile: ageStrengthAdjustment(rawPct, age),
      bodyWeightClass: `${bestClass} lbs`,
    });
  }

  // ── Additional lifts via body-weight ratio standards ───────────────
  // Source: ExRx strength standards, Symmetric Strength, and published
  // strength ratios. Percentile cutoffs expressed as multipliers of body
  // weight for the given lift. Gender-adjusted.
  const ratioStandards: {
    lift: string;
    patterns: string[];
    ratios: { M: { p25: number; p50: number; p75: number; p90: number; p95: number };
              F: { p25: number; p50: number; p75: number; p90: number; p95: number } };
  }[] = [
    {
      lift: 'overhead press',
      patterns: ['overhead press', 'ohp', 'military press', 'barbell shoulder press', 'standing press'],
      ratios: {
        M: { p25: 0.40, p50: 0.55, p75: 0.72, p90: 0.88, p95: 1.0 },
        F: { p25: 0.22, p50: 0.33, p75: 0.45, p90: 0.58, p95: 0.65 },
      },
    },
    {
      lift: 'barbell row',
      patterns: ['barbell row', 'bent over row', 'pendlay row', 'bb row'],
      ratios: {
        M: { p25: 0.50, p50: 0.70, p75: 0.90, p90: 1.10, p95: 1.25 },
        F: { p25: 0.30, p50: 0.45, p75: 0.60, p90: 0.75, p95: 0.85 },
      },
    },
    {
      lift: 'pull-up',
      patterns: ['pull-up', 'pullup', 'pull up', 'chin-up', 'chinup', 'chin up', 'weighted pull'],
      ratios: {
        M: { p25: 0.85, p50: 1.0, p75: 1.20, p90: 1.45, p95: 1.60 },
        F: { p25: 0.50, p50: 0.70, p75: 0.90, p90: 1.10, p95: 1.25 },
      },
    },
    {
      lift: 'dip',
      patterns: ['dip', 'weighted dip', 'chest dip', 'tricep dip'],
      ratios: {
        M: { p25: 0.90, p50: 1.05, p75: 1.30, p90: 1.55, p95: 1.70 },
        F: { p25: 0.50, p50: 0.70, p75: 0.90, p90: 1.10, p95: 1.25 },
      },
    },
    {
      lift: 'barbell curl',
      patterns: ['barbell curl', 'bb curl', 'ez bar curl', 'ez curl', 'standing curl'],
      ratios: {
        M: { p25: 0.25, p50: 0.38, p75: 0.50, p90: 0.62, p95: 0.70 },
        F: { p25: 0.15, p50: 0.23, p75: 0.32, p90: 0.40, p95: 0.45 },
      },
    },
    {
      lift: 'romanian deadlift',
      patterns: ['romanian deadlift', 'rdl', 'stiff leg deadlift', 'stiff-leg'],
      ratios: {
        M: { p25: 0.65, p50: 0.90, p75: 1.15, p90: 1.40, p95: 1.55 },
        F: { p25: 0.45, p50: 0.65, p75: 0.85, p90: 1.05, p95: 1.20 },
      },
    },
    {
      lift: 'leg press',
      patterns: ['leg press'],
      ratios: {
        M: { p25: 1.50, p50: 2.10, p75: 2.80, p90: 3.50, p95: 4.00 },
        F: { p25: 1.00, p50: 1.50, p75: 2.10, p90: 2.70, p95: 3.10 },
      },
    },
    {
      lift: 'lat pulldown',
      patterns: ['lat pulldown', 'lat pull down', 'cable pulldown'],
      ratios: {
        M: { p25: 0.50, p50: 0.70, p75: 0.88, p90: 1.05, p95: 1.15 },
        F: { p25: 0.30, p50: 0.45, p75: 0.60, p90: 0.75, p95: 0.85 },
      },
    },
    {
      lift: 'incline bench',
      patterns: ['incline bench', 'incline press', 'incline barbell', 'incline dumbbell press'],
      ratios: {
        M: { p25: 0.45, p50: 0.62, p75: 0.80, p90: 0.98, p95: 1.10 },
        F: { p25: 0.22, p50: 0.35, p75: 0.48, p90: 0.60, p95: 0.68 },
      },
    },
    {
      lift: 'hip thrust',
      patterns: ['hip thrust', 'barbell hip thrust', 'glute bridge'],
      ratios: {
        M: { p25: 0.80, p50: 1.10, p75: 1.50, p90: 1.90, p95: 2.20 },
        F: { p25: 0.70, p50: 1.00, p75: 1.40, p90: 1.80, p95: 2.10 },
      },
    },
  ];

  for (const std of ratioStandards) {
    const best1RM = findBest1RM(std.patterns);
    if (best1RM <= 0) continue;

    const genderRatios = std.ratios[sex as 'M' | 'F'];
    const table = {
      p25: genderRatios.p25 * bodyWeight,
      p50: genderRatios.p50 * bodyWeight,
      p75: genderRatios.p75 * bodyWeight,
      p90: genderRatios.p90 * bodyWeight,
      p95: genderRatios.p95 * bodyWeight,
    };

    const rawPct = interpolateFromTable(best1RM, table);
    results.push({
      lift: std.lift,
      estimated1RM: Math.round(best1RM),
      percentile: rawPct,
      ageAdjustedPercentile: ageStrengthAdjustment(rawPct, age),
      bodyWeightClass: `${bestClass} lbs`,
    });
  }

  results.sort((a, b) => b.percentile - a.percentile);

  return results;
}

// ─── Health Metric Population Norms ──────────────────────────────────────────
// Sources: AHA, CDC, Whoop population data, Oura ring studies, Fitbit aggregate data.
// Stratified by age group. Values represent percentile cutoffs.
// "higher is better" for HRV, sleep, steps; "lower is better" for RHR.

interface HealthNormTable {
  [ageGroup: string]: { p10: number; p25: number; p50: number; p75: number; p90: number };
}

// HRV (ms RMSSD) — higher is better. Source: Whoop population data, Shaffer & Ginsberg 2017
const HRV_NORMS: HealthNormTable = {
  '18-25': { p10: 30, p25: 45, p50: 65, p75: 90, p90: 120 },
  '26-35': { p10: 25, p25: 38, p50: 55, p75: 78, p90: 105 },
  '36-45': { p10: 20, p25: 30, p50: 45, p75: 65, p90: 88 },
  '46-55': { p10: 15, p25: 25, p50: 35, p75: 52, p90: 70 },
  '56-65': { p10: 12, p25: 20, p50: 30, p75: 42, p90: 58 },
  '65+':   { p10: 10, p25: 16, p50: 25, p75: 35, p90: 50 },
};

// Resting Heart Rate (bpm) — lower is better. Source: AHA, Fitbit aggregate studies
const RHR_NORMS: HealthNormTable = {
  '18-25': { p10: 52, p25: 57, p50: 65, p75: 72, p90: 80 },
  '26-35': { p10: 53, p25: 58, p50: 66, p75: 73, p90: 81 },
  '36-45': { p10: 54, p25: 59, p50: 67, p75: 74, p90: 82 },
  '46-55': { p10: 55, p25: 60, p50: 68, p75: 76, p90: 84 },
  '56-65': { p10: 54, p25: 59, p50: 67, p75: 75, p90: 83 },
  '65+':   { p10: 53, p25: 58, p50: 66, p75: 74, p90: 82 },
};

// Sleep duration (hours) — optimal range is 7-9h. Source: NSF, CDC BRFSS
const SLEEP_NORMS: HealthNormTable = {
  '18-25': { p10: 5.0, p25: 6.0, p50: 7.0, p75: 8.0, p90: 9.0 },
  '26-35': { p10: 5.0, p25: 6.0, p50: 7.0, p75: 7.8, p90: 8.5 },
  '36-45': { p10: 5.0, p25: 5.8, p50: 6.8, p75: 7.5, p90: 8.3 },
  '46-55': { p10: 4.8, p25: 5.5, p50: 6.5, p75: 7.3, p90: 8.0 },
  '56-65': { p10: 4.5, p25: 5.5, p50: 6.5, p75: 7.2, p90: 8.0 },
  '65+':   { p10: 4.5, p25: 5.2, p50: 6.2, p75: 7.0, p90: 7.8 },
};

// Daily steps — higher is better. Source: Fitbit aggregate data, Tudor-Locke 2011
const STEPS_NORMS: HealthNormTable = {
  '18-25': { p10: 3500, p25: 5500, p50: 8000, p75: 11000, p90: 14000 },
  '26-35': { p10: 3200, p25: 5000, p50: 7500, p75: 10500, p90: 13500 },
  '36-45': { p10: 3000, p25: 4800, p50: 7200, p75: 10000, p90: 13000 },
  '46-55': { p10: 2800, p25: 4500, p50: 6800, p75: 9500, p90: 12500 },
  '56-65': { p10: 2500, p25: 4000, p50: 6000, p75: 8500, p90: 11000 },
  '65+':   { p10: 2000, p25: 3200, p50: 4800, p75: 7000, p90: 9500 },
};

// Daily calories burned — higher generally indicates more active. Source: Fitbit, NHANES
const CALORIES_NORMS: { [gender: string]: HealthNormTable } = {
  M: {
    '18-25': { p10: 1800, p25: 2100, p50: 2500, p75: 3000, p90: 3500 },
    '26-35': { p10: 1750, p25: 2050, p50: 2450, p75: 2900, p90: 3400 },
    '36-45': { p10: 1700, p25: 2000, p50: 2400, p75: 2850, p90: 3300 },
    '46-55': { p10: 1650, p25: 1950, p50: 2300, p75: 2750, p90: 3200 },
    '56-65': { p10: 1600, p25: 1900, p50: 2200, p75: 2650, p90: 3000 },
    '65+':   { p10: 1500, p25: 1800, p50: 2100, p75: 2500, p90: 2800 },
  },
  F: {
    '18-25': { p10: 1400, p25: 1650, p50: 2000, p75: 2400, p90: 2800 },
    '26-35': { p10: 1380, p25: 1620, p50: 1950, p75: 2350, p90: 2750 },
    '36-45': { p10: 1350, p25: 1580, p50: 1900, p75: 2300, p90: 2700 },
    '46-55': { p10: 1300, p25: 1550, p50: 1850, p75: 2200, p90: 2600 },
    '56-65': { p10: 1250, p25: 1500, p50: 1800, p75: 2100, p90: 2500 },
    '65+':   { p10: 1200, p25: 1400, p50: 1700, p75: 2000, p90: 2300 },
  },
};

function getAgeGroup(age: number | null): string {
  if (!age || age < 18) return '26-35'; // default
  if (age <= 25) return '18-25';
  if (age <= 35) return '26-35';
  if (age <= 45) return '36-45';
  if (age <= 55) return '46-55';
  if (age <= 65) return '56-65';
  return '65+';
}

function interpolatePercentile(
  value: number,
  norms: { p10: number; p25: number; p50: number; p75: number; p90: number },
  higherIsBetter: boolean
): number {
  const points = [
    { pct: 10, val: norms.p10 },
    { pct: 25, val: norms.p25 },
    { pct: 50, val: norms.p50 },
    { pct: 75, val: norms.p75 },
    { pct: 90, val: norms.p90 },
  ];

  if (!higherIsBetter) {
    // For RHR: lower value = higher percentile. Invert the mapping.
    points.reverse();
    // After reversing: p90 val (low) → 10th pct, p10 val (high) → 90th pct
    // Re-label so lower values map to higher percentiles
    return interpolatePercentile(value, {
      p10: norms.p90, p25: norms.p75, p50: norms.p50, p75: norms.p25, p90: norms.p10,
    }, true);
  }

  if (value >= points[points.length - 1].val) {
    const overshoot = (value - points[points.length - 1].val) / (points[points.length - 1].val * 0.2);
    return Math.min(99, Math.round(90 + overshoot * 7));
  }
  if (value <= points[0].val) {
    const ratio = points[0].val > 0 ? value / points[0].val : 0;
    return Math.max(1, Math.round(ratio * 10));
  }

  for (let i = 0; i < points.length - 1; i++) {
    if (value >= points[i].val && value < points[i + 1].val) {
      const range = points[i + 1].val - points[i].val;
      const t = range > 0 ? (value - points[i].val) / range : 0;
      return Math.round(points[i].pct + t * (points[i + 1].pct - points[i].pct));
    }
  }
  return 50;
}

function getInterpretation(pct: number): string {
  if (pct >= 90) return 'excellent';
  if (pct >= 75) return 'good';
  if (pct >= 50) return 'average';
  if (pct >= 25) return 'below_average';
  return 'poor';
}

function computeHealthPercentiles(
  health: HealthRecord[],
  age: number | null,
  gender: string | null
): HealthPercentile[] {
  const results: HealthPercentile[] = [];
  const recent = health.slice(-30);
  if (recent.length < 3) return results;

  const ageGroup = getAgeGroup(age);
  const sex = (gender || 'M').toUpperCase().startsWith('F') ? 'F' : 'M';

  // HRV
  const hrvVals = recent.filter(h => h.hrv != null).map(h => h.hrv!);
  if (hrvVals.length >= 3) {
    const avg = hrvVals.reduce((s, v) => s + v, 0) / hrvVals.length;
    const norms = HRV_NORMS[ageGroup];
    if (norms) {
      const pct = interpolatePercentile(avg, norms, true);
      results.push({
        metric: 'hrv', label: 'HRV', value: Math.round(avg),
        unit: 'ms', percentile: pct, ageGroup, interpretation: getInterpretation(pct),
      });
    }
  }

  // RHR
  const rhrVals = recent.filter(h => h.resting_heart_rate != null).map(h => h.resting_heart_rate!);
  if (rhrVals.length >= 3) {
    const avg = rhrVals.reduce((s, v) => s + v, 0) / rhrVals.length;
    const norms = RHR_NORMS[ageGroup];
    if (norms) {
      const pct = interpolatePercentile(avg, norms, false);
      results.push({
        metric: 'rhr', label: 'Resting HR', value: Math.round(avg),
        unit: 'bpm', percentile: pct, ageGroup, interpretation: getInterpretation(pct),
      });
    }
  }

  // Sleep
  const sleepVals = recent.filter(h => h.sleep_duration != null).map(h => normalizeSleepHours(h.sleep_duration)!);
  if (sleepVals.length >= 3) {
    const avg = sleepVals.reduce((s, v) => s + v, 0) / sleepVals.length;
    const norms = SLEEP_NORMS[ageGroup];
    if (norms) {
      const pct = interpolatePercentile(avg, norms, true);
      results.push({
        metric: 'sleep', label: 'Sleep', value: Math.round(avg * 10) / 10,
        unit: 'hrs', percentile: pct, ageGroup, interpretation: getInterpretation(pct),
      });
    }
  }

  // Steps
  const stepsVals = recent.filter(h => h.steps != null).map(h => h.steps!);
  if (stepsVals.length >= 3) {
    const avg = stepsVals.reduce((s, v) => s + v, 0) / stepsVals.length;
    const norms = STEPS_NORMS[ageGroup];
    if (norms) {
      const pct = interpolatePercentile(avg, norms, true);
      results.push({
        metric: 'steps', label: 'Daily Steps', value: Math.round(avg),
        unit: 'steps', percentile: pct, ageGroup, interpretation: getInterpretation(pct),
      });
    }
  }

  // Calories burned
  const calVals = recent.filter(h => h.calories_burned != null).map(h => h.calories_burned!);
  if (calVals.length >= 3) {
    const avg = calVals.reduce((s, v) => s + v, 0) / calVals.length;
    const norms = CALORIES_NORMS[sex]?.[ageGroup];
    if (norms) {
      const pct = interpolatePercentile(avg, norms, true);
      results.push({
        metric: 'calories', label: 'Calories Burned', value: Math.round(avg),
        unit: 'kcal', percentile: pct, ageGroup, interpretation: getInterpretation(pct),
      });
    }
  }

  return results;
}

// ─── Athlete Profile Synthesis ───────────────────────────────────────────────

// Major body regions for coverage analysis.
// Each region maps to the muscle groups from VOLUME_GUIDELINES that represent it.
const BODY_REGIONS: { region: string; groups: string[] }[] = [
  { region: 'Upper Push', groups: ['chest', 'anterior_deltoid', 'lateral_deltoid', 'triceps'] },
  { region: 'Upper Pull', groups: ['back_lats', 'back_upper', 'posterior_deltoid', 'biceps'] },
  { region: 'Lower Body', groups: ['quadriceps', 'hamstrings', 'glutes', 'abductors', 'adductors', 'calves'] },
  { region: 'Core', groups: ['core', 'erector_spinae'] },
];

function computeAthleteProfile(
  strengthPercentiles: StrengthPercentile[],
  healthPercentiles: HealthPercentile[],
  muscleVolumeStatuses: MuscleVolumeStatus[],
  profile: {
    consistencyScore: number;
    trainingFrequency: number;
    avgSessionDuration: number;
    trainingAgeDays: number;
    imbalanceAlerts: ImbalanceAlert[];
    exerciseProgressions: ExerciseProgression[];
    rolling30DayTrends: Rolling30DayTrends;
    bodyWeightTrend: { phase: string; slope: number };
    cumulativeSleepDebt: { sleepDebt7d: number | null; recoveryModifier: number };
    fitnessFatigueModel: { readiness: number; fitnessLevel: number; fatigueLevel: number };
    plateauDetections: Array<{ exerciseName: string; isPlateaued: boolean; sessionsSinceProgress: number }>;
    age: number | null;
  }
): AthleteProfile {
  const items: AthleteProfileItem[] = [];
  const sleepDebtHours = profile.cumulativeSleepDebt.sleepDebt7d;
  const age = profile.age;

  for (const sp of strengthPercentiles) {
    const label = sp.lift.charAt(0).toUpperCase() + sp.lift.slice(1);
    const effectivePct = sp.ageAdjustedPercentile ?? sp.percentile;
    const ageNote = (sp.ageAdjustedPercentile != null && sp.ageAdjustedPercentile !== sp.percentile)
      ? ` (age-adjusted: ${sp.ageAdjustedPercentile}th)` : '';
    if (effectivePct >= 75) {
      items.push({
        category: 'strength', area: label, priority: effectivePct >= 90 ? 9 : 7,
        detail: `${label} is well above average for your weight class${age && age > 35 ? ' — especially strong for your age' : ''}`,
        dataPoints: `e1RM: ${sp.estimated1RM} lbs — ${sp.percentile}th percentile${ageNote}`,
      });
    } else if (effectivePct < 25) {
      items.push({
        category: 'weakness', area: label, priority: 8,
        detail: `${label} is significantly below population average — high ROI from focused training`,
        dataPoints: `e1RM: ${sp.estimated1RM} lbs — ${sp.percentile}th percentile${ageNote}`,
      });
    } else if (effectivePct < 50) {
      items.push({
        category: 'opportunity', area: label, priority: 5,
        detail: `${label} has room to grow — you're below the median for your weight class`,
        dataPoints: `e1RM: ${sp.estimated1RM} lbs — ${sp.percentile}th percentile${ageNote}`,
      });
    }
  }

  // Lift balance: compare across ALL percentiled lifts the user actually trains
  if (strengthPercentiles.length >= 2) {
    const sorted = [...strengthPercentiles].sort((a, b) => b.percentile - a.percentile);
    const strongest = sorted[0];
    const weakest = sorted[sorted.length - 1];
    const gap = strongest.percentile - weakest.percentile;
    if (gap > 30) {
      items.push({
        category: 'opportunity', area: 'Lift Balance',
        detail: `Large gap between strongest (${strongest.lift}: ${strongest.percentile}th) and weakest (${weakest.lift}: ${weakest.percentile}th) — prioritizing weaker lifts would raise your floor`,
        dataPoints: `${gap} percentile point spread across ${strengthPercentiles.length} tracked lifts`,
        priority: 6,
      });
    }
  }

  // ── Health metric analysis ────────────────────────────────────────
  for (const hp of healthPercentiles) {
    if (hp.percentile >= 75) {
      items.push({
        category: 'strength', area: hp.label, priority: hp.percentile >= 90 ? 8 : 6,
        detail: `${hp.label} is well above average for your age group`,
        dataPoints: `${hp.value} ${hp.unit} — ${hp.percentile}th percentile (age ${hp.ageGroup})`,
      });
    } else if (hp.percentile < 25) {
      items.push({
        category: 'weakness', area: hp.label, priority: hp.metric === 'sleep' ? 9 : 7,
        detail: hp.metric === 'sleep'
          ? 'Sleep is well below average — this directly limits recovery and strength gains'
          : hp.metric === 'hrv'
          ? 'HRV indicates high autonomic stress — recovery may be compromised'
          : `${hp.label} is below average for your age group`,
        dataPoints: `${hp.value} ${hp.unit} — ${hp.percentile}th percentile`,
      });
    } else if (hp.percentile < 50) {
      items.push({
        category: 'opportunity', area: hp.label, priority: 4,
        detail: `${hp.label} is below the median — small improvements here compound across training`,
        dataPoints: `${hp.value} ${hp.unit} — ${hp.percentile}th percentile`,
      });
    }
  }

  // ── Training behavior analysis ────────────────────────────────────
  if (profile.consistencyScore >= 0.85) {
    items.push({
      category: 'strength', area: 'Consistency', priority: 8,
      detail: 'Highly consistent training schedule — the single best predictor of long-term progress',
      dataPoints: `${Math.round(profile.consistencyScore * 100)}% consistency score, ${profile.trainingFrequency} days/week`,
    });
  } else if (profile.consistencyScore < 0.5) {
    items.push({
      category: 'weakness', area: 'Consistency', priority: 10,
      detail: 'Inconsistent training is the #1 limiter — even a perfect program fails without adherence',
      dataPoints: `${Math.round(profile.consistencyScore * 100)}% consistency score`,
    });
  }

  // Sleep debt
  if (sleepDebtHours != null && sleepDebtHours > 5) {
    items.push({
      category: 'watch', area: 'Sleep Debt', priority: 8,
      detail: `Accumulated ${Math.round(sleepDebtHours)}h of sleep debt — recovery is compromised until this is repaid`,
      dataPoints: `${Math.round(sleepDebtHours)}h below 7h baseline over recent days`,
    });
  }

  // Readiness
  if (profile.fitnessFatigueModel.readiness < 0.4) {
    items.push({
      category: 'watch', area: 'Accumulated Fatigue', priority: 7,
      detail: 'Fatigue is outpacing fitness — a deload or lighter week would accelerate long-term gains',
      dataPoints: `Readiness: ${Math.round(profile.fitnessFatigueModel.readiness * 100)}% (fitness: ${profile.fitnessFatigueModel.fitnessLevel}, fatigue: ${profile.fitnessFatigueModel.fatigueLevel})`,
    });
  } else if (profile.fitnessFatigueModel.readiness > 0.7) {
    items.push({
      category: 'strength', area: 'Recovery State', priority: 6,
      detail: 'Well-recovered — good position to push intensity or volume',
      dataPoints: `Readiness: ${Math.round(profile.fitnessFatigueModel.readiness * 100)}%`,
    });
  }

  // Plateaus
  const plateaued = profile.plateauDetections.filter(p => p.isPlateaued && p.sessionsSinceProgress >= 4);
  if (plateaued.length > 0) {
    const names = plateaued.slice(0, 3).map(p => p.exerciseName).join(', ');
    items.push({
      category: 'opportunity', area: 'Plateau Breaking', priority: 7,
      detail: `${plateaued.length} exercise${plateaued.length > 1 ? 's' : ''} plateaued — variation, rep scheme changes, or deload may break through`,
      dataPoints: names + (plateaued.length > 3 ? ` + ${plateaued.length - 3} more` : ''),
    });
  }

  // Progression rate across exercises
  const progressing = profile.exerciseProgressions.filter(p => p.status === 'progressing');
  const regressing = profile.exerciseProgressions.filter(p => p.status === 'regressing');
  if (progressing.length > regressing.length * 3 && progressing.length >= 3) {
    items.push({
      category: 'strength', area: 'Progressive Overload', priority: 7,
      detail: `${progressing.length} exercises actively progressing — your training stimulus is productive`,
      dataPoints: `${progressing.length} progressing, ${regressing.length} regressing, ${profile.exerciseProgressions.length - progressing.length - regressing.length} maintaining`,
    });
  } else if (regressing.length >= 3 && regressing.length > progressing.length) {
    items.push({
      category: 'watch', area: 'Regression', priority: 8,
      detail: `More exercises regressing than progressing — may need recovery focus, volume adjustment, or nutrition review`,
      dataPoints: `${regressing.length} regressing vs ${progressing.length} progressing`,
    });
  }

  // Imbalances
  if (profile.imbalanceAlerts.length > 0) {
    for (const alert of profile.imbalanceAlerts.slice(0, 2)) {
      items.push({
        category: 'opportunity', area: 'Muscle Balance', priority: 6,
        detail: alert.description,
        dataPoints: `Ratio: ${alert.ratio}:1 (target: ${alert.targetRatio}:1)`,
      });
    }
  }

  // Body composition phase
  const phase = profile.bodyWeightTrend.phase;
  if (phase === 'cutting' && regressing.length >= 2) {
    items.push({
      category: 'watch', area: 'Cut + Regression', priority: 7,
      detail: 'Weight is trending down while strength is regressing — may be cutting too aggressively',
      dataPoints: `Weight: ${profile.bodyWeightTrend.slope > 0 ? '+' : ''}${profile.bodyWeightTrend.slope} lbs/wk, ${regressing.length} exercises regressing`,
    });
  }

  // Training volume trends
  const t = profile.rolling30DayTrends;
  if (t.totalVolumeLoad.direction === 'up' && t.totalVolumeLoad.slopePct > 5) {
    items.push({
      category: 'strength', area: 'Volume Progression', priority: 5,
      detail: `Training volume is trending up ${t.totalVolumeLoad.slopePct.toFixed(1)}%/week — progressive overload is working`,
      dataPoints: `Current weekly volume: ${t.totalVolumeLoad.current?.toLocaleString() ?? 'N/A'} lbs`,
    });
  }

  // Training age opportunity
  if (profile.trainingAgeDays < 365) {
    items.push({
      category: 'opportunity', area: 'Novice Gains', priority: 6,
      detail: `Less than a year of tracked training — you have significant untapped potential for rapid progress`,
      dataPoints: `Training age: ${Math.round(profile.trainingAgeDays)} days`,
    });
  }

  // Age-specific insights
  if (age != null && age > 0) {
    if (age <= 25) {
      items.push({
        category: 'opportunity', area: 'Youth Advantage', priority: 5,
        detail: 'Under 25 — recovery capacity and hormonal environment favor aggressive progression',
        dataPoints: `Age: ${age}. Volume and progression rates automatically boosted.`,
      });
    } else if (age >= 40 && age < 55) {
      if (profile.trainingFrequency > 5) {
        items.push({
          category: 'watch', area: 'Training Frequency', priority: 6,
          detail: `Training ${profile.trainingFrequency} days/week at age ${age} — recovery needs increase with age; consider 4-5 days`,
          dataPoints: `Recovery rate automatically scaled down. Volume and progression adjusted.`,
        });
      }
      if (profile.consistencyScore >= 0.7) {
        items.push({
          category: 'strength', area: 'Masters Consistency', priority: 5,
          detail: `Consistent training at ${age} — the biggest advantage for lifters over 40`,
          dataPoints: `${Math.round(profile.consistencyScore * 100)}% consistency, ${profile.trainingFrequency} days/week`,
        });
      }
    } else if (age >= 55) {
      items.push({
        category: 'watch', area: 'Recovery Priority', priority: 7,
        detail: `At ${age}, recovery is the primary limiter — sleep quality and training frequency matter more than volume`,
        dataPoints: `Recovery, volume, and progression rates automatically adjusted for age`,
      });
    }
  }

  // ── Body coverage: are you training all major regions? ───────────
  const trainedGroups = new Set(
    muscleVolumeStatuses
      .filter(v => v.weeklyDirectSets + v.weeklyIndirectSets > 0)
      .map(v => v.muscleGroup)
  );

  const regionCoverage: { region: string; trained: boolean; trainedCount: number; totalCount: number }[] = [];
  for (const { region, groups } of BODY_REGIONS) {
    const trainedCount = groups.filter(g => trainedGroups.has(g)).length;
    regionCoverage.push({ region, trained: trainedCount > 0, trainedCount, totalCount: groups.length });
  }
  const trainedRegions = regionCoverage.filter(r => r.trained).length;
  const totalRegions = regionCoverage.length;
  const coverageRatio = trainedRegions / totalRegions; // 0.0 - 1.0

  const untrained = regionCoverage.filter(r => !r.trained);
  if (untrained.length > 0) {
    const regionNames = untrained.map(r => r.region).join(', ');
    items.push({
      category: 'weakness', area: 'Body Coverage', priority: 9,
      detail: `No training detected for ${regionNames} — this creates long-term imbalance and injury risk`,
      dataPoints: `${trainedRegions}/${totalRegions} body regions trained (missing: ${regionNames})`,
    });
  } else {
    items.push({
      category: 'strength', area: 'Body Coverage', priority: 6,
      detail: 'Training covers all major body regions — full-body development reduces injury risk',
      dataPoints: `${totalRegions}/${totalRegions} body regions trained`,
    });
  }

  // Sort: highest priority first within each category
  items.sort((a, b) => b.priority - a.priority);

  // ── Overall composite score ───────────────────────────────────────
  // Balanced across multiple dimensions — not dominated by raw strength.
  const sPcts = strengthPercentiles.map(s => s.percentile);
  const hPcts = healthPercentiles.map(h => h.percentile);
  const avgStrengthPct = sPcts.length > 0 ? sPcts.reduce((s, v) => s + v, 0) / sPcts.length : 50;
  const avgHealthPct = hPcts.length > 0 ? hPcts.reduce((s, v) => s + v, 0) / hPcts.length : 50;

  // Progression component: ratio of progressing exercises to total
  const totalTracked = profile.exerciseProgressions.length || 1;
  const progressionRate = progressing.length / totalTracked;

  // Balance: lift percentile spread (lower = better) AND body coverage
  const liftSpread = sPcts.length >= 2
    ? Math.max(...sPcts) - Math.min(...sPcts)
    : 0;
  const liftBalanceScore = Math.max(0, 100 - liftSpread);
  const coverageScore = coverageRatio * 100;
  const balanceScore = liftBalanceScore * 0.4 + coverageScore * 0.6;

  const overallScore = Math.min(99, Math.max(1, Math.round(
    avgStrengthPct * 0.15 +
    avgHealthPct * 0.15 +
    profile.consistencyScore * 20 +
    profile.fitnessFatigueModel.readiness * 10 +
    progressionRate * 15 +
    balanceScore * 0.25
  )));

  // ── Summary ───────────────────────────────────────────────────────
  const strengths = items.filter(i => i.category === 'strength');
  const weaknesses = items.filter(i => i.category === 'weakness');
  const topStrength = strengths[0]?.area ?? 'consistency';
  const topWeakness = weaknesses[0]?.area ?? null;
  const summaryParts = [`Overall score: ${overallScore}/100.`];
  if (topStrength) summaryParts.push(`Top strength: ${topStrength}.`);
  if (topWeakness) summaryParts.push(`Biggest opportunity: ${topWeakness}.`);
  if (plateaued.length > 0) summaryParts.push(`${plateaued.length} exercise${plateaued.length > 1 ? 's' : ''} plateaued.`);

  return { summary: summaryParts.join(' '), overallScore, items };
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
      dayOfWeek: localDayOfWeek(w.date),
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
    const dow = localDayOfWeek(w.date);
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

      // Filter warmup sets so learned weight/reps/sets reflect actual working data
      const filtered = filterWorkingSets(ex.workout_sets);
      for (const s of filtered) {
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

      // Learned weight: recency-weighted median of recent sessions (not just the last one,
      // which is too volatile — a single light day would drop the value)
      const sessionMedians = recent
        .filter(s => s.weights.length > 0)
        .map(s => median(s.weights));
      let learnedWeight: number | null = null;
      if (sessionMedians.length >= 3) {
        // Weighted average: most recent session gets 3x, second-most 2x, rest 1x
        const n = sessionMedians.length;
        let wSum = 0, wTotal = 0;
        for (let si = 0; si < n; si++) {
          const recencyWeight = si === n - 1 ? 3 : si === n - 2 ? 2 : 1;
          wSum += sessionMedians[si] * recencyWeight;
          wTotal += recencyWeight;
        }
        learnedWeight = wSum / wTotal;
      } else if (sessionMedians.length > 0) {
        learnedWeight = sessionMedians[sessionMedians.length - 1];
      }

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
const MIN_CARDIO_SET_SECONDS = 15;
const MAX_CARDIO_SET_SECONDS = 4 * 60 * 60;
const MAX_CARDIO_SPEED = 40;
const MAX_CARDIO_INCLINE = 40;

function sanitizeCardioSetSeconds(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;

  // Legacy guard: some clients persisted milliseconds as `time`.
  const seconds = n > 86_400 && n <= 86_400_000 ? n / 1000 : n;
  if (!Number.isFinite(seconds)) return null;
  if (seconds < MIN_CARDIO_SET_SECONDS || seconds > MAX_CARDIO_SET_SECONDS) return null;
  return Math.round(seconds);
}

function sanitizeCardioMetric(raw: unknown, maxValue: number): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n > maxValue) return null;
  return Math.round(n * 10) / 10;
}

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
      const hasTime = sets.some(s => sanitizeCardioSetSeconds(s.time) != null);
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
        const setSeconds = sanitizeCardioSetSeconds(s.time);
        if (setSeconds != null) totalTime += setSeconds;

        const speed = sanitizeCardioMetric(s.speed, MAX_CARDIO_SPEED);
        if (speed != null) sessSpeed.push(speed);

        const incline = sanitizeCardioMetric(s.incline, MAX_CARDIO_INCLINE);
        if (incline != null) sessIncline.push(incline);
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

function buildMetricTrend(dailyValues: number[], dates?: string[]): MetricTrend {
  if (dailyValues.length === 0) {
    return { current: null, avg30d: null, slope: 0, slopePct: 0, direction: 'flat', dataPoints: 0 };
  }
  const current = dailyValues[dailyValues.length - 1];
  const avg = mean(dailyValues);

  let slopePerDay: number;
  if (dates && dates.length === dailyValues.length) {
    const entries = dailyValues.map((v, i) => ({ date: dates[i], value: v }));
    slopePerDay = dateAwareSlopePerDay(entries);
  } else {
    slopePerDay = linearRegressionSlope(dailyValues);
  }

  const slopePerWeek = slopePerDay * 7;
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
  const today = localDateStr(new Date());
  const thirtyDaysAgo = localDateStr(new Date(Date.now() - 30 * 86400_000));

  const recentHealth = health.filter(h => h.date >= thirtyDaysAgo && h.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  const recentWorkouts = workouts.filter(w => w.date >= thirtyDaysAgo && w.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date));

  // Health metric trends — extract dates alongside values for date-aware regression
  const sleepEntries = recentHealth.filter(h => h.sleep_duration != null);
  const sleepValues = sleepEntries.map(h => normalizeSleepHours(h.sleep_duration)!);
  const sleepDates = sleepEntries.map(h => h.date);
  const hrvEntries = recentHealth.filter(h => h.hrv != null);
  const hrvValues = hrvEntries.map(h => h.hrv!);
  const hrvDates = hrvEntries.map(h => h.date);
  const rhrEntries = recentHealth.filter(h => h.resting_heart_rate != null);
  const rhrValues = rhrEntries.map(h => h.resting_heart_rate!);
  const rhrDates = rhrEntries.map(h => h.date);
  const stepsEntries = recentHealth.filter(h => h.steps != null);
  const stepsValues = stepsEntries.map(h => h.steps!);
  const stepsDates = stepsEntries.map(h => h.date);
  // Fitbit is blocked from writing weight (see wearables.ts), so all values are user-entered
  const weightEntries = recentHealth.filter(h => h.weight != null);
  const weightValues = weightEntries.map(h => h.weight!);
  const weightDates = weightEntries.map(h => h.date);
  const caloriesEntries = recentHealth.filter(h => h.calories_burned != null);
  const caloriesValues = caloriesEntries.map(h => h.calories_burned!);
  const caloriesDates = caloriesEntries.map(h => h.date);
  const activeMinEntries = recentHealth.filter(h => h.active_minutes_fairly != null || h.active_minutes_very != null);
  const activeMinValues = activeMinEntries.map(h => (h.active_minutes_fairly || 0) + (h.active_minutes_very || 0));
  const activeMinDates = activeMinEntries.map(h => h.date);

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

  // Top compound lifts: per session, take the best e1RM from each distinct exercise
  // and sum the top 3 — regardless of which lifts they are
  const topCompoundSessionValues: number[] = [];

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

  // Overall strength index + top compound total + volume load — computed per session
  for (const w of recentWorkouts) {
    let sessionTotalE1RM = 0;
    let exerciseCount = 0;
    let sessionVolLoad = 0;
    const exerciseE1RMs: number[] = [];

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
        exerciseE1RMs.push(bestE1RM);
      }
    }

    if (exerciseCount > 0) {
      sessionStrengthIndices.push(sessionTotalE1RM);
    }

    // Sum the top 3 e1RMs from this session (whatever exercises they are)
    if (exerciseE1RMs.length >= 2) {
      exerciseE1RMs.sort((a, b) => b - a);
      topCompoundSessionValues.push(exerciseE1RMs.slice(0, 3).reduce((s, v) => s + v, 0));
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
    sleep: buildMetricTrend(sleepValues, sleepDates),
    hrv: buildMetricTrend(hrvValues, hrvDates),
    rhr: buildMetricTrend(rhrValues, rhrDates),
    steps: buildMetricTrend(stepsValues, stepsDates),
    bodyWeight: buildMetricTrend(weightValues, weightDates),
    bodyFat: buildMetricTrend(bfValues),
    estimatedLeanMass: buildMetricTrend(leanMassValues),
    caloriesBurned: buildMetricTrend(caloriesValues, caloriesDates),
    activeMinutes: buildMetricTrend(activeMinValues, activeMinDates),
    totalStrengthIndex: buildMetricTrend(sessionStrengthIndices),
    big3Total: buildMetricTrend(topCompoundSessionValues),
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

  const recent3 = sorted.slice(0, 3).map(h => normalizeSleepHours(h.sleep_duration)!);
  const recent7 = sorted.slice(0, 7).map(h => normalizeSleepHours(h.sleep_duration)!);
  const baseline30 = sorted.slice(0, 30).map(h => normalizeSleepHours(h.sleep_duration)!);

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
    const weekNum = Math.floor(daysBetween(w.date, localDateStr(now)) / 7);
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

function createFeatureSnapshotId(parts: Array<string | number | null | undefined>): string {
  const seed = parts.map(p => (p == null ? 'null' : String(p))).join('|');
  // Lightweight stable hash for replay/attribution metadata (not cryptographic).
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return `fs_${(hash >>> 0).toString(36)}`;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function computeCanonicalModelContext(
  profileSignals: {
    adherenceScore: number;
    progressionScore: number;
    sessionFitScore: number;
    recoveryReadinessScore: number;
    evidenceConfidence: number;
  }
): TrainingProfile['canonicalModelContext'] {
  const adherence = clamp01(profileSignals.adherenceScore);
  const progression = clamp01(profileSignals.progressionScore);
  const fit = clamp01(profileSignals.sessionFitScore);
  const readiness = clamp01(profileSignals.recoveryReadinessScore);
  const evidenceConfidence = clamp01(profileSignals.evidenceConfidence);
  // Objective redesign: optimize long-horizon utility around adherence + progression + fit.
  const utilityBase = adherence * 0.5 + progression * 0.35 + fit * 0.15;
  const utility = clamp01((utilityBase * evidenceConfidence) + (0.5 * (1 - evidenceConfidence)));
  return {
    version: 'utility_v2',
    adherenceScore: adherence,
    progressionScore: progression,
    sessionFitScore: fit,
    recoveryReadinessScore: readiness,
    evidenceConfidence,
    objectiveUtility: utility,
  };
}

export async function computeTrainingProfile(userId: string): Promise<TrainingProfile> {
  const supabase = requireSupabase();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
  const [workouts, health, exercises, prefsResult, feedbackResult, connectedAccounts] = await Promise.all([
    fetchWorkoutHistory(userId),
    fetchHealthHistory(userId),
    fetchEnrichedExercises(),
    supabase.from('user_preferences').select('*').eq('user_id', userId).maybeSingle(),
    (async () => {
      try {
        return await supabase
          .from('model_feedback')
          .select('feedback_data, feedback_source, feedback_quality, verified_by_user')
          .eq('user_id', userId)
          .eq('feedback_type', 'pattern_observation')
          .gte('created_at', thirtyDaysAgo)
          .order('created_at', { ascending: false })
          .limit(10);
      } catch {
        return { data: null, error: null } as any;
      }
    })(),
    getAllConnectedAccounts(userId).catch(() => [] as any[]),
  ]) as [WorkoutRecord[], HealthRecord[], EnrichedExercise[], any, any, any[]];
  const userGender = prefsResult?.data?.gender ?? null;
  const userRecoverySpeed = prefsResult?.data?.recovery_speed != null ? Number(prefsResult.data.recovery_speed) : 1.0;
  const userExperienceLevel: string | null = prefsResult?.data?.experience_level ?? null;
  const userBodyWeightLbs = prefsResult?.data?.body_weight_lbs != null ? Number(prefsResult.data.body_weight_lbs) : null;
  const userWeightGoalLbs = prefsResult?.data?.weight_goal_lbs != null ? Number(prefsResult.data.weight_goal_lbs) : null;

  let userAge: number | null = prefsResult?.data?.age != null ? Number(prefsResult.data.age) : null;
  if (userAge == null && prefsResult?.data?.date_of_birth) {
    const dob = new Date(prefsResult.data.date_of_birth);
    if (!isNaN(dob.getTime())) {
      userAge = Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
    }
  }

  const healthByDate = new Map<string, HealthRecord>();
  for (const h of health) healthByDate.set(h.date, h);

  // Compute baselines (30-day averages)
  const last30 = health.slice(-30);
  const sleepVals = last30.filter(h => h.sleep_duration != null).map(h => normalizeSleepHours(h.sleep_duration)!);
  const hrvVals = last30.filter(h => h.hrv != null).map(h => h.hrv!);
  const rhrVals = last30.filter(h => h.resting_heart_rate != null).map(h => h.resting_heart_rate!);
  const stepsVals = last30.filter(h => h.steps != null).map(h => h.steps!);

  const calBurnedVals = last30.filter(h => h.calories_burned != null).map(h => h.calories_burned!);
  const activeMinVals = last30.filter(h =>
    (h.active_minutes_fairly ?? 0) + (h.active_minutes_very ?? 0) > 0
  ).map(h => (h.active_minutes_fairly ?? 0) + (h.active_minutes_very ?? 0));

  const baselines: Record<string, number> = {
    sleep: mean(sleepVals),
    hrv: mean(hrvVals),
    rhr: mean(rhrVals),
    steps: mean(stepsVals),
    caloriesBurned: mean(calBurnedVals),
    activeMinutes: mean(activeMinVals),
  };

  // Recovery context from most recent data
  const lastHealth = health.length > 0 ? health[health.length - 1] : null;
  const recoveryCtx: RecoveryContext = {
    sleepDurationLastNight: normalizeSleepHours(lastHealth?.sleep_duration) ?? null,
    sleepBaseline30d: baselines.sleep || null,
    hrvLastNight: lastHealth?.hrv ?? null,
    hrvBaseline30d: baselines.hrv || null,
    rhrLastNight: lastHealth?.resting_heart_rate ?? null,
    rhrBaseline30d: baselines.rhr || null,
    stepsYesterday: lastHealth?.steps ?? null,
    stepsBaseline30d: baselines.steps || null,
  };

  // User's body weight: per-date lookup for historical accuracy, latest for current
  const weightByDate = buildWeightByDate(health);
  const weightRecords = health.filter(h => h.weight != null).sort((a, b) => a.date.localeCompare(b.date));
  const userBodyWeight = weightRecords.length > 0 ? weightRecords[weightRecords.length - 1].weight : null;

  // Performance deltas (foundation for features 1-7)
  const deltas = computePerformanceDeltas(workouts, healthByDate, baselines);

  // Exercise progressions (warmup-filtered, per-date BW)
  const exerciseProgressions = computeExerciseProgressions(workouts, userBodyWeight, weightByDate);

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
    DEFAULT_MODEL_CONFIG.muscleReadyThreshold * 100,
    userAge,
  );

  // Global stats
  const trainingDates = [...new Set(workouts.map(w => w.date))];
  const last4Weeks = trainingDates.filter(
    d => daysBetween(d, localDateStr(new Date())) <= 28
  );
  const trainingFrequency = last4Weeks.length / 4;
  const durations = workouts.filter(w => w.duration).map(w => w.duration!);
  const avgSessionDuration = mean(durations);
  const trainingAgeDays = workouts.length > 0
    ? daysBetween(workouts[0].date, localDateStr(new Date()))
    : 0;

  // Consistency: count weeks with 0 workouts in last 12 weeks
  const last12Weeks: boolean[] = [];
  for (let i = 0; i < 12; i++) {
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - (i + 1) * 7);
    const weekEnd = new Date();
    weekEnd.setDate(weekEnd.getDate() - i * 7);
    const weekStartStr = localDateStr(weekStart);
    const weekEndStr = localDateStr(weekEnd);
    const hasWorkout = trainingDates.some(d => d >= weekStartStr && d < weekEndStr);
    last12Weeks.push(hasWorkout);
  }
  const weeksWithWorkouts = last12Weeks.filter(Boolean).length;
  const consistencyScore = weeksWithWorkouts / 12;

  // Per-muscle-group training frequency (sessions/week over last 14 days)
  // Used by the engine to derive per-session volume ceilings: weeklyTarget / frequency
  const exToGroups = new Map<string, string[]>();
  for (const ex of exercises) {
    const groups = (Array.isArray(ex.primary_muscles) ? ex.primary_muscles : [])
      .map((m: string) => MUSCLE_HEAD_TO_GROUP[m]).filter(Boolean);
    if (groups.length > 0) exToGroups.set((ex.name ?? '').toLowerCase(), [...new Set(groups)]);
  }
  const muscleGroupFrequency: Record<string, number> = {};
  const twoWeeksAgo = localDateStr(new Date(Date.now() - 14 * 86400000));
  const recentWorkouts14d = workouts.filter(w => w.date >= twoWeeksAgo);
  for (const w of recentWorkouts14d) {
    const groupsThisSession = new Set<string>();
    for (const ex of (w.workout_exercises ?? [])) {
      const groups = exToGroups.get((ex.exercise_name ?? '').toLowerCase());
      if (groups) for (const g of groups) groupsThisSession.add(g);
    }
    for (const g of groupsThisSession) {
      muscleGroupFrequency[g] = (muscleGroupFrequency[g] ?? 0) + 1;
    }
  }
  for (const g of Object.keys(muscleGroupFrequency)) {
    muscleGroupFrequency[g] = Math.round((muscleGroupFrequency[g] / 2) * 10) / 10;
  }

  // Pre-compute values needed by athlete profile
  const imbalanceAlerts = computeImbalanceAlerts(muscleVolumeStatuses);
  const spResults = computeStrengthPercentiles(exerciseProgressions, userBodyWeight, userGender, userAge);
  const hpResults = computeHealthPercentiles(health, userAge, userGender);
  const cumulativeSleepDebt = computeCumulativeSleepDebt(health);
  const rolling30DayTrends = computeRolling30DayTrends(workouts, health, exercises, exerciseProgressions);
  const fitnessFatigueResult = computeFitnessFatigueModel(workouts);
  const plateauDetections = computePlateauDetections(workouts, userBodyWeight, weightByDate);

  const exerciseSwapHistoryResult = await computeExerciseSwapHistory(userId);

  const athleteProfileResult = computeAthleteProfile(spResults, hpResults, muscleVolumeStatuses, {
    consistencyScore,
    trainingFrequency,
    avgSessionDuration,
    trainingAgeDays,
    imbalanceAlerts,
    exerciseProgressions,
    rolling30DayTrends,
    bodyWeightTrend: computeBodyWeightTrend(health),
    cumulativeSleepDebt,
    fitnessFatigueModel: fitnessFatigueResult,
    plateauDetections,
    age: userAge,
  });

  // D2.1 — Data Collection summary
  const totalWorkoutCount = workouts.length;
  const healthDataDays = new Set(health.map(h => h.date)).size;
  const connectedWearables = (connectedAccounts ?? []).map((a: any) => a.provider as string);
  const featureSnapshotId = createFeatureSnapshotId([
    userId,
    workouts.length,
    workouts[workouts.length - 1]?.date ?? null,
    health.length,
    health[health.length - 1]?.date ?? null,
    (feedbackResult?.data ?? []).length,
  ]);

  const prescribedVsActual = await computePrescribedVsActual(userId, workouts, exercises);
  const progressionScore = (() => {
    const eligible = exerciseProgressions.filter(p => p.sessionsTracked >= 3);
    if (eligible.length === 0) return 0.5;
    const progressing = eligible.filter(p => p.status === 'progressing').length;
    const stalled = eligible.filter(p => p.status === 'stalled').length;
    return clamp01((progressing + stalled * 0.5) / eligible.length);
  })();
  const sessionFitScore = clamp01(
    (prescribedVsActual.avgSetExecutionAccuracy * 0.6) +
    (prescribedVsActual.avgSessionOutcomeScore * 0.4)
  );
  const complianceEvidence = prescribedVsActual.exercisesCompleted + prescribedVsActual.exercisesSkipped;
  const adherenceEvidenceConfidence = clamp01(complianceEvidence / 30);
  const executionEvidenceConfidence = clamp01((prescribedVsActual.executionSampleSize + prescribedVsActual.outcomeSampleSize) / 30);
  const evidenceConfidence = clamp01((adherenceEvidenceConfidence * 0.6) + (executionEvidenceConfidence * 0.4));
  const adherenceScore = (prescribedVsActual.complianceRate * evidenceConfidence) + (0.5 * (1 - evidenceConfidence));
  const fitScore = (sessionFitScore * executionEvidenceConfidence) + (0.5 * (1 - executionEvidenceConfidence));

  const canonicalModelContext = computeCanonicalModelContext({
    adherenceScore,
    progressionScore,
    sessionFitScore: fitScore,
    recoveryReadinessScore: fitnessFatigueResult.readiness,
    evidenceConfidence,
  });

  return {
    userId,
    computedAt: new Date().toISOString(),
    featureSnapshotId,
    canonicalModelContext,

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
    plateauDetections,
    individualMrvEstimates,
    bestProgressionPatterns: computeBestProgressionPatterns(workouts, exercises),
    repWeightBreakthroughs: computeRepWeightBreakthroughs(workouts),
    imbalanceAlerts: imbalanceAlerts,
    strengthPercentiles: spResults,
    healthPercentiles: hpResults,
    athleteProfile: athleteProfileResult,
    gender: userGender,

    detectedSplit: detectTrainingSplit(workouts, exercises),
    dayOfWeekPatterns: computeDayOfWeekPatterns(workouts, exercises),
    exercisePreferences: computeExercisePreferences(workouts),
    cardioHistory: computeCardioHistory(workouts, exercises),
    exerciseOrderProfiles: computeExerciseOrderProfiles(workouts, exercises),

    cumulativeSleepDebt,
    exerciseRotation: computeExerciseRotation(workouts, exercises),

    rolling30DayTrends,

    // #1: Prescribed vs actual feedback loop
    prescribedVsActual,

    // #4: Individual muscle recovery rates
    individualRecoveryRates: computeIndividualRecoveryRates(workouts, exercises),

    // #20: Banister fitness-fatigue model
    fitnessFatigueModel: fitnessFatigueResult,

    // ML v2 features
    exerciseSwapHistory: exerciseSwapHistoryResult,
    hrvIntensityModifier: computeHrvIntensityModifier(health),
    progressionForecasts: computeProgressionForecasts(exerciseProgressions, workouts),
    ...computeWorkoutIntensityScores(workouts, userAge),
    movementPatternFatigue: computeMovementPatternFatigue(workouts, exercises),
    sleepVolumeModifier: computeSleepVolumeModifier(health),

    goalProgress: computeGoalProgress(
      prefsResult?.data,
      rolling30DayTrends,
      computeBodyWeightTrend(health),
      exerciseProgressions,
      muscleVolumeStatuses,
      { trainingFrequency, avgSessionDuration, consistencyScore, trainingAgeDays },
      fitnessFatigueResult,
      workouts,
      health,
      baselines,
    ),

    trainingFrequency: Math.round(trainingFrequency * 10) / 10,
    avgSessionDuration: Math.round(avgSessionDuration),
    trainingAgeDays: Math.round(trainingAgeDays),
    consistencyScore: Math.round(consistencyScore * 100) / 100,
    muscleGroupFrequency,
    llmPatternObservations: (feedbackResult?.data ?? [])
      .filter((r: any) => {
        // Keep legacy rows with no provenance metadata, but exclude unverified model-only observations.
        const source = r?.feedback_source ?? null;
        const quality = r?.feedback_quality ?? null;
        const verified = r?.verified_by_user === true;
        if (!source && !quality && !verified) return true;
        if (verified) return true;
        if (quality === 'verified' || quality === 'trusted') return true;
        return source !== 'model_review';
      })
      .map((r: any) => r.feedback_data)
      .filter((d: any) => d && typeof d.pattern === 'string'),

    totalWorkoutCount,
    healthDataDays,
    connectedWearables,
  };
}

// ─── Goal Progress ──────────────────────────────────────────────────────────

function computeGoalProgress(
  prefs: any,
  trends: Rolling30DayTrends,
  bwt: BodyWeightTrend,
  progressions: ExerciseProgression[],
  volumeStatuses: MuscleVolumeStatus[],
  global: { trainingFrequency: number; avgSessionDuration: number; consistencyScore: number; trainingAgeDays: number },
  ffm: { readiness: number; fitnessLevel: number; fatigueLevel: number },
  workouts: WorkoutRecord[],
  health: HealthRecord[],
  baselines?: Record<string, number>,
): GoalProgress | null {
  const goal: string = prefs?.primary_goal ?? prefs?.training_goal ?? null;
  if (!goal) return null;

  const goalLabels: Record<string, string> = {
    strength: 'Build Strength', hypertrophy: 'Build Muscle', fat_loss: 'Lose Fat',
    endurance: 'Improve Endurance', general_fitness: 'General Fitness',
  };

  const signals: GoalSignal[] = [];
  const alignment: WorkoutAlignmentItem[] = [];

  // Scoring: each signal contributes (trendScore * weight).
  // trendScore: positive=1, neutral=0.5, negative=0.
  // But we also support an "outcomeMultiplier" that caps the final score
  // when the primary outcome metric is failing.
  let scoreSum = 0;
  let weightSum = 0;
  let outcomeCap = 100; // Primary outcome metric can cap the total score

  const addSignal = (s: GoalSignal) => {
    signals.push(s);
    const trendScore = s.trend === 'positive' ? 1 : s.trend === 'negative' ? 0 : 0.5;
    scoreSum += trendScore * s.weight * 100;
    weightSum += s.weight;
  };

  const progressing = progressions.filter(p => p.status === 'progressing').length;
  const regressing = progressions.filter(p => p.status === 'regressing').length;
  const total = progressions.length;

  const bl: Record<string, number> = baselines ?? {};

  // ─── CONSISTENCY (all goals, reduced weight for fat_loss) ──────────
  const consistencyWeight = goal === 'fat_loss' ? 0.1 : 0.15;
  addSignal({
    label: 'Consistency', value: `${Math.round(global.consistencyScore * 100)}%`,
    trend: global.consistencyScore >= 0.7 ? 'positive' : global.consistencyScore >= 0.4 ? 'neutral' : 'negative',
    detail: global.consistencyScore >= 0.7 ? 'Training consistently — necessary but not sufficient for any goal' : 'Inconsistent training slows progress toward any goal',
    weight: consistencyWeight,
  });

  // ─── FREQUENCY (all goals, reduced weight for fat_loss) ────────────
  const freqTarget = goal === 'strength' || goal === 'hypertrophy' ? 4 : 3;
  const freqWeight = goal === 'fat_loss' ? 0.05 : 0.1;
  addSignal({
    label: 'Training Frequency', value: `${global.trainingFrequency.toFixed(1)} days/wk`,
    trend: global.trainingFrequency >= freqTarget ? 'positive' : global.trainingFrequency >= freqTarget - 1 ? 'neutral' : 'negative',
    detail: global.trainingFrequency >= freqTarget ? `Hitting ${freqTarget}+ sessions/week` : `Below ${freqTarget} sessions/week target`,
    weight: freqWeight,
  });

  if (goal === 'strength') {
    if (trends.totalStrengthIndex.dataPoints >= 3) {
      const trend = trends.totalStrengthIndex.direction;
      addSignal({
        label: 'Strength Index', value: `${trends.totalStrengthIndex.current?.toFixed(0) ?? '—'}`,
        trend: trend === 'up' ? 'positive' : trend === 'down' ? 'negative' : 'neutral',
        detail: trend === 'up' ? `Strength index rising ${Math.abs(trends.totalStrengthIndex.slopePct).toFixed(1)}%/wk` : 'Strength stalling — consider deload or nutrition adjustment',
        weight: 0.30,
      });
      if (trend !== 'up') outcomeCap = 55;
    }
    if (total > 0) {
      const pctProg = progressing / total;
      addSignal({
        label: 'Lift Progression', value: `${progressing}/${total} lifts progressing`,
        trend: pctProg >= 0.5 ? 'positive' : pctProg >= 0.3 ? 'neutral' : 'negative',
        detail: pctProg >= 0.5 ? 'Majority of lifts progressing' : `${regressing} lifts regressing`,
        weight: 0.20,
      });
    }
    if (trends.totalVolumeLoad.dataPoints >= 3) {
      addSignal({
        label: 'Volume Load', value: `${Math.abs(trends.totalVolumeLoad.slopePct).toFixed(1)}%/wk ${trends.totalVolumeLoad.direction === 'up' ? '↑' : trends.totalVolumeLoad.direction === 'down' ? '↓' : '→'}`,
        trend: trends.totalVolumeLoad.direction === 'up' ? 'positive' : trends.totalVolumeLoad.direction === 'down' ? 'negative' : 'neutral',
        detail: 'Progressive overload through volume drives strength adaptation',
        weight: 0.15,
      });
    }
    const avgDur = global.avgSessionDuration / 60;
    alignment.push({ factor: 'Session Duration', status: avgDur >= 45 ? 'aligned' : 'partial', detail: avgDur >= 45 ? `${Math.round(avgDur)} min avg — adequate for heavy compounds + rest` : `${Math.round(avgDur)} min avg — strength needs 45+ min for rest between heavy sets` });
    const compoundPct = progressions.filter(p => p.exerciseName.match(/squat|bench|deadlift|press|row/i)).length / Math.max(total, 1);
    alignment.push({ factor: 'Compound Focus', status: compoundPct >= 0.3 ? 'aligned' : 'partial', detail: compoundPct >= 0.3 ? 'Training includes compound movements' : 'More compound lifts needed for faster strength gains' });

  } else if (goal === 'hypertrophy') {
    if (trends.totalWeeklyVolume.dataPoints >= 3) {
      addSignal({
        label: 'Weekly Volume', value: `${trends.totalWeeklyVolume.current?.toFixed(0) ?? '—'} sets/wk`,
        trend: trends.totalWeeklyVolume.direction === 'up' ? 'positive' : trends.totalWeeklyVolume.direction === 'down' ? 'negative' : 'neutral',
        detail: trends.totalWeeklyVolume.direction === 'up' ? 'Volume increasing — progressive overload drives hypertrophy' : 'Volume stalling — growth requires progressive volume increases',
        weight: 0.25,
      });
      if (trends.totalWeeklyVolume.direction === 'down') outcomeCap = 60;
    }
    const inMav = volumeStatuses.filter(v => v.status === 'in_mav').length;
    const belowMev = volumeStatuses.filter(v => v.status === 'below_mev').length;
    const totalMuscles = volumeStatuses.length;
    if (totalMuscles > 0) {
      addSignal({
        label: 'Volume Coverage', value: `${inMav}/${totalMuscles} in growth range`,
        trend: inMav >= totalMuscles * 0.5 ? 'positive' : belowMev >= totalMuscles * 0.5 ? 'negative' : 'neutral',
        detail: inMav >= totalMuscles * 0.5 ? 'Most muscle groups in effective volume range' : `${belowMev} muscle groups below minimum effective volume`,
        weight: 0.20,
      });
    }
    if (bwt.currentWeight != null) {
      addSignal({
        label: 'Body Weight', value: `${bwt.currentWeight} lbs (${bwt.slope > 0 ? '+' : ''}${bwt.slope} lbs/wk)`,
        trend: bwt.slope >= 0.1 && bwt.slope <= 1.0 ? 'positive' : bwt.slope > 1.0 ? 'neutral' : bwt.slope < -0.3 ? 'negative' : 'neutral',
        detail: bwt.slope >= 0.1 && bwt.slope <= 1.0 ? 'Slow weight gain supports lean muscle growth' : bwt.slope > 1.0 ? 'Surplus may be too aggressive' : bwt.slope < -0.3 ? 'Losing weight makes muscle gain harder' : 'Maintaining weight',
        weight: 0.10,
      });
    }
    if (total > 0) {
      const pctProg = progressing / total;
      addSignal({
        label: 'Lift Progression', value: `${progressing}/${total} progressing`,
        trend: pctProg >= 0.4 ? 'positive' : pctProg >= 0.2 ? 'neutral' : 'negative',
        detail: pctProg >= 0.4 ? 'Progressive overload intact' : 'Stalling lifts reduce hypertrophy stimulus',
        weight: 0.15,
      });
    }
    alignment.push({ factor: 'Rep Ranges', status: 'aligned', detail: 'Engine prescribes 8-15 rep ranges for hypertrophy' });
    alignment.push({ factor: 'Volume per Muscle', status: inMav >= totalMuscles * 0.5 ? 'aligned' : 'misaligned', detail: inMav >= totalMuscles * 0.5 ? `${inMav} groups at effective volume` : `${belowMev} groups below minimum — needs more sets` });

  } else if (goal === 'fat_loss') {
    // ════════════════════════════════════════════════════════════════════
    //  FAT LOSS: Outcome = weight trend. Everything else is supporting.
    //
    //  Research basis:
    //  - Fat loss requires a sustained caloric deficit (Henselmans, 2020)
    //  - 0.5-1% body weight/wk is evidence-based safe rate (Helms et al. 2014)
    //  - NEAT (steps) accounts for more daily expenditure than exercise (Levine, 2004)
    //  - Resistance training preserves lean mass during deficit (Longland et al. 2016)
    //  - Higher active minutes / HR zone time correlates with greater TDEE
    //  - If weight isn't moving, everything else is noise
    // ════════════════════════════════════════════════════════════════════

    // PRIMARY OUTCOME: Weight trend (heaviest weight — if this is flat, score is capped)
    if (bwt.currentWeight != null) {
      const weightGoal = prefs?.weight_goal_lbs;
      const slopePerWeek = bwt.slope; // lbs/week, negative = losing
      const sustainableRate = bwt.currentWeight * 0.005; // 0.5% BW/wk
      const aggressiveRate = bwt.currentWeight * 0.01;   // 1% BW/wk

      let trend: 'positive' | 'neutral' | 'negative';
      let detail: string;

      if (slopePerWeek <= -sustainableRate && slopePerWeek >= -aggressiveRate) {
        trend = 'positive';
        detail = `Losing ${Math.abs(slopePerWeek).toFixed(1)} lbs/wk (${(Math.abs(slopePerWeek) / bwt.currentWeight * 100).toFixed(1)}% BW/wk) — evidence-based sustainable rate${weightGoal ? `. Goal: ${weightGoal} lbs` : ''}`;
      } else if (slopePerWeek < -aggressiveRate) {
        trend = 'neutral';
        detail = `Losing ${Math.abs(slopePerWeek).toFixed(1)} lbs/wk — faster than 1% BW/wk risks muscle loss (Helms et al.)`;
        outcomeCap = 70;
      } else if (slopePerWeek < 0 && slopePerWeek > -sustainableRate) {
        trend = 'neutral';
        detail = `Losing ${Math.abs(slopePerWeek).toFixed(1)} lbs/wk — slow but moving. Consider increasing deficit slightly`;
        outcomeCap = 65;
      } else {
        // NOT LOSING — this is the critical failure case
        trend = 'negative';
        detail = slopePerWeek > 0
          ? `Gaining ${slopePerWeek.toFixed(1)} lbs/wk — no caloric deficit present. You are not in a cut.`
          : 'Weight flat — no measurable fat loss occurring. Caloric deficit is insufficient.';
        outcomeCap = 35; // Hard cap: can't score above 35 if not losing weight
      }

      addSignal({
        label: 'Weight Trend', value: `${bwt.currentWeight} lbs (${slopePerWeek > 0 ? '+' : ''}${slopePerWeek.toFixed(1)} lbs/wk)`,
        trend, detail, weight: 0.35,
      });

      if (weightGoal && bwt.currentWeight > weightGoal && slopePerWeek < 0) {
        const lbsToGo = bwt.currentWeight - weightGoal;
        const weeksToGoal = Math.round(lbsToGo / Math.abs(slopePerWeek));
        addSignal({
          label: 'Weight Goal', value: `${lbsToGo.toFixed(1)} lbs to go`,
          trend: 'positive', detail: `At current rate, ~${weeksToGoal} weeks to ${weightGoal} lbs`,
          weight: 0.05,
        });
      }
    } else {
      // No weight data — can't assess fat loss at all
      outcomeCap = 30;
      addSignal({
        label: 'Weight Trend', value: 'No data',
        trend: 'negative', detail: 'No body weight data available — cannot assess fat loss progress. Log your weight.',
        weight: 0.35,
      });
    }

    // CALORIES BURNED (personalized thresholds based on user's 30-day baseline)
    if (trends.caloriesBurned.dataPoints >= 3 && trends.caloriesBurned.current != null) {
      const cal = trends.caloriesBurned.current;
      const calTrend = trends.caloriesBurned.direction;
      const calBaseline = bl.caloriesBurned ?? cal;
      // Positive if above baseline (user is more active than their own norm)
      const aboveBaseline = cal >= calBaseline * 1.05;
      const belowBaseline = cal < calBaseline * 0.9;
      addSignal({
        label: 'Daily Calories Burned', value: `${Math.round(cal).toLocaleString()} kcal`,
        trend: aboveBaseline || calTrend === 'up' ? 'positive' : belowBaseline ? 'negative' : 'neutral',
        detail: `Fitbit TDEE averaging ${Math.round(cal)} kcal/day (baseline: ~${Math.round(calBaseline)}). ${aboveBaseline ? 'Above your personal baseline — increased expenditure supports a deficit.' : belowBaseline ? 'Below your own baseline — daily activity has dropped, limiting your deficit.' : 'Near your baseline — maintaining expenditure.'}`,
        weight: 0.15,
      });
    }

    // ACTIVE MINUTES (personalized: compare to user's own average, not fixed population threshold)
    if (trends.activeMinutes.dataPoints >= 3 && trends.activeMinutes.current != null) {
      const am = trends.activeMinutes.current;
      const amBaseline = bl.activeMinutes ?? am;
      const aboveAm = am >= amBaseline * 1.1;
      const belowAm = am < amBaseline * 0.8;
      addSignal({
        label: 'Active Minutes', value: `${Math.round(am)} min/day`,
        trend: aboveAm || am >= 30 ? 'positive' : belowAm || am < 10 ? 'negative' : 'neutral',
        detail: aboveAm ? `${Math.round(am)} active min/day — above your baseline (${Math.round(amBaseline)}), strong calorie burn contribution` : belowAm ? `${Math.round(am)} active min/day — below your baseline (${Math.round(amBaseline)}), room to increase activity` : `${Math.round(am)} active min/day — near your norm (${Math.round(amBaseline)})`,
        weight: 0.10,
      });
    }

    // DAILY STEPS (personalized: user's own step baseline, not fixed 8000/5000)
    if (trends.steps.dataPoints >= 3 && trends.steps.current != null) {
      const steps = trends.steps.current;
      const stepsBaseline = bl.steps ?? steps;
      const aboveSteps = steps >= stepsBaseline * 1.1;
      const belowSteps = steps < stepsBaseline * 0.8;
      addSignal({
        label: 'Daily Steps (NEAT)', value: `${Math.round(steps).toLocaleString()}`,
        trend: aboveSteps || steps >= 10000 ? 'positive' : belowSteps || steps < 4000 ? 'negative' : 'neutral',
        detail: aboveSteps ? `${Math.round(steps).toLocaleString()} steps/day — above your baseline (${Math.round(stepsBaseline).toLocaleString()}). NEAT is the #1 variable in daily expenditure.` : belowSteps ? `${Math.round(steps).toLocaleString()} steps/day — below your norm (${Math.round(stepsBaseline).toLocaleString()}). Increasing daily movement has higher ROI than extra gym sessions.` : `${Math.round(steps).toLocaleString()} steps/day — near your baseline. NEAT is the largest controllable TDEE component.`,
        weight: 0.10,
      });
    }

    // WORKOUT CALORIE BURN (personalized: compare to user's own workout calorie baseline)
    const recentWorkoutsWithCal = workouts
      .filter(w => w.workout_calories_burned != null && w.workout_calories_burned > 0)
      .slice(-10);
    if (recentWorkoutsWithCal.length >= 2) {
      const avgWkCal = recentWorkoutsWithCal.reduce((s, w) => s + (w.workout_calories_burned || 0), 0) / recentWorkoutsWithCal.length;
      // Scale thresholds to body weight: heavier individuals burn more per session
      const bw = bwt.currentWeight ?? 170;
      const calHighThreshold = bw * 1.6;   // ~272 kcal for 170lb, ~368 for 230lb
      const calLowThreshold = bw * 0.85;   // ~144 kcal for 170lb, ~196 for 230lb
      addSignal({
        label: 'Workout Calorie Burn', value: `~${Math.round(avgWkCal)} kcal/session`,
        trend: avgWkCal >= calHighThreshold ? 'positive' : avgWkCal >= calLowThreshold ? 'neutral' : 'negative',
        detail: `Averaging ${Math.round(avgWkCal)} kcal per workout session over last ${recentWorkoutsWithCal.length} sessions. ${avgWkCal >= calHighThreshold ? 'Meaningful contribution to deficit.' : 'Low per-session burn — consider adding cardio or higher-intensity work.'}`,
        weight: 0.05,
      });
    }

    // STRENGTH RETENTION (critical during a cut — Longland et al. 2016)
    if (total > 0) {
      const pctRegressing = regressing / total;
      addSignal({
        label: 'Strength Retention', value: `${regressing}/${total} lifts regressing`,
        trend: pctRegressing <= 0.2 ? 'positive' : pctRegressing <= 0.4 ? 'neutral' : 'negative',
        detail: pctRegressing <= 0.2 ? 'Maintaining strength — strong signal for muscle preservation during cut' : `${regressing} lifts declining — deficit may be too aggressive or protein intake too low`,
        weight: 0.10,
      });
    }

    // WORKOUT HR ZONES — time in fat-burn and cardio zones
    const recentWorkoutsWithHR = workouts
      .filter(w => w.workout_hr_zones != null && typeof w.workout_hr_zones === 'object')
      .slice(-10);
    if (recentWorkoutsWithHR.length >= 2) {
      let totalFatBurn = 0;
      let totalCardio = 0;
      let totalPeak = 0;
      for (const w of recentWorkoutsWithHR) {
        const zones = w.workout_hr_zones as Record<string, number>;
        totalFatBurn += zones['Fat Burn'] || zones['fat_burn'] || 0;
        totalCardio += zones['Cardio'] || zones['cardio'] || 0;
        totalPeak += zones['Peak'] || zones['peak'] || 0;
      }
      const avgElevatedMin = (totalFatBurn + totalCardio + totalPeak) / recentWorkoutsWithHR.length;
      const avgHighIntensity = (totalCardio + totalPeak) / recentWorkoutsWithHR.length;
      addSignal({
        label: 'Workout HR Zones', value: `${Math.round(avgElevatedMin)} min elevated/session`,
        trend: avgHighIntensity >= 15 ? 'positive' : avgHighIntensity >= 5 ? 'neutral' : 'negative',
        detail: `Avg ${Math.round(avgHighIntensity)} min in cardio/peak zones per session. ${avgHighIntensity >= 15 ? 'Strong cardiovascular stimulus driving calorie burn.' : 'Low time in higher HR zones — more intense cardio or circuit-style training would increase burn.'}`,
        weight: 0.05,
      });
    }

    // ALIGNMENT
    alignment.push({
      factor: 'Caloric Deficit',
      status: bwt.slope < -0.3 ? 'aligned' : 'misaligned',
      detail: bwt.slope < -0.3
        ? 'Weight loss confirms a caloric deficit is present'
        : 'No weight loss = no deficit. Training alone cannot overcome excess calories. This is the single most important factor.',
    });
    alignment.push({
      factor: 'Strength Preservation',
      status: regressing <= Math.ceil(total * 0.3) ? 'aligned' : 'misaligned',
      detail: regressing <= Math.ceil(total * 0.3)
        ? 'Workouts maintain intensity to preserve muscle during the cut'
        : 'Too many lifts declining — prioritize intensity over volume during a cut',
    });
    alignment.push({
      factor: 'Cardio Component',
      status: (trends.activeMinutes.current ?? 0) >= 20 ? 'aligned' : 'partial',
      detail: (trends.activeMinutes.current ?? 0) >= 20
        ? 'Active minutes support additional calorie burn beyond resistance training'
        : 'Low active minutes — adding cardio or increasing NEAT would accelerate fat loss',
    });

  } else if (goal === 'endurance') {
    // ════════════════════════════════════════════════════════════════════
    //  ENDURANCE: Outcome = cardio volume + HR adaptation. Strength secondary.
    // ════════════════════════════════════════════════════════════════════

    // Cardio volume: how much time is spent on cardio exercises
    const cardioKeywords = ['treadmill', 'bike', 'elliptical', 'stairmaster', 'rowing', 'run', 'jog', 'walk', 'cycling', 'swim'];
    const recentCardioExercises = workouts.flatMap(w => w.workout_exercises.filter(e =>
      cardioKeywords.some(k => e.exercise_name.toLowerCase().includes(k))
    ));
    const cardioSessionCount = new Set(workouts.filter(w =>
      w.workout_exercises.some(e => cardioKeywords.some(k => e.exercise_name.toLowerCase().includes(k)))
    ).map(w => w.date)).size;
    const totalWeeksTracked = Math.max(1, global.trainingAgeDays / 7);
    const cardioSessionsPerWeek = cardioSessionCount / Math.min(totalWeeksTracked, 4);

    if (cardioSessionsPerWeek < 2) outcomeCap = 55;
    addSignal({
      label: 'Cardio Volume', value: `${cardioSessionsPerWeek.toFixed(1)} sessions/wk`,
      trend: cardioSessionsPerWeek >= 3 ? 'positive' : cardioSessionsPerWeek >= 1.5 ? 'neutral' : 'negative',
      detail: cardioSessionsPerWeek >= 3 ? `${recentCardioExercises.length} cardio exercises across recent workouts — strong endurance stimulus` : 'Insufficient cardio frequency. Endurance demands ≥3 cardio sessions/week for meaningful VO2 adaptation.',
      weight: 0.25,
    });

    // Resting HR trend (lower = better aerobic adaptation)
    if (trends.rhr.dataPoints >= 5 && trends.rhr.current != null) {
      const rhrDir = trends.rhr.direction;
      addSignal({
        label: 'Resting Heart Rate', value: `${Math.round(trends.rhr.current)} bpm`,
        trend: rhrDir === 'down' ? 'positive' : rhrDir === 'up' ? 'negative' : 'neutral',
        detail: rhrDir === 'down' ? 'RHR declining — cardiovascular efficiency improving' : rhrDir === 'up' ? 'RHR rising — potential detraining, overtraining, or insufficient cardio' : 'RHR stable — maintain current cardio volume for continued adaptation',
        weight: 0.20,
      });
    }

    // Active minutes (personalized)
    if (trends.activeMinutes.dataPoints >= 3 && trends.activeMinutes.current != null) {
      const am = trends.activeMinutes.current;
      const amBase = bl.activeMinutes ?? am;
      const aboveAm = am >= amBase * 1.1;
      const belowAm = am < amBase * 0.8;
      addSignal({
        label: 'Active Minutes', value: `${Math.round(am)} min/day`,
        trend: aboveAm || am >= 45 ? 'positive' : belowAm || am < 20 ? 'negative' : 'neutral',
        detail: aboveAm ? `Active minutes above your baseline (${Math.round(amBase)}) — endurance capacity building` : `Active minutes at or below baseline — increase moderate-vigorous activity`,
        weight: 0.15,
      });
    }

    // HRV (higher = better recovery, better aerobic base)
    if (trends.hrv.dataPoints >= 3 && trends.hrv.current != null) {
      const hrvDir = trends.hrv.direction;
      addSignal({
        label: 'HRV Trend', value: `${Math.round(trends.hrv.current)} ms`,
        trend: hrvDir === 'up' ? 'positive' : hrvDir === 'down' ? 'negative' : 'neutral',
        detail: hrvDir === 'up' ? 'HRV improving — parasympathetic tone increasing, strong aerobic adaptation marker' : hrvDir === 'down' ? 'HRV declining — possible overtraining or recovery deficit' : 'HRV stable',
        weight: 0.10,
      });
    }

    // Strength maintenance
    if (total > 0) {
      addSignal({
        label: 'Strength Maintenance', value: `${regressing}/${total} lifts regressing`,
        trend: regressing <= Math.ceil(total * 0.3) ? 'positive' : regressing <= Math.ceil(total * 0.5) ? 'neutral' : 'negative',
        detail: regressing <= Math.ceil(total * 0.3) ? 'Maintaining strength while building endurance — good programming balance' : 'Excessive strength loss — may need more resistance training alongside cardio',
        weight: 0.10,
      });
    }

    // Sleep
    if (trends.sleep.dataPoints >= 3 && trends.sleep.current != null) {
      addSignal({
        label: 'Sleep', value: `${trends.sleep.current.toFixed(1)} hrs`,
        trend: trends.sleep.current >= 7 ? 'positive' : trends.sleep.current >= 6 ? 'neutral' : 'negative',
        detail: trends.sleep.current >= 7 ? 'Adequate sleep supports aerobic adaptation and glycogen replenishment' : 'Insufficient sleep impairs endurance performance and recovery',
        weight: 0.10,
      });
    }

    // Alignment
    alignment.push({
      factor: 'Cardio Programming',
      status: cardioSessionsPerWeek >= 2 ? 'aligned' : 'misaligned',
      detail: cardioSessionsPerWeek >= 2 ? 'Regular cardio sessions drive cardiovascular adaptation' : 'Insufficient cardio frequency for endurance goals',
    });
    alignment.push({
      factor: 'Recovery Balance',
      status: ffm.readiness >= 0.5 ? 'aligned' : 'misaligned',
      detail: ffm.readiness >= 0.5 ? 'Training load is manageable' : 'Accumulated fatigue — reduce volume or intensity',
    });

  } else {
    // ════════════════════════════════════════════════════════════════════
    //  GENERAL FITNESS: Balanced scoring across multiple domains.
    // ════════════════════════════════════════════════════════════════════

    addSignal({
      label: 'Fitness Level', value: ffm.fitnessLevel.toFixed(0),
      trend: ffm.readiness >= 0.6 ? 'positive' : ffm.readiness >= 0.4 ? 'neutral' : 'negative',
      detail: `Banister fitness-fatigue readiness: ${Math.round(ffm.readiness * 100)}%. ${ffm.readiness >= 0.6 ? 'Well recovered and adapting.' : ffm.readiness >= 0.4 ? 'Moderate fatigue — manageable.' : 'High fatigue — consider a lighter week.'}`,
      weight: 0.12,
    });

    if (total > 0) {
      addSignal({
        label: 'Strength Progression', value: `${progressing}/${total} exercises improving`,
        trend: progressing >= total * 0.5 ? 'positive' : progressing >= total * 0.25 ? 'neutral' : 'negative',
        detail: progressing >= total * 0.5 ? 'Strong improvement across exercises' : progressing >= total * 0.25 ? 'Some exercises stalling — consider varying stimulus' : 'Most lifts stalled — periodization change recommended',
        weight: 0.12,
      });
    }

    // Training consistency
    const consistencyPct = Math.round(global.consistencyScore * 100);
    addSignal({
      label: 'Training Consistency', value: `${consistencyPct}%`,
      trend: consistencyPct >= 75 ? 'positive' : consistencyPct >= 50 ? 'neutral' : 'negative',
      detail: consistencyPct >= 75 ? `${consistencyPct}% adherence — consistency is the #1 driver of long-term fitness` : `${consistencyPct}% adherence — improving frequency would have the biggest ROI`,
      weight: 0.12,
    });

    // Cardiovascular health — personalized baselines
    if (trends.steps.dataPoints >= 3 && trends.steps.current != null) {
      const steps = trends.steps.current;
      const stepsBase = bl.steps ?? steps;
      const aboveSteps = steps >= stepsBase * 1.1;
      const belowSteps = steps < stepsBase * 0.8;
      addSignal({
        label: 'Daily Movement', value: `${Math.round(steps).toLocaleString()} steps`,
        trend: aboveSteps || steps >= 10000 ? 'positive' : belowSteps || steps < 4000 ? 'negative' : 'neutral',
        detail: aboveSteps ? `Above your baseline of ${Math.round(stepsBase).toLocaleString()} steps — good daily activity` : 'Daily movement supports cardiovascular health and recovery between sessions',
        weight: 0.10,
      });
    }

    if (trends.activeMinutes.dataPoints >= 3 && trends.activeMinutes.current != null) {
      const am = trends.activeMinutes.current;
      const amBase = bl.activeMinutes ?? am;
      const aboveAm = am >= amBase * 1.1;
      const belowAm = am < amBase * 0.8;
      addSignal({
        label: 'Active Minutes', value: `${Math.round(am)} min/day`,
        trend: aboveAm || am >= 30 ? 'positive' : belowAm || am < 10 ? 'negative' : 'neutral',
        detail: aboveAm ? `Above your baseline (${Math.round(amBase)} min) — meeting activity guidelines` : 'Increasing moderate-to-vigorous activity would improve general fitness',
        weight: 0.10,
      });
    }

    // Sleep quality
    if (trends.sleep.dataPoints >= 3 && trends.sleep.current != null) {
      const sleepHrs = trends.sleep.current;
      addSignal({
        label: 'Sleep Quality', value: `${sleepHrs.toFixed(1)} hrs`,
        trend: sleepHrs >= 7 ? 'positive' : sleepHrs >= 6 ? 'neutral' : 'negative',
        detail: sleepHrs >= 7 ? 'Adequate sleep supports recovery, hormone balance, and adaptation' : 'Insufficient sleep limits recovery and blunts training adaptations',
        weight: 0.10,
      });
    }

    // HRV trend
    if (trends.hrv.dataPoints >= 3 && trends.hrv.current != null) {
      const hrvDir = trends.hrv.direction;
      addSignal({
        label: 'HRV Trend', value: `${Math.round(trends.hrv.current)} ms`,
        trend: hrvDir === 'up' ? 'positive' : hrvDir === 'down' ? 'negative' : 'neutral',
        detail: hrvDir === 'up' ? 'HRV improving — autonomic nervous system adapting well to training load' : hrvDir === 'down' ? 'HRV declining — potential overreaching or accumulated stress' : 'HRV stable — maintaining current training load',
        weight: 0.10,
      });
    }

    // Volume coverage
    const groupsInMav = volumeStatuses.filter(v => v.status === 'in_mav' || v.status === 'approaching_mrv').length;
    const totalGroups = volumeStatuses.length;
    if (totalGroups > 0) {
      const coveragePct = Math.round((groupsInMav / totalGroups) * 100);
      addSignal({
        label: 'Volume Coverage', value: `${groupsInMav}/${totalGroups} groups in MAV`,
        trend: coveragePct >= 50 ? 'positive' : coveragePct >= 25 ? 'neutral' : 'negative',
        detail: coveragePct >= 50 ? 'Most muscle groups receiving productive training volume' : 'Many muscle groups under-trained — diversify programming',
        weight: 0.08,
      });
    }

    // Training variety
    const uniqueExercises = new Set(workouts.flatMap(w => w.workout_exercises.map(e => e.exercise_name.toLowerCase()))).size;
    addSignal({
      label: 'Training Variety', value: `${uniqueExercises} exercises`,
      trend: uniqueExercises >= 15 ? 'positive' : uniqueExercises >= 8 ? 'neutral' : 'negative',
      detail: uniqueExercises >= 15 ? 'Good exercise variety — training multiple movement patterns and muscle groups' : 'Limited exercise variety — adding diverse movements would improve general fitness',
      weight: 0.06,
    });

    // Session duration (avgSessionDuration is in seconds)
    const gfDurMin = global.avgSessionDuration / 60;
    if (gfDurMin > 0) {
      addSignal({
        label: 'Session Duration', value: `${Math.round(gfDurMin)} min avg`,
        trend: gfDurMin >= 45 ? 'positive' : gfDurMin >= 25 ? 'neutral' : 'negative',
        detail: gfDurMin >= 45 ? 'Sessions are long enough to accumulate meaningful training volume' : 'Short sessions — consider extending to allow adequate volume and warm-up',
        weight: 0.10,
      });
    }

    // Alignment
    const hasCardio = workouts.some(w => w.workout_exercises.some(e =>
      (e as any).exercise_type === 'cardio' || e.exercise_name.toLowerCase().includes('treadmill') || e.exercise_name.toLowerCase().includes('bike') || e.exercise_name.toLowerCase().includes('elliptical')
    ));
    alignment.push({
      factor: 'Balanced Programming',
      status: hasCardio && total > 3 ? 'aligned' : 'partial',
      detail: hasCardio && total > 3 ? 'Workouts blend strength and conditioning — well-rounded fitness approach' : !hasCardio ? 'No cardio detected — adding cardiovascular work would improve general fitness' : 'Limited exercise variety in recent workouts',
    });
    alignment.push({
      factor: 'Recovery Management',
      status: ffm.readiness >= 0.5 ? 'aligned' : 'misaligned',
      detail: ffm.readiness >= 0.5 ? 'Training load is manageable relative to recovery capacity' : 'Fatigue accumulating faster than recovery — consider a deload',
    });
  }

  // ─── READINESS (all goals, low weight) ──────────────────────────────
  addSignal({
    label: 'Readiness', value: `${Math.round(ffm.readiness * 100)}%`,
    trend: ffm.readiness >= 0.6 ? 'positive' : ffm.readiness >= 0.4 ? 'neutral' : 'negative',
    detail: ffm.readiness >= 0.6 ? 'Recovery on track — body adapting well to training load' : 'Fatigue elevated — workouts auto-adjusted for recovery',
    weight: 0.05,
  });

  // ─── FINAL SCORE with outcome cap ──────────────────────────────────
  const rawScore = weightSum > 0 ? Math.round(scoreSum / weightSum) : 50;
  const overallScore = Math.min(rawScore, outcomeCap);

  const posCount = signals.filter(s => s.trend === 'positive').length;
  const negCount = signals.filter(s => s.trend === 'negative').length;
  const summaryParts: string[] = [];

  if (goal === 'fat_loss' && outcomeCap <= 35) {
    summaryParts.push('No weight loss detected — caloric deficit is the missing piece');
  } else {
    if (posCount > 0) summaryParts.push(`${posCount} indicator${posCount > 1 ? 's' : ''} trending positively`);
    if (negCount > 0) summaryParts.push(`${negCount} need${negCount > 1 ? '' : 's'} attention`);
  }

  return {
    primaryGoal: goal,
    goalLabel: goalLabels[goal] || goal,
    signals,
    workoutAlignment: alignment,
    overallScore,
    summary: summaryParts.length > 0 ? summaryParts.join(', ') : 'Tracking your progress',
  };
}

// ─── ML v2 Feature Functions ────────────────────────────────────────────────

// Feature #1: Exercise Swap Learning
async function computeExerciseSwapHistory(userId: string): Promise<TrainingProfile['exerciseSwapHistory']> {
  try {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from('exercise_swaps')
      .select('exercise_name, swap_date')
      .eq('user_id', userId);

    if (error) {
      if (error.code === '42P01' || error.code === '42703' || error.message?.includes('does not exist')) {
        return [];
      }
      return [];
    }
    if (!data || data.length === 0) return [];

    const grouped = new Map<string, { count: number; lastDate: string }>();
    for (const row of data) {
      const name: string = row.exercise_name;
      const date: string = row.swap_date;
      const existing = grouped.get(name);
      if (existing) {
        existing.count++;
        if (date > existing.lastDate) existing.lastDate = date;
      } else {
        grouped.set(name, { count: 1, lastDate: date });
      }
    }

    return Array.from(grouped.entries())
      .map(([exerciseName, { count, lastDate }]) => ({
        exerciseName,
        swapCount: count,
        lastSwapDate: lastDate,
      }))
      .sort((a, b) => b.swapCount - a.swapCount);
  } catch {
    return [];
  }
}

// Feature #3: HRV-Gated Intensity
function computeHrvIntensityModifier(health: HealthRecord[]): TrainingProfile['hrvIntensityModifier'] {
  const defaultResult: TrainingProfile['hrvIntensityModifier'] = {
    todayHrv: null,
    rolling7dHrv: null,
    zScore: 0,
    intensityMultiplier: 1.0,
    recommendation: 'Insufficient HRV data',
  };

  const hrvRecords = health.filter(h => h.hrv != null).sort((a, b) => a.date.localeCompare(b.date));
  if (hrvRecords.length < 5) return defaultResult;

  const todayStr = localDateStr(new Date());
  const last7 = hrvRecords.filter(h => daysBetween(h.date, todayStr) <= 7);
  if (last7.length < 5) {
    // Fall back to the last 5 HRV readings regardless of date
    const tail = hrvRecords.slice(-5);
    const vals = tail.map(h => h.hrv!);
    const m = mean(vals);
    const sd = stddev(vals);
    const todayHrv = hrvRecords[hrvRecords.length - 1].hrv!;
    const z = sd > 0 ? (todayHrv - m) / sd : 0;
    return buildHrvResult(todayHrv, m, z);
  }

  const vals7d = last7.map(h => h.hrv!);
  const m = mean(vals7d);
  const sd = stddev(vals7d);
  const todayHrv = last7[last7.length - 1].hrv!;
  const z = sd > 0 ? (todayHrv - m) / sd : 0;
  return buildHrvResult(todayHrv, m, z);
}

function buildHrvResult(todayHrv: number, rolling7dHrv: number, zScore: number): TrainingProfile['hrvIntensityModifier'] {
  let intensityMultiplier: number;
  let recommendation: string;

  if (zScore < -1.5) {
    intensityMultiplier = 0.85;
    recommendation = 'Significantly below baseline — reduce intensity';
  } else if (zScore < -0.75) {
    intensityMultiplier = 0.92;
    recommendation = 'Below baseline — moderate intensity';
  } else if (zScore > 1.0) {
    intensityMultiplier = 1.08;
    recommendation = 'Above baseline — push harder';
  } else if (zScore > 0.5) {
    intensityMultiplier = 1.04;
    recommendation = 'Slightly above — normal or slightly higher intensity';
  } else {
    intensityMultiplier = 1.0;
    recommendation = 'At baseline — normal intensity';
  }

  return {
    todayHrv,
    rolling7dHrv: Math.round(rolling7dHrv * 10) / 10,
    zScore: Math.round(zScore * 100) / 100,
    intensityMultiplier,
    recommendation,
  };
}

// Feature #5: Progression Forecasting
function computeProgressionForecasts(
  exerciseProgressions: ExerciseProgression[],
  workouts: WorkoutRecord[],
): TrainingProfile['progressionForecasts'] {
  const forecasts: TrainingProfile['progressionForecasts'] = [];

  // Build per-exercise e1RM time series from workouts
  const exerciseE1rmSeries = new Map<string, number[]>();
  for (const w of workouts) {
    for (const ex of w.workout_exercises) {
      const sets = Array.isArray(ex.workout_sets) ? ex.workout_sets : [];
      let bestE1rm = 0;
      for (const s of sets) {
        if (s.weight && s.weight > 0 && s.reps && s.reps > 0) {
          bestE1rm = Math.max(bestE1rm, epley1RM(s.weight, s.reps));
        }
      }
      if (bestE1rm > 0) {
        const key = ex.exercise_name.toLowerCase();
        if (!exerciseE1rmSeries.has(key)) exerciseE1rmSeries.set(key, []);
        exerciseE1rmSeries.get(key)!.push(bestE1rm);
      }
    }
  }

  for (const prog of exerciseProgressions) {
    if (prog.sessionsTracked < 4) continue;

    const key = prog.exerciseName.toLowerCase();
    const series = exerciseE1rmSeries.get(key);
    if (!series || series.length < 4) continue;

    const { slope, intercept, rSquared } = linearRegression(series);
    if (rSquared < 0.3 || slope <= 0) continue;

    const n = series.length;
    const predictedNextE1RM = intercept + slope * (n + 1);
    const predictedTargetWeight = Math.round(predictedNextE1RM / 5) * 5;

    // Sessions until next plate milestone (next multiple of 45 above current)
    const currentE1RM = prog.estimated1RM;
    const nextMilestone = Math.ceil(currentE1RM / 45) * 45;
    let sessionsUntilMilestone: number | null = null;
    if (nextMilestone > currentE1RM && slope > 0) {
      sessionsUntilMilestone = Math.ceil((nextMilestone - currentE1RM) / slope);
    }

    forecasts.push({
      exerciseName: prog.exerciseName,
      currentE1RM: Math.round(currentE1RM * 10) / 10,
      predictedNextE1RM: Math.round(predictedNextE1RM * 10) / 10,
      predictedTargetWeight,
      confidence: Math.round(rSquared * 100) / 100,
      sessionsUntilMilestone,
    });
  }

  return forecasts.sort((a, b) => b.confidence - a.confidence);
}

function linearRegression(y: number[]): { slope: number; intercept: number; rSquared: number } {
  const n = y.length;
  const x = Array.from({ length: n }, (_, i) => i + 1);
  const xMean = mean(x);
  const yMean = mean(y);

  let ssXY = 0, ssXX = 0, ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    ssXY += (x[i] - xMean) * (y[i] - yMean);
    ssXX += (x[i] - xMean) ** 2;
  }

  const slope = ssXX > 0 ? ssXY / ssXX : 0;
  const intercept = yMean - slope * xMean;

  for (let i = 0; i < n; i++) {
    const predicted = intercept + slope * x[i];
    ssRes += (y[i] - predicted) ** 2;
    ssTot += (y[i] - yMean) ** 2;
  }

  const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  return { slope, intercept, rSquared: Math.max(0, rSquared) };
}

// Feature #6: HR Intensity Scoring
function computeWorkoutIntensityScores(
  workouts: WorkoutRecord[],
  userAge: number | null,
): { workoutIntensityScores: TrainingProfile['workoutIntensityScores']; rpeCalibrationFactor: number } {
  const estimatedMaxHr = userAge != null && userAge > 0 ? 220 - userAge : 190;
  const scores: TrainingProfile['workoutIntensityScores'] = [];
  const calibrations: number[] = [];

  for (const w of workouts) {
    const avgHr = w.workout_avg_hr;
    const peakHr = w.workout_peak_hr;
    if (avgHr == null) continue;

    const hrBasedIntensity = Math.min(100, (avgHr / estimatedMaxHr) * 100);
    const effort = w.session_rpe ?? w.perceived_effort;
    const subjectiveRpe = effort != null ? effort * 10 : null;
    const rpeCalibration = subjectiveRpe != null ? subjectiveRpe - hrBasedIntensity : 0;

    if (subjectiveRpe != null) calibrations.push(rpeCalibration);

    scores.push({
      workoutId: w.id,
      date: w.date,
      avgHr,
      peakHr,
      hrBasedIntensity: Math.round(hrBasedIntensity * 10) / 10,
      subjectiveRpe: subjectiveRpe != null ? Math.round(subjectiveRpe * 10) / 10 : null,
      rpeCalibration: Math.round(rpeCalibration * 10) / 10,
    });
  }

  return {
    workoutIntensityScores: scores,
    rpeCalibrationFactor: calibrations.length > 0 ? Math.round(mean(calibrations) * 10) / 10 : 0,
  };
}

// Feature #7: Movement Pattern Fatigue
const MOVEMENT_PATTERN_MAP: Record<string, string[]> = {
  horizontal_push: ['chest', 'pectoralis major', 'pectoralis'],
  horizontal_pull: ['upper back', 'rhomboids', 'mid back'],
  vertical_push: ['shoulders', 'deltoids', 'anterior deltoid', 'front delts'],
  vertical_pull: ['lats', 'latissimus dorsi'],
  hip_hinge: ['glutes', 'gluteus maximus', 'hamstrings', 'lower back', 'erector spinae'],
  knee_dominant: ['quadriceps', 'quads'],
  isolation_upper: ['biceps', 'triceps', 'forearms', 'lateral deltoid', 'rear deltoid', 'side delts', 'rear delts'],
  isolation_lower: ['calves', 'adductors', 'abductors', 'hip_flexors'],
};

const EXERCISE_NAME_PATTERN_HINTS: Array<{ keywords: string[]; pattern: string }> = [
  { keywords: ['bench press', 'push-up', 'chest press', 'chest fly', 'dumbbell press', 'floor press'], pattern: 'horizontal_push' },
  { keywords: ['row', 'seated row', 'cable row', 'barbell row', 'dumbbell row'], pattern: 'horizontal_pull' },
  { keywords: ['overhead press', 'shoulder press', 'ohp', 'military press', 'arnold press'], pattern: 'vertical_push' },
  { keywords: ['pull-up', 'chin-up', 'pulldown', 'lat pulldown', 'pull up'], pattern: 'vertical_pull' },
  { keywords: ['deadlift', 'rdl', 'romanian', 'hip thrust', 'good morning', 'back extension', 'glute bridge'], pattern: 'hip_hinge' },
  { keywords: ['squat', 'leg press', 'lunge', 'split squat', 'hack squat', 'goblet squat', 'step up'], pattern: 'knee_dominant' },
  { keywords: ['curl', 'tricep', 'extension', 'lateral raise', 'front raise', 'face pull', 'shrug', 'hammer curl', 'skullcrusher'], pattern: 'isolation_upper' },
  { keywords: ['leg extension', 'leg curl', 'calf raise', 'hip adduction', 'hip abduction', 'seated calf'], pattern: 'isolation_lower' },
];

function classifyMovementPattern(exercise: { exercise_name: string }, enriched?: EnrichedExercise): string | null {
  // Try enriched data first: match primary muscles to pattern
  if (enriched?.primary_muscles) {
    for (const [pattern, muscles] of Object.entries(MOVEMENT_PATTERN_MAP)) {
      for (const muscle of enriched.primary_muscles) {
        if (muscles.some(m => muscle.toLowerCase().includes(m))) return pattern;
      }
    }
  }
  if (enriched?.movement_pattern) {
    const mp = enriched.movement_pattern.toLowerCase();
    if (mp.includes('push') && mp.includes('horizontal')) return 'horizontal_push';
    if (mp.includes('pull') && mp.includes('horizontal')) return 'horizontal_pull';
    if (mp.includes('push') && mp.includes('vertical')) return 'vertical_push';
    if (mp.includes('pull') && mp.includes('vertical')) return 'vertical_pull';
    if (mp.includes('hinge')) return 'hip_hinge';
    if (mp.includes('squat')) return 'knee_dominant';
  }

  // Fall back to exercise name keyword matching
  const lower = exercise.exercise_name.toLowerCase();
  for (const hint of EXERCISE_NAME_PATTERN_HINTS) {
    if (hint.keywords.some(k => lower.includes(k))) return hint.pattern;
  }
  return null;
}

function computeMovementPatternFatigue(
  workouts: WorkoutRecord[],
  exercises: EnrichedExercise[],
): TrainingProfile['movementPatternFatigue'] {
  const now = Date.now();
  const todayStr = localDateStr(new Date());
  const oneWeekAgoStr = localDateStr(new Date(now - 7 * 24 * 60 * 60 * 1000));

  const allPatterns = Object.keys(MOVEMENT_PATTERN_MAP);
  const patternLastTrained = new Map<string, string>();
  const patternWeeklyCount = new Map<string, Set<string>>();

  for (const p of allPatterns) {
    patternWeeklyCount.set(p, new Set());
  }

  const enrichedMap = new Map<string, EnrichedExercise>();
  for (const e of exercises) enrichedMap.set(e.name.toLowerCase(), e);

  for (const w of workouts) {
    for (const ex of w.workout_exercises) {
      const enriched = enrichedMap.get(ex.exercise_name.toLowerCase());
      const pattern = classifyMovementPattern(ex, enriched);
      if (!pattern) continue;

      const existing = patternLastTrained.get(pattern);
      if (!existing || w.date > existing) patternLastTrained.set(pattern, w.date);

      if (w.date >= oneWeekAgoStr && w.date <= todayStr) {
        patternWeeklyCount.get(pattern)!.add(w.date);
      }
    }
  }

  return allPatterns.map(pattern => {
    const lastDate = patternLastTrained.get(pattern) ?? null;
    let hoursSince: number | null = null;
    let fatigueLevel: 'fresh' | 'moderate' | 'high' = 'fresh';

    if (lastDate) {
      hoursSince = (now - new Date(lastDate).getTime()) / (1000 * 60 * 60);
      if (hoursSince < 24) fatigueLevel = 'high';
      else if (hoursSince < 48) fatigueLevel = 'moderate';
    }

    return {
      pattern,
      lastTrainedDate: lastDate,
      hoursSinceLastTrained: hoursSince != null ? Math.round(hoursSince * 10) / 10 : null,
      weeklySessionCount: patternWeeklyCount.get(pattern)!.size,
      fatigueLevel,
    };
  });
}

// Feature #8: Sleep Quality → Volume Modifier
function computeSleepVolumeModifier(health: HealthRecord[]): TrainingProfile['sleepVolumeModifier'] {
  const defaultResult: TrainingProfile['sleepVolumeModifier'] = {
    lastNightSleepHours: null,
    lastNightSleepQuality: null,
    volumeMultiplier: 1.0,
    restTimeMultiplier: 1.0,
    reason: 'No sleep data available',
  };

  const sleepRecords = health.filter(h => h.sleep_duration != null).sort((a, b) => a.date.localeCompare(b.date));
  if (sleepRecords.length === 0) return defaultResult;

  const latest = sleepRecords[sleepRecords.length - 1];
  const hours = normalizeSleepHours(latest.sleep_duration)!;

  let quality: 'poor' | 'fair' | 'good' | 'excellent';
  let volumeMultiplier: number;
  let restTimeMultiplier: number;

  if (hours < 5) {
    quality = 'poor';
    volumeMultiplier = 0.80;
    restTimeMultiplier = 1.25;
  } else if (hours < 6) {
    quality = 'fair';
    volumeMultiplier = 0.90;
    restTimeMultiplier = 1.15;
  } else if (hours < 7.5) {
    quality = 'good';
    volumeMultiplier = 1.0;
    restTimeMultiplier = 1.0;
  } else {
    quality = 'excellent';
    volumeMultiplier = 1.05;
    restTimeMultiplier = 1.0;
  }

  // Adjust for sleep efficiency if available from source_data
  const efficiency = latest.source_data?.sleep_efficiency;
  if (typeof efficiency === 'number' && efficiency < 75) {
    volumeMultiplier = Math.max(0.75, volumeMultiplier - 0.05);
  }

  return {
    lastNightSleepHours: Math.round(hours * 10) / 10,
    lastNightSleepQuality: quality,
    volumeMultiplier: Math.round(volumeMultiplier * 100) / 100,
    restTimeMultiplier: Math.round(restTimeMultiplier * 100) / 100,
    reason: `${quality} sleep (${hours.toFixed(1)}h)${efficiency != null && efficiency < 75 ? ' with low efficiency' : ''}`,
  };
}

// #1: Compute prescribed vs actual compliance from generated_workouts
async function computePrescribedVsActual(userId: string, workouts: WorkoutRecord[], exercises: EnrichedExercise[]) {
  const defaultResult = {
    complianceRate: 0.5,
    avgWeightDeviation: 0,
    avgRepsDeviation: 0,
    exercisesCompleted: 0,
    exercisesSkipped: 0,
    avgSessionOutcomeScore: 0,
    outcomeSampleSize: 0,
    avgSetExecutionAccuracy: 0,
    executionSampleSize: 0,
    muscleGroupExecutionDeltas: {} as Record<string, {
      completionRate: number;
      avgWeightDeviation: number;
      avgRepsDeviation: number;
      sampleSize: number;
      prescribedCount: number;
      completedCount: number;
    }>,
  };
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

    const dominantGroupByExercise = new Map<string, string>();
    for (const ex of exercises) {
      const groups = (Array.isArray(ex.primary_muscles) ? ex.primary_muscles : [])
        .map(m => MUSCLE_HEAD_TO_GROUP[m])
        .filter(Boolean);
      if (groups.length > 0) dominantGroupByExercise.set(ex.name.toLowerCase(), groups[0]);
    }
    const getDominantGroup = (exerciseName: unknown): string | null => {
      const key = String(exerciseName || '').toLowerCase().trim();
      if (!key) return null;
      return dominantGroupByExercise.get(key) ?? null;
    };

    const { data: outcomes } = await supabase
      .from('workout_outcomes')
      .select('generated_workout_id, session_outcome_score')
      .eq('user_id', userId)
      .in('generated_workout_id', genIds.slice(0, 20));
    const { data: executionEvents } = await supabase
      .from('prescription_execution_events')
      .select('execution_accuracy')
      .eq('user_id', userId)
      .in('generated_workout_id', genIds.slice(0, 20));

    let totalPrescribed = 0, totalCompleted = 0, totalSkipped = 0;
    let weightDeviations: number[] = [], repsDeviations: number[] = [];
    const byGroup = new Map<string, {
      prescribed: number;
      completed: number;
      weightDev: number[];
      repsDev: number[];
    }>();
    const ensureGroup = (group: string) => {
      if (!byGroup.has(group)) byGroup.set(group, { prescribed: 0, completed: 0, weightDev: [], repsDev: [] });
      return byGroup.get(group)!;
    };

    for (const gen of generated) {
      const actual = linkedWorkouts.find(w => (w as any).generated_workout_id === gen.id);
      if (!actual) continue;
      const prescribedExercises: any[] = Array.isArray(gen.exercises) ? gen.exercises : [];
      const actualExNames = new Set(actual.workout_exercises.map(e => e.exercise_name.toLowerCase()));

      for (const pe of prescribedExercises) {
        if (!pe.exerciseName) continue;
        totalPrescribed++;
        const group = getDominantGroup(pe.exerciseName);
        if (group) ensureGroup(group).prescribed += 1;
        if (actualExNames.has(pe.exerciseName.toLowerCase())) {
          totalCompleted++;
          if (group) ensureGroup(group).completed += 1;
          const actualEx = actual.workout_exercises.find(
            e => e.exercise_name.toLowerCase() === pe.exerciseName.toLowerCase()
          );
          if (actualEx && pe.targetWeight && pe.targetWeight > 0) {
            const actualSets = Array.isArray(actualEx.workout_sets) ? actualEx.workout_sets : [];
            const actualWeight = actualSets.find(s => s.weight)?.weight;
            if (actualWeight) {
              const wDev = (actualWeight - pe.targetWeight) / pe.targetWeight;
              weightDeviations.push(wDev);
              if (group) ensureGroup(group).weightDev.push(wDev);
            }
            const actualReps = actualSets.find(s => s.reps)?.reps;
            if (actualReps && pe.targetReps) {
              const rDev = actualReps - pe.targetReps;
              repsDeviations.push(rDev);
              if (group) ensureGroup(group).repsDev.push(rDev);
            }
          }
        } else {
          totalSkipped++;
        }
      }
    }

    const outcomeScores = (outcomes ?? [])
      .map((o: any) => Number(o?.session_outcome_score))
      .filter((s: number) => Number.isFinite(s) && s >= 0 && s <= 1);
    const executionScores = (executionEvents ?? [])
      .map((e: any) => Number(e?.execution_accuracy))
      .filter((s: number) => Number.isFinite(s) && s >= 0 && s <= 1);

    const muscleGroupExecutionDeltas = Object.fromEntries(
      [...byGroup.entries()].map(([group, agg]) => {
        const sampleSize = Math.max(agg.weightDev.length, agg.repsDev.length);
        return [group, {
          completionRate: agg.prescribed > 0 ? agg.completed / agg.prescribed : 0,
          avgWeightDeviation: agg.weightDev.length > 0 ? mean(agg.weightDev) : 0,
          avgRepsDeviation: agg.repsDev.length > 0 ? mean(agg.repsDev) : 0,
          sampleSize,
          prescribedCount: agg.prescribed,
          completedCount: agg.completed,
        }];
      })
    );

    return {
      complianceRate: totalPrescribed > 0 ? totalCompleted / totalPrescribed : 0.5,
      avgWeightDeviation: weightDeviations.length > 0 ? mean(weightDeviations) : 0,
      avgRepsDeviation: repsDeviations.length > 0 ? mean(repsDeviations) : 0,
      exercisesCompleted: totalCompleted,
      exercisesSkipped: totalSkipped,
      avgSessionOutcomeScore: outcomeScores.length > 0 ? mean(outcomeScores) : 0,
      outcomeSampleSize: outcomeScores.length,
      avgSetExecutionAccuracy: executionScores.length > 0 ? mean(executionScores) : 0,
      executionSampleSize: executionScores.length,
      muscleGroupExecutionDeltas,
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
  const todayStr = localDateStr(today);

  const sorted = [...workouts].sort((a, b) => a.date.localeCompare(b.date));

  for (const w of sorted) {
    const daysAgo = daysBetween(w.date, todayStr);
    if (daysAgo < 0) continue;

    // Training impulse (TRIMP-like): duration_hours × effort (1-10 scale)
    // Typical values: 1hr × RPE 6 = 6.0, 1.5hr × RPE 7 = 10.5
    const durationMin = w.duration ?? 0;
    const durationHours = durationMin > 0 ? durationMin / 60 : 0.5;
    const totalSets = w.workout_exercises.reduce((s, e) => s + (e.workout_sets?.length || 0), 0);
    const estimatedEffort = durationMin > 60 ? 5 : durationMin > 30 ? 4 : totalSets > 15 ? 5 : 3;
    const effort = (w as any).perceived_effort ?? (w as any).session_rpe ?? estimatedEffort;
    const impulse = durationHours * effort;

    fitness += impulse * Math.exp(-daysAgo / FITNESS_TAU);
    fatigue += impulse * Math.exp(-daysAgo / FATIGUE_TAU);
  }

  const performance = fitness - fatigue;
  // Standard Banister readiness: 1 - (fatigue / fitness)
  // When fatigue = 0: readiness = 1. When fatigue = fitness: readiness = 0.
  // After months of training, fitness grows large but fatigue spikes are relative.
  const readiness = fitness > 0
    ? Math.max(0, Math.min(1, 1 - (fatigue / fitness) * 0.7))
    : 0.5;

  return {
    fitnessLevel: Math.round(fitness * 10) / 10,
    fatigueLevel: Math.round(fatigue * 10) / 10,
    performancePrediction: Math.round(performance * 10) / 10,
    readiness: Math.round(readiness * 100) / 100,
  };
}
