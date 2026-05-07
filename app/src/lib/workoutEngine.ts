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

import { db } from './dbClient';
import {
  VOLUME_GUIDELINES,
  MUSCLE_HEAD_TO_GROUP,
  type CanonicalMuscleGroup,
  type MuscleGroupOrCardio,
  type ExerciseRole,
  type GoalKind,
  getGuidelineForGroup,
  normalizeMuscleGroupList,
  normalizeMuscleGroupName,
  PRIMARY_MUSCLE_GROUPS,
} from './volumeGuidelines';
import type { TrainingProfile, ExerciseProgression, EnrichedExercise, ExercisePreference, CardioHistory, ExerciseOrderProfile, MuscleVolumeStatus } from './trainingAnalysis';
import { uuidv4 } from '../utils/uuid';
import { getExerciseMapping, getExerciseSFR, canonicalizeExerciseName } from './exerciseMuscleMap';
import { estimateWeight as estimateWeightFromRatios } from './liftRatios';
import { suggestSupersets, type SupersetSuggestion } from './supersetPairer';
import { DEFAULT_MODEL_CONFIG, MODEL_CONFIG_VERSION, WORKOUT_ENGINE_VERSION, type ModelConfig } from './modelConfig';
import { getSportProfile, type SportProfile, type SportSeason } from './sportProfiles';
import { getLocalDate } from '../utils/dateUtils';
import { normalizeEquipment } from '../utils/formatUtils';
import { logWarn } from '../utils/logger';
import {
  buildAdaptivePolicyContext,
  optimizePrescription,
  toCoachNarrative,
  type AdaptiveExercise,
} from './adaptiveLearningPolicy';
import {
  runInvariantPipeline,
  DEFAULT_WORKOUT_INVARIANTS,
  violationsBySeverity,
  type WorkoutInvariantContext,
} from './workoutInvariants';

/**
 * Normalize a raw muscle name from the exercise library to the snake_case
 * key format used by MUSCLE_HEAD_TO_GROUP. Handles spaces, mixed case,
 * and common DB variants (e.g. "Latissimus Dorsi" → "latissimus_dorsi").
 */
function normalizeMuscleName(raw: string): string {
  return String(raw || '').trim().toLowerCase().replace(/\s+/g, '_');
}

/**
 * Resolve a raw primary_muscles entry to its canonical group, tolerating
 * case/space mismatches in the exercise library data.
 */
function resolveToCanonicalGroup(raw: string): CanonicalMuscleGroup | undefined {
  const key = normalizeMuscleName(raw);
  return MUSCLE_HEAD_TO_GROUP[key] ?? MUSCLE_HEAD_TO_GROUP[raw];
}

// ─── Exercise Identity (structured lookup layer) ─────────────────────────────

const COMPOUND_MOVEMENT_PATTERNS = new Set([
  'squat', 'hip_hinge', 'horizontal_push', 'vertical_push',
  'horizontal_pull', 'vertical_pull', 'lunge', 'compound',
]);

const BIG_THREE_RE = /^(bench press|barbell bench press|flat bench press|squat|back squat|barbell squat|barbell back squat|deadlift|conventional deadlift|barbell deadlift)$/i;
const HINGE_NAME_RE = /(^|\b)(rdl|romanian deadlift|stiff\s*leg deadlift|good morning|deadlift)(\b|$)/i;
const KNEE_FLEXION_RE = /curl|nordic|glute.ham/i;
const CORE_FLEXION_RE = /crunch|sit.?up|v.?up/i;
const CORE_ANTI_RE = /plank|dead.?bug|bird.?dog|pallof|anti/i;
const CORE_ANTI_EXT_RE = /rollout|ab.?wheel|wheel/i;
const CORE_ROTATION_RE = /woodchop|russian.?twist|cable.?rotation/i;
const CORE_HIP_FLEXION_RE = /leg.?raise|hanging|knee.?raise/i;
const UNLOADED_BW_RE = /\b(glute[- ]?ham|ghr|nordic|sissy squat|pistol squat|body\s*weight|bw |muscle[- ]?up|human flag|l[- ]?sit|planche|dragon flag|burpee|mountain climber|plank|dead hang|inverted row)\b/;

const CNS_DEMAND_NAME_PATTERNS: [RegExp, number][] = [
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

export interface ExerciseIdentity {
  name: string;
  movementPattern: string | null;
  equipment: string | null;
  exerciseType: string | null;
  muscleGroup: string | null;
  isPrimaryLift: boolean;
  isHinge: boolean;
  isKneeFlexion: boolean;
  cardioModality: 'walk' | 'run' | 'stair' | 'bike' | 'row' | 'elliptical' | 'other' | null;
  corePattern: 'flexion' | 'anti_movement' | 'anti_extension' | 'rotation' | 'hip_flexion' | null;
  isBodyweight: boolean;
  cnsDemandTier: number;
}

function classifyCorePattern(nameLC: string): ExerciseIdentity['corePattern'] {
  if (CORE_FLEXION_RE.test(nameLC)) return 'flexion';
  if (CORE_ANTI_RE.test(nameLC)) return 'anti_movement';
  if (CORE_ANTI_EXT_RE.test(nameLC)) return 'anti_extension';
  if (CORE_ROTATION_RE.test(nameLC)) return 'rotation';
  if (CORE_HIP_FLEXION_RE.test(nameLC)) return 'hip_flexion';
  return null;
}

function classifyCardioModality(nameLC: string): ExerciseIdentity['cardioModality'] {
  if (/stairmaster|stair master|stepmill/.test(nameLC)) return 'stair';
  if (/bike|cycle/.test(nameLC)) return 'bike';
  if (/row/.test(nameLC)) return 'row';
  if (/elliptical/.test(nameLC)) return 'elliptical';
  if (/run|jog|sprint/.test(nameLC)) return 'run';
  if (/walk|treadmill|incline|hike|ruck/.test(nameLC)) return 'walk';
  return null;
}

function classifyCnsDemandFromName(nameLC: string, movementPattern: string | null): number {
  for (const [pattern, tier] of CNS_DEMAND_NAME_PATTERNS) {
    if (pattern.test(nameLC)) return tier;
  }
  const mp = (movementPattern ?? '').toLowerCase();
  if (COMPOUND_MOVEMENT_PATTERNS.has(mp)) return 2;
  if (nameLC.includes('leg press') || nameLC.includes('hack squat') || nameLC.includes('smith')) return 2;
  if (nameLC.includes('machine') || nameLC.includes('cable')) return 3;
  if (mp === 'isolation' || mp === 'corrective') return 4;
  return 3;
}

/**
 * Build an ExerciseIdentity from an exercise library entry when available,
 * falling back to regex-based heuristics for backward compatibility.
 *
 * When libraryEntry is provided (from the exercise library DB), structured
 * fields like movement_pattern, equipment, ml_exercise_type are used directly.
 * When absent, the existing regex patterns provide identical classification.
 */
function classifyExercise(name: string, libraryEntry?: EnrichedExercise | null): ExerciseIdentity {
  const nameLC = String(name || '').toLowerCase().trim();
  const equipment = libraryEntry
    ? (Array.isArray(libraryEntry.equipment) ? libraryEntry.equipment : []).map(normalizeEquipment)
    : [];
  const primaryEquipment = equipment[0] ?? null;

  const movementPattern = libraryEntry?.movement_pattern
    ? String(libraryEntry.movement_pattern).toLowerCase()
    : null;

  const exerciseType = libraryEntry?.ml_exercise_type
    ? String(libraryEntry.ml_exercise_type).toLowerCase()
    : null;

  const muscleGroup = libraryEntry?.primary_muscles?.[0]
    ? resolveToCanonicalGroup(libraryEntry.primary_muscles[0]) ?? null
    : null;

  const isHingeByPattern = movementPattern != null
    && (movementPattern.includes('hinge') || movementPattern === 'hip_hinge');
  const isHinge = isHingeByPattern || HINGE_NAME_RE.test(nameLC);

  const isPrimaryLift = BIG_THREE_RE.test(nameLC);
  const isKneeFlexion = KNEE_FLEXION_RE.test(nameLC);

  const isCardioType = exerciseType === 'cardio';
  const cardioModality = isCardioType
    ? (classifyCardioModality(nameLC) ?? 'other')
    : classifyCardioModality(nameLC);

  const corePattern = classifyCorePattern(nameLC);

  const isBodyweight = (equipment.length === 1 && equipment[0] === 'bodyweight')
    || UNLOADED_BW_RE.test(nameLC)
    || equipment.includes('bodyweight');

  const cnsDemandTier = classifyCnsDemandFromName(nameLC, movementPattern);

  return {
    name: nameLC,
    movementPattern,
    equipment: primaryEquipment,
    exerciseType,
    muscleGroup,
    isPrimaryLift,
    isHinge,
    isKneeFlexion,
    cardioModality,
    corePattern,
    isBodyweight,
    cnsDemandTier,
  };
}

/**
 * Build ExerciseIdentity from a GeneratedExercise (post-prescription).
 * Uses the already-resolved fields rather than re-querying the library.
 */
function classifyGeneratedExercise(ex: GeneratedExercise): ExerciseIdentity {
  const nameLC = String(ex.exerciseName || '').toLowerCase().trim();
  const mp = (ex.movementPattern || '').toLowerCase() || null;

  return {
    name: nameLC,
    movementPattern: mp,
    equipment: null,
    exerciseType: null,
    muscleGroup: ex.targetMuscleGroup ?? null,
    isPrimaryLift: BIG_THREE_RE.test(nameLC),
    isHinge: (mp != null && (mp.includes('hinge') || mp === 'hip_hinge')) || HINGE_NAME_RE.test(nameLC),
    isKneeFlexion: KNEE_FLEXION_RE.test(nameLC),
    cardioModality: ex.isCardio ? (classifyCardioModality(nameLC) ?? 'other') : classifyCardioModality(nameLC),
    corePattern: classifyCorePattern(nameLC),
    isBodyweight: ex.isBodyweight,
    cnsDemandTier: classifyCnsDemandFromName(nameLC, mp),
  };
}

const STAPLE_RDL_RE = /(^|\b)(rdl|romanian deadlift)(\b|$)/;
const STAPLE_LEG_PRESS_RE = /leg\s*press|sled\s*press|45[\s-]*degree\s*leg\s*press/;

function stapleFamilyKey(exerciseName: string): string {
  const n = String(exerciseName || '').trim().toLowerCase();
  if (STAPLE_RDL_RE.test(n)) return 'romanian_deadlift';
  if (STAPLE_LEG_PRESS_RE.test(n)) return 'leg_press';
  return n;
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PerformanceGoal {
  exercise: string;
  targetWeight: string;
  targetReps: string;
}

export type ApolloPhase = 'bulk' | 'cut' | 'maintain';

export interface UserPreferences {
  training_goal: ApolloPhase;
  primary_goal: string | null;
  secondary_goal: string | null;
  session_duration_minutes: number;
  equipment_access: 'full_gym' | 'home_gym' | 'limited' | 'bodyweight';
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
  priority_muscles: CanonicalMuscleGroup[];
  weekday_deadlines: Record<string, string>;
  gym_profiles: Array<{ name: string; equipment: string[] }>;
  active_gym_profile: string | null;
  age: number | null;
  rest_days: number[]; // 0=Sun, 1=Mon, ... 6=Sat
  sport_focus: string | null;
  sport_season: SportSeason | null;
  hotel_mode: boolean;
  weekly_split_schedule: Record<string, { focus: string; groups: CanonicalMuscleGroup[] }> | null;
  mesocycle_week: number | null;
  mesocycle_start_date: string | null;
}

export type { ExerciseRole } from './volumeGuidelines';

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
  targetMuscleGroup: MuscleGroupOrCardio;
  exerciseRole: ExerciseRole;
  sets: number;
  targetReps: number;
  /**
   * Rep range [min, max] from the goal/role table. Use this for double-
   * progression: the user works in this band and only graduates weight
   * once they hit `max` reps for all working sets. Without an explicit
   * range exposed in the UI, double progression can't function — users
   * see a single number and stop there.
   */
  targetRepRange?: { min: number; max: number } | null;
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
  targetTimeSeconds?: number | null;
  warmupSets: WarmupSet[] | null;
  supersetGroupId: number | null;
  supersetType: 'antagonist' | 'pre_exhaust' | 'compound_set' | null;
  rirRange: [number, number] | null;
  impactScore: number | null;
  estimatedMinutes: number;
}

function isTimedHoldExercise(exerciseName: string): boolean {
  return classifyCorePattern(String(exerciseName || '').toLowerCase()) === 'anti_movement'
    && String(exerciseName || '').toLowerCase().includes('plank');
}

function getTimedHoldSeconds(goal: string): number {
  if (goal === 'bulk') return 45;
  if (goal === 'cut') return 60;
  return 60;
}

export interface DecisionLogEntry {
  step: string;
  label: string;
  details: string[];
}

export interface MuscleGroupDecision {
  muscleGroup: CanonicalMuscleGroup;
  priority: number;
  reason: string;
  targetSets: number;
  recoveryPercent: number | null;
  weeklyVolume: number | null;
  volumeTarget: string | null;
}

export interface ExerciseDecision {
  exerciseName: string;
  muscleGroup: MuscleGroupOrCardio;
  score: number;
  factors: string[];
}

export interface GeneratedWorkout {
  id: string;
  date: string;
  featureSnapshotId?: string;
  trainingGoal: string;
  estimatedDurationMinutes: number;
  muscleGroupsFocused: MuscleGroupOrCardio[];
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
  policyState?: {
    policyVersion: string;
    pid: {
      error: number;
      integral: number;
      derivative: number;
      controlSignal: number;
    };
    fusion: {
      nutritionMultiplier: number;
      readinessMultiplier: number;
      strengthMultiplier: number;
      progressionMultiplier: number;
      confidence: number;
    };
    guardrails: string[];
    adaptive?: {
      policyConfidence: number;
      promoteReady: boolean;
      priorsVersion: string;
      stateVersion: string;
    };
  };
  decisionProvenance?: Array<{
    sourceType: 'observed' | 'inferred' | 'policy' | 'learned';
    stage: string;
    key: string;
    value: Record<string, unknown>;
    confidence: number;
  }>;
  runtimeFlags?: Record<string, boolean>;
  perfTelemetry?: {
    totalMs: number;
    stagesMs: Record<string, number>;
  };
  /** One-line explanation of fat-loss dose adjustments (Today page / export). */
  fatLossDoseExplanation?: string;
  /** Phase 1: theme that drove this workout's selection — preserved for invariants and audit. */
  dayTheme?: DayTheme | null;
}

// ─── Data Fetching ──────────────────────────────────────────────────────────

const PREFS_CACHE_TTL_MS = 60 * 1000;
const EXERCISE_CACHE_TTL_MS = 5 * 60 * 1000;
const prefsCache = new Map<string, { at: number; value: UserPreferences }>();
let exerciseCache: { at: number; value: EnrichedExercise[] } | null = null;

function clonePrefs(prefs: UserPreferences): UserPreferences {
  if (typeof structuredClone === 'function') return structuredClone(prefs);
  return JSON.parse(JSON.stringify(prefs)) as UserPreferences;
}

function cloneExercises(exercises: EnrichedExercise[]): EnrichedExercise[] {
  return exercises.map((ex) => ({
    ...ex,
    primary_muscles: Array.isArray(ex.primary_muscles) ? [...ex.primary_muscles] : [],
    secondary_muscles: Array.isArray(ex.secondary_muscles) ? [...ex.secondary_muscles] : [],
    stabilizer_muscles: Array.isArray(ex.stabilizer_muscles) ? [...ex.stabilizer_muscles] : [],
    equipment: Array.isArray(ex.equipment) ? [...ex.equipment] : [],
  }));
}

export function parseRawPreferences(data: any): UserPreferences {
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
    training_goal: (['bulk', 'cut', 'maintain'].includes(data?.training_goal) ? data.training_goal : 'maintain') as ApolloPhase,
    primary_goal: data?.primary_goal ?? null,
    secondary_goal: data?.secondary_goal ?? null,
    session_duration_minutes: (() => {
      const v = Number(data?.session_duration_minutes ?? data?.session_duration ?? DEFAULT_MODEL_CONFIG.defaultSessionDurationMinutes);
      return Number.isFinite(v) && v > 0 ? v : DEFAULT_MODEL_CONFIG.defaultSessionDurationMinutes;
    })(),
    equipment_access: data?.equipment_access ?? 'bodyweight',
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
    hotel_mode: Boolean(data?.hotel_mode),
    weekly_split_schedule: (typeof data?.weekly_split_schedule === 'object' && data?.weekly_split_schedule !== null && !Array.isArray(data.weekly_split_schedule)) ? data.weekly_split_schedule : null,
    mesocycle_week: data?.mesocycle_week != null ? Number(data.mesocycle_week) : null,
    mesocycle_start_date: data?.mesocycle_start_date ?? null,
  };
}

async function fetchUserPreferences(userId: string): Promise<UserPreferences> {
  const now = Date.now();
  const cached = prefsCache.get(userId);
  if (cached && (now - cached.at) <= PREFS_CACHE_TTL_MS) {
    return clonePrefs(cached.value);
  }
  const supabase = db as any;
  const { data, error } = await supabase
    .from('user_preferences')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error && error.code !== 'PGRST116') throw error;

  const parsed = parseRawPreferences(data);
  prefsCache.set(userId, { at: now, value: parsed });
  return clonePrefs(parsed);
}

async function fetchAllExercises(): Promise<EnrichedExercise[]> {
  const now = Date.now();
  if (exerciseCache && (now - exerciseCache.at) <= EXERCISE_CACHE_TTL_MS) {
    return cloneExercises(exerciseCache.value);
  }
  const supabase = db as any;
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
  const rawRows = (data ?? []) as Array<Record<string, unknown>>;
  const normalized: EnrichedExercise[] = rawRows.map(row => ({
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    body_part: String(row.body_part ?? ''),
    primary_muscles: Array.isArray(row.primary_muscles) ? row.primary_muscles as string[] : null,
    secondary_muscles: Array.isArray(row.secondary_muscles) ? row.secondary_muscles as string[] : null,
    stabilizer_muscles: Array.isArray(row.stabilizer_muscles) ? row.stabilizer_muscles as string[] : null,
    movement_pattern: (row.movement_pattern as EnrichedExercise['movement_pattern']) ?? null,
    ml_exercise_type: (row.ml_exercise_type as EnrichedExercise['ml_exercise_type']) ?? null,
    force_type: (row.force_type as EnrichedExercise['force_type']) ?? null,
    difficulty: (row.difficulty as EnrichedExercise['difficulty']) ?? null,
    default_tempo: row.default_tempo != null ? String(row.default_tempo) : null,
    equipment: Array.isArray(row.equipment) ? row.equipment as string[] : [],
  }));
  exerciseCache = { at: now, value: normalized };
  return cloneExercises(normalized);
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
const REP_RANGE_TABLE: Record<string, Record<string, { min: number; max: number; target: number }>> =
  DEFAULT_MODEL_CONFIG.repRangeTable;

function humanizeRepTarget(value: number, min: number, max: number): number {
  const allowed = [3, 4, 5, 6, 8, 10, 12, 15, 20, 25].filter(v => v >= min && v <= max);
  if (allowed.length === 0) return Math.max(min, Math.min(max, Math.round(value)));
  let best = allowed[0];
  let bestDist = Math.abs(value - best);
  for (const candidate of allowed.slice(1)) {
    const dist = Math.abs(value - candidate);
    if (dist < bestDist) {
      best = candidate;
      bestDist = dist;
    }
  }
  return best;
}

function getRepRangeByRole(
  role: ExerciseRole,
  primaryGoal: string,
  secondaryGoal: string | null,
  dayOccurrenceIndex?: number,
  cfg?: ModelConfig,
  exerciseType?: string | null,
): { min: number; max: number; target: number } {
  const roleKey = role === 'corrective' ? 'isolation' : role === 'cardio' ? 'isolation' : role;

  if (dayOccurrenceIndex !== undefined && cfg && roleKey !== 'isolation') {
    const isHeavyDay = dayOccurrenceIndex === 0;
    if (roleKey === 'primary') {
      const range = isHeavyDay ? cfg.heavyRepRange : cfg.moderateRepRange;
      return { min: range[0], max: range[1], target: Math.round((range[0] + range[1]) / 2) };
    }
    if (roleKey === 'secondary') {
      const range = isHeavyDay ? [6, 8] as const : [10, 15] as const;
      return { min: range[0], max: range[1], target: Math.round((range[0] + range[1]) / 2) };
    }
  }

  if (roleKey === 'isolation' && cfg) {
    return { min: cfg.metabolicRepRange[0], max: cfg.metabolicRepRange[1], target: Math.round((cfg.metabolicRepRange[0] + cfg.metabolicRepRange[1]) / 2) };
  }

  const primary = REP_RANGE_TABLE[primaryGoal]?.[roleKey] ?? REP_RANGE_TABLE.maintain[roleKey];
  let result: { min: number; max: number; target: number };
  if (!secondaryGoal || secondaryGoal === primaryGoal) {
    result = primary;
  } else {
    const secondary = REP_RANGE_TABLE[secondaryGoal]?.[roleKey] ?? primary;
    result = {
      min: Math.round(primary.min * 0.7 + secondary.min * 0.3),
      max: Math.round(primary.max * 0.7 + secondary.max * 0.3),
      target: Math.round(primary.target * 0.7 + secondary.target * 0.3),
    };
  }

  const isCompound = exerciseType === 'compound';
  if (isCompound && roleKey === 'primary') {
    const maxReps = (cfg ?? DEFAULT_MODEL_CONFIG).maxCompoundRepsPrimary;
    result = {
      min: result.min,
      max: Math.min(result.max, maxReps),
      target: Math.min(result.target, maxReps),
    };
  } else if (isCompound && roleKey === 'secondary') {
    const maxReps = (cfg ?? DEFAULT_MODEL_CONFIG).maxCompoundRepsSecondary;
    result = {
      min: result.min,
      max: Math.min(result.max, maxReps),
      target: Math.min(result.target, maxReps),
    };
  }

  return result;
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
  isDeload: boolean,
  mesocycleVolumeMult?: number,
  cfg: ModelConfig = DEFAULT_MODEL_CONFIG,
): number {
  let sets = cfg.roleBaseSets[role] ?? 3;

  if (goal === 'bulk' && (role === 'primary' || role === 'secondary')) sets += cfg.bulkSetsBonus;
  if (goal === 'cut') sets = Math.max(sets - 1, cfg.cutSetsFloor);

  if (isPriorityMuscle && role !== 'corrective') sets += 1;

  if (mesocycleVolumeMult && !isDeload) {
    sets = Math.round(sets * mesocycleVolumeMult);
  }

  if (isDeload) sets = Math.max(cfg.setsAbsoluteMin, Math.round(sets * cfg.deloadSetMultiplier));

  return Math.max(cfg.setsAbsoluteMin, Math.min(cfg.setsAbsoluteMax, sets));
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
function getRirTarget(
  role: ExerciseRole,
  goal: string,
  isDeload: boolean,
  experienceLevel?: string | null,
  mesocycleRirOffset?: number,
  isLastSet?: boolean,
  cfg: ModelConfig = DEFAULT_MODEL_CONFIG,
): number {
  if (isDeload) return cfg.deloadRir;

  const exp = getExperienceOrDefault(experienceLevel);

  let baseRir: number;
  if (exp === 'advanced' || exp === 'elite') {
    baseRir = cfg.advancedRirMap[role] ?? 1;
    if (isLastSet && (role === 'primary' || role === 'secondary')) baseRir = 0;
  } else if (exp === 'beginner') {
    baseRir = cfg.beginnerRirMap[role] ?? 2;
  } else {
    baseRir = cfg.intermediateRirMap[role] ?? 1;
  }

  baseRir += cfg.goalRirShift[goal] ?? 0;

  if (mesocycleRirOffset) baseRir += mesocycleRirOffset;

  return Math.max(0, Math.min(cfg.deloadRir, baseRir));
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

/**
 * Best-effort estimate of the user's 1RM for a given exercise from whatever
 * data is on hand. Used by the rep×load safety guard so that prescriptions
 * generated from any branch (progression, learned-weight bypass, fill paths)
 * still have a 1RM reference to clamp against.
 *
 * Priority:
 *   1. `prog.estimated1RM` — derived from logged sets, most reliable.
 *   2. Epley estimate from `pref.learnedWeight × pref.learnedReps`.
 *   3. null — caller must skip the guard (bodyweight, no signal).
 *
 * Returns null when no signal is available rather than guessing — a missing
 * 1RM is less dangerous than a fabricated one (the existing bodyweight cap
 * still applies as a backstop).
 */
function deriveE1rmReference(
  prog: { estimated1RM?: number | null } | null | undefined,
  pref: { learnedWeight?: number | null; learnedReps?: number | null } | null | undefined
): number | null {
  if (prog && typeof prog.estimated1RM === 'number' && prog.estimated1RM > 0) {
    return prog.estimated1RM;
  }
  if (
    pref &&
    typeof pref.learnedWeight === 'number' && pref.learnedWeight > 0 &&
    typeof pref.learnedReps === 'number' && pref.learnedReps > 0
  ) {
    const reps = Math.max(1, Math.round(pref.learnedReps));
    return pref.learnedWeight * (1 + reps / 30);
  }
  return null;
}

/**
 * Deterministic safety clamp: enforces `weight ≤ Epley_inverse(1RM, reps + RIR)`
 * (i.e. the true rep×load capacity ceiling). The `repLoadSafetyMargin` is
 * applied only as a *hard ceiling* against absurd overshoots — it does NOT
 * shave every steady-state prescription.
 *
 * Two-tier logic:
 *   1. If `targetWeight ≤ ceiling` (the rep×load identity itself), pass
 *      through unchanged. This is the steady-state path — Epley is already
 *      calibrated and we trust the engine's own math.
 *   2. If `targetWeight > ceiling`, we have a real overshoot from stacked
 *      modifiers / forecast / learned bypass. Clamp to `ceiling × margin`
 *      so we still leave a small pad below the true ceiling.
 *
 * This was previously over-binding: `safeCeiling = ceiling × 0.93` was
 * compared against `targetWeight` which itself equaled `ceiling`, so every
 * steady-state prescription was shaved ~7% per session — guaranteeing
 * downward drift of working weights over time.
 *
 * Returns the (possibly unchanged) weight and an optional human-readable note.
 */
function clampToRepLoadCeiling(
  targetWeight: number,
  targetReps: number,
  rir: number,
  e1rmReference: number | null,
  equipment: string[] | undefined,
  exerciseType: string | undefined,
  cfg: ModelConfig = DEFAULT_MODEL_CONFIG
): { weight: number; note: string | null } {
  if (
    targetWeight <= 0 ||
    targetReps <= 0 ||
    e1rmReference == null ||
    e1rmReference <= 0
  ) {
    return { weight: targetWeight, note: null };
  }
  const ceiling = weightForReps(e1rmReference, targetReps, rir, equipment, exerciseType);
  if (ceiling <= 0) return { weight: targetWeight, note: null };

  // Steady-state path: prescription respects the rep×load identity. No clamp.
  if (targetWeight <= ceiling) return { weight: targetWeight, note: null };

  // Overshoot path: stacked modifiers pushed weight above true capacity.
  // Apply the safety margin only here, and floor to a plate so we never
  // round UP into unsafe territory.
  const margin = clampNumber(cfg.repLoadSafetyMargin, 0.5, 1.0);
  const rawSafe = ceiling * margin;
  let safeCeiling = snapToPlate(rawSafe, equipment, exerciseType);
  if (safeCeiling > rawSafe) {
    const stepGuess = (() => {
      const eqNorm = (equipment ?? []).map(normalizeEquipment);
      if (eqNorm.includes('barbell')) return cfg.barbellIncrement;
      if (eqNorm.includes('dumbbell')) return cfg.dumbbellIncrement;
      if (exerciseType === 'isolation') return cfg.isolationIncrement;
      return cfg.machineIncrement;
    })();
    safeCeiling = Math.max(0, safeCeiling - stepGuess);
  }
  if (targetWeight <= safeCeiling) return { weight: targetWeight, note: null };
  return {
    weight: safeCeiling,
    note: `Safety guard: ${targetWeight} → ${safeCeiling} lbs ` +
          `(modifier stack exceeded rep×load capacity for ${targetReps} reps @ RIR ${rir}; ` +
          `est. 1RM ${Math.round(e1rmReference)} lbs, margin ${Math.round(margin * 100)}%)`,
  };
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
 *
 * Prefers the structured ml_exercise_type from the library. Falls back to
 * name heuristics + muscle count when classification is missing.
 */
function inferExerciseType(exercise: EnrichedExercise): string {
  if (exercise.ml_exercise_type) return exercise.ml_exercise_type;

  const identity = classifyExercise(exercise.name, exercise);
  if (identity.cardioModality != null) return 'cardio';

  const primaryCount = Array.isArray(exercise.primary_muscles) ? exercise.primary_muscles.length : 0;
  const secondaryCount = Array.isArray(exercise.secondary_muscles) ? exercise.secondary_muscles.length : 0;

  const name = exercise.name.toLowerCase();
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

  if (ISOLATION_KEYWORDS.some(k => name.includes(k))) return 'isolation';
  if (COMPOUND_KEYWORDS.some(k => name.includes(k))) return 'compound';

  if (primaryCount + secondaryCount >= 3) return 'compound';
  return 'isolation';
}

function inferCardioModality(exerciseName: string): 'walk' | 'run' | 'stair' | 'bike' | 'row' | 'elliptical' | 'other' {
  return classifyCardioModality(String(exerciseName || '').toLowerCase()) ?? 'other';
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
  goal: string,
  dayOccurrenceIndex?: number,
  cfg?: ModelConfig,
): number {
  if (role === 'corrective') return 45;
  if (role === 'cardio') return 0;

  const mapping = getExerciseMapping(exercise.name);
  const exType = mapping?.exercise_type ?? exercise.ml_exercise_type ?? inferExerciseType(exercise);

  if (dayOccurrenceIndex !== undefined && cfg) {
    const isIsolation = exType === 'isolation' || exType === 'accessory';
    if (isIsolation) return cfg.metabolicRestSeconds;
    return dayOccurrenceIndex === 0 ? cfg.heavyRestSeconds : cfg.moderateRestSeconds;
  }

  const primaryCount = mapping?.primary_muscles?.length ?? (Array.isArray(exercise.primary_muscles) ? exercise.primary_muscles.length : 1);
  const secondaryCount = mapping?.secondary_muscles?.length ?? (Array.isArray(exercise.secondary_muscles) ? exercise.secondary_muscles.length : 0);
  const pattern = mapping?.movement_pattern ?? exercise.movement_pattern ?? '';

  const c = cfg ?? DEFAULT_MODEL_CONFIG;
  let demandScore = 0;
  demandScore += Math.min(primaryCount * c.restDemandPerPrimary, c.restDemandPrimaryCap);
  demandScore += Math.min(secondaryCount * c.restDemandPerSecondary, c.restDemandSecondaryCap);
  if (exType === 'compound') demandScore += c.restDemandCompoundBonus;

  demandScore += c.restPatternCns[pattern] ?? c.restPatternCnsDefault;

  const baseRest = c.restBaseFloor + (demandScore / 10) * c.restDemandScale;
  const scaled = baseRest * (c.restGoalMultiplier[goal] ?? 1.0);
  return Math.max(c.restAbsoluteMin, Math.min(c.restAbsoluteMax, Math.round(scaled)));
}

/**
 * Tempo prescription from exercise-specific default → goal/type interaction.
 * Format: eccentric-pause-concentric.
 *
 * Hypertrophy benefits from controlled eccentrics (time under tension).
 * Strength benefits from explosive concentrics.
 * Isolation benefits from slower tempos to maintain tension on smaller muscles.
 */
function getTempo(
  defaultTempo: string | null,
  goal: string,
  exerciseType: string | null,
  dayOccurrenceIndex?: number,
): string {
  const isIsolation = exerciseType === 'isolation' || exerciseType === 'accessory';

  if (dayOccurrenceIndex !== undefined && !isIsolation) {
    return dayOccurrenceIndex === 0 ? '2-0-X' : '3-1-1';
  }
  if (isIsolation) return '2-1-2';

  if (defaultTempo) return defaultTempo;
  if (goal === 'bulk') return '3-1-1';
  if (goal === 'cut') return '2-0-1';
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

// Transition time per exercise based on setup complexity:
// Primary compounds (barbell loading, rack adjustments, safety pins) need more.
// Isolation machines (pin select, seat adjust) need less.
// These scale with role as a proxy for equipment complexity.
const TRANSITION_TIME_SEC: Record<string, number> = DEFAULT_MODEL_CONFIG.transitionTimeSec;

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
 * Apollo impact score: how much training value does this exercise deliver?
 * Always values compounds, muscle mass, and aesthetic contribution.
 * Phase modulates emphasis: bulk maximizes growth stimulus, cut preserves
 * strength with metabolic benefit, maintain balances both.
 */
function computeImpactScore(
  exercise: EnrichedExercise,
  role: ExerciseRole,
  primaryGoal: string,
  _secondaryGoal: string | null
): number {
  const cfg = DEFAULT_MODEL_CONFIG;
  const primaryMuscleCount = Array.isArray(exercise.primary_muscles) ? exercise.primary_muscles.length : 0;
  const isCompound = exercise.ml_exercise_type === 'compound';
  const compoundBonus = isCompound ? 3 : 0;
  const massBonus = Math.min(primaryMuscleCount, 5);

  const w = cfg.impactPhaseWeights[primaryGoal] ?? cfg.impactPhaseWeights.maintain;
  let score = compoundBonus * w.compound + massBonus * w.mass;
  if (!isCompound) score += w.metabolic;

  const V_TAPER_HEAD_NAMES = new Set([
    'lateral_deltoid', 'latissimus_dorsi', 'teres_major',
    'pectoralis_major_clavicular', 'pectoralis_minor',
  ]);
  const primaries = Array.isArray(exercise.primary_muscles)
    ? exercise.primary_muscles.map((m: string) => normalizeMuscleName(m))
    : [];
  if (primaries.some((m: string) => V_TAPER_HEAD_NAMES.has(m))) score += cfg.impactVTaperBonus;

  if (role === 'corrective') score *= cfg.impactCorrectiveMultiplier;
  if (role === 'primary') score *= cfg.impactPrimaryMultiplier;

  const isIsolation = exercise.ml_exercise_type === 'isolation';
  if (isIsolation) score += cfg.impactIsolationBonus;

  return Math.round(score * 10) / 10;
}

const EXPERIENCE_DEFAULT = 'intermediate';

function getExperienceOrDefault(raw: string | null | undefined): string {
  if (raw != null && raw !== '') return raw.toLowerCase();
  logWarn('experience_level missing — defaulting to intermediate. Prescription accuracy may be reduced.');
  return EXPERIENCE_DEFAULT;
}

/** Apollo phase is the single source of truth for all goal-keyed logic */
function getEffectiveGoal(prefs: UserPreferences): ApolloPhase {
  const phase = prefs.training_goal;
  if (phase === 'bulk' || phase === 'cut' || phase === 'maintain') return phase;
  return 'maintain';
}

// ─── Step 1: Recovery Check ─────────────────────────────────────────────────

interface RecoveryAdjustment {
  volumeMultiplier: number;
  adjustmentReasons: string[];
  isDeload: boolean;
}

interface FatLossControllerAdjustment {
  active: boolean;
  mode: 'none' | 'pid';
  tier: 'none' | 'on_track' | 'slow_loss' | 'stalled' | 'too_fast';
  cardioDurationMultiplier: number;
  cardioIntensityMultiplier: number;
  strengthVolumeMultiplier: number;
  restSecondsMultiplier: number;
  pid: {
    error: number;
    integral: number;
    derivative: number;
    controlSignal: number;
  };
  reason: string;
  /** 0–1 weight-trend reliability used for gating. */
  weightTrendConfidence: number;
  /** Multiplier applied to control signal when nutrition logging is sparse. */
  nutritionDampeningFactor: number;
  /** Short coach-facing sentence for UI. */
  userFacingLine: string;
}

interface HighCapacityPushAdjustment {
  active: boolean;
  tier: 'none' | 'moderate' | 'aggressive';
  volumeMultiplier: number;
  progressionMultiplier: number;
  restSecondsMultiplier: number;
  rirDelta: number;
  reason: string;
}

interface PolicyFusionAdjustment {
  active: boolean;
  nutritionMultiplier: number;
  readinessMultiplier: number;
  strengthMultiplier: number;
  progressionMultiplier: number;
  confidence: number;
  reason: string;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function deterministicHash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function deterministicProbability(input: string): number {
  return deterministicHash(input) / 4294967295;
}

function runtimeFlagEnabled(flag: string, defaultValue = true): boolean {
  if (typeof window === 'undefined') return defaultValue;
  try {
    const v = window.localStorage.getItem(`hf.flag.${flag}`);
    if (v == null) return defaultValue;
    return v === '1' || v.toLowerCase() === 'true';
  } catch {
    return defaultValue;
  }
}

function getNutritionAdherenceSignal(profile: TrainingProfile): number {
  // Prefer actual nutrition logging coverage (from meal_logs / health_metrics) over workout compliance
  const nutritionCov = profile.nutritionLoggingCoverage14d;
  if (nutritionCov != null && nutritionCov > 0) return clampNumber(nutritionCov, 0, 1);

  // Fall back to workout compliance as a rough proxy when no nutrition data exists
  const rawCompliance = profile.prescribedVsActual?.complianceRate ?? null;
  if (rawCompliance == null) return 0.5;
  return clampNumber(Number(rawCompliance) * 0.8, 0, 1);
}

function computePolicyFusion(
  profile: TrainingProfile,
  fatLossController: FatLossControllerAdjustment
): PolicyFusionAdjustment {
  const rawReadiness = profile.fitnessFatigueModel?.readiness ?? null;
  const rawCompliance = profile.prescribedVsActual?.complianceRate ?? null;
  const readiness = rawReadiness != null ? Number(rawReadiness) : 0.75;
  const adherence = rawCompliance != null ? Number(rawCompliance) : 0.5;
  const nutritionAdherence = getNutritionAdherenceSignal(profile);
  const strengthSlope = Number(profile.rolling30DayTrends?.totalStrengthIndex?.slopePct ?? 0);
  const strengthDirection = profile.rolling30DayTrends?.totalStrengthIndex?.direction ?? 'flat';

  // Skip readiness-based modification when no readiness data exists
  const readinessMultiplier = rawReadiness != null
    ? clampNumber(0.9 + readiness * 0.2, 0.9, 1.08)
    : 1.0;
  // Skip nutrition-based modification when no compliance data exists
  const nutritionMultiplier = rawCompliance != null
    ? clampNumber(0.92 + nutritionAdherence * 0.16, 0.92, 1.08)
    : 1.0;
  const strengthMultiplier = strengthDirection === 'down'
    ? clampNumber(0.98 + (strengthSlope / 100), 0.90, 1.0)
    : clampNumber(1.0 + (strengthSlope / 100), 1.0, 1.08);

  // Confidence degrades when signals disagree strongly.
  const agreement = rawReadiness != null ? 1 - Math.abs(readiness - nutritionAdherence) : 0.5;
  const confidence = clampNumber((agreement * 0.4) + (adherence * 0.4) + (fatLossController.active ? 0.2 : 0.1), 0, 1);

  const progressionMultiplier = clampNumber(
    readinessMultiplier * nutritionMultiplier * (strengthDirection === 'down' ? 0.98 : 1.02),
    0.9,
    1.12
  );

  return {
    active: true,
    nutritionMultiplier,
    readinessMultiplier,
    strengthMultiplier,
    progressionMultiplier,
    confidence,
    reason: `Policy fusion: nutrition ${(nutritionAdherence * 100).toFixed(0)}%, readiness ${(readiness * 100).toFixed(0)}%, strength ${strengthDirection}.`,
  };
}

function computeHighCapacityPush(profile: TrainingProfile, prefs: UserPreferences, cfg: ModelConfig = DEFAULT_MODEL_CONFIG): HighCapacityPushAdjustment {
  const exp = String(prefs.experience_level || '').toLowerCase();
  const advancedFlag = exp.includes('advanced') || exp.includes('elite') || exp.includes('expert');
  const athleteScore = Number(profile.athleteProfile?.overallScore ?? 0);
  const strengthPcts = Array.isArray(profile.strengthPercentiles) ? profile.strengthPercentiles : [];
  const avgStrengthPct = strengthPcts.length > 0
    ? strengthPcts.reduce((s, p) => s + Number(p.percentile || 0), 0) / strengthPcts.length
    : 0;
  const adherence = profile.prescribedVsActual?.complianceRate
    ?? profile.canonicalModelContext?.adherenceScore
    ?? 0.5;
  const rawReadiness = profile.fitnessFatigueModel?.readiness ?? null;
  const readiness = rawReadiness != null ? Number(rawReadiness) : null;
  const goal = getEffectiveGoal(prefs);

  const capabilitySignal = advancedFlag || athleteScore >= cfg.highCapAthleteScoreGate || avgStrengthPct >= cfg.highCapStrengthPctGate;
  if (!capabilitySignal) {
    return {
      active: false,
      tier: 'none',
      volumeMultiplier: 1.0,
      progressionMultiplier: 1.0,
      restSecondsMultiplier: 1.0,
      rirDelta: 0,
      reason: '',
    };
  }

  if (readiness == null || readiness < cfg.highCapReadinessGateOff || adherence < cfg.highCapAdherenceGateOff) {
    return {
      active: false,
      tier: 'none',
      volumeMultiplier: 1.0,
      progressionMultiplier: 1.0,
      restSecondsMultiplier: 1.0,
      rirDelta: 0,
      reason: `High-capacity mode gated off (readiness ${readiness != null ? Math.round(readiness * 100) : 'unknown'}%, adherence ${Math.round(adherence * 100)}%).`,
    };
  }

  const aggressive = readiness >= cfg.highCapAggressiveReadiness
    && adherence >= cfg.highCapAggressiveAdherence
    && (athleteScore >= cfg.highCapAggressiveAthleteScore || avgStrengthPct >= cfg.highCapAggressiveStrengthPct);
  let out: HighCapacityPushAdjustment = aggressive
    ? {
        active: true,
        tier: 'aggressive',
        volumeMultiplier: cfg.highCapAggressiveVolumeMult,
        progressionMultiplier: cfg.highCapAggressiveProgressionMult,
        restSecondsMultiplier: cfg.highCapAggressiveRestMult,
        rirDelta: cfg.highCapAggressiveRirDelta,
        reason: 'High-capacity mode (aggressive): increasing volume, progression pressure, and proximity to failure.',
      }
    : {
        active: true,
        tier: 'moderate',
        volumeMultiplier: cfg.highCapModerateVolumeMult,
        progressionMultiplier: cfg.highCapModerateProgressionMult,
        restSecondsMultiplier: cfg.highCapModerateRestMult,
        rirDelta: cfg.highCapModerateRirDelta,
        reason: 'High-capacity mode (moderate): pushing volume and intensity beyond conservative defaults.',
      };

  if (goal === 'cut') {
    out = {
      ...out,
      volumeMultiplier: Math.min(out.volumeMultiplier, aggressive ? 1.10 : 1.06),
      restSecondsMultiplier: Math.max(out.restSecondsMultiplier, aggressive ? 0.88 : 0.94),
      rirDelta: Math.max(out.rirDelta, -1),
      reason: `${out.reason} Cut phase guardrail: capped push to preserve lean mass.`,
    };
  }

  return out;
}

function computeFatLossController(profile: TrainingProfile, prefs: UserPreferences, cfg: ModelConfig = DEFAULT_MODEL_CONFIG): FatLossControllerAdjustment {
  const effectiveGoal = getEffectiveGoal(prefs);
  const fatLossActive = effectiveGoal === 'cut';
  const blankMeta = (): Pick<FatLossControllerAdjustment, 'weightTrendConfidence' | 'nutritionDampeningFactor' | 'userFacingLine'> => ({
    weightTrendConfidence: 0,
    nutritionDampeningFactor: 1,
    userFacingLine: '',
  });
  if (!fatLossActive) {
    return {
      active: false,
      mode: 'none',
      tier: 'none',
      cardioDurationMultiplier: 1.0,
      cardioIntensityMultiplier: 1.0,
      strengthVolumeMultiplier: 1.0,
      restSecondsMultiplier: 1.0,
      pid: { error: 0, integral: 0, derivative: 0, controlSignal: 0 },
      reason: '',
      ...blankMeta(),
    };
  }

  const rawReadiness = profile.fitnessFatigueModel?.readiness ?? null;
  const readiness = rawReadiness != null ? Number(rawReadiness) : null;
  const adherence = profile.prescribedVsActual?.complianceRate
    ?? profile.canonicalModelContext?.adherenceScore
    ?? 0.5;
  const slope = Number(profile.bodyWeightTrend?.slope ?? 0); // lbs/week
  const currentWeight = profile.bodyWeightTrend?.currentWeight ?? prefs.body_weight_lbs ?? null;
  const weightTrendConfidence = Number(profile.bodyWeightTrend?.trendConfidence ?? 0);

  if (currentWeight == null || !Number.isFinite(currentWeight)) {
    return {
      active: true,
      mode: 'pid',
      tier: 'none',
      cardioDurationMultiplier: 1.0,
      cardioIntensityMultiplier: 1.0,
      strengthVolumeMultiplier: 1.0,
      restSecondsMultiplier: 1.0,
      pid: { error: 0, integral: 0, derivative: 0, controlSignal: 0 },
      reason: 'Fat-loss controller: no reliable bodyweight signal yet; holding dose until trend is measurable.',
      weightTrendConfidence: 0,
      nutritionDampeningFactor: 1,
      userFacingLine: 'Fat-loss mode: log body weight a few times per week so cardio and lifting dose can follow your trend.',
    };
  }

  // PID-style controller:
  const targetSlope = -(currentWeight * cfg.fatLossTargetSlopeFraction);
  const longTermSlopePct = Number(profile.rolling30DayTrends?.bodyWeight?.slopePct ?? 0);
  const longTermSlopeLbs = Number.isFinite(longTermSlopePct) ? (currentWeight * (longTermSlopePct / 100)) : slope;
  const error = slope - targetSlope;        // >0 means not losing fast enough
  const integral = error + (longTermSlopeLbs - targetSlope) * 0.5;
  const derivative = slope - longTermSlopeLbs;

  const controlRaw = (cfg.fatLossPidKp * error) + (cfg.fatLossPidKi * integral) + (cfg.fatLossPidKd * derivative);
  let controlSignal = clampNumber(controlRaw, cfg.fatLossControlClamp[0], cfg.fatLossControlClamp[1]);

  // Anti-windup and adherence-aware dampening.
  if (adherence < cfg.fatLossAdherenceThreshold) {
    controlSignal = clampNumber(controlSignal, cfg.fatLossLowAdherenceClamp[0], cfg.fatLossLowAdherenceClamp[1]);
  }

  // Sparse weight data → do not fully trust escalation (quality gate).
  if (weightTrendConfidence < cfg.fatLossConfidenceThreshold) {
    const scale = cfg.fatLossConfidenceFloor + (1 - cfg.fatLossConfidenceFloor) * (weightTrendConfidence / cfg.fatLossConfidenceThreshold);
    controlSignal *= scale;
  }

  // Nutrition logging + adherence: avoid blaming training when intake is unknown or chaotic.
  const nutritionCov = profile.nutritionLoggingCoverage14d;
  const nutritionAdherence = getNutritionAdherenceSignal(profile);
  let nutritionDampeningFactor = 1;
  if (nutritionCov != null && nutritionCov < cfg.fatLossNutritionCoverageThreshold && nutritionAdherence < cfg.fatLossNutritionAdherenceThreshold) {
    nutritionDampeningFactor = cfg.fatLossNutritionCoverageFloor + (1 - cfg.fatLossNutritionCoverageFloor) * (nutritionCov / cfg.fatLossNutritionCoverageThreshold);
    controlSignal *= nutritionDampeningFactor;
  } else if (nutritionAdherence < cfg.fatLossNutritionAdherenceLowThreshold) {
    nutritionDampeningFactor = cfg.fatLossNutritionAdherenceLowFloor + (1 - cfg.fatLossNutritionAdherenceLowFloor) * nutritionAdherence;
    controlSignal *= nutritionDampeningFactor;
  }
  controlSignal = clampNumber(controlSignal, cfg.fatLossControlClamp[0], cfg.fatLossControlClamp[1]);

  // Split dose: bias toward cardio / NEAT-equivalent duration before lifting volume.
  const cardioDurationMultiplier = clampNumber(1 + controlSignal * cfg.fatLossCardioDurationSensitivity, cfg.fatLossCardioDurationClamp[0], cfg.fatLossCardioDurationClamp[1]);
  const cardioIntensityMultiplier = clampNumber(1 + controlSignal * cfg.fatLossCardioIntensitySensitivity, cfg.fatLossCardioIntensityClamp[0], cfg.fatLossCardioIntensityClamp[1]);
  const strengthVolumeMultiplier = clampNumber(1 + controlSignal * cfg.fatLossStrengthVolumeSensitivity, cfg.fatLossStrengthVolumeClamp[0], cfg.fatLossStrengthVolumeClamp[1]);
  const restSecondsMultiplier = clampNumber(1 - controlSignal * cfg.fatLossRestSecondsSensitivity, cfg.fatLossRestSecondsClamp[0], cfg.fatLossRestSecondsClamp[1]);

  let tier: FatLossControllerAdjustment['tier'] = 'on_track';
  if (controlSignal > cfg.fatLossTierThresholds.stalled) tier = 'stalled';
  else if (controlSignal > cfg.fatLossTierThresholds.slowLoss) tier = 'slow_loss';
  else if (controlSignal < cfg.fatLossTierThresholds.tooFast) tier = 'too_fast';

  const userFacingParts: string[] = [
    `Weight ~${Math.round(currentWeight)} lbs — trend ${slope >= 0 ? '+' : ''}${slope.toFixed(2)} lbs/wk (goal slope ~${targetSlope.toFixed(2)} lbs/wk).`,
    `Auto-dose: cardio time ×${cardioDurationMultiplier.toFixed(2)}, cardio intensity ×${cardioIntensityMultiplier.toFixed(2)}, strength volume ×${strengthVolumeMultiplier.toFixed(2)}.`,
  ];
  if (weightTrendConfidence < cfg.fatLossConfidenceThreshold) {
    userFacingParts.push('Weight samples still sparse — dose changes stay conservative until the trend firms up.');
  }
  if (nutritionDampeningFactor < 0.97) {
    userFacingParts.push('Nutrition signal weak — training escalation is damped (log food intake for tighter coupling).');
  }

  let out: FatLossControllerAdjustment = {
    active: true,
    mode: 'pid',
    tier,
    cardioDurationMultiplier,
    cardioIntensityMultiplier,
    strengthVolumeMultiplier,
    restSecondsMultiplier,
    pid: {
      error,
      integral,
      derivative,
      controlSignal,
    },
    reason: `Fat-loss PID: target ${targetSlope.toFixed(2)} lbs/wk, observed ${slope.toFixed(2)} lbs/wk, control ${controlSignal.toFixed(2)} (wt conf ${(weightTrendConfidence * 100).toFixed(0)}%, nutrition damp ×${nutritionDampeningFactor.toFixed(2)}).`,
    weightTrendConfidence,
    nutritionDampeningFactor,
    userFacingLine: userFacingParts.join(' '),
  };

  // Recovery guardrails: do not force hard escalation on low-readiness days.
  // Skip when readiness is unknown (conservative = don't modify).
  if (readiness != null && readiness < 0.65) {
    out.cardioIntensityMultiplier = Math.min(out.cardioIntensityMultiplier, 1.0);
    out.strengthVolumeMultiplier = Math.min(out.strengthVolumeMultiplier, 1.0);
    out.restSecondsMultiplier = Math.max(out.restSecondsMultiplier, 1.0);
    if (readiness < 0.50) {
      out.cardioDurationMultiplier = Math.min(out.cardioDurationMultiplier, 1.10);
    }
    out.reason += ` Recovery guardrail active (readiness ${Math.round(readiness * 100)}%).`;
    out.userFacingLine += ` Readiness ${Math.round(readiness * 100)}% — kept strength stress in check.`;
  }

  return out;
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

type MuscleGroupSelection = MuscleGroupDecision;

const SPLIT_MUSCLE_MAPPING: Record<string, CanonicalMuscleGroup[]> = {
  push: ['upper_chest', 'mid_chest', 'lower_chest', 'anterior_deltoid', 'lateral_deltoid', 'triceps'],
  pull: ['back_lats', 'back_upper', 'upper_traps', 'mid_traps', 'lower_traps', 'biceps', 'posterior_deltoid', 'forearms', 'rotator_cuff'],
  legs: ['quadriceps', 'hamstrings', 'glutes', 'hip_flexors', 'abductors', 'adductors'],
  upper: ['upper_chest', 'mid_chest', 'lower_chest', 'back_lats', 'anterior_deltoid', 'biceps', 'triceps'],
  lower: ['quadriceps', 'hamstrings', 'glutes', 'hip_flexors', 'abductors', 'adductors'],
  full: ['mid_chest', 'back_lats', 'quadriceps', 'hamstrings', 'glutes', 'lateral_deltoid'],
};

const SPLIT_TYPE_ROTATIONS: Record<string, string[]> = {
  push_pull_legs: ['push', 'pull', 'legs'],
  upper_lower: ['upper', 'lower'],
  full_body: ['full'],
  bro_split: ['chest', 'back', 'shoulders', 'arms', 'legs'],
};

const BRO_SPLIT_MAPPING: Record<string, CanonicalMuscleGroup[]> = {
  chest: ['upper_chest', 'mid_chest', 'lower_chest'],
  back: ['back_lats', 'back_upper', 'upper_traps', 'mid_traps', 'lower_traps'],
  shoulders: ['anterior_deltoid', 'lateral_deltoid', 'posterior_deltoid'],
  arms: ['biceps', 'triceps', 'forearms'],
};

/**
 * Synergist mapping — for each primary muscle, the secondary muscles it
 * naturally pairs with in a session (e.g. triceps + chest, biceps + back).
 *
 * Used by:
 *   - stepSelectMuscleGroups: expand the split target set so accessories
 *     are allowed alongside the primary
 *   - deriveDayTheme: build the `allowedAccessories` for a `DayTheme`
 *
 * NOT exhaustive: groups missing here (e.g. `core`, `cardio`, `calves`)
 * are universally allowed — see `UNIVERSAL_ACCESSORIES` below.
 */
const SPLIT_SYNERGISTS: Record<string, string[]> = {
  upper_chest: ['triceps', 'anterior_deltoid', 'mid_chest', 'lower_chest'],
  mid_chest: ['triceps', 'anterior_deltoid', 'upper_chest', 'lower_chest'],
  lower_chest: ['triceps', 'mid_chest', 'upper_chest'],
  back_lats: ['biceps', 'posterior_deltoid', 'lower_traps', 'forearms'],
  back_upper: ['biceps', 'mid_traps', 'forearms'],
  upper_traps: ['mid_traps', 'lateral_deltoid'],
  mid_traps: ['back_upper', 'lower_traps', 'posterior_deltoid'],
  lower_traps: ['mid_traps', 'rotator_cuff'],
  quadriceps: ['glutes', 'hamstrings', 'hip_flexors', 'abductors', 'adductors'],
  hamstrings: ['glutes', 'quadriceps'],
  glutes: ['quadriceps', 'hamstrings', 'abductors'],
  anterior_deltoid: ['lateral_deltoid', 'triceps', 'upper_chest', 'mid_chest'],
  lateral_deltoid: ['anterior_deltoid', 'posterior_deltoid', 'upper_traps'],
  posterior_deltoid: ['mid_traps', 'rotator_cuff', 'back_upper'],
  triceps: ['mid_chest', 'upper_chest', 'anterior_deltoid'],
  biceps: ['back_lats', 'back_upper', 'forearms'],
  rotator_cuff: ['posterior_deltoid', 'lower_traps'],
  hip_flexors: ['quadriceps', 'core'],
};

/**
 * Muscle groups that are always permissible regardless of split focus.
 * `cardio` is handled by Phase 2 weekly-frequency logic but we keep it here
 * so per-day theme filters never reject it. `core` and `calves` are similarly
 * "free" — they don't conflict with any split.
 */
const UNIVERSAL_ACCESSORIES: readonly string[] = ['core', 'calves', 'cardio'];

/**
 * Expand a set of primary muscle groups to include their synergists and
 * universally-accessible muscles. Pure function; no side effects.
 */
function expandWithSynergists(primaries: ReadonlySet<string> | string[]): Set<string> {
  const out = new Set<string>(typeof (primaries as Set<string>).has === 'function'
    ? Array.from(primaries as Set<string>)
    : (primaries as string[]));
  for (const g of out) {
    for (const syn of (SPLIT_SYNERGISTS[g] ?? [])) out.add(syn);
  }
  for (const ua of UNIVERSAL_ACCESSORIES) out.add(ua);
  return out;
}

/**
 * Build a `DayTheme` from a focus label and the muscle groups assigned to
 * the day. The theme codifies what the day is "about" so downstream selectors
 * and validators have a stable contract.
 *
 * Primary muscle: the first group in `muscleGroups` (already ordered by the
 * planner / split mapping). For a chest day the primary will be one of the
 * chest sub-groups; for a leg day it will be quadriceps; etc.
 *
 * Allowed accessories: `muscleGroups ∪ synergists(muscleGroups) ∪ universals`.
 * Anything outside this set will be rejected when `source === 'schedule'`.
 */
/**
 * Muscle groups that must NEVER be the primary focus of a training day.
 *
 * Rationale: these are conditioning / accessory muscles whose stimulus is
 * cheap, fast, and best distributed across the whole week rather than
 * concentrated into a "dedicated day". Specifically:
 *
 *   - core/abs: max useful direct volume is ~6–8 working sets per session
 *     (Schoenfeld dose-response work + recovery considerations); past that
 *     point you're wasting session time that should go to a primary movement.
 *     A dedicated "abs day" therefore over-allocates time to a muscle that
 *     responds best to daily low-dose stimulus.
 *   - calves: same logic — high-frequency low-dose beats a once-a-week
 *     blowout.
 *   - cardio: a "cardio day" is conditioning, not a strength theme; the
 *     planner already handles it via the cardio policy block.
 *
 * If the schedule lists *only* one of these groups for a day, the engine
 * treats that as "no strength theme set" and falls through to the rotation
 * / detected-pattern fallback, which gives a real primary focus.
 */
const NON_PRIMARY_THEME_GROUPS: ReadonlySet<string> = new Set(['core', 'abs', 'abdominals', 'calves', 'cardio']);

export function deriveDayTheme(
  focus: string,
  muscleGroups: string[],
  source: DayTheme['source'],
): DayTheme | null {
  const groups = (muscleGroups ?? []).filter(g => typeof g === 'string' && g.length > 0);
  if (groups.length === 0) return null;

  // Demote core/abs/calves/cardio out of the primary slot. The user's
  // explicit complaint: "the week ahead has one day that's all abs". That
  // happens when the schedule pins primary=core. We never want abs to
  // anchor a day's identity — they're a daily accessory, not a focus.
  const primaryEligible = groups.filter(g => !NON_PRIMARY_THEME_GROUPS.has(String(g).toLowerCase()));
  if (primaryEligible.length === 0) {
    // Schedule is core/calves/cardio only with no strength primary. Refuse
    // to set this as a themed day — the caller will fall through to the
    // rotation or detected-pattern fallback and pick a real primary.
    return null;
  }
  const primary = primaryEligible[0];
  // For a strict split, allowedAccessories = the OTHER muscles in the same
  // split mapping. We do NOT expand with synergists here because the
  // canonical split mappings (e.g. PPL push = [chest, front delt, side
  // delt, triceps]) already represent the intended scope. Expanding by
  // synergists pulled in muscles like posterior_deltoid (a pull-day
  // muscle) and upper_traps, breaking split adherence. Synergists are
  // still allowed implicitly because pressing recruits them as
  // secondaries — what we control here is what the *engine* will pick
  // as a session theme, not what muscles get incidental work.
  const allowed = groups.filter(g => g !== primary);
  return {
    primary,
    allowedAccessories: allowed,
    source,
  };
}

/**
 * When the caller does not pass `SessionOverrides.dayTheme`, derive the same
 * theme the weekly planner would use so standalone `generateWorkout` calls get
 * hard split constraints (schedule → rotation from `preferred_split`).
 */
function resolveEffectiveDayTheme(
  prefs: UserPreferences,
  planningDow: number,
  overrideTheme: DayTheme | null | undefined,
): DayTheme | null {
  if (overrideTheme?.primary) return overrideTheme;

  const weekly = prefs.weekly_split_schedule?.[String(planningDow)];
  if (weekly?.groups?.length) {
    const groups = normalizeMuscleGroupList(weekly.groups);
    const focus = weekly.focus || '';
    return deriveDayTheme(focus, groups, 'schedule');
  }

  const splitKey = prefs.preferred_split;
  if (splitKey && SPLIT_TYPE_ROTATIONS[splitKey]) {
    const rotation = SPLIT_TYPE_ROTATIONS[splitKey];
    const restDays = new Set(prefs.rest_days ?? []);
    let trainingSlot = 0;
    for (let d = 0; d < 7; d++) {
      const dow = (d + 1) % 7;
      if (restDays.has(dow)) continue;
      if (dow === planningDow) break;
      trainingSlot++;
    }
    const splitName = rotation[trainingSlot % rotation.length];
    const groups = BRO_SPLIT_MAPPING[splitName] ?? SPLIT_MUSCLE_MAPPING[splitName];
    if (groups?.length) {
      const focus = splitName.replace(/_/g, ' ');
      return deriveDayTheme(focus, [...groups], 'rotation');
    }
  }

  return null;
}

function computeHipAbductorLoadSignal(profile: TrainingProfile): {
  weeklyAmbulatoryHours: number;
  externalHipLoadScore: number;
  internalHipLoadScore: number;
  abductorPriorityBoost: number;
  adductorPriorityBoost: number;
  adductorPriorityPenalty: number;
  adaptiveSuppression: number;
  suppressDirectIsolation: boolean;
  shouldFrontLoadAbductors: boolean;
} {
  const WEEKS_WINDOW = 4;
  const cardio = profile.cardioHistory ?? [];
  const ambulatory = cardio.filter(c => {
    const m = classifyCardioModality(String(c.exerciseName || '').toLowerCase());
    return m === 'walk' || m === 'stair';
  });
  const weeklyAmbulatoryHours = ambulatory.reduce((sum, c) => {
    const weeklyMinutes = ((c.avgDurationSeconds ?? 0) / 60) * ((c.recentSessions ?? 0) / WEEKS_WINDOW);
    return sum + (weeklyMinutes / 60);
  }, 0);
  const inclineWeightedHours = ambulatory.reduce((sum, c) => {
    const baseHours = (((c.avgDurationSeconds ?? 0) / 60) * ((c.recentSessions ?? 0) / WEEKS_WINDOW)) / 60;
    const incline = Number(c.avgIncline ?? 0);
    const inclineFactor = incline > 0 ? (1 + Math.min(0.8, incline / 12)) : 1;
    return sum + (baseHours * inclineFactor);
  }, 0);
  const stairHours = cardio
    .filter(c => classifyCardioModality(String(c.exerciseName || '').toLowerCase()) === 'stair')
    .reduce((sum, c) => sum + ((((c.avgDurationSeconds ?? 0) / 60) * ((c.recentSessions ?? 0) / WEEKS_WINDOW)) / 60), 0);

  // External hip demand: gait/frontal-plane stabilization, especially incline/stairs.
  const externalHipLoadScore = clampNumber(weeklyAmbulatoryHours * 0.55 + inclineWeightedHours * 0.35 + stairHours * 0.45, 0, 3);
  // Internal hip demand: currently inferred from dedicated adduction/cardio signals (low until direct data exists).
  const adductionSpecificHours = cardio
    .filter(c => /adduct|copenhagen|lateral lunge|sumo/i.test(c.exerciseName))
    .reduce((sum, c) => sum + ((((c.avgDurationSeconds ?? 0) / 60) * ((c.recentSessions ?? 0) / WEEKS_WINDOW)) / 60), 0);
  const internalHipLoadScore = clampNumber(adductionSpecificHours * 1.2 + Math.max(0, weeklyAmbulatoryHours - inclineWeightedHours) * 0.08, 0, 2.2);
  const hipLoadImbalance = Math.max(0, externalHipLoadScore - internalHipLoadScore);
  const volumeByGroup = new Map((profile.muscleVolumeStatuses ?? []).map(v => [String(v.muscleGroup || '').toLowerCase(), Number(v.weeklyDirectSets || 0)]));
  const freqByGroup = profile.muscleGroupFrequency ?? {};
  const abductorDirect = Math.max(0, Number(volumeByGroup.get('abductors') ?? 0));
  const adductorDirect = Math.max(0, Number(volumeByGroup.get('adductors') ?? 0));
  const hipDirectExposure = abductorDirect + adductorDirect;
  const hipFreq = Math.max(0, Number(freqByGroup.abductors ?? 0)) + Math.max(0, Number(freqByGroup.adductors ?? 0));
  const targetDirectBand = 8; // adaptive center for combined direct hip-isolation stimulus
  const volumeSaturation = clampNumber((hipDirectExposure - targetDirectBand) / Math.max(targetDirectBand, 1), 0, 1.25);
  const freqSaturation = clampNumber((hipFreq - 2.1) / 1.6, 0, 1.2);
  const adaptiveSuppression = clampNumber(1 - (volumeSaturation * 0.55) - (freqSaturation * 0.45), 0.25, 1);

  const abductorPriorityBoostRaw = externalHipLoadScore >= 0.35
    ? clampNumber(0.06 + externalHipLoadScore * 0.12, 0, 0.46)
    : 0;
  const adductorPriorityBoostRaw = internalHipLoadScore >= 0.55
    ? clampNumber(0.05 + internalHipLoadScore * 0.08, 0, 0.22)
    : 0;
  const adductorPriorityPenaltyRaw = hipLoadImbalance >= 0.6
    ? clampNumber(hipLoadImbalance * 0.08, 0, 0.18)
    : 0;
  const abductorPriorityBoost = clampNumber(abductorPriorityBoostRaw * adaptiveSuppression, 0, 0.46);
  const adductorPriorityBoost = clampNumber(adductorPriorityBoostRaw * adaptiveSuppression, 0, 0.22);
  const adductorPriorityPenalty = clampNumber(
    adductorPriorityPenaltyRaw + (adaptiveSuppression < 0.7 ? (0.7 - adaptiveSuppression) * 0.12 : 0),
    0,
    0.24
  );
  const suppressDirectIsolation = hipDirectExposure >= (targetDirectBand * 1.25) || hipFreq >= 3.1;
  return {
    weeklyAmbulatoryHours,
    externalHipLoadScore,
    internalHipLoadScore,
    abductorPriorityBoost,
    adductorPriorityBoost,
    adductorPriorityPenalty,
    adaptiveSuppression,
    suppressDirectIsolation,
    shouldFrontLoadAbductors: externalHipLoadScore >= 0.9 && adaptiveSuppression >= 0.7,
  };
}

type CouplingSignal = {
  priorityDelta: number;
  reasons: string[];
};

function computeSystemCouplingSignals(
  profile: TrainingProfile,
  hipSignal: ReturnType<typeof computeHipAbductorLoadSignal>
): Record<string, CouplingSignal> {
  const byGroup: Record<string, CouplingSignal> = {};
  const ensure = (group: string): CouplingSignal => {
    if (!byGroup[group]) byGroup[group] = { priorityDelta: 0, reasons: [] };
    return byGroup[group];
  };
  const add = (group: string, delta: number, reason: string) => {
    const g = ensure(group);
    g.priorityDelta += delta;
    if (!g.reasons.includes(reason)) g.reasons.push(reason);
  };

  // Hip mechanics (external vs internal) are one component of whole-system coupling.
  if (hipSignal.abductorPriorityBoost > 0) {
    add('abductors', hipSignal.abductorPriorityBoost, `external-hip demand ${hipSignal.externalHipLoadScore.toFixed(2)}`);
  }
  if (hipSignal.adductorPriorityBoost > 0) {
    add('adductors', hipSignal.adductorPriorityBoost, `internal-hip demand ${hipSignal.internalHipLoadScore.toFixed(2)}`);
  }
  if (hipSignal.adductorPriorityPenalty > 0) {
    add('adductors', -hipSignal.adductorPriorityPenalty, `external/internal hip imbalance`);
  }
  if (hipSignal.adaptiveSuppression < 0.95) {
    const suppressionPenalty = clampNumber((1 - hipSignal.adaptiveSuppression) * 0.18, 0.01, 0.14);
    add('abductors', -suppressionPenalty, `hip direct-dose saturation (${hipSignal.adaptiveSuppression.toFixed(2)})`);
    add('adductors', -suppressionPenalty, `hip direct-dose saturation (${hipSignal.adaptiveSuppression.toFixed(2)})`);
  }
  if (hipSignal.weeklyAmbulatoryHours >= 3) {
    const calfBoost = clampNumber((hipSignal.weeklyAmbulatoryHours - 2.5) * 0.03, 0, 0.12);
    // Calves excluded from direct work — skip calf boost
  }

  const patternMap: Record<string, string[]> = {
    horizontal_push: ['mid_chest', 'upper_chest', 'lower_chest', 'anterior_deltoid', 'triceps'],
    vertical_push: ['anterior_deltoid', 'lateral_deltoid', 'triceps'],
    horizontal_pull: ['back_upper', 'back_lats', 'mid_traps', 'posterior_deltoid', 'biceps', 'forearms'],
    vertical_pull: ['back_lats', 'back_upper', 'biceps', 'forearms', 'lower_traps'],
    hip_hinge: ['hamstrings', 'glutes', 'erector_spinae'],
    knee_dominant: ['quadriceps', 'glutes', 'adductors', 'hip_flexors'],
    isolation_upper: ['biceps', 'triceps', 'lateral_deltoid', 'posterior_deltoid', 'forearms', 'rotator_cuff'],
    isolation_lower: ['abductors', 'adductors', 'quadriceps', 'hamstrings', 'hip_flexors'],
    anti_rotation: ['core', 'erector_spinae', 'abductors'],
    rotation: ['core', 'abductors', 'adductors'],
  };

  for (const p of profile.movementPatternFatigue ?? []) {
    const impacted = patternMap[p.pattern] ?? [];
    if (impacted.length === 0) continue;
    if (p.fatigueLevel === 'high') {
      for (const g of impacted) add(g, -0.12, `${p.pattern} fatigue high`);
    } else if (p.fatigueLevel === 'moderate') {
      for (const g of impacted) add(g, -0.06, `${p.pattern} fatigue moderate`);
    } else if ((p.weeklySessionCount ?? 0) <= 1) {
      for (const g of impacted) add(g, 0.03, `${p.pattern} freshness`);
    }
  }

  for (const [group, freqRaw] of Object.entries(profile.muscleGroupFrequency ?? {})) {
    const freq = Number(freqRaw || 0);
    if (!Number.isFinite(freq)) continue;
    if (freq >= 2.8) {
      const penalty = clampNumber((freq - 2.8) * 0.09, 0, 0.2);
      if (penalty > 0) add(group, -penalty, `high recent frequency ${freq.toFixed(1)}/wk`);
    } else if (freq > 0 && freq < 0.8) {
      const boost = clampNumber((0.8 - freq) * 0.12, 0, 0.1);
      if (boost > 0) add(group, boost, `low recent frequency ${freq.toFixed(1)}/wk`);
    }
  }

  // Antagonist ratio governance: keep key movement systems in a healthy corridor.
  // These are soft constraints (priority nudges), not hard-coded templates.
  const directSetsByGroup = new Map<string, number>();
  for (const v of profile.muscleVolumeStatuses ?? []) {
    const g = String(v?.muscleGroup ?? '').toLowerCase();
    if (!g) continue;
    const sets = Number(v?.weeklyDirectSets ?? 0);
    directSetsByGroup.set(g, Number.isFinite(sets) ? Math.max(0, sets) : 0);
  }
  const sumSets = (groups: string[]): number =>
    groups.reduce((s, g) => s + (directSetsByGroup.get(g) ?? 0), 0);
  const applyRatioBalance = (
    label: string,
    numeratorGroups: string[],
    denominatorGroups: string[],
    minRatio: number,
    maxRatio: number,
    maxDelta: number
  ) => {
    const numSets = sumSets(numeratorGroups);
    const denSets = sumSets(denominatorGroups);
    const total = numSets + denSets;
    if (total < 4) return; // low evidence; avoid noisy corrections

    // Laplace smoothing avoids ratio blow-ups when one side is near zero.
    const ratio = (numSets + 1) / (denSets + 1);
    const reliability = clampNumber(total / 18, 0.25, 1);

    if (ratio < minRatio) {
      const gap = clampNumber((minRatio - ratio) / Math.max(minRatio, 0.01), 0, 1.5);
      const delta = clampNumber(gap * maxDelta * reliability, 0.02, maxDelta);
      for (const g of numeratorGroups) add(g, delta, `${label} ratio low (${ratio.toFixed(2)})`);
      for (const g of denominatorGroups) add(g, -delta * 0.45, `${label} ratio low (${ratio.toFixed(2)})`);
    } else if (ratio > maxRatio) {
      const gap = clampNumber((ratio - maxRatio) / Math.max(maxRatio, 0.01), 0, 1.5);
      const delta = clampNumber(gap * maxDelta * reliability, 0.02, maxDelta);
      for (const g of numeratorGroups) add(g, -delta * 0.45, `${label} ratio high (${ratio.toFixed(2)})`);
      for (const g of denominatorGroups) add(g, delta, `${label} ratio high (${ratio.toFixed(2)})`);
    }
  };

  // Evidence-based corridors from injury-risk and posture/performance programming norms:
  // - Posterior chain/pull should not lag pressing.
  // - Knee-dominant and hip-dominant lower-body stress should be balanced.
  applyRatioBalance('back:chest', ['back_lats', 'back_upper', 'upper_traps', 'mid_traps', 'lower_traps'], ['upper_chest', 'mid_chest', 'lower_chest'], 1.05, 1.9, 0.16);
  applyRatioBalance('hamstrings:quadriceps', ['hamstrings'], ['quadriceps'], 0.7, 1.35, 0.15);
  applyRatioBalance(
    'pull:push',
    ['back_lats', 'back_upper', 'upper_traps', 'mid_traps', 'lower_traps', 'posterior_deltoid', 'biceps', 'forearms'],
    ['upper_chest', 'mid_chest', 'lower_chest', 'anterior_deltoid', 'lateral_deltoid', 'triceps'],
    0.95,
    1.8,
    0.14
  );
  applyRatioBalance(
    'vertical-pull:vertical-push',
    ['back_lats', 'back_upper', 'biceps'],
    ['anterior_deltoid', 'lateral_deltoid', 'triceps'],
    0.9,
    1.8,
    0.12
  );
  applyRatioBalance(
    'hip-dominant:knee-dominant',
    ['hamstrings', 'glutes', 'erector_spinae', 'adductors'],
    ['quadriceps', 'hip_flexors'],
    0.9,
    1.6,
    0.13
  );
  applyRatioBalance(
    'rear-delt:front-delt',
    ['posterior_deltoid'],
    ['anterior_deltoid'],
    0.75,
    2.0,
    0.1
  );

  for (const [group, delta] of Object.entries(profile.prescribedVsActual?.muscleGroupExecutionDeltas ?? {})) {
    const sample = Number(delta?.sampleSize ?? 0);
    if (!Number.isFinite(sample) || sample < 2) continue;
    const completionRate = clampNumber(Number(delta?.completionRate ?? 0), 0, 1);
    const wDev = clampNumber(Number(delta?.avgWeightDeviation ?? 0), -0.5, 0.5);
    const rDev = clampNumber(Number(delta?.avgRepsDeviation ?? 0), -8, 8);
    const executionSignal = clampNumber((wDev * 0.9) + (rDev / 14), -0.45, 0.45);
    const reliability = clampNumber(sample / 8, 0.25, 1);

    // Strong positive execution + completion => capacity headroom, increase priority gradually.
    if (completionRate >= 0.72 && executionSignal > 0.06) {
      const boost = clampNumber(executionSignal * 0.22 * reliability, 0.02, 0.13);
      add(group, boost, `execution outperformance (${Math.round(completionRate * 100)}% complete)`);
    }

    // Low completion or underperformance => scale back near-term stress on that group.
    if (completionRate < 0.58 || executionSignal < -0.08) {
      const missPenalty = clampNumber((0.62 - completionRate) * 0.22, 0, 0.12);
      const underPenalty = executionSignal < 0 ? clampNumber(Math.abs(executionSignal) * 0.2 * reliability, 0.01, 0.14) : 0;
      const penalty = Math.max(missPenalty, underPenalty);
      if (penalty > 0) add(group, -penalty, `execution under-target (${Math.round(completionRate * 100)}% complete)`);
    }
  }

  return byGroup;
}

function stepSelectMuscleGroups(
  profile: TrainingProfile,
  prefs: UserPreferences,
  recoveryAdj: RecoveryAdjustment,
  cfg: ModelConfig,
  caloricPhaseScale: number = 1.0,
  dayOfWeekOverride?: number,
  preferredGroups?: string[],
  /**
   * Phase 1: when set, this theme drives the hard selection filter and
   * overrides the auto-derived `splitTargetGroups` priority chain. A
   * `schedule`- or `rotation`-sourced theme is enforced strictly (no fallback
   * to all candidates if the filter is empty).
   */
  activeDayTheme?: DayTheme | null,
): { selected: MuscleGroupSelection[]; skipped: Array<{ muscleGroup: string; reason: string }> } {
  const candidates: MuscleGroupSelection[] = [];
  const skipped: Array<{ muscleGroup: string; reason: string }> = [];

  // Determine today's target groups from detected split or user preference
  const { detectedSplit, dayOfWeekPatterns } = profile;
  const todayDow = dayOfWeekOverride ?? new Date().getDay();
  const todayPattern = dayOfWeekPatterns[todayDow];
  const hipAbductorSignal = computeHipAbductorLoadSignal(profile);
  const systemCouplingSignals = computeSystemCouplingSignals(profile, hipAbductorSignal);

  let splitTargetGroups: Set<string> | null = null;
  const preferredGroupSet = new Set<string>(normalizeMuscleGroupList(preferredGroups ?? []));
  const todayPatternGroups = normalizeMuscleGroupList(todayPattern?.muscleGroupsTypical ?? []);
  const priorityMuscleSet = new Set<string>(normalizeMuscleGroupList(prefs.priority_muscles ?? []));
  const isPriorityMuscle = (group: string) => priorityMuscleSet.has(group);

  // Phase 1: an explicit `activeDayTheme` (typically from weekly_split_schedule)
  // is the highest-priority source of truth and short-circuits the rotation /
  // detected-pattern fallbacks below.
  if (activeDayTheme && activeDayTheme.primary) {
    const themeGroups = normalizeMuscleGroupList([
      activeDayTheme.primary,
      ...activeDayTheme.allowedAccessories,
    ]);
    if (themeGroups.length > 0) {
      splitTargetGroups = new Set(themeGroups);
    }
  }

  // Weekly split schedule: user-defined per-day muscle groups (highest priority)
  if (!splitTargetGroups && prefs.weekly_split_schedule) {
    const dayKey = String(todayDow);
    const daySchedule = prefs.weekly_split_schedule[dayKey];
    if (daySchedule && daySchedule.groups?.length > 0) {
      splitTargetGroups = new Set(normalizeMuscleGroupList(daySchedule.groups));
    }
  }

  // User's explicit split preference takes priority over historical patterns.
  if (!splitTargetGroups && prefs.preferred_split && SPLIT_TYPE_ROTATIONS[prefs.preferred_split]) {
    // User explicitly set a split type — use it to determine today's focus.
    // Build a slot-based rotation that skips rest days.
    const rotation = SPLIT_TYPE_ROTATIONS[prefs.preferred_split];
    const restDays = new Set(prefs.rest_days ?? []);
    if (dayOfWeekOverride != null) {
      // Count training days from Monday up to (and including) this day
      let trainingSlot = 0;
      for (let d = 0; d < 7; d++) {
        const dow = (d + 1) % 7; // Monday=1, ..., Sunday=0
        if (restDays.has(dow)) continue;
        if (dow === todayDow) break;
        trainingSlot++;
      }
      const splitName = rotation[trainingSlot % rotation.length];
      const groups = (BRO_SPLIT_MAPPING[splitName] ?? SPLIT_MUSCLE_MAPPING[splitName]);
      if (groups?.length) splitTargetGroups = new Set(groups);
    } else {
      // Strict rotation from day of week — do NOT merge detected patterns when user explicitly set a split.
      const restDays = new Set(prefs.rest_days ?? []);
      let trainingSlot = 0;
      for (let d = 0; d < 7; d++) {
        const dow = (d + 1) % 7;
        if (restDays.has(dow)) continue;
        if (dow === todayDow) break;
        trainingSlot++;
      }
      const splitName = rotation[trainingSlot % rotation.length];
      const groups = (BRO_SPLIT_MAPPING[splitName] ?? SPLIT_MUSCLE_MAPPING[splitName]);
      if (groups?.length) splitTargetGroups = new Set(groups);
    }
  } else if (dayOfWeekOverride != null && detectedSplit.typicalRotation.length > 0) {
    // No explicit split pref — use detected rotation, slot-aware (skip rest days).
    const rotation = detectedSplit.typicalRotation;
    const restDays = new Set(prefs.rest_days ?? []);
    let trainingSlot = 0;
    for (let d = 0; d < 7; d++) {
      const dow = (d + 1) % 7;
      if (restDays.has(dow)) continue;
      if (dow === todayDow) break;
      trainingSlot++;
    }
    const splitName = rotation[trainingSlot % rotation.length];
    const groups = SPLIT_MUSCLE_MAPPING[splitName];
    if (groups?.length) splitTargetGroups = new Set(groups);
  } else if (detectedSplit.confidence >= cfg.splitConfidenceThreshold && detectedSplit.nextRecommended.length > 0) {
    splitTargetGroups = new Set<string>();
    for (const rec of detectedSplit.nextRecommended) {
      const groups = SPLIT_MUSCLE_MAPPING[rec];
      if (groups) groups.forEach(g => splitTargetGroups!.add(g));
    }
  } else if (todayPattern && !todayPattern.isRestDay && todayPatternGroups.length > 0) {
    // Fall back to day-of-week pattern
    splitTargetGroups = new Set(todayPatternGroups);
  }

  // ── Cardio-strength interference (Wilson et al. 2012 meta-analysis) ──
  // Heavy cardio reduces effective MRV for lower body muscles.
  // Running/stairmaster (high eccentric): high interference
  // Cycling/elliptical/row and brisk incline walking: low interference
  // Easy walking: near-zero interference
  const LOWER_BODY_GROUPS = new Set(['quadriceps', 'hamstrings', 'glutes', 'abductors', 'adductors', 'hip_flexors', 'calves']);
  let cardioInterferencePct = 0;
  const WEEKS_WINDOW = 4;
  const weeklyCardioMin = profile.cardioHistory.reduce((sum, c) => {
    return sum + (c.avgDurationSeconds / 60) * c.recentSessions / WEEKS_WINDOW;
  }, 0);
  const weeklyCardioHours = weeklyCardioMin / 60;

  if (weeklyCardioHours > 0) {
    const highImpactCardio = profile.cardioHistory.filter(c => {
      const m = classifyCardioModality(String(c.exerciseName || '').toLowerCase());
      return m === 'run' || m === 'stair';
    });
    const lowImpactCardio = profile.cardioHistory.filter(c => {
      const m = classifyCardioModality(String(c.exerciseName || '').toLowerCase());
      return m === 'bike' || m === 'elliptical' || m === 'row';
    });
    const briskWalkCardio = profile.cardioHistory.filter(c => {
      const m = classifyCardioModality(String(c.exerciseName || '').toLowerCase());
      if (m !== 'walk') return false;
      const speed = Number(c.avgSpeed ?? 0);
      const incline = Number(c.avgIncline ?? 0);
      return speed >= 3.8 || incline >= 4;
    });

    const highImpactHours = highImpactCardio.reduce((s, c) =>
      s + (c.avgDurationSeconds / 60) * c.recentSessions / WEEKS_WINDOW / 60, 0
    );
    const lowImpactHours = lowImpactCardio.reduce((s, c) =>
      s + (c.avgDurationSeconds / 60) * c.recentSessions / WEEKS_WINDOW / 60, 0
    );
    const briskWalkHours = briskWalkCardio.reduce((s, c) =>
      s + (c.avgDurationSeconds / 60) * c.recentSessions / WEEKS_WINDOW / 60, 0
    );

    cardioInterferencePct = Math.min(
      cfg.maxCardioInterferencePct,
      highImpactHours * cfg.highImpactCardioInterferencePct
      + (lowImpactHours + briskWalkHours) * cfg.lowImpactCardioInterferencePct
    );
  }

  for (const rawVol of profile.muscleVolumeStatuses) {
    const normalizedGroup = normalizeMuscleGroupName(rawVol.muscleGroup);
    if (!normalizedGroup) continue;
    if (normalizedGroup === 'calves') continue;
    const vol = { ...rawVol, muscleGroup: normalizedGroup };
    const guideline = getGuidelineForGroup(vol.muscleGroup);
    if (!guideline) continue;
    if (guideline.mrv === 0) continue;

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

    // Proportional deficit priority: when a body assessment exists, scale volume
    // targets based on how far the muscle group is from its ideal proportions.
    if (_activeBodyAssessment) {
      const deficit = _activeBodyAssessment.proportional_deficits[vol.muscleGroup];
      if (deficit !== undefined && deficit !== 0) {
        // deficit < 0 means below ideal → increase target; > 0 means above → decrease
        const deficitMult = clampNumber(1.0 - deficit * cfg.priorityDeficitSensitivity, cfg.priorityDeficitFloor, cfg.priorityDeficitCeiling);
        weeklyTarget *= deficitMult;
      } else {
        const score = _activeBodyAssessment.scores[vol.muscleGroup];
        if (score !== undefined) {
          const visualMult = clampNumber(1.0 + (7 - score) / 10 * cfg.priorityVisualScoreSensitivity, cfg.priorityVisualFloor, cfg.priorityVisualCeiling);
          weeklyTarget *= visualMult;
        }
      }
    }

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
    const effectiveTarget = individualMrv ? Math.min(weeklyTarget, individualMrv * cfg.priorityMrvSafetyFraction) : weeklyTarget;
    const indirectCredit = guideline.indirectVolumeCredit ?? 0.5;
    const weeklyEffectiveSets = (vol.weeklyDirectSets ?? 0) + ((vol.weeklyIndirectSets ?? 0) * indirectCredit);
    const volumeDeficit = Math.max(0, effectiveTarget - weeklyEffectiveSets);

    // Base priority: freshness + volume deficit
    let priority = freshnessScore * cfg.priorityFreshnessWeight + (volumeDeficit / Math.max(effectiveTarget, 1)) * cfg.priorityVolumeDeficitWeight;

    if (splitTargetGroups?.has(vol.muscleGroup)) {
      priority += cfg.splitMatchBoost;
    }
    if (preferredGroupSet.has(vol.muscleGroup)) {
      priority += cfg.priorityPreferredGroupBoost;
    }

    if (todayPatternGroups.includes(vol.muscleGroup)) {
      priority += cfg.dayPatternBoost;
    }

    if (isPriorityMuscle(vol.muscleGroup)) {
      priority += cfg.priorityMuscleBoost;
    }

    // #8: Weak-point prioritization from strength percentiles
    const liftToMuscle: Record<string, string[]> = {
      squat: ['quadriceps', 'glutes', 'hamstrings'],
      bench: ['mid_chest', 'upper_chest', 'anterior_deltoid', 'triceps'],
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

    const couplingSignal = systemCouplingSignals[vol.muscleGroup];
    if (couplingSignal) {
      let couplingDelta = couplingSignal.priorityDelta;
      if (vol.muscleGroup === 'adductors' && couplingDelta < 0 && isPriorityMuscle('adductors')) {
        // Respect explicit user preference even under coupling-based deprioritization.
        couplingDelta = Math.max(0, couplingDelta + 0.12);
      }
      priority += couplingDelta;
    }

    // Scale sets by duration: longer sessions can accommodate more volume per group
    const sessionDur = prefs.session_duration_minutes;
    const durationSetScale = sessionDur >= 120 ? 1.30 : sessionDur >= 90 ? 1.15 : sessionDur <= 45 ? 0.75 : 1.0;
    // Tighter cap (was 12). No single muscle group should consume more than
    // ~8 working sets in a single session — past that point it crowds out
    // other muscles, increases time overrun, and per Schoenfeld dose-response
    // delivers diminishing returns relative to splitting the volume across
    // sessions. Floor stays at 3 (minimum effective dose).
    let setsNeeded = Math.ceil(
      Math.min(Math.max(volumeDeficit, 3), 8) * recoveryAdj.volumeMultiplier * durationSetScale
    );
    if (vol.muscleGroup === 'abductors' || vol.muscleGroup === 'adductors') {
      if (hipAbductorSignal.suppressDirectIsolation) {
        setsNeeded = Math.max(2, Math.min(setsNeeded, 3));
      } else if (hipAbductorSignal.adaptiveSuppression < 0.85) {
        setsNeeded = Math.max(2, Math.round(setsNeeded * hipAbductorSignal.adaptiveSuppression));
      }
      if ((vol.daysSinceLastTrained ?? 99) <= 1) {
        // Recovery-aware anti-chatter guard: avoid daily direct hip isolation.
        priority -= 0.18;
      }
    }

    const splitLabel = splitTargetGroups?.has(vol.muscleGroup) ? ' [split match]' : '';
    const dayLabel = todayPatternGroups.includes(vol.muscleGroup) ? ' [day pattern]' : '';

    if (setsNeeded > 0 || freshnessDays >= 5 || splitTargetGroups?.has(vol.muscleGroup)) {
      const couplingTag = couplingSignal
        ? ` [coupling ${couplingSignal.priorityDelta >= 0 ? '+' : ''}${couplingSignal.priorityDelta.toFixed(2)}: ${couplingSignal.reasons.slice(0, 2).join(', ')}]`
        : '';
      const reason = splitTargetGroups?.has(vol.muscleGroup)
        ? `Split: ${detectedSplit.nextRecommended.join('/')} day${dayLabel} — ${vol.weeklyDirectSets}/${effectiveTarget.toFixed(0)} weekly sets${couplingTag}`
        : freshnessDays >= 5
          ? `Not trained in ${freshnessDays} days${splitLabel}${couplingTag}`
          : `${volumeDeficit.toFixed(0)} sets below target (${vol.weeklyDirectSets}/${effectiveTarget.toFixed(0)})${splitLabel}${dayLabel}${couplingTag}`;

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

  let filteredCandidates = candidates;
  if (splitTargetGroups && splitTargetGroups.size > 0) {
    const hardFilter = activeDayTheme?.source === 'schedule' || activeDayTheme?.source === 'rotation';
    // Tighter filter for explicit splits/schedules. Previously we always
    // applied a second `expandWithSynergists` pass on top of the theme's
    // already-expanded `allowedAccessories`, which let push days end up
    // with posterior_deltoid, upper_traps, etc — direct violations of
    // common splits (PPL/upper-lower). For schedule/rotation sources, use
    // the theme's allowed list verbatim and add only universal accessories
    // (core/calves/cardio).
    let expandedTargets: Set<string>;
    if (hardFilter && activeDayTheme) {
      expandedTargets = new Set([
        activeDayTheme.primary,
        ...activeDayTheme.allowedAccessories,
      ]);
      for (const ua of UNIVERSAL_ACCESSORIES) expandedTargets.add(ua);
    } else {
      expandedTargets = expandWithSynergists(splitTargetGroups);
    }
    const splitFiltered = candidates.filter(c => expandedTargets.has(c.muscleGroup));
    if (splitFiltered.length >= 1 || hardFilter) {
      filteredCandidates = splitFiltered;
    }
  }

  // Tighter group caps. Previously a 60-min user could land 4 muscle groups,
  // which after working sets + warmups + transitions consistently overflowed
  // the time budget (measured median: ~73 min for nominal 60-min sessions).
  // That overrun is one of the largest compliance killers — users skip the
  // last 1-2 exercises. Empirical fit:
  //   30 min  → 2 groups (tight)
  //   45 min  → 2 groups
  //   60 min  → 3 groups (was 4)
  //   75 min  → 4 groups
  //   90 min+ → 5 groups
  const dur = prefs.session_duration_minutes;
  const maxGroups = dur <= 35 ? 2
    : dur <= 55 ? 2
    : dur <= 70 ? 3
    : dur <= 85 ? 4
    : dur <= 105 ? 5
    : 6;
  let selected = filteredCandidates.slice(0, maxGroups);
  const primaryMajorGroups = new Set([
    'upper_chest', 'mid_chest', 'lower_chest', 'back_lats', 'quadriceps', 'hamstrings', 'glutes',
    'anterior_deltoid', 'lateral_deltoid', 'posterior_deltoid', 'biceps', 'triceps',
  ]);
  const accessoryMinorGroups = new Set([
    'forearms', 'abductors', 'adductors', 'core', 'erector_spinae', 'rotator_cuff', 'hip_flexors',
    'upper_traps', 'mid_traps', 'lower_traps', 'back_upper',
  ]);
  const canTrainMajorCandidate = (c: MuscleGroupSelection): boolean => {
    if (!primaryMajorGroups.has(c.muscleGroup)) return false;
    if (c.recoveryPercent == null) return true;
    // Human-coherence guard: allow moderately recovered major groups before overfilling with minors.
    return c.recoveryPercent >= Math.max(55, Math.round(cfg.muscleReadyThreshold * 100) - 20);
  };
  if (!recoveryAdj.isDeload && selected.length > 0) {
    const selectedMajorCount = selected.filter((s) => primaryMajorGroups.has(s.muscleGroup)).length;
    const selectedMinorCount = selected.filter((s) => accessoryMinorGroups.has(s.muscleGroup)).length;
    const majorPool = filteredCandidates.filter(canTrainMajorCandidate);
    const selectedSet = new Set(selected.map((s) => s.muscleGroup));
    // Guarantee at least one major driver unless truly unavailable.
    if (selectedMajorCount === 0 && majorPool.length > 0) {
      const replacement = majorPool.find((m) => !selectedSet.has(m.muscleGroup));
      if (replacement) {
        const replaceIdx = selected.findIndex((s) => accessoryMinorGroups.has(s.muscleGroup));
        if (replaceIdx >= 0) selected[replaceIdx] = replacement;
      }
    }
    // Avoid accessory-dominant sessions by capping minor-group share.
    const maxMinorGroups = Math.max(1, Math.floor(selected.length / 2));
    let workingMinorCount = selected.filter((s) => accessoryMinorGroups.has(s.muscleGroup)).length;
    if (workingMinorCount > maxMinorGroups) {
      for (const replacement of majorPool) {
        if (workingMinorCount <= maxMinorGroups) break;
        if (selectedSet.has(replacement.muscleGroup)) continue;
        const idx = selected.findIndex((s) => accessoryMinorGroups.has(s.muscleGroup));
        if (idx < 0) break;
        selectedSet.delete(selected[idx].muscleGroup);
        selected[idx] = replacement;
        selectedSet.add(replacement.muscleGroup);
        workingMinorCount -= 1;
      }
    }
  }
  if (preferredGroupSet.size > 0 && selected.length > 0) {
    const anchorCandidates = filteredCandidates.filter(c => preferredGroupSet.has(c.muscleGroup));
    const nonAnchorSelected = selected.filter(c => !preferredGroupSet.has(c.muscleGroup));
    const anchorSelected = selected.filter(c => preferredGroupSet.has(c.muscleGroup));
    const minAnchorCount = Math.min(
      anchorCandidates.length,
      Math.max(1, Math.ceil(selected.length * 0.6))
    );
    if (anchorSelected.length < minAnchorCount) {
      const needed = minAnchorCount - anchorSelected.length;
      const fillAnchors = anchorCandidates
        .filter(c => !anchorSelected.some(s => s.muscleGroup === c.muscleGroup))
        .slice(0, needed);
      selected = [...anchorSelected, ...fillAnchors, ...nonAnchorSelected].slice(0, maxGroups);
    }
  }
  if (!recoveryAdj.isDeload) {
    const primaryMajorGroups = new Set([
      'upper_chest', 'mid_chest', 'lower_chest', 'back_lats', 'quadriceps', 'hamstrings', 'glutes',
      'anterior_deltoid', 'lateral_deltoid', 'posterior_deltoid', 'biceps', 'triceps',
    ]);
    const hasMajorSelected = selected.some((s) => primaryMajorGroups.has(s.muscleGroup));
    if (!hasMajorSelected) {
      const splitExpanded =
        splitTargetGroups && splitTargetGroups.size > 0 ? expandWithSynergists(splitTargetGroups) : null;
      const majorFallback = profile.muscleVolumeStatuses
        .filter((v) => primaryMajorGroups.has(v.muscleGroup))
        .filter((v) => !splitExpanded || splitExpanded.has(v.muscleGroup))
        .map((v) => {
          const rec = profile.muscleRecovery.find((r) => r.muscleGroup === v.muscleGroup);
          return {
            muscleGroup: v.muscleGroup,
            recoveryPercent: rec?.recoveryPercent ?? 0,
            daysSinceLastTrained: v.daysSinceLastTrained ?? 99,
          };
        })
        .sort((a, b) => {
          if (b.recoveryPercent !== a.recoveryPercent) return b.recoveryPercent - a.recoveryPercent;
          return b.daysSinceLastTrained - a.daysSinceLastTrained;
        })
        .find((c) => c.recoveryPercent >= 45 && !selected.some((s) => s.muscleGroup === c.muscleGroup));
      if (majorFallback) {
        const maintenanceAnchor: MuscleGroupSelection = {
          muscleGroup: majorFallback.muscleGroup,
          priority: 0.35,
          reason: `Recovery-aware maintenance anchor (${Math.round(majorFallback.recoveryPercent)}% recovered)`,
          targetSets: 2,
          recoveryPercent: majorFallback.recoveryPercent,
          weeklyVolume: 0,
          volumeTarget: 'maintenance',
        };
        if (selected.length >= maxGroups) {
          selected[selected.length - 1] = maintenanceAnchor;
        } else {
          selected.push(maintenanceAnchor);
        }
      }
    }
  }

  return { selected, skipped };
}

// ─── Step 3: Select Exercises (Preference-Aware + Cardio) ───────────────────

interface ExerciseSelection {
  exercise: EnrichedExercise;
  muscleGroup: MuscleGroupOrCardio;
  sets: number;
  effectiveSets: number;
  reason: string;
  isCardio?: boolean;
}

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function estimateEffectiveSetWeight(exercise: EnrichedExercise, targetMuscleGroup: string): number {
  const identity = classifyExercise(exercise.name, exercise);
  const sfr = getExerciseSFR(exercise.name);
  const type = identity.exerciseType;
  let weight = 1.0;

  if (Number.isFinite(sfr) && sfr > 0) {
    weight *= clampNumber(0.82 + (sfr - 1) * 0.32, 0.72, 1.32);
  }
  if (type === 'compound') weight *= 1.08;
  if (type === 'isolation') weight *= 0.92;

  if (targetMuscleGroup === 'hamstrings' && identity.isHinge) {
    weight *= 1.1;
  }
  return clampNumber(weight, 0.55, 1.45);
}

function seededRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
    s ^= s >>> 16;
    return (s >>> 0) / 0x100000000; // [0, 1)
  };
}

function weightedShuffle<T extends { score: number }>(
  items: T[],
  rng: () => number,
  topK: number = 6
): T[] {
  if (items.length <= 1) return items;
  const top = items.slice(0, Math.min(topK, items.length));
  const rest = items.slice(topK);
  const minScore = Math.min(...top.map(t => t.score));
  const weights = top.map(t => Math.max(t.score - minScore + 1, 0.5));
  const shuffled: T[] = [];
  const remaining = [...top];
  const remainingWeights = [...weights];

  while (remaining.length > 0) {
    const totalW = remainingWeights.reduce((a, b) => a + b, 0);
    let pick = rng() * totalW;
    let idx = 0;
    for (; idx < remainingWeights.length - 1; idx++) {
      pick -= remainingWeights[idx];
      if (pick <= 0) break;
    }
    shuffled.push(remaining[idx]);
    remaining.splice(idx, 1);
    remainingWeights.splice(idx, 1);
  }

  return [...shuffled, ...rest];
}

/**
 * Ideal Apollo volume proportions by muscle group.
 * These represent the target distribution for a balanced, aesthetic physique.
 * Groups with less than their ideal share get a priority boost; overrepresented
 * groups get a slight dampening. V-taper muscles always get a baseline bump.
 */
const APOLLO_IDEAL_PROPORTIONS: Record<string, number> = DEFAULT_MODEL_CONFIG.apolloIdealProportions;

export interface BodyAssessment {
  scores: Record<string, number>;
  proportional_deficits: Record<string, number>;
  shoulder_to_waist_ratio: number | null;
  weak_points: string[];
  strong_points: string[];
  measurements: Record<string, number>;
  reeves_ideals: Record<string, number>;
  date: string;
}

let _activeBodyAssessment: BodyAssessment | null = null;

export function setActiveBodyAssessment(assessment: BodyAssessment | null): void {
  _activeBodyAssessment = assessment;
}

function computeAestheticDeficitMultiplier(
  muscleGroup: string,
  volumeStatuses: TrainingProfile['muscleVolumeStatuses']
): { multiplier: number; detail: string } {
  const ideal = APOLLO_IDEAL_PROPORTIONS[muscleGroup];
  if (!ideal) return { multiplier: 1.0, detail: '' };

  // Visual assessment layer: when a recent body assessment exists, use it as the primary signal
  if (_activeBodyAssessment) {
    const deficit = _activeBodyAssessment.proportional_deficits[muscleGroup];
    if (deficit !== undefined && deficit !== 0) {
      // deficit is negative when below ideal, positive when above
      // e.g. -0.15 = 15% below ideal → boost; +0.10 = 10% above → dampen
      const mult = clampNumber(1.0 - deficit * 3.0, 0.6, 2.0);
      const direction = deficit < 0 ? 'below' : 'above';
      return {
        multiplier: mult,
        detail: `Physique assessment: ${muscleGroup} ${Math.abs(deficit * 100).toFixed(0)}% ${direction} ideal (×${mult.toFixed(2)})`,
      };
    }
    // If the muscle group has a visual score, derive a deficit from that
    const score = _activeBodyAssessment.scores[muscleGroup];
    if (score !== undefined) {
      const visualDeficit = (7 - score) / 10; // 7 is the "proportionate" threshold
      if (Math.abs(visualDeficit) > 0.05) {
        const mult = clampNumber(1.0 + visualDeficit * 2.5, 0.6, 2.0);
        return {
          multiplier: mult,
          detail: `Visual score: ${muscleGroup} ${score.toFixed(1)}/10 (×${mult.toFixed(2)})`,
        };
      }
    }
  }

  // Fallback: volume-based proportional scoring
  if (!volumeStatuses?.length) return { multiplier: 1.0, detail: '' };

  const totalSets = volumeStatuses.reduce((sum, v) => sum + (v.weeklyDirectSets ?? 0), 0);
  if (totalSets === 0) return { multiplier: 1.0, detail: '' };

  const entry = volumeStatuses.find(v => v.muscleGroup === muscleGroup);
  const actual = entry ? (entry.weeklyDirectSets ?? 0) / totalSets : 0;
  const volumeDeficit = ideal - actual;

  if (volumeDeficit > 0.03) {
    const mult = Math.min(2.0, 1.0 + volumeDeficit * 15);
    return { multiplier: mult, detail: `Volume deficit: ${muscleGroup} under-trained (${(actual * 100).toFixed(0)}% vs ${(ideal * 100).toFixed(0)}% ideal, ×${mult.toFixed(2)})` };
  } else if (volumeDeficit < -0.03) {
    const mult = Math.max(0.7, 1.0 + volumeDeficit * 5);
    return { multiplier: mult, detail: `Volume surplus: ${muscleGroup} over-represented (×${mult.toFixed(2)})` };
  }
  return { multiplier: 1.0, detail: '' };
}

function stepSelectExercises(
  muscleGroups: MuscleGroupSelection[],
  allExercises: EnrichedExercise[],
  profile: TrainingProfile,
  prefs: UserPreferences,
  cfg: ModelConfig,
  preferredExerciseNames: Set<string> = new Set(),
  regenerationSeed: number = 0
): { selections: ExerciseSelection[]; decisions: ExerciseDecision[] } {
  const selections: ExerciseSelection[] = [];
  const decisions: ExerciseDecision[] = [];
  const avoidSet = new Set(prefs.exercises_to_avoid.map(e => e.toLowerCase()));
  const hotelModeEnabled = Boolean(prefs.hotel_mode);
  const isHotelModeStrengthAllowed = (ex: EnrichedExercise): boolean => {
    if (!hotelModeEnabled) return true;
    const eq = (Array.isArray(ex.equipment) ? ex.equipment : []).map(normalizeEquipment);
    if (eq.includes('bodyweight')) return true;
    if (eq.includes('dumbbell')) return true;
    return false;
  };
  const isHotelModeCardioAllowed = (ex: EnrichedExercise): boolean => {
    if (!hotelModeEnabled) return true;
    const modality = classifyCardioModality(String(ex.name || '').toLowerCase());
    return modality === 'walk';
  };

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
  const yesterdayExerciseSet = new Set(
    profile.exercisePreferences
      .filter((p) => Number(p.lastUsedDaysAgo) <= 1 && Number(p.totalSessions) > 0)
      .map((p) => String(p.exerciseName || '').toLowerCase().trim())
      .filter(Boolean)
  );
  let yesterdayReuseCount = 0;
  const maxYesterdayReuse = 1;

  const strengthExercises = allExercises.filter(ex =>
    ex.ml_exercise_type !== 'cardio' && ex.ml_exercise_type !== 'recovery'
  );

  const usedExercises = new Set<string>();

  for (const group of muscleGroups) {
    const selectedHasHinge = selections.some(s => classifyExercise(s.exercise.name, s.exercise).isHinge);
    const groupExercises = strengthExercises.filter(ex => {
      if (avoidSet.has(ex.name.toLowerCase())) return false;
      if (usedExercises.has(ex.name.toLowerCase())) return false;
      if (isInjuryConflict(ex, prefs.injuries)) return false;
      if (!isHotelModeStrengthAllowed(ex)) return false;

      const primaryGroups = (Array.isArray(ex.primary_muscles) ? ex.primary_muscles : [])
        .map(m => resolveToCanonicalGroup(m))
        .filter(Boolean);
      return primaryGroups.includes(group.muscleGroup);
    });

    if (groupExercises.length === 0) continue;

    const scored = groupExercises.map(ex => {
      let score = 0;
      const factors: string[] = [];

      if (ex.ml_exercise_type === 'compound') {
        score += cfg.selectionCompoundScore;
        factors.push(`Compound priority (+${cfg.selectionCompoundScore})`);
      }

      // Performance goal boost — if user has a specific target for this exercise
      const goal = goalMap.get(ex.name.toLowerCase());
      if (goal) {
        score += cfg.selectionPerformanceGoalScore;
        factors.push(`Performance goal: ${goal.targetWeight} lbs × ${goal.targetReps} reps (+${cfg.selectionPerformanceGoalScore})`);
      }
      if (preferredExerciseNames.has(ex.name.toLowerCase())) {
        score += cfg.selectionStapleScore;
        factors.push(`Weekly staple priority (+${cfg.selectionStapleScore})`);
      }

      // User preference is the DOMINANT signal — exercises they actually do
      const pref = prefMap.get(ex.name.toLowerCase());
      if (pref) {
        const prefBonus = pref.recencyScore * cfg.selectionRecencyMultiplier;
        score += prefBonus;
        factors.push(`Your exercise (+${prefBonus.toFixed(1)}, ${pref.recentSessions} recent/${pref.totalSessions} total, recency: ${pref.recencyScore})`);
        if (pref.isStaple) {
          score += cfg.selectionStapleConsistencyBonus;
          factors.push(`Staple — you do this consistently (+${cfg.selectionStapleConsistencyBonus})`);
        }
        if (pref.lastUsedDaysAgo <= 14) {
          score += cfg.selectionRecentUseScore;
          factors.push(`Used ${pref.lastUsedDaysAgo}d ago (+${cfg.selectionRecentUseScore})`);
        }
        if (pref.lastUsedDaysAgo <= 1) {
          score += cfg.selectionYesterdayPenalty;
          factors.push(`Trained yesterday: recovery protection (${cfg.selectionYesterdayPenalty})`);
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
            score += cfg.selectionStaleExercisePenalty;
            factors.push(`Stale exercise: ${rot.consecutiveWeeksUsed} weeks (forced rotation, ${cfg.selectionStaleExercisePenalty})`);
          } else if (rot.consecutiveWeeksUsed >= 4) {
            score += cfg.selectionRotationPenalty;
            factors.push(`Exercise rotation suggested: ${rot.consecutiveWeeksUsed} weeks (${cfg.selectionRotationPenalty})`);
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
          score += cfg.selectionProgressingScore;
          factors.push(`Progressing (+${cfg.selectionProgressingScore}, ${prog.sessionsTracked} sessions, slope: ${(prog.progressionSlope * 100).toFixed(1)}%)`);
        } else if (prog.status === 'stalled') {
          score += cfg.selectionStalledScore;
          factors.push(`Stalled (+${cfg.selectionStalledScore}, ${prog.sessionsTracked} sessions — try higher reps or variation)`);
        } else if (prog.status === 'regressing') {
          score += cfg.selectionRegressingPenalty;
          factors.push(`Regressing (${cfg.selectionRegressingPenalty}, consider swapping or reducing volume)`);
        }
      }

      // Ordering interference
      if (selections.length > 0) {
        const lastSelected = selections[selections.length - 1].exercise.name.toLowerCase();
        const interference = profile.exerciseOrderingEffects.find(
          e => e.precedingExercise === lastSelected && e.affectedExercise === ex.name.toLowerCase()
        );
        if (interference && interference.interference < -0.05) {
          score += cfg.selectionOrderingInterferencePenalty;
          factors.push(`Ordering interference with ${lastSelected} (${cfg.selectionOrderingInterferencePenalty})`);
        }
      }

      const exIdentity = classifyExercise(ex.name, ex);
      if (selectedHasHinge && exIdentity.isHinge) {
        score += cfg.selectionDuplicateHingePenalty;
        factors.push(`Pattern diversity: hinge already selected (${cfg.selectionDuplicateHingePenalty})`);
      }
      if (selectedHasHinge && group.muscleGroup === 'hamstrings' && exIdentity.isKneeFlexion) {
        score += cfg.selectionKneeFlexionBonus;
        factors.push(`Pattern diversity: include knee-flexion hamstring work (+${cfg.selectionKneeFlexionBonus})`);
      }

      if (prefs.equipment_access === 'limited' || prefs.equipment_access === 'bodyweight') {
        const exEq = (Array.isArray(ex.equipment) ? ex.equipment : []).map(normalizeEquipment);
        const needsHeavyEquip = exEq.some(e =>
          ['barbell', 'cable', 'smith_machine'].includes(e)
        );
        if (needsHeavyEquip) {
          score += cfg.selectionHeavyEquipmentPenalty;
          factors.push(`Requires unavailable equipment (${cfg.selectionHeavyEquipmentPenalty})`);
        }
        if (prefs.equipment_access === 'bodyweight') {
          const needsAnyEquip = exEq.some(e => e !== 'bodyweight' && e !== 'none');
          if (needsAnyEquip) {
            score += cfg.selectionBodyweightOnlyPenalty;
            factors.push(`Bodyweight-only mode: equipment needed (${cfg.selectionBodyweightOnlyPenalty})`);
          }
        }
      }

      // #1: Exercise Swap Learning — decay-weighted penalties + substitution affinities
      // Penalties are tiered (see modelConfig.selectionSwapPenaltyTiers) and
      // partially offset by positive signals: substitution affinities (this
      // exercise was chosen as a replacement) and acceptance events (this
      // exercise was prescribed and completed without being swapped).
      if (profile.exerciseSwapHistory) {
        const swapEntry = profile.exerciseSwapHistory.find(
          s => s.exerciseName === ex.name.toLowerCase()
        );
        if (swapEntry) {
          const eff = Number(swapEntry.effectiveSwapWeight ?? swapEntry.swapCount);
          let swapApplied = false;
          for (const tier of cfg.selectionSwapPenaltyTiers) {
            if (eff >= tier.minWeight || swapEntry.swapCount >= tier.minCount) {
              score += tier.penalty;
              factors.push(`Swap penalty (weight ${eff.toFixed(1)}, ${tier.penalty})`);
              swapApplied = true;
              break;
            }
          }
          // Gentler fallback: a single swap is a noisy signal (mood, equipment
          // availability, time pressure). Cap at -3 instead of -5 per swap.
          if (!swapApplied && swapEntry.swapCount >= 1) {
            const pen = -Math.min(3, 1.5 * swapEntry.swapCount);
            score += pen;
            factors.push(`Swap history (${swapEntry.swapCount}x, ${pen.toFixed(1)})`);
          }
        }
      }
      if (profile.substitutionAffinities?.length) {
        const exKey = ex.name.toLowerCase();
        let aff = 0;
        for (const a of profile.substitutionAffinities) {
          if (a.toExercise === exKey) {
            aff += Math.min(8, a.affinity * 1.5);
          }
        }
        if (aff > 0) {
          const add = Math.round(aff * 10) / 10;
          score += add;
          factors.push(`Substitution affinity (+${add})`);
        }
      }
      // Positive reward: exercises the user prescribed AND completed without
      // swapping. Decay-weighted on the same half-life as swap penalties so
      // the two channels are balanced. Without this, the system can only
      // ever kill exercises (asymmetric learning → permanent rotation collapse).
      if (profile.exerciseAcceptances?.length) {
        const accEntry = profile.exerciseAcceptances.find(
          a => a.exerciseName === ex.name.toLowerCase()
        );
        if (accEntry) {
          const reward = Math.min(
            cfg.selectionAcceptanceCap,
            cfg.selectionAcceptancePerEvent * Number(accEntry.effectiveWeight ?? accEntry.count)
          );
          if (reward > 0) {
            score += reward;
            factors.push(`Acceptance reward (+${reward.toFixed(1)}, ${accEntry.count}× kept)`);
          }
        }
      }

      // #7: Movement Pattern Fatigue — penalize patterns with accumulated fatigue
      if (profile.movementPatternFatigue) {
        const patternFatigue = profile.movementPatternFatigue.find(p => {
          const exMp = (ex.movement_pattern || '').toLowerCase();
          const exGroups = (Array.isArray(ex.primary_muscles) ? ex.primary_muscles : [])
            .map(m => resolveToCanonicalGroup(m ?? ''))
            .filter(Boolean);
          if (p.pattern === 'horizontal_push' && (exMp.includes('press') || exGroups.includes('mid_chest') || exGroups.includes('upper_chest') || exGroups.includes('lower_chest'))) return true;
          if (p.pattern === 'vertical_pull' && (exMp.includes('pull') || exGroups.includes('back_lats'))) return true;
          if (p.pattern === 'hip_hinge' && (exMp.includes('hinge') || exGroups.includes('hamstrings'))) return true;
          if (p.pattern === 'knee_dominant' && (exMp.includes('squat') || exGroups.includes('quadriceps'))) return true;
          return false;
        });

        if (patternFatigue?.fatigueLevel === 'high') {
          score += cfg.selectionPatternFatiguePenalties.high;
          factors.push(`Movement pattern fatigue: ${patternFatigue.pattern} high (${cfg.selectionPatternFatiguePenalties.high})`);
        } else if (patternFatigue?.fatigueLevel === 'moderate') {
          score += cfg.selectionPatternFatiguePenalties.moderate;
          factors.push(`Movement pattern fatigue: ${patternFatigue.pattern} moderate (${cfg.selectionPatternFatiguePenalties.moderate})`);
        }
      }

      // #9: Plateau strategies — penalize plateaued exercises with swap_variation so engine prefers alternatives
      const plateau = profile.plateauDetections?.find(
        p => p.exerciseName === ex.name.toLowerCase() && p.isPlateaued
      );
      if (plateau?.suggestedStrategy) {
        const strat = plateau.suggestedStrategy.toLowerCase();
        if (strat.includes('swap') || strat.includes('variation')) {
          score += cfg.selectionPlateauSwapPenalty;
          factors.push(`Plateaued — swap/variation suggested (${cfg.selectionPlateauSwapPenalty})`);
        }
      }

      // Apollo aesthetic proportionality
      const aestheticAdj = computeAestheticDeficitMultiplier(group.muscleGroup, profile.muscleVolumeStatuses);
      if (aestheticAdj.multiplier !== 1.0) {
        const oldScore = score;
        score = Math.round(score * aestheticAdj.multiplier * 10) / 10;
        factors.push(`${aestheticAdj.detail} (${oldScore.toFixed(1)} → ${score.toFixed(1)})`);
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

    // Post-score swap override: only the most heavily-rejected exercises get
    // the hard cap. Threshold lifted from 5 → 15 swaps so the user has to
    // actually reject the exercise repeatedly (and decay-corrected) before
    // it's pulled out of rotation. A single bad week can no longer kill an
    // exercise. Acceptance events further offset the override entirely
    // (positive signal beats negative if the user has kept it 3+ times).
    if (profile.exerciseSwapHistory) {
      for (const item of scored) {
        const swapEntry = profile.exerciseSwapHistory.find(
          s => s.exerciseName === item.exercise.name.toLowerCase()
        );
        if (!swapEntry) continue;
        const eff = Number(swapEntry.effectiveSwapWeight ?? swapEntry.swapCount);
        if (eff >= 11 || swapEntry.swapCount >= 15) {
          // Acceptance reward escape hatch: if user kept this exercise
          // recently, do NOT hard-cap. Negative-only learning was the bug.
          const accEntry = profile.exerciseAcceptances?.find(
            a => a.exerciseName === item.exercise.name.toLowerCase()
          );
          const acceptanceWeight = Number(accEntry?.effectiveWeight ?? 0);
          if (acceptanceWeight < 3) {
            item.score = Math.min(item.score, cfg.selectionSwapNearBanCeiling);
            item.factors.push(`Swap override: heavily rejected (${swapEntry.swapCount}× swapped, weight ${eff.toFixed(1)})`);
          } else {
            item.factors.push(`Override skipped: acceptance signal ${acceptanceWeight.toFixed(1)} offsets ${swapEntry.swapCount} swaps`);
          }
        }
      }
    }

    scored.sort((a, b) => b.score - a.score);

    if (regenerationSeed !== 0) {
      const rng = seededRng(regenerationSeed + scored.length * 31);
      const shuffled = weightedShuffle(scored, rng);
      scored.length = 0;
      scored.push(...shuffled);
      for (const item of scored) {
        item.factors.push('Regeneration shuffle applied');
      }
    }

    for (const item of scored.slice(0, 5)) {
      decisions.push({
        exerciseName: item.exercise.name,
        muscleGroup: group.muscleGroup,
        score: Math.round(item.score * 10) / 10,
        factors: item.factors,
      });
    }

    let remainingStimulus = group.targetSets;

    const userExercisesForGroup = scored.filter(s => {
      const p = prefMap.get(s.exercise.name.toLowerCase());
      return p && p.recentSessions >= 1;
    }).length;
    const durationMin = prefs.session_duration_minutes;
    const durationBonus = durationMin >= 120 ? 2 : durationMin >= 90 ? 1 : 0;
    const defaultMax = group.targetSets <= 4 ? 1 + durationBonus : group.targetSets <= 8 ? 2 + durationBonus : 3 + durationBonus;
    let maxExercisesPerGroup = userExercisesForGroup > 0
      ? Math.min(userExercisesForGroup + durationBonus, 5)
      : Math.min(defaultMax, 5);

    if (profile.prescribedVsActual && profile.prescribedVsActual.complianceRate < 0.6) {
      maxExercisesPerGroup = Math.max(1, maxExercisesPerGroup - 1);
    }

    const maxExercises = maxExercisesPerGroup;

    const ordered = regenerationSeed !== 0
      ? scored
      : [...scored].sort((a, b) => b.score - a.score);

    // Scale max sets per exercise by duration
    const maxSetsPerExercise = durationMin >= 120 ? cfg.volumeMaxSetsPerExerciseTiers['120'] : durationMin >= 90 ? cfg.volumeMaxSetsPerExerciseTiers['90'] : durationMin >= 60 ? cfg.volumeMaxSetsPerExerciseTiers['60'] : cfg.volumeMaxSetsPerExerciseTiers['default'];

    let exerciseCount = 0;
    for (const item of ordered) {
      if (exerciseCount >= maxExercises || remainingStimulus <= 0) break;
      const itemName = String(item.exercise.name || '').toLowerCase();
      const isYesterdayExercise = yesterdayExerciseSet.has(itemName);
      if (isYesterdayExercise && yesterdayReuseCount >= maxYesterdayReuse) continue;
      const setWeight = estimateEffectiveSetWeight(item.exercise, group.muscleGroup);
      const desiredStimulus = exerciseCount === 0
        ? remainingStimulus * cfg.volumePrimaryShare
        : Math.min(remainingStimulus, Math.max(cfg.volumeSubsequentFloor, remainingStimulus * cfg.volumeSubsequentShare));
      const setsForThisRaw = Math.ceil(desiredStimulus / Math.max(setWeight, cfg.volumeEffectiveSetWeightFloor));
      const setsForThis = exerciseCount === 0
        ? Math.min(setsForThisRaw, maxSetsPerExercise)
        : Math.min(setsForThisRaw, maxSetsPerExercise - 1);
      const effectiveSets = Math.round(Math.max(0, setsForThis) * setWeight * 100) / 100;

      selections.push({
        exercise: item.exercise,
        muscleGroup: group.muscleGroup,
        sets: Math.max(2, setsForThis),
        effectiveSets,
        reason: exerciseCount === 0
          ? `Primary ${group.muscleGroup} exercise (score: ${item.score.toFixed(1)}, stimulus/set: ${setWeight.toFixed(2)})`
          : `Additional ${group.muscleGroup} volume (score: ${item.score.toFixed(1)}, stimulus/set: ${setWeight.toFixed(2)})`,
      });

      usedExercises.add(item.exercise.name.toLowerCase());
      if (isYesterdayExercise) yesterdayReuseCount += 1;
      remainingStimulus -= effectiveSets;
      exerciseCount++;
    }
  }

  // ── Global exercise cap — prevent unreasonably large sessions ──
  const sessionDurMin = prefs.session_duration_minutes;
  const maxTotalExercises = sessionDurMin >= 120 ? cfg.volumeMaxExerciseTiers['120'] : sessionDurMin >= 90 ? cfg.volumeMaxExerciseTiers['90'] : sessionDurMin >= 60 ? cfg.volumeMaxExerciseTiers['60'] : cfg.volumeMaxExerciseTiers['default'];
  if (selections.length > maxTotalExercises) {
    selections.length = maxTotalExercises;
  }

  // ── Push/Pull ratio tracking + auto-corrective insertion ──
  // Source: ACSM guidelines recommend balanced push:pull ratios for shoulder health.
  // If push:pull ratio exceeds 1.5:1, auto-insert corrective pulling work.
  const pushGroups = new Set(['upper_chest', 'mid_chest', 'lower_chest', 'anterior_deltoid', 'lateral_deltoid', 'triceps']);
  const pullGroups = new Set(['back_lats', 'back_upper', 'upper_traps', 'mid_traps', 'lower_traps', 'biceps', 'posterior_deltoid']);
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
        effectiveSets: cfg.correctiveSetsCount,
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

  // ── #12: Hamstring isolation enforcement ──
  // On leg days, ensure at least one knee-flexion hamstring exercise (not just RDL/hinge).
  const hasHamstringGroup = muscleGroups.some(g => g.muscleGroup === 'hamstrings');
  if (hasHamstringGroup) {
    const hasHingeHam = selections.some(s =>
      s.muscleGroup === 'hamstrings' && classifyExercise(s.exercise.name, s.exercise).isHinge
    );
    const hasKneeFlexion = selections.some(s =>
      s.muscleGroup === 'hamstrings' && classifyExercise(s.exercise.name, s.exercise).isKneeFlexion
    );
    if (hasHingeHam && !hasKneeFlexion) {
      const kneeFlexionExercises = strengthExercises.filter(ex => {
        if (usedExercises.has(ex.name.toLowerCase())) return false;
        const groups = (Array.isArray(ex.primary_muscles) ? ex.primary_muscles : [])
          .map(m => resolveToCanonicalGroup(m)).filter(Boolean);
        return groups.includes('hamstrings') && classifyExercise(ex.name, ex).isKneeFlexion;
      });
      const userPreferred = kneeFlexionExercises.find(ex => {
        const p = prefMap.get(ex.name.toLowerCase());
        return p && p.recentSessions >= 1;
      });
      const pick = userPreferred ?? kneeFlexionExercises[0] ?? null;
      if (pick) {
        selections.push({
          exercise: pick,
          muscleGroup: 'hamstrings',
          sets: 3,
          effectiveSets: 3,
          reason: 'Pattern diversity: adding knee-flexion hamstring work (RDL alone misses short-head biceps femoris)',
        });
        usedExercises.add(pick.name.toLowerCase());
      }
    }
  }

  // ── #13: Core exercise pattern diversity ──
  // If core is targeted, ensure at least 2 different movement patterns.
  const coreSelections = selections.filter(s => s.muscleGroup === 'core');
  if (coreSelections.length >= 1) {
    const corePatterns = new Set(coreSelections.map(s =>
      classifyCorePattern(s.exercise.name.toLowerCase()) ?? 'flexion'
    ));
    if (corePatterns.size === 1 && coreSelections.length >= 1) {
      const dominantPattern = [...corePatterns][0];
      const ANTI_MOVEMENT_NAMES = ['pallof press', 'dead bug', 'bird dog', 'plank', 'side plank', 'ab wheel rollout'];
      const diverseCore = strengthExercises.filter(ex => {
        if (usedExercises.has(ex.name.toLowerCase())) return false;
        const groups = (Array.isArray(ex.primary_muscles) ? ex.primary_muscles : [])
          .map(m => resolveToCanonicalGroup(m)).filter(Boolean);
        if (!groups.includes('core')) return false;
        const n = ex.name.toLowerCase();
        if (dominantPattern === 'flexion') {
          return ANTI_MOVEMENT_NAMES.some(am => n.includes(am));
        }
        return classifyCorePattern(n) === 'flexion';
      });
      const pick = diverseCore.find(ex => {
        const p = prefMap.get(ex.name.toLowerCase());
        return p && p.recentSessions >= 1;
      }) ?? diverseCore[0] ?? null;
      if (pick) {
        selections.push({
          exercise: pick,
          muscleGroup: 'core',
          sets: 2,
          effectiveSets: 2,
          reason: 'Core diversity: adding anti-movement/rotation work alongside flexion exercises',
        });
        usedExercises.add(pick.name.toLowerCase());
      }
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
    if (!isHotelModeCardioAllowed(cardioEx)) continue;

    const cardioHist = profile.cardioHistory.find(c => c.exerciseName === cardioPref.exerciseName);
    const durationInfo = cardioHist
      ? `avg ${Math.round(cardioHist.avgDurationSeconds / 60)} min${cardioHist.avgSpeed != null ? `, intensity: ${cardioHist.avgSpeed}` : ''}`
      : '';

    selections.push({
      exercise: cardioEx,
      muscleGroup: 'cardio',
      sets: 1,
      effectiveSets: 1,
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

  // Cardio is mandatory in every workout — always ensure at least one cardio modality.
  const effectiveGoal = getEffectiveGoal(prefs);
  const hasSelectedCardio = selections.some((s) => Boolean(s.isCardio));
  if (!hasSelectedCardio) {
    const cardioCandidates = allExercises
      .filter((ex) => ex.ml_exercise_type === 'cardio')
      .filter((ex) => !avoidSet.has(String(ex.name || '').toLowerCase()))
      .filter((ex) => isHotelModeCardioAllowed(ex))
      .sort((a, b) => {
        const aModality = classifyCardioModality(String(a.name || '').toLowerCase());
        const bModality = classifyCardioModality(String(b.name || '').toLowerCase());
        const aPref = aModality != null ? 1 : 0;
        const bPref = bModality != null ? 1 : 0;
        return bPref - aPref;
      });
    const fallbackCardio = cardioCandidates[0];
    if (fallbackCardio) {
      selections.push({
        exercise: fallbackCardio,
        muscleGroup: 'cardio',
        sets: 1,
        effectiveSets: 1,
        reason: `Cardio baseline enforced (mandatory)`,
        isCardio: true,
      });
      decisions.push({
        exerciseName: fallbackCardio.name,
        muscleGroup: 'cardio',
        score: 8,
        factors: [`Mandatory cardio baseline, cardio preference=${prefs.cardio_duration_minutes ?? 'n/a'} min`],
      });
    }
  }

  // Phase 6: ab/core mandatory every training day, all phases.
  //
  // User policy: "always do one ab exercise minimum to keep myself honest".
  // Rationale: ab stimulus is cheap (~5 min, low CNS cost, no equipment),
  // and high-frequency low-dose work produces better hypertrophy than
  // weekly blowouts (Schoenfeld dose-response). The marginal opportunity
  // cost vs primary lifts is negligible at 2 sets, so there's no phase in
  // which "skip abs" is the optimal call.
  //
  // Strategy:
  //   1. If no core exercise was already selected, pick the lowest-fatigue
  //      core exercise from the library that the user hasn't done in the
  //      last ~3 days (recovery + variety).
  //   2. Append as a single 2-set, 12-rep accessory at the end of the
  //      strength block. Cardio block is unaffected.
  //
  // Note: `effectiveGoal` is referenced for logging only — selection is
  // unconditional.
  void effectiveGoal;
  const hasSelectedCore = selections.some((s) => {
    if (s.isCardio) return false;
    const g = String(s.muscleGroup ?? '').toLowerCase();
    return g === 'core' || g === 'abs';
  });
  if (!hasSelectedCore) {
    // Pull recent ab usage so we don't repeat the same exercise day-to-day.
    const recentAbNames = new Set(
      (profile.exercisePreferences ?? [])
        .filter(p => Number(p.lastUsedDaysAgo ?? 999) <= 3)
        .map(p => String(p.exerciseName ?? '').toLowerCase())
    );
    const coreCandidates = allExercises
      .filter((ex) => {
        // Accept either a `body_part === 'core'` tag or a primary muscle
        // that maps to the core canonical group via the muscle-head index.
        if (avoidSet.has(String(ex.name ?? '').toLowerCase())) return false;
        if (!isHotelModeStrengthAllowed(ex)) return false;
        const bp = String(ex.body_part ?? '').toLowerCase();
        if (bp === 'core' || bp === 'abs' || bp === 'abdominals') return true;
        const pm = (ex.primary_muscles ?? []).map((m) => resolveToCanonicalGroup(String(m)));
        return pm.some((g) => g === 'core');
      })
      // De-prioritise anything used in the last 3 days; otherwise keep
      // library order (the library is roughly ordered by SFR).
      .sort((a, b) => {
        const aRecent = recentAbNames.has(String(a.name ?? '').toLowerCase()) ? 1 : 0;
        const bRecent = recentAbNames.has(String(b.name ?? '').toLowerCase()) ? 1 : 0;
        return aRecent - bRecent;
      });
    const abPick = coreCandidates[0];
    if (abPick) {
      selections.push({
        exercise: abPick,
        muscleGroup: 'core',
        sets: 2,
        effectiveSets: 2,
        reason: 'Daily ab work enforced (all phases)',
        isCardio: false,
      });
      decisions.push({
        exerciseName: abPick.name,
        muscleGroup: 'core',
        score: 5,
        factors: [
          'Daily ab policy: 1 ab exercise per training day enforced',
          recentAbNames.has(String(abPick.name ?? '').toLowerCase())
            ? 'Note: chosen despite recent use — no novel core option in library'
            : 'Selected: not used in last 3 days',
        ],
      });
    }
  }

  // Invariants: every generated workout should include
  // (1) at least one compound and (2) at least one staple when available.
  const shouldExcludeStapleFamily = (familyKey: string): boolean =>
    familyKey === 'romanian_deadlift';
  const selectionHasCompound = () =>
    selections.some((sel) => !sel.isCardio && inferExerciseType(sel.exercise) === 'compound');
  const stapleFamilyAgg = new Map<string, {
    familyKey: string;
    names: Set<string>;
    totalSessions: number;
    recentSessions: number;
    isStaple: boolean;
    bestLastUsedDaysAgo: number;
  }>();
  for (const p of profile.exercisePreferences ?? []) {
    const name = String(p.exerciseName || '').toLowerCase().trim();
    if (!name) continue;
    const familyKey = stapleFamilyKey(name);
    const agg = stapleFamilyAgg.get(familyKey) ?? {
      familyKey,
      names: new Set<string>(),
      totalSessions: 0,
      recentSessions: 0,
      isStaple: false,
      bestLastUsedDaysAgo: 999,
    };
    agg.names.add(name);
    agg.totalSessions += Number(p.totalSessions ?? 0);
    agg.recentSessions += Number(p.recentSessions ?? 0);
    agg.isStaple = agg.isStaple || Boolean(p.isStaple) || Number(p.recentSessions ?? 0) >= 2;
    agg.bestLastUsedDaysAgo = Math.min(agg.bestLastUsedDaysAgo, Number(p.lastUsedDaysAgo ?? 999));
    stapleFamilyAgg.set(familyKey, agg);
  }
  const strictStaplePool = [...stapleFamilyAgg.values()]
    .filter((f) => !shouldExcludeStapleFamily(f.familyKey))
    .filter((f) => f.isStaple || (f.totalSessions >= 12 && f.bestLastUsedDaysAgo <= 35))
    .sort((a, b) => {
      const stapleRank = Number(Boolean(b.isStaple)) - Number(Boolean(a.isStaple));
      if (stapleRank !== 0) return stapleRank;
      const recencyRank = (a.bestLastUsedDaysAgo ?? 999) - (b.bestLastUsedDaysAgo ?? 999);
      if (recencyRank !== 0) return recencyRank;
      return (b.totalSessions ?? 0) - (a.totalSessions ?? 0);
    });
  // Fallback: if strict staple criteria yields nothing, still force continuity
  // from user's recurring exercises so each workout keeps at least one anchor.
  const fallbackStaplePool = [...stapleFamilyAgg.values()]
    .filter((f) => !shouldExcludeStapleFamily(f.familyKey))
    .filter((f) => f.totalSessions >= 4 && f.bestLastUsedDaysAgo <= 84)
    .sort((a, b) => {
      const recencyRank = (a.bestLastUsedDaysAgo ?? 999) - (b.bestLastUsedDaysAgo ?? 999);
      if (recencyRank !== 0) return recencyRank;
      return (b.totalSessions ?? 0) - (a.totalSessions ?? 0);
    });
  const staplePool = strictStaplePool.length > 0 ? strictStaplePool : fallbackStaplePool;
  const selectionNameSet = new Set(selections.map((s) => String(s.exercise.name || '').toLowerCase()));
  const selectedFamilies = new Set([...selectionNameSet].map(stapleFamilyKey));
  const stapleAlreadyIncluded = staplePool.some((f) => selectedFamilies.has(f.familyKey));
  const canUseExercise = (ex: EnrichedExercise | null | undefined): ex is EnrichedExercise => {
    if (!ex) return false;
    const key = String(ex.name || '').toLowerCase();
    if (!key) return false;
    if (selectionNameSet.has(key)) return false;
    if (avoidSet.has(key)) return false;
    if (isInjuryConflict(ex, prefs.injuries)) return false;
    if (hotelModeEnabled && ex.ml_exercise_type === 'cardio' && !isHotelModeCardioAllowed(ex)) return false;
    if (hotelModeEnabled && ex.ml_exercise_type !== 'cardio' && !isHotelModeStrengthAllowed(ex)) return false;
    return true;
  };
  const primaryGroupOf = (ex: EnrichedExercise): MuscleGroupOrCardio => {
    const heads = (Array.isArray(ex.primary_muscles) ? ex.primary_muscles : []);
    for (const h of heads) {
      const g = resolveToCanonicalGroup(h);
      if (g) return g;
    }
    return 'mid_chest';
  };
  if (!selectionHasCompound()) {
    const compoundCandidate = strengthExercises
      .filter((ex) => canUseExercise(ex) && inferExerciseType(ex) === 'compound')
      .map((ex) => {
        const pref = prefMap.get(ex.name.toLowerCase());
        const score = (pref?.recencyScore ?? 0) + (pref?.isStaple ? 1.5 : 0);
        return { ex, score };
      })
      .sort((a, b) => b.score - a.score)[0]?.ex ?? null;
    if (compoundCandidate) {
      const mg = primaryGroupOf(compoundCandidate);
      const setWeight = estimateEffectiveSetWeight(compoundCandidate, mg);
      selections.unshift({
        exercise: compoundCandidate,
        muscleGroup: mg,
        sets: 3,
        effectiveSets: Math.round(3 * setWeight * 100) / 100,
        reason: 'Invariant: ensured at least one compound movement',
      });
      selectionNameSet.add(compoundCandidate.name.toLowerCase());
      decisions.push({
        exerciseName: compoundCandidate.name,
        muscleGroup: mg,
        score: 10,
        factors: ['Invariant rule: add one compound exercise per workout'],
      });
    }
  }
  if (!stapleAlreadyIncluded && staplePool.length > 0) {
    const stapleCandidate = staplePool
      .flatMap((f) => {
        const exact = [...f.names]
          .map((name) => allExercises.find((ex) => ex.name.toLowerCase() === name))
          .filter((ex): ex is EnrichedExercise => Boolean(ex));
        const family = allExercises.filter((ex) => stapleFamilyKey(ex.name) === f.familyKey);
        return [...exact, ...family];
      })
      .find((ex) => canUseExercise(ex)) ?? null;
    if (stapleCandidate) {
      const mg = primaryGroupOf(stapleCandidate);
      const setWeight = estimateEffectiveSetWeight(stapleCandidate, mg);
      selections.push({
        exercise: stapleCandidate,
        muscleGroup: mg,
        sets: 2,
        effectiveSets: Math.round(2 * setWeight * 100) / 100,
        reason: 'Invariant: ensured staple continuity',
      });
      decisions.push({
        exerciseName: stapleCandidate.name,
        muscleGroup: mg,
        score: 9,
        factors: ['Invariant rule: include at least one staple exercise each workout'],
      });
    }
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
  breakRampMultiplier: number = 1.0,
  planningDate?: Date,
  fatLossController?: FatLossControllerAdjustment,
  highCapacityPush?: HighCapacityPushAdjustment,
  dayOccurrenceIndex?: number,
  mesocycleVolumeMult?: number,
  mesocycleRirOffset?: number,
): GeneratedExercise[] {
  const goal = getEffectiveGoal(prefs);
  const hotelModeEnabled = Boolean(prefs.hotel_mode);
  const clampHotelModeWeight = (weight: number | null, equipment: string[]): number | null => {
    if (!hotelModeEnabled || weight == null) return weight;
    const eqNorm = (equipment ?? []).map(normalizeEquipment);
    if (eqNorm.includes('dumbbell')) return Math.min(weight, 50);
    return weight;
  };
  const secondaryGoal = prefs.secondary_goal;
  const prioritySet = new Set(prefs.priority_muscles.map(m => m.toLowerCase()));
  const lowerBodyGroups = new Set(['quadriceps', 'hamstrings', 'glutes', 'adductors', 'abductors', 'hip_flexors']);
  let primaryLowerBarbellPrimed = false;

  const groupIndex: Record<string, number> = {};

  return selections.map(sel => {
    // Handle cardio with real duration/intensity from history
    if (sel.isCardio || sel.exercise.ml_exercise_type === 'cardio') {
      const cardio = profile.cardioHistory.find(c => c.exerciseName === sel.exercise.name.toLowerCase());
      const pref = profile.exercisePreferences.find(p => p.exerciseName === sel.exercise.name.toLowerCase());

      const goalCardioDefaults: Record<string, number> = cfg.cardioGoalDefaultDuration;
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
      const modality = inferCardioModality(exName);
      const capability = (profile.cardioCapabilityProfiles ?? []).find(c => c.modality === modality);
      let speedLabel: string | null = null;
      if (modality === 'stair') speedLabel = 'Level';
      else if (modality === 'bike') speedLabel = 'Resistance';
      else if (modality === 'row') speedLabel = 'Watts';
      else if (modality === 'walk' || modality === 'run') speedLabel = 'Speed (mph)';
      else if (speed != null) speedLabel = 'Intensity';
      const isRunLike = modality === 'run';
      const isWalkLike = modality === 'walk';
      const modalitySpeedCap = (() => {
        const dbCap = capability?.maxSpeed != null && Number.isFinite(capability.maxSpeed)
          ? Number(capability.maxSpeed)
          : null;
        if (isWalkLike) {
          const histSpeed = Number(cardio?.avgSpeed ?? 0);
          const comfortable = Number(capability?.comfortableSpeed ?? 0);
          const cap = cfg.maxWalkSpeedMph;
          const base = comfortable > 0
            ? Math.min(comfortable + 0.4, cap)
            : (histSpeed > 0 ? Math.min(histSpeed + 0.45, cap) : Math.min(3.2, cap));
          const inferred = clampNumber(base, cfg.minWalkInferredSpeedMph, cap);
          return Math.min(inferred, dbCap != null ? Math.min(dbCap, cap) : cap);
        }
        if (dbCap != null) return dbCap;
        if (modality === 'stair') return 14;
        if (modality === 'bike' || modality === 'elliptical') return 16;
        return null;
      })();

      // Vary cardio prescription based on goal, recovery, and session context.
      // Include planned day as a seed so weekly days don't collapse to the
      // same exact cardio prescription when history is unchanged.
      const planningSeed = planningDate ? planningDate.getDay() : new Date().getDay();
      const sessionIdx = ((profile.exercisePreferences.find(
        p => p.exerciseName === sel.exercise.name.toLowerCase()
      )?.totalSessions ?? 0) + planningSeed) % 4;

      let targetHrZone: number | null = null;

      if (recoveryAdj.isDeload) {
        duration = Math.round(baseDuration * cfg.deloadCardioDurationMultiplier);
        targetHrZone = 1;
        adjustments.push(`Deload: easy cardio, Zone 1, duration ${Math.round(duration / 60)} min`);
        if (speed != null) {
          speed = Math.round(speed * cfg.deloadCardioIntensityMultiplier * 10) / 10;
        }
      } else if (goal === 'cut') {
        if (sessionIdx % 2 === 0) {
          targetHrZone = 2;
          duration = Math.round(baseDuration * cfg.cardioCutExtendedDurationMult);
          adjustments.push(`Cut phase: extended Zone 2 (${Math.round(duration / 60)} min) — maximize fat oxidation`);
        } else {
          targetHrZone = 3;
          duration = Math.round(baseDuration * cfg.cardioCutTempoDurationMult);
          if (speed != null) speed = Math.round(speed * cfg.cardioCutTempoSpeedMult * 10) / 10;
          if (incline != null) incline = Math.round(Math.min(incline + 1, 15) * 10) / 10;
          adjustments.push(`Cut phase: Zone 3 tempo (${Math.round(duration / 60)} min) — higher calorie burn rate`);
        }
      } else if (goal === 'bulk') {
        targetHrZone = 2;
        duration = Math.min(duration, cfg.cardioBulkMaxDuration);
        adjustments.push(`Bulk phase: capped at ${Math.round(duration / 60)} min Zone 2 — minimize interference with growth`);
      } else {
        // Maintain: rotate through varied styles
        switch (sessionIdx) {
          case 0: // Steady-state Zone 2
            targetHrZone = 2;
            adjustments.push(`Steady state: Zone 2, ${Math.round(duration / 60)} min — aerobic base building`);
            break;
          case 1: // Moderate tempo Zone 3
            targetHrZone = 3;
            duration = Math.round(baseDuration * cfg.cardioMaintainTempoDurationMult);
            if (speed != null) speed = Math.round(speed * cfg.cardioMaintainTempoSpeedMult * 10) / 10;
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
            duration = Math.round(baseDuration * cfg.cardioMaintainProgressiveDurationMult);
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

      if (fatLossController?.active) {
        const oldDuration = duration;
        duration = Math.max(8 * 60, Math.round(duration * fatLossController.cardioDurationMultiplier));
        if (duration !== oldDuration) {
          adjustments.push(`Fat-loss controller (${fatLossController.tier}): duration ${Math.round(oldDuration / 60)} → ${Math.round(duration / 60)} min`);
        }
        if (speed != null && fatLossController.cardioIntensityMultiplier !== 1.0) {
          const oldSpeed = speed;
          speed = Math.round(speed * fatLossController.cardioIntensityMultiplier * 10) / 10;
          if (speed !== oldSpeed) {
            adjustments.push(`Fat-loss controller: ${speedLabel ?? 'intensity'} ${oldSpeed} → ${speed}`);
          }
        }
        if (incline != null && fatLossController.cardioIntensityMultiplier > 1.0) {
          const oldIncline = incline;
          const add = fatLossController.cardioIntensityMultiplier >= 1.1 ? 1.0 : 0.5;
          incline = Math.round(Math.min(incline + add, 15) * 10) / 10;
          if (incline !== oldIncline) {
            adjustments.push(`Fat-loss controller: incline ${oldIncline} → ${incline}`);
          }
        }
      }
      if (speed != null && modalitySpeedCap != null && speed > modalitySpeedCap) {
        const oldSpeed = speed;
        speed = modalitySpeedCap;
        adjustments.push(`Safety cap: ${speedLabel ?? 'intensity'} ${oldSpeed} → ${speed} (${isWalkLike ? 'walk-mode cap' : 'modality cap'})`);
        if (goal === 'cut' && targetHrZone != null && targetHrZone >= 2) {
          if (incline != null) {
            const oldIncline = incline;
            incline = Math.round(Math.min(incline + 1.5, 15) * 10) / 10;
            if (incline !== oldIncline) {
              adjustments.push(`Cut phase HR compensation: incline ${oldIncline} → ${incline}`);
            }
          } else {
            const oldDuration = duration;
            duration = Math.round(duration * 1.1);
            adjustments.push(`Cut phase HR compensation: duration ${Math.round(oldDuration / 60)} → ${Math.round(duration / 60)} min`);
          }
        }
      }
      if (goal === 'cut' && capability) {
        const zoneLow = capability.preferredHrZoneLow != null ? Math.round(capability.preferredHrZoneLow) : null;
        const zoneHigh = capability.preferredHrZoneHigh != null ? Math.round(capability.preferredHrZoneHigh) : null;
        if (zoneLow != null && zoneHigh != null && zoneLow >= 1 && zoneHigh <= 5 && zoneLow <= zoneHigh) {
          const defaultZone = targetHrZone ?? zoneLow;
          targetHrZone = Math.max(zoneLow, Math.min(zoneHigh, defaultZone));
        }
      }
      if (goal === 'cut' && targetHrZone != null && targetHrZone < 2) {
        targetHrZone = 2;
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
        rirRange: null,
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
    const selIdentity = classifyExercise(sel.exercise.name, sel.exercise);
    const isBodyweight = selIdentity.isBodyweight;
    const isTimedHold = isTimedHoldExercise(sel.exercise.name);

    // ── Learned-anchored prescription with double-progression awareness ──
    //
    // Previously: targetReps = round(median(last 6 sessions)) when learned
    // data existed. This was a self-feeding loop — the engine prescribed
    // exactly what the user already did, the user did exactly what was
    // prescribed, the median didn't move, and progression never triggered
    // (the gate requires lastReps ≥ targetReps + 1, mathematically
    // impossible when target == median actual).
    //
    // The fix: anchor target to the FLOOR of the table range, then nudge
    // upward when the user has been hitting it. Weight progression then
    // kicks in once they reach the top of the range — classic double
    // progression. The learned value becomes a *floor* (don't prescribe
    // fewer reps than the user is comfortable with), not a *target*.
    const pref = profile.exercisePreferences.find(
      p => p.exerciseName === sel.exercise.name.toLowerCase()
    );
    // Raised from 2 → 4 sessions: with only 2 sessions, a single fluky
    // workout (illness, equipment swap, sleep deprivation) dominates the
    // median and propagates as the engine's "best estimate" of user
    // capacity. 4 sessions of evidence is the minimum for a credible
    // signal that survives one outlier.
    const hasLearnedData = pref && pref.recentSessions >= 4;

    const tableRange = getRepRangeByRole(role, goal, secondaryGoal, dayOccurrenceIndex, cfg, sel.exercise.ml_exercise_type);
    const learnedRepsRounded = hasLearnedData && pref.learnedReps != null
      ? Math.round(pref.learnedReps)
      : null;
    // Target = max(table.target, learnedReps). Use learned value as a floor:
    // if the user has been hitting 10 reps consistently and the table says
    // 8, prescribe 10. Never prescribe BELOW user's demonstrated capacity.
    let targetReps = learnedRepsRounded != null
      ? Math.max(tableRange.target, Math.min(tableRange.max, learnedRepsRounded))
      : tableRange.target;

    // Sets: same fix. Use learned as a floor (don't drop sets below user's
    // demonstrated tolerance), but never below the table's role-based base.
    const tableSets = getTieredSets(role, goal, isPriority, recoveryAdj.isDeload, mesocycleVolumeMult);
    const learnedSetsRounded = hasLearnedData && pref.learnedSets != null
      ? Math.round(pref.learnedSets)
      : null;
    let sets = learnedSetsRounded != null
      ? Math.max(tableSets, learnedSetsRounded)
      : tableSets;
    let setsAdjustedByHighCapacity: { from: number; to: number } | null = null;
    if (highCapacityPush?.active && !recoveryAdj.isDeload) {
      const oldSets = sets;
      if (role === 'primary' || role === 'secondary') {
        sets = Math.max(2, Math.min(8, Math.round(sets * highCapacityPush.volumeMultiplier)));
      } else if (role === 'isolation') {
        sets = Math.max(2, Math.min(6, Math.round(sets * Math.max(1.0, highCapacityPush.volumeMultiplier - 0.05))));
      }
      if (sets !== oldSets) setsAdjustedByHighCapacity = { from: oldSets, to: sets };
    }

    // Antifragility-driven volume scaling: muscles that thrive on stress get more volume
    const afIndex = profile.antifragilityIndices?.find(
      a => a.muscleGroup === sel.muscleGroup
    );
    let setsAdjustedByAntifragility: { from: number; to: number } | null = null;
    if (afIndex && afIndex.dataPoints >= 6 && !recoveryAdj.isDeload) {
      const oldSets = sets;
      if (afIndex.recommendation === 'aggressive' && afIndex.index > 0.25) {
        sets = Math.min(8, sets + 1);
      } else if (afIndex.recommendation === 'conservative' && afIndex.index < -0.15) {
        sets = Math.max(2, sets - 1);
      }
      if (sets !== oldSets) setsAdjustedByAntifragility = { from: oldSets, to: sets };
    }

    let setsAdjustedByFatLossStall: { from: number; to: number } | null = null;
    if (
      fatLossController?.active
      && fatLossController.tier === 'stalled'
      && !recoveryAdj.isDeload
      && goal === 'cut'
      && (role === 'primary' || role === 'secondary')
      && exType === 'compound'
      && sets < 6
    ) {
      const prev = sets;
      sets += 1;
      setsAdjustedByFatLossStall = { from: prev, to: sets };
    }

    // #4: Compliance Feedback — adjust reps when user consistently exceeds
    // (we're underprescribing) or undershoots (we're overprescribing) the
    // prescription. Bidirectional correction was missing — only positive
    // deviation was acted on, so chronic over-prescription compounded.
    if (profile.prescribedVsActual) {
      const compliance = profile.prescribedVsActual;
      const repsDev = Number(compliance.avgRepsDeviation ?? 0);
      // User is doing more reps than prescribed at decent compliance →
      // weight is too light. Bump reps; the next progression cycle will
      // graduate the weight once the user is at the top of the range.
      if (repsDev > 1.5 && compliance.complianceRate > 0.6) {
        targetReps = Math.min(targetReps + Math.round(Math.min(2, repsDev / 2)), tableRange.max);
      }
      // User is consistently undershooting reps → over-prescribed. Pull
      // reps back into the bottom of the range so the user can complete
      // the workout (compliance fix).
      if (repsDev < -1.5 && compliance.complianceRate < 0.7) {
        targetReps = Math.max(tableRange.min, targetReps - 1);
      }
    }
    targetReps = humanizeRepTarget(targetReps, tableRange.min, tableRange.max);

    // #2: Rest: prefer learned rest, with movement-pattern-aware fallback
    const tableRest = getRestByExercise(sel.exercise, role, goal, dayOccurrenceIndex, cfg);
    const learnedRest = pref?.learnedRestSeconds;
    let restSeconds: number;
    if (learnedRest != null && learnedRest > 0) {
      restSeconds = learnedRest;
    } else {
      restSeconds = tableRest;
    }
    let restAdjustedByFatLossController: { from: number; to: number } | null = null;
    if (profile.sleepVolumeModifier?.restTimeMultiplier) {
      restSeconds = Math.round(restSeconds * profile.sleepVolumeModifier.restTimeMultiplier);
    }
    if (fatLossController?.active && fatLossController.restSecondsMultiplier !== 1.0) {
      const oldRest = restSeconds;
      restSeconds = Math.max(30, Math.round(restSeconds * fatLossController.restSecondsMultiplier));
      if (restSeconds !== oldRest) restAdjustedByFatLossController = { from: oldRest, to: restSeconds };
    }
    let restAdjustedByHighCapacity: { from: number; to: number } | null = null;
    if (highCapacityPush?.active && !recoveryAdj.isDeload && highCapacityPush.restSecondsMultiplier !== 1.0) {
      const oldRest = restSeconds;
      restSeconds = Math.max(30, Math.round(restSeconds * highCapacityPush.restSecondsMultiplier));
      if (restSeconds !== oldRest) restAdjustedByHighCapacity = { from: oldRest, to: restSeconds };
    }

    const isLastSetInExercise = false;
    let rir = getRirTarget(role, goal, recoveryAdj.isDeload, prefs.experience_level, mesocycleRirOffset, isLastSetInExercise);
    if (highCapacityPush?.active && !recoveryAdj.isDeload && highCapacityPush.rirDelta !== 0) {
      rir = Math.max(0, Math.min(4, rir + highCapacityPush.rirDelta));
    }

    // RIR taper: set 1 starts at base+2, each set drops by 1, last set = base RIR.
    // targetRir = average across sets; rirRange = [startRir, endRir] for UI display.
    const lastSetRir = getRirTarget(role, goal, recoveryAdj.isDeload, prefs.experience_level, mesocycleRirOffset, true);
    let rirRangeStart = Math.min(4, rir + 2);
    let rirRangeEnd = lastSetRir;
    if (highCapacityPush?.active && !recoveryAdj.isDeload && highCapacityPush.rirDelta !== 0) {
      rirRangeStart = Math.max(0, Math.min(4, rirRangeStart + highCapacityPush.rirDelta));
      rirRangeEnd = Math.max(0, Math.min(4, rirRangeEnd + highCapacityPush.rirDelta));
    }
    if (rirRangeStart < rirRangeEnd) rirRangeStart = rirRangeEnd;
    const rirRange: [number, number] = [rirRangeStart, rirRangeEnd];
    const tempo = getTempo(sel.exercise.default_tempo, goal, sel.exercise.ml_exercise_type, dayOccurrenceIndex);

    // Weight determination: progression data > learned weight > lift ratios > null
    const prog = profile.exerciseProgressions.find(
      p => p.exerciseName === sel.exercise.name.toLowerCase()
    );

    let targetWeight: number | null = null;
    const adjustments: string[] = [];
    if (setsAdjustedByAntifragility) {
      adjustments.push(`Antifragility (${afIndex!.muscleGroup} index ${afIndex!.index.toFixed(2)}): sets ${setsAdjustedByAntifragility.from} → ${setsAdjustedByAntifragility.to}`);
    }
    if (setsAdjustedByHighCapacity) {
      adjustments.push(`High-capacity mode: sets ${setsAdjustedByHighCapacity.from} → ${setsAdjustedByHighCapacity.to}`);
    }
    if (setsAdjustedByFatLossStall) {
      adjustments.push(`Fat-loss stall guard: +1 compound set (${setsAdjustedByFatLossStall.from} → ${setsAdjustedByFatLossStall.to}); cardio dose still primary lever`);
    }
    if (restAdjustedByFatLossController) {
      adjustments.push(`Fat-loss controller: rest ${restAdjustedByFatLossController.from}s → ${restAdjustedByFatLossController.to}s`);
    }
    if (restAdjustedByHighCapacity) {
      adjustments.push(`High-capacity mode: rest ${restAdjustedByHighCapacity.from}s → ${restAdjustedByHighCapacity.to}s`);
    }

    // Source annotation: tell user where each prescription value came from
    if (hasLearnedData) {
      const sources: string[] = [];
      if (pref.learnedReps != null) sources.push(`reps=${Math.round(pref.learnedReps)}`);
      if (pref.learnedSets != null) sources.push(`sets=${Math.round(pref.learnedSets)}`);
      if (pref.learnedRestSeconds != null) sources.push(`rest=${pref.learnedRestSeconds}s`);
      adjustments.push(`Learned from your last ${pref.recentSessions} sessions: ${sources.join(', ')}`);
    }

    // ── Weight Prescription Pipeline ──
    // Three-phase decision: (1) compute baseWeight, (2) apply ONE modifier, (3) safety bounds.
    let weightSource: 'e1rm' | 'learned' | 'ratio' | 'none' = 'none';

    if (prog) {
      const e1rm = prog.estimated1RM;
      targetWeight = weightForReps(e1rm, targetReps, rir, equipment, exType);
      if (targetWeight < prog.lastWeight * 0.5 && prog.lastWeight > 0) {
        targetWeight = snapToPlate(prog.lastWeight * cfg.weightRescueFloorMult, equipment, exType);
      }
      weightSource = 'e1rm';
      adjustments.push(`Base weight from est. 1RM ${Math.round(e1rm)} lbs → ${targetWeight} lbs for ${targetReps} reps @ RIR ${rir}`);

      // Phase 2: Apply ONE modifier (priority: deload > regression > plateau > progression > forecast)
      let modifierApplied = false;

      // Priority 1: Deload
      if (recoveryAdj.isDeload) {
        targetWeight = snapToPlate(targetWeight * cfg.deloadWeightMultiplier, equipment, exType);
        adjustments.push(`Deload: weight at ${Math.round(cfg.deloadWeightMultiplier * 100)}% (${targetWeight} lbs)`);
        modifierApplied = true;
      }

      // Priority 2: Regression
      if (!modifierApplied && prog.status === 'regressing') {
        const regressionSeverity = Math.abs(prog.progressionSlope);
        const regressingLifts = profile.exerciseProgressions.filter(p => p.status === 'regressing');
        const isSystemicRegression = regressingLifts.length >= 3;

        if (isSystemicRegression) {
          const reductionPct = cfg.regressionSystemicMult;
          targetWeight = snapToPlate(targetWeight * reductionPct, equipment, exType);
          sets = Math.max(2, sets - 1);
          adjustments.push(`Systemic regression (${regressingLifts.length} lifts declining): weight to ${targetWeight} lbs (${Math.round(reductionPct * 100)}%), sets -1 — prioritize recovery`);
        } else if (regressionSeverity > 0.05) {
          const reductionPct = cfg.regressionSevereMult;
          targetWeight = snapToPlate(targetWeight * reductionPct, equipment, exType);
          adjustments.push(`Severe regression: reduced to ${targetWeight} lbs (${Math.round(reductionPct * 100)}%) — rebuild from here`);
        } else {
          const reductionPct = Math.max(0.85, cfg.regressionWeightMultiplier);
          targetWeight = snapToPlate(targetWeight * reductionPct, equipment, exType);
          adjustments.push(`Mild regression: reduced to ${targetWeight} lbs (${Math.round(reductionPct * 100)}%)`);
        }
        modifierApplied = true;
      }

      // Priority 3: Plateau (stalled)
      if (!modifierApplied && prog.status === 'stalled') {
        const plateauClass = profile.plateauClassifications?.find(
          c => c.exerciseName === sel.exercise.name.toLowerCase()
        );
        const plateauInfo = profile.plateauDetections.find(
          p => p.exerciseName === sel.exercise.name.toLowerCase() && p.isPlateaued
        );
        if (plateauClass) {
          switch (plateauClass.plateauType) {
            case 'neural':
              rir = Math.max(0, rir - 1);
              adjustments.push(`Neural plateau: lower RIR to ${rir}, try heavier singles/pauses`);
              break;
            case 'structural':
              sets = Math.min(8, sets + 1);
              adjustments.push(`Structural plateau: +1 set (now ${sets}) for additional hypertrophy stimulus`);
              break;
            case 'recovery':
              sets = Math.max(2, sets - 1);
              targetWeight = snapToPlate(targetWeight * cfg.regressionWeightMultiplier, equipment, exType);
              adjustments.push(`Recovery plateau: -1 set, weight to ${targetWeight} lbs — recovery is the bottleneck`);
              break;
            case 'skill':
              rir = Math.max(1, rir + 1);
              adjustments.push(`Skill plateau: higher RIR (${rir}), focus on technique quality over load`);
              break;
          }
        } else if (plateauInfo && plateauInfo.sessionsSinceProgress >= 4) {
          adjustments.push(`Plateau (${plateauInfo.sessionsSinceProgress} sessions): drop to ${sets - 1} sets × ${targetReps + 2} reps to break through`);
        } else {
          adjustments.push(`Stalled at ${targetWeight} lbs — hold weight, focus on RIR ${rir}`);
        }
        modifierApplied = true;
      }

      // Priority 4: Progression
      if (!modifierApplied) {
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

        // Honest effort gate: don't fully award progression if recent effort
        // is low, but never zero out completely. Hard-zero blocks meant a
        // single soft session (deload, illness, scheduling churn) could
        // freeze progression for 2–3 cycles even after the user resumed
        // hard training. Floor at 0.25× ensures the system keeps moving
        // forward when warranted by the actual progression status.
        const effortScore = profile.honestEffort?.avgCompositeScore ?? null;
        const effortGateMultiplier = effortScore == null
          ? 1.0
          : effortScore < cfg.effortGateBlockThreshold ? 0.25
          : effortScore < cfg.effortGateHalfThreshold ? 0.5
          : 1.0;
        if (effortScore != null && effortGateMultiplier < 1.0) {
          adjustments.push(`Effort-gated progression: ${Math.round(effortGateMultiplier * 100)}% increment (avg effort: ${effortScore}%)`);
        }

        const lastReps = prog.bestSet.reps;
        // Double-progression gate: progress weight when user is hitting the
        // TOP of the rep range, not just when they exceed a single target.
        // Previously used `targetReps + 1` against a target derived from the
        // user's median performance, which mathematically can never trigger.
        const progressionRepThreshold = Math.max(tableRange.max, targetReps);
        const canProgress = (prog.status === 'progressing' || prog.status === 'maintaining') && effortGateMultiplier > 0;
        if (lastReps >= progressionRepThreshold && canProgress) {
          if (bestPatternType === 'double_progression' && breakthrough && !breakthrough.readyForWeightJump) {
            adjustments.push(`Double progression: add reps before weight (${breakthrough.accumulatedRepsAtWeight} reps accumulated, need ${breakthrough.typicalRepsBeforeJump})`);
          } else {
            const gatedIncrement = Math.round(increment * effortGateMultiplier * 10) / 10;
            targetWeight = snapToPlate(targetWeight + gatedIncrement, equipment, exType);
            adjustments.push(`Progressive overload: +${snapToPlate(gatedIncrement, equipment, exType)} lbs (last session: ${lastReps} reps vs ${targetReps} target)`);
          }
          modifierApplied = true;
        } else if (prog.status === 'progressing') {
          adjustments.push(`Carry forward: ${targetWeight} lbs at RIR ${rir}`);
          modifierApplied = true;
        }
      }

      // Priority 5: Forecast — only when no other modifier applied
      if (!modifierApplied && profile.progressionForecasts && breakRampMultiplier >= 1.0) {
        const forecast = profile.progressionForecasts.find(
          f => f.exerciseName === sel.exercise.name.toLowerCase()
        );
        if (forecast && forecast.confidence >= 0.5 && forecast.predictedTargetWeight > 0) {
          const forecastWeight = forecast.predictedTargetWeight;
          if (forecastWeight <= targetWeight * 1.10 && forecastWeight >= targetWeight * 0.90) {
            targetWeight = forecastWeight;
            adjustments.push(`Forecast: ${forecastWeight}lbs (R²=${forecast.confidence.toFixed(2)})`);
            modifierApplied = true;
          }
        }
      }

      if (!modifierApplied) {
        adjustments.push(`Hold: ${targetWeight} lbs (no modifier triggered)`);
      }

      if (profile.bodyWeightTrend.phase === 'cutting' && prog.status !== 'regressing') {
        adjustments.push('Cutting phase: maintaining weight is success');
      }

      // Ego audit: safety cap applied after the single modifier decision
      const egoFlag = profile.egoAuditFlags?.find(
        f => f.exerciseName.toLowerCase() === sel.exercise.name.toLowerCase()
      );
      if (egoFlag && egoFlag.suspectedIssue === 'ego_lift' && targetWeight != null) {
        const cap = snapToPlate(targetWeight * cfg.egoAuditCapMult, equipment, exType);
        if (cap < targetWeight) {
          adjustments.push(`Ego audit: weight ${targetWeight} → ${cap} lbs (${egoFlag.exerciseName} ratio ${Math.round(egoFlag.actualRatio * 100)}% vs expected ${Math.round(egoFlag.expectedRange[0] * 100)}-${Math.round(egoFlag.expectedRange[1] * 100)}% of ${egoFlag.referenceExercise})`);
          targetWeight = cap;
        }
      }

      // Phase 3: Safety bounds — sleep adjustment (environmental, not a modifier)
      if (profile.sleepCoefficients.confidence !== 'low' && profile.recoveryContext.sleepDurationLastNight != null && profile.recoveryContext.sleepBaseline30d != null) {
        const sleepDelta = (profile.recoveryContext.sleepDurationLastNight - profile.recoveryContext.sleepBaseline30d) / profile.recoveryContext.sleepBaseline30d;
        if (sleepDelta < cfg.sleepDeltaThreshold) {
          const isLower = ['quadriceps', 'hamstrings', 'glutes'].includes(sel.muscleGroup);
          const coeff = isLower ? profile.sleepCoefficients.lowerBody : profile.sleepCoefficients.upperBody;
          if (Math.abs(coeff) > cfg.sleepCoefficientMinimum) {
            const rawAdj = coeff * sleepDelta * targetWeight;
            const weightAdj = -snapToPlate(Math.abs(rawAdj), equipment, exType);
            if (weightAdj < -2) {
              targetWeight = snapToPlate(targetWeight + weightAdj, equipment, exType);
              adjustments.push(`Sleep-performance: ${weightAdj} lbs (learned from your data)`);
            }
          }
        }
      }
    } else if (hasLearnedData && pref.learnedWeight != null) {
      // No progression data (< 3 sessions) but learned weight exists.
      // Reconcile against learned reps so we never prescribe a weight heavier
      // than the user has actually moved for the target rep range. Without
      // this gate, a single near-1RM session could anchor learnedWeight at
      // capacity and produce e.g. "11 reps at 1RM" prescriptions.
      let candidate = pref.learnedWeight;
      if (pref.learnedReps != null && pref.learnedReps > 0) {
        const learnedReps = Math.max(1, Math.round(pref.learnedReps));
        const e1rmFromLearned = pref.learnedWeight * (1 + learnedReps / 30);
        const reconciled = weightForReps(e1rmFromLearned, targetReps, rir, equipment, exType);
        if (reconciled > 0 && reconciled < candidate) {
          candidate = reconciled;
          adjustments.push(
            `Learned-weight reconciled: ${pref.learnedWeight} lbs @ ~${learnedReps} reps → ` +
            `${reconciled} lbs for ${targetReps} reps @ RIR ${rir}`
          );
        }
      }
      targetWeight = snapToPlate(candidate, equipment, exType);
      weightSource = 'learned';
      adjustments.push(`Weight from your recent sessions: ${targetWeight} lbs`);
    } else if (!isBodyweight) {
      // No data at all — estimate from lift ratios + strength standards
      const knownLifts = {
        bench: profile.exerciseProgressions.find(p => p.exerciseName.toLowerCase().includes('bench press'))?.lastWeight ?? null,
        squat: profile.exerciseProgressions.find(p => p.exerciseName.toLowerCase().includes('squat') && !p.exerciseName.toLowerCase().includes('front'))?.lastWeight ?? null,
        deadlift: profile.exerciseProgressions.find(p => {
          const n = p.exerciseName.toLowerCase();
          return n.includes('deadlift') && !/(romanian|rdl|stiff.leg|single.leg)/i.test(n);
        })?.lastWeight ?? null,
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
    const timedHoldSeconds = isTimedHold ? getTimedHoldSeconds(goal) : null;
    const estMin = isTimedHold
      ? Math.max(
          2,
          Math.round(
            ((sets * (timedHoldSeconds ?? 0)) + (Math.max(0, sets - 1) * restSeconds) + ((warmupSets?.length ?? 0) * 30) + TRANSITION_TIME_SEC.strength) / 60
          )
        )
      : estimateExerciseMinutes(sets, restSeconds, role, warmupSets?.length ?? 0, targetReps, tempo);

    // Weight sanity cap: prevent absurd prescriptions from bad estimates or inflated 1RMs.
    // Caps are tiered by equipment, exercise type, AND exercise role.
    if (targetWeight != null && !isBodyweight) {
      const bw = prefs.body_weight_lbs ?? cfg.defaultBodyWeightLbs;

      let maxPlausible: number;
      if (exType === 'isolation') {
        maxPlausible = bw * cfg.weightCapIsolationMult;
      } else if (role === 'corrective' || role === 'isolation') {
        maxPlausible = bw * cfg.weightCapCorrectiveMult;
      } else if (equipment.includes('machine') || equipment.includes('cable')) {
        maxPlausible = bw * cfg.weightCapMachineMult;
      } else if (equipment.includes('dumbbell')) {
        maxPlausible = bw * cfg.weightCapDumbbellMult;
      } else if (selIdentity.isPrimaryLift) {
        maxPlausible = bw * cfg.weightCapPrimaryLiftMult;
      } else if (role === 'primary') {
        maxPlausible = bw * cfg.weightCapPrimaryMult;
      } else {
        maxPlausible = bw * cfg.weightCapDefaultMult;
      }

      if (targetWeight > maxPlausible) {
        adjustments.push(`Weight capped: ${targetWeight} → ${Math.round(maxPlausible)} lbs (sanity limit for ${exType ?? 'exercise'})`);
        targetWeight = Math.round(maxPlausible);
      }
    }

    // Phase 0 — Rep×Load identity guard (final safety layer).
    // Catches any path that produced a weight the user cannot move for the
    // prescribed reps × RIR: stacked modifiers, forecast overshoots, the
    // learned-weight bypass, or stale 1RM estimates. The bodyweight cap
    // above does not know about reps, so this is the only check that
    // enforces the physical (Epley) relationship between weight and reps.
    if (targetWeight != null && !isBodyweight && !isTimedHold && targetReps > 0) {
      const e1rmRef = deriveE1rmReference(prog, pref);
      const safe = clampToRepLoadCeiling(targetWeight, targetReps, rir, e1rmRef, equipment, exType, cfg);
      if (safe.note) adjustments.push(safe.note);
      targetWeight = safe.weight;
    }

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
      targetReps: isTimedHold ? 0 : targetReps,
      targetRepRange: isTimedHold ? null : { min: tableRange.min, max: tableRange.max },
      targetWeight: isBodyweight
        ? null
        : (targetWeight ? clampHotelModeWeight(snapToPlate(targetWeight, equipment, exType), equipment) : null),
      targetRir: rir,
      rirLabel: getRirLabel(rir),
      rirRange: sets >= 2 ? rirRange : null,
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
      targetTimeSeconds: timedHoldSeconds,
      warmupSets,
      supersetGroupId: null,
      supersetType: null,
      impactScore: impact,
      estimatedMinutes: estMin,
    };
  });
}

// ─── Step 5: Apply Session Constraints (Ordering + Time Budget + Supersets) ──

function getCnsDemandTier(ex: GeneratedExercise): number {
  return classifyCnsDemandFromName(
    String(ex.exerciseName || '').toLowerCase(),
    (ex.movementPattern || '').toLowerCase() || null,
  );
}

function estimateGeneratedEffectiveSetWeight(ex: GeneratedExercise): number {
  const identity = classifyGeneratedExercise(ex);
  const sfr = getExerciseSFR(ex.exerciseName);
  const role = String(ex.exerciseRole || '').toLowerCase();
  const pattern = String(ex.movementPattern || '').toLowerCase();
  const group = String(ex.targetMuscleGroup || '').toLowerCase();
  let weight = 1.0;
  if (Number.isFinite(sfr) && sfr > 0) {
    weight *= clampNumber(0.82 + (sfr - 1) * 0.32, 0.72, 1.32);
  }
  if (role === 'primary' || role === 'secondary' || pattern === 'compound') weight *= 1.08;
  if (role === 'isolation' || role === 'corrective') weight *= 0.92;
  if (group === 'hamstrings' && identity.isHinge) {
    weight *= 1.1;
  }
  return clampNumber(weight, 0.55, 1.45);
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
  couplingSignals?: Record<string, CouplingSignal>,
  actionCostMinutes: number = 1,
  sessionStimulusByGroup?: Record<string, number>,
): number {
  const hasHingeInSession = currentExercises.some(ex => classifyGeneratedExercise(ex).isHinge);
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

    const coupling = couplingSignals?.[(ex.targetMuscleGroup ?? '').toLowerCase()];
    const couplingMod = coupling
      ? clampNumber(1 + coupling.priorityDelta * 0.55, 0.72, 1.28)
      : 1.0;
    const hingeSetPenalty = (hasHingeInSession && classifyGeneratedExercise(ex).isHinge && ex.sets >= 4) ? 0.72 : 1.0;
    const recoveryMod = vol
      ? clampNumber(0.78 + Math.min(1.2, (vol.daysSinceLastTrained ?? 0) / 3) * 0.22, 0.78, 1.12)
      : 1.0;
    const rawValue = stimulus * volMod * couplingMod * hingeSetPenalty * recoveryMod;
    const timePenalty = Math.pow(Math.max(actionCostMinutes, 0.5), 0.65);
    const group = String(ex.targetMuscleGroup ?? '').toLowerCase();
    const priorStimulus = sessionStimulusByGroup?.[group] ?? 0;
    const saturationMod = clampNumber(1 / (1 + priorStimulus * 0.28), 0.45, 1.0);
    return (rawValue * saturationMod) / timePenalty;
  }

  // add_exercise: value of bringing in a brand-new movement
  const sel = action.exercise;
  const sfr = getExerciseSFR(sel.exercise.name);
  const effectiveSetBudget = Math.max(1, Number(sel.effectiveSets || sel.sets || 1));
  const baseStimulus = sfrCurve(0, sfr) * effectiveSetBudget;

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

  const coupling = couplingSignals?.[group];
  const couplingMod = coupling
    ? clampNumber(1 + coupling.priorityDelta * 0.65, 0.68, 1.35)
    : 1.0;
  const hingeAddPenalty = (hasHingeInSession && classifyExercise(sel.exercise.name, sel.exercise).isHinge) ? 0.62 : 1.0;
  const recoveryMod = vol
    ? clampNumber(0.8 + Math.min(1.3, (vol.daysSinceLastTrained ?? 0) / 3) * 0.2, 0.8, 1.15)
    : 1.0;
  const rawValue = baseStimulus * volMod * freqBonus * varietyBonus * couplingMod * hingeAddPenalty * recoveryMod;
  const timePenalty = Math.pow(Math.max(actionCostMinutes, 0.5), 0.65);
  const priorStimulus = sessionStimulusByGroup?.[group] ?? 0;
  const saturationMod = clampNumber(1 / (1 + priorStimulus * 0.28), 0.45, 1.0);
  return (rawValue * saturationMod) / timePenalty;
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
  const hipAbductorSignal = computeHipAbductorLoadSignal(profile);
  const systemCouplingSignals = computeSystemCouplingSignals(profile, hipAbductorSignal);
  strength.forEach((ex, i) => {
    if (!groupPriority.has(ex.targetMuscleGroup)) groupPriority.set(ex.targetMuscleGroup, i);
  });

  const scored = strength.map(ex => {
    const hist = positionMap.get(ex.exerciseName.toLowerCase());
    const cnsTier = getCnsDemandTier(ex);
    const mp = (ex.movementPattern || '').toLowerCase();
    const isCompound = COMPOUND_MOVEMENT_PATTERNS.has(mp) || cnsTier <= 2;
    const histNudge = (hist && hist.sessions >= 3) ? hist.avgNormalizedPosition * 2 : 0;
    const gp = groupPriority.get(ex.targetMuscleGroup) ?? 99;
    // Primary: compound tier (0) vs isolation tier (1000)
    // Within compounds: CNS demand (lower = heavier = first)
    // Within isolations: muscle group priority, then CNS demand
    let sortKey = isCompound
      ? cnsTier * 10 + histNudge
      : 1000 + gp * 20 + cnsTier * 5 + histNudge;
    if (!isCompound && ex.targetMuscleGroup === 'abductors' && hipAbductorSignal.abductorPriorityBoost > 0) {
      // Front-load hip-stability accessories when ambulatory load is high.
      sortKey -= Math.round(220 + hipAbductorSignal.abductorPriorityBoost * 100);
    }
    if (!isCompound) {
      const coupling = systemCouplingSignals[ex.targetMuscleGroup];
      if (coupling && Math.abs(coupling.priorityDelta) > 0.02) {
        // Positive coupling delta => earlier; negative => later.
        sortKey -= coupling.priorityDelta * 120;
        if (!Array.isArray(ex.adjustments)) ex.adjustments = [];
        ex.adjustments.push(
          `Coupling ordering: ${coupling.priorityDelta >= 0 ? 'earlier' : 'later'} (${coupling.reasons.slice(0, 2).join(', ')})`
        );
      }
    }
    return { exercise: ex, sortKey };
  });

  scored.sort((a, b) => a.sortKey - b.sortKey);
  const ordered: GeneratedExercise[] = scored.map(s => s.exercise);
  // Abductor front-loading removed: compounds must always come first.

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
  const maxCardioPct = goal === 'cut' ? cfg.maxCardioPctFatLoss
    : goal === 'bulk' ? cfg.maxCardioPctDefault * 0.65
    : cfg.maxCardioPctDefault;
  const profileCardioTargetMin = Number.isFinite(Number(prefs.cardio_duration_minutes))
    ? Math.max(8, Math.round(Number(prefs.cardio_duration_minutes)))
    : null;
  // Profile cardio target is a ceiling unless the user is explicitly in endurance focus.
  const maxTotalCardioMin = (() => {
    const goalCap = Math.round(effectiveBudget * maxCardioPct);
    if (profileCardioTargetMin == null) return goalCap;
    return Math.max(8, Math.min(goalCap, Math.round(profileCardioTargetMin * 1.05)));
  })();

  let totalStrengthMin = ordered.reduce((sum, ex) => sum + ex.estimatedMinutes, 0);
  const keptCardio: GeneratedExercise[] = [];

  for (const ex of cardio) {
    // Per-exercise cap: allow long-session goals to exceed the old static 45-min
    // ceiling while preserving a bounded upper safety limit.
    const cardioHist = profile.cardioHistory.find(c => c.exerciseName === ex.exerciseName.toLowerCase());
    const prefCardioDur = prefs.cardio_duration_minutes;
    const histAvgMin = cardioHist ? Math.round(cardioHist.avgDurationSeconds / 60) : null;
    let perExerciseCapMin = cfg.maxCardioPerExerciseMinutes;
    if (histAvgMin != null) perExerciseCapMin = Math.max(perExerciseCapMin, Math.round(histAvgMin * 1.3));
    if (prefCardioDur != null) perExerciseCapMin = Math.min(perExerciseCapMin, Math.max(8, prefCardioDur));

    // On long sessions or cardio-priority goals, let cardio use most of the
    // cardio budget instead of clipping near a static 45-minute cap.
    if (prefs.session_duration_minutes >= 100 || goal === 'cut') {
      perExerciseCapMin = Math.max(perExerciseCapMin, Math.round(maxTotalCardioMin * 0.95));
    }

    // Absolute guardrail to avoid pathological durations.
    perExerciseCapMin = Math.min(perExerciseCapMin, Math.max(120, prefs.session_duration_minutes));
    const perExerciseCap = perExerciseCapMin * 60; // convert to seconds

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
  const isCompoundGenerated = (ex: GeneratedExercise): boolean => {
    const tier = getCnsDemandTier(ex);
    return ex.movementPattern === 'compound' || tier <= 2;
  };
  const strictRequiredStapleFamilies = new Set(
    (profile.exercisePreferences ?? [])
      .filter((p: any) => Boolean(p?.isStaple) || ((Number(p?.totalSessions) || 0) >= 12 && (Number(p?.lastUsedDaysAgo) || 999) <= 35))
      .map((p: any) => stapleFamilyKey(String(p?.exerciseName || '')))
      .filter((k) => !!k && k !== 'romanian_deadlift')
  );
  const fallbackRequiredStapleFamilies = new Set(
    (profile.exercisePreferences ?? [])
      .filter((p: any) => (Number(p?.totalSessions) || 0) >= 4 && (Number(p?.lastUsedDaysAgo) || 999) <= 84)
      .map((p: any) => stapleFamilyKey(String(p?.exerciseName || '')))
      .filter((k) => !!k && k !== 'romanian_deadlift')
  );
  const requiredStapleFamilies = strictRequiredStapleFamilies.size > 0
    ? strictRequiredStapleFamilies
    : fallbackRequiredStapleFamilies;

  if (totalStrengthMin > strengthBudget) {
    // Phase 1: Compress rest on isolation and secondary exercises proportional to overshoot
    const overshootRatio = totalStrengthMin / strengthBudget;
    const restCompression = Math.min(cfg.timeBudgetMaxRestCompression, (overshootRatio - 1) * cfg.timeBudgetRestCompressionSensitivity);
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
    const keepExercises = () => ordered.filter(e => keepSet.has(e.exerciseName));
    const compoundCount = () => keepExercises().filter(isCompoundGenerated).length;
    const stapleFamilyCount = (familyKey: string) =>
      keepExercises().filter(e => stapleFamilyKey(e.exerciseName) === familyKey).length;

    for (const ex of sortedByImpact) {
      if (totalStrengthMin <= strengthBudget) break;
      if (ex.exerciseRole === 'corrective') continue;
      if (keepSet.size <= cfg.minExercisesUnderTimePressure) break;
      if (isCompoundGenerated(ex) && compoundCount() <= 1) continue;
      const familyKey = stapleFamilyKey(ex.exerciseName);
      if (requiredStapleFamilies.has(familyKey) && stapleFamilyCount(familyKey) <= 1) continue;
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
  const sessionStimulusByGroup: Record<string, number> = {};
  const addSessionStimulus = (muscleGroup: string, stimulus: number) => {
    const key = String(muscleGroup || '').toLowerCase();
    if (!key) return;
    sessionStimulusByGroup[key] = (sessionStimulusByGroup[key] ?? 0) + Math.max(0, stimulus);
  };

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
  const hotelModeEnabled = Boolean(prefs.hotel_mode);
  const isHotelModeStrengthAllowed = (ex: EnrichedExercise): boolean => {
    if (!hotelModeEnabled) return true;
    const eq = (Array.isArray(ex.equipment) ? ex.equipment : []).map(normalizeEquipment);
    return eq.includes('bodyweight') || eq.includes('dumbbell');
  };
  const clampHotelModeWeight = (weight: number | null, equipment: string[]): number | null => {
    if (!hotelModeEnabled || weight == null) return weight;
    const eqNorm = (equipment ?? []).map(normalizeEquipment);
    if (eqNorm.includes('dumbbell')) return Math.min(weight, 50);
    return weight;
  };
  const strengthPool: ExerciseSelection[] = (allExercises || [])
    .filter(ex =>
      ex.ml_exercise_type !== 'cardio'
      && ex.ml_exercise_type !== 'recovery'
      && !usedNames.has(ex.name.toLowerCase())
      && !avoidSet.has(ex.name.toLowerCase())
      && !isInjuryConflict(ex, prefs.injuries)
      && isHotelModeStrengthAllowed(ex)
    )
    .flatMap((ex) => {
      const primaryGroups = (Array.isArray(ex.primary_muscles) ? ex.primary_muscles : [])
        .map(m => resolveToCanonicalGroup(m)).filter(Boolean) as CanonicalMuscleGroup[];
      const g = primaryGroups[0];
      if (!g) return [];
      return [{
        exercise: ex,
        muscleGroup: g,
        sets: 0,
        effectiveSets: 0,
        reason: 'time_expansion',
      }];
    });
  const selectedStrengthGroupSet = new Set(
    (existingSelections ?? [])
      .filter((s) => !s.isCardio)
      .map((s) => String(s.muscleGroup || '').toLowerCase())
      .filter(Boolean)
  );
  const expansionPool: ExerciseSelection[] = selectedStrengthGroupSet.size > 0
    ? strengthPool.filter((s) => selectedStrengthGroupSet.has(String(s.muscleGroup || '').toLowerCase()))
    : strengthPool;
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
      const val = computeMarginalValue(
        action,
        ordered,
        volumeStatuses,
        mgFreq,
        systemCouplingSignals,
        cost,
        sessionStimulusByGroup,
      );
      if (val > bestValue) {
        bestValue = val;
        bestAction = action;
        bestTimeCost = cost;
      }
    }

    // Score: add each candidate new exercise (only if >= 5 min left and under cap)
    // Per-group diversity cap: max 4 exercises per muscle group (initial + expansion)
    const exercisesPerGroup: Record<string, number> = {};
    for (const ex of ordered) {
      const key = String(ex.targetMuscleGroup || '').toLowerCase();
      exercisesPerGroup[key] = (exercisesPerGroup[key] ?? 0) + 1;
    }
    const MAX_EXERCISES_PER_GROUP = 4;
    if (remainingMinutes >= 5 && addedNewCount < maxNewExercises) {
      for (const sel of expansionPool) {
        if (usedNames.has(sel.exercise.name.toLowerCase())) continue;
        const groupKey = String(sel.muscleGroup || '').toLowerCase();
        if ((exercisesPerGroup[groupKey] ?? 0) >= MAX_EXERCISES_PER_GROUP) continue;
        const role: ExerciseRole = sel.exercise.ml_exercise_type === 'compound' ? 'secondary' : 'isolation';
        const sets = role === 'secondary' ? 3 : 2;
        const rest = getRestByExercise(sel.exercise, role, effectiveGoal);
        const tableRange = getRepRangeByRole(role, effectiveGoal, secondaryGoal, undefined, undefined, sel.exercise.ml_exercise_type);
        const reps = humanizeRepTarget(tableRange.target, tableRange.min, tableRange.max);
        const tempo = getTempo(sel.exercise.default_tempo, effectiveGoal, sel.exercise.ml_exercise_type);
        const cost = estimateExerciseMinutes(sets, rest, role, 0, reps, tempo);
        if (cost > remainingMinutes) continue;
        const effectiveSets = Math.round(estimateEffectiveSetWeight(sel.exercise, sel.muscleGroup) * sets * 100) / 100;
        const scoringSel: ExerciseSelection = { ...sel, sets, effectiveSets };
        const action: MarginalAction = { type: 'add_exercise', exercise: scoringSel };
        const val = computeMarginalValue(
          action,
          ordered,
          volumeStatuses,
          mgFreq,
          systemCouplingSignals,
          cost,
          sessionStimulusByGroup,
        );
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
      addSessionStimulus(ex.targetMuscleGroup, estimateGeneratedEffectiveSetWeight(ex));
      ex.adjustments.push(`Sets expanded: ${oldSets} → ${ex.sets} (marginal value: ${bestValue.toFixed(2)})`);
    } else {
      const sel = bestAction.exercise;
      const role: ExerciseRole = sel.exercise.ml_exercise_type === 'compound' ? 'secondary' : 'isolation';
      const tableRange = getRepRangeByRole(role, effectiveGoal, secondaryGoal, undefined, undefined, sel.exercise.ml_exercise_type);
      const pref = profile.exercisePreferences.find(p => p.exerciseName === sel.exercise.name.toLowerCase());
      const reps = humanizeRepTarget(
        pref?.learnedReps ? Math.round(pref.learnedReps) : tableRange.target,
        tableRange.min,
        tableRange.max
      );
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
          targetWeight = snapToPlate(prog.lastWeight * cfg.weightRescueFloorMult, equipment, fillExType);
        }
      } else if (pref?.learnedWeight != null) {
        targetWeight = snapToPlate(pref.learnedWeight, equipment, fillExType);
      }
      // Phase 0 — Rep×Load identity guard (fill path: silent clamp).
      // Same physical invariant as the main prescriber; ensures expansion /
      // time-bank fills cannot reintroduce unsafe pairings via learnedWeight.
      if (targetWeight != null && !isBodyweight && reps > 0) {
        const e1rmRef = deriveE1rmReference(prog ?? null, pref ?? null);
        const safe = clampToRepLoadCeiling(targetWeight, reps, rir, e1rmRef, equipment, fillExType, cfg);
        targetWeight = safe.weight;
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
        targetWeight: isBodyweight
          ? null
          : (targetWeight ? clampHotelModeWeight(snapToPlate(targetWeight, equipment, fillExType), equipment) : null),
        targetRir: rir,
        rirLabel: getRirLabel(rir),
        rirRange: null,
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
      addSessionStimulus(newEx.targetMuscleGroup, estimateGeneratedEffectiveSetWeight(newEx) * newEx.sets);
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
      const value = computeMarginalValue(
        { type: 'add_set', exerciseIndex: i },
        ordered,
        volumeStatuses,
        mgFreq,
        systemCouplingSignals,
        cost,
        sessionStimulusByGroup,
      );
      const slackCloseness = 1 / (1 + Math.abs(projected - targetUnfilledMinutes));
      const score = value * 0.78 + slackCloseness * 0.22;
      if (!bestFill || score > bestFill.score) {
        bestFill = { type: 'add_set', exerciseIndex: i, cost, projected, score };
      }
    }

    if (remainingMinutes >= 3 && addedNewCount < (maxNewExercises + 2)) {
      for (const sel of expansionPool) {
        if (usedNames.has(sel.exercise.name.toLowerCase())) continue;
        const role: ExerciseRole = sel.exercise.ml_exercise_type === 'compound' ? 'secondary' : 'isolation';
        const rest = getRestByExercise(sel.exercise, role, effectiveGoal);
        const tableRange = getRepRangeByRole(role, effectiveGoal, secondaryGoal, undefined, undefined, sel.exercise.ml_exercise_type);
        const reps = humanizeRepTarget(tableRange.target, tableRange.min, tableRange.max);
        const tempo = getTempo(sel.exercise.default_tempo, effectiveGoal, sel.exercise.ml_exercise_type);
        const cost = estimateExerciseMinutes(1, rest, role, 0, reps, tempo);
        if (cost > remainingMinutes) continue;
        const projected = remainingMinutes - cost;
        const effectiveSets = Math.round(estimateEffectiveSetWeight(sel.exercise, sel.muscleGroup) * 100) / 100;
        const scoringSel: ExerciseSelection = { ...sel, sets: 1, effectiveSets };
        const value = computeMarginalValue(
          { type: 'add_exercise', exercise: scoringSel },
          ordered,
          volumeStatuses,
          mgFreq,
          systemCouplingSignals,
          cost,
          sessionStimulusByGroup,
        );
        const slackCloseness = 1 / (1 + Math.abs(projected - targetUnfilledMinutes));
        // Bias toward existing exercises unless new movement has clearly better value.
        const score = value * 0.72 + slackCloseness * 0.18 - 0.12;
        if (!bestFill || score > bestFill.score) {
          bestFill = { type: 'add_micro_exercise', exercise: scoringSel, cost, projected, score };
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
      addSessionStimulus(ex.targetMuscleGroup, estimateGeneratedEffectiveSetWeight(ex));
      ex.adjustments.push(`Time-bank fill: ${oldSets} → ${ex.sets} sets (target slack ≤ ${targetUnfilledMinutes} min)`);
    } else {
      const sel = bestFill.exercise;
      const role: ExerciseRole = sel.exercise.ml_exercise_type === 'compound' ? 'secondary' : 'isolation';
      const tableRange = getRepRangeByRole(role, effectiveGoal, secondaryGoal, undefined, undefined, sel.exercise.ml_exercise_type);
      const pref = profile.exercisePreferences.find(p => p.exerciseName === sel.exercise.name.toLowerCase());
      const reps = humanizeRepTarget(
        pref?.learnedReps ? Math.round(pref.learnedReps) : tableRange.target,
        tableRange.min,
        tableRange.max
      );
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
          targetWeight = snapToPlate(prog.lastWeight * cfg.weightRescueFloorMult, equipment, fillExType);
        }
      } else if (pref?.learnedWeight != null) {
        targetWeight = snapToPlate(pref.learnedWeight, equipment, fillExType);
      }
      // Phase 0 — Rep×Load identity guard (fill path: silent clamp).
      // Same physical invariant as the main prescriber; ensures expansion /
      // time-bank fills cannot reintroduce unsafe pairings via learnedWeight.
      if (targetWeight != null && !isBodyweight && reps > 0) {
        const e1rmRef = deriveE1rmReference(prog ?? null, pref ?? null);
        const safe = clampToRepLoadCeiling(targetWeight, reps, rir, e1rmRef, equipment, fillExType, cfg);
        targetWeight = safe.weight;
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
        targetWeight: isBodyweight
          ? null
          : (targetWeight ? clampHotelModeWeight(snapToPlate(targetWeight, equipment, fillExType), equipment) : null),
        targetRir: rir,
        rirLabel: getRirLabel(rir),
        rirRange: null,
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
      addSessionStimulus(newEx.targetMuscleGroup, estimateGeneratedEffectiveSetWeight(newEx) * newEx.sets);
      addedNewCount++;
    }
  }

  // Hard challenge anchors after all expansion/fill passes.
  const currentCompoundCount = () => ordered.filter(isCompoundGenerated).length;
  const minCompoundsRequired = prefs.session_duration_minutes >= 75 ? 2 : 1;
  const familyCovered = (family: string) => ordered.some((ex) => stapleFamilyKey(ex.exerciseName) === family);
  const selectedGroupSet = new Set(
    (existingSelections ?? [])
      .map((s) => String(s?.muscleGroup || '').toLowerCase())
      .filter(Boolean)
  );
  const recoveryReadyThresholdPct = cfg.muscleReadyThreshold * 100;
  const isGroupRecoveredForAnchor = (group: string): boolean => {
    const key = String(group || '').toLowerCase();
    if (!key) return false;
    const rec = (profile.muscleRecovery ?? []).find((r) => String(r.muscleGroup || '').toLowerCase() === key);
    return rec ? rec.recoveryPercent >= recoveryReadyThresholdPct : true;
  };
  const isAnchorEligible = (sel: ExerciseSelection): boolean => {
    const groupKey = String(sel?.muscleGroup || '').toLowerCase();
    if (!groupKey) return false;
    // Keep challenge anchors coherent with today's planned split focus.
    if (selectedGroupSet.size > 0 && !selectedGroupSet.has(groupKey)) return false;
    return isGroupRecoveredForAnchor(groupKey);
  };
  const buildGeneratedFromSelection = (sel: ExerciseSelection, forceSets?: number): GeneratedExercise => {
    const role: ExerciseRole = sel.exercise.ml_exercise_type === 'compound' ? 'secondary' : 'isolation';
    const tableRange = getRepRangeByRole(role, effectiveGoal, secondaryGoal, undefined, undefined, sel.exercise.ml_exercise_type);
    const pref = profile.exercisePreferences.find(p => p.exerciseName === sel.exercise.name.toLowerCase());
    const reps = humanizeRepTarget(
      pref?.learnedReps ? Math.round(pref.learnedReps) : tableRange.target,
      tableRange.min,
      tableRange.max
    );
    const sets = forceSets ?? (pref?.learnedSets ? Math.min(Math.round(pref.learnedSets), 4) : (role === 'secondary' ? 3 : 2));
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
        targetWeight = snapToPlate(prog.lastWeight * cfg.weightRescueFloorMult, equipment, fillExType);
      }
    } else if (pref?.learnedWeight != null) {
      targetWeight = snapToPlate(pref.learnedWeight, equipment, fillExType);
    }
    // Phase 0 — Rep×Load identity guard (fill path: silent clamp).
    if (targetWeight != null && !isBodyweight && reps > 0) {
      const e1rmRef = deriveE1rmReference(prog ?? null, pref ?? null);
      const safe = clampToRepLoadCeiling(targetWeight, reps, rir, e1rmRef, equipment, fillExType, cfg);
      targetWeight = safe.weight;
    }
    const estMin = estimateExerciseMinutes(sets, rest, role, 0, reps, tempo);
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
      targetReps: reps,
      targetWeight: isBodyweight
        ? null
        : (targetWeight ? clampHotelModeWeight(snapToPlate(targetWeight, equipment, fillExType), equipment) : null),
      targetRir: rir,
      rirLabel: getRirLabel(rir),
      rirRange: null,
      isBodyweight,
      tempo,
      restSeconds: rest,
      rationale: 'Challenge anchor reinforcement',
      adjustments: ['Challenge floor: anchor exercise retained/added'],
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
  };
  if (currentCompoundCount() < minCompoundsRequired) {
    const compoundCandidates = strengthPool
      .filter((sel) => !usedNames.has(sel.exercise.name.toLowerCase()))
      .filter((sel) => isAnchorEligible(sel))
      .filter((sel) => (sel.exercise.ml_exercise_type ?? inferExerciseType(sel.exercise)) === 'compound');
    for (const sel of compoundCandidates) {
      if (currentCompoundCount() >= minCompoundsRequired) break;
      const newEx = buildGeneratedFromSelection(sel, 3);
      ordered.unshift(newEx);
      usedNames.add(sel.exercise.name.toLowerCase());
      remainingMinutes -= newEx.estimatedMinutes;
      addSessionStimulus(newEx.targetMuscleGroup, estimateGeneratedEffectiveSetWeight(newEx) * newEx.sets);
    }
  }
  for (const family of requiredStapleFamilies) {
    if (familyCovered(family)) continue;
    const sel = strengthPool.find((s) =>
      !usedNames.has(s.exercise.name.toLowerCase())
      && stapleFamilyKey(s.exercise.name) === family
      && isAnchorEligible(s)
    );
    if (!sel) continue;
    const newEx = buildGeneratedFromSelection(sel, 2);
    ordered.push(newEx);
    usedNames.add(sel.exercise.name.toLowerCase());
    remainingMinutes -= newEx.estimatedMinutes;
    addSessionStimulus(newEx.targetMuscleGroup, estimateGeneratedEffectiveSetWeight(newEx) * newEx.sets);
  }

  // Final duration stabilization to prevent large regeneration swings.
  const totalMinutes = () =>
    ordered.reduce((s, e) => s + e.estimatedMinutes, 0) + keptCardio.reduce((s, e) => s + e.estimatedMinutes, 0);
  const lowerBound = Math.round(effectiveBudget * 0.9);
  const upperBound = Math.round(effectiveBudget * 1.05);
  let totalNow = totalMinutes();

  if (totalNow > upperBound) {
    const reducers = [...ordered]
      .filter(ex => ex.exerciseRole !== 'primary' && ex.sets > 2)
      .sort((a, b) => (a.impactScore ?? 0) - (b.impactScore ?? 0));
    for (const ex of reducers) {
      if (totalNow <= upperBound) break;
      const oldSets = ex.sets;
      ex.sets = Math.max(2, ex.sets - 1);
      recalcTime(ex);
      if (ex.sets !== oldSets) ex.adjustments.push(`Duration stabilization: ${oldSets} -> ${ex.sets} sets`);
      totalNow = totalMinutes();
    }
    for (const ex of keptCardio) {
      if (totalNow <= upperBound) break;
      const oldSec = ex.cardioDurationSeconds ?? 0;
      const nextSec = Math.max(8 * 60, Math.round(oldSec * 0.9));
      if (nextSec < oldSec) {
        ex.cardioDurationSeconds = nextSec;
        recalcTime(ex);
        ex.adjustments.push(`Duration stabilization: ${Math.round(oldSec / 60)} -> ${Math.round(nextSec / 60)} min`);
        totalNow = totalMinutes();
      }
    }
  }

  if (totalNow < lowerBound) {
    const boosters = [...ordered]
      .filter(ex => ex.exerciseRole !== 'primary' && ex.sets < Math.max(getMaxSets(ex), 5))
      .sort((a, b) => (b.impactScore ?? 0) - (a.impactScore ?? 0));
    for (const ex of boosters) {
      if (totalNow >= lowerBound) break;
      const oldSets = ex.sets;
      ex.sets += 1;
      recalcTime(ex);
      ex.adjustments.push(`Duration stabilization: ${oldSets} -> ${ex.sets} sets`);
      totalNow = totalMinutes();
    }
    for (const ex of keptCardio) {
      if (totalNow >= lowerBound) break;
      const oldSec = ex.cardioDurationSeconds ?? 0;
      const nextSec = Math.round(oldSec * 1.1);
      ex.cardioDurationSeconds = nextSec;
      recalcTime(ex);
      ex.adjustments.push(`Duration stabilization: ${Math.round(oldSec / 60)} -> ${Math.round(nextSec / 60)} min`);
      totalNow = totalMinutes();
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
  planningDate?: Date,
  fatLossController?: FatLossControllerAdjustment,
  highCapacityPush?: HighCapacityPushAdjustment,
  policyFusion?: PolicyFusionAdjustment,
  runtimeFlags?: Record<string, boolean>
): GeneratedWorkout {
  const muscleGroupsFocused = muscleGroups.map(g => g.muscleGroup);
  const muscleReasons = muscleGroups.map(g => `${g.muscleGroup}: ${g.reason}`);

  const totalDuration = exercises.reduce(
    (sum, ex) => sum + ex.estimatedMinutes, 5
  );
  const finalDuration = Math.min(
    Math.max(20, Math.round(prefs.session_duration_minutes)),
    Math.max(0, Math.floor(totalDuration))
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

  const fatLossDoseExplanation =
    fatLossController?.active && fatLossController.userFacingLine
      ? fatLossController.userFacingLine
      : undefined;

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
    fatLossDoseExplanation ? `Fat-loss dose: ${fatLossDoseExplanation}` : null,
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
  if (fatLossController?.active) {
    decisionLog.push({
      step: '1b',
      label: 'Fat-Loss PID Controller',
      details: [
        fatLossController.reason,
        `PID terms: e=${fatLossController.pid.error.toFixed(3)}, i=${fatLossController.pid.integral.toFixed(3)}, d=${fatLossController.pid.derivative.toFixed(3)}`,
        `Control: ${fatLossController.pid.controlSignal.toFixed(3)} | cardio ×${fatLossController.cardioDurationMultiplier.toFixed(2)}, intensity ×${fatLossController.cardioIntensityMultiplier.toFixed(2)}`,
      ],
    });
  }
  if (highCapacityPush?.active || highCapacityPush?.reason) {
    decisionLog.push({
      step: '1c',
      label: 'Capacity Push Policy',
      details: [
        highCapacityPush.reason || 'Capacity push inactive',
        `Volume ×${highCapacityPush.volumeMultiplier.toFixed(2)}, progression ×${highCapacityPush.progressionMultiplier.toFixed(2)}, rest ×${highCapacityPush.restSecondsMultiplier.toFixed(2)}`,
      ],
    });
  }
  if (policyFusion?.active) {
    decisionLog.push({
      step: '1d',
      label: 'Policy Fusion',
      details: [
        policyFusion.reason,
        `Fusion multipliers: readiness ×${policyFusion.readinessMultiplier.toFixed(2)}, nutrition ×${policyFusion.nutritionMultiplier.toFixed(2)}, strength ×${policyFusion.strengthMultiplier.toFixed(2)}`,
        `Progression ×${policyFusion.progressionMultiplier.toFixed(2)} (confidence ${(policyFusion.confidence * 100).toFixed(0)}%)`,
      ],
    });
  }

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
    `Estimated duration: ${Math.round(finalDuration)} min`,
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
    const rejected = profile.exerciseSwapHistory.filter(
      s => (Number(s.effectiveSwapWeight ?? 0) >= 3.2) || s.swapCount >= 3
    );
    if (rejected.length > 0) {
      mlDetails.push(`Swap learning: ${rejected.map(r => `${r.exerciseName} (w${(r.effectiveSwapWeight ?? r.swapCount).toFixed(1)})`).join(', ')} down-weighted`);
    }
  }
  if (profile.substitutionAffinities && profile.substitutionAffinities.length > 0) {
    const top = profile.substitutionAffinities.slice(0, 4)
      .map(a => `${a.fromExercise}→${a.toExercise}`)
      .join('; ');
    mlDetails.push(`Substitution affinities: ${top}`);
  }
  if (profile.prescribedVsActual && profile.prescribedVsActual.complianceRate < 1) {
    mlDetails.push(`Compliance: ${Math.round(profile.prescribedVsActual.complianceRate * 100)}% exercises completed`);
  }
  const mgExecution = profile.prescribedVsActual?.muscleGroupExecutionDeltas ?? {};
  const mgExecutionRows = Object.entries(mgExecution)
    .filter(([, v]) => Number(v?.sampleSize ?? 0) >= 2)
    .map(([group, v]) => {
      const completion = clampNumber(Number(v?.completionRate ?? 0), 0, 1);
      const weightDev = Number(v?.avgWeightDeviation ?? 0);
      const repsDev = Number(v?.avgRepsDeviation ?? 0);
      const score = (weightDev * 0.9) + (repsDev / 14);
      return { group, completion, weightDev, repsDev, score, sample: Number(v?.sampleSize ?? 0) };
    });
  if (mgExecutionRows.length > 0) {
    const topPositive = [...mgExecutionRows]
      .filter(r => r.score > 0.05 && r.completion >= 0.7)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);
    const topNegative = [...mgExecutionRows]
      .filter(r => r.score < -0.05 || r.completion < 0.58)
      .sort((a, b) => a.score - b.score)
      .slice(0, 2);
    if (topPositive.length > 0) {
      mlDetails.push(`Execution coupling ↑: ${topPositive.map(r => `${r.group} (${Math.round(r.completion * 100)}% complete, Δw ${(r.weightDev * 100).toFixed(0)}%, Δr ${r.repsDev.toFixed(1)})`).join('; ')}`);
    }
    if (topNegative.length > 0) {
      mlDetails.push(`Execution coupling ↓: ${topNegative.map(r => `${r.group} (${Math.round(r.completion * 100)}% complete, Δw ${(r.weightDev * 100).toFixed(0)}%, Δr ${r.repsDev.toFixed(1)})`).join('; ')}`);
    }
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
    estimatedDurationMinutes: finalDuration,
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
    policyState: {
      policyVersion: 'policy_v4_adaptive_learning',
      pid: fatLossController?.pid ?? { error: 0, integral: 0, derivative: 0, controlSignal: 0 },
      fusion: {
        nutritionMultiplier: policyFusion?.nutritionMultiplier ?? 1,
        readinessMultiplier: policyFusion?.readinessMultiplier ?? 1,
        strengthMultiplier: policyFusion?.strengthMultiplier ?? 1,
        progressionMultiplier: policyFusion?.progressionMultiplier ?? 1,
        confidence: policyFusion?.confidence ?? 0.5,
      },
      guardrails: recoveryAdj.adjustmentReasons.filter(r => r.toLowerCase().includes('guardrail')),
    },
    runtimeFlags,
    fatLossDoseExplanation,
  };
}

// ─── Main Entry Point ───────────────────────────────────────────────────────

/**
 * Day-level theme. The day's primary muscle focus and the accessories it is
 * allowed to also touch. Set authoritatively by the weekly planner from
 * `weekly_split_schedule` and consumed by both the per-day generator (as a
 * hard selection filter) and the post-generation invariants (as a coherence
 * check).
 *
 * Why this exists
 *   Without a persisted theme, "Monday is chest day" was a soft suggestion
 *   that got eroded by overlap-avoidance, synergist expansion, and time-bank
 *   fills — producing the "chest + legs + back" days the user complained
 *   about. With `dayTheme`, the engine commits to a primary focus per day
 *   and treats anything outside the allowed set as a violation, not a choice.
 */
export interface DayTheme {
  /** Primary muscle group for the day, e.g. "mid_chest", "back_lats", "quadriceps". */
  primary: string;
  /** Muscle groups allowed alongside the primary (synergists + abs + core + cardio). */
  allowedAccessories: string[];
  /**
   * Origin of this theme. Determines how strict the engine should be:
   *   - "schedule" — user-defined `weekly_split_schedule` (hard filter + invariant drop)
   *   - "rotation" — `preferred_split` slot rotation (same strictness as schedule)
   *   - "default"  — day-of-week pattern fallback (soft; invariant warnings only)
   */
  source: 'schedule' | 'rotation' | 'default';
}

export interface SessionOverrides {
  durationMinutes?: number;
  finishByTime?: string; // "HH:MM"
  goalOverride?: UserPreferences['training_goal'];
  gymProfile?: string;
  planningDate?: string; // YYYY-MM-DD for weekly planning
  avoidExerciseNames?: string[];
  anchorMuscleGroups?: string[];
  preferredExerciseNames?: string[];
  regenerationSeed?: number;
  /** Phase 1: when set, becomes the hard selection filter for muscle groups. */
  dayTheme?: DayTheme | null;
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
  const finiteBudget = Number.isFinite(sessionBudgetMin) ? Math.max(20, Math.round(sessionBudgetMin)) : 60;

  // Pareto guardrail: cap total exercises so plans stay focused and executable.
  const maxExerciseCount = (() => {
    if (finiteBudget <= 35) return 4;
    if (finiteBudget <= 50) return 5;
    if (finiteBudget <= 65) return 7;
    if (finiteBudget <= 80) return 8;
    if (finiteBudget <= 95) return 9;
    if (finiteBudget <= 110) return 10;
    if (finiteBudget <= 125) return 11;
    return 12;
  })();
  if (exercises.length > maxExerciseCount) {
    const ranked = exercises
      .map((ex, idx) => {
        const roleBase =
          ex.exerciseRole === 'primary' ? 100 :
            ex.exerciseRole === 'secondary' ? 70 :
              ex.exerciseRole === 'isolation' ? 45 :
                ex.exerciseRole === 'corrective' ? 35 :
                  25;
        const cardioPenalty = ex.isCardio ? -20 : 0;
        const score = roleBase + (ex.impactScore ?? 0) + cardioPenalty;
        return { idx, ex, score };
      })
      .sort((a, b) => b.score - a.score);
    const keepIdx = new Set(ranked.slice(0, maxExerciseCount).map(r => r.idx));
    const removed = exercises.filter((_, idx) => !keepIdx.has(idx));
    if (removed.length > 0) {
      exercises.splice(0, exercises.length, ...exercises.filter((_, idx) => keepIdx.has(idx)));
      const removedNames = removed.map(ex => ex.exerciseName).slice(0, 6).join(', ');
      corrections.push(`Exercise count cap applied: removed ${removed.length} (${removedNames})`);
    }
  }

  // Check B4.2: per-exercise set cap (weeklyTarget / frequency)
  for (const ex of exercises) {
    if (ex.isCardio) continue;
    const group = (ex.targetMuscleGroup ?? '').toLowerCase();
    const freqMap = profile.muscleGroupFrequency ?? {};
    const freq = (freqMap as Record<string, number>)[group] ?? 2;
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
    const mpLower = (strengthExs[i].movementPattern || '').toLowerCase();
    const isCompound = COMPOUND_MOVEMENT_PATTERNS.has(mpLower) || cnsTier <= 2;
    if (isCompound) lastCompoundIdx = i;
    if (!isCompound && i < firstIsolationIdx) firstIsolationIdx = i;
  }
  if (lastCompoundIdx > firstIsolationIdx) {
    hasOrderViolation = true;
    const compounds = strengthExs.filter(e => {
      const t = getCnsDemandTier(e);
      const m = (e.movementPattern || '').toLowerCase();
      return COMPOUND_MOVEMENT_PATTERNS.has(m) || t <= 2;
    });
    const isolations = strengthExs.filter(e => {
      const t = getCnsDemandTier(e);
      const m = (e.movementPattern || '').toLowerCase();
      return !COMPOUND_MOVEMENT_PATTERNS.has(m) && t > 2;
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

  // Hard budget guardrail: never ship a session materially above the selected budget.
  // This makes time constraints strict and predictable for users.
  const hardMaxMin = Math.max(20, finiteBudget);
  if (totalMin > hardMaxMin) {
    const recalcAll = () => {
      exercises.forEach(recalc);
      totalMin = exercises.reduce((s, e) => s + e.estimatedMinutes, 0);
    };

    // Phase 2: cardio policy is phase-dependent.
    //   - cutting  → cardio is required every training day; trim accessories
    //     before touching cardio. Only fall back to cardio trims if strength
    //     trims alone cannot make budget.
    //   - bulking / maintaining → keep prior behaviour: cardio is conditioning
    //     overhead and may be trimmed first to preserve strength quality.
    const isCut = profile.bodyWeightTrend.phase === 'cutting';

    const trimCardio = () => {
      const cardioEx = exercises.filter(e => e.isCardio).sort((a, b) => (b.estimatedMinutes - a.estimatedMinutes));
      for (const ex of cardioEx) {
        if (totalMin <= hardMaxMin) break;
        const old = ex.cardioDurationSeconds ?? 0;
        // Floor: never trim cardio shorter than 8 min on bulk/maintain, 12 min on a cut.
        const minFloorSec = isCut ? 12 * 60 : 8 * 60;
        const cutBySec = Math.min(old - minFloorSec, Math.max(0, Math.round((totalMin - hardMaxMin) * 60)));
        if (cutBySec > 0) {
          ex.cardioDurationSeconds = Math.max(minFloorSec, old - cutBySec);
          ex.adjustments.push(`Hard budget trim: cardio ${Math.round(old / 60)} → ${Math.round((ex.cardioDurationSeconds ?? old) / 60)} min`);
          recalcAll();
        }
      }
    };

    const trimAccessories = () => {
      const nonPrimary = exercises
        .filter(e => !e.isCardio && e.exerciseRole !== 'primary')
        .sort((a, b) => (a.impactScore ?? 0) - (b.impactScore ?? 0));
      for (const ex of nonPrimary) {
        if (totalMin <= hardMaxMin) break;
        while (ex.sets > 2 && totalMin > hardMaxMin) {
          const oldSets = ex.sets;
          ex.sets -= 1;
          recalcAll();
          ex.adjustments.push(`Hard budget trim: ${oldSets} → ${ex.sets} sets`);
        }
      }
    };

    if (isCut) {
      // Cut: protect cardio. Trim accessories first; only trim cardio if accessories alone insufficient.
      trimAccessories();
      if (totalMin > hardMaxMin) trimCardio();
    } else {
      // Bulk / maintain: keep prior order — cardio first, accessories second.
      trimCardio();
      trimAccessories();
    }

    // 3) Last resort regardless of phase: trim primary sets down to 2 if still over budget.
    const primaries = exercises.filter(e => !e.isCardio && e.exerciseRole === 'primary');
    for (const ex of primaries) {
      if (totalMin <= hardMaxMin) break;
      while (ex.sets > 2 && totalMin > hardMaxMin) {
        const oldSets = ex.sets;
        ex.sets -= 1;
        recalcAll();
        ex.adjustments.push(`Hard budget trim (primary): ${oldSets} → ${ex.sets} sets`);
      }
    }
  }

  return exercises;
}

export interface PreFetchedEngineData {
  preferences?: UserPreferences;
  exerciseLibrary?: EnrichedExercise[];
  bodyAssessment?: BodyAssessment | null;
}

export async function generateWorkout(
  profile: TrainingProfile,
  overrides?: SessionOverrides,
  prefetched?: PreFetchedEngineData,
): Promise<GeneratedWorkout> {
  const perfStart = nowMs();
  const stageMarks: Record<string, number> = {};
  const stageStart = (name: string) => ({ name, at: nowMs() });
  const stageEnd = (token: { name: string; at: number }) => {
    stageMarks[token.name] = Math.round((nowMs() - token.at) * 100) / 100;
  };
  const planningDate = overrides?.planningDate ? new Date(`${overrides.planningDate}T12:00:00`) : new Date();
  const planningDow = planningDate.getDay();

  const tFetch = stageStart('fetch_inputs');
  const [prefs, allExercises] = prefetched?.preferences && prefetched?.exerciseLibrary
    ? [prefetched.preferences, prefetched.exerciseLibrary] as const
    : await Promise.all([
        fetchUserPreferences(profile.userId),
        fetchAllExercises(),
      ]);
  stageEnd(tFetch);

  // Activate body assessment for physique-aware programming
  if (prefetched?.bodyAssessment) {
    setActiveBodyAssessment(prefetched.bodyAssessment);
  }

  if (overrides?.goalOverride) {
    prefs.training_goal = overrides.goalOverride;
  }
  if (overrides?.durationMinutes) {
    prefs.session_duration_minutes = overrides.durationMinutes;
  }
  if (overrides?.finishByTime) {
    const dayKey = String(planningDow);
    prefs.weekday_deadlines = { ...prefs.weekday_deadlines, [dayKey]: overrides.finishByTime };
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
  const runtimeFlags = {
    pid_controller: runtimeFlagEnabled('pid_controller', true),
    policy_learning: runtimeFlagEnabled('policy_learning', true),
    replay_promotions: runtimeFlagEnabled('replay_promotions', true),
    nutrition_feedback: runtimeFlagEnabled('nutrition_feedback', true),
    llm_extended_validation: runtimeFlagEnabled('llm_extended_validation', true),
  };

  // #7: Experience-level scaling — adjust volume and progression
  const expLevel = getExperienceOrDefault(prefs.experience_level);
  const isElite = expLevel === 'elite' || expLevel === 'expert' || expLevel === 'professional';
  const expVolumeScale = expLevel === 'beginner' ? cfg.beginnerVolumeMultiplier
    : isElite ? cfg.eliteVolumeMultiplier
    : expLevel === 'advanced' ? cfg.advancedVolumeMultiplier
    : cfg.intermediateVolumeMultiplier;
  const expProgressionScale = expLevel === 'beginner' ? cfg.beginnerProgressionRate
    : isElite ? cfg.eliteProgressionRate
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

  // Return-from-break detection: auto-deload after extended time off.
  // Guard: new users with no preference history should not be penalized.
  let breakRampMultiplier = 1.0;
  if (profile.exercisePreferences.length > 0) {
    const daysSinceLastWorkout = Math.min(...profile.exercisePreferences.map(p => p.lastUsedDaysAgo));
    if (daysSinceLastWorkout >= 7) {
      breakRampMultiplier = Math.max(0.45, 1.0 - (daysSinceLastWorkout - 5) * 0.028);
    }
  }

  // Step 1: Recovery check
  const tRecovery = stageStart('recovery_check');
  const recoveryAdj = stepRecoveryCheck(profile, cfg);
  stageEnd(tRecovery);

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
    recoveryAdj.adjustmentReasons.push(`Return from break: volume ×${breakRampMultiplier.toFixed(2)} (ramp-back protocol)`);
  }

  // Psychological readiness volume modulation
  const psychScore = profile.psychReadiness?.score ?? 50;
  if (psychScore < 35) {
    const psychMult = 0.85;
    recoveryAdj.volumeMultiplier *= psychMult;
    recoveryAdj.adjustmentReasons.push(`Psych readiness low (${psychScore}%): volume ×${psychMult} — consistency > intensity today`);
  } else if (psychScore >= 80) {
    const psychMult = 1.05;
    recoveryAdj.volumeMultiplier *= psychMult;
    recoveryAdj.adjustmentReasons.push(`Psych readiness high (${psychScore}%): volume ×${psychMult} — push harder today`);
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

  // Weight goal timeline modulation: when the user has a goal weight + date,
  // compute how aggressive the rate needs to be and adjust programming accordingly.
  const goalPhase = getEffectiveGoal(prefs);
  if (goalPhase === 'maintain' && !prefs.primary_goal && !prefs.secondary_goal) {
    recoveryAdj.adjustmentReasons.push('No goal set — defaulting to maintain');
  }
  let goalTimelineVolumeScale = 1.0;
  let goalTimelineCardioMult = 1.0;
  let goalTimelineRirShift = 0;
  // Prefer the most recent measured weight from bodyWeightTrend over the static prefs value
  const currentBw = profile.bodyWeightTrend.currentWeight ?? prefs.body_weight_lbs;
  if (prefs.weight_goal_lbs != null && prefs.weight_goal_date && currentBw) {
    const goalDate = new Date(`${prefs.weight_goal_date}T12:00:00`);
    const msRemaining = goalDate.getTime() - Date.now();
    const weeksRemaining = Math.max(0.5, msRemaining / (7 * 24 * 60 * 60 * 1000));
    const lbsToGoal = prefs.weight_goal_lbs - currentBw;
    const weeklyRate = lbsToGoal / weeksRemaining;

    if (goalPhase === 'cut' && lbsToGoal < 0) {
      const absRate = Math.abs(weeklyRate);
      const bwPctRate = absRate / currentBw;
      if (bwPctRate > 0.008) {
        // Aggressive cut: reduce volume to protect strength, increase cardio
        goalTimelineVolumeScale = Math.max(0.85, 1.0 - (bwPctRate - 0.005) * 8);
        goalTimelineCardioMult = Math.min(1.3, 1.0 + (bwPctRate - 0.005) * 20);
        goalTimelineRirShift = 1; // extra buffer to prevent injury during deficit
        recoveryAdj.adjustmentReasons.push(
          `Goal timeline: ${Math.abs(lbsToGoal).toFixed(0)} lbs to lose in ${weeksRemaining.toFixed(0)} wks (${absRate.toFixed(1)} lbs/wk) — volume ×${goalTimelineVolumeScale.toFixed(2)}, cardio ×${goalTimelineCardioMult.toFixed(2)}, RIR +${goalTimelineRirShift}`
        );
      } else if (bwPctRate >= 0.003) {
        goalTimelineCardioMult = 1.1;
        recoveryAdj.adjustmentReasons.push(
          `Goal timeline: moderate cut pace (${absRate.toFixed(1)} lbs/wk) — cardio ×${goalTimelineCardioMult}`
        );
      }
    } else if (goalPhase === 'bulk' && lbsToGoal > 0) {
      if (weeksRemaining > 4) {
        goalTimelineVolumeScale = Math.min(1.12, 1.0 + weeklyRate * 0.15);
        recoveryAdj.adjustmentReasons.push(
          `Goal timeline: ${lbsToGoal.toFixed(0)} lbs to gain in ${weeksRemaining.toFixed(0)} wks — volume ×${goalTimelineVolumeScale.toFixed(2)}`
        );
      }
    }
  }
  recoveryAdj.volumeMultiplier *= goalTimelineVolumeScale;

  // Sport-specific season adjustments
  const sportProfile = getSportProfile(prefs.sport_focus);
  if (sportProfile && prefs.sport_season) {
    const season = sportProfile.seasonModifiers[prefs.sport_season];
    if (season) {
      recoveryAdj.volumeMultiplier *= season.volumeMultiplier;
      recoveryAdj.adjustmentReasons.push(`${sportProfile.label} (${prefs.sport_season.replace('_', '-')}): volume ×${season.volumeMultiplier}, ${season.description}`);
    }
  }

  // Closed-loop fat-loss controller: compare goal progress vs actual trend and
  // modulate cardio/training dose when weight loss is off target.
  const fatLossController = computeFatLossController(profile, prefs);
  const neutralFatLossController: FatLossControllerAdjustment = {
    active: false,
    mode: 'none',
    tier: 'none',
    cardioDurationMultiplier: 1,
    cardioIntensityMultiplier: 1,
    strengthVolumeMultiplier: 1,
    restSecondsMultiplier: 1,
    pid: { error: 0, integral: 0, derivative: 0, controlSignal: 0 },
    reason: 'Fat-loss PID disabled by runtime flag.',
    weightTrendConfidence: 0,
    nutritionDampeningFactor: 1,
    userFacingLine: '',
  };
  const effectiveFatLossController = runtimeFlags.pid_controller ? fatLossController : neutralFatLossController;
  // Apply goal timeline cardio multiplier on top of PID controller
  if (goalTimelineCardioMult !== 1.0) {
    effectiveFatLossController.cardioDurationMultiplier *= goalTimelineCardioMult;
  }
  if (effectiveFatLossController.active) {
    recoveryAdj.volumeMultiplier *= effectiveFatLossController.strengthVolumeMultiplier;
    recoveryAdj.volumeMultiplier = Math.max(cfg.volumeMultiplierFloor, recoveryAdj.volumeMultiplier);
    recoveryAdj.adjustmentReasons.push(effectiveFatLossController.reason);
  }

  const highCapacityPush = computeHighCapacityPush(profile, prefs, cfg);
  if (highCapacityPush.active) {
    recoveryAdj.volumeMultiplier *= highCapacityPush.volumeMultiplier;
    recoveryAdj.volumeMultiplier = Math.max(cfg.volumeMultiplierFloor, recoveryAdj.volumeMultiplier);
    recoveryAdj.adjustmentReasons.push(highCapacityPush.reason);
  } else if (highCapacityPush.reason) {
    recoveryAdj.adjustmentReasons.push(highCapacityPush.reason);
  }

  const policyFusion = computePolicyFusion(profile, effectiveFatLossController);
  if (runtimeFlags.nutrition_feedback && policyFusion.active) {
    const fusedVolume = policyFusion.readinessMultiplier * policyFusion.nutritionMultiplier * policyFusion.strengthMultiplier;
    recoveryAdj.volumeMultiplier *= clampNumber(fusedVolume, 0.9, 1.12);
    recoveryAdj.volumeMultiplier = Math.max(cfg.volumeMultiplierFloor, recoveryAdj.volumeMultiplier);
    recoveryAdj.adjustmentReasons.push(policyFusion.reason);
  }

  const progressionScale = expProgressionScale
    * ageProgressionScale
    * (highCapacityPush.active ? highCapacityPush.progressionMultiplier : 1.0)
    * (runtimeFlags.nutrition_feedback ? policyFusion.progressionMultiplier : 1.0);

  const effectiveDayTheme = resolveEffectiveDayTheme(prefs, planningDow, overrides?.dayTheme);

  // Step 2: Select muscle groups
  const tGroups = stageStart('select_muscle_groups');
  const { selected: muscleGroups, skipped: skippedGroups } = stepSelectMuscleGroups(
    profile,
    prefs,
    recoveryAdj,
    cfg,
    caloricPhaseScale,
    planningDow,
    overrides?.anchorMuscleGroups,
    effectiveDayTheme,
  );
  stageEnd(tGroups);

  // Parse LLM pattern observations into actionable hints
  const llmHints = parseLlmPatternObservations(profile.llmPatternObservations);
  if (llmHints.avoidExercises.length > 0) {
    const existing = new Set(prefs.exercises_to_avoid.map(e => e.toLowerCase()));
    for (const name of llmHints.avoidExercises) {
      if (!existing.has(name.toLowerCase())) prefs.exercises_to_avoid.push(name);
    }
  }

  const preferredExerciseNames = new Set<string>();
  // User's DB-stored preferred exercises (from Profile)
  if (Array.isArray(prefs.preferred_exercises)) {
    for (const n of prefs.preferred_exercises) {
      const key = String(n || '').trim().toLowerCase();
      if (key) preferredExerciseNames.add(key);
    }
  }
  for (const n of overrides?.preferredExerciseNames ?? []) {
    const key = String(n || '').trim().toLowerCase();
    if (key) preferredExerciseNames.add(key);
  }
  for (const n of llmHints.preferExercises ?? []) {
    const key = String(n || '').trim().toLowerCase();
    if (key) preferredExerciseNames.add(key);
  }

  // Step 3: Select exercises
  const tSelect = stageStart('select_exercises');
  const { selections: exerciseSelections, decisions: exerciseDecisions } = stepSelectExercises(
    muscleGroups,
    allExercises,
    profile,
    prefs,
    cfg,
    preferredExerciseNames,
    overrides?.regenerationSeed ?? 0
  );
  stageEnd(tSelect);

  // Sport prehab injection — add 1 prehab exercise per session when sport focus is set
  if (sportProfile && prefs.sport_season) {
    const season = sportProfile.seasonModifiers[prefs.sport_season];
    const planKey = planningDate ? getLocalDate(planningDate) : getLocalDate();
    const sportKey = prefs.sport_focus ?? sportProfile.label;
    const injectRoll = deterministicProbability(`${profile.userId}:${planKey}:${sportKey}:${prefs.sport_season}:prehab`);
    if (season && injectRoll < season.prehabFrequency && sportProfile.prehabExercises.length > 0) {
      const usedNames = new Set(exerciseSelections.map(s => s.exercise.name.toLowerCase()));
      const available = sportProfile.prehabExercises.filter(p => !usedNames.has(p.exerciseName));
      if (available.length > 0) {
        const pickIdx = deterministicHash(`${profile.userId}:${planKey}:${sportKey}:prehab_pick`) % available.length;
        const pick = available[pickIdx];
        const prehabEx = allExercises.find(e => e.name.toLowerCase() === pick.exerciseName);
        if (prehabEx) {
          exerciseSelections.push({
            exercise: prehabEx,
            muscleGroup: 'core',
            sets: pick.sets,
            effectiveSets: pick.sets,
            reason: `${sportProfile.label} prehab: ${pick.reason}`,
            isCardio: false,
          });
        }
      }
    }
  }

  // Compute mesocycle phase modifiers
  const mesocycleWeek = prefs.mesocycle_week ?? 1;
  const PHASE_ORDER = ['accumulation', 'loading', 'overreach', 'deload'];
  const phaseIndex = Math.max(0, Math.min(mesocycleWeek - 1, PHASE_ORDER.length - 1));
  const currentMesocyclePhase = recoveryAdj.isDeload ? 'deload' : PHASE_ORDER[phaseIndex];
  const mesocycleConfig = cfg.mesocyclePhases[currentMesocyclePhase] ?? { volumeMult: 1.0, rirOffset: 0 };

  // Compute day occurrence index for rep cycling
  const anchorGroups = overrides?.anchorMuscleGroups ?? [];
  let dayOccurrenceIndex: number | undefined;
  if (anchorGroups.length > 0 && profile.muscleGroupFrequency) {
    const freq = profile.muscleGroupFrequency;
    const avgFreq = anchorGroups.reduce((sum, g) => sum + ((freq as Record<string, number>)[g] ?? 0), 0) / anchorGroups.length;
    dayOccurrenceIndex = avgFreq >= 1.5 ? 1 : 0;
  }

  // Step 4: Prescribe sets/reps/weight/tempo
  const tPrescribe = stageStart('prescribe');
  const prescribed = stepPrescribe(
    exerciseSelections,
    profile,
    prefs,
    recoveryAdj,
    cfg,
    progressionScale,
    breakRampMultiplier,
    planningDate,
    effectiveFatLossController,
    highCapacityPush,
    dayOccurrenceIndex,
    mesocycleConfig.volumeMult,
    (mesocycleConfig.rirOffset ?? 0) + goalTimelineRirShift,
  );
  stageEnd(tPrescribe);

  // Step 5: Apply session constraints (pass exercise pool + selections for expansion)
  const tConstraints = stageStart('apply_constraints');
  const constrained = stepApplyConstraints(
    prescribed,
    prefs,
    profile,
    cfg,
    allExercises,
    exerciseSelections,
    recoveryAdj,
    progressionScale,
    breakRampMultiplier,
    planningDate
  );
  stageEnd(tConstraints);

  // Step 5b: Post-generation validation — catch absurd prescriptions
  const tValidate = stageStart('validate_adapt');
  const validated = validateAndCorrect(constrained, profile, prefs.session_duration_minutes);
  const adaptiveContext = buildAdaptivePolicyContext(profile, {
    training_goal: (prefs.training_goal as GoalKind) ?? 'maintain',
    experience_level: prefs.experience_level ?? null,
    age: prefs.age ?? null,
  });
  const adaptedRaw = runtimeFlags.policy_learning
    ? optimizePrescription(validated as unknown as AdaptiveExercise[], adaptiveContext) as unknown as GeneratedExercise[]
    : validated;
  const recalcEstimatedMinutes = (exercises: GeneratedExercise[]): GeneratedExercise[] => exercises.map((ex) => {
    if (ex.isCardio) {
      return {
        ...ex,
        estimatedMinutes: ((ex.cardioDurationSeconds ?? 1800) / 60) + (TRANSITION_TIME_SEC.cardio / 60),
      };
    }
    return {
      ...ex,
      estimatedMinutes: estimateExerciseMinutes(
        ex.sets,
        ex.restSeconds,
        ex.exerciseRole,
        ex.warmupSets?.length ?? 0,
        ex.targetReps,
        ex.tempo
      ),
    };
  });
  const adaptedRecomputed = recalcEstimatedMinutes(adaptedRaw);
  const adaptedValidated = validateAndCorrect(adaptedRecomputed, profile, prefs.session_duration_minutes);
  const adapted = recalcEstimatedMinutes(adaptedValidated);
  stageEnd(tValidate);

  // Step 6: Generate rationale + decision log
  const tFinalize = stageStart('rationale_finalize');
  const workout = stepGenerateRationale(
    adapted,
    muscleGroups,
    recoveryAdj,
    profile,
    prefs,
    skippedGroups,
    exerciseDecisions,
    planningDate,
    effectiveFatLossController,
    highCapacityPush,
    policyFusion,
    runtimeFlags
  );
  workout.sessionRationale = `${workout.sessionRationale} ${toCoachNarrative(adapted as unknown as AdaptiveExercise[], adaptiveContext)}`.trim();
  workout.adjustmentsSummary = [
    ...workout.adjustmentsSummary,
    adaptiveContext.rationale,
    adaptiveContext.promoteReady
      ? 'Adaptive policy gate: promoted aggressive progression profile.'
      : 'Adaptive policy gate: held conservative profile until evidence improves.',
  ];

  const decisionProvenance = [
    {
      sourceType: 'observed' as const,
      stage: 'recovery',
      key: 'readiness',
      value: { readiness: profile.fitnessFatigueModel?.readiness ?? null },
      confidence: 0.95,
    },
    {
      sourceType: 'inferred' as const,
      stage: 'fat_loss_controller',
      key: 'pid_state',
      value: {
        active: effectiveFatLossController.active,
        tier: effectiveFatLossController.tier,
        pid: effectiveFatLossController.pid,
        weightTrendConfidence: effectiveFatLossController.weightTrendConfidence,
        nutritionDampeningFactor: effectiveFatLossController.nutritionDampeningFactor,
      },
      confidence: 0.82,
    },
    {
      sourceType: 'policy' as const,
      stage: 'policy_fusion',
      key: 'fusion',
      value: {
        readinessMultiplier: policyFusion.readinessMultiplier,
        nutritionMultiplier: policyFusion.nutritionMultiplier,
        strengthMultiplier: policyFusion.strengthMultiplier,
        progressionMultiplier: policyFusion.progressionMultiplier,
      },
      confidence: policyFusion.confidence,
    },
    {
      sourceType: 'learned' as const,
      stage: 'exercise_learning',
      key: 'preference_signal_count',
      value: { count: profile.exercisePreferences?.length ?? 0 },
      confidence: 0.7,
    },
    {
      sourceType: 'policy' as const,
      stage: 'adaptive_policy',
      key: 'adaptive_gate',
      value: {
        policyConfidence: adaptiveContext.policyConfidence,
        promoteReady: adaptiveContext.promoteReady,
        priorsVersion: adaptiveContext.scientificPriors.priorsVersion,
        stateVersion: adaptiveContext.personalState.stateVersion,
      },
      confidence: adaptiveContext.policyConfidence,
    },
    {
      sourceType: 'inferred' as const,
      stage: 'honest_effort',
      key: 'effort_score',
      value: {
        avgCompositeScore: profile.honestEffort?.avgCompositeScore ?? null,
        trend: profile.honestEffort?.trend ?? null,
        genuinelyHard: profile.honestEffort?.genuinelyHard ?? 0,
        consistencyQuotient: profile.consistencyQuotient?.quotientScore ?? null,
      },
      confidence: (profile.honestEffort?.last30Count ?? 0) >= 10 ? 0.85 : 0.5,
    },
    {
      sourceType: 'inferred' as const,
      stage: 'antifragility',
      key: 'muscle_indices',
      value: {
        count: profile.antifragilityIndices?.length ?? 0,
        aggressive: profile.antifragilityIndices?.filter(a => a.recommendation === 'aggressive').length ?? 0,
        conservative: profile.antifragilityIndices?.filter(a => a.recommendation === 'conservative').length ?? 0,
      },
      confidence: 0.7,
    },
    {
      sourceType: 'inferred' as const,
      stage: 'ego_audit',
      key: 'flags',
      value: {
        egoLifts: profile.egoAuditFlags?.filter(f => f.suspectedIssue === 'ego_lift').length ?? 0,
        weaknesses: profile.egoAuditFlags?.filter(f => f.suspectedIssue === 'genuine_weakness').length ?? 0,
      },
      confidence: 0.75,
    },
  ];

  workout.policyState = {
    policyVersion: 'policy_v4_adaptive_learning',
    pid: effectiveFatLossController.pid,
    fusion: {
      nutritionMultiplier: policyFusion.nutritionMultiplier,
      readinessMultiplier: policyFusion.readinessMultiplier,
      strengthMultiplier: policyFusion.strengthMultiplier,
      progressionMultiplier: policyFusion.progressionMultiplier,
      confidence: policyFusion.confidence,
    },
    guardrails: recoveryAdj.adjustmentReasons.filter(r => /guardrail|gated|deload/i.test(r)),
    adaptive: {
      policyConfidence: adaptiveContext.policyConfidence,
      promoteReady: adaptiveContext.promoteReady,
      priorsVersion: adaptiveContext.scientificPriors.priorsVersion,
      stateVersion: adaptiveContext.personalState.stateVersion,
    },
  };
  stageEnd(tFinalize);
  workout.decisionProvenance = decisionProvenance;
  workout.runtimeFlags = runtimeFlags;
  workout.perfTelemetry = {
    totalMs: Math.round((nowMs() - perfStart) * 100) / 100,
    stagesMs: stageMarks,
  };

  // Persist the day theme used during selection so downstream invariants (and
  // the UI) can reason about coherence without re-deriving it.
  if (effectiveDayTheme) workout.dayTheme = effectiveDayTheme;

  // Phase 5c: run the deterministic invariant pipeline as the final
  // safety net. Invariants are pure, fast, and individually auditable;
  // this is the layer that catches anything the upstream selectors,
  // prescribers, and validators missed. Auto-fixes are conservative:
  // theme violations drop offenders; rep×load violations clamp weight.
  const invariantCtx: WorkoutInvariantContext = {
    profile,
    preferences: prefs,
    cfg,
    bodyAssessment: prefetched?.bodyAssessment ?? null,
    dayTheme: effectiveDayTheme,
    weeklyCardio: null, // populated by weekly planner via runtimeFlags later if needed
  };
  const invariantResult = runInvariantPipeline(workout, invariantCtx, DEFAULT_WORKOUT_INVARIANTS);
  if (invariantResult.notes.length > 0) {
    workout.adjustmentsSummary = [
      ...workout.adjustmentsSummary,
      ...invariantResult.notes,
    ];
  }
  // Adopt the (possibly auto-fixed) workout state.
  workout.exercises = invariantResult.workout.exercises;
  // Surface any unresolved violations as warnings in the log so they're
  // visible in production telemetry without blocking the response.
  const { warnings, errors } = violationsBySeverity(invariantResult);
  if (errors.length > 0) {
    logWarn(`[INVARIANT] ${errors.length} unresolved error-level violations: ${errors.map(e => `${e.invariantId}: ${e.message}`).join(' | ')}`);
  }
  if (warnings.length > 0) {
    logWarn(`[INVARIANT] ${warnings.length} warnings: ${warnings.map(w => `${w.invariantId}: ${w.message}`).slice(0, 5).join(' | ')}`);
  }

  // Clear the active body assessment to prevent leaking across calls
  setActiveBodyAssessment(null);

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
  /** Phase 1: theme persisted so weekly planner & UI can both rely on it. */
  dayTheme?: DayTheme | null;
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
  /** Phase 1: persisted theme for UI, invariants, and missed-day redistribution. */
  dayTheme?: DayTheme | null;
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
  planQuality?: {
    avgConsecutiveOverlap: number;
    avgAnchorCoverage: number;
    avgNoveltyVsRecent: number;
    recurrenceBlockEvents: number;
    coherenceRejectEvents: number;
    avgCoherenceScore: number;
    plannerTotalMs: number;
    avgDayPlannerMs: number;
    avgDiversifyAttempts: number;
    monotony: number;
    generatedAt: string;
    /**
     * Phase 2: weekly cardio coverage observability.
     *   - `targetDays` — how many training days SHOULD have cardio
     *     (cut: all training days; bulk/maintain: cardio_frequency_per_week)
     *   - `coveredDays` — how many actually do
     *   - `policy` — which rule was applied
     */
    cardioCoverage?: {
      trainingDays: number;
      coveredDays: number;
      targetDays: number;
      policy: 'cut_every_day' | 'frequency_target' | 'unconfigured';
    };
  };
}

function computeWorkoutGroupStimulus(workout: GeneratedWorkout | null): Record<string, number> {
  const out: Record<string, number> = {};
  if (!workout) return out;
  for (const ex of workout.exercises ?? []) {
    if (ex.isCardio) continue;
    const group = normalizeMuscleGroupName(ex.targetMuscleGroup) ?? String(ex.targetMuscleGroup || '').toLowerCase();
    if (!group) continue;
    const eff = estimateGeneratedEffectiveSetWeight(ex) * Math.max(0, Number(ex.sets || 0));
    out[group] = (out[group] ?? 0) + eff;
  }
  return out;
}

function evaluateWorkoutCoherence(
  workout: GeneratedWorkout | null,
  prevWorkout: GeneratedWorkout | null,
  anchorGroups: string[],
  weekIdx: number,
  weeklyLastSeenByGroup: Map<string, number>,
  weeklyStimulusByGroup: Map<string, number>,
  profile: TrainingProfile,
): { score: number; violations: string[] } {
  if (!workout) return { score: 1, violations: [] };
  const violations: string[] = [];
  const stim = computeWorkoutGroupStimulus(workout);
  const anchorSet = new Set(normalizeMuscleGroupList(anchorGroups ?? []));
  const focused = new Set(normalizeMuscleGroupList(workout.muscleGroupsFocused ?? []));

  if (anchorSet.size > 0) {
    let covered = 0;
    for (const g of anchorSet) if (focused.has(g)) covered++;
    const coverage = covered / anchorSet.size;
    if (coverage < 0.5) violations.push(`anchor_coverage_${coverage.toFixed(2)}`);
  }

  // Recovery spacing: prevent repeated high-dose direct work on adjacent days.
  for (const [group, groupStim] of Object.entries(stim)) {
    const lastSeen = weeklyLastSeenByGroup.get(group);
    if (lastSeen != null && (weekIdx - lastSeen) <= 1 && groupStim >= 2.5) {
      violations.push(`adjacent_high_dose_${group}`);
    }
  }

  // Weekly overshoot guard against MAV drift while week is being built.
  for (const [group, groupStim] of Object.entries(stim)) {
    const vol = (profile.muscleVolumeStatuses ?? []).find(v => v.muscleGroup.toLowerCase() === group);
    const current = weeklyStimulusByGroup.get(group) ?? 0;
    if (vol && (current + groupStim) > (vol.mavHigh * 1.35)) {
      violations.push(`weekly_overshoot_${group}`);
    }
  }

  // Split coherence: avoid back-to-back heavy lower-body loading.
  if (prevWorkout) {
    const prevStim = computeWorkoutGroupStimulus(prevWorkout);
    const lowerGroups = ['quadriceps', 'hamstrings', 'glutes', 'adductors', 'abductors', 'hip_flexors'];
    const prevLower = lowerGroups.reduce((s, g) => s + (prevStim[g] ?? 0), 0);
    const currLower = lowerGroups.reduce((s, g) => s + (stim[g] ?? 0), 0);
    if (prevLower >= 6.5 && currLower >= 6.5) {
      violations.push('back_to_back_heavy_lower');
    }
  }

  const penalty = violations.length * 0.14;
  return { score: clampNumber(1 - penalty, 0, 1), violations };
}

export function generateWeekPreviewFromPlan(
  plan: WeeklyPlan | null,
  todayCompleted: boolean = false,
  todayCompletedName?: string
): DayPreview[] {
  if (!plan?.days?.length) return [];
  const today = getLocalDate();
  const mondayThroughSunday = [1, 2, 3, 4, 5, 6, 0];
  const byDow = new Map<number, WeeklyPlanDay>();
  for (const d of plan.days) byDow.set(d.dayOfWeek, d);

  return mondayThroughSunday.map((dow) => {
    const d = byDow.get(dow);
    const dayName = d?.dayName ?? ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dow];
    const isToday = d?.planDate === today;
    if (!d) {
      return {
        dayOfWeek: dow,
        dayName,
        isRestDay: true,
        focus: 'Rest',
        muscleGroups: [],
        estimatedExercises: 0,
        estimatedMinutes: 0,
        isToday,
      } as DayPreview;
    }

    if (isToday && todayCompleted) {
      return {
        dayOfWeek: d.dayOfWeek,
        dayName: d.dayName,
        isRestDay: false,
        isCompleted: true,
        focus: todayCompletedName || d.focus || 'Done',
        muscleGroups: d.muscleGroups ?? [],
        estimatedExercises: 0,
        estimatedMinutes: 0,
        isToday: true,
      };
    }

    const estMin = Number(d.plannedWorkout?.estimatedDurationMinutes ?? d.estimatedMinutes ?? 0);
    return {
      dayOfWeek: d.dayOfWeek,
      dayName: d.dayName,
      isRestDay: d.isRestDay,
      focus: d.focus || (d.muscleGroups ?? []).slice(0, 3).join(', ') || (d.isRestDay ? 'Rest' : 'Training'),
      muscleGroups: d.muscleGroups ?? [],
      estimatedExercises: Number(d.plannedWorkout?.exercises?.length ?? d.estimatedExercises ?? 0),
      estimatedMinutes: Number.isFinite(estMin) ? Math.round(estMin) : 0,
      isToday,
    };
  });
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
  userRestDays: number[] = [],
  preferredSplit?: string | null,
  splitSchedule?: Record<string, { focus: string; groups: string[] }> | null,
  prefetched?: PreFetchedEngineData
): Promise<WeeklyPlan> {
  const weeklyPlanStartMs = nowMs();
  const weekDates = getWeekDatesMondaySunday(new Date());
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  // Phase 2: prefetch user prefs so weekly-level checks (cardio frequency
  // policy, future invariants) can read fields like `cardio_frequency_per_week`
  // without hitting the DB inside the per-day loop.
  const planPrefs: UserPreferences | null = prefetched?.preferences
    ?? await fetchUserPreferences(profile.userId).catch(() => null as UserPreferences | null);
  const preview = generateWeekPreview(profile, userRestDays, false, undefined, preferredSplit, splitSchedule);
  const previewByDow = new Map<number, DayPreview>(preview.map(p => [p.dayOfWeek, p]));
  const restSet = new Set(userRestDays);

  const days: WeeklyPlanDay[] = [];
  const weeklyExerciseCounts = new Map<string, number>();
  const weeklyLastSeen = new Map<string, number>();
  const weeklyFamilyCounts = new Map<string, number>();
  const weeklyFamilyLastSeen = new Map<string, number>();
  const weeklyGroupLastSeen = new Map<string, number>();
  const weeklyGroupStimulus = new Map<string, number>();
  const weeklyRegionCounts = new Map<string, number>();
  const weeklyRegionLastSeen = new Map<string, number>();
  const weeklyStapleSeen = new Set<string>();
  const noveltySamples: number[] = [];
  const overlapSamples: number[] = [];
  const anchorSamples: number[] = [];
  const coherenceSamples: number[] = [];
  const dayPlannerMsSamples: number[] = [];
  const diversifyAttemptSamples: number[] = [];
  let recurrenceBlockEvents = 0;
  let coherenceRejectEvents = 0;
  // Use the shared canonicaliser so "pull up", "Pull-Up", "Pull-Ups", and
  // "pullups" all collapse to the SAME family key. Previously this was just
  // trim+lowercase, which left "pull up" and "pull-ups" as distinct keys —
  // fragmenting the user's exercisePreferences/progressions in two and
  // halving prescription quality on either branch. Routing through
  // canonicalizeExerciseName fixes the user-visible "pull up vs pull ups
  // are treated as different exercises" complaint at the planner layer.
  const normalizeExerciseName = (name: string): string =>
    canonicalizeExerciseName(name);
  const shouldExcludeStapleFamily = (familyKey: string): boolean =>
    familyKey === 'romanian_deadlift';
  const stapleFamilyAgg = new Map<string, {
    familyKey: string;
    representativeName: string;
    totalSessions: number;
    recentSessions: number;
    isStaple: boolean;
    bestLastUsedDaysAgo: number;
  }>();
  for (const p of (profile.exercisePreferences ?? [])) {
    const name = normalizeExerciseName(String(p.exerciseName || ''));
    if (!name) continue;
    const familyKey = stapleFamilyKey(name);
    const agg = stapleFamilyAgg.get(familyKey) ?? {
      familyKey,
      representativeName: name,
      totalSessions: 0,
      recentSessions: 0,
      isStaple: false,
      bestLastUsedDaysAgo: 999,
    };
    const pLastUsed = Number(p.lastUsedDaysAgo ?? 999);
    if (pLastUsed < agg.bestLastUsedDaysAgo) {
      agg.bestLastUsedDaysAgo = pLastUsed;
      agg.representativeName = name;
    }
    agg.totalSessions += Number(p.totalSessions ?? 0);
    agg.recentSessions += Number(p.recentSessions ?? 0);
    agg.isStaple = agg.isStaple || Boolean(p.isStaple) || Number(p.recentSessions ?? 0) >= 2;
    stapleFamilyAgg.set(familyKey, agg);
  }
  const weeklyStrictStapleFamilies = [...stapleFamilyAgg.values()]
    .filter((f) => !shouldExcludeStapleFamily(f.familyKey))
    .filter((f) => f.isStaple || (f.totalSessions >= 12 && f.bestLastUsedDaysAgo <= 28))
    .sort((a, b) => {
      const stapleRank = (Number(Boolean(b?.isStaple)) - Number(Boolean(a?.isStaple)));
      if (stapleRank !== 0) return stapleRank;
      const recencyRank = (Number(a?.bestLastUsedDaysAgo) || 999) - (Number(b?.bestLastUsedDaysAgo) || 999);
      if (recencyRank !== 0) return recencyRank;
      return (Number(b?.totalSessions) || 0) - (Number(a?.totalSessions) || 0);
    })
    .map((f) => f.familyKey)
    .filter(Boolean)
    .slice(0, 12);
  const weeklyFallbackStapleFamilies = [...stapleFamilyAgg.values()]
    .filter((f) => !shouldExcludeStapleFamily(f.familyKey))
    .filter((f) => f.totalSessions >= 4 && f.bestLastUsedDaysAgo <= 84)
    .sort((a, b) => {
      const recencyRank = (Number(a?.bestLastUsedDaysAgo) || 999) - (Number(b?.bestLastUsedDaysAgo) || 999);
      if (recencyRank !== 0) return recencyRank;
      return (Number(b?.totalSessions) || 0) - (Number(a?.totalSessions) || 0);
    })
    .map((f) => f.familyKey)
    .filter(Boolean)
    .slice(0, 12);
  const weeklyStapleFamilies = weeklyStrictStapleFamilies.length > 0
    ? weeklyStrictStapleFamilies
    : weeklyFallbackStapleFamilies;
  const weeklyStapleRepresentativeByFamily = new Map<string, string>(
    [...stapleFamilyAgg.values()].map((f) => [f.familyKey, f.representativeName])
  );
  const weeklyStapleSet = new Set(weeklyStapleFamilies);
  const canonicalFamilyKey = (ex: GeneratedExercise): string | null => {
    const identity = classifyGeneratedExercise(ex);
    if (identity.isHinge) return 'hip_hinge';
    return null;
  };
  const regionalSubgroupKey = (ex: GeneratedExercise): string | null => {
    const identity = classifyGeneratedExercise(ex);
    const group = String(ex.targetMuscleGroup || '').toLowerCase();
    if (group === 'upper_chest' || group === 'mid_chest' || group === 'lower_chest') return group;
    if (group === 'back_lats' || group === 'back_upper' || group === 'upper_traps' || group === 'mid_traps' || group === 'lower_traps') return group;
    const mp = identity.movementPattern ?? '';
    if (group === 'quadriceps' || mp === 'squat' || mp === 'lunge') return 'legs_quad_knee';
    if (group === 'hamstrings' || identity.isHinge || identity.isKneeFlexion) return 'legs_ham_hinge';
    if (group === 'glutes') return 'legs_glute';
    return null;
  };
  const exerciseNameSet = (w: GeneratedWorkout | null): Set<string> =>
    new Set((w?.exercises ?? []).filter(ex => !ex.isCardio).map(ex => normalizeExerciseName(ex.exerciseName)).filter(Boolean));
  const exerciseFamilySet = (w: GeneratedWorkout | null): Set<string> =>
    new Set((w?.exercises ?? []).filter(ex => !ex.isCardio).map(ex => canonicalFamilyKey(ex)).filter((v): v is string => !!v));
  const exerciseRegionSet = (w: GeneratedWorkout | null): Set<string> =>
    new Set((w?.exercises ?? []).filter(ex => !ex.isCardio).map(ex => regionalSubgroupKey(ex)).filter((v): v is string => !!v));
  const overlapRatio = (a: Set<string>, b: Set<string>): number => {
    if (a.size === 0 && b.size === 0) return 0;
    let overlap = 0;
    for (const x of a) if (b.has(x)) overlap++;
    return overlap / Math.max(a.size, b.size, 1);
  };
  const noveltyRatio = (current: Set<string>, recent: Set<string>): number => {
    if (current.size === 0) return 1;
    let novel = 0;
    for (const x of current) if (!recent.has(x)) novel++;
    return novel / current.size;
  };
  const anchorCoverage = (workout: GeneratedWorkout | null, anchorGroups: string[]): number => {
    if (!workout || anchorGroups.length === 0) return 0;
    const focused = new Set((workout.muscleGroupsFocused ?? []).map(g => String(g || '').toLowerCase()));
    if (focused.size === 0) return 0;
    const anchors = anchorGroups.map(g => String(g || '').toLowerCase()).filter(Boolean);
    if (anchors.length === 0) return 0;
    let covered = 0;
    for (const g of anchors) if (focused.has(g)) covered++;
    return covered / anchors.length;
  };
  const candidateScore = (
    workout: GeneratedWorkout | null,
    overlap: number,
    novelty: number,
    recurrenceCount: number,
    familyRecurrenceCount: number,
    anchorGroups: string[]
  ): number => {
    const evidence = clampNumber(profile.canonicalModelContext?.evidenceConfidence ?? 0.5, 0, 1);
    const adherence = clampNumber(profile.canonicalModelContext?.adherenceScore ?? profile.prescribedVsActual?.complianceRate ?? 0.5, 0, 1);
    const anchorWeight = 0.35 + 0.20 * evidence;
    const noveltyWeight = 0.25 + 0.20 * adherence;
    const antiOverlapWeight = 0.25;
    const recurrenceWeight = 0.30;
    const familyPenalty = familyRecurrenceCount * 1.4;
    const recurrencePenalty = (recurrenceCount + familyPenalty) / 6;
    return (
      anchorWeight * anchorCoverage(workout, anchorGroups)
      + noveltyWeight * novelty
      + antiOverlapWeight * (1 - overlap)
      - recurrenceWeight * recurrencePenalty
    );
  };
  const getRecentTrainingDays = (count: number): WeeklyPlanDay[] =>
    days.filter(d => !d.isRestDay && !!d.plannedWorkout).slice(-count);
  const workoutSignature = (w: GeneratedWorkout | null): string => {
    if (!w) return 'rest';
    return (w.exercises ?? [])
      .map(ex => `${ex.exerciseName}|${ex.sets}|${ex.targetReps}|${ex.targetWeight ?? 'bw'}|${ex.isCardio ? ex.cardioDurationSeconds ?? 0 : 0}`)
      .join(';;');
  };
  const normalizeGroups = (groups: string[] | null | undefined): string[] =>
    normalizeMuscleGroupList(groups ?? []);
  const groupOverlapRatio = (a: string[], b: string[]): number => {
    if (a.length === 0 || b.length === 0) return 0;
    const setA = new Set(a);
    const setB = new Set(b);
    let overlap = 0;
    for (const g of setA) if (setB.has(g)) overlap += 1;
    return overlap / Math.max(setA.size, setB.size, 1);
  };
  const rotationAnchorGroupsForDow = (dow: number): string[] => {
    const rotation = Array.isArray(profile.detectedSplit?.typicalRotation)
      ? profile.detectedSplit.typicalRotation
      : [];
    if (rotation.length === 0) return [];
    const mondayBased = (dow + 6) % 7;
    const splitName = rotation[mondayBased % rotation.length];
    return normalizeGroups(SPLIT_MUSCLE_MAPPING[splitName] ?? []);
  };
  let prevTrainingSignature: string | null = null;
  for (let weekIdx = 0; weekIdx < weekDates.length; weekIdx++) {
    const dayStartMs = nowMs();
    const planDate = weekDates[weekIdx];
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
    const prevTrainingDay = recentTrainingDays.length > 0 ? recentTrainingDays[recentTrainingDays.length - 1] : null;
    const prevGroups = normalizeGroups(prevTrainingDay?.muscleGroups ?? prevTrainingDay?.plannedWorkout?.muscleGroupsFocused ?? []);
    let dayAnchorGroups = normalizeGroups(p?.muscleGroups ?? []);
    if (dayAnchorGroups.length === 0) {
      dayAnchorGroups = rotationAnchorGroupsForDow(dow);
    }
    // Schedule- or rotation-sourced themes lock anchors — never let overlap
    // diversification silently swap "Monday is chest" into a back day.
    const dayThemeForDay = p?.dayTheme ?? null;
    const themeAnchorsLocked =
      dayThemeForDay?.source === 'schedule' || dayThemeForDay?.source === 'rotation';
    if (!themeAnchorsLocked && groupOverlapRatio(dayAnchorGroups, prevGroups) >= 0.67) {
      const rotated = rotationAnchorGroupsForDow(dow);
      if (rotated.length > 0) dayAnchorGroups = rotated;
    }
    const recentSignatures = new Set(recentTrainingDays.map(d0 => workoutSignature(d0.plannedWorkout)));
    const recentExerciseNames = new Set<string>();
    for (const prevDay of recentTrainingDays) {
      for (const n of exerciseNameSet(prevDay.plannedWorkout)) recentExerciseNames.add(n);
    }
    const recentRegions = new Set<string>();
    for (const prevDay of recentTrainingDays) {
      for (const r of exerciseRegionSet(prevDay.plannedWorkout)) recentRegions.add(r);
    }

    const proactiveAvoid = [...weeklyExerciseCounts.entries()]
      .filter(([, count]) => count >= 2)
      .map(([name]) => name);
    if ((weeklyFamilyCounts.get('hip_hinge') ?? 0) >= 1) {
      proactiveAvoid.push('romanian deadlift', 'rdl', 'stiff leg deadlift', 'good morning');
    }
    const preferredStaplesForDay = weeklyStapleFamilies
      .filter((familyKey) => !weeklyStapleSeen.has(familyKey))
      .map((familyKey) => weeklyStapleRepresentativeByFamily.get(familyKey) ?? familyKey)
      .slice(0, 6);
    const protectedStapleSet = new Set(preferredStaplesForDay);
    const proactiveAvoidFiltered = proactiveAvoid.filter((name) => !protectedStapleSet.has(normalizeExerciseName(name)));
    let plannedWorkout = await generateWorkout(
      profile,
      proactiveAvoidFiltered.length > 0
        ? {
            planningDate: planDate,
            avoidExerciseNames: proactiveAvoidFiltered,
            anchorMuscleGroups: dayAnchorGroups,
            preferredExerciseNames: preferredStaplesForDay,
            dayTheme: dayThemeForDay,
          }
        : {
            planningDate: planDate,
            anchorMuscleGroups: dayAnchorGroups,
            preferredExerciseNames: preferredStaplesForDay,
            dayTheme: dayThemeForDay,
          },
      prefetched
    );
    let signature = workoutSignature(plannedWorkout);

    // Strong diversification pass:
    // - avoid exact signature matches with prior training days
    // - avoid high overlap with the immediately previous day
    // - widen avoid-list progressively when necessary
    const MAX_DIVERSIFY_ATTEMPTS = 5;
    const OVERLAP_THRESHOLD = 0.6;
    const MIN_NOVELTY_RATIO = 0.35;
    const SOFT_OVERLAP_MARGIN = 0.08;
    const SOFT_NOVELTY_MARGIN = 0.08;
    const MIN_IMPROVEMENT_DELTA = 0.015;
    let attempt = 0;
    let bestWorkout = plannedWorkout;
    let bestScore = -Infinity;
    while (attempt < MAX_DIVERSIFY_ATTEMPTS) {
      const prevWorkout = recentTrainingDays.length > 0 ? recentTrainingDays[recentTrainingDays.length - 1].plannedWorkout : null;
      const prevNameSet = exerciseNameSet(prevWorkout);
      const currNameSet = exerciseNameSet(plannedWorkout);
      const overlap = overlapRatio(currNameSet, prevNameSet);
      const novelty = noveltyRatio(currNameSet, recentExerciseNames);
      const currFamilies = exerciseFamilySet(plannedWorkout);
      const currRegions = exerciseRegionSet(plannedWorkout);
      const regionNovelty = noveltyRatio(currRegions, recentRegions);
      const currStapleFamilies = new Set([...currNameSet].map((name) => stapleFamilyKey(name)));
      const stapleHits = [...currStapleFamilies].filter((familyKey) => weeklyStapleSet.has(familyKey));
      const recurrenceViolations = [...currNameSet].filter((name) => {
        const count = weeklyExerciseCounts.get(name) ?? 0;
        const lastSeen = weeklyLastSeen.get(name);
        const consecutive = lastSeen != null ? (weekIdx - lastSeen) <= 1 : false;
        return count >= 2 || consecutive;
      });
      const familyViolations = [...currFamilies].filter((family) => {
        const count = weeklyFamilyCounts.get(family) ?? 0;
        const lastSeen = weeklyFamilyLastSeen.get(family);
        const consecutive = lastSeen != null ? (weekIdx - lastSeen) <= 1 : false;
        return count >= 2 || consecutive;
      });
      const regionViolations = [...currRegions].filter((region) => {
        const count = weeklyRegionCounts.get(region) ?? 0;
        const lastSeen = weeklyRegionLastSeen.get(region);
        const consecutive = lastSeen != null ? (weekIdx - lastSeen) <= 1 : false;
        return count >= 2 || consecutive;
      });
      const exactRepeat = (prevTrainingSignature && signature === prevTrainingSignature) || recentSignatures.has(signature);
      const excessiveOverlap = overlap >= OVERLAP_THRESHOLD && currNameSet.size >= 3;
      const lowNovelty = currNameSet.size >= 4 && novelty < MIN_NOVELTY_RATIO;
      const lowRegionalNovelty = currRegions.size >= 2 && regionNovelty < 0.34;
      const excessiveRecurrence = recurrenceViolations.length > 0 || familyViolations.length > 0 || regionViolations.length > 0;
      const coherence = evaluateWorkoutCoherence(
        plannedWorkout,
        prevWorkout,
        dayAnchorGroups,
        weekIdx,
        weeklyGroupLastSeen,
        weeklyGroupStimulus,
        profile,
      );
      const coherenceViolation = coherence.violations.length > 0;
      if (coherenceViolation) coherenceRejectEvents += 1;
      if (excessiveRecurrence) recurrenceBlockEvents += 1;
      const stapleCoverageBonus = weeklyStapleSet.size > 0 ? clampNumber(stapleHits.length / 2, 0, 1) : 0;
      const currScoreBase = candidateScore(
        plannedWorkout,
        overlap,
        novelty,
        recurrenceViolations.length,
        familyViolations.length,
        dayAnchorGroups
      );
      const currScore = (
        currScoreBase
        + 0.14 * stapleCoverageBonus
        + 0.10 * regionNovelty
        - 0.08 * regionViolations.length
      ) * (0.78 + 0.22 * coherence.score);
      if (currScore > bestScore) {
        bestScore = currScore;
        bestWorkout = plannedWorkout;
      }
      if (!exactRepeat && !excessiveOverlap && !lowNovelty && !lowRegionalNovelty && !excessiveRecurrence && !coherenceViolation) break;
      const softPass = !exactRepeat
        && !excessiveRecurrence
        && !coherenceViolation
        && !lowRegionalNovelty
        && overlap < (OVERLAP_THRESHOLD + SOFT_OVERLAP_MARGIN)
        && novelty >= Math.max(0.2, MIN_NOVELTY_RATIO - SOFT_NOVELTY_MARGIN);
      if (attempt >= 1 && softPass) break;

      const baseAvoid = [...recentExerciseNames];
      const currTop = (plannedWorkout.exercises ?? [])
        .filter(ex => !ex.isCardio)
        .slice(0, 8)
        .map(ex => normalizeExerciseName(ex.exerciseName))
        .filter(Boolean);
      const regionViolationSet = new Set(regionViolations);
      const regionRepeatNames = (plannedWorkout.exercises ?? [])
        .filter(ex => !ex.isCardio && regionViolationSet.has(regionalSubgroupKey(ex) ?? ''))
        .map(ex => normalizeExerciseName(ex.exerciseName))
        .filter(Boolean);
      const avoidExerciseNames = [...new Set([
        ...baseAvoid,
        ...currTop,
        ...recurrenceViolations,
        ...regionRepeatNames
      ])]
        .filter(name => !protectedStapleSet.has(name))
        .slice(0, 20);
      if (avoidExerciseNames.length === 0) break;

      const regenerated = await generateWorkout(
        profile,
        {
          planningDate: planDate,
          avoidExerciseNames,
          anchorMuscleGroups: dayAnchorGroups,
          preferredExerciseNames: preferredStaplesForDay,
          dayTheme: dayThemeForDay,
        },
        prefetched
      );
      const regeneratedSignature = workoutSignature(regenerated);
      const regeneratedNames = exerciseNameSet(regenerated);
      const regeneratedOverlap = overlapRatio(regeneratedNames, prevNameSet);
      const regeneratedNovelty = noveltyRatio(regeneratedNames, recentExerciseNames);
      const regeneratedFamilies = exerciseFamilySet(regenerated);
      const regeneratedRegions = exerciseRegionSet(regenerated);
      const regeneratedRegionNovelty = noveltyRatio(regeneratedRegions, recentRegions);
      const regeneratedStapleFamilies = new Set([...regeneratedNames].map((name) => stapleFamilyKey(name)));
      const regeneratedStapleHits = [...regeneratedStapleFamilies].filter((familyKey) => weeklyStapleSet.has(familyKey));
      const regeneratedRecurrence = [...regeneratedNames].filter((name) => {
        const count = weeklyExerciseCounts.get(name) ?? 0;
        const lastSeen = weeklyLastSeen.get(name);
        const consecutive = lastSeen != null ? (weekIdx - lastSeen) <= 1 : false;
        return count >= 2 || consecutive;
      });
      const regeneratedFamilyRecurrence = [...regeneratedFamilies].filter((family) => {
        const count = weeklyFamilyCounts.get(family) ?? 0;
        const lastSeen = weeklyFamilyLastSeen.get(family);
        const consecutive = lastSeen != null ? (weekIdx - lastSeen) <= 1 : false;
        return count >= 2 || consecutive;
      });
      const regeneratedRegionRecurrence = [...regeneratedRegions].filter((region) => {
        const count = weeklyRegionCounts.get(region) ?? 0;
        const lastSeen = weeklyRegionLastSeen.get(region);
        const consecutive = lastSeen != null ? (weekIdx - lastSeen) <= 1 : false;
        return count >= 2 || consecutive;
      });
      const regeneratedStapleCoverageBonus = weeklyStapleSet.size > 0
        ? clampNumber(regeneratedStapleHits.length / 2, 0, 1)
        : 0;
      const regeneratedScoreBase = candidateScore(
        regenerated,
        regeneratedOverlap,
        regeneratedNovelty,
        regeneratedRecurrence.length,
        regeneratedFamilyRecurrence.length,
        dayAnchorGroups
      );
      const regeneratedScore = (
        regeneratedScoreBase
        + 0.14 * regeneratedStapleCoverageBonus
        + 0.10 * regeneratedRegionNovelty
        - 0.08 * regeneratedRegionRecurrence.length
      ) * (0.78 + 0.22 * evaluateWorkoutCoherence(
        regenerated,
        prevWorkout,
        dayAnchorGroups,
        weekIdx,
        weeklyGroupLastSeen,
        weeklyGroupStimulus,
        profile,
      ).score);
      if (regeneratedScore > bestScore) {
        bestScore = regeneratedScore;
        bestWorkout = regenerated;
      }
      const negligibleGain = regeneratedScore <= (currScore + MIN_IMPROVEMENT_DELTA);
      if (attempt >= 1 && negligibleGain && softPass) {
        plannedWorkout = regeneratedScore >= currScore ? regenerated : plannedWorkout;
        signature = workoutSignature(plannedWorkout);
        break;
      }

      const isBetter = regeneratedSignature !== signature && regeneratedScore >= currScore;

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
    diversifyAttemptSamples.push(attempt);
    plannedWorkout = bestWorkout;
    signature = workoutSignature(plannedWorkout);
    prevTrainingSignature = signature;
    const prevGeneratedDay = [...days].reverse().find(d => !d.isRestDay && d.plannedWorkout);
    const finalizedNames = exerciseNameSet(plannedWorkout);
    if (prevGeneratedDay?.plannedWorkout) {
      const prevFinalNames = exerciseNameSet(prevGeneratedDay.plannedWorkout);
      overlapSamples.push(overlapRatio(finalizedNames, prevFinalNames));
    }
    const recentNamesForSample = new Set<string>();
    for (const r of getRecentTrainingDays(2)) {
      for (const n of exerciseNameSet(r.plannedWorkout)) recentNamesForSample.add(n);
    }
    noveltySamples.push(noveltyRatio(finalizedNames, recentNamesForSample));
    anchorSamples.push(anchorCoverage(plannedWorkout, dayAnchorGroups));
    const finalizedCoherence = evaluateWorkoutCoherence(
      plannedWorkout,
      prevGeneratedDay?.plannedWorkout ?? null,
      dayAnchorGroups,
      weekIdx,
      weeklyGroupLastSeen,
      weeklyGroupStimulus,
      profile,
    );
    coherenceSamples.push(finalizedCoherence.score);
    for (const n of exerciseNameSet(plannedWorkout)) {
      weeklyExerciseCounts.set(n, (weeklyExerciseCounts.get(n) ?? 0) + 1);
      weeklyLastSeen.set(n, weekIdx);
      const familyKey = stapleFamilyKey(n);
      if (weeklyStapleSet.has(familyKey)) weeklyStapleSeen.add(familyKey);
    }
    for (const [group, dose] of Object.entries(computeWorkoutGroupStimulus(plannedWorkout))) {
      weeklyGroupStimulus.set(group, (weeklyGroupStimulus.get(group) ?? 0) + dose);
      weeklyGroupLastSeen.set(group, weekIdx);
    }
    for (const family of exerciseFamilySet(plannedWorkout)) {
      weeklyFamilyCounts.set(family, (weeklyFamilyCounts.get(family) ?? 0) + 1);
      weeklyFamilyLastSeen.set(family, weekIdx);
    }
    for (const region of exerciseRegionSet(plannedWorkout)) {
      weeklyRegionCounts.set(region, (weeklyRegionCounts.get(region) ?? 0) + 1);
      weeklyRegionLastSeen.set(region, weekIdx);
    }
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
      // Phase 1: persisted theme drives both UI label and missed-day redistribution.
      dayTheme: dayThemeForDay,
    });
    dayPlannerMsSamples.push(Math.round((nowMs() - dayStartMs) * 100) / 100);
  }

  const trainingMinutes = days
    .filter(d => !d.isRestDay)
    .map(d => Number(d.estimatedMinutes || d.plannedWorkout?.estimatedDurationMinutes || 0))
    .filter(v => Number.isFinite(v) && v > 0);
  const avgMinutes = trainingMinutes.length > 0
    ? trainingMinutes.reduce((s, v) => s + v, 0) / trainingMinutes.length
    : 0;
  const minuteStd = trainingMinutes.length > 1
    ? Math.sqrt(trainingMinutes.reduce((s, v) => s + ((v - avgMinutes) ** 2), 0) / (trainingMinutes.length - 1))
    : 0;
  const monotony = minuteStd > 0 ? avgMinutes / minuteStd : 0;
  const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;

  // Frequency validation: ensure primary groups hit >= 2x/week
  const weekFrequencyMap: Record<string, number> = {};
  for (const day of days) {
    if (day.isRestDay || !day.plannedWorkout?.exercises) continue;
    const dayGroups = new Set<string>();
    for (const ex of day.plannedWorkout.exercises) {
      const g = String(ex.targetMuscleGroup || '').toLowerCase();
      if (g) dayGroups.add(g);
    }
    for (const g of dayGroups) {
      weekFrequencyMap[g] = (weekFrequencyMap[g] ?? 0) + 1;
    }
  }
  const underhitGroups: string[] = [];
  for (const g of PRIMARY_MUSCLE_GROUPS) {
    if ((weekFrequencyMap[g] ?? 0) < DEFAULT_MODEL_CONFIG.minWeeklyFrequencyPrimary) {
      underhitGroups.push(g);
    }
  }
  if (underhitGroups.length > 0) {
    logWarn(`[FREQ] Underhit primary groups: ${underhitGroups.join(', ')}`);
  }

  // Split adherence validation: check push/pull/leg volume balance
  const PUSH_GROUPS = new Set(['upper_chest', 'mid_chest', 'lower_chest', 'anterior_deltoid', 'lateral_deltoid', 'triceps']);
  const PULL_GROUPS = new Set(['back_lats', 'back_upper', 'upper_traps', 'mid_traps', 'lower_traps', 'posterior_deltoid', 'biceps']);
  const LEG_GROUPS_SET = new Set(['quadriceps', 'hamstrings', 'glutes', 'adductors', 'abductors', 'hip_flexors']);
  let pushExercises = 0, pullExercises = 0, legExercises = 0;
  for (const day of days) {
    if (day.isRestDay || !day.plannedWorkout?.exercises) continue;
    for (const ex of day.plannedWorkout.exercises) {
      if (ex.isCardio) continue;
      const g = String(ex.targetMuscleGroup || '').toLowerCase();
      if (PUSH_GROUPS.has(g)) pushExercises++;
      else if (PULL_GROUPS.has(g)) pullExercises++;
      else if (LEG_GROUPS_SET.has(g)) legExercises++;
    }
  }
  if (pullExercises > 0 && pushExercises / pullExercises > 1.8) {
    logWarn(`[SPLIT] Push/pull imbalance: ${pushExercises} push vs ${pullExercises} pull exercises (ratio ${(pushExercises / pullExercises).toFixed(1)})`);
  }
  if (legExercises > 0 && (pushExercises + pullExercises) / legExercises > 4.0) {
    logWarn(`[SPLIT] Upper/lower imbalance: ${pushExercises + pullExercises} upper vs ${legExercises} leg exercises`);
  }

  // #20: Verify generated plan matches user's split schedule (hard constraint).
  if (splitSchedule) {
    for (const day of days) {
      if (day.isRestDay || !day.plannedWorkout?.exercises) continue;
      const scheduleEntry = splitSchedule[String(day.dayOfWeek)];
      if (!scheduleEntry || !scheduleEntry.groups?.length) continue;
      const scheduledGroups = new Set(normalizeMuscleGroupList(scheduleEntry.groups));
      const plannedGroups = new Set(
        day.plannedWorkout.exercises
          .filter(ex => !ex.isCardio)
          .map(ex => String(ex.targetMuscleGroup || '').toLowerCase())
          .filter(Boolean)
      );
      // At least 50% of scheduled groups should appear in planned workout
      let hits = 0;
      for (const g of scheduledGroups) if (plannedGroups.has(g)) hits++;
      const coverage = hits / scheduledGroups.size;
      if (coverage < 0.5) {
        logWarn(`[SPLIT] ${day.dayName} plan mismatches schedule: expected ${[...scheduledGroups].join(', ')}, got ${[...plannedGroups].join(', ')} (${Math.round(coverage * 100)}% coverage)`);
        // Override focus label to match schedule
        day.focus = scheduleEntry.focus;
        day.muscleGroups = scheduleEntry.groups;
      }
    }
  }

  // Phase 2: cardio coverage check.
  //   - Cutting → expect cardio every training day.
  //   - Bulk / maintain → expect at least cardio_frequency_per_week training
  //     days to carry cardio. Excess is permitted (engine doesn't strip).
  //   - No prefs / unset frequency → policy is 'unconfigured', metric only.
  const trainingDays = days.filter(d => !d.isRestDay && d.plannedWorkout).length;
  const coveredDays = days.filter(d =>
    !d.isRestDay && d.plannedWorkout?.exercises?.some(e => e.isCardio)
  ).length;
  const phase = profile.bodyWeightTrend?.phase;
  let cardioPolicy: 'cut_every_day' | 'frequency_target' | 'unconfigured' = 'unconfigured';
  let targetDays = 0;
  if (phase === 'cutting') {
    cardioPolicy = 'cut_every_day';
    targetDays = trainingDays;
  } else if (planPrefs?.cardio_frequency_per_week != null && planPrefs.cardio_frequency_per_week > 0) {
    cardioPolicy = 'frequency_target';
    targetDays = Math.min(trainingDays, Math.round(Number(planPrefs.cardio_frequency_per_week)));
  }
  if (targetDays > coveredDays) {
    logWarn(
      `[CARDIO] Weekly coverage shortfall: ${coveredDays}/${targetDays} training days have cardio ` +
      `(policy: ${cardioPolicy}, trainingDays: ${trainingDays}). Likely root cause: ` +
      `validateAndCorrect trimmed cardio under time budget — check Phase 2 trim ordering.`
    );
  }

  return {
    weekStartDate: weekDates[0],
    featureSnapshotId: profile.featureSnapshotId,
    days,
    planQuality: {
      avgConsecutiveOverlap: Math.round(avg(overlapSamples) * 1000) / 1000,
      avgAnchorCoverage: Math.round(avg(anchorSamples) * 1000) / 1000,
      avgNoveltyVsRecent: Math.round(avg(noveltySamples) * 1000) / 1000,
      recurrenceBlockEvents,
      coherenceRejectEvents,
      avgCoherenceScore: Math.round(avg(coherenceSamples) * 1000) / 1000,
      plannerTotalMs: Math.round((nowMs() - weeklyPlanStartMs) * 100) / 100,
      avgDayPlannerMs: Math.round(avg(dayPlannerMsSamples) * 100) / 100,
      avgDiversifyAttempts: Math.round(avg(diversifyAttemptSamples) * 100) / 100,
      monotony: Math.round(monotony * 100) / 100,
      generatedAt: new Date().toISOString(),
      cardioCoverage: {
        trainingDays,
        coveredDays,
        targetDays,
        policy: cardioPolicy,
      },
    },
  };
}

export async function recomputeWeeklyPlanWithDiff(
  previousPlan: WeeklyPlan,
  profile: TrainingProfile,
  userRestDays: number[] = [],
  preferredSplit?: string | null,
  splitSchedule?: Record<string, { focus: string; groups: string[] }> | null,
  prefetched?: PreFetchedEngineData
): Promise<{ plan: WeeklyPlan; diffs: WeeklyPlanDiff[] }> {
  const recomputed = await generateWeeklyPlan(profile, userRestDays, preferredSplit, splitSchedule, prefetched);
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
  todayCompletedName?: string,
  preferredSplit?: string | null,
  splitSchedule?: Record<string, { focus: string; groups: string[] }> | null
): DayPreview[] {
  const todayDow = new Date().getDay(); // 0=Sun .. 6=Sat
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const { dayOfWeekPatterns, detectedSplit } = profile;
  const restDaySet = new Set(userRestDays);

  const splitLabels: Record<string, string> = {
    push: 'Push', pull: 'Pull', legs: 'Legs',
    upper: 'Upper', lower: 'Lower', full: 'Full Body',
    chest: 'Chest', back: 'Back', shoulders: 'Shoulders', arms: 'Arms',
  };

  // Prefer user's explicit split over auto-detected rotation
  const prefRotation = preferredSplit && SPLIT_TYPE_ROTATIONS[preferredSplit]
    ? SPLIT_TYPE_ROTATIONS[preferredSplit]
    : null;
  const rotation = prefRotation
    ?? (detectedSplit.typicalRotation.length > 0 ? detectedSplit.typicalRotation : []);

  // Figure out where in the rotation we are based on most recent training day
  let rotationIdx = 0;
  if (rotation.length > 0) {
    for (let daysBack = 0; daysBack < 7; daysBack++) {
      const checkDow = (todayDow - daysBack + 7) % 7;
      const pattern = dayOfWeekPatterns[checkDow];
      if (pattern && !pattern.isRestDay && daysBack > 0) {
        const lastFocus = normalizeMuscleGroupList(pattern.muscleGroupsTypical ?? []);
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
    // Phase 1: track the *origin* of the day's groups so the planner and the
    // selection-time hard filter can reason about how strict to be.
    let themeSource: DayTheme['source'] = 'default';

    // User-defined weekly split schedule takes absolute priority
    if (splitSchedule) {
      const dayEntry = splitSchedule[String(dow)];
      if (dayEntry && dayEntry.groups?.length > 0) {
        focus = dayEntry.focus;
        muscleGroups = dayEntry.groups;
        themeSource = 'schedule';
        usedRotationSlots++;
      }
    }

    if (!focus && rotation.length > 0) {
      const slot = rotation[(rotationIdx + usedRotationSlots) % rotation.length];
      focus = splitLabels[slot] || slot;
      muscleGroups = BRO_SPLIT_MAPPING[slot] ?? SPLIT_MUSCLE_MAPPING[slot] ?? [];
      themeSource = 'rotation';
      usedRotationSlots++;
    }

    if (muscleGroups.length === 0 && pattern && pattern.muscleGroupsTypical.length > 0) {
      muscleGroups = pattern.muscleGroupsTypical.slice(0, 4);
      if (!focus) focus = muscleGroups.slice(0, 3).map(g => g.replace(/_/g, ' ')).join(', ');
      // themeSource stays 'default'
    }

    if (muscleGroups.length === 0 && !focus) {
      if (rotation.length > 0) {
        const slot = rotation[(rotationIdx + usedRotationSlots - 1) % rotation.length];
        focus = splitLabels[slot] || slot;
        muscleGroups = BRO_SPLIT_MAPPING[slot] ?? SPLIT_MUSCLE_MAPPING[slot] ?? [];
        themeSource = 'rotation';
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
      dayTheme: deriveDayTheme(focus, muscleGroups, themeSource),
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
  const supabase = db as any;
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

  // Provenance ledger emission (non-fatal if table not yet migrated).
  try {
    const provenanceRows = (workout.decisionProvenance || []).map((p) => ({
      user_id: userId,
      event_date: workout.date,
      source_type: p.sourceType,
      decision_stage: p.stage,
      decision_key: p.key,
      decision_value: p.value,
      confidence: p.confidence,
      generated_workout_id: workout.id,
      model_version: WORKOUT_ENGINE_VERSION,
      policy_version: workout.policyState?.policyVersion ?? 'policy_v4_adaptive_learning',
    }));
    if (provenanceRows.length > 0) {
      const { error: provenanceError } = await supabase
        .from('decision_provenance_events')
        .insert(provenanceRows);
      if (provenanceError) {
        logWarn('Decision provenance persistence skipped', provenanceError);
      }
    }
  } catch (e) {
    logWarn('Decision provenance persistence failed', e);
  }

  // Intervention episode memory (weekly bucket by goal + policy version).
  try {
    const episodeDate = workout.date || getLocalDate();
    const weekKey = `${episodeDate.slice(0, 8)}01`; // stable monthly-style key for now
    const episodeKey = `${workout.trainingGoal}:${workout.policyState?.policyVersion ?? 'policy_v4'}:${weekKey}`;

    const episodePayload = {
      user_id: userId,
      episode_key: episodeKey,
      started_on: episodeDate,
      ended_on: null,
      goal_context: { trainingGoal: workout.trainingGoal },
      active_policy_params: workout.policyState ?? {},
      safety_bounds: { runtimeFlags: workout.runtimeFlags ?? {} },
      status: 'active',
    };

    const { data: episodeRow, error: episodeError } = await supabase
      .from('intervention_episodes')
      .upsert(episodePayload, { onConflict: 'user_id,episode_key' })
      .select('id')
      .single();
    if (episodeError) {
      logWarn('Intervention episode upsert skipped', episodeError);
    } else if (episodeRow?.id) {
      const controlSignal = Number(workout.policyState?.pid?.controlSignal ?? 0);
      const objectiveScore = Number(workout.objectiveUtility?.utility ?? 0.5);
      const regretScore = Math.max(0, 0.5 - objectiveScore);
      const outcomePayload = {
        user_id: userId,
        intervention_episode_id: episodeRow.id,
        measured_on: episodeDate,
        adherence_score: Number(workout.objectiveUtility?.adherenceScore ?? null),
        readiness_delta: Number(workout.policyState?.fusion?.readinessMultiplier ?? 1) - 1,
        strength_delta: Number(workout.policyState?.fusion?.strengthMultiplier ?? 1) - 1,
        weight_trend_delta: controlSignal,
        objective_score: objectiveScore,
        regret_score: regretScore,
        summary: {
          estimatedDurationMinutes: workout.estimatedDurationMinutes,
          exerciseCount: workout.exercises.length,
        },
      };
      const { error: outcomeError } = await supabase
        .from('intervention_episode_outcomes')
        .upsert(outcomePayload, { onConflict: 'intervention_episode_id,measured_on' });
      if (outcomeError) {
        logWarn('Intervention episode outcome persistence skipped', outcomeError);
      }
    }
  } catch (e) {
    logWarn('Intervention episode memory persistence failed', e);
  }
}
