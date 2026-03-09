/**
 * Workout Generation Engine — Evidence-Based Rules Engine
 *
 * 6-step deterministic workout generator that takes a TrainingProfile
 * (from trainingAnalysis.ts) and user preferences to produce a complete
 * workout prescription with rationale.
 *
 * Steps:
 *   1. Recovery check + global adjustments
 *   2. Select body parts / muscle groups for today
 *   3. Select exercises per muscle group
 *   4. Prescribe sets, reps, weight, tempo
 *   5. Apply session constraints (duration, ordering)
 *   6. Generate per-exercise rationale
 */

import { requireSupabase } from './supabase';
import { VOLUME_GUIDELINES, MUSCLE_HEAD_TO_GROUP, getGuidelineForGroup } from './volumeGuidelines';
import type { TrainingProfile, ExerciseProgression, EnrichedExercise, ExercisePreference, CardioHistory, ExerciseOrderProfile } from './trainingAnalysis';
import { uuidv4 } from '../utils/uuid';
import { getExerciseMapping } from './exerciseMuscleMap';
import { estimateWeight as estimateWeightFromRatios } from './liftRatios';
import { suggestSupersets, type SupersetSuggestion } from './supersetPairer';
import { DEFAULT_MODEL_CONFIG, type ModelConfig } from './modelConfig';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PerformanceGoal {
  exercise: string;
  targetWeight: string;
  targetReps: string;
}

export interface UserPreferences {
  training_goal: 'strength' | 'hypertrophy' | 'general_fitness' | 'fat_loss';
  primary_goal: 'strength' | 'hypertrophy' | 'fat_loss' | 'endurance' | null;
  secondary_goal: 'strength' | 'hypertrophy' | 'fat_loss' | 'endurance' | null;
  session_duration_minutes: number;
  equipment_access: 'full_gym' | 'home_gym' | 'limited';
  available_days_per_week: number;
  injuries: Array<{ body_part: string; description: string; severity: string }>;
  exercises_to_avoid: string[];
  performance_goals: PerformanceGoal[];
  preferred_split: string | null;
  date_of_birth: string | null;
  gender: string | null;
  height_feet: number | null;
  height_inches: number | null;
  job_activity_level: string | null;
  experience_level: string | null;
  body_weight_lbs: number | null;
  cardio_preference: string | null;
  cardio_frequency_per_week: number | null;
  cardio_duration_minutes: number | null;
  preferred_exercises: string[] | null;
  recovery_speed: number | null;
  weight_goal_lbs: number | null;
  weight_goal_date: string | null;
  priority_muscles: string[];
  weekday_deadlines: Record<string, string>;
  gym_profiles: Array<{ name: string; equipment: string[] }>;
  active_gym_profile: string | null;
  age: number | null;
  rest_days: number[]; // 0=Sun, 1=Mon, ... 6=Sat
}

export type ExerciseRole = 'primary' | 'secondary' | 'isolation' | 'corrective' | 'cardio';

export interface WarmupSet {
  weight: number;
  reps: number;
}

export interface GeneratedExercise {
  exerciseName: string;
  exerciseLibraryId: string;
  bodyPart: string;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  movementPattern: string;
  targetMuscleGroup: string;
  exerciseRole: ExerciseRole;
  sets: number;
  targetReps: number;
  targetWeight: number | null;
  targetRir: number | null;
  rirLabel: string | null;
  isBodyweight: boolean;
  tempo: string;
  restSeconds: number;
  rationale: string;
  adjustments: string[];
  isDeload: boolean;
  isCardio: boolean;
  cardioDurationSeconds: number | null;
  cardioSpeed: number | null;
  cardioIncline: number | null;
  cardioSpeedLabel: string | null;
  targetHrZone: number | null;
  targetHrBpmRange: { min: number; max: number } | null;
  warmupSets: WarmupSet[] | null;
  supersetGroupId: number | null;
  supersetType: 'antagonist' | 'pre_exhaust' | 'compound_set' | null;
  impactScore: number | null;
  estimatedMinutes: number;
}

export interface DecisionLogEntry {
  step: string;
  label: string;
  details: string[];
}

export interface MuscleGroupDecision {
  muscleGroup: string;
  priority: number;
  reason: string;
  targetSets: number;
  recoveryPercent: number | null;
  weeklyVolume: number | null;
  volumeTarget: string | null;
}

export interface ExerciseDecision {
  exerciseName: string;
  muscleGroup: string;
  score: number;
  factors: string[];
}

export interface GeneratedWorkout {
  id: string;
  date: string;
  trainingGoal: string;
  estimatedDurationMinutes: number;
  muscleGroupsFocused: string[];
  exercises: GeneratedExercise[];
  sessionRationale: string;
  recoveryStatus: string;
  adjustmentsSummary: string[];
  deloadActive: boolean;
  decisionLog: DecisionLogEntry[];
  muscleGroupDecisions: MuscleGroupDecision[];
  exerciseDecisions: ExerciseDecision[];
}

// ─── Data Fetching ──────────────────────────────────────────────────────────

async function fetchUserPreferences(userId: string): Promise<UserPreferences> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('user_preferences')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error && error.code !== 'PGRST116') throw error;

  const rawInjuries = data?.injuries;
  const rawAvoid = data?.exercises_to_avoid;
  const rawGoals = data?.performance_goals;
  const rawPrefExercises = data?.preferred_exercises;
  const rawPriorityMuscles = data?.priority_muscles;
  const rawDeadlines = data?.weekday_deadlines;
  const rawGymProfiles = data?.gym_profiles;

  let computedAge: number | null = null;
  if (data?.age != null) {
    computedAge = Number(data.age);
  } else if (data?.date_of_birth) {
    const dob = new Date(data.date_of_birth);
    if (!isNaN(dob.getTime())) {
      computedAge = Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
    }
  }

  return {
    training_goal: data?.training_goal ?? 'hypertrophy',
    primary_goal: data?.primary_goal ?? null,
    secondary_goal: data?.secondary_goal ?? null,
    session_duration_minutes: data?.session_duration_minutes ?? 75,
    equipment_access: data?.equipment_access ?? 'full_gym',
    available_days_per_week: data?.available_days_per_week ?? 5,
    injuries: Array.isArray(rawInjuries) ? rawInjuries : [],
    exercises_to_avoid: Array.isArray(rawAvoid) ? rawAvoid : [],
    performance_goals: Array.isArray(rawGoals) ? rawGoals : [],
    preferred_split: data?.preferred_split ?? null,
    date_of_birth: data?.date_of_birth ?? null,
    gender: data?.gender ?? null,
    height_feet: data?.height_feet ?? null,
    height_inches: data?.height_inches ?? null,
    job_activity_level: data?.job_activity_level ?? null,
    experience_level: data?.experience_level ?? null,
    body_weight_lbs: data?.body_weight_lbs != null ? Number(data.body_weight_lbs) : null,
    cardio_preference: data?.cardio_preference ?? null,
    cardio_frequency_per_week: data?.cardio_frequency_per_week != null ? Number(data.cardio_frequency_per_week) : null,
    cardio_duration_minutes: data?.cardio_duration_minutes != null ? Number(data.cardio_duration_minutes) : null,
    preferred_exercises: Array.isArray(rawPrefExercises) ? rawPrefExercises : null,
    recovery_speed: data?.recovery_speed != null ? Number(data.recovery_speed) : null,
    weight_goal_lbs: data?.weight_goal_lbs != null ? Number(data.weight_goal_lbs) : null,
    weight_goal_date: data?.weight_goal_date ?? null,
    priority_muscles: Array.isArray(rawPriorityMuscles) ? rawPriorityMuscles : [],
    weekday_deadlines: (typeof rawDeadlines === 'object' && rawDeadlines !== null && !Array.isArray(rawDeadlines)) ? rawDeadlines as Record<string, string> : {},
    gym_profiles: Array.isArray(rawGymProfiles) ? rawGymProfiles : [],
    active_gym_profile: data?.active_gym_profile ?? null,
    age: computedAge,
    rest_days: Array.isArray(data?.rest_days) ? data.rest_days : [],
  };
}

async function fetchAllExercises(): Promise<EnrichedExercise[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('exercise_library')
    .select('id, name, body_part, primary_muscles, secondary_muscles, stabilizer_muscles, movement_pattern, ml_exercise_type, force_type, difficulty, default_tempo, equipment')
    .eq('is_custom', false);

  if (error) throw error;
  return (data ?? []) as EnrichedExercise[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateId(): string {
  return uuidv4();
}

/**
 * Rep ranges vary by exercise role and goal.
 * Sources: NSCA CSCS guidelines, ACSM, Helms et al. (2014)
 *
 * If a secondary goal is set, ranges are blended 70/30.
 */
const REP_RANGE_TABLE: Record<string, Record<string, { min: number; max: number; target: number }>> = {
  strength:        { primary: { min: 3, max: 5, target: 4 },  secondary: { min: 5, max: 8, target: 6 },  isolation: { min: 8, max: 12, target: 10 } },
  hypertrophy:     { primary: { min: 6, max: 10, target: 8 }, secondary: { min: 8, max: 12, target: 10 }, isolation: { min: 10, max: 15, target: 12 } },
  fat_loss:        { primary: { min: 8, max: 12, target: 10 }, secondary: { min: 10, max: 15, target: 12 }, isolation: { min: 12, max: 20, target: 15 } },
  endurance:       { primary: { min: 12, max: 15, target: 13 }, secondary: { min: 15, max: 20, target: 17 }, isolation: { min: 15, max: 25, target: 20 } },
  general_fitness: { primary: { min: 6, max: 10, target: 8 }, secondary: { min: 8, max: 12, target: 10 }, isolation: { min: 10, max: 15, target: 12 } },
};

function getRepRangeByRole(
  role: ExerciseRole,
  primaryGoal: string,
  secondaryGoal: string | null
): { min: number; max: number; target: number } {
  const roleKey = role === 'corrective' ? 'isolation' : role === 'cardio' ? 'isolation' : role;
  const primary = REP_RANGE_TABLE[primaryGoal]?.[roleKey] ?? REP_RANGE_TABLE.general_fitness[roleKey];

  if (!secondaryGoal || secondaryGoal === primaryGoal) return primary;

  const secondary = REP_RANGE_TABLE[secondaryGoal]?.[roleKey] ?? primary;
  return {
    min: Math.round(primary.min * 0.7 + secondary.min * 0.3),
    max: Math.round(primary.max * 0.7 + secondary.max * 0.3),
    target: Math.round(primary.target * 0.7 + secondary.target * 0.3),
  };
}

function getTieredSets(
  role: ExerciseRole,
  goal: string,
  isPriorityMuscle: boolean,
  isDeload: boolean
): number {
  if (isDeload) {
    return role === 'primary' ? 3 : 2;
  }
  switch (role) {
    case 'primary': return goal === 'strength' ? 5 : 4;
    case 'secondary': return isPriorityMuscle ? 4 : 3;
    case 'isolation': return isPriorityMuscle ? 3 : 2;
    case 'corrective': return 2;
    default: return 3;
  }
}

/**
 * RIR targets by role. Solo training buffer: +1 on primary compounds.
 * Source: Helms et al. (2016), Zourdos et al. (2016)
 */
function getRirTarget(role: ExerciseRole, goal: string, isDeload: boolean): number {
  if (isDeload) return 4;
  switch (role) {
    case 'primary': return goal === 'strength' ? 3 : 3; // +1 solo buffer already applied
    case 'secondary': return 2;
    case 'isolation': return goal === 'strength' ? 2 : 1;
    case 'corrective': return 3;
    default: return 2;
  }
}

function getRirLabel(rir: number): string {
  if (rir >= 4) return 'Light — leave plenty in the tank';
  if (rir === 3) return 'Leave 3 in the tank';
  if (rir === 2) return 'Leave 2 in the tank';
  if (rir === 1) return 'Leave 1 in the tank';
  return 'Push close to failure';
}

/**
 * Rest periods based on exercise demand, not just role.
 *
 * Factors:
 *   - exercise_type: compound needs more rest than isolation
 *   - primary muscle count: more muscles = more systemic fatigue
 *   - movement_pattern: squats/deadlifts > lunges > extensions > curls
 *   - training goal: strength demands longer rest than hypertrophy
 *
 * This means a squat (compound, 5 primaries, squat pattern) gets ~180s
 * while a calf raise (isolation, 2 primaries, extension) gets ~60s,
 * even if both happen to be classified as the same role.
 */
function getRestByExercise(
  exercise: EnrichedExercise,
  role: ExerciseRole,
  goal: string
): number {
  if (role === 'corrective') return 45;
  if (role === 'cardio') return 0;

  const mapping = getExerciseMapping(exercise.name);
  const exType = mapping?.exercise_type ?? exercise.ml_exercise_type ?? 'compound';
  const primaryCount = mapping?.primary_muscles?.length ?? 1;
  const pattern = mapping?.movement_pattern ?? '';

  // Base rest by how systemically demanding the movement is
  let base: number;
  if (exType === 'compound' && primaryCount >= 4) {
    base = 150; // heavy compound (squat, deadlift, bench)
  } else if (exType === 'compound') {
    base = 110; // lighter compound (row, lunge, OHP)
  } else {
    base = 60;  // isolation (curls, extensions, raises)
  }

  // Pattern-specific adjustments
  const heavyPatterns = ['squat', 'deadlift', 'hip_hinge'];
  const mediumPatterns = ['horizontal_press', 'vertical_press', 'lunge'];
  const lightPatterns = ['extension', 'curl', 'fly', 'raise'];

  if (heavyPatterns.includes(pattern)) {
    base += 30;
  } else if (mediumPatterns.includes(pattern)) {
    base += 10;
  } else if (lightPatterns.includes(pattern)) {
    base -= 10;
  }

  // Goal scaling
  if (goal === 'strength') {
    base = Math.round(base * 1.5);
  } else if (goal === 'fat_loss') {
    base = Math.round(base * 0.75);
  }

  return Math.max(30, Math.min(300, base));
}

function getTempo(defaultTempo: string | null, goal: string, exerciseType: string | null): string {
  if (defaultTempo) return defaultTempo;
  if (goal === 'hypertrophy') return exerciseType === 'compound' ? '2-1-1' : '3-1-2';
  if (goal === 'strength') return '1-1-1';
  return '2-1-1';
}

function isInjuryConflict(exercise: EnrichedExercise, injuries: UserPreferences['injuries']): boolean {
  if (!Array.isArray(injuries)) return false;
  for (const injury of injuries) {
    const injuryPart = injury?.body_part?.toLowerCase?.();
    if (!injuryPart) continue;
    if (exercise.body_part?.toLowerCase().includes(injuryPart)) return true;
    const muscles = Array.isArray(exercise.primary_muscles) ? exercise.primary_muscles : [];
    for (const m of muscles) {
      if (m?.toLowerCase().includes(injuryPart)) return true;
    }
  }
  return false;
}

/**
 * Time-per-set estimates for budget calculations (in minutes).
 * Includes set execution + rest period.
 */
function estimateExerciseMinutes(
  sets: number, restSeconds: number, role: ExerciseRole, warmupSets: number = 0,
  avgSessionDuration?: number, exerciseCount?: number
): number {
  // #16: If we have historical session data, derive per-exercise time from actuals
  if (avgSessionDuration && exerciseCount && exerciseCount > 0) {
    const perExerciseMin = avgSessionDuration / 60 / exerciseCount;
    if (perExerciseMin > 2 && perExerciseMin < 25) {
      return perExerciseMin * (sets / 3); // scale by set count relative to typical 3
    }
  }
  const setExecutionSec = role === 'primary' ? 40 : role === 'secondary' ? 35 : 30;
  const warmupRestSec = 60;
  const workingTime = sets * (setExecutionSec + restSeconds);
  const warmupTime = warmupSets * (30 + warmupRestSec);
  return (workingTime + warmupTime) / 60;
}

function classifyExerciseRole(
  exercise: EnrichedExercise,
  indexInGroup: number
): ExerciseRole {
  if (exercise.ml_exercise_type === 'cardio') return 'cardio';
  if (indexInGroup === 0 && (exercise.ml_exercise_type === 'compound')) return 'primary';
  if (exercise.ml_exercise_type === 'compound') return 'secondary';
  return 'isolation';
}

/**
 * Generates warmup ramp sets for compound exercises.
 * Source: NSCA CSCS guidelines (Baechle & Earle 2008)
 */
function generateWarmupRamp(workingWeight: number, warmupHistory?: { sets: number; avgPct: number } | null): WarmupSet[] {
  if (workingWeight <= 50) return [];

  // #17: If user has warmup history, respect their pattern
  if (warmupHistory && warmupHistory.sets >= 1 && warmupHistory.avgPct > 0) {
    const n = Math.min(warmupHistory.sets, 4);
    const startPct = Math.max(0.3, warmupHistory.avgPct * 0.5);
    const endPct = warmupHistory.avgPct;
    const ramp: WarmupSet[] = [];
    for (let i = 0; i < n; i++) {
      const pct = startPct + (endPct - startPct) * (i / Math.max(n - 1, 1));
      const w = Math.round(workingWeight * pct / 5) * 5;
      const r = Math.max(2, Math.round(10 - i * 2.5));
      if (w >= 20 && w < workingWeight) ramp.push({ weight: w, reps: r });
    }
    return ramp;
  }

  if (workingWeight <= 95) {
    return [
      { weight: Math.round(workingWeight * 0.5 / 5) * 5, reps: 8 },
      { weight: Math.round(workingWeight * 0.75 / 5) * 5, reps: 5 },
    ];
  }

  return [
    { weight: 45, reps: 10 },
    { weight: Math.round(workingWeight * 0.5 / 5) * 5, reps: 5 },
    { weight: Math.round(workingWeight * 0.7 / 5) * 5, reps: 3 },
    { weight: Math.round(workingWeight * 0.85 / 5) * 5, reps: 2 },
  ];
}

/**
 * Pareto impact score: how much training stimulus does this exercise deliver per minute?
 * Higher = more impactful. Used for time-constrained session trimming.
 * Score = primary_goal_impact * 0.7 + secondary_goal_impact * 0.3
 */
function computeImpactScore(
  exercise: EnrichedExercise,
  role: ExerciseRole,
  primaryGoal: string,
  secondaryGoal: string | null
): number {
  const primaryMuscleCount = Array.isArray(exercise.primary_muscles) ? exercise.primary_muscles.length : 0;

  function goalImpact(goal: string): number {
    const compoundBonus = exercise.ml_exercise_type === 'compound' ? 3 : 0;
    const massBonus = Math.min(primaryMuscleCount, 5);
    switch (goal) {
      case 'strength': return compoundBonus * 2 + massBonus;
      case 'hypertrophy': return compoundBonus + massBonus * 1.5;
      case 'fat_loss': return compoundBonus * 1.5 + massBonus * 1.5;
      case 'endurance': return massBonus * 2;
      default: return compoundBonus + massBonus;
    }
  }

  const primary = goalImpact(primaryGoal);
  const secondary = secondaryGoal ? goalImpact(secondaryGoal) : primary;
  let score = primary * 0.7 + secondary * 0.3;

  if (role === 'corrective') score *= 2.0; // correctives are never cut
  if (role === 'primary') score *= 1.3;

  // #14: Stimulus-to-fatigue ratio — isolation exercises deliver targeted stimulus
  // with less systemic fatigue, prefer them during deloads or reduced capacity
  const isIsolation = exercise.ml_exercise_type === 'isolation';
  const sfrBonus = isIsolation ? 1.5 : 0;
  score += sfrBonus;

  return Math.round(score * 10) / 10;
}

/** Resolve effective goal: use primary_goal if set, fall back to training_goal */
function getEffectiveGoal(prefs: UserPreferences): string {
  return prefs.primary_goal ?? prefs.training_goal;
}

// ─── Step 1: Recovery Check ─────────────────────────────────────────────────

interface RecoveryAdjustment {
  volumeMultiplier: number;
  adjustmentReasons: string[];
  isDeload: boolean;
}

function stepRecoveryCheck(profile: TrainingProfile, cfg: ModelConfig): RecoveryAdjustment {
  const reasons: string[] = [];
  let volumeMultiplier = 1.0;

  if (profile.deloadRecommendation.needed) {
    return {
      volumeMultiplier: profile.deloadRecommendation.suggestedVolumeMultiplier,
      adjustmentReasons: ['Deload recommended: ' + profile.deloadRecommendation.signals.join('; ')],
      isDeload: true,
    };
  }

  const { recoveryContext } = profile;

  // Sleep: single-night vs baseline
  if (recoveryContext.sleepDurationLastNight != null && recoveryContext.sleepBaseline30d != null) {
    const sleepRatio = recoveryContext.sleepDurationLastNight / recoveryContext.sleepBaseline30d;
    if (sleepRatio < cfg.sleepReductionThreshold) {
      const reduction = Math.min(Math.round((1 - sleepRatio) * 100 * (cfg.sleepMaxReduction / 0.30)), Math.round(cfg.sleepMaxReduction * 100));
      volumeMultiplier *= 1 - reduction / 100;
      reasons.push(`Sleep ${Math.round((1 - sleepRatio) * 100)}% below baseline → volume −${reduction}%`);
    }
  }

  // Cumulative sleep debt: amplifies the single-night signal
  if (profile.cumulativeSleepDebt.recoveryModifier < 1.0) {
    const debtPct = Math.round((1 - profile.cumulativeSleepDebt.recoveryModifier) * 100);
    volumeMultiplier *= profile.cumulativeSleepDebt.recoveryModifier;
    reasons.push(`Cumulative sleep debt (7d): recovery capacity −${debtPct}%`);
  }

  // HRV
  if (recoveryContext.hrvLastNight != null && recoveryContext.hrvBaseline30d != null) {
    const hrvRatio = recoveryContext.hrvLastNight / recoveryContext.hrvBaseline30d;
    if (hrvRatio < cfg.hrvReductionThreshold) {
      volumeMultiplier *= cfg.hrvVolumeMultiplier;
      const cut = Math.round((1 - cfg.hrvVolumeMultiplier) * 100);
      reasons.push(`HRV ${Math.round((1 - hrvRatio) * 100)}% below baseline → volume −${cut}%`);
    }
  }

  // RHR
  if (recoveryContext.rhrLastNight != null && recoveryContext.rhrBaseline30d != null) {
    const rhrRatio = recoveryContext.rhrLastNight / recoveryContext.rhrBaseline30d;
    if (rhrRatio > cfg.rhrElevationThreshold) {
      volumeMultiplier *= cfg.rhrVolumeMultiplier;
      const cut = Math.round((1 - cfg.rhrVolumeMultiplier) * 100);
      reasons.push(`RHR ${Math.round((rhrRatio - 1) * 100)}% above baseline → volume −${cut}%`);
    }
  }

  // Steps/NEAT: if strong negative correlation exists and yesterday was high-step, reduce
  const stepsCorr = profile.stepsPerformanceCorrelation;
  if (stepsCorr && stepsCorr.dataPoints >= cfg.stepsMinDataPoints && stepsCorr.coefficient < cfg.stepsCorrelationThreshold) {
    volumeMultiplier *= (1 - cfg.stepsVolumeReduction);
    reasons.push(`High NEAT load (steps correlation: ${stepsCorr.coefficient.toFixed(2)}) → volume −${Math.round(cfg.stepsVolumeReduction * 100)}%`);
  }

  // Time-of-day performance effect
  const currentHour = new Date().getHours();
  const bucket = currentHour < 10 ? 'morning' : currentHour < 14 ? 'midday'
    : currentHour < 17 ? 'afternoon' : 'evening';
  const todEffect = profile.timeOfDayEffects.find(e => e.bucket === bucket);
  if (todEffect && todEffect.avgDelta < cfg.timeOfDayDeltaThreshold && todEffect.dataPoints >= cfg.timeOfDayMinDataPoints) {
    reasons.push(`Training during ${bucket}: historically ${Math.round(Math.abs(todEffect.avgDelta) * 100)}% lower performance`);
  }

  // Consecutive days
  const consEffect = profile.consecutiveDaysEffects.find(e => e.dayIndex >= 4 && e.avgDelta < cfg.timeOfDayDeltaThreshold);
  if (consEffect && consEffect.dataPoints >= cfg.consecutiveDaysMinDataPoints) {
    reasons.push(`Consecutive training day ${consEffect.dayIndex}: historically ${Math.round(Math.abs(consEffect.avgDelta) * 100)}% lower performance`);
  }

  // Body weight trend
  if (profile.bodyWeightTrend.phase === 'cutting') {
    reasons.push('Cutting phase detected: progression expectations reduced');
  }

  // 30-day trend signals — proactive adjustments before single-day thresholds trigger
  const trends = profile.rolling30DayTrends;

  if (trends.sleep.dataPoints >= cfg.trendMinDataPoints && trends.sleep.slopePct < cfg.sleepTrendDownThreshold) {
    volumeMultiplier *= (1 - cfg.sleepTrendVolumeReduction);
    reasons.push(`Sleep trending down ${Math.abs(trends.sleep.slopePct).toFixed(1)}%/wk over 30d → proactive volume −${Math.round(cfg.sleepTrendVolumeReduction * 100)}%`);
  }

  if (trends.hrv.dataPoints >= cfg.trendMinDataPoints && trends.hrv.slopePct < cfg.hrvTrendDownThreshold) {
    volumeMultiplier *= (1 - cfg.hrvTrendVolumeReduction);
    reasons.push(`HRV trending down ${Math.abs(trends.hrv.slopePct).toFixed(1)}%/wk over 30d → proactive volume −${Math.round(cfg.hrvTrendVolumeReduction * 100)}%`);
  }

  if (trends.rhr.dataPoints >= cfg.trendMinDataPoints && trends.rhr.slopePct > cfg.rhrTrendUpThreshold) {
    volumeMultiplier *= (1 - cfg.rhrTrendVolumeReduction);
    reasons.push(`RHR trending up ${trends.rhr.slopePct.toFixed(1)}%/wk over 30d → proactive volume −${Math.round(cfg.rhrTrendVolumeReduction * 100)}%`);
  }

  if (trends.trainingFrequency.dataPoints >= 4 && trends.trainingFrequency.slopePct > cfg.frequencyTrendUpThreshold) {
    volumeMultiplier *= (1 - cfg.frequencyTrendVolumeReduction);
    reasons.push(`Training frequency spiking ${trends.trainingFrequency.slopePct.toFixed(1)}%/wk → reducing per-session volume −${Math.round(cfg.frequencyTrendVolumeReduction * 100)}%`);
  }

  // Overall strength trending down while volume is stable/up = possible overtraining or poor recovery
  if (trends.totalStrengthIndex.dataPoints >= 4 && trends.totalStrengthIndex.direction === 'down' &&
      trends.totalWeeklyVolume.direction !== 'down') {
    reasons.push(`Strength declining (${Math.abs(trends.totalStrengthIndex.slopePct).toFixed(1)}%/wk) while volume maintained — possible overreach, consider deload`);
  }

  // Relative strength trending up = effective training (body recomp or getting stronger at same weight)
  if (trends.relativeStrength.dataPoints >= 4 && trends.relativeStrength.direction === 'up') {
    reasons.push(`Relative strength improving ${trends.relativeStrength.slopePct.toFixed(1)}%/wk — effective progression`);
  }

  return { volumeMultiplier: Math.max(cfg.volumeMultiplierFloor, volumeMultiplier), adjustmentReasons: reasons, isDeload: false };
}

// ─── Step 2: Select Muscle Groups (Split-Aware) ─────────────────────────────

interface MuscleGroupSelection {
  muscleGroup: string;
  priority: number;
  reason: string;
  targetSets: number;
  recoveryPercent: number | null;
  weeklyVolume: number | null;
  volumeTarget: string | null;
}

const SPLIT_MUSCLE_MAPPING: Record<string, string[]> = {
  push: ['chest', 'anterior_deltoid', 'lateral_deltoid', 'triceps'],
  pull: ['back_lats', 'back_upper', 'biceps', 'posterior_deltoid', 'forearms'],
  legs: ['quadriceps', 'hamstrings', 'glutes', 'calves'],
  upper: ['chest', 'back_lats', 'back_upper', 'anterior_deltoid', 'lateral_deltoid', 'posterior_deltoid', 'biceps', 'triceps'],
  lower: ['quadriceps', 'hamstrings', 'glutes', 'calves'],
  full: ['chest', 'back_lats', 'quadriceps', 'anterior_deltoid', 'biceps', 'triceps', 'hamstrings', 'glutes'],
};

function stepSelectMuscleGroups(
  profile: TrainingProfile,
  prefs: UserPreferences,
  recoveryAdj: RecoveryAdjustment,
  cfg: ModelConfig,
  caloricPhaseScale: number = 1.0
): { selected: MuscleGroupSelection[]; skipped: Array<{ muscleGroup: string; reason: string }> } {
  const candidates: MuscleGroupSelection[] = [];
  const skipped: Array<{ muscleGroup: string; reason: string }> = [];

  // Determine today's target groups from detected split or user preference
  const { detectedSplit, dayOfWeekPatterns } = profile;
  const todayDow = new Date().getDay();
  const todayPattern = dayOfWeekPatterns[todayDow];

  let splitTargetGroups: Set<string> | null = null;

  // User's preferred split overrides auto-detection
  if (prefs.preferred_split && SPLIT_MUSCLE_MAPPING[prefs.preferred_split]) {
    // Use preferred split pattern with the detected rotation to pick today's focus
    if (detectedSplit.nextRecommended.length > 0) {
      splitTargetGroups = new Set<string>();
      for (const rec of detectedSplit.nextRecommended) {
        const groups = SPLIT_MUSCLE_MAPPING[rec];
        if (groups) groups.forEach(g => splitTargetGroups!.add(g));
      }
    }
  } else if (detectedSplit.confidence >= cfg.splitConfidenceThreshold && detectedSplit.nextRecommended.length > 0) {
    splitTargetGroups = new Set<string>();
    for (const rec of detectedSplit.nextRecommended) {
      const groups = SPLIT_MUSCLE_MAPPING[rec];
      if (groups) groups.forEach(g => splitTargetGroups!.add(g));
    }
  } else if (todayPattern && !todayPattern.isRestDay && todayPattern.muscleGroupsTypical.length > 0) {
    // Fall back to day-of-week pattern
    splitTargetGroups = new Set(todayPattern.muscleGroupsTypical);
  }

  // ── Cardio-strength interference (Wilson et al. 2012 meta-analysis) ──
  // Heavy cardio reduces effective MRV for lower body muscles.
  // Running/stairmaster (high eccentric): 5% leg MRV reduction per hour/week
  // Cycling/elliptical (low eccentric): 2% reduction per hour/week
  // Walking: 0% interference
  const LOWER_BODY_GROUPS = new Set(['quadriceps', 'hamstrings', 'glutes', 'calves']);
  let cardioInterferencePct = 0;
  const WEEKS_WINDOW = 4;
  const weeklyCardioMin = profile.cardioHistory.reduce((sum, c) => {
    return sum + (c.avgDurationSeconds / 60) * c.recentSessions / WEEKS_WINDOW;
  }, 0);
  const weeklyCardioHours = weeklyCardioMin / 60;

  if (weeklyCardioHours > 0) {
    const highImpactCardio = profile.cardioHistory.filter(c =>
      /run|stairmaster|stair master|sprint|jump rope/i.test(c.exerciseName)
    );
    const lowImpactCardio = profile.cardioHistory.filter(c =>
      /bike|cycle|elliptical|row/i.test(c.exerciseName)
    );

    const highImpactHours = highImpactCardio.reduce((s, c) =>
      s + (c.avgDurationSeconds / 60) * c.recentSessions / WEEKS_WINDOW / 60, 0
    );
    const lowImpactHours = lowImpactCardio.reduce((s, c) =>
      s + (c.avgDurationSeconds / 60) * c.recentSessions / WEEKS_WINDOW / 60, 0
    );

    cardioInterferencePct = Math.min(cfg.maxCardioInterferencePct, highImpactHours * cfg.highImpactCardioInterferencePct + lowImpactHours * cfg.lowImpactCardioInterferencePct);
  }

  for (const vol of profile.muscleVolumeStatuses) {
    const guideline = getGuidelineForGroup(vol.muscleGroup);
    if (!guideline) continue;

    const recovery = profile.muscleRecovery.find(r => r.muscleGroup === vol.muscleGroup);
    if (recovery && !recovery.readyToTrain) {
      skipped.push({ muscleGroup: vol.muscleGroup, reason: `Still recovering (${recovery.recoveryPercent}% recovered)` });
      continue;
    }

    const hasInjury = prefs.injuries.some(inj =>
      vol.muscleGroup.toLowerCase().includes(inj.body_part.toLowerCase())
    );
    if (hasInjury) {
      skipped.push({ muscleGroup: vol.muscleGroup, reason: 'Injury conflict' });
      continue;
    }

    const freshnessDays = vol.daysSinceLastTrained === Infinity ? 7 : vol.daysSinceLastTrained;
    const freshnessScore = Math.min(freshnessDays / (guideline.recoveryHours / 24), 2);

    let weeklyTarget = (guideline.mavLow + guideline.mavHigh) / 2;

    // #15: Caloric-phase MRV scaling
    weeklyTarget *= caloricPhaseScale;

    // Apply cardio interference: reduce volume targets for lower body
    if (LOWER_BODY_GROUPS.has(vol.muscleGroup) && cardioInterferencePct > 0) {
      weeklyTarget = weeklyTarget * (1 - cardioInterferencePct / 100);
    }

    const individualMrv = profile.individualMrvEstimates[vol.muscleGroup];
    const effectiveTarget = individualMrv ? Math.min(weeklyTarget, individualMrv * 0.85) : weeklyTarget;
    const volumeDeficit = Math.max(0, effectiveTarget - vol.weeklyDirectSets);

    // Base priority: freshness + volume deficit
    let priority = freshnessScore * 0.4 + (volumeDeficit / Math.max(effectiveTarget, 1)) * 0.3;

    if (splitTargetGroups?.has(vol.muscleGroup)) {
      priority += cfg.splitMatchBoost;
    }

    if (todayPattern?.muscleGroupsTypical.includes(vol.muscleGroup)) {
      priority += cfg.dayPatternBoost;
    }

    if (prefs.priority_muscles.some(pm => pm.toLowerCase() === vol.muscleGroup)) {
      priority += cfg.priorityMuscleBoost;
    }

    // #8: Weak-point prioritization from strength percentiles
    const liftToMuscle: Record<string, string[]> = {
      squat: ['quadriceps', 'glutes', 'hamstrings'],
      bench: ['chest', 'anterior_deltoid', 'triceps'],
      deadlift: ['back_lats', 'hamstrings', 'glutes', 'erector_spinae'],
    };
    for (const sp of profile.strengthPercentiles) {
      const muscles = liftToMuscle[sp.lift] ?? [];
      if (muscles.includes(vol.muscleGroup) && sp.percentile < 25) {
        priority += 0.20;
        break;
      }
    }

    // #9: Imbalance correction — boost priority for muscles mentioned in imbalance alerts
    const hasImbalance = profile.imbalanceAlerts.some(
      ia => ia.description.toLowerCase().includes(vol.muscleGroup.replace(/_/g, ' '))
    );
    if (hasImbalance) {
      priority += 0.25;
    }

    // 30-day trend: if volume for this group is declining, boost priority to recover it
    const mgTrend = profile.rolling30DayTrends.muscleGroupTrends.find(
      t => t.muscleGroup === vol.muscleGroup
    );
    if (mgTrend && mgTrend.weeklySetsTrend.direction === 'down' && mgTrend.weeklySetsTrend.dataPoints >= 3) {
      priority += 0.15;
    }

    const setsNeeded = Math.ceil(
      Math.min(Math.max(volumeDeficit, 3), 10) * recoveryAdj.volumeMultiplier
    );

    const splitLabel = splitTargetGroups?.has(vol.muscleGroup) ? ' [split match]' : '';
    const dayLabel = todayPattern?.muscleGroupsTypical.includes(vol.muscleGroup) ? ' [day pattern]' : '';

    if (setsNeeded > 0 || freshnessDays >= 5 || splitTargetGroups?.has(vol.muscleGroup)) {
      const reason = splitTargetGroups?.has(vol.muscleGroup)
        ? `Split: ${detectedSplit.nextRecommended.join('/')} day${dayLabel} — ${vol.weeklyDirectSets}/${effectiveTarget.toFixed(0)} weekly sets`
        : freshnessDays >= 5
          ? `Not trained in ${freshnessDays} days${splitLabel}`
          : `${volumeDeficit.toFixed(0)} sets below target (${vol.weeklyDirectSets}/${effectiveTarget.toFixed(0)})${splitLabel}${dayLabel}`;

      candidates.push({
        muscleGroup: vol.muscleGroup,
        priority,
        reason,
        targetSets: Math.max(2, setsNeeded),
        recoveryPercent: recovery?.recoveryPercent ?? null,
        weeklyVolume: vol.weeklyDirectSets,
        volumeTarget: `${guideline.mavLow}-${guideline.mavHigh}`,
      });
    }
  }

  candidates.sort((a, b) => b.priority - a.priority);

  const maxGroups = prefs.session_duration_minutes <= 45 ? 2
    : prefs.session_duration_minutes <= 75 ? 3
    : 4;

  return { selected: candidates.slice(0, maxGroups), skipped };
}

// ─── Step 3: Select Exercises (Preference-Aware + Cardio) ───────────────────

interface ExerciseSelection {
  exercise: EnrichedExercise;
  muscleGroup: string;
  sets: number;
  reason: string;
  isCardio?: boolean;
}

function stepSelectExercises(
  muscleGroups: MuscleGroupSelection[],
  allExercises: EnrichedExercise[],
  profile: TrainingProfile,
  prefs: UserPreferences,
  cfg: ModelConfig
): { selections: ExerciseSelection[]; decisions: ExerciseDecision[] } {
  const selections: ExerciseSelection[] = [];
  const decisions: ExerciseDecision[] = [];
  const avoidSet = new Set(prefs.exercises_to_avoid.map(e => e.toLowerCase()));

  // Build performance goal lookup — exercises with goals get priority
  const goalMap = new Map<string, PerformanceGoal>();
  for (const g of prefs.performance_goals) {
    if (g.exercise) goalMap.set(g.exercise.toLowerCase(), g);
  }

  // Build preference lookup for fast access
  const prefMap = new Map<string, ExercisePreference>();
  for (const p of profile.exercisePreferences) {
    prefMap.set(p.exerciseName, p);
  }

  const strengthExercises = allExercises.filter(ex =>
    ex.ml_exercise_type !== 'cardio' && ex.ml_exercise_type !== 'recovery'
  );

  const usedExercises = new Set<string>();

  for (const group of muscleGroups) {
    const groupExercises = strengthExercises.filter(ex => {
      if (avoidSet.has(ex.name.toLowerCase())) return false;
      if (usedExercises.has(ex.name.toLowerCase())) return false;
      if (isInjuryConflict(ex, prefs.injuries)) return false;

      const primaryGroups = (Array.isArray(ex.primary_muscles) ? ex.primary_muscles : [])
        .map(m => MUSCLE_HEAD_TO_GROUP[m])
        .filter(Boolean);
      return primaryGroups.includes(group.muscleGroup);
    });

    if (groupExercises.length === 0) continue;

    const scored = groupExercises.map(ex => {
      let score = 0;
      const factors: string[] = [];

      if (ex.ml_exercise_type === 'compound') {
        score += 2;
        factors.push('Compound (+2)');
      }

      // Performance goal boost — if user has a specific target for this exercise
      const goal = goalMap.get(ex.name.toLowerCase());
      if (goal) {
        score += 6;
        factors.push(`Performance goal: ${goal.targetWeight} lbs × ${goal.targetReps} reps (+6)`);
      }

      // User preference is the DOMINANT signal — exercises they actually do
      const pref = prefMap.get(ex.name.toLowerCase());
      if (pref) {
        // No cap — higher recency = higher score, proportional to usage
        const prefBonus = pref.recencyScore * 2.5;
        score += prefBonus;
        factors.push(`Your exercise (+${prefBonus.toFixed(1)}, ${pref.recentSessions} recent/${pref.totalSessions} total, recency: ${pref.recencyScore})`);
        if (pref.isStaple) {
          score += 4;
          factors.push('Staple — you do this consistently (+4)');
        }
        if (pref.lastUsedDaysAgo <= 14) {
          score += 2;
          factors.push(`Used ${pref.lastUsedDaysAgo}d ago (+2)`);
        }
      } else {
        score += cfg.neverUsedPenalty;
        factors.push(`Never used in your training history (${cfg.neverUsedPenalty})`);
      }

      // Exercise rotation: penalize stale exercises that have been used too many consecutive weeks
      if (cfg.enforceRotation && profile.exerciseRotation) {
        const rot = profile.exerciseRotation.find(
          r => r.exerciseName === ex.name.toLowerCase()
        );
        if (rot && rot.shouldRotate) {
          score += cfg.rotationPenalty;
          factors.push(`Rotation suggested: ${rot.consecutiveWeeksUsed} consecutive weeks (${cfg.rotationPenalty})`);
        }
      }

      const prog = profile.exerciseProgressions.find(
        p => p.exerciseName === ex.name.toLowerCase()
      );
      if (prog) {
        if (prog.status === 'progressing') {
          score += 3;
          factors.push(`Progressing (+3, ${prog.sessionsTracked} sessions, slope: ${(prog.progressionSlope * 100).toFixed(1)}%)`);
        } else if (prog.status === 'stalled') {
          score += 1;
          factors.push(`Stalled (+1, ${prog.sessionsTracked} sessions — try higher reps or variation)`);
        } else if (prog.status === 'regressing') {
          score -= 1;
          factors.push(`Regressing (-1, consider swapping or reducing volume)`);
        }
      }

      // Ordering interference
      if (selections.length > 0) {
        const lastSelected = selections[selections.length - 1].exercise.name.toLowerCase();
        const interference = profile.exerciseOrderingEffects.find(
          e => e.precedingExercise === lastSelected && e.affectedExercise === ex.name.toLowerCase()
        );
        if (interference && interference.interference < -0.05) {
          score -= 2;
          factors.push(`Ordering interference with ${lastSelected} (-2)`);
        }
      }

      if (prefs.equipment_access === 'limited') {
        const needsHeavyEquip = (Array.isArray(ex.equipment) ? ex.equipment : []).some(e =>
          ['barbell', 'cable_machine', 'smith_machine'].includes(e)
        );
        if (needsHeavyEquip) {
          score -= 5;
          factors.push('Requires unavailable equipment (-5)');
        }
      }

      return { exercise: ex, score, factors };
    });

    scored.sort((a, b) => b.score - a.score);

    for (const item of scored.slice(0, 5)) {
      decisions.push({
        exerciseName: item.exercise.name,
        muscleGroup: group.muscleGroup,
        score: Math.round(item.score * 10) / 10,
        factors: item.factors,
      });
    }

    let remainingSets = group.targetSets;

    // Determine max exercises from user's actual patterns for this group
    const userExercisesForGroup = scored.filter(s => {
      const p = prefMap.get(s.exercise.name.toLowerCase());
      return p && p.recentSessions >= 1;
    }).length;
    const defaultMax = remainingSets <= 4 ? 1 : remainingSets <= 8 ? 2 : 3;
    const maxExercises = userExercisesForGroup > 0
      ? Math.min(userExercisesForGroup, 4)
      : defaultMax;

    // Sort by overall score — user preferences already dominate
    const ordered = [...scored].sort((a, b) => b.score - a.score);

    let exerciseCount = 0;
    for (const item of ordered) {
      if (exerciseCount >= maxExercises || remainingSets <= 0) break;

      const setsForThis = exerciseCount === 0
        ? Math.min(Math.ceil(remainingSets * 0.6), 5)
        : Math.min(remainingSets, 4);

      selections.push({
        exercise: item.exercise,
        muscleGroup: group.muscleGroup,
        sets: Math.max(2, setsForThis),
        reason: exerciseCount === 0
          ? `Primary ${group.muscleGroup} exercise (score: ${item.score.toFixed(1)})`
          : `Additional ${group.muscleGroup} volume (score: ${item.score.toFixed(1)})`,
      });

      usedExercises.add(item.exercise.name.toLowerCase());
      remainingSets -= setsForThis;
      exerciseCount++;
    }
  }

  // ── Push/Pull ratio tracking + auto-corrective insertion ──
  // Source: ACSM guidelines recommend balanced push:pull ratios for shoulder health.
  // If push:pull ratio exceeds 1.5:1, auto-insert corrective pulling work.
  const pushGroups = new Set(['chest', 'anterior_deltoid', 'lateral_deltoid', 'triceps']);
  const pullGroups = new Set(['back_lats', 'back_upper', 'biceps', 'posterior_deltoid']);
  let pushSets = 0;
  let pullSets = 0;
  for (const sel of selections) {
    if (pushGroups.has(sel.muscleGroup)) pushSets += sel.sets;
    if (pullGroups.has(sel.muscleGroup)) pullSets += sel.sets;
  }

  const pushPullRatio = pullSets > 0 ? pushSets / pullSets : pushSets > 0 ? 2.0 : 1.0;
  if (pushPullRatio > cfg.pushPullCorrectionThreshold && pullSets < pushSets) {
    // #22: Prefer corrective exercises the user actually does
    const correctiveNames = ['face pull', 'band pull apart', 'reverse fly', 'rear delt fly', 'cable face pull', 'reverse pec deck'];
    const userCorrectives = strengthExercises.filter(ex =>
      correctiveNames.some(cn => ex.name.toLowerCase().includes(cn))
    );
    const userPreferredCorrective = userCorrectives.find(ex => {
      const p = prefMap.get(ex.name.toLowerCase());
      return p && p.recentSessions >= 1;
    });
    const corrective = userPreferredCorrective ?? userCorrectives[0] ?? null;
    if (corrective && !usedExercises.has(corrective.name.toLowerCase())) {
      selections.push({
        exercise: corrective,
        muscleGroup: 'posterior_deltoid',
        sets: cfg.correctiveSetsCount,
        reason: `Corrective: push:pull ratio is ${pushPullRatio.toFixed(1)}:1 — adding pulling work for shoulder health`,
      });
      usedExercises.add(corrective.name.toLowerCase());
      decisions.push({
        exerciseName: corrective.name,
        muscleGroup: 'posterior_deltoid',
        score: 10,
        factors: [`Auto-inserted: push:pull ratio ${pushPullRatio.toFixed(1)}:1 exceeds ${cfg.pushPullCorrectionThreshold}:1 threshold`],
      });
    }
  }

  // Add ALL cardio exercises the user regularly does — detect from multiple sources
  const isCardioExercise = (exerciseName: string): boolean => {
    const key = exerciseName.toLowerCase();
    // Source 1: exercise library tag
    const libEx = allExercises.find(e => e.name.toLowerCase() === key);
    if (libEx?.ml_exercise_type === 'cardio') return true;
    // Source 2: local muscle map
    const mapping = getExerciseMapping(exerciseName);
    if (mapping?.exercise_type === 'cardio') return true;
    // Source 3: appears in computed cardio history
    if (profile.cardioHistory.some(c => c.exerciseName === key)) return true;
    return false;
  };

  const cardioPrefs = profile.exercisePreferences.filter(p =>
    isCardioExercise(p.exerciseName) && p.recentSessions >= 1
  );

  for (const cardioPref of cardioPrefs) {
    let cardioEx = allExercises.find(e => e.name.toLowerCase() === cardioPref.exerciseName);
    // If not in library, synthesize from muscle map so we still include it
    if (!cardioEx) {
      const mapping = getExerciseMapping(cardioPref.exerciseName);
      if (mapping) {
        cardioEx = {
          id: `synth-${cardioPref.exerciseName}`,
          name: cardioPref.exerciseName,
          body_part: 'cardio',
          primary_muscles: mapping.primary_muscles ?? [],
          secondary_muscles: mapping.secondary_muscles ?? [],
          stabilizer_muscles: mapping.stabilizer_muscles ?? [],
          movement_pattern: mapping.movement_pattern,
          ml_exercise_type: 'cardio',
          force_type: mapping.force_type,
          difficulty: mapping.difficulty,
          default_tempo: mapping.default_tempo ?? null,
          equipment: null,
        } as EnrichedExercise;
      }
    }
    if (!cardioEx || avoidSet.has(cardioEx.name.toLowerCase())) continue;

    const cardioHist = profile.cardioHistory.find(c => c.exerciseName === cardioPref.exerciseName);
    const durationInfo = cardioHist
      ? `avg ${Math.round(cardioHist.avgDurationSeconds / 60)} min${cardioHist.avgSpeed != null ? `, intensity: ${cardioHist.avgSpeed}` : ''}`
      : '';

    selections.push({
      exercise: cardioEx,
      muscleGroup: 'cardio',
      sets: 1,
      reason: `Cardio — ${cardioPref.recentSessions} recent sessions${durationInfo ? `, ${durationInfo}` : ''}`,
      isCardio: true,
    });
    decisions.push({
      exerciseName: cardioEx.name,
      muscleGroup: 'cardio',
      score: cardioPref.recencyScore,
      factors: [
        `User does this ${cardioPref.recentSessions}x in last 4 weeks`,
        `Total: ${cardioPref.totalSessions} sessions`,
        cardioHist ? `Avg duration: ${Math.round(cardioHist.avgDurationSeconds / 60)} min` : 'No duration data',
        cardioHist?.avgSpeed != null ? `Avg intensity: ${cardioHist.avgSpeed}` : '',
        `Recency score: ${cardioPref.recencyScore}`,
      ].filter(Boolean),
    });
  }

  return { selections, decisions };
}

// ─── Step 4: Prescribe Sets/Reps/Weight/Tempo ───────────────────────────────

function stepPrescribe(
  selections: ExerciseSelection[],
  profile: TrainingProfile,
  prefs: UserPreferences,
  recoveryAdj: RecoveryAdjustment,
  cfg: ModelConfig,
  expProgressionScale: number = 1.0
): GeneratedExercise[] {
  const goal = getEffectiveGoal(prefs);
  const secondaryGoal = prefs.secondary_goal;
  const prioritySet = new Set(prefs.priority_muscles.map(m => m.toLowerCase()));

  const groupIndex: Record<string, number> = {};

  return selections.map(sel => {
    // Handle cardio with real duration/intensity from history
    if (sel.isCardio || sel.exercise.ml_exercise_type === 'cardio') {
      const cardio = profile.cardioHistory.find(c => c.exerciseName === sel.exercise.name.toLowerCase());
      const pref = profile.exercisePreferences.find(p => p.exerciseName === sel.exercise.name.toLowerCase());

      let duration = cardio?.lastDurationSeconds ?? cardio?.avgDurationSeconds ?? 1800;
      let speed = cardio?.lastSpeed ?? cardio?.avgSpeed ?? null;
      let incline = cardio?.lastIncline ?? cardio?.avgIncline ?? null;
      const adjustments: string[] = [];

      if (recoveryAdj.isDeload) {
        duration = Math.round(duration * cfg.deloadCardioDurationMultiplier);
        adjustments.push(`Deload: duration reduced ${Math.round((1 - cfg.deloadCardioDurationMultiplier) * 100)}%`);
        if (speed != null) {
          speed = Math.round(speed * cfg.deloadCardioIntensityMultiplier * 10) / 10;
          adjustments.push(`Deload: intensity reduced ${Math.round((1 - cfg.deloadCardioIntensityMultiplier) * 100)}%`);
        }
      } else if (cardio && cardio.trendDuration === 'increasing') {
        adjustments.push(`Duration trending up — maintaining at ${Math.round(duration / 60)} min`);
      } else if (cardio && cardio.trendIntensity === 'increasing') {
        adjustments.push(`Intensity trending up — good progressive overload`);
      }

      const exName = sel.exercise.name.toLowerCase();
      let speedLabel: string | null = null;
      if (exName.includes('stairmaster') || exName.includes('stair master')) speedLabel = 'Level';
      else if (exName.includes('bike') || exName.includes('cycle')) speedLabel = 'Resistance';
      else if (exName.includes('row')) speedLabel = 'Watts';
      else if (exName.includes('treadmill') || exName.includes('walk') || exName.includes('run')) speedLabel = 'Speed (mph)';
      else if (speed != null) speedLabel = 'Intensity';

      // HR zone prescription based on goal
      let targetHrZone: number | null = null;
      if (recoveryAdj.isDeload) {
        targetHrZone = 1;
        adjustments.push('Deload: Zone 1 (easy) cardio only');
      } else if (goal === 'fat_loss' || secondaryGoal === 'fat_loss') {
        targetHrZone = 2;
      } else if (goal === 'endurance' || secondaryGoal === 'endurance') {
        targetHrZone = 2;
      } else {
        targetHrZone = 2; // default to Zone 2 to minimize interference
      }

      let targetHrBpmRange: { min: number; max: number } | null = null;
      const maxHr = prefs.age ? (220 - prefs.age) : null;
      if (maxHr && targetHrZone) {
        const zoneBounds: Record<number, [number, number]> = {
          1: [0.50, 0.60], 2: [0.60, 0.70], 3: [0.70, 0.80], 4: [0.80, 0.90], 5: [0.90, 1.0],
        };
        const [lo, hi] = zoneBounds[targetHrZone] ?? [0.60, 0.70];
        targetHrBpmRange = { min: Math.round(maxHr * lo), max: Math.round(maxHr * hi) };
      }

      const rationale = cardio
        ? `Based on your last ${cardio.totalSessions} sessions (${cardio.recentSessions} recent). Avg: ${Math.round(cardio.avgDurationSeconds / 60)} min${cardio.avgSpeed != null ? `, ${speedLabel ?? 'intensity'}: ${cardio.avgSpeed}` : ''}`
        : `Cardio — you do this ${pref?.recentSessions ?? 0}x per month`;

      const estMin = (duration ?? 1800) / 60;

      return {
        exerciseName: sel.exercise.name,
        exerciseLibraryId: sel.exercise.id,
        bodyPart: sel.exercise.body_part,
        primaryMuscles: Array.isArray(sel.exercise.primary_muscles) ? sel.exercise.primary_muscles : [],
        secondaryMuscles: Array.isArray(sel.exercise.secondary_muscles) ? sel.exercise.secondary_muscles : [],
        movementPattern: sel.exercise.movement_pattern ?? 'cardio',
        targetMuscleGroup: sel.muscleGroup,
        exerciseRole: 'cardio' as ExerciseRole,
        sets: 1,
        targetReps: 0,
        targetWeight: null,
        targetRir: null,
        rirLabel: null,
        isBodyweight: false,
        tempo: '0-0-0',
        restSeconds: 0,
        rationale,
        adjustments,
        isDeload: recoveryAdj.isDeload,
        isCardio: true,
        cardioDurationSeconds: duration,
        cardioSpeed: speed,
        cardioIncline: incline,
        cardioSpeedLabel: speedLabel,
        targetHrZone,
        targetHrBpmRange,
        warmupSets: null,
        supersetGroupId: null,
        supersetType: null,
        impactScore: null,
        estimatedMinutes: estMin,
      };
    }

    // Classify exercise role based on type and position within its muscle group
    const idxInGroup = groupIndex[sel.muscleGroup] ?? 0;
    groupIndex[sel.muscleGroup] = idxInGroup + 1;
    const role = classifyExerciseRole(sel.exercise, idxInGroup);
    const isPriority = prioritySet.has(sel.muscleGroup);

    const equipment = Array.isArray(sel.exercise.equipment) ? sel.exercise.equipment : [];
    const isBodyweight = equipment.length === 1 && equipment[0] === 'bodyweight';

    // ── Learned-first prescription ──
    // Your actual training data is the primary source.
    // Textbook tables are ONLY used when you have no history for this exercise.
    const pref = profile.exercisePreferences.find(
      p => p.exerciseName === sel.exercise.name.toLowerCase()
    );
    const hasLearnedData = pref && pref.recentSessions >= 2;

    // Reps: use what you actually do, fall back to table
    const tableRange = getRepRangeByRole(role, goal, secondaryGoal);
    const targetReps = hasLearnedData && pref.learnedReps != null
      ? Math.round(pref.learnedReps)
      : tableRange.target;

    // Sets: use what you actually do, fall back to table
    const tableSets = getTieredSets(role, goal, isPriority, recoveryAdj.isDeload);
    const sets = hasLearnedData && pref.learnedSets != null
      ? Math.round(pref.learnedSets)
      : tableSets;

    // Rest: use learned inter-set rest, fall back to exercise-aware estimate
    const tableRest = getRestByExercise(sel.exercise, role, goal);
    const restSeconds = hasLearnedData && pref.learnedRestSeconds != null
      ? pref.learnedRestSeconds
      : tableRest;

    const rir = getRirTarget(role, goal, recoveryAdj.isDeload);
    const tempo = getTempo(sel.exercise.default_tempo, goal, sel.exercise.ml_exercise_type);

    // Weight determination: progression data > learned weight > lift ratios > null
    const prog = profile.exerciseProgressions.find(
      p => p.exerciseName === sel.exercise.name.toLowerCase()
    );

    let targetWeight: number | null = null;
    const adjustments: string[] = [];

    // Source annotation: tell user where each prescription value came from
    if (hasLearnedData) {
      const sources: string[] = [];
      if (pref.learnedReps != null) sources.push(`reps=${Math.round(pref.learnedReps)}`);
      if (pref.learnedSets != null) sources.push(`sets=${Math.round(pref.learnedSets)}`);
      if (pref.learnedRestSeconds != null) sources.push(`rest=${pref.learnedRestSeconds}s`);
      adjustments.push(`Learned from your last ${pref.recentSessions} sessions: ${sources.join(', ')}`);
    }

    if (prog) {
      targetWeight = prog.lastWeight;

      if (recoveryAdj.isDeload) {
        targetWeight = Math.round(targetWeight * cfg.deloadWeightMultiplier);
        adjustments.push(`Deload: weight at ${Math.round(cfg.deloadWeightMultiplier * 100)}% (${targetWeight} lbs)`);
      } else {
        // Increment: use YOUR observed increment pattern, fall back to equipment-based default
        const learnedInc = hasLearnedData ? pref.learnedIncrement : null;
        const fallbackIncrement = role === 'isolation' || role === 'corrective'
          ? cfg.isolationIncrement
          : equipment.includes('barbell')
            ? cfg.barbellIncrement
            : equipment.includes('dumbbell')
              ? cfg.dumbbellIncrement
              : cfg.machineIncrement;

        const baseIncrement = learnedInc != null ? learnedInc : fallbackIncrement;

        // #7: Scale increment by experience progression rate
        const scaledIncrement = Math.round(baseIncrement * expProgressionScale * 10) / 10;

        // Cap: never jump more than maxProgressionPct of current weight,
        // but always allow at least the smallest practical plate increment (2.5 lbs)
        const maxJump = Math.max(Math.round(targetWeight * cfg.maxProgressionPct), 2.5);
        const increment = Math.min(scaledIncrement, maxJump);

        if (learnedInc != null) {
          adjustments.push(`Your typical increment: ${learnedInc} lbs`);
        }

        // #5: Use best progression pattern if available
        const exMapping = getExerciseMapping(sel.exercise.name);
        const movementPat = exMapping?.movement_pattern ?? sel.exercise.movement_pattern ?? '';
        const bestPatternType = profile.bestProgressionPatterns[movementPat] ?? null;

        // #6: Check for rep-weight breakthrough readiness
        const breakthrough = profile.repWeightBreakthroughs.find(
          b => b.exerciseName === sel.exercise.name.toLowerCase()
        );

        const lastReps = prog.bestSet.reps;
        if (lastReps >= targetReps + cfg.repsAboveTargetForProgression && prog.status === 'progressing') {
          // #5: Apply progression style — double progression holds reps first
          if (bestPatternType === 'double_progression' && breakthrough && !breakthrough.readyForWeightJump) {
            adjustments.push(`Double progression: add reps before weight (${breakthrough.accumulatedRepsAtWeight} reps accumulated, need ${breakthrough.typicalRepsBeforeJump})`);
          } else {
            targetWeight = targetWeight + increment;
            adjustments.push(`Progressive overload: +${increment} lbs (last session: ${lastReps} reps vs ${targetReps} target)`);
          }
        } else if (prog.status === 'stalled') {
          // #18: Active plateau response — modify sets or suggest variation
          const plateauInfo = profile.plateauDetections.find(
            p => p.exerciseName === sel.exercise.name.toLowerCase() && p.isPlateaued
          );
          if (plateauInfo && plateauInfo.sessionsSinceProgress >= 4) {
            adjustments.push(`Plateau (${plateauInfo.sessionsSinceProgress} sessions): drop to ${sets - 1} sets × ${targetReps + 2} reps to break through`);
          } else {
            adjustments.push(`Stalled at ${targetWeight} lbs — hold weight, focus on RIR ${rir}`);
          }
        } else if (prog.status === 'regressing') {
          // #19: Severity-aware regression — scale reduction by how bad the regression is
          const regressionSeverity = Math.abs(prog.progressionSlope);
          const reductionPct = regressionSeverity > 0.05
            ? 0.88 // severe regression: drop to 88%
            : cfg.regressionWeightMultiplier; // mild: use config (92%)
          targetWeight = Math.round(targetWeight * reductionPct);
          adjustments.push(`Regressing (${regressionSeverity > 0.05 ? 'severe' : 'mild'}): reduced to ${targetWeight} lbs (${Math.round(reductionPct * 100)}%)`);
        } else if (prog.status === 'progressing') {
          adjustments.push(`Carry forward: ${targetWeight} lbs at RIR ${rir}`);
        }
      }

      // Sleep-performance learned adjustment
      if (profile.sleepCoefficients.confidence !== 'low' && profile.recoveryContext.sleepDurationLastNight != null && profile.recoveryContext.sleepBaseline30d != null) {
        const sleepDelta = (profile.recoveryContext.sleepDurationLastNight - profile.recoveryContext.sleepBaseline30d) / profile.recoveryContext.sleepBaseline30d;
        if (sleepDelta < cfg.sleepDeltaThreshold) {
          const isLower = ['quadriceps', 'hamstrings', 'glutes'].includes(sel.muscleGroup);
          const coeff = isLower ? profile.sleepCoefficients.lowerBody : profile.sleepCoefficients.upperBody;
          if (Math.abs(coeff) > cfg.sleepCoefficientMinimum) {
            const weightAdj = Math.round(coeff * sleepDelta * (targetWeight ?? 100));
            if (weightAdj < -2) {
              targetWeight = (targetWeight ?? 0) + weightAdj;
              adjustments.push(`Sleep-performance: ${weightAdj} lbs (learned from your data)`);
            }
          }
        }
      }

      if (profile.bodyWeightTrend.phase === 'cutting' && prog.status !== 'regressing') {
        adjustments.push('Cutting phase: maintaining weight is success');
      }
    } else if (hasLearnedData && pref.learnedWeight != null) {
      // No progression data (< 3 sessions) but learned weight exists
      targetWeight = Math.round(pref.learnedWeight);
      adjustments.push(`Weight from your recent sessions: ${targetWeight} lbs`);
    } else if (!isBodyweight) {
      // No data at all — estimate from lift ratios + strength standards
      const knownLifts = {
        bench: profile.exerciseProgressions.find(p => p.exerciseName.includes('bench press'))?.lastWeight ?? null,
        squat: profile.exerciseProgressions.find(p => p.exerciseName.includes('squat') && !p.exerciseName.includes('front'))?.lastWeight ?? null,
        deadlift: profile.exerciseProgressions.find(p => p.exerciseName.includes('deadlift') && !p.exerciseName.includes('romanian'))?.lastWeight ?? null,
      };
      const estimated = estimateWeightFromRatios(
        sel.exercise.name,
        knownLifts,
        prefs.body_weight_lbs,
        prefs.gender,
      );
      if (estimated != null) {
        targetWeight = estimated;
        adjustments.push(`Estimated from lift ratios — adjust after first session`);
      }
    }

    // #18: Plateau strategy — actual prescription modifications
    const plateau = profile.plateauDetections.find(
      p => p.exerciseName === sel.exercise.name.toLowerCase() && p.isPlateaued
    );
    if (plateau?.suggestedStrategy) {
      adjustments.push(`Plateau: ${plateau.suggestedStrategy}`);
    }

    // Warmup ramp for primary compounds with known weight
    const warmupSets = (role === 'primary' && targetWeight != null && targetWeight > 50 && idxInGroup === 0)
      ? generateWarmupRamp(targetWeight)
      : null;

    const impact = computeImpactScore(sel.exercise, role, goal, secondaryGoal);
    const estMin = estimateExerciseMinutes(sets, restSeconds, role, warmupSets?.length ?? 0);

    return {
      exerciseName: sel.exercise.name,
      exerciseLibraryId: sel.exercise.id,
      bodyPart: sel.exercise.body_part,
      primaryMuscles: Array.isArray(sel.exercise.primary_muscles) ? sel.exercise.primary_muscles : [],
      secondaryMuscles: Array.isArray(sel.exercise.secondary_muscles) ? sel.exercise.secondary_muscles : [],
      movementPattern: sel.exercise.movement_pattern ?? 'unknown',
      targetMuscleGroup: sel.muscleGroup,
      exerciseRole: role,
      sets,
      targetReps,
      targetWeight: isBodyweight ? null : (targetWeight ? Math.round(targetWeight) : null),
      targetRir: rir,
      rirLabel: getRirLabel(rir),
      isBodyweight,
      tempo,
      restSeconds,
      rationale: sel.reason,
      adjustments,
      isDeload: recoveryAdj.isDeload,
      isCardio: false,
      cardioDurationSeconds: null,
      cardioSpeed: null,
      cardioIncline: null,
      cardioSpeedLabel: null,
      targetHrZone: null,
      targetHrBpmRange: null,
      warmupSets,
      supersetGroupId: null,
      supersetType: null,
      impactScore: impact,
      estimatedMinutes: estMin,
    };
  });
}

// ─── Step 5: Apply Session Constraints (Ordering + Time Budget + Supersets) ──

const CNS_DEMAND_KEYWORDS: [RegExp, number][] = [
  [/\bdeadlift\b/i, 0],
  [/\bsquat\b/i, 0],
  [/\bfront squat\b/i, 0],
  [/\bpower clean\b/i, 0],
  [/\bclean and press\b/i, 0],
  [/\bsnatch\b/i, 0],
  [/\bbench press\b/i, 1],
  [/\boverhead press\b/i, 1],
  [/\bmilitary press\b/i, 1],
  [/\bbarbell row\b/i, 1],
  [/\bromanian deadlift\b/i, 1],
  [/\bhip thrust\b/i, 1],
  [/\bpendlay row\b/i, 1],
  [/\bt-bar row\b/i, 1],
  [/\bincline.*press\b/i, 2],
  [/\bdumbbell.*press\b/i, 2],
  [/\bdb.*press\b/i, 2],
  [/\blunge\b/i, 2],
  [/\bbulgarian\b/i, 2],
  [/\bpull-?up\b/i, 2],
  [/\bchin-?up\b/i, 2],
  [/\bdip\b/i, 2],
  [/\brow\b/i, 2],
];

function getCnsDemandTier(ex: GeneratedExercise): number {
  const name = ex.exerciseName.toLowerCase();
  for (const [pattern, tier] of CNS_DEMAND_KEYWORDS) {
    if (pattern.test(name)) return tier;
  }
  if (ex.movementPattern === 'compound') return 2;
  if (name.includes('machine') || name.includes('cable') || name.includes('smith')) return 3;
  if (ex.movementPattern === 'isolation') return 4;
  return 3;
}

/**
 * Compute available session time, accounting for weekday deadlines.
 */
function computeAvailableMinutes(prefs: UserPreferences): number {
  const now = new Date();
  const dayKey = String(now.getDay());
  const deadline = prefs.weekday_deadlines[dayKey];

  if (deadline) {
    const [h, m] = deadline.split(':').map(Number);
    if (!isNaN(h) && !isNaN(m)) {
      const deadlineDate = new Date(now);
      deadlineDate.setHours(h, m, 0, 0);
      const minutesUntilDeadline = (deadlineDate.getTime() - now.getTime()) / 60000;
      if (minutesUntilDeadline > 0 && minutesUntilDeadline < prefs.session_duration_minutes) {
        return Math.max(30, Math.floor(minutesUntilDeadline));
      }
    }
  }

  return prefs.session_duration_minutes;
}

function stepApplyConstraints(
  exercises: GeneratedExercise[],
  prefs: UserPreferences,
  profile: TrainingProfile,
  cfg: ModelConfig
): GeneratedExercise[] {
  const cardio = exercises.filter(e => e.isCardio);
  const strength = exercises.filter(e => !e.isCardio);

  const orderProfiles = profile.exerciseOrderProfiles ?? [];
  const positionMap = new Map<string, ExerciseOrderProfile>();
  for (const op of orderProfiles) {
    positionMap.set(op.exerciseName, op);
  }

  // Determine muscle group ordering: preserve step 2 priority order
  const groupOrder: string[] = [];
  for (const ex of strength) {
    if (!groupOrder.includes(ex.targetMuscleGroup)) {
      groupOrder.push(ex.targetMuscleGroup);
    }
  }

  // Order within each muscle group: user historical pattern + CNS demand
  const ordered: GeneratedExercise[] = [];

  for (const group of groupOrder) {
    const groupExercises = strength.filter(e => e.targetMuscleGroup === group);

    const scored = groupExercises.map(ex => {
      const hist = positionMap.get(ex.exerciseName.toLowerCase());
      const cnsTier = getCnsDemandTier(ex);

      let withinGroupScore: number;
      if (hist && hist.sessions >= 3) {
        withinGroupScore = hist.avgNormalizedPosition * 50 + cnsTier * 10;
      } else {
        withinGroupScore = cnsTier * 20;
      }

      return { exercise: ex, withinGroupScore, cnsTier };
    });

    scored.sort((a, b) => a.withinGroupScore - b.withinGroupScore);
    ordered.push(...scored.map(s => s.exercise));
  }

  // #13: Enhanced interference avoidance — try multiple swaps and pick best
  for (let i = 0; i < ordered.length - 1; i++) {
    const current = ordered[i].exerciseName.toLowerCase();
    const next = ordered[i + 1].exerciseName.toLowerCase();
    const interference = profile.exerciseOrderingEffects.find(
      e => e.precedingExercise === current && e.affectedExercise === next && e.interference < -0.08
    );
    if (interference) {
      // Find the best swap candidate (least interference)
      let bestSwap = -1;
      let bestInterference = interference.interference;
      for (let j = i + 2; j < Math.min(ordered.length, i + 4); j++) {
        const candidateInterference = profile.exerciseOrderingEffects.find(
          e => e.precedingExercise === current && e.affectedExercise === ordered[j].exerciseName.toLowerCase()
        );
        const candidateVal = candidateInterference?.interference ?? 0;
        if (candidateVal > bestInterference) {
          bestInterference = candidateVal;
          bestSwap = j;
        }
      }
      if (bestSwap >= 0) {
        [ordered[i + 1], ordered[bestSwap]] = [ordered[bestSwap], ordered[i + 1]];
      }
    }
  }

  // #12: Session fatigue — reduce rest and/or load for exercises late in the session
  let cumulativeMinutes = 0;
  for (const ex of ordered) {
    cumulativeMinutes += ex.estimatedMinutes;
    if (cumulativeMinutes > 60 && ex.exerciseRole !== 'primary') {
      const fatigueEffect = profile.sessionFatigueEffects.find(
        e => e.positionBucket === '60-90min' && e.dataPoints >= 5
      );
      if (fatigueEffect && fatigueEffect.avgDelta < -0.03) {
        ex.restSeconds = Math.max(30, Math.round(ex.restSeconds * 0.85));
      }
    }
  }

  // Time budget: hard ceiling for entire session (strength + cardio)
  const availableMinutes = computeAvailableMinutes(prefs);

  // Session fatigue adjustment
  const lateFatigueEffect = profile.sessionFatigueEffects.find(
    e => e.positionBucket === '90+min' && e.dataPoints >= cfg.sessionFatigueMinDataPoints
  );
  let sessionFatigueAdj = 1.0;
  if (lateFatigueEffect && lateFatigueEffect.avgDelta < cfg.sessionFatigueThreshold) {
    sessionFatigueAdj = 0.90;
  }

  const effectiveBudget = Math.round(availableMinutes * sessionFatigueAdj);
  const transitionBuffer = 5; // warmup, water breaks, transitions

  // ── Cardio time enforcement ───────────────────────────────────────────
  // Cardio must fit within the budget alongside strength, not ignore it.
  let totalStrengthMin = ordered.reduce((sum, ex) => sum + ex.estimatedMinutes, 0);
  const strengthFloor = Math.min(totalStrengthMin, cfg.minStrengthBudgetMinutes);
  const maxCardioMinutes = Math.max(0, effectiveBudget - strengthFloor - transitionBuffer);
  let totalCardioMin = cardio.reduce((sum, ex) => sum + ex.estimatedMinutes, 0);
  const keptCardio: GeneratedExercise[] = [];

  if (totalCardioMin > maxCardioMinutes && maxCardioMinutes > 0) {
    // Scale all cardio durations proportionally to fit the budget
    const scale = maxCardioMinutes / totalCardioMin;
    const minCardioSeconds = 10 * 60; // never prescribe less than 10 min of cardio
    for (const ex of cardio) {
      const originalSec = ex.cardioDurationSeconds ?? ex.estimatedMinutes * 60;
      const scaledSec = Math.round(originalSec * scale);
      if (scaledSec >= minCardioSeconds) {
        ex.cardioDurationSeconds = scaledSec;
        ex.estimatedMinutes = scaledSec / 60;
        ex.adjustments.push(`Duration capped to ${Math.round(scaledSec / 60)} min (session budget: ${effectiveBudget} min)`);
        keptCardio.push(ex);
      } else {
        // Too short to be useful — drop this cardio exercise
        ex.adjustments.push(`Dropped: ${Math.round(originalSec / 60)} min → ${Math.round(scaledSec / 60)} min would be too short`);
      }
    }
    totalCardioMin = keptCardio.reduce((sum, ex) => sum + ex.estimatedMinutes, 0);
  } else if (totalCardioMin > maxCardioMinutes) {
    // No room for cardio at all — drop it
    totalCardioMin = 0;
  } else {
    keptCardio.push(...cardio);
  }

  // ── Strength time enforcement ─────────────────────────────────────────
  const strengthBudget = Math.max(effectiveBudget - totalCardioMin - transitionBuffer, cfg.minStrengthBudgetMinutes);

  if (totalStrengthMin > strengthBudget) {
    const sortedByImpact = [...ordered].sort((a, b) => (a.impactScore ?? 0) - (b.impactScore ?? 0));
    const keepSet = new Set(ordered.map(e => e.exerciseName));

    for (const ex of sortedByImpact) {
      if (totalStrengthMin <= strengthBudget) break;
      if (ex.exerciseRole === 'corrective') continue;
      if (keepSet.size <= cfg.minExercisesUnderTimePressure) break;
      keepSet.delete(ex.exerciseName);
      totalStrengthMin -= ex.estimatedMinutes;
    }

    const trimmed = ordered.filter(e => keepSet.has(e.exerciseName));
    ordered.length = 0;
    ordered.push(...trimmed);
  }

  // Suggest supersets (annotations only — user accepts/declines in UI)
  const ssInput = ordered.map(ex => ({
    exerciseName: ex.exerciseName,
    targetMuscleGroup: ex.targetMuscleGroup,
    movementPattern: ex.movementPattern,
    sets: ex.sets,
    restSeconds: ex.restSeconds,
    isCardio: ex.isCardio,
    exerciseRole: ex.exerciseRole,
  }));

  const supersetSuggestions = suggestSupersets(ssInput);
  for (const ss of supersetSuggestions) {
    const [idxA, idxB] = ss.exerciseIndices;
    if (ordered[idxA]) {
      ordered[idxA].supersetGroupId = ss.groupId;
      ordered[idxA].supersetType = ss.type;
    }
    if (ordered[idxB]) {
      ordered[idxB].supersetGroupId = ss.groupId;
      ordered[idxB].supersetType = ss.type;
    }
  }

  // Cardio always after weights
  return [...ordered, ...keptCardio];
}

// ─── Step 6: Generate Rationale ─────────────────────────────────────────────

function stepGenerateRationale(
  exercises: GeneratedExercise[],
  muscleGroups: MuscleGroupSelection[],
  recoveryAdj: RecoveryAdjustment,
  profile: TrainingProfile,
  prefs: UserPreferences,
  skippedGroups: Array<{ muscleGroup: string; reason: string }>,
  exerciseDecisions: ExerciseDecision[]
): GeneratedWorkout {
  const muscleGroupsFocused = muscleGroups.map(g => g.muscleGroup);
  const muscleReasons = muscleGroups.map(g => `${g.muscleGroup}: ${g.reason}`);

  const totalDuration = exercises.reduce(
    (sum, ex) => sum + ex.estimatedMinutes, 5
  );

  let recoveryStatus = 'Good';
  if (recoveryAdj.isDeload) {
    recoveryStatus = 'Deload recommended';
  } else if (recoveryAdj.volumeMultiplier < 0.85) {
    recoveryStatus = 'Reduced capacity';
  }

  const splitInfo = profile.detectedSplit.confidence >= 0.5
    ? `Detected split: ${profile.detectedSplit.type.replace(/_/g, ' ')} (${Math.round(profile.detectedSplit.confidence * 100)}% confidence)`
    : 'No clear split detected — using volume-based selection';

  const todayDow = new Date().getDay();
  const todayPattern = profile.dayOfWeekPatterns[todayDow];
  const dayInfo = todayPattern && !todayPattern.isRestDay
    ? `Typical ${todayPattern.dayName}: ${todayPattern.muscleGroupsTypical.slice(0, 4).join(', ')} (${Math.round(todayPattern.frequency * 100)}% of weeks)`
    : null;

  const goalInfo = prefs.performance_goals.length > 0
    ? `Performance goals: ${prefs.performance_goals.map(g => `${g.exercise} ${g.targetWeight}×${g.targetReps}`).join(', ')}`
    : null;

  const effectiveGoal = getEffectiveGoal(prefs);
  const goalLabel = prefs.secondary_goal
    ? `${effectiveGoal} (primary) + ${prefs.secondary_goal} (secondary, 30%)`
    : effectiveGoal;

  const availMin = computeAvailableMinutes(prefs);
  const timeNote = availMin < prefs.session_duration_minutes
    ? `Time-constrained: ${availMin} min available (deadline active)`
    : `Session budget: ${prefs.session_duration_minutes} min`;

  const sessionRationale = [
    splitInfo,
    prefs.preferred_split ? `Preferred split: ${prefs.preferred_split.replace(/_/g, ' ')}` : null,
    profile.detectedSplit.nextRecommended.length > 0
      ? `Split recommends: ${profile.detectedSplit.nextRecommended.join(', ')} day`
      : null,
    dayInfo,
    `Targeting: ${muscleGroupsFocused.join(', ')}`,
    ...muscleReasons,
    `Goal: ${goalLabel}`,
    goalInfo,
    timeNote,
    `Recovery status: ${recoveryStatus}`,
    prefs.priority_muscles.length > 0
      ? `Priority muscles: ${prefs.priority_muscles.join(', ')} (extra volume)`
      : null,
    profile.bodyWeightTrend.phase !== 'maintaining'
      ? `Weight trend: ${profile.bodyWeightTrend.phase} (${profile.bodyWeightTrend.slope > 0 ? '+' : ''}${profile.bodyWeightTrend.slope} lbs/week)`
      : null,
  ].filter(Boolean).join('\n');

  // Build decision log
  const decisionLog: DecisionLogEntry[] = [];

  decisionLog.push({
    step: '1',
    label: 'Recovery Check',
    details: recoveryAdj.isDeload
      ? [`DELOAD TRIGGERED: ${recoveryAdj.adjustmentReasons.join('; ')}`]
      : recoveryAdj.adjustmentReasons.length > 0
        ? [`Volume multiplier: ${(recoveryAdj.volumeMultiplier * 100).toFixed(0)}%`, ...recoveryAdj.adjustmentReasons]
        : ['All recovery signals normal — no adjustments needed'],
  });

  decisionLog.push({
    step: '2',
    label: 'Split Detection & Muscle Group Selection',
    details: [
      splitInfo,
      ...(profile.detectedSplit.evidence ?? []),
      dayInfo ?? `${todayPattern?.dayName ?? 'Today'}: typical rest day`,
      `Selected ${muscleGroups.length} groups from ${muscleGroups.length + skippedGroups.length} candidates`,
      ...muscleGroups.map(g => `✓ ${g.muscleGroup}: ${g.reason} (priority: ${g.priority.toFixed(2)}, ${g.targetSets} sets)`),
      ...skippedGroups.map(g => `✗ ${g.muscleGroup}: ${g.reason}`),
    ].filter((d): d is string => d != null),
  });

  decisionLog.push({
    step: '3',
    label: 'Exercise Selection',
    details: exercises.map(ex => `${ex.exerciseName}: ${ex.rationale}`),
  });

  decisionLog.push({
    step: '4',
    label: 'Prescription',
    details: exercises.map(ex => {
      if (ex.isCardio) {
        const parts = [`${ex.exerciseName}: ${Math.round((ex.cardioDurationSeconds ?? 1800) / 60)} min`];
        if (ex.targetHrZone) parts[0] += ` (Zone ${ex.targetHrZone}${ex.targetHrBpmRange ? `, ${ex.targetHrBpmRange.min}-${ex.targetHrBpmRange.max} bpm` : ''})`;
        if (ex.adjustments.length > 0) parts.push(`  ${ex.adjustments.join('; ')}`);
        return parts.join('\n');
      }
      const parts = [`${ex.exerciseName} [${ex.exerciseRole}]: ${ex.sets}×${ex.targetReps}`];
      if (ex.targetWeight) parts[0] += ` @ ${ex.targetWeight} lbs`;
      if (ex.targetRir != null) parts[0] += ` (RIR ${ex.targetRir})`;
      parts[0] += ` — rest ${ex.restSeconds}s, tempo ${ex.tempo}`;
      if (ex.warmupSets?.length) parts.push(`  Warmup: ${ex.warmupSets.map(w => `${w.weight}×${w.reps}`).join(' → ')}`);
      if (ex.supersetGroupId != null) parts.push(`  Superset suggestion: ${ex.supersetType} (group ${ex.supersetGroupId})`);
      if (ex.adjustments.length > 0) parts.push(`  ${ex.adjustments.join('; ')}`);
      return parts.join('\n');
    }),
  });

  const groupOrder: string[] = [];
  for (const ex of exercises) {
    if (!groupOrder.includes(ex.targetMuscleGroup)) groupOrder.push(ex.targetMuscleGroup);
  }

  const orderingDetails: string[] = [
    `Session duration limit: ${prefs.session_duration_minutes} min`,
    `Estimated duration: ${Math.round(totalDuration)} min`,
    `Muscle group order: ${groupOrder.join(' → ')}`,
  ];
  for (const ex of exercises) {
    const hist = (profile.exerciseOrderProfiles ?? []).find(
      p => p.exerciseName === ex.exerciseName.toLowerCase()
    );
    if (hist && hist.sessions >= 3) {
      orderingDetails.push(`${ex.exerciseName}: historical position ${hist.positionCategory} (avg ${hist.avgNormalizedPosition}, ${hist.sessions} sessions)`);
    } else {
      orderingDetails.push(`${ex.exerciseName}: CNS-based ordering (no historical data)`);
    }
  }

  decisionLog.push({
    step: '5',
    label: 'Exercise Ordering',
    details: orderingDetails,
  });

  // Step 6: Evidence basis — surface the science driving decisions
  const scienceDetails: string[] = [];
  for (const g of muscleGroups) {
    const guideline = getGuidelineForGroup(g.muscleGroup);
    if (guideline) {
      scienceDetails.push(
        `${g.muscleGroup}: MEV=${guideline.mev}, MAV=${guideline.mavLow}-${guideline.mavHigh}, MRV=${guideline.mrv} sets/wk, recovery=${guideline.recoveryHours}h`
      );
      const indMrv = profile.individualMrvEstimates[g.muscleGroup];
      if (indMrv) {
        scienceDetails.push(`  → Your individual MRV estimate: ${indMrv} sets/wk (learned from your data, overrides population defaults)`);
      }
    }
  }
  scienceDetails.push('');
  scienceDetails.push('Research basis:');
  scienceDetails.push('Volume targets: Schoenfeld et al. (2017) J Sports Sci, Krieger (2010) J Strength Cond Res');
  scienceDetails.push('Recovery windows: Damas et al. (2019), Schoenfeld, Ogborn & Krieger (2016)');
  scienceDetails.push('Progressive overload: Helms, Morgan & Valdez — Muscle & Strength Pyramids (2nd ed.)');
  scienceDetails.push('Volume landmarks: Nuckols (2017) Stronger By Science, Ralston et al. (2017) Sports Med');
  if (profile.sleepCoefficients.confidence !== 'low') {
    scienceDetails.push(`Sleep-performance coefficient: upper body ${profile.sleepCoefficients.upperBody.toFixed(3)}, lower body ${profile.sleepCoefficients.lowerBody.toFixed(3)} (learned from ${profile.sleepCoefficients.dataPoints} data points)`);
  }

  decisionLog.push({
    step: '6',
    label: 'Evidence Basis',
    details: scienceDetails,
  });

  // Step 7: 30-day trends summary
  const trendDetails: string[] = [];
  const t = profile.rolling30DayTrends;
  const trendLine = (label: string, mt: { direction: string; slopePct: number; avg30d: number | null; current: number | null; dataPoints: number }, unit?: string) => {
    if (mt.dataPoints < 3) return null;
    const arrow = mt.direction === 'up' ? '↑' : mt.direction === 'down' ? '↓' : '→';
    const u = unit ? ` ${unit}` : '';
    return `${label}: ${arrow} ${Math.abs(mt.slopePct).toFixed(1)}%/wk (current: ${mt.current?.toFixed(1) ?? '—'}${u}, avg: ${mt.avg30d?.toFixed(1) ?? '—'}${u}, ${mt.dataPoints} pts)`;
  };

  trendDetails.push('— Recovery —');
  const recoveryLines = [
    trendLine('Sleep', t.sleep, 'hrs'),
    trendLine('HRV', t.hrv, 'ms'),
    trendLine('RHR', t.rhr, 'bpm'),
    trendLine('Steps', t.steps),
  ].filter((l): l is string => l != null);
  trendDetails.push(...(recoveryLines.length > 0 ? recoveryLines : ['No wearable data']));

  trendDetails.push('');
  trendDetails.push('— Body —');
  const bodyLines = [
    trendLine('Weight', t.bodyWeight, 'lbs'),
    trendLine('Body Fat', t.bodyFat, '%'),
    trendLine('Lean Mass', t.estimatedLeanMass, 'lbs'),
  ].filter((l): l is string => l != null);
  trendDetails.push(...(bodyLines.length > 0 ? bodyLines : ['No body data']));

  trendDetails.push('');
  trendDetails.push('— Overall Strength —');
  const strengthLines = [
    trendLine('Strength Index', t.totalStrengthIndex, 'lbs'),
    trendLine('Big 3 Total', t.big3Total, 'lbs'),
    trendLine('Relative Strength', t.relativeStrength),
    trendLine('Volume Load', t.totalVolumeLoad, 'lbs'),
  ].filter((l): l is string => l != null);
  trendDetails.push(...(strengthLines.length > 0 ? strengthLines : ['Insufficient lifting data']));

  trendDetails.push('');
  trendDetails.push('— Training —');
  const trainingLines = [
    trendLine('Frequency', t.trainingFrequency, 'sessions/wk'),
    trendLine('Session Duration', t.avgSessionDuration, 'min'),
    trendLine('Weekly Sets', t.totalWeeklyVolume, 'sets'),
  ].filter((l): l is string => l != null);
  trendDetails.push(...trainingLines);

  if (t.exerciseTrends.length > 0) {
    trendDetails.push('');
    trendDetails.push('— Top Lifts (e1RM) —');
    for (const et of t.exerciseTrends.slice(0, 8)) {
      const arrow = et.estimated1RM.direction === 'up' ? '↑' : et.estimated1RM.direction === 'down' ? '↓' : '→';
      if (et.estimated1RM.dataPoints >= 2) {
        trendDetails.push(`  ${et.exerciseName}: ${arrow} ${Math.abs(et.estimated1RM.slopePct).toFixed(1)}%/wk (e1RM: ${et.estimated1RM.current?.toFixed(0) ?? '—'} lbs)`);
      }
    }
  }

  decisionLog.push({
    step: '7',
    label: '30-Day Trends',
    details: trendDetails.length > 0 ? trendDetails : ['Insufficient data for trend analysis'],
  });

  const muscleGroupDecisions: MuscleGroupDecision[] = muscleGroups.map(g => ({
    muscleGroup: g.muscleGroup,
    priority: Math.round(g.priority * 100) / 100,
    reason: g.reason,
    targetSets: g.targetSets,
    recoveryPercent: g.recoveryPercent,
    weeklyVolume: g.weeklyVolume,
    volumeTarget: g.volumeTarget,
  }));

  return {
    id: generateId(),
    date: new Date().toISOString().split('T')[0],
    trainingGoal: prefs.training_goal,
    estimatedDurationMinutes: Math.round(totalDuration),
    muscleGroupsFocused,
    exercises,
    sessionRationale,
    recoveryStatus,
    adjustmentsSummary: recoveryAdj.adjustmentReasons,
    deloadActive: recoveryAdj.isDeload,
    decisionLog,
    muscleGroupDecisions,
    exerciseDecisions,
  };
}

// ─── Main Entry Point ───────────────────────────────────────────────────────

export interface SessionOverrides {
  durationMinutes?: number;
  finishByTime?: string; // "HH:MM"
  goalOverride?: string;
  gymProfile?: string;
}

export async function generateWorkout(
  profile: TrainingProfile,
  overrides?: SessionOverrides
): Promise<GeneratedWorkout> {
  const [prefs, allExercises] = await Promise.all([
    fetchUserPreferences(profile.userId),
    fetchAllExercises(),
  ]);

  if (overrides?.goalOverride) {
    (prefs as any).training_goal = overrides.goalOverride;
  }
  if (overrides?.durationMinutes) {
    prefs.session_duration_minutes = overrides.durationMinutes;
  }
  if (overrides?.finishByTime) {
    const dayKey = String(new Date().getDay());
    prefs.weekday_deadlines = { ...prefs.weekday_deadlines, [dayKey]: overrides.finishByTime };
  }
  if (overrides?.gymProfile) {
    prefs.active_gym_profile = overrides.gymProfile;
  }

  const cfg: ModelConfig = { ...DEFAULT_MODEL_CONFIG };

  // #7: Experience-level scaling — adjust volume and progression
  const expLevel = prefs.experience_level?.toLowerCase() ?? 'intermediate';
  const expVolumeScale = expLevel === 'beginner' ? cfg.beginnerVolumeMultiplier
    : expLevel === 'advanced' ? cfg.advancedVolumeMultiplier
    : cfg.intermediateVolumeMultiplier;
  const expProgressionScale = expLevel === 'beginner' ? cfg.beginnerProgressionRate
    : expLevel === 'advanced' ? cfg.advancedProgressionRate
    : 1.0;

  // Step 1: Recovery check
  const recoveryAdj = stepRecoveryCheck(profile, cfg);

  // #7: Apply experience-level volume scaling to recovery adjustment
  recoveryAdj.volumeMultiplier *= expVolumeScale;
  recoveryAdj.volumeMultiplier = Math.max(cfg.volumeMultiplierFloor, recoveryAdj.volumeMultiplier);
  if (expVolumeScale !== 1.0) {
    recoveryAdj.adjustmentReasons.push(`Experience (${expLevel}): volume ×${expVolumeScale}`);
  }

  // #15: Caloric-phase MRV scaling — cut reduces tolerance, bulk increases
  const weightPhase = profile.bodyWeightTrend.phase;
  let caloricPhaseScale = 1.0;
  if (weightPhase === 'cutting') {
    caloricPhaseScale = 0.90;
    recoveryAdj.adjustmentReasons.push('Cutting phase: MRV reduced 10% (caloric deficit limits recovery)');
  } else if (weightPhase === 'bulking') {
    caloricPhaseScale = 1.08;
    recoveryAdj.adjustmentReasons.push('Bulking phase: MRV increased 8% (caloric surplus supports recovery)');
  }

  // Step 2: Select muscle groups
  const { selected: muscleGroups, skipped: skippedGroups } = stepSelectMuscleGroups(profile, prefs, recoveryAdj, cfg, caloricPhaseScale);

  // Step 3: Select exercises
  const { selections: exerciseSelections, decisions: exerciseDecisions } = stepSelectExercises(muscleGroups, allExercises, profile, prefs, cfg);

  // Step 4: Prescribe sets/reps/weight/tempo
  const prescribed = stepPrescribe(exerciseSelections, profile, prefs, recoveryAdj, cfg, expProgressionScale);

  // Step 5: Apply session constraints
  const constrained = stepApplyConstraints(prescribed, prefs, profile, cfg);

  // Step 6: Generate rationale + decision log
  const workout = stepGenerateRationale(constrained, muscleGroups, recoveryAdj, profile, prefs, skippedGroups, exerciseDecisions);

  return workout;
}

// ─── Week Preview ────────────────────────────────────────────────────────

export interface DayPreview {
  dayOfWeek: number;        // 0=Sun
  dayName: string;
  isRestDay: boolean;
  focus: string;            // e.g. "Push" or "Upper" or "Chest, Triceps"
  muscleGroups: string[];
  estimatedExercises: number;
  estimatedMinutes: number;
  isToday: boolean;
}

export function generateWeekPreview(profile: TrainingProfile, userRestDays: number[] = []): DayPreview[] {
  const todayDow = new Date().getDay();
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const { dayOfWeekPatterns, detectedSplit } = profile;
  const restDaySet = new Set(userRestDays);

  const splitLabels: Record<string, string> = {
    push: 'Push', pull: 'Pull', legs: 'Legs',
    upper: 'Upper', lower: 'Lower', full: 'Full Body',
  };

  // Build rotation sequence from detected split
  const rotation = detectedSplit.typicalRotation.length > 0
    ? detectedSplit.typicalRotation
    : [];

  // Figure out where in the rotation we are based on most recent training day
  let rotationIdx = 0;
  if (rotation.length > 0) {
    for (let daysBack = 0; daysBack < 7; daysBack++) {
      const checkDow = (todayDow - daysBack + 7) % 7;
      const pattern = dayOfWeekPatterns[checkDow];
      if (pattern && !pattern.isRestDay && daysBack > 0) {
        // This was the last training day — find which rotation slot it was
        const lastFocus = pattern.muscleGroupsTypical;
        for (let r = 0; r < rotation.length; r++) {
          const rotGroups = SPLIT_MUSCLE_MAPPING[rotation[r]];
          if (rotGroups && lastFocus.some(mg => rotGroups.includes(mg))) {
            rotationIdx = (r + 1) % rotation.length;
            break;
          }
        }
        break;
      }
    }
  }

  const previews: DayPreview[] = [];
  let usedRotationSlots = 0;

  for (let offset = 0; offset < 7; offset++) {
    const dow = (todayDow + offset) % 7;
    const pattern = dayOfWeekPatterns[dow];
    const isToday = offset === 0;

    const isUserRestDay = restDaySet.has(dow);
    const hasExplicitRestConfig = restDaySet.size > 0;
    const isPatternRest = !pattern || pattern.isRestDay || pattern.frequency < 0.3;
    const shouldRest = hasExplicitRestConfig ? isUserRestDay : isPatternRest;

    if (shouldRest) {
      previews.push({
        dayOfWeek: dow,
        dayName: dayNames[dow],
        isRestDay: true,
        focus: 'Rest',
        muscleGroups: [],
        estimatedExercises: 0,
        estimatedMinutes: 0,
        isToday,
      });
      continue;
    }

    // Determine focus from rotation or day pattern
    let focus = '';
    let muscleGroups: string[] = [];

    if (rotation.length > 0 && usedRotationSlots < rotation.length) {
      const slot = rotation[(rotationIdx + usedRotationSlots) % rotation.length];
      focus = splitLabels[slot] || slot;
      muscleGroups = SPLIT_MUSCLE_MAPPING[slot] || pattern.muscleGroupsTypical;
      usedRotationSlots++;
    } else {
      muscleGroups = pattern.muscleGroupsTypical.slice(0, 4);
      focus = muscleGroups.slice(0, 3).map(g => g.replace(/_/g, ' ')).join(', ');
    }

    previews.push({
      dayOfWeek: dow,
      dayName: dayNames[dow],
      isRestDay: false,
      focus,
      muscleGroups,
      estimatedExercises: Math.round(pattern.avgExerciseCount),
      estimatedMinutes: Math.round(pattern.avgExerciseCount * 7 + 10),
      isToday,
    });
  }

  return previews;
}

/**
 * Saves a generated workout to the database for future comparison with actuals.
 */
export async function saveGeneratedWorkout(
  userId: string,
  workout: GeneratedWorkout
): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase
    .from('generated_workouts')
    .insert({
      id: workout.id,
      user_id: userId,
      date: workout.date,
      training_goal: workout.trainingGoal,
      session_duration_minutes: workout.estimatedDurationMinutes,
      recovery_status: {
        status: workout.recoveryStatus,
        deload: workout.deloadActive,
        adjustments: workout.adjustmentsSummary,
      },
      exercises: workout.exercises,
      rationale: workout.sessionRationale,
      adjustments: workout.adjustmentsSummary,
    });

  if (error) throw error;
}
