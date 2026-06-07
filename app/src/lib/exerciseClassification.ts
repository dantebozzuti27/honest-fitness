/**
 * Exercise identity / classification — a pure, side-effect-free leaf module.
 *
 * Extracted from `workoutEngine.ts` (which was a single ~8.8k-line file). This
 * cluster has no module-level mutable state and depends only on other leaf
 * modules (muscle-token resolution, equipment normalization), so it is safe to
 * own independently. The engine imports these symbols back; the dependency is
 * strictly one-directional (engine → classification).
 *
 * `classifyGeneratedExercise` takes a structural `GeneratedExerciseLike` rather
 * than importing the engine's `GeneratedExercise` type, which avoids a circular
 * import while remaining fully type-compatible at the call sites.
 */
import { resolveMuscleToken } from './exerciseOntology';
import type { CanonicalMuscleGroup } from './volumeGuidelines';
import type { EnrichedExercise } from './trainingAnalysis';
import { normalizeEquipment } from '../utils/formatUtils';

/**
 * Resolve a raw primary_muscles entry to its canonical group, tolerating
 * case/space mismatches in the exercise library data.
 */
export function resolveToCanonicalGroup(raw: string): CanonicalMuscleGroup | undefined {
  return resolveMuscleToken(raw) ?? undefined;
}

// ─── Exercise Identity (structured lookup layer) ─────────────────────────────

export const COMPOUND_MOVEMENT_PATTERNS = new Set([
  'squat', 'hip_hinge', 'horizontal_push', 'vertical_push',
  'horizontal_pull', 'vertical_pull', 'lunge', 'compound',
]);

const BIG_THREE_RE = /^(bench press|barbell bench press|flat bench press|squat|back squat|barbell squat|barbell back squat|deadlift|conventional deadlift|barbell deadlift)$/i;
const HINGE_NAME_RE = /(^|\b)(rdl|romanian deadlift|stiff\s*leg deadlift|good morning|deadlift)(\b|$)/i;
const KNEE_FLEXION_RE = /\b(leg curl|hamstring curl|nordic|glute.?ham|lying leg curl|seated leg curl|lying hamstring)\b/i;
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

/** Minimal shape needed to derive identity from a post-prescription exercise. */
export interface GeneratedExerciseLike {
  exerciseName: string;
  movementPattern?: string | null;
  targetMuscleGroup?: string | null;
  isCardio?: boolean;
  isBodyweight: boolean;
}

export function classifyCorePattern(nameLC: string): ExerciseIdentity['corePattern'] {
  if (CORE_FLEXION_RE.test(nameLC)) return 'flexion';
  if (CORE_ANTI_RE.test(nameLC)) return 'anti_movement';
  if (CORE_ANTI_EXT_RE.test(nameLC)) return 'anti_extension';
  if (CORE_ROTATION_RE.test(nameLC)) return 'rotation';
  if (CORE_HIP_FLEXION_RE.test(nameLC)) return 'hip_flexion';
  return null;
}

export function classifyCardioModality(nameLC: string): ExerciseIdentity['cardioModality'] {
  if (/stairmaster|stair master|stepmill/.test(nameLC)) return 'stair';
  if (/bike|cycle/.test(nameLC)) return 'bike';
  if (/row/.test(nameLC)) return 'row';
  if (/elliptical/.test(nameLC)) return 'elliptical';
  if (/run|jog|sprint/.test(nameLC)) return 'run';
  if (/walk|treadmill|incline|hike|ruck/.test(nameLC)) return 'walk';
  return null;
}

export function classifyCnsDemandFromName(nameLC: string, movementPattern: string | null): number {
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
export function classifyExercise(name: string, libraryEntry?: EnrichedExercise | null): ExerciseIdentity {
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
 * Build ExerciseIdentity from a generated (post-prescription) exercise.
 * Uses the already-resolved fields rather than re-querying the library.
 */
export function classifyGeneratedExercise(ex: GeneratedExerciseLike): ExerciseIdentity {
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
