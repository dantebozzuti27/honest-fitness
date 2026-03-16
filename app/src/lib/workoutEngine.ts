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
import type { TrainingProfile, ExerciseProgression, EnrichedExercise, ExercisePreference, CardioHistory, ExerciseOrderProfile, MuscleVolumeStatus } from './trainingAnalysis';
import { uuidv4 } from '../utils/uuid';
import { getExerciseMapping, getExerciseSFR } from './exerciseMuscleMap';
import { estimateWeight as estimateWeightFromRatios } from './liftRatios';
import { suggestSupersets, type SupersetSuggestion } from './supersetPairer';
import { DEFAULT_MODEL_CONFIG, MODEL_CONFIG_VERSION, WORKOUT_ENGINE_VERSION, type ModelConfig } from './modelConfig';
import { getSportProfile, type SportProfile, type SportSeason } from './sportProfiles';
import { getLocalDate } from '../utils/dateUtils';
import { normalizeEquipment } from '../utils/formatUtils';

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
  sport_focus: string | null;
  sport_season: SportSeason | null;
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
  featureSnapshotId?: string;
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
  objectiveUtility?: {
    version: string;
    adherenceScore: number;
    progressionScore: number;
    sessionFitScore: number;
    utility: number;
  };
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
    session_duration_minutes: (() => {
      const v = Number(data?.session_duration_minutes ?? data?.session_duration ?? DEFAULT_MODEL_CONFIG.defaultSessionDurationMinutes);
      return Number.isFinite(v) && v > 0 ? v : DEFAULT_MODEL_CONFIG.defaultSessionDurationMinutes;
    })(),
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
    sport_focus: data?.sport_focus ?? null,
    sport_season: data?.sport_season ?? null,
  };
}

async function fetchAllExercises(): Promise<EnrichedExercise[]> {
  const supabase = requireSupabase();
  const primary = await supabase
    .from('exercise_library')
    .select('id, name, body_part, primary_muscles, secondary_muscles, stabilizer_muscles, movement_pattern, ml_exercise_type, force_type, difficulty, default_tempo, equipment')
    .eq('is_custom', false);
  let data: any[] | null = (primary.data ?? null) as any[] | null;
  let error: any = primary.error;

  // Backward-compatible fallback for older schemas missing optional columns.
  if (error && (error.code === '42703' || `${error.message || ''}`.toLowerCase().includes('column'))) {
    const retry = await supabase
      .from('exercise_library')
      .select('id, name, body_part, primary_muscles, secondary_muscles, stabilizer_muscles, movement_pattern, ml_exercise_type, force_type, difficulty, default_tempo')
      .eq('is_custom', false);
    data = (retry.data ?? null) as any[] | null;
    error = retry.error;
  }

  if (error) throw error;
  return ((data ?? []) as EnrichedExercise[]).map((ex: any) => ({
    ...ex,
    equipment: Array.isArray(ex?.equipment) ? ex.equipment : [],
  }));
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

/**
 * Default set count when no user history exists.
 *
 * Instead of fixed lookup, this uses a scoring approach:
 *   - Role weight: primary > secondary > isolation > corrective
 *   - Goal weight: strength emphasizes fewer high-quality sets;
 *     hypertrophy & endurance emphasize more volume
 *   - Priority muscles get a bonus set
 *   - Deload cuts to ~60% of normal
 */
function getTieredSets(
  role: ExerciseRole,
  goal: string,
  isPriorityMuscle: boolean,
  isDeload: boolean
): number {
  // Base sets by role importance
  const roleBase: Record<string, number> = {
    primary: 4, secondary: 3, isolation: 2, corrective: 2, cardio: 1,
  };
  let sets = roleBase[role] ?? 3;

  // Goal adjustment
  if (goal === 'strength' && role === 'primary') sets += 1;
  if (goal === 'hypertrophy' && (role === 'primary' || role === 'secondary')) sets += 0;
  if (goal === 'endurance') sets = Math.max(sets - 1, 2);

  // Priority muscle bonus
  if (isPriorityMuscle && role !== 'corrective') sets += 1;

  // Deload: reduce to ~60%
  if (isDeload) sets = Math.max(2, Math.round(sets * 0.6));

  return Math.max(2, Math.min(6, sets));
}

/**
 * RIR target from role + goal interaction.
 *
 * Principle: the closer to failure you train, the more stimulus per set
 * but also more fatigue. Primary compounds accumulate more fatigue per
 * set (more muscle mass) so need a larger RIR buffer.
 *
 * Sources: Helms et al. (2016), Zourdos et al. (2016)
 */
function getRirTarget(role: ExerciseRole, goal: string, isDeload: boolean): number {
  if (isDeload) return 4;

  // Fatigue cost by role: higher for compounds because they tax more systems
  const roleFatigueCost: Record<string, number> = {
    primary: 3, secondary: 2, isolation: 1, corrective: 3, cardio: 0,
  };
  const baseFatigue = roleFatigueCost[role] ?? 2;

  // Goal modifier: strength training intentionally stays further from failure
  // (quality reps with full neural drive matter more than grinding)
  // Hypertrophy/fat loss can push closer to failure on isolation work
  const goalRirShift: Record<string, number> = {
    strength: 0, hypertrophy: -1, fat_loss: -1, endurance: 0, general_fitness: 0,
  };

  return Math.max(0, Math.min(4, baseFatigue + (goalRirShift[goal] ?? 0)));
}

/**
 * Derive appropriate working weight from estimated 1RM for a target rep count + RIR.
 *
 * Epley: 1RM = weight × (1 + reps/30)
 * Inverted: weight = 1RM / (1 + effectiveReps/30)
 *
 * effectiveReps = targetReps + rir (sets at RIR 2 with target 5 = capacity for 7 reps)
 *
 * This prevents the engine from prescribing a user's 1RM as a working weight
 * for multi-rep sets — the most dangerous bug in any training program generator.
 */
function weightForReps(estimated1RM: number, targetReps: number, rir: number, equipment?: string[], exerciseType?: string): number {
  if (estimated1RM <= 0 || targetReps <= 0) return 0;
  const effectiveReps = targetReps + rir;
  const raw = estimated1RM / (1 + effectiveReps / 30);
  const cfg = DEFAULT_MODEL_CONFIG;
  const eqNorm = (equipment ?? []).map(normalizeEquipment);
  let step: number;
  if (eqNorm.includes('barbell')) step = cfg.barbellIncrement;
  else if (eqNorm.includes('dumbbell')) step = cfg.dumbbellIncrement;
  else if (exerciseType === 'isolation') step = cfg.isolationIncrement;
  else step = cfg.machineIncrement;
  return Math.round(raw / step) * step;
}

function getRirLabel(rir: number): string {
  if (rir >= 4) return 'Light — leave plenty in the tank';
  if (rir === 3) return 'Leave 3 in the tank';
  if (rir === 2) return 'Leave 2 in the tank';
  if (rir === 1) return 'Leave 1 in the tank';
  return 'Push close to failure';
}

/**
 * Infer exercise type when no explicit classification exists.
 * Uses muscle count and name heuristics instead of always defaulting to 'compound'.
 */
function inferExerciseType(exercise: EnrichedExercise): string {
  const name = exercise.name.toLowerCase();
  const primaryCount = Array.isArray(exercise.primary_muscles) ? exercise.primary_muscles.length : 0;
  const secondaryCount = Array.isArray(exercise.secondary_muscles) ? exercise.secondary_muscles.length : 0;

  const ISOLATION_KEYWORDS = [
    'curl', 'extension', 'fly', 'raise', 'kickback', 'pushdown',
    'pulldown cable', 'lateral', 'front raise', 'rear delt', 'calf',
    'shrug', 'wrist', 'forearm', 'concentration', 'preacher',
    'cable crossover', 'pec deck', 'tricep', 'bicep', 'hamstring curl',
    'leg curl', 'leg extension', 'hip adduct', 'hip abduct',
    'face pull', 'reverse fly',
  ];
  const COMPOUND_KEYWORDS = [
    'squat', 'deadlift', 'bench press', 'overhead press', 'row',
    'pull-up', 'pullup', 'chin-up', 'chinup', 'dip', 'lunge',
    'clean', 'snatch', 'press', 'thrust',
  ];
  const CARDIO_KEYWORDS = [
    'treadmill', 'bike', 'elliptical', 'rowing machine', 'stairmaster',
    'run', 'jog', 'walk', 'cycling', 'swim', 'jump rope',
  ];

  if (CARDIO_KEYWORDS.some(k => name.includes(k))) return 'cardio';
  if (ISOLATION_KEYWORDS.some(k => name.includes(k))) return 'isolation';
  if (COMPOUND_KEYWORDS.some(k => name.includes(k))) return 'compound';

  // Heuristic: multi-joint = compound, single-joint = isolation
  if (primaryCount + secondaryCount >= 3) return 'compound';

  // Default to isolation for unknown exercises — safer rest/volume programming
  // than incorrectly assuming compound (which gives less rest, higher CNS load)
  return 'isolation';
}

/**
 * Rest periods computed from exercise demand characteristics, not lookup tables.
 *
 * The formula builds rest from first principles:
 *   1. Systemic demand score (0-10): how much CNS/metabolic recovery is needed.
 *      Derived from primary muscle count, exercise type, and movement pattern.
 *   2. Goal multiplier: strength needs full ATP recovery (longer rest),
 *      fat loss benefits from incomplete recovery (shorter rest).
 *   3. Floor/ceiling from physiological limits:
 *      - Below 30s: incomplete phosphocreatine resynthesis even for isolation
 *      - Above 300s: diminishing returns, session time waste
 */
function getRestByExercise(
  exercise: EnrichedExercise,
  role: ExerciseRole,
  goal: string
): number {
  if (role === 'corrective') return 45;
  if (role === 'cardio') return 0;

  const mapping = getExerciseMapping(exercise.name);
  const exType = mapping?.exercise_type ?? exercise.ml_exercise_type ?? inferExerciseType(exercise);
  const primaryCount = mapping?.primary_muscles?.length ?? (Array.isArray(exercise.primary_muscles) ? exercise.primary_muscles.length : 1);
  const secondaryCount = mapping?.secondary_muscles?.length ?? (Array.isArray(exercise.secondary_muscles) ? exercise.secondary_muscles.length : 0);
  const pattern = mapping?.movement_pattern ?? exercise.movement_pattern ?? '';

  // Systemic demand score (0-10): how taxing this movement is on the whole body
  let demandScore = 0;

  // Muscle mass recruited: more muscles = more oxygen debt = more rest
  demandScore += Math.min(primaryCount * 1.2, 5);
  demandScore += Math.min(secondaryCount * 0.3, 1.5);

  // Compound vs isolation: multi-joint movements create more systemic fatigue
  if (exType === 'compound') demandScore += 2;

  // Movement pattern CNS load: axial loading (spine-loaded) > other compounds > isolation
  const PATTERN_CNS: Record<string, number> = {
    squat: 2.0, deadlift: 2.0, hip_hinge: 1.8,
    horizontal_press: 1.3, vertical_press: 1.3, lunge: 1.2,
    horizontal_pull: 1.0, vertical_pull: 1.0,
    extension: 0.3, curl: 0.3, fly: 0.3, raise: 0.3, rotation: 0.3,
  };
  demandScore += PATTERN_CNS[pattern] ?? 0.5;

  // Convert demand score to rest seconds on a continuous curve
  // Score 0 → ~40s, Score 10 → ~200s (before goal scaling)
  const baseRest = 40 + (demandScore / 10) * 160;

  // Goal multiplier: strength needs 3-5 min for phosphocreatine recovery (Willardson 2006)
  // Hypertrophy benefits from 60-120s (Schoenfeld 2016). Fat loss uses shorter rest for metabolic stress.
  const goalMultiplier: Record<string, number> = {
    strength: 1.40,
    hypertrophy: 1.0,
    general_fitness: 1.0,
    fat_loss: 0.75,
    endurance: 0.65,
  };
  const scaled = baseRest * (goalMultiplier[goal] ?? 1.0);

  return Math.max(30, Math.min(300, Math.round(scaled)));
}

/**
 * Tempo prescription from exercise-specific default → goal/type interaction.
 * Format: eccentric-pause-concentric.
 *
 * Hypertrophy benefits from controlled eccentrics (time under tension).
 * Strength benefits from explosive concentrics.
 * Isolation benefits from slower tempos to maintain tension on smaller muscles.
 */
function getTempo(defaultTempo: string | null, goal: string, exerciseType: string | null): string {
  if (defaultTempo) return defaultTempo;
  const isIsolation = exerciseType === 'isolation' || exerciseType === 'accessory';
  if (goal === 'strength') return isIsolation ? '2-0-1' : '1-1-1';
  if (goal === 'hypertrophy') return isIsolation ? '3-1-2' : '2-1-1';
  if (goal === 'endurance') return '2-0-1';
  return isIsolation ? '2-1-1' : '2-1-1';
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

// Transition time per exercise based on setup complexity:
// Primary compounds (barbell loading, rack adjustments, safety pins) need more.
// Isolation machines (pin select, seat adjust) need less.
// These scale with role as a proxy for equipment complexity.
const TRANSITION_TIME_SEC: Record<string, number> = {
  primary: 120,
  secondary: 90,
  isolation: 60,
  corrective: 45,
  cardio: 60,     // walk over, set speed/incline
};

/**
 * Time-per-exercise estimate including set execution, rest between sets,
 * warmup sets, and transition/setup time to the next station.
 *
 * Set execution time is derived from rep count and tempo rather than a fixed constant.
 * A 3-rep strength set is faster than a 15-rep endurance set.
 */
function estimateExerciseMinutes(
  sets: number, restSeconds: number, role: ExerciseRole, warmupSets: number = 0,
  reps: number = 0, tempo: string = '2-1-1'
): number {
  // Parse tempo to get seconds per rep (eccentric + pause + concentric)
  const tempoParts = tempo.split('-').map(Number);
  const secPerRep = (tempoParts[0] || 2) + (tempoParts[1] || 1) + (tempoParts[2] || 1);
  const effectiveReps = reps > 0 ? reps : (role === 'primary' ? 5 : role === 'secondary' ? 8 : 12);
  const setExecutionSec = effectiveReps * secPerRep;

  // Warmup rest scales with working rest but is always shorter
  const warmupRestSec = Math.round(restSeconds * 0.5);
  const warmupExecSec = Math.round(setExecutionSec * 0.8);
  const workingTime = sets * (setExecutionSec + restSeconds);
  const warmupTime = warmupSets * (warmupExecSec + warmupRestSec);
  const transition = TRANSITION_TIME_SEC[role] ?? 60;
  return (workingTime + warmupTime + transition) / 60;
}

function classifyExerciseRole(
  exercise: EnrichedExercise,
  indexInGroup: number
): ExerciseRole {
  const exType = exercise.ml_exercise_type ?? inferExerciseType(exercise);
  if (exType === 'cardio') return 'cardio';
  if (exType === 'recovery') return 'corrective';
  if (indexInGroup === 0 && exType === 'compound') return 'primary';
  if (exType === 'compound') return 'secondary';
  return 'isolation';
}

/**
 * Generates warmup ramp sets adaptively based on working weight, body weight,
 * exercise type, and user history.
 *
 * Logic:
 *   1. If the user has warmup history for this exercise, mirror their pattern.
 *   2. Otherwise, compute warmup count from the spread between bar/empty
 *      weight and working weight — heavier working sets need more ramp steps.
 *   3. Reps taper inversely: light warmups get more reps (neuromuscular priming),
 *      heavier warmups get fewer (avoid pre-fatiguing working sets).
 *   4. The first warmup never starts at an arbitrary fixed weight. It starts
 *      relative to the user's body weight and the exercise's min load
 *      (bar weight for barbell, lightest dumbbell, etc).
 */
function generateWarmupRamp(
  workingWeight: number,
  opts?: {
    warmupHistory?: { sets: number; avgPct: number } | null;
    bodyWeightLbs?: number | null;
    equipment?: string[];
    exerciseType?: string | null;
    role?: ExerciseRole;
  }
): WarmupSet[] {
  const { warmupHistory, bodyWeightLbs, equipment, exerciseType, role } = opts ?? {};
  const cfg = DEFAULT_MODEL_CONFIG;
  const eqNorm = (equipment ?? []).map(normalizeEquipment);
  const isBarbell = eqNorm.includes('barbell');

  // Hard baseline for barbell warmups: fixed anchor ladder only.
  if (isBarbell) {
    const anchors = (cfg.barbellWarmupAnchors ?? [45, 95, 135, 185, 225, 275, 315, 365, 405, 455, 495])
      .filter(a => a < workingWeight * 0.95);
    if (anchors.length === 0) return [];
    const selected = anchors.slice(-4); // keep ramp practical and easy to load/unload
    return selected.map(a => ({
      weight: a,
      reps: a <= 95 ? 5 : a <= 185 ? 3 : 2,
    }));
  }

  // Relative intensity: how heavy is this working weight for this person?
  const bw = bodyWeightLbs ?? DEFAULT_MODEL_CONFIG.defaultBodyWeightLbs;
  const relativeIntensity = workingWeight / bw;

  // Don't generate warmups for very light work (< 30% BW) — the exercise itself is warmup-weight
  if (relativeIntensity < 0.30 && workingWeight < 65) return [];

  // If user has warmup history for this exercise, mirror their exact pattern
  if (warmupHistory && warmupHistory.sets >= 1 && warmupHistory.avgPct > 0) {
    const n = Math.min(warmupHistory.sets, 5);
    const startPct = Math.max(0.25, warmupHistory.avgPct * 0.5);
    const endPct = warmupHistory.avgPct;
    const ramp: WarmupSet[] = [];
    for (let i = 0; i < n; i++) {
      const pct = startPct + (endPct - startPct) * (i / Math.max(n - 1, 1));
      const w = snapToPlate(workingWeight * pct, equipment, exerciseType ?? undefined);
      const r = Math.max(2, Math.round(10 - i * (8 / n)));
      if (w >= 10 && w < workingWeight * 0.95) ramp.push({ weight: w, reps: r });
    }
    return ramp;
  }

  // Non-barbell fallback (kept for edge cases where warmups are enabled).
  const isDumbbell = eqNorm.includes('dumbbell');
  const minLoad = isBarbell ? 45 : isDumbbell ? 10 : 20;

  // Spread = how far from empty bar to working weight
  const spread = workingWeight - minLoad;
  if (spread <= 15) return []; // working weight is basically the empty bar

  // Number of warmup sets scales with how heavy the exercise is relative to body weight
  // and the absolute spread. Heavier = more ramp steps needed.
  const warmupCount = relativeIntensity >= 1.5 ? 5  // very heavy (1.5x+ BW)
    : relativeIntensity >= 1.0 ? 4                   // heavy (BW+)
    : relativeIntensity >= 0.65 ? 3                  // moderate (0.65-1.0 BW)
    : spread >= 60 ? 3                               // wide spread even if light per BW
    : 2;                                             // light relative work

  // Generate percentages that ramp from ~40% to ~90% of working weight
  // Tighter spacing near the top so the last warmup is close to working weight
  const ramp: WarmupSet[] = [];
  for (let i = 0; i < warmupCount; i++) {
    // Non-linear ramp: spacing tightens as we approach working weight
    const t = (i + 1) / (warmupCount + 1);
    const pct = 0.25 + t * 0.65; // ranges from ~0.38 to ~0.87
    const rawWeight = workingWeight * pct;
    const w = snapToPlate(Math.max(rawWeight, minLoad), equipment, exerciseType ?? undefined);

    // Reps taper: lighter warmups get more reps for blood flow / neural priming
    // Heavier warmups use fewer reps to avoid fatigue
    const repTaper = Math.max(2, Math.round(12 - (pct * 12)));

    // Don't duplicate weights or exceed working weight
    if (w < workingWeight * 0.95 && !ramp.some(r => r.weight === w)) {
      ramp.push({ weight: w, reps: repTaper });
    }
  }

  return ramp;
}

/**
 * Snap a weight to the nearest loadable increment for the given equipment.
 * Barbell: 5 lb (45 lb bar + plates loaded in pairs, smallest pair = 2.5 lb × 2)
 * Dumbbell: 5 lb (standard fixed-weight jumps)
 * Isolation cable/machine: 2.5 lb (pin-select stacks)
 * Other/unknown: 5 lb
 */
function snapToPlate(weight: number, equipment?: string[], exerciseType?: string): number {
  if (weight <= 0) return 0;
  const cfg = DEFAULT_MODEL_CONFIG;
  const eqNorm = (equipment ?? []).map(normalizeEquipment);
  let step: number;
  if (eqNorm.includes('barbell')) step = cfg.barbellIncrement;
  else if (eqNorm.includes('dumbbell')) step = cfg.dumbbellIncrement;
  else if (exerciseType === 'isolation') step = cfg.isolationIncrement;
  else step = cfg.machineIncrement;
  return Math.round(weight / step) * step;
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

  // #8: Sleep → Volume Adjustment (ML-computed modifier)
  if (profile.sleepVolumeModifier) {
    const svm = profile.sleepVolumeModifier;
    if (svm.volumeMultiplier !== 1.0) {
      volumeMultiplier *= svm.volumeMultiplier;
      reasons.push(`Sleep quality (${svm.lastNightSleepQuality}): volume ×${svm.volumeMultiplier.toFixed(2)}, rest ×${svm.restTimeMultiplier.toFixed(2)}`);
    }
  }

  // #3: HRV-Gated Intensity (ML-computed modifier)
  if (profile.hrvIntensityModifier) {
    const hrvm = profile.hrvIntensityModifier;
    if (hrvm.intensityMultiplier !== 1.0) {
      volumeMultiplier *= hrvm.intensityMultiplier;
      reasons.push(`HRV intensity gate: ${hrvm.recommendation} (×${hrvm.intensityMultiplier})`);
    }
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
  caloricPhaseScale: number = 1.0,
  dayOfWeekOverride?: number
): { selected: MuscleGroupSelection[]; skipped: Array<{ muscleGroup: string; reason: string }> } {
  const candidates: MuscleGroupSelection[] = [];
  const skipped: Array<{ muscleGroup: string; reason: string }> = [];

  // Determine today's target groups from detected split or user preference
  const { detectedSplit, dayOfWeekPatterns } = profile;
  const todayDow = dayOfWeekOverride ?? new Date().getDay();
  const todayPattern = dayOfWeekPatterns[todayDow];

  let splitTargetGroups: Set<string> | null = null;

  // For explicit day planning (weekly plan), prioritize the day-of-week pattern
  // so each day gets distinct focus rather than repeating nextRecommended.
  if (dayOfWeekOverride != null && todayPattern && !todayPattern.isRestDay && todayPattern.muscleGroupsTypical.length > 0) {
    splitTargetGroups = new Set(todayPattern.muscleGroupsTypical);
  } else if (dayOfWeekOverride != null && detectedSplit.typicalRotation.length > 0) {
    // If no explicit day pattern is available, rotate weekly focus by weekday
    // so generated weekly plans do not repeat the same exact day focus.
    const mondayBased = (todayDow + 6) % 7;
    const splitName = detectedSplit.typicalRotation[mondayBased % detectedSplit.typicalRotation.length];
    const groups = SPLIT_MUSCLE_MAPPING[splitName];
    if (groups?.length) splitTargetGroups = new Set(groups);
  } else if (prefs.preferred_split && SPLIT_MUSCLE_MAPPING[prefs.preferred_split]) {
    // User's preferred split overrides auto-detection
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
      const individualRate = profile.individualRecoveryRates?.[vol.muscleGroup];
      if (individualRate && individualRate > 1.2 && recovery.recoveryPercent >= 70) {
        // Fast recoverer at 70%+ can override default recovery window
        // (kept in candidate pool — not skipped)
      } else {
        const rateNote = individualRate && individualRate > 1.2
          ? ` even with fast rate (${individualRate.toFixed(1)}x)`
          : '';
        skipped.push({ muscleGroup: vol.muscleGroup, reason: `Still recovering (${recovery.recoveryPercent}% recovered)${rateNote}` });
        continue;
      }
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

    // Sport-specific volume scaling
    const sportProfile = getSportProfile(prefs.sport_focus);
    const sportMuscle = sportProfile?.muscleGroupPriorities.find(p => p.muscleGroup === vol.muscleGroup);
    if (sportMuscle) {
      weeklyTarget *= sportMuscle.volumeMultiplier;
    }

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

    // Sport-specific muscle group priority (sportProfile/sportMuscle declared above)
    if (sportMuscle) {
      priority += 0.15;
    }

    // Scale sets by duration: longer sessions can accommodate more volume per group
    const sessionDur = prefs.session_duration_minutes;
    const durationSetScale = sessionDur >= 120 ? 1.30 : sessionDur >= 90 ? 1.15 : sessionDur <= 45 ? 0.75 : 1.0;
    const setsNeeded = Math.ceil(
      Math.min(Math.max(volumeDeficit, 3), 12) * recoveryAdj.volumeMultiplier * durationSetScale
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

  const dur = prefs.session_duration_minutes;
  const maxGroups = dur <= 35 ? 2
    : dur <= 50 ? 3
    : dur <= 75 ? 4
    : dur <= 100 ? 5
    : 6;

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

      // #9: Exercise Novelty Cycling — stronger rotation penalties
      if (profile.exerciseRotation) {
        const rot = profile.exerciseRotation.find(
          r => r.exerciseName === ex.name.toLowerCase()
        );
        if (rot) {
          if (rot.consecutiveWeeksUsed >= 6) {
            score -= 10;
            factors.push(`Stale exercise: ${rot.consecutiveWeeksUsed} weeks (forced rotation, -10)`);
          } else if (rot.consecutiveWeeksUsed >= 4) {
            score -= 5;
            factors.push(`Exercise rotation suggested: ${rot.consecutiveWeeksUsed} weeks (-5)`);
          } else if (cfg.enforceRotation && rot.shouldRotate) {
            score += cfg.rotationPenalty;
            factors.push(`Rotation suggested: ${rot.consecutiveWeeksUsed} consecutive weeks (${cfg.rotationPenalty})`);
          }
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
        const exEq = (Array.isArray(ex.equipment) ? ex.equipment : []).map(normalizeEquipment);
        const needsHeavyEquip = exEq.some(e =>
          ['barbell', 'cable', 'smith_machine'].includes(e)
        );
        if (needsHeavyEquip) {
          score -= 5;
          factors.push('Requires unavailable equipment (-5)');
        }
      }

      // #1: Exercise Swap Learning — penalize exercises the user consistently rejects
      if (profile.exerciseSwapHistory) {
        const swapEntry = profile.exerciseSwapHistory.find(
          s => s.exerciseName === ex.name.toLowerCase()
        );
        if (swapEntry) {
          if (swapEntry.swapCount >= 3) {
            score -= 15;
            factors.push(`Frequently swapped out (${swapEntry.swapCount}x, -15)`);
          } else if (swapEntry.swapCount >= 1) {
            score -= 5 * swapEntry.swapCount;
            factors.push(`Previously swapped (${swapEntry.swapCount}x, -${5 * swapEntry.swapCount})`);
          }
        }
      }

      // #7: Movement Pattern Fatigue — penalize patterns with accumulated fatigue
      if (profile.movementPatternFatigue) {
        const patternFatigue = profile.movementPatternFatigue.find(p => {
          const exMp = (ex.movement_pattern || '').toLowerCase();
          const exGroups = (Array.isArray(ex.primary_muscles) ? ex.primary_muscles : [])
            .map(m => MUSCLE_HEAD_TO_GROUP[m?.toLowerCase()])
            .filter(Boolean);
          if (p.pattern === 'horizontal_push' && (exMp.includes('press') || exGroups.includes('chest'))) return true;
          if (p.pattern === 'vertical_pull' && (exMp.includes('pull') || exGroups.includes('back_lats'))) return true;
          if (p.pattern === 'hip_hinge' && (exMp.includes('hinge') || exGroups.includes('hamstrings'))) return true;
          if (p.pattern === 'knee_dominant' && (exMp.includes('squat') || exGroups.includes('quadriceps'))) return true;
          return false;
        });

        if (patternFatigue?.fatigueLevel === 'high') {
          score -= 6;
          factors.push(`Movement pattern fatigue: ${patternFatigue.pattern} high (-6)`);
        } else if (patternFatigue?.fatigueLevel === 'moderate') {
          score -= 2;
          factors.push(`Movement pattern fatigue: ${patternFatigue.pattern} moderate (-2)`);
        }
      }

      // #9: Plateau strategies — penalize plateaued exercises with swap_variation so engine prefers alternatives
      const plateau = profile.plateauDetections?.find(
        p => p.exerciseName === ex.name.toLowerCase() && p.isPlateaued
      );
      if (plateau?.suggestedStrategy) {
        const strat = plateau.suggestedStrategy.toLowerCase();
        if (strat.includes('swap') || strat.includes('variation')) {
          score -= 3;
          factors.push(`Plateaued — swap/variation suggested (-3)`);
        }
      }

      return { exercise: ex, score, factors };
    });

    // Sport-specific scoring adjustments
    const sportProfile = getSportProfile(prefs.sport_focus);
    if (sportProfile) {
      for (const item of scored) {
        const exKey = item.exercise.name.toLowerCase();
        const boost = sportProfile.exerciseBoosts.find(b => b.exerciseName === exKey);
        if (boost) {
          item.score += boost.boost;
          item.factors.push(`${sportProfile.label}: ${boost.reason} (+${boost.boost})`);
        }
        const limit = sportProfile.exerciseLimits.find(l => l.exerciseName === exKey);
        if (limit) {
          item.score += limit.penalty;
          item.factors.push(`${sportProfile.label}: ${limit.reason} (${limit.penalty})`);
        }
      }
    }

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

    // Determine max exercises from user's actual patterns for this group, scaled by session duration
    const userExercisesForGroup = scored.filter(s => {
      const p = prefMap.get(s.exercise.name.toLowerCase());
      return p && p.recentSessions >= 1;
    }).length;
    const durationMin = prefs.session_duration_minutes;
    const durationBonus = durationMin >= 120 ? 2 : durationMin >= 90 ? 1 : 0;
    const defaultMax = remainingSets <= 4 ? 1 + durationBonus : remainingSets <= 8 ? 2 + durationBonus : 3 + durationBonus;
    let maxExercisesPerGroup = userExercisesForGroup > 0
      ? Math.min(userExercisesForGroup + durationBonus, 5)
      : Math.min(defaultMax, 5);

    // #4: Compliance Feedback — reduce exercises if user frequently skips last ones
    if (profile.prescribedVsActual && profile.prescribedVsActual.complianceRate < 0.6) {
      maxExercisesPerGroup = Math.max(1, maxExercisesPerGroup - 1);
    }

    const maxExercises = maxExercisesPerGroup;

    // Sort by overall score — user preferences already dominate
    const ordered = [...scored].sort((a, b) => b.score - a.score);

    // Scale max sets per exercise by duration
    const maxSetsPerExercise = durationMin >= 120 ? 6 : durationMin >= 90 ? 5 : durationMin >= 60 ? 4 : 3;

    let exerciseCount = 0;
    for (const item of ordered) {
      if (exerciseCount >= maxExercises || remainingSets <= 0) break;

      const setsForThis = exerciseCount === 0
        ? Math.min(Math.ceil(remainingSets * 0.6), maxSetsPerExercise)
        : Math.min(remainingSets, maxSetsPerExercise - 1);

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
  expProgressionScale: number = 1.0,
  breakRampMultiplier: number = 1.0
): GeneratedExercise[] {
  const goal = getEffectiveGoal(prefs);
  const secondaryGoal = prefs.secondary_goal;
  const prioritySet = new Set(prefs.priority_muscles.map(m => m.toLowerCase()));
  const lowerBodyGroups = new Set(['quadriceps', 'hamstrings', 'glutes', 'calves', 'adductors', 'abductors']);
  let primaryLowerBarbellPrimed = false;

  const groupIndex: Record<string, number> = {};

  return selections.map(sel => {
    // Handle cardio with real duration/intensity from history
    if (sel.isCardio || sel.exercise.ml_exercise_type === 'cardio') {
      const cardio = profile.cardioHistory.find(c => c.exerciseName === sel.exercise.name.toLowerCase());
      const pref = profile.exercisePreferences.find(p => p.exerciseName === sel.exercise.name.toLowerCase());

      // #1: Goal-based cardio duration fallback instead of hardcoded 30 min
      const goalCardioDefaults: Record<string, number> = {
        fat_loss: 25 * 60, strength: 15 * 60, hypertrophy: 20 * 60,
        endurance: 30 * 60, general_fitness: 20 * 60,
      };
      const prefDuration = prefs.cardio_duration_minutes ? prefs.cardio_duration_minutes * 60 : null;
      const baseDuration = cardio?.avgDurationSeconds
        ?? prefDuration
        ?? goalCardioDefaults[goal] ?? 20 * 60;
      const baseSpeed = cardio?.avgSpeed ?? null;
      const baseIncline = cardio?.avgIncline ?? null;
      let duration = baseDuration;
      let speed = baseSpeed;
      let incline = baseIncline;
      const adjustments: string[] = [];

      const exName = sel.exercise.name.toLowerCase();
      let speedLabel: string | null = null;
      if (exName.includes('stairmaster') || exName.includes('stair master')) speedLabel = 'Level';
      else if (exName.includes('bike') || exName.includes('cycle')) speedLabel = 'Resistance';
      else if (exName.includes('row')) speedLabel = 'Watts';
      else if (exName.includes('treadmill') || exName.includes('walk') || exName.includes('run')) speedLabel = 'Speed (mph)';
      else if (speed != null) speedLabel = 'Intensity';

      // Vary cardio prescription based on goal, recovery, and session context
      // Use a deterministic session-index to cycle through cardio styles
      const sessionIdx = (profile.exercisePreferences.find(
        p => p.exerciseName === sel.exercise.name.toLowerCase()
      )?.totalSessions ?? 0) % 4;

      let targetHrZone: number | null = null;

      if (recoveryAdj.isDeload) {
        duration = Math.round(baseDuration * cfg.deloadCardioDurationMultiplier);
        targetHrZone = 1;
        adjustments.push(`Deload: easy cardio, Zone 1, duration ${Math.round(duration / 60)} min`);
        if (speed != null) {
          speed = Math.round(speed * cfg.deloadCardioIntensityMultiplier * 10) / 10;
        }
      } else if (goal === 'fat_loss' || secondaryGoal === 'fat_loss') {
        // Fat loss: alternate between longer Zone 2 and shorter Zone 3
        if (sessionIdx % 2 === 0) {
          targetHrZone = 2;
          duration = Math.round(baseDuration * 1.15);
          adjustments.push(`Fat loss: extended Zone 2 (${Math.round(duration / 60)} min) — maximize fat oxidation`);
        } else {
          targetHrZone = 3;
          duration = Math.round(baseDuration * 0.75);
          if (speed != null) speed = Math.round(speed * 1.10 * 10) / 10;
          if (incline != null) incline = Math.round(Math.min(incline + 1, 15) * 10) / 10;
          adjustments.push(`Fat loss: Zone 3 tempo (${Math.round(duration / 60)} min) — higher calorie burn rate`);
        }
      } else if (goal === 'strength') {
        // Strength: keep cardio short and easy to minimize interference
        targetHrZone = 2;
        duration = Math.min(duration, 20 * 60);
        adjustments.push(`Strength focus: capped at ${Math.round(duration / 60)} min Zone 2 — minimize interference`);
      } else {
        // General fitness / hypertrophy: rotate through varied styles
        switch (sessionIdx) {
          case 0: // Steady-state Zone 2
            targetHrZone = 2;
            adjustments.push(`Steady state: Zone 2, ${Math.round(duration / 60)} min — aerobic base building`);
            break;
          case 1: // Moderate tempo Zone 3
            targetHrZone = 3;
            duration = Math.round(baseDuration * 0.80);
            if (speed != null) speed = Math.round(speed * 1.08 * 10) / 10;
            if (incline != null) incline = Math.round(Math.min(incline + 1, 15) * 10) / 10;
            adjustments.push(`Tempo: Zone 3, ${Math.round(duration / 60)} min — push the pace`);
            break;
          case 2: // Incline/resistance focus
            targetHrZone = 2;
            if (incline != null) {
              incline = Math.round(Math.min(incline + 2, 15) * 10) / 10;
              adjustments.push(`Incline focus: +2 incline, Zone 2, ${Math.round(duration / 60)} min`);
            } else if (speed != null) {
              speed = Math.round(speed * 1.12 * 10) / 10;
              adjustments.push(`Intensity push: ${speedLabel ?? 'intensity'} up, Zone 2, ${Math.round(duration / 60)} min`);
            } else {
              adjustments.push(`Steady state: Zone 2, ${Math.round(duration / 60)} min`);
            }
            break;
          case 3: // Progressive — slight duration increase
            targetHrZone = 2;
            duration = Math.round(baseDuration * 1.10);
            adjustments.push(`Progressive: Zone 2, ${Math.round(duration / 60)} min — extending duration`);
            break;
        }
      }

      // Progressive overload for cardio: if user's been doing this consistently, nudge up
      if (!recoveryAdj.isDeload && cardio && cardio.recentSessions >= 4) {
        if (cardio.trendDuration === 'stable' && cardio.trendIntensity === 'stable') {
          // Stagnant — suggest a bump
          if (speed != null && incline == null) {
            speed = Math.round((speed + 0.2) * 10) / 10;
            adjustments.push(`Progressive overload: +0.2 ${speedLabel ?? 'intensity'}`);
          } else if (incline != null) {
            incline = Math.round(Math.min(incline + 0.5, 15) * 10) / 10;
            adjustments.push(`Progressive overload: +0.5 incline`);
          }
        } else if (cardio.trendDuration === 'increasing') {
          adjustments.push(`Duration trending up — good progression`);
        } else if (cardio.trendIntensity === 'increasing') {
          adjustments.push(`Intensity trending up — good progressive overload`);
        }
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

    const equipment = (Array.isArray(sel.exercise.equipment) ? sel.exercise.equipment : []).map(normalizeEquipment);
    const exType = sel.exercise.ml_exercise_type ?? inferExerciseType(sel.exercise);
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
    let targetReps = hasLearnedData && pref.learnedReps != null
      ? Math.round(pref.learnedReps)
      : tableRange.target;

    // Sets: use what you actually do, fall back to table
    const tableSets = getTieredSets(role, goal, isPriority, recoveryAdj.isDeload);
    let sets = hasLearnedData && pref.learnedSets != null
      ? Math.round(pref.learnedSets)
      : tableSets;

    // #4: Compliance Feedback — adjust reps if user consistently exceeds prescription
    if (profile.prescribedVsActual) {
      const compliance = profile.prescribedVsActual;
      if (compliance.avgRepsDeviation > 2 && compliance.complianceRate > 0.7) {
        targetReps = Math.min(targetReps + 1, tableRange.max);
      }
    }

    // #2: Rest: prefer learned rest, with movement-pattern-aware fallback
    const tableRest = getRestByExercise(sel.exercise, role, goal);
    const learnedRest = pref?.learnedRestSeconds;
    let restSeconds: number;
    if (learnedRest != null && learnedRest > 0) {
      restSeconds = learnedRest;
    } else {
      restSeconds = tableRest;
    }
    if (profile.sleepVolumeModifier?.restTimeMultiplier) {
      restSeconds = Math.round(restSeconds * profile.sleepVolumeModifier.restTimeMultiplier);
    }

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
      // Derive working weight from estimated 1RM scaled to the target rep range + RIR.
      // This prevents prescribing near-max weights for multi-rep sets.
      const e1rm = prog.estimated1RM;
      targetWeight = weightForReps(e1rm, targetReps, rir, equipment, exType);

      // Safety floor: never prescribe below 50% of last working weight (catches bad 1RM estimates)
      if (targetWeight < prog.lastWeight * 0.5 && prog.lastWeight > 0) {
        targetWeight = snapToPlate(prog.lastWeight * 0.75, equipment, exType);
      }
      adjustments.push(`Based on est. 1RM ${Math.round(e1rm)} lbs → ${targetWeight} lbs for ${targetReps} reps @ RIR ${rir}`);

      if (recoveryAdj.isDeload) {
        targetWeight = snapToPlate(targetWeight * cfg.deloadWeightMultiplier, equipment, exType);
        adjustments.push(`Deload: weight at ${Math.round(cfg.deloadWeightMultiplier * 100)}% (${targetWeight} lbs)`);
      } else {
        const learnedInc = hasLearnedData ? pref.learnedIncrement : null;
        const fallbackIncrement = role === 'isolation' || role === 'corrective'
          ? cfg.isolationIncrement
          : equipment.includes('barbell')
            ? cfg.barbellIncrement
            : equipment.includes('dumbbell')
              ? cfg.dumbbellIncrement
              : cfg.machineIncrement;

        const baseIncrement = learnedInc != null ? learnedInc : fallbackIncrement;
        const scaledIncrement = Math.round(baseIncrement * expProgressionScale * 10) / 10;
        const maxJump = Math.max(Math.round(targetWeight * cfg.maxProgressionPct), 2.5);
        const increment = Math.min(scaledIncrement, maxJump);

        if (learnedInc != null) {
          adjustments.push(`Your typical increment: ${learnedInc} lbs`);
        }

        const exMapping = getExerciseMapping(sel.exercise.name);
        const movementPat = exMapping?.movement_pattern ?? sel.exercise.movement_pattern ?? '';
        const bestPatternType = profile.bestProgressionPatterns[movementPat] ?? null;

        const breakthrough = profile.repWeightBreakthroughs.find(
          b => b.exerciseName === sel.exercise.name.toLowerCase()
        );

        const lastReps = prog.bestSet.reps;
        if (lastReps >= targetReps + cfg.repsAboveTargetForProgression && prog.status === 'progressing') {
          if (bestPatternType === 'double_progression' && breakthrough && !breakthrough.readyForWeightJump) {
            adjustments.push(`Double progression: add reps before weight (${breakthrough.accumulatedRepsAtWeight} reps accumulated, need ${breakthrough.typicalRepsBeforeJump})`);
          } else {
            targetWeight = snapToPlate(targetWeight + increment, equipment, exType);
            adjustments.push(`Progressive overload: +${snapToPlate(increment, equipment, exType)} lbs (last session: ${lastReps} reps vs ${targetReps} target)`);
          }
        } else if (prog.status === 'stalled') {
          const plateauInfo = profile.plateauDetections.find(
            p => p.exerciseName === sel.exercise.name.toLowerCase() && p.isPlateaued
          );
          if (plateauInfo && plateauInfo.sessionsSinceProgress >= 4) {
            adjustments.push(`Plateau (${plateauInfo.sessionsSinceProgress} sessions): drop to ${sets - 1} sets × ${targetReps + 2} reps to break through`);
          } else {
            adjustments.push(`Stalled at ${targetWeight} lbs — hold weight, focus on RIR ${rir}`);
          }
        } else if (prog.status === 'regressing') {
          const regressionSeverity = Math.abs(prog.progressionSlope);
          const reductionPct = Math.max(0.80, cfg.regressionWeightMultiplier - (regressionSeverity * 0.8));
          targetWeight = snapToPlate(targetWeight * reductionPct, equipment, exType);
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
            const rawAdj = coeff * sleepDelta * (targetWeight ?? 100);
            const weightAdj = -snapToPlate(Math.abs(rawAdj), equipment, exType);
            if (weightAdj < -2) {
              targetWeight = snapToPlate((targetWeight ?? 0) + weightAdj, equipment, exType);
              adjustments.push(`Sleep-performance: ${weightAdj} lbs (learned from your data)`);
            }
          }
        }
      }

      // #5: Progression Forecasting — use ML-predicted target if confident
      // Skip forecast overrides during break ramp-back to avoid prescribing pre-break loads
      if (profile.progressionForecasts && breakRampMultiplier >= 1.0) {
        const forecast = profile.progressionForecasts.find(
          f => f.exerciseName === sel.exercise.name.toLowerCase()
        );
        if (forecast && forecast.confidence >= 0.5 && forecast.predictedTargetWeight > 0 && targetWeight != null) {
          const forecastWeight = forecast.predictedTargetWeight;
          if (forecastWeight <= targetWeight * 1.10 && forecastWeight >= targetWeight * 0.90) {
            targetWeight = forecastWeight;
            adjustments.push(`Forecast: ${forecastWeight}lbs (R²=${forecast.confidence.toFixed(2)})`);
          }
        }
      }

      if (profile.bodyWeightTrend.phase === 'cutting' && prog.status !== 'regressing') {
        adjustments.push('Cutting phase: maintaining weight is success');
      }
    } else if (hasLearnedData && pref.learnedWeight != null) {
      // No progression data (< 3 sessions) but learned weight exists
      targetWeight = snapToPlate(pref.learnedWeight, equipment, exType);
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
        targetWeight = snapToPlate(estimated, equipment, exType);
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

    // Warmup baseline: primary compounds only, with anti-redundancy for lower-body barbell work.
    const isCompound = sel.exercise.ml_exercise_type === 'compound';
    const bw = prefs.body_weight_lbs ?? cfg.defaultBodyWeightLbs;
    const relativeLoad = targetWeight != null ? targetWeight / bw : 0;
    const eqNorm = equipment.map(normalizeEquipment);
    const isBarbell = eqNorm.includes('barbell');
    const movementPattern = (sel.exercise.movement_pattern ?? '').toLowerCase();
    const isLowerPattern = movementPattern.includes('squat') || movementPattern.includes('hinge') || movementPattern.includes('lunge');
    const isLowerBody = lowerBodyGroups.has(sel.muscleGroup) || isLowerPattern;

    let needsWarmup = targetWeight != null && targetWeight > 0;
    if (cfg.warmupPrimaryOnly) {
      needsWarmup = needsWarmup && role === 'primary' && isCompound;
    } else {
      needsWarmup = needsWarmup && (
        role === 'primary'
        || (isCompound && relativeLoad >= 0.30)
        || relativeLoad >= 0.50
      );
    }

    if (needsWarmup && cfg.suppressRedundantLowerWarmups && primaryLowerBarbellPrimed && isLowerBody) {
      needsWarmup = false;
      adjustments.push('Warmup skipped: lower-body already primed by earlier primary movement');
    }

    const warmupSets = needsWarmup
      ? generateWarmupRamp(targetWeight!, {
          bodyWeightLbs: prefs.body_weight_lbs,
          equipment,
          exerciseType: sel.exercise.ml_exercise_type,
          role,
        })
      : null;
    if (warmupSets && warmupSets.length > 0 && role === 'primary' && isBarbell && isLowerBody) {
      primaryLowerBarbellPrimed = true;
    }

    const impact = computeImpactScore(sel.exercise, role, goal, secondaryGoal);
    const estMin = estimateExerciseMinutes(sets, restSeconds, role, warmupSets?.length ?? 0, targetReps, tempo);

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
      targetWeight: isBodyweight ? null : (targetWeight ? snapToPlate(targetWeight, equipment, exType) : null),
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
 * Diminishing-returns stimulus curve per additional set.
 *
 * Based on Krieger (2010) meta-analysis: hypertrophy gains per set follow a
 * logarithmic curve, with ~70% of the benefit captured in the first 3 sets.
 * SFR modulates how fast returns diminish — high-SFR exercises (machines,
 * cables) tolerate more volume before returns flatten; low-SFR exercises
 * (heavy compounds) see sharper drop-off.
 *
 * Returns a 0–1 multiplier representing marginal stimulus of the Nth set.
 */
function sfrCurve(currentSets: number, exerciseSFR: number): number {
  const k = 0.18 + (5 - exerciseSFR) * 0.06;
  return Math.exp(-k * currentSets);
}

type MarginalAction =
  | { type: 'add_set'; exerciseIndex: number }
  | { type: 'add_exercise'; exercise: ExerciseSelection };

/**
 * Score a candidate action (add a set to an existing exercise OR add a new
 * exercise) by its marginal training stimulus.
 *
 * Factors:
 *   1. sfrCurve — diminishing returns on additional sets
 *   2. Volume status — muscles below MEV get a priority boost; muscles
 *      approaching MRV get penalised
 *   3. Frequency — muscles trained less frequently this week benefit more
 *      from an extra exercise (variety > volume)
 */
function computeMarginalValue(
  action: MarginalAction,
  currentExercises: GeneratedExercise[],
  volumeStatuses: MuscleVolumeStatus[],
  muscleGroupFrequency: Record<string, number>,
): number {
  if (action.type === 'add_set') {
    const ex = currentExercises[action.exerciseIndex];
    const sfr = getExerciseSFR(ex.exerciseName);
    const stimulus = sfrCurve(ex.sets, sfr);

    const vol = volumeStatuses.find(
      v => v.muscleGroup.toLowerCase() === (ex.targetMuscleGroup ?? '').toLowerCase()
    );
    let volMod = 1.0;
    if (vol) {
      if (vol.status === 'below_mev') volMod = 1.3;
      else if (vol.status === 'in_mev_mav') volMod = 1.0;
      else if (vol.status === 'in_mav') volMod = 0.8;
      else if (vol.status === 'approaching_mrv') volMod = 0.4;
      else if (vol.status === 'above_mrv') volMod = 0.1;
    }

    return stimulus * volMod;
  }

  // add_exercise: value of bringing in a brand-new movement
  const sel = action.exercise;
  const sfr = getExerciseSFR(sel.exercise.name);
  const baseStimulus = sfrCurve(0, sfr);

  const group = (sel.muscleGroup ?? '').toLowerCase();
  const vol = volumeStatuses.find(v => v.muscleGroup.toLowerCase() === group);
  let volMod = 1.0;
  if (vol) {
    if (vol.status === 'below_mev') volMod = 1.5;
    else if (vol.status === 'in_mev_mav') volMod = 1.1;
    else if (vol.status === 'in_mav') volMod = 0.9;
    else if (vol.status === 'approaching_mrv') volMod = 0.5;
    else if (vol.status === 'above_mrv') volMod = 0.15;
  }

  const freq = muscleGroupFrequency[group] ?? 0;
  const freqBonus = freq < 2 ? 1.3 : freq < 3 ? 1.0 : 0.8;

  const alreadyHasGroup = currentExercises.some(
    e => (e.targetMuscleGroup ?? '').toLowerCase() === group
  );
  const varietyBonus = alreadyHasGroup ? 0.7 : 1.2;

  return baseStimulus * volMod * freqBonus * varietyBonus;
}

/**
 * Compute available session time, accounting for weekday deadlines.
 */
function computeAvailableMinutes(prefs: UserPreferences, planningDate?: Date): number {
  const now = new Date();
  const targetDate = planningDate ?? now;
  const dayKey = String(targetDate.getDay());
  const deadline = prefs.weekday_deadlines[dayKey];

  // For future planned days, show full intended budget and let day-of recalc adapt.
  const isFuturePlan = targetDate.toDateString() !== now.toDateString()
    && targetDate.getTime() > now.getTime();
  if (isFuturePlan) return prefs.session_duration_minutes;

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
  cfg: ModelConfig,
  allExercises: EnrichedExercise[] = [],
  existingSelections: ExerciseSelection[] = [],
  recoveryAdj?: RecoveryAdjustment,
  progressionScale: number = 1.0,
  breakRampMultiplier: number = 1.0,
  planningDate?: Date
): GeneratedExercise[] {
  const cardio = exercises.filter(e => e.isCardio);
  const strength = exercises.filter(e => !e.isCardio);

  const orderProfiles = profile.exerciseOrderProfiles ?? [];
  const positionMap = new Map<string, ExerciseOrderProfile>();
  for (const op of orderProfiles) {
    positionMap.set(op.exerciseName, op);
  }

  // Global two-tier ordering (Simão et al. 2012):
  //   Tier 1: ALL compounds, sorted by CNS demand (heaviest first)
  //   Tier 2: ALL isolations, sorted by muscle group priority then CNS demand
  // This guarantees bench press never appears after lateral raises,
  // regardless of which muscle group each belongs to.
  const groupPriority = new Map<string, number>();
  strength.forEach((ex, i) => {
    if (!groupPriority.has(ex.targetMuscleGroup)) groupPriority.set(ex.targetMuscleGroup, i);
  });

  const scored = strength.map(ex => {
    const hist = positionMap.get(ex.exerciseName.toLowerCase());
    const cnsTier = getCnsDemandTier(ex);
    const isCompound = ex.movementPattern === 'compound' || cnsTier <= 2;
    const histNudge = (hist && hist.sessions >= 3) ? hist.avgNormalizedPosition * 2 : 0;
    const gp = groupPriority.get(ex.targetMuscleGroup) ?? 99;
    // Primary: compound tier (0) vs isolation tier (1000)
    // Within compounds: CNS demand (lower = heavier = first)
    // Within isolations: muscle group priority, then CNS demand
    const sortKey = isCompound
      ? cnsTier * 10 + histNudge
      : 1000 + gp * 20 + cnsTier * 5 + histNudge;
    return { exercise: ex, sortKey };
  });

  scored.sort((a, b) => a.sortKey - b.sortKey);
  const ordered: GeneratedExercise[] = scored.map(s => s.exercise);

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

  // #12: Session fatigue — reduce rest for exercises late in the session.
  // The reduction scales with the actual observed performance delta.
  let cumulativeMinutes = 0;
  for (const ex of ordered) {
    cumulativeMinutes += ex.estimatedMinutes;
    if (cumulativeMinutes > 60 && ex.exerciseRole !== 'primary') {
      const fatigueEffect = profile.sessionFatigueEffects.find(
        e => e.positionBucket === '60-90min' && e.dataPoints >= cfg.sessionFatigueMinDataPoints
      );
      if (fatigueEffect && fatigueEffect.avgDelta < -0.03) {
        // Scale rest reduction proportional to how much performance drops
        const restReduction = Math.min(0.25, Math.abs(fatigueEffect.avgDelta) * 2);
        ex.restSeconds = Math.max(30, Math.round(ex.restSeconds * (1 - restReduction)));
      }
    }
  }

  // Time budget: hard ceiling for entire session (strength + cardio + transitions)
  const availableMinutes = computeAvailableMinutes(prefs, planningDate);

  // Session fatigue adjustment
  const lateFatigueEffect = profile.sessionFatigueEffects.find(
    e => e.positionBucket === '90+min' && e.dataPoints >= cfg.sessionFatigueMinDataPoints
  );
  let sessionFatigueAdj = 1.0;
  if (lateFatigueEffect && lateFatigueEffect.avgDelta < cfg.sessionFatigueThreshold) {
    // Scale adjustment proportional to how severe the observed fatigue is
    sessionFatigueAdj = Math.max(0.80, 1.0 + lateFatigueEffect.avgDelta);
  }
  if (prefs.session_duration_minutes >= 120) {
    // Honor explicit long-session user budget; keep fatigue adjustments informational,
    // but do not silently collapse a 120-minute target to ~90.
    sessionFatigueAdj = Math.max(0.95, sessionFatigueAdj);
  }

  const effectiveBudget = Math.round(availableMinutes * sessionFatigueAdj);

  // Helper: recalculate an exercise's time after changing sets or rest
  const recalcTime = (ex: GeneratedExercise) => {
    if (ex.isCardio) {
      ex.estimatedMinutes = (ex.cardioDurationSeconds ?? 1800) / 60 + (TRANSITION_TIME_SEC.cardio / 60);
    } else {
      ex.estimatedMinutes = estimateExerciseMinutes(
        ex.sets, ex.restSeconds, ex.exerciseRole, ex.warmupSets?.length ?? 0,
        ex.targetReps, ex.tempo
      );
    }
  };

  // ── Cardio time enforcement ───────────────────────────────────────────
  // Cardio has HARD CAPS:
  //   1. Per-exercise cap: max of user's historical average * 1.3, prefs, or 45 min
  //   2. Total cardio cap: percentage of session based on goal (never more than 40%)
  // Strength always gets at least 60% of the session.
  const goal = getEffectiveGoal(prefs);
  const maxCardioPct = goal === 'fat_loss' ? cfg.maxCardioPctFatLoss
    : goal === 'endurance' ? cfg.maxCardioPctDefault * 1.15
    : goal === 'strength' ? cfg.maxCardioPctDefault * 0.65
    : cfg.maxCardioPctDefault;
  const maxTotalCardioMin = Math.round(effectiveBudget * maxCardioPct);

  let totalStrengthMin = ordered.reduce((sum, ex) => sum + ex.estimatedMinutes, 0);
  const keptCardio: GeneratedExercise[] = [];

  for (const ex of cardio) {
    // Per-exercise cap: use user's pref or historical average, with a hard ceiling
    const cardioHist = profile.cardioHistory.find(c => c.exerciseName === ex.exerciseName.toLowerCase());
    const prefCardioDur = prefs.cardio_duration_minutes;
    const histAvgMin = cardioHist ? Math.round(cardioHist.avgDurationSeconds / 60) : null;
    const perExerciseCap = Math.min(
      prefCardioDur ?? histAvgMin ?? 30,
      histAvgMin != null ? Math.round(histAvgMin * 1.3) : 45,
      cfg.maxCardioPerExerciseMinutes
    ) * 60; // convert to seconds

    const originalSec = ex.cardioDurationSeconds ?? 1800;
    if (originalSec > perExerciseCap) {
      ex.cardioDurationSeconds = perExerciseCap;
      ex.adjustments.push(`Duration capped: ${Math.round(originalSec / 60)} → ${Math.round(perExerciseCap / 60)} min (per-exercise limit)`);
      recalcTime(ex);
    }
    keptCardio.push(ex);
  }

  // Enforce total cardio cap
  let totalCardioMin = keptCardio.reduce((sum, ex) => sum + ex.estimatedMinutes, 0);
  if (totalCardioMin > maxTotalCardioMin) {
    const scale = maxTotalCardioMin / totalCardioMin;
    const filtered: GeneratedExercise[] = [];
    for (const ex of keptCardio) {
      const scaledSec = Math.round((ex.cardioDurationSeconds ?? 1800) * scale);
      if (scaledSec >= 8 * 60) {
        ex.cardioDurationSeconds = scaledSec;
        ex.adjustments.push(`Duration scaled to ${Math.round(scaledSec / 60)} min (${Math.round(maxCardioPct * 100)}% cardio budget)`);
        recalcTime(ex);
        filtered.push(ex);
      }
    }
    keptCardio.length = 0;
    keptCardio.push(...filtered);
  }
  totalCardioMin = keptCardio.reduce((sum, ex) => sum + ex.estimatedMinutes, 0);

  // ── Strength time enforcement (3-phase) ───────────────────────────────
  // Budget remaining after cardio
  totalCardioMin = keptCardio.reduce((sum, ex) => sum + ex.estimatedMinutes, 0);
  const strengthBudget = Math.max(effectiveBudget - totalCardioMin, cfg.minStrengthBudgetMinutes);
  totalStrengthMin = ordered.reduce((sum, ex) => sum + ex.estimatedMinutes, 0);

  if (totalStrengthMin > strengthBudget) {
    // Phase 1: Compress rest on isolation and secondary exercises proportional to overshoot
    const overshootRatio = totalStrengthMin / strengthBudget;
    const restCompression = Math.min(0.30, (overshootRatio - 1) * 0.5);
    for (const ex of ordered) {
      if (totalStrengthMin <= strengthBudget) break;
      if (ex.exerciseRole === 'isolation' || ex.exerciseRole === 'corrective') {
        const oldRest = ex.restSeconds;
        ex.restSeconds = Math.max(30, Math.round(ex.restSeconds * (1 - restCompression)));
        if (ex.restSeconds < oldRest) {
          const oldMin = ex.estimatedMinutes;
          recalcTime(ex);
          totalStrengthMin -= (oldMin - ex.estimatedMinutes);
          ex.adjustments.push(`Rest compressed: ${oldRest}s → ${ex.restSeconds}s (time budget)`);
        }
      }
    }
  }

  if (totalStrengthMin > strengthBudget) {
    // Phase 2: Reduce sets on non-primary exercises (4→3, 3→2, never below 2)
    const reductionOrder = [...ordered]
      .filter(e => e.exerciseRole !== 'primary')
      .sort((a, b) => (a.impactScore ?? 0) - (b.impactScore ?? 0));

    for (const ex of reductionOrder) {
      if (totalStrengthMin <= strengthBudget) break;
      if (ex.sets > 2) {
        const removeSets = ex.sets > 3 ? 2 : 1;
        const oldSets = ex.sets;
        ex.sets = Math.max(2, ex.sets - removeSets);
        const oldMin = ex.estimatedMinutes;
        recalcTime(ex);
        totalStrengthMin -= (oldMin - ex.estimatedMinutes);
        ex.adjustments.push(`Sets reduced: ${oldSets} → ${ex.sets} (time budget: ${effectiveBudget} min)`);
      }
    }
  }

  if (totalStrengthMin > strengthBudget) {
    // Phase 3: Last resort — drop lowest-impact exercises entirely
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

  // ── Time expansion (unified marginal-value greedy loop) ─────────────
  // Each iteration picks the single highest-value action:
  //   • add 1 set to an existing exercise, OR
  //   • add a brand-new exercise from the pool
  // Stops when remaining time < cost of cheapest action.
  totalStrengthMin = ordered.reduce((sum, ex) => sum + ex.estimatedMinutes, 0);
  totalCardioMin = keptCardio.reduce((sum, ex) => sum + ex.estimatedMinutes, 0);
  let remainingMinutes = effectiveBudget - totalStrengthMin - totalCardioMin;

  const timePerSet = (ex: GeneratedExercise) => ex.estimatedMinutes / Math.max(ex.sets, 1);
  const getMaxSets = (ex: GeneratedExercise): number => {
    const pref = profile.exercisePreferences.find(p => p.exerciseName === ex.exerciseName.toLowerCase());
    if (pref && pref.learnedSets != null && pref.recentSessions >= 2) {
      return Math.min(Math.round(pref.learnedSets) + 1, 8);
    }
    return ex.exerciseRole === 'primary' ? 6 : ex.exerciseRole === 'secondary' ? 5 : 4;
  };

  const volumeStatuses = profile.muscleVolumeStatuses ?? [];
  const mgFreq = profile.muscleGroupFrequency ?? {};

  // Build candidate pool for new exercises
  const usedNames = new Set([
    ...ordered.map(e => e.exerciseName.toLowerCase()),
    ...keptCardio.map(e => e.exerciseName.toLowerCase()),
  ]);
  const avoidSet = new Set(prefs.exercises_to_avoid.map(e => e.toLowerCase()));
  const strengthPool: ExerciseSelection[] = (allExercises || [])
    .filter(ex =>
      ex.ml_exercise_type !== 'cardio'
      && ex.ml_exercise_type !== 'recovery'
      && !usedNames.has(ex.name.toLowerCase())
      && !avoidSet.has(ex.name.toLowerCase())
      && !isInjuryConflict(ex, prefs.injuries)
    )
    .map(ex => {
      const primaryGroups = (Array.isArray(ex.primary_muscles) ? ex.primary_muscles : [])
        .map(m => MUSCLE_HEAD_TO_GROUP[m]).filter(Boolean);
      return {
        exercise: ex,
        muscleGroup: primaryGroups[0] || 'other',
        sets: 0,
        reason: 'time_expansion',
      };
    });

  const effectiveGoal = getEffectiveGoal(prefs);
  const secondaryGoal = prefs.secondary_goal;
  let addedNewCount = 0;
  const maxNewExercises = 6;
  const MAX_ITERATIONS = 40;
  const targetUnfilledMinutes = effectiveBudget >= 100 ? 4 : 6;

  for (let iter = 0; iter < MAX_ITERATIONS && remainingMinutes >= 3; iter++) {
    let bestValue = -1;
    let bestAction: MarginalAction | null = null;
    let bestTimeCost = Infinity;

    // Score: add 1 set to each existing exercise
    for (let i = 0; i < ordered.length; i++) {
      const ex = ordered[i];
      if (ex.sets >= getMaxSets(ex)) continue;
      const cost = timePerSet(ex);
      if (cost > remainingMinutes) continue;
      const action: MarginalAction = { type: 'add_set', exerciseIndex: i };
      const val = computeMarginalValue(action, ordered, volumeStatuses, mgFreq);
      if (val > bestValue) {
        bestValue = val;
        bestAction = action;
        bestTimeCost = cost;
      }
    }

    // Score: add each candidate new exercise (only if >= 5 min left and under cap)
    if (remainingMinutes >= 5 && addedNewCount < maxNewExercises) {
      for (const sel of strengthPool) {
        if (usedNames.has(sel.exercise.name.toLowerCase())) continue;
        const role: ExerciseRole = sel.exercise.ml_exercise_type === 'compound' ? 'secondary' : 'isolation';
        const sets = role === 'secondary' ? 3 : 2;
        const rest = getRestByExercise(sel.exercise, role, effectiveGoal);
        const tableRange = getRepRangeByRole(role, effectiveGoal, secondaryGoal);
        const reps = tableRange.target;
        const tempo = getTempo(sel.exercise.default_tempo, effectiveGoal, sel.exercise.ml_exercise_type);
        const cost = estimateExerciseMinutes(sets, rest, role, 0, reps, tempo);
        if (cost > remainingMinutes) continue;
        const action: MarginalAction = { type: 'add_exercise', exercise: sel };
        const val = computeMarginalValue(action, ordered, volumeStatuses, mgFreq);
        if (val > bestValue) {
          bestValue = val;
          bestAction = action;
          bestTimeCost = cost;
        }
      }
    }

    if (!bestAction || bestTimeCost > remainingMinutes) break;

    // Execute the winning action
    if (bestAction.type === 'add_set') {
      const ex = ordered[bestAction.exerciseIndex];
      const oldSets = ex.sets;
      ex.sets += 1;
      const oldMin = ex.estimatedMinutes;
      recalcTime(ex);
      remainingMinutes -= (ex.estimatedMinutes - oldMin);
      ex.adjustments.push(`Sets expanded: ${oldSets} → ${ex.sets} (marginal value: ${bestValue.toFixed(2)})`);
    } else {
      const sel = bestAction.exercise;
      const role: ExerciseRole = sel.exercise.ml_exercise_type === 'compound' ? 'secondary' : 'isolation';
      const tableRange = getRepRangeByRole(role, effectiveGoal, secondaryGoal);
      const pref = profile.exercisePreferences.find(p => p.exerciseName === sel.exercise.name.toLowerCase());
      const reps = pref?.learnedReps ? Math.round(pref.learnedReps) : tableRange.target;
      const sets = pref?.learnedSets ? Math.min(Math.round(pref.learnedSets), 4) : (role === 'secondary' ? 3 : 2);
      const rest = pref?.learnedRestSeconds ?? getRestByExercise(sel.exercise, role, effectiveGoal);
      const tempo = getTempo(sel.exercise.default_tempo, effectiveGoal, sel.exercise.ml_exercise_type);
      const equipment = Array.isArray(sel.exercise.equipment) ? sel.exercise.equipment : [];
      const fillExType = sel.exercise.ml_exercise_type ?? inferExerciseType(sel.exercise);
      const isBodyweight = equipment.length === 1 && equipment[0] === 'bodyweight';
      const rir = getRirTarget(role, effectiveGoal, false);

      let targetWeight: number | null = null;
      const prog = profile.exerciseProgressions.find(p => p.exerciseName === sel.exercise.name.toLowerCase());
      if (prog) {
        targetWeight = weightForReps(prog.estimated1RM, reps, rir, equipment, fillExType);
        if (targetWeight < prog.lastWeight * 0.5 && prog.lastWeight > 0) {
          targetWeight = snapToPlate(prog.lastWeight * 0.75, equipment, fillExType);
        }
      } else if (pref?.learnedWeight != null) {
        targetWeight = snapToPlate(pref.learnedWeight, equipment, fillExType);
      }
      const estMin = estimateExerciseMinutes(sets, rest, role, 0, reps, tempo);

      const newEx: GeneratedExercise = {
        exerciseName: sel.exercise.name,
        exerciseLibraryId: sel.exercise.id,
        bodyPart: sel.exercise.body_part,
        primaryMuscles: Array.isArray(sel.exercise.primary_muscles) ? sel.exercise.primary_muscles : [],
        secondaryMuscles: Array.isArray(sel.exercise.secondary_muscles) ? sel.exercise.secondary_muscles : [],
        movementPattern: sel.exercise.movement_pattern ?? 'unknown',
        targetMuscleGroup: sel.muscleGroup,
        exerciseRole: role,
        sets,
        targetReps: reps,
        targetWeight: isBodyweight ? null : (targetWeight ? snapToPlate(targetWeight, equipment, fillExType) : null),
        targetRir: rir,
        rirLabel: getRirLabel(rir),
        isBodyweight,
        tempo,
        restSeconds: rest,
        rationale: `Added to fill ${prefs.session_duration_minutes} min session (marginal value: ${bestValue.toFixed(2)})`,
        adjustments: [`Time expansion: added for ${sel.muscleGroup.replace(/_/g, ' ')} (value: ${bestValue.toFixed(2)})`],
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
        impactScore: computeImpactScore(sel.exercise, role, effectiveGoal, secondaryGoal),
        estimatedMinutes: estMin,
      };

      ordered.push(newEx);
      usedNames.add(sel.exercise.name.toLowerCase());
      remainingMinutes -= estMin;
      addedNewCount++;
    }
  }

  // ── Time-bank fill pass ────────────────────────────────────────────────
  // Long sessions should land close to the requested budget.
  // After the value-greedy loop finishes, use a bounded fill pass to reduce
  // leftover time to a tight window (especially for 120-minute sessions).
  for (let iter = 0; iter < 20 && remainingMinutes > targetUnfilledMinutes; iter++) {
    type FillAction =
      | { type: 'add_set'; exerciseIndex: number; cost: number; projected: number; score: number }
      | { type: 'add_micro_exercise'; exercise: ExerciseSelection; cost: number; projected: number; score: number };

    let bestFill: FillAction | null = null;

    for (let i = 0; i < ordered.length; i++) {
      const ex = ordered[i];
      if (ex.isCardio) continue;
      const hardCap = ex.exerciseRole === 'primary'
        ? Math.max(getMaxSets(ex), 7)
        : Math.max(getMaxSets(ex), 5);
      if (ex.sets >= hardCap) continue;
      const cost = timePerSet(ex);
      if (cost <= 0 || cost > remainingMinutes) continue;
      const projected = remainingMinutes - cost;
      const score = Math.abs(projected - targetUnfilledMinutes);
      if (!bestFill || score < bestFill.score) {
        bestFill = { type: 'add_set', exerciseIndex: i, cost, projected, score };
      }
    }

    if (remainingMinutes >= 3 && addedNewCount < (maxNewExercises + 2)) {
      for (const sel of strengthPool) {
        if (usedNames.has(sel.exercise.name.toLowerCase())) continue;
        const role: ExerciseRole = sel.exercise.ml_exercise_type === 'compound' ? 'secondary' : 'isolation';
        const rest = getRestByExercise(sel.exercise, role, effectiveGoal);
        const tableRange = getRepRangeByRole(role, effectiveGoal, secondaryGoal);
        const reps = tableRange.target;
        const tempo = getTempo(sel.exercise.default_tempo, effectiveGoal, sel.exercise.ml_exercise_type);
        const cost = estimateExerciseMinutes(1, rest, role, 0, reps, tempo);
        if (cost > remainingMinutes) continue;
        const projected = remainingMinutes - cost;
        // Small bias toward filling with existing exercises before adding new.
        const score = Math.abs(projected - targetUnfilledMinutes) + 0.2;
        if (!bestFill || score < bestFill.score) {
          bestFill = { type: 'add_micro_exercise', exercise: sel, cost, projected, score };
        }
      }
    }

    if (!bestFill) break;

    if (bestFill.type === 'add_set') {
      const ex = ordered[bestFill.exerciseIndex];
      const oldSets = ex.sets;
      const oldMin = ex.estimatedMinutes;
      ex.sets += 1;
      recalcTime(ex);
      remainingMinutes -= (ex.estimatedMinutes - oldMin);
      ex.adjustments.push(`Time-bank fill: ${oldSets} → ${ex.sets} sets (target slack ≤ ${targetUnfilledMinutes} min)`);
    } else {
      const sel = bestFill.exercise;
      const role: ExerciseRole = sel.exercise.ml_exercise_type === 'compound' ? 'secondary' : 'isolation';
      const tableRange = getRepRangeByRole(role, effectiveGoal, secondaryGoal);
      const pref = profile.exercisePreferences.find(p => p.exerciseName === sel.exercise.name.toLowerCase());
      const reps = pref?.learnedReps ? Math.round(pref.learnedReps) : tableRange.target;
      const sets = 1;
      const rest = pref?.learnedRestSeconds ?? getRestByExercise(sel.exercise, role, effectiveGoal);
      const tempo = getTempo(sel.exercise.default_tempo, effectiveGoal, sel.exercise.ml_exercise_type);
      const equipment = Array.isArray(sel.exercise.equipment) ? sel.exercise.equipment : [];
      const fillExType = sel.exercise.ml_exercise_type ?? inferExerciseType(sel.exercise);
      const isBodyweight = equipment.length === 1 && equipment[0] === 'bodyweight';
      const rir = getRirTarget(role, effectiveGoal, false);

      let targetWeight: number | null = null;
      const prog = profile.exerciseProgressions.find(p => p.exerciseName === sel.exercise.name.toLowerCase());
      if (prog) {
        targetWeight = weightForReps(prog.estimated1RM, reps, rir, equipment, fillExType);
        if (targetWeight < prog.lastWeight * 0.5 && prog.lastWeight > 0) {
          targetWeight = snapToPlate(prog.lastWeight * 0.75, equipment, fillExType);
        }
      } else if (pref?.learnedWeight != null) {
        targetWeight = snapToPlate(pref.learnedWeight, equipment, fillExType);
      }
      const estMin = estimateExerciseMinutes(sets, rest, role, 0, reps, tempo);

      const newEx: GeneratedExercise = {
        exerciseName: sel.exercise.name,
        exerciseLibraryId: sel.exercise.id,
        bodyPart: sel.exercise.body_part,
        primaryMuscles: Array.isArray(sel.exercise.primary_muscles) ? sel.exercise.primary_muscles : [],
        secondaryMuscles: Array.isArray(sel.exercise.secondary_muscles) ? sel.exercise.secondary_muscles : [],
        movementPattern: sel.exercise.movement_pattern ?? 'unknown',
        targetMuscleGroup: sel.muscleGroup,
        exerciseRole: role,
        sets,
        targetReps: reps,
        targetWeight: isBodyweight ? null : (targetWeight ? snapToPlate(targetWeight, equipment, fillExType) : null),
        targetRir: rir,
        rirLabel: getRirLabel(rir),
        isBodyweight,
        tempo,
        restSeconds: rest,
        rationale: `Added to tighten time-bank utilization for ${prefs.session_duration_minutes} min session`,
        adjustments: [`Time-bank fill: added 1 set for ${sel.muscleGroup.replace(/_/g, ' ')} (target slack ≤ ${targetUnfilledMinutes} min)`],
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
        impactScore: computeImpactScore(sel.exercise, role, effectiveGoal, secondaryGoal),
        estimatedMinutes: estMin,
      };

      ordered.push(newEx);
      usedNames.add(sel.exercise.name.toLowerCase());
      remainingMinutes -= estMin;
      addedNewCount++;
    }
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
  exerciseDecisions: ExerciseDecision[],
  planningDate?: Date
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

  const todayDow = (planningDate ?? new Date()).getDay();
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

  const availMin = computeAvailableMinutes(prefs, planningDate);
  const timeNote = availMin < prefs.session_duration_minutes
    ? `Time-constrained: ${availMin} min available (deadline active)`
    : `Session budget: ${prefs.session_duration_minutes} min`;

  const objectiveUtility = {
    version: profile.canonicalModelContext?.version ?? 'utility_v1',
    adherenceScore: profile.canonicalModelContext?.adherenceScore ?? profile.prescribedVsActual?.complianceRate ?? 0.5,
    progressionScore: profile.canonicalModelContext?.progressionScore ?? 0.5,
    sessionFitScore: profile.canonicalModelContext?.sessionFitScore ?? 0.5,
    utility: profile.canonicalModelContext?.objectiveUtility ?? 0.5,
  };

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
    `Objective utility (${objectiveUtility.version}): ${(objectiveUtility.utility * 100).toFixed(0)} (adh ${(objectiveUtility.adherenceScore * 100).toFixed(0)}, prog ${(objectiveUtility.progressionScore * 100).toFixed(0)}, fit ${(objectiveUtility.sessionFitScore * 100).toFixed(0)})`,
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
      `Duration budget: ${prefs.session_duration_minutes} min → max ${prefs.session_duration_minutes <= 35 ? 2 : prefs.session_duration_minutes <= 50 ? 3 : prefs.session_duration_minutes <= 75 ? 4 : prefs.session_duration_minutes <= 100 ? 5 : 6} muscle groups`,
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
    trendLine('Top Lifts Total', t.big3Total, 'lbs'),
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

  // ML Intelligence summary
  const mlDetails: string[] = ['— ML Intelligence —'];
  if (profile.hrvIntensityModifier && profile.hrvIntensityModifier.intensityMultiplier !== 1.0) {
    mlDetails.push(`HRV Gate: ${profile.hrvIntensityModifier.recommendation} (×${profile.hrvIntensityModifier.intensityMultiplier})`);
  }
  if (profile.sleepVolumeModifier?.lastNightSleepQuality) {
    mlDetails.push(`Sleep: ${profile.sleepVolumeModifier.lastNightSleepQuality} — vol ×${profile.sleepVolumeModifier.volumeMultiplier}, rest ×${profile.sleepVolumeModifier.restTimeMultiplier}`);
  }
  if (profile.exerciseSwapHistory && profile.exerciseSwapHistory.length > 0) {
    const rejected = profile.exerciseSwapHistory.filter(s => s.swapCount >= 3);
    if (rejected.length > 0) {
      mlDetails.push(`Swap learning: ${rejected.map(r => r.exerciseName).join(', ')} excluded (≥3 swaps)`);
    }
  }
  if (profile.prescribedVsActual && profile.prescribedVsActual.complianceRate < 1) {
    mlDetails.push(`Compliance: ${Math.round(profile.prescribedVsActual.complianceRate * 100)}% exercises completed`);
  }
  // Sport-specific context
  const sportCtx = getSportProfile(prefs.sport_focus);
  if (sportCtx) {
    const seasonLabel = prefs.sport_season ? prefs.sport_season.replace('_', '-') : 'no season set';
    const seasonMod = prefs.sport_season ? sportCtx.seasonModifiers[prefs.sport_season] : null;
    mlDetails.push(`Sport: ${sportCtx.label} (${seasonLabel})`);
    if (seasonMod) {
      mlDetails.push(`  Volume ×${seasonMod.volumeMultiplier}, prehab ${Math.round(seasonMod.prehabFrequency * 100)}% chance — ${seasonMod.description}`);
    }
    const boosted = exerciseDecisions
      .filter(d => d.factors.some(f => f.startsWith(sportCtx.label)))
      .map(d => d.exerciseName);
    if (boosted.length > 0) {
      mlDetails.push(`  Boosted: ${boosted.join(', ')}`);
    }
  }

  if (mlDetails.length > 1) {
    decisionLog.push({
      step: '8',
      label: 'ML Intelligence',
      details: mlDetails,
    });
  }

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
    date: planningDate ? getLocalDate(planningDate) : getLocalDate(),
    featureSnapshotId: profile.featureSnapshotId,
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
    objectiveUtility,
  };
}

// ─── Main Entry Point ───────────────────────────────────────────────────────

export interface SessionOverrides {
  durationMinutes?: number;
  finishByTime?: string; // "HH:MM"
  goalOverride?: string;
  gymProfile?: string;
  planningDate?: string; // YYYY-MM-DD for weekly planning
  avoidExerciseNames?: string[];
}

interface LlmHints {
  avoidExercises: string[];
  preferExercises: string[];
  reduceVolumeGroups: string[];
  increaseVolumeGroups: string[];
  raw: Array<{ pattern: string; suggestion: string }>;
}

function parseLlmPatternObservations(
  observations: Array<{ pattern: string; suggestion: string; confidence: string }> | undefined
): LlmHints {
  const hints: LlmHints = { avoidExercises: [], preferExercises: [], reduceVolumeGroups: [], increaseVolumeGroups: [], raw: [] };
  if (!observations?.length) return hints;
  for (const obs of observations) {
    const s = (obs.suggestion ?? '').toLowerCase();
    hints.raw.push({ pattern: obs.pattern, suggestion: obs.suggestion });
    if (s.includes('avoid') || s.includes('remove') || s.includes('swap out') || s.includes('stop')) {
      const match = s.match(/(?:avoid|remove|swap out|stop)\s+(?:using\s+)?(.+?)(?:\s*[-—]|\.|$)/);
      if (match) hints.avoidExercises.push(match[1].trim());
    }
    if (s.includes('add') || s.includes('consider') || s.includes('default to') || s.includes('prefer')) {
      const match = s.match(/(?:add|consider|default to|prefer)\s+(.+?)(?:\s*[-—]|\.|$)/);
      if (match) hints.preferExercises.push(match[1].trim());
    }
    if (s.includes('reduce') && s.includes('volume')) {
      const match = s.match(/reduce\s+(?:\w+\s+)?volume\s+(?:for\s+|on\s+)?(\w+)/);
      if (match) hints.reduceVolumeGroups.push(match[1].trim());
    }
    if (s.includes('increase') && s.includes('volume')) {
      const match = s.match(/increase\s+(?:\w+\s+)?volume\s+(?:for\s+|on\s+)?(\w+)/);
      if (match) hints.increaseVolumeGroups.push(match[1].trim());
    }
  }
  return hints;
}

/**
 * Post-generation validation and auto-correction.
 *
 * Runs a series of rule-based checks on the generated workout and fixes
 * violations in-place. Every correction is logged to the exercise's
 * `adjustments` array so the decision tree UI can surface it.
 */
function validateAndCorrect(
  exercises: GeneratedExercise[],
  profile: TrainingProfile,
  sessionBudgetMin: number,
): GeneratedExercise[] {
  const corrections: string[] = [];

  // Check B4.2: per-exercise set cap (weeklyTarget / frequency)
  for (const ex of exercises) {
    if (ex.isCardio) continue;
    const group = (ex.targetMuscleGroup ?? '').toLowerCase();
    const freq = (profile.muscleGroupFrequency ?? {})[group] ?? 2;
    const vol = (profile.muscleVolumeStatuses ?? []).find(
      v => v.muscleGroup.toLowerCase() === group
    );
    const weeklyTarget = vol ? vol.mavHigh : 12;
    const perSessionCap = Math.max(3, Math.ceil(weeklyTarget / Math.max(freq, 1)));
    if (ex.sets > perSessionCap) {
      const old = ex.sets;
      ex.sets = perSessionCap;
      ex.adjustments.push(`Sets capped: ${old} → ${perSessionCap} (${weeklyTarget} weekly / ${freq.toFixed(1)}x freq)`);
      corrections.push(`${ex.exerciseName}: ${old} → ${perSessionCap} sets`);
    }
  }

  // Check B4.3: compounds after isolations — re-sort
  const strengthExs = exercises.filter(e => !e.isCardio);
  let hasOrderViolation = false;
  let lastCompoundIdx = -1;
  let firstIsolationIdx = strengthExs.length;
  for (let i = 0; i < strengthExs.length; i++) {
    const cnsTier = getCnsDemandTier(strengthExs[i]);
    const isCompound = strengthExs[i].movementPattern === 'compound' || cnsTier <= 2;
    if (isCompound) lastCompoundIdx = i;
    if (!isCompound && i < firstIsolationIdx) firstIsolationIdx = i;
  }
  if (lastCompoundIdx > firstIsolationIdx) {
    hasOrderViolation = true;
    const compounds = strengthExs.filter(e => {
      const t = getCnsDemandTier(e);
      return e.movementPattern === 'compound' || t <= 2;
    });
    const isolations = strengthExs.filter(e => {
      const t = getCnsDemandTier(e);
      return e.movementPattern !== 'compound' && t > 2;
    });
    compounds.sort((a, b) => getCnsDemandTier(a) - getCnsDemandTier(b));
    const reordered = [...compounds, ...isolations];
    const cardioExs = exercises.filter(e => e.isCardio);
    exercises.length = 0;
    exercises.push(...reordered, ...cardioExs);
    corrections.push('Re-sorted: compounds moved before isolations');
  }

  // Check B4.4: single exercise > 40% of total working sets
  const totalSets = exercises.filter(e => !e.isCardio).reduce((s, e) => s + e.sets, 0);
  if (totalSets > 0) {
    for (const ex of exercises) {
      if (ex.isCardio) continue;
      const pct = ex.sets / totalSets;
      if (pct > 0.4 && ex.sets > 3) {
        const maxAllowed = Math.max(3, Math.floor(totalSets * 0.4));
        if (ex.sets > maxAllowed) {
          const old = ex.sets;
          ex.sets = maxAllowed;
          ex.adjustments.push(`Sets reduced: ${old} → ${maxAllowed} (was ${Math.round(pct * 100)}% of total volume)`);
          corrections.push(`${ex.exerciseName}: ${old} → ${maxAllowed} sets (>40% cap)`);
        }
      }
    }
  }

  // Check B4.5: total time vs session budget (±20%)
  const recalc = (e: GeneratedExercise) => {
    if (e.isCardio) {
      e.estimatedMinutes = (e.cardioDurationSeconds ?? 1800) / 60 + (TRANSITION_TIME_SEC.cardio / 60);
    } else {
      e.estimatedMinutes = estimateExerciseMinutes(
        e.sets, e.restSeconds, e.exerciseRole, e.warmupSets?.length ?? 0,
        e.targetReps, e.tempo
      );
    }
  };
  exercises.forEach(recalc);
  let totalMin = exercises.reduce((s, e) => s + e.estimatedMinutes, 0);

  if (totalMin > sessionBudgetMin * 1.2) {
    const nonPrimary = exercises
      .filter(e => !e.isCardio && e.exerciseRole !== 'primary')
      .sort((a, b) => (a.impactScore ?? 0) - (b.impactScore ?? 0));
    for (const ex of nonPrimary) {
      if (totalMin <= sessionBudgetMin * 1.1) break;
      if (ex.sets > 2) {
        const old = ex.sets;
        ex.sets = Math.max(2, ex.sets - 1);
        recalc(ex);
        totalMin = exercises.reduce((s, e) => s + e.estimatedMinutes, 0);
        ex.adjustments.push(`Validation trim: ${old} → ${ex.sets} sets (over time budget)`);
        corrections.push(`${ex.exerciseName}: trimmed to fit budget`);
      }
    }
  }

  return exercises;
}

export async function generateWorkout(
  profile: TrainingProfile,
  overrides?: SessionOverrides
): Promise<GeneratedWorkout> {
  const planningDate = overrides?.planningDate ? new Date(`${overrides.planningDate}T12:00:00`) : new Date();
  const planningDow = planningDate.getDay();

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
  } else {
    // Keep duration as canonical unless a finish-by deadline is explicitly requested
    // for this generation run.
    prefs.weekday_deadlines = {};
  }
  if (overrides?.gymProfile) {
    prefs.active_gym_profile = overrides.gymProfile;
  }
  if (Array.isArray(overrides?.avoidExerciseNames) && overrides.avoidExerciseNames.length > 0) {
    const existing = new Set((prefs.exercises_to_avoid ?? []).map(e => e.toLowerCase()));
    for (const name of overrides.avoidExerciseNames) {
      const n = String(name || '').trim().toLowerCase();
      if (n && !existing.has(n)) {
        prefs.exercises_to_avoid.push(n);
      }
    }
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

  // Age-based volume and progression adjustment
  // MRV decreases ~0.5% per year past 30 (Häkkinen et al., 2001; Ahtiainen et al., 2016)
  // Progression rate slows ~1% per year past 30 (recovery-limited)
  const userAge = prefs.age;
  let ageVolumeScale = 1.0;
  let ageProgressionScale = 1.0;
  if (userAge != null && userAge > 0) {
    if (userAge <= 25) {
      ageVolumeScale = 1.05;      // youth tolerance bonus
      ageProgressionScale = 1.08;  // faster novice adaptation
    } else if (userAge > 30) {
      const yearsOver30 = userAge - 30;
      ageVolumeScale = Math.max(0.80, 1.0 - yearsOver30 * 0.005);
      ageProgressionScale = Math.max(0.75, 1.0 - yearsOver30 * 0.008);
    }
  }

  // Return-from-break detection: auto-deload after extended time off
  const daysSinceLastWorkout = profile.exercisePreferences.length > 0
    ? Math.min(...profile.exercisePreferences.map(p => p.lastUsedDaysAgo))
    : Infinity;

  // Break ramp: continuous function based on days off.
  // Detraining begins around day 7 (Mujika & Padilla 2000).
  // Longer breaks need more conservative ramp-back.
  let breakRampMultiplier = 1.0;
  if (daysSinceLastWorkout >= 7) {
    // Continuous: 7d → ~0.85, 14d → ~0.60, 21d → ~0.50
    breakRampMultiplier = Math.max(0.45, 1.0 - (daysSinceLastWorkout - 5) * 0.028);
  }

  // Step 1: Recovery check
  const recoveryAdj = stepRecoveryCheck(profile, cfg);

  // #7: Apply experience-level volume scaling to recovery adjustment
  recoveryAdj.volumeMultiplier *= expVolumeScale * ageVolumeScale;
  recoveryAdj.volumeMultiplier = Math.max(cfg.volumeMultiplierFloor, recoveryAdj.volumeMultiplier);
  if (expVolumeScale !== 1.0) {
    recoveryAdj.adjustmentReasons.push(`Experience (${expLevel}): volume ×${expVolumeScale}`);
  }
  if (ageVolumeScale !== 1.0 && userAge != null) {
    recoveryAdj.adjustmentReasons.push(`Age (${userAge}): volume ×${ageVolumeScale.toFixed(2)}, progression ×${ageProgressionScale.toFixed(2)}`);
  }

  if (breakRampMultiplier < 1.0) {
    recoveryAdj.volumeMultiplier *= breakRampMultiplier;
    recoveryAdj.adjustmentReasons.push(`Return from ${daysSinceLastWorkout}d break: volume ×${breakRampMultiplier} (ramp-back protocol)`);
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

  // Sport-specific season adjustments
  const sportProfile = getSportProfile(prefs.sport_focus);
  if (sportProfile && prefs.sport_season) {
    const season = sportProfile.seasonModifiers[prefs.sport_season];
    if (season) {
      recoveryAdj.volumeMultiplier *= season.volumeMultiplier;
      recoveryAdj.adjustmentReasons.push(`${sportProfile.label} (${prefs.sport_season.replace('_', '-')}): volume ×${season.volumeMultiplier}, ${season.description}`);
    }
  }

  // Step 2: Select muscle groups
  const { selected: muscleGroups, skipped: skippedGroups } = stepSelectMuscleGroups(profile, prefs, recoveryAdj, cfg, caloricPhaseScale, planningDow);

  // Parse LLM pattern observations into actionable hints
  const llmHints = parseLlmPatternObservations(profile.llmPatternObservations);
  if (llmHints.avoidExercises.length > 0) {
    const existing = new Set(prefs.exercises_to_avoid.map(e => e.toLowerCase()));
    for (const name of llmHints.avoidExercises) {
      if (!existing.has(name.toLowerCase())) prefs.exercises_to_avoid.push(name);
    }
  }

  // Step 3: Select exercises
  const { selections: exerciseSelections, decisions: exerciseDecisions } = stepSelectExercises(muscleGroups, allExercises, profile, prefs, cfg);

  // Sport prehab injection — add 1 prehab exercise per session when sport focus is set
  if (sportProfile && prefs.sport_season) {
    const season = sportProfile.seasonModifiers[prefs.sport_season];
    if (season && Math.random() < season.prehabFrequency && sportProfile.prehabExercises.length > 0) {
      const usedNames = new Set(exerciseSelections.map(s => s.exercise.name.toLowerCase()));
      const available = sportProfile.prehabExercises.filter(p => !usedNames.has(p.exerciseName));
      if (available.length > 0) {
        const pick = available[Math.floor(Math.random() * available.length)];
        const prehabEx = allExercises.find(e => e.name.toLowerCase() === pick.exerciseName);
        if (prehabEx) {
          exerciseSelections.push({
            exercise: prehabEx,
            muscleGroup: 'core',
            sets: pick.sets,
            reason: `${sportProfile.label} prehab: ${pick.reason}`,
            isCardio: false,
          });
        }
      }
    }
  }

  // Step 4: Prescribe sets/reps/weight/tempo
  const prescribed = stepPrescribe(exerciseSelections, profile, prefs, recoveryAdj, cfg, expProgressionScale * ageProgressionScale, breakRampMultiplier);

  // Step 5: Apply session constraints (pass exercise pool + selections for expansion)
  const constrained = stepApplyConstraints(
    prescribed,
    prefs,
    profile,
    cfg,
    allExercises,
    exerciseSelections,
    recoveryAdj,
    expProgressionScale * ageProgressionScale,
    breakRampMultiplier,
    planningDate
  );

  // Step 5b: Post-generation validation — catch absurd prescriptions
  const validated = validateAndCorrect(constrained, profile, prefs.session_duration_minutes);

  // Step 6: Generate rationale + decision log
  const workout = stepGenerateRationale(validated, muscleGroups, recoveryAdj, profile, prefs, skippedGroups, exerciseDecisions, planningDate);

  return workout;
}

// ─── Week Preview ────────────────────────────────────────────────────────

export interface DayPreview {
  dayOfWeek: number;        // 0=Sun
  dayName: string;
  isRestDay: boolean;
  isCompleted?: boolean;    // Today's workout already done
  focus: string;            // e.g. "Push" or "Upper" or "Chest, Triceps"
  muscleGroups: string[];
  estimatedExercises: number;
  estimatedMinutes: number;
  isToday: boolean;
}

export interface WeeklyPlanDay {
  planDate: string;
  dayOfWeek: number;
  dayName: string;
  dayStatus?: 'planned' | 'adapted' | 'completed' | 'skipped';
  isRestDay: boolean;
  focus: string;
  muscleGroups: string[];
  plannedWorkout: GeneratedWorkout | null;
  actualWorkoutId?: string | null;
  actualWorkout?: any | null;
  estimatedExercises: number;
  estimatedMinutes: number;
  llmVerdict?: 'pass' | 'minor_issues' | 'major_issues' | 'pending';
  llmCorrections?: Array<{ exerciseName: string; issue: string; fix: string; newValue: number | null; reason: string }>;
}

export interface WeeklyPlanDiff {
  planDate: string;
  reasonCodes: string[];
  beforeWorkout: GeneratedWorkout | null;
  afterWorkout: GeneratedWorkout | null;
  diffSummary: {
    exerciseCountDelta: number;
    estimatedMinutesDelta: number;
    changedExercises: string[];
  };
}

export interface WeeklyPlan {
  weekStartDate: string;
  featureSnapshotId: string;
  days: WeeklyPlanDay[];
}

function getWeekDatesMondaySunday(baseDate: Date): string[] {
  const anchor = new Date(baseDate);
  const dow = anchor.getDay(); // 0=Sun
  const shiftToMonday = dow === 0 ? -6 : 1 - dow;
  anchor.setDate(anchor.getDate() + shiftToMonday);
  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(anchor);
    d.setDate(anchor.getDate() + i);
    days.push(getLocalDate(d));
  }
  return days;
}

export async function generateWeeklyPlan(
  profile: TrainingProfile,
  userRestDays: number[] = []
): Promise<WeeklyPlan> {
  const weekDates = getWeekDatesMondaySunday(new Date());
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const preview = generateWeekPreview(profile, userRestDays, false);
  const previewByDow = new Map<number, DayPreview>(preview.map(p => [p.dayOfWeek, p]));
  const restSet = new Set(userRestDays);

  const days: WeeklyPlanDay[] = [];
  const normalizeExerciseName = (name: string): string =>
    String(name || '').trim().toLowerCase();
  const exerciseNameSet = (w: GeneratedWorkout | null): Set<string> =>
    new Set((w?.exercises ?? []).filter(ex => !ex.isCardio).map(ex => normalizeExerciseName(ex.exerciseName)).filter(Boolean));
  const overlapRatio = (a: Set<string>, b: Set<string>): number => {
    if (a.size === 0 && b.size === 0) return 0;
    let overlap = 0;
    for (const x of a) if (b.has(x)) overlap++;
    return overlap / Math.max(a.size, b.size, 1);
  };
  const getRecentTrainingDays = (count: number): WeeklyPlanDay[] =>
    days.filter(d => !d.isRestDay && !!d.plannedWorkout).slice(-count);
  const workoutSignature = (w: GeneratedWorkout | null): string => {
    if (!w) return 'rest';
    return (w.exercises ?? [])
      .map(ex => `${ex.exerciseName}|${ex.sets}|${ex.targetReps}|${ex.targetWeight ?? 'bw'}|${ex.isCardio ? ex.cardioDurationSeconds ?? 0 : 0}`)
      .join(';;');
  };
  let prevTrainingSignature: string | null = null;
  for (const planDate of weekDates) {
    const d = new Date(`${planDate}T12:00:00`);
    const dow = d.getDay();
    const p = previewByDow.get(dow);
    const isRest = restSet.size > 0 ? restSet.has(dow) : !!p?.isRestDay;
    if (isRest) {
      days.push({
        planDate,
        dayOfWeek: dow,
        dayName: dayNames[dow],
        dayStatus: 'planned',
        isRestDay: true,
        focus: 'Rest',
        muscleGroups: [],
        plannedWorkout: null,
        estimatedExercises: 0,
        estimatedMinutes: 0,
        llmVerdict: 'pending',
      });
      continue;
    }
    const recentTrainingDays = getRecentTrainingDays(2);
    const recentSignatures = new Set(recentTrainingDays.map(d0 => workoutSignature(d0.plannedWorkout)));
    const recentExerciseNames = new Set<string>();
    for (const prevDay of recentTrainingDays) {
      for (const n of exerciseNameSet(prevDay.plannedWorkout)) recentExerciseNames.add(n);
    }

    let plannedWorkout = await generateWorkout(profile, { planningDate: planDate });
    let signature = workoutSignature(plannedWorkout);

    // Strong diversification pass:
    // - avoid exact signature matches with prior training days
    // - avoid high overlap with the immediately previous day
    // - widen avoid-list progressively when necessary
    const MAX_DIVERSIFY_ATTEMPTS = 3;
    let attempt = 0;
    while (attempt < MAX_DIVERSIFY_ATTEMPTS) {
      const prevWorkout = recentTrainingDays.length > 0 ? recentTrainingDays[recentTrainingDays.length - 1].plannedWorkout : null;
      const prevNameSet = exerciseNameSet(prevWorkout);
      const currNameSet = exerciseNameSet(plannedWorkout);
      const overlap = overlapRatio(currNameSet, prevNameSet);
      const exactRepeat = (prevTrainingSignature && signature === prevTrainingSignature) || recentSignatures.has(signature);
      const excessiveOverlap = overlap >= 0.7 && currNameSet.size >= 3;
      if (!exactRepeat && !excessiveOverlap) break;

      const baseAvoid = [...recentExerciseNames];
      const currTop = (plannedWorkout.exercises ?? [])
        .filter(ex => !ex.isCardio)
        .slice(0, 6)
        .map(ex => normalizeExerciseName(ex.exerciseName))
        .filter(Boolean);
      const avoidExerciseNames = [...new Set([...baseAvoid, ...currTop])].slice(0, 12);
      if (avoidExerciseNames.length === 0) break;

      const regenerated = await generateWorkout(profile, { planningDate: planDate, avoidExerciseNames });
      const regeneratedSignature = workoutSignature(regenerated);
      const regeneratedOverlap = overlapRatio(exerciseNameSet(regenerated), prevNameSet);

      const isBetter =
        regeneratedSignature !== signature &&
        (!recentSignatures.has(regeneratedSignature)) &&
        regeneratedOverlap < overlap;

      if (isBetter || exactRepeat) {
        plannedWorkout = regenerated;
        signature = regeneratedSignature;
      } else {
        // Keep attempting with the updated candidate once more.
        plannedWorkout = regenerated;
        signature = regeneratedSignature;
      }
      attempt++;
    }
    prevTrainingSignature = signature;
    days.push({
      planDate,
      dayOfWeek: dow,
      dayName: dayNames[dow],
      dayStatus: 'planned',
      isRestDay: false,
      focus: p?.focus || plannedWorkout.trainingGoal.replace(/_/g, ' '),
      muscleGroups: p?.muscleGroups || plannedWorkout.muscleGroupsFocused,
      plannedWorkout,
      estimatedExercises: plannedWorkout.exercises.length,
      estimatedMinutes: plannedWorkout.estimatedDurationMinutes,
      llmVerdict: 'pending',
    });
  }

  return {
    weekStartDate: weekDates[0],
    featureSnapshotId: profile.featureSnapshotId,
    days,
  };
}

export async function recomputeWeeklyPlanWithDiff(
  previousPlan: WeeklyPlan,
  profile: TrainingProfile,
  userRestDays: number[] = []
): Promise<{ plan: WeeklyPlan; diffs: WeeklyPlanDiff[] }> {
  const recomputed = await generateWeeklyPlan(profile, userRestDays);
  const prevByDate = new Map(previousPlan.days.map(d => [d.planDate, d]));
  const diffs: WeeklyPlanDiff[] = [];
  for (const day of recomputed.days) {
    const prev = prevByDate.get(day.planDate);
    if (!prev) continue;
    const prevW = prev.plannedWorkout;
    const nextW = day.plannedWorkout;
    if (!prevW && !nextW) continue;
    const prevNames = new Set((prevW?.exercises ?? []).map(e => e.exerciseName.toLowerCase()));
    const nextNames = new Set((nextW?.exercises ?? []).map(e => e.exerciseName.toLowerCase()));
    const changedExercises = [...nextNames].filter(n => !prevNames.has(n)).slice(0, 6);
    const exerciseCountDelta = (nextW?.exercises.length ?? 0) - (prevW?.exercises.length ?? 0);
    const estimatedMinutesDelta = (nextW?.estimatedDurationMinutes ?? 0) - (prevW?.estimatedDurationMinutes ?? 0);
    const reasonCodes: string[] = [];
    if ((prevW?.recoveryStatus ?? '') !== (nextW?.recoveryStatus ?? '')) reasonCodes.push('recovery');
    if (exerciseCountDelta !== 0) reasonCodes.push('volume');
    if (changedExercises.length > 0) reasonCodes.push('exercise_swap');
    if (estimatedMinutesDelta !== 0) reasonCodes.push('duration');
    if ((prevW?.objectiveUtility?.adherenceScore ?? 0) !== (nextW?.objectiveUtility?.adherenceScore ?? 0)) reasonCodes.push('compliance');
    if ((prevW?.objectiveUtility?.utility ?? 0) !== (nextW?.objectiveUtility?.utility ?? 0)) reasonCodes.push('objective_utility');
    if (reasonCodes.length === 0) continue;

    diffs.push({
      planDate: day.planDate,
      reasonCodes,
      beforeWorkout: prevW ?? null,
      afterWorkout: nextW ?? null,
      diffSummary: {
        exerciseCountDelta,
        estimatedMinutesDelta,
        changedExercises,
      },
    });
  }
  return { plan: recomputed, diffs };
}

export function generateWeekPreview(
  profile: TrainingProfile,
  userRestDays: number[] = [],
  todayCompleted: boolean = false,
  todayCompletedName?: string
): DayPreview[] {
  const todayDow = new Date().getDay(); // 0=Sun .. 6=Sat
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const { dayOfWeekPatterns, detectedSplit } = profile;
  const restDaySet = new Set(userRestDays);

  const splitLabels: Record<string, string> = {
    push: 'Push', pull: 'Pull', legs: 'Legs',
    upper: 'Upper', lower: 'Lower', full: 'Full Body',
  };

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

  // Week always starts on Monday (dow=1) and ends on Sunday (dow=0)
  const mondayThroughSunday = [1, 2, 3, 4, 5, 6, 0];

  // Count how many workout days occur *before* today in the week to offset the rotation.
  // This ensures the rotation is consistent regardless of which day we're viewing.
  let slotsBeforeToday = 0;
  for (const dow of mondayThroughSunday) {
    if (dow === todayDow) break;
    const hasExplicitRestConfig = restDaySet.size > 0;
    const isUserRestDay = restDaySet.has(dow);
    const pattern = dayOfWeekPatterns[dow];
    const isPatternRest = !pattern || pattern.isRestDay || pattern.frequency < 0.3;
    const shouldRest = hasExplicitRestConfig ? isUserRestDay : isPatternRest;
    if (!shouldRest) slotsBeforeToday++;
  }

  const previews: DayPreview[] = [];
  let usedRotationSlots = 0;

  for (const dow of mondayThroughSunday) {
    const pattern = dayOfWeekPatterns[dow];
    const isToday = dow === todayDow;
    const isPast = mondayThroughSunday.indexOf(dow) < mondayThroughSunday.indexOf(todayDow);

    const isUserRestDay = restDaySet.has(dow);
    const hasExplicitRestConfig = restDaySet.size > 0;
    const isPatternRest = !pattern || pattern.isRestDay || pattern.frequency < 0.3;
    const shouldRest = hasExplicitRestConfig ? isUserRestDay : isPatternRest;

    if (isToday && todayCompleted) {
      previews.push({
        dayOfWeek: dow,
        dayName: dayNames[dow],
        isRestDay: false,
        isCompleted: true,
        focus: todayCompletedName || 'Done',
        muscleGroups: [],
        estimatedExercises: 0,
        estimatedMinutes: 0,
        isToday: true,
      });
      if (!shouldRest) usedRotationSlots++;
      continue;
    }

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

    // Days before today just consume a rotation slot (they're in the past)
    if (isPast) {
      usedRotationSlots++;
      previews.push({
        dayOfWeek: dow,
        dayName: dayNames[dow],
        isRestDay: false,
        focus: '',
        muscleGroups: [],
        estimatedExercises: 0,
        estimatedMinutes: 0,
        isToday: false,
      });
      continue;
    }

    let focus = '';
    let muscleGroups: string[] = [];

    if (rotation.length > 0) {
      const slot = rotation[(rotationIdx + usedRotationSlots) % rotation.length];
      focus = splitLabels[slot] || slot;
      muscleGroups = SPLIT_MUSCLE_MAPPING[slot] || [];
      usedRotationSlots++;
    }

    if (muscleGroups.length === 0 && pattern && pattern.muscleGroupsTypical.length > 0) {
      muscleGroups = pattern.muscleGroupsTypical.slice(0, 4);
      if (!focus) focus = muscleGroups.slice(0, 3).map(g => g.replace(/_/g, ' ')).join(', ');
    }

    if (muscleGroups.length === 0 && !focus) {
      if (rotation.length > 0) {
        const slot = rotation[(rotationIdx + usedRotationSlots - 1) % rotation.length];
        focus = splitLabels[slot] || slot;
        muscleGroups = SPLIT_MUSCLE_MAPPING[slot] || [];
      } else {
        focus = 'Full Body';
        muscleGroups = [];
      }
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
        model_metadata: {
          config_version: MODEL_CONFIG_VERSION,
          engine_version: WORKOUT_ENGINE_VERSION,
          feature_snapshot_id: workout.featureSnapshotId ?? null,
          objective_utility: workout.objectiveUtility ?? null,
        },
      },
      exercises: workout.exercises,
      rationale: workout.sessionRationale,
      adjustments: workout.adjustmentsSummary,
    });

  if (error) throw error;
}
