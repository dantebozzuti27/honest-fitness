/**
 * Unified exercise ontology — single resolver for muscles, families, identity, swaps.
 *
 * Replaces fragmented normalizers across workoutEngine, trainingAnalysis, and
 * surgicalSwap. Version bumps invalidate cached week plans via PRESCRIPTION_POLICY.
 */

import {
  EXERCISE_MUSCLE_MAP,
  canonicalizeExerciseName,
  getExerciseMapping,
  type ExerciseMapping,
} from './exerciseMuscleMap';
import {
  MUSCLE_HEAD_TO_GROUP,
  normalizeMuscleGroupName,
  type CanonicalMuscleGroup,
  type ExerciseType,
  type MovementPattern,
} from './volumeGuidelines';

export const ONTOLOGY_VERSION = '2026-06-08.2';

export type BicepsHeadEmphasis = 'long_head' | 'short_head' | 'brachialis' | 'balanced';
export type TricepsHeadEmphasis = 'long_head' | 'lateral_head' | 'overhead' | 'balanced';
export type HamstringEmphasis = 'hip_dominant' | 'knee_dominant' | 'balanced';
export type RearDeltEmphasis = 'horizontal_abduction' | 'external_rotation' | 'balanced';
export type MuscleEmphasis = BicepsHeadEmphasis | TricepsHeadEmphasis | HamstringEmphasis | RearDeltEmphasis;
export type VariationAxis = 'implement' | 'angle' | 'grip' | 'unilateral' | 'machine' | 'cable';

export interface ExerciseFamilySpec {
  id: string;
  label: string;
  targetGroups: CanonicalMuscleGroup[];
  movementPatterns: MovementPattern[];
  headEmphasis?: BicepsHeadEmphasis | TricepsHeadEmphasis | HamstringEmphasis | RearDeltEmphasis;
  variationAxis?: VariationAxis;
}

export interface ExerciseIdentityV2 {
  originalName: string;
  familyKey: string;
  canonicalNameKey: string;
  primaryGroups: CanonicalMuscleGroup[];
  secondaryGroups: CanonicalMuscleGroup[];
  movementPattern: MovementPattern | null;
  exerciseType: ExerciseType | null;
  bicepsHeadEmphasis: BicepsHeadEmphasis | null;
  muscleEmphasis: MuscleEmphasis | null;
  mapping: ExerciseMapping | null;
}

type FamilyRule = {
  id: string;
  test: RegExp;
  spec: Omit<ExerciseFamilySpec, 'id'>;
  /**
   * Specificity rank. When several rules match a name, the highest priority
   * wins (ties broken by authoring order via a stable sort). Defaults to 0.
   * Use a positive value to promote a specific rule above a generic one whose
   * pattern would otherwise shadow it regardless of position — e.g. `leg_curl`
   * must beat the generic `biceps_curl` ("\bcurl\b") for "Lying Leg Curl".
   */
  priority?: number;
};

/**
 * Authored most-specific-first within each region. Final match priority is
 * resolved by FAMILY_RULES_RANKED (priority desc, stable), not array order, so
 * adding/reordering rules cannot silently shadow a more specific family.
 */
const FAMILY_RULES: FamilyRule[] = [
  // ── Biceps (head-specific before generic curl) ──
  { id: 'biceps_long_head', test: /\b(incline|bayesian|drag|overhead)\b.*\bcurl|\bcurl\b.*\b(incline|bayesian|drag)\b/i, spec: { label: 'Long-head curl', targetGroups: ['biceps'], movementPatterns: ['flexion'], headEmphasis: 'long_head', variationAxis: 'angle' } },
  { id: 'biceps_short_head', test: /\b(preacher|spider|concentration|machine preacher)\b.*\bcurl|\bcurl\b.*\b(preacher|spider)\b/i, spec: { label: 'Short-head curl', targetGroups: ['biceps'], movementPatterns: ['flexion'], headEmphasis: 'short_head', variationAxis: 'angle' } },
  { id: 'biceps_hammer', test: /\b(hammer|cross body|cross-body|rope hammer|neutral grip curl)\b/i, spec: { label: 'Hammer / brachialis curl', targetGroups: ['biceps', 'forearms'], movementPatterns: ['flexion'], headEmphasis: 'brachialis', variationAxis: 'grip' } },
  { id: 'biceps_reverse', test: /\breverse\b.*\bcurl|\bcurl\b.*\breverse\b/i, spec: { label: 'Reverse curl', targetGroups: ['biceps', 'forearms'], movementPatterns: ['flexion'], headEmphasis: 'brachialis', variationAxis: 'grip' } },
  { id: 'forearm_wrist', test: /\bwrist curl\b/i, priority: 1, spec: { label: 'Wrist curl', targetGroups: ['forearms'], movementPatterns: ['flexion'], variationAxis: 'implement' } },
  { id: 'biceps_curl', test: /\b(curl|bicep|biceps)\b/i, spec: { label: 'Biceps curl', targetGroups: ['biceps'], movementPatterns: ['flexion'], headEmphasis: 'balanced', variationAxis: 'implement' } },

  // ── Triceps (head / angle specific before generic) ──
  { id: 'triceps_overhead', test: /\b(overhead triceps|overhead extension|skull crusher|french press|ez skull|lying triceps)\b/i, spec: { label: 'Overhead triceps', targetGroups: ['triceps'], movementPatterns: ['extension'], headEmphasis: 'overhead', variationAxis: 'angle' } },
  { id: 'triceps_pushdown', test: /\b(pushdown|pressdown|rope triceps|v bar triceps|triceps pushdown)\b/i, spec: { label: 'Triceps pushdown', targetGroups: ['triceps'], movementPatterns: ['extension'], headEmphasis: 'lateral_head', variationAxis: 'cable' } },
  { id: 'triceps_kickback', test: /\b(kickback)\b/i, spec: { label: 'Triceps kickback', targetGroups: ['triceps'], movementPatterns: ['extension'], headEmphasis: 'long_head', variationAxis: 'implement' } },
  { id: 'triceps_extension', test: /\b(triceps extensions?|tricep extensions?)\b/i, spec: { label: 'Triceps extension', targetGroups: ['triceps'], movementPatterns: ['extension'], headEmphasis: 'balanced', variationAxis: 'implement' } },
  { id: 'triceps_dip', test: /\b(dip|bench dip)\b/i, spec: { label: 'Dip', targetGroups: ['triceps', 'mid_chest', 'anterior_deltoid'], movementPatterns: ['vertical_push'], headEmphasis: 'balanced', variationAxis: 'implement' } },

  // ── Back / pull ──
  { id: 'vertical_pull', test: /\b(pull.?ups?|pullups?|chin.?ups?|chinups?|lat pulldown|pulldown)\b/i, spec: { label: 'Vertical pull', targetGroups: ['back_lats', 'biceps'], movementPatterns: ['vertical_pull'], variationAxis: 'grip' } },
  { id: 'upright_row', test: /\bupright row\b/i, spec: { label: 'Upright row', targetGroups: ['lateral_deltoid', 'upper_traps', 'biceps'], movementPatterns: ['vertical_pull'], variationAxis: 'implement' } },
  { id: 'horizontal_row', test: /\b(rows|row|pendlay|t bar|t-bar|seal row|chest supported row)\b/i, spec: { label: 'Horizontal row', targetGroups: ['back_lats', 'back_upper', 'biceps'], movementPatterns: ['horizontal_pull'], variationAxis: 'implement' } },
  { id: 'chest_pullover', test: /\bpullover\b/i, spec: { label: 'Pullover', targetGroups: ['back_lats', 'mid_chest'], movementPatterns: ['vertical_pull'], variationAxis: 'implement' } },
  { id: 'trap_shrug', test: /\bshrug\b/i, spec: { label: 'Shrug', targetGroups: ['upper_traps', 'mid_traps'], movementPatterns: ['elevation'], variationAxis: 'implement' } },
  { id: 'partial_deadlift', test: /\b(block pull|rack pull|pull.?through)\b/i, spec: { label: 'Partial deadlift', targetGroups: ['hamstrings', 'glutes', 'erector_spinae'], movementPatterns: ['hinge'], headEmphasis: 'hip_dominant', variationAxis: 'implement' } },
  { id: 'hamstring_hip_dominant', test: /\b(rdl|romanian|stiff leg|good morning|single leg rdl)\b/i, spec: { label: 'Hip-dominant hamstring', targetGroups: ['hamstrings', 'glutes', 'erector_spinae'], movementPatterns: ['hinge'], headEmphasis: 'hip_dominant', variationAxis: 'implement' } },
  { id: 'deadlift_hinge', test: /\b(deadlifts?|conventional deadlift|sumo deadlift)\b/i, spec: { label: 'Deadlift', targetGroups: ['hamstrings', 'glutes', 'erector_spinae'], movementPatterns: ['hinge'], headEmphasis: 'hip_dominant', variationAxis: 'implement' } },
  { id: 'back_extension', test: /\b(back extension|hyperextension|45.?degree back)\b/i, spec: { label: 'Back extension', targetGroups: ['erector_spinae', 'glutes', 'hamstrings'], movementPatterns: ['hinge'], variationAxis: 'machine' } },

  // ── Press / chest ──
  { id: 'decline_press', test: /\bdecline\b.*\b(press|bench)\b/i, spec: { label: 'Decline press', targetGroups: ['lower_chest', 'triceps', 'anterior_deltoid'], movementPatterns: ['horizontal_push'], variationAxis: 'angle' } },
  { id: 'incline_press', test: /\bincline\b.*\b(press|bench)\b/i, spec: { label: 'Incline press', targetGroups: ['upper_chest', 'anterior_deltoid', 'triceps'], movementPatterns: ['horizontal_push'], variationAxis: 'angle' } },
  { id: 'push_up', test: /\b(push.?ups?|pushups?)\b/i, spec: { label: 'Push-up', targetGroups: ['mid_chest', 'triceps', 'anterior_deltoid'], movementPatterns: ['horizontal_push'], variationAxis: 'implement' } },
  { id: 'machine_chest_press', test: /\b(machine chest press|cable chest press|smith bench|smith press)\b/i, spec: { label: 'Machine/cable chest press', targetGroups: ['mid_chest', 'triceps', 'anterior_deltoid'], movementPatterns: ['horizontal_push'], variationAxis: 'machine' } },
  { id: 'horizontal_press', test: /\b(bench press|bench\b|floor press|push up|pushup|dip machine chest|dumbbell press)\b/i, spec: { label: 'Horizontal press', targetGroups: ['mid_chest', 'triceps', 'anterior_deltoid'], movementPatterns: ['horizontal_push'], variationAxis: 'implement' } },
  { id: 'chest_fly', test: /\b(fly|flies|pec deck|crossover)\b/i, spec: { label: 'Chest fly', targetGroups: ['mid_chest', 'upper_chest'], movementPatterns: ['horizontal_push'], variationAxis: 'implement' } },
  { id: 'overhead_press', test: /\b(overhead|ohp|military|shoulder press|arnold|push press|landmine press|landmine)\b/i, spec: { label: 'Overhead press', targetGroups: ['anterior_deltoid', 'lateral_deltoid', 'triceps'], movementPatterns: ['vertical_push'], variationAxis: 'implement' } },

  // ── Legs ──
  { id: 'squat_pattern', test: /\b(squats?|leg press|hack squat|goblet squat|zercher|front squat|thruster)\b/i, spec: { label: 'Squat pattern', targetGroups: ['quadriceps', 'glutes'], movementPatterns: ['squat'], variationAxis: 'implement' } },
  { id: 'lunge_pattern', test: /\b(lunges?|split squat|bulgarian|step up|step-up)\b/i, priority: 1, spec: { label: 'Lunge pattern', targetGroups: ['quadriceps', 'glutes'], movementPatterns: ['lunge'], variationAxis: 'unilateral' } },
  { id: 'leg_curl', test: /\b(leg curls?|hamstring curls?|nordic|glute.?ham|lying leg curl|seated leg curl)\b/i, priority: 1, spec: { label: 'Knee flexion', targetGroups: ['hamstrings'], movementPatterns: ['flexion'], headEmphasis: 'knee_dominant', variationAxis: 'machine' } },
  { id: 'leg_extension', test: /\b(leg extensions?|quad extensions?)\b/i, spec: { label: 'Knee extension', targetGroups: ['quadriceps'], movementPatterns: ['extension'], variationAxis: 'machine' } },
  { id: 'hip_abduction', test: /\b(abduction|abductor)\b/i, spec: { label: 'Hip abduction', targetGroups: ['abductors', 'glutes'], movementPatterns: ['abduction'], variationAxis: 'machine' } },
  { id: 'hip_adduction', test: /\b(adduction|adductor)\b/i, spec: { label: 'Hip adduction', targetGroups: ['adductors'], movementPatterns: ['adduction'], variationAxis: 'machine' } },
  { id: 'hip_thrust', test: /\b(hip thrust|glute bridge|bridge)\b/i, spec: { label: 'Hip extension', targetGroups: ['glutes', 'hamstrings'], movementPatterns: ['hip_extension'], variationAxis: 'implement' } },
  { id: 'tibialis_raise', test: /\btibialis\b/i, spec: { label: 'Tibialis raise', targetGroups: ['calves'], movementPatterns: ['elevation'], variationAxis: 'implement' } },
  { id: 'calf_raise', test: /\b(calf raise|calves|soleus|gastroc)\b/i, spec: { label: 'Calf raise', targetGroups: ['calves'], movementPatterns: ['elevation'], variationAxis: 'implement' } },

  // ── Delts / isolation ──
  { id: 'rear_delt_face_pull', test: /\b(face pull|band pull apart|pull apart)\b/i, spec: { label: 'Face pull / ER', targetGroups: ['posterior_deltoid', 'rotator_cuff'], movementPatterns: ['horizontal_pull'], headEmphasis: 'external_rotation', variationAxis: 'cable' } },
  { id: 'rear_delt_fly', test: /\b(rear delt|reverse fly|reverse pec deck|bent over fly)\b/i, priority: 1, spec: { label: 'Rear delt fly', targetGroups: ['posterior_deltoid'], movementPatterns: ['horizontal_pull'], headEmphasis: 'horizontal_abduction', variationAxis: 'implement' } },
  { id: 'lateral_raise', test: /\b(lateral raises?|side raises?|y raise|leaning lateral)\b/i, spec: { label: 'Lateral raise', targetGroups: ['lateral_deltoid'], movementPatterns: ['abduction'], variationAxis: 'implement' } },
  { id: 'front_raise', test: /\b(front raise)\b/i, spec: { label: 'Front raise', targetGroups: ['anterior_deltoid'], movementPatterns: ['flexion'], variationAxis: 'implement' } },

  // ── Core / carry / olympic ──
  { id: 'core_rotation', test: /\b(russian twist|woodchop|bird dog|hollow body)\b/i, spec: { label: 'Core rotation', targetGroups: ['core'], movementPatterns: ['anti_rotation'], variationAxis: 'implement' } },
  { id: 'core_anti_extension', test: /\b(plank|dead bug|ab wheel|rollout|pallof)\b/i, spec: { label: 'Anti-extension core', targetGroups: ['core'], movementPatterns: ['anti_extension'], variationAxis: 'implement' } },
  { id: 'core_flexion', test: /\b(crunch|sit.?ups?|situps?|v up|leg raise|hanging)\b/i, spec: { label: 'Core flexion', targetGroups: ['core'], movementPatterns: ['flexion'], variationAxis: 'implement' } },
  { id: 'loaded_carry', test: /\b(farmer carry|sandbag carry|suitcase carry|\bcarry\b)\b/i, spec: { label: 'Loaded carry', targetGroups: ['forearms', 'upper_traps', 'core'], movementPatterns: ['carry'], variationAxis: 'implement' } },
  { id: 'olympic_hinge', test: /\b(clean|snatch|swing|sled push|sled pull|med ball slam|medicine ball)\b/i, spec: { label: 'Olympic / power hinge', targetGroups: ['hamstrings', 'glutes', 'quadriceps'], movementPatterns: ['hinge'], variationAxis: 'implement' } },
  { id: 'plyometric_cardio', test: /\b(burpees?|box jumps?|jumping jacks?|mountain climbers?|high knees?|jump rope|battle ropes?|hill sprints?)\b/i, spec: { label: 'Plyometric / conditioning', targetGroups: ['quadriceps', 'core'], movementPatterns: ['plyometric'], variationAxis: 'implement' } },

  // ── Recovery / cardio ──
  { id: 'recovery_mobility', test: /\b(yoga|stretch(?:ing)?|foam roll(?:ing)?|mobility|recovery|sauna|meditation|massage|breathwork|cold plunge|cold shower|hot tub|steam|contrast therapy|shadow boxing|heavy bag)\b/i, spec: { label: 'Recovery / mobility', targetGroups: [], movementPatterns: ['recovery'], variationAxis: 'implement' } },
  { id: 'cardio', test: /\b(running|run|walk|treadmill|bike|cycle|cycling|rower|rowing|elliptical|stairmaster|stair|cardio|jog|sprint|hiking|hik|swim|swimming|ski erg|basketball|soccer|outdoor)\b/i, spec: { label: 'Cardio', targetGroups: [], movementPatterns: ['cardio_steady_state'], variationAxis: 'implement' } },
];

const FAMILY_BY_ID = new Map<string, ExerciseFamilySpec>(
  FAMILY_RULES.map(r => [r.id, { id: r.id, ...r.spec }]),
);

// Resolution order = priority desc, ties broken by authoring order. Array.sort
// is stable (Node ≥11), so equal-priority rules keep their relative order and
// behaviour is identical to the old first-match scan everywhere except the
// explicitly-promoted rules. Iterating this ranked list with early-exit keeps
// matching as fast as before while making correctness order-independent.
const FAMILY_RULES_RANKED: FamilyRule[] = FAMILY_RULES
  .map((rule, idx) => ({ rule, idx }))
  .sort((a, b) => (b.rule.priority ?? 0) - (a.rule.priority ?? 0) || a.idx - b.idx)
  .map(({ rule }) => rule);

// ── Memoization caches ───────────────────────────────────────────────────
// matchFamily/exerciseFamilyKey scan ~50 regexes per call and are invoked
// many times per candidate during generation. These functions are pure and
// deterministic over a bounded input domain (the ~255-entry library plus a
// handful of user-typed names), so name-keyed memoization is exact and turns
// the linear regex scan into an amortized O(1) lookup. `null` is a real cached
// value ("no family matched"); `undefined` from Map.get means "not yet cached".
const _familyMatchCache = new Map<string, ExerciseFamilySpec | null>();
const _familyKeyCache = new Map<string, string>();
const _muscleTokenCache = new Map<string, CanonicalMuscleGroup | null>();
const _identityCache = new Map<string, ExerciseIdentityV2>();

/** Resolve any muscle token (anatomical head, alias, or canonical group) → canonical group. */
export function resolveMuscleToken(raw: string): CanonicalMuscleGroup | null {
  if (!raw) return null;
  const cached = _muscleTokenCache.get(raw);
  if (cached !== undefined) return cached;
  const fromCanonical = normalizeMuscleGroupName(raw);
  let result: CanonicalMuscleGroup | null;
  if (fromCanonical) {
    result = fromCanonical;
  } else {
    const normalized = String(raw).trim().toLowerCase().replace(/\s+/g, '_').replace(/-+/g, '_');
    result = MUSCLE_HEAD_TO_GROUP[normalized] ?? MUSCLE_HEAD_TO_GROUP[raw] ?? null;
  }
  _muscleTokenCache.set(raw, result);
  return result;
}

/** All canonical groups an exercise targets from library tags or map fallback. */
export function resolveExerciseCanonicalGroups(
  exerciseName: string,
  primaryMuscles?: string[] | null,
  secondaryMuscles?: string[] | null,
): { primary: CanonicalMuscleGroup[]; secondary: CanonicalMuscleGroup[] } {
  const mapping = getExerciseMapping(exerciseName);
  const primRaw = primaryMuscles ?? mapping?.primary_muscles ?? [];
  const secRaw = secondaryMuscles ?? mapping?.secondary_muscles ?? [];
  const primary = normalizeMuscleGroupListFromTokens(primRaw);
  const secondary = normalizeMuscleGroupListFromTokens(secRaw);
  return { primary, secondary };
}

function normalizeMuscleGroupListFromTokens(tokens: string[]): CanonicalMuscleGroup[] {
  const out: CanonicalMuscleGroup[] = [];
  const seen = new Set<CanonicalMuscleGroup>();
  for (const t of tokens) {
    const g = resolveMuscleToken(t);
    if (!g || seen.has(g)) continue;
    seen.add(g);
    out.push(g);
  }
  return out;
}

export function inferMuscleEmphasis(
  exerciseName: string,
  muscleGroup: string,
): MuscleEmphasis | null {
  const family = matchFamily(exerciseName);
  if (family?.headEmphasis) return family.headEmphasis;

  if (muscleGroup === 'biceps') return inferBicepsHeadEmphasis(exerciseName);
  if (muscleGroup === 'triceps') {
    const m = getExerciseMapping(exerciseName);
    const prim = m?.primary_muscles ?? [];
    if (prim.some(p => p.includes('triceps_long'))) return 'long_head';
    if (prim.some(p => p.includes('triceps_lateral'))) return 'lateral_head';
    return 'balanced';
  }
  if (muscleGroup === 'hamstrings') {
    const n = exerciseName.toLowerCase();
    if (/\b(curl|nordic|leg curl)\b/.test(n)) return 'knee_dominant';
    if (/\b(rdl|romanian|stiff|deadlift|good morning)\b/.test(n)) return 'hip_dominant';
    return 'balanced';
  }
  if (muscleGroup === 'posterior_deltoid') {
    if (/\bface pull|pull apart\b/i.test(exerciseName)) return 'external_rotation';
    if (/\breverse fly|rear delt\b/i.test(exerciseName)) return 'horizontal_abduction';
    return 'balanced';
  }
  return null;
}

export function inferBicepsHeadEmphasis(
  exerciseName: string,
  mapping?: ExerciseMapping | null,
): BicepsHeadEmphasis | null {
  const family = matchFamily(exerciseName);
  if (family?.headEmphasis && family.targetGroups.includes('biceps')) {
    return family.headEmphasis as BicepsHeadEmphasis;
  }

  const m = mapping ?? getExerciseMapping(exerciseName);
  if (!m) return null;

  const prim = m.primary_muscles ?? [];
  const hasLong = prim.some(p => p.includes('long_head'));
  const hasShort = prim.some(p => p.includes('short_head'));
  const hasBrach = prim.some(p => p === 'brachialis' || p.includes('brachialis'));
  if (hasLong && !hasShort) return 'long_head';
  if (hasShort && !hasLong) return 'short_head';
  if (hasBrach && !hasLong && !hasShort) return 'brachialis';
  if (hasLong && hasShort) return 'balanced';
  if (hasBrach) return 'brachialis';
  return null;
}

function matchFamily(exerciseName: string): ExerciseFamilySpec | null {
  const n = String(exerciseName || '').toLowerCase();
  const cached = _familyMatchCache.get(n);
  if (cached !== undefined) return cached;
  let result: ExerciseFamilySpec | null = null;
  for (const rule of FAMILY_RULES_RANKED) {
    if (rule.test.test(n)) {
      result = FAMILY_BY_ID.get(rule.id) ?? null;
      break;
    }
  }
  _familyMatchCache.set(n, result);
  return result;
}

/** Stable family key for staples, rotation, novelty — replaces raw lowercase names. */
export function exerciseFamilyKey(exerciseName: string): string {
  const n = String(exerciseName || '').trim().toLowerCase();
  const cached = _familyKeyCache.get(n);
  if (cached !== undefined) return cached;
  let key = '';
  for (const rule of FAMILY_RULES_RANKED) {
    if (rule.test.test(n)) {
      key = rule.id;
      break;
    }
  }
  if (!key) key = canonicalizeExerciseName(exerciseName) || n;
  _familyKeyCache.set(n, key);
  return key;
}

export function getExerciseFamily(exerciseName: string): ExerciseFamilySpec | null {
  return matchFamily(exerciseName) ?? null;
}

/** Diagnostic only: all family rules matching a name, in resolution order. */
export function __debugMatchingFamilyRules(
  exerciseName: string,
): { id: string; priority: number }[] {
  const n = String(exerciseName || '').toLowerCase();
  return FAMILY_RULES_RANKED
    .filter(rule => rule.test.test(n))
    .map(rule => ({ id: rule.id, priority: rule.priority ?? 0 }));
}

export function resolveExerciseIdentity(
  exerciseName: string,
  primaryMuscles?: string[] | null,
  secondaryMuscles?: string[] | null,
): ExerciseIdentityV2 {
  // Cache only the name-only resolution. When the caller supplies explicit
  // muscle overrides the result depends on those arrays, so it bypasses the
  // cache (correctness over speed). The hot generation path is name-only.
  const cacheable = primaryMuscles == null && secondaryMuscles == null;
  if (cacheable) {
    const hit = _identityCache.get(exerciseName);
    if (hit) return hit;
  }
  const mapping = getExerciseMapping(exerciseName);
  const { primary, secondary } = resolveExerciseCanonicalGroups(
    exerciseName,
    primaryMuscles,
    secondaryMuscles,
  );
  const family = matchFamily(exerciseName);
  const identity: ExerciseIdentityV2 = {
    originalName: exerciseName,
    familyKey: family?.id ?? exerciseFamilyKey(exerciseName),
    canonicalNameKey: canonicalizeExerciseName(exerciseName),
    primaryGroups: primary,
    secondaryGroups: secondary,
    movementPattern: (mapping?.movement_pattern ?? family?.movementPatterns[0] ?? null) as MovementPattern | null,
    exerciseType: mapping?.exercise_type ?? null,
    bicepsHeadEmphasis: primary.includes('biceps') || secondary.includes('biceps')
      ? inferBicepsHeadEmphasis(exerciseName, mapping)
      : null,
    muscleEmphasis: inferMuscleEmphasis(
      exerciseName,
      primary[0] ?? secondary[0] ?? '',
    ),
    mapping: mapping ?? null,
  };
  if (cacheable) _identityCache.set(exerciseName, identity);
  return identity;
}

/**
 * Eagerly resolve and cache identities for every library exercise so the first
 * generation pays no cold-cache penalty. Idempotent and safe to call repeatedly;
 * runs once per process in practice. Returns the number of entries warmed.
 */
let _ontologyWarmed = false;
export function prewarmOntologyCaches(): number {
  if (_ontologyWarmed) return _identityCache.size;
  for (const name of Object.keys(EXERCISE_MUSCLE_MAP)) {
    resolveExerciseIdentity(name);
  }
  _ontologyWarmed = true;
  return _identityCache.size;
}

/** Preference / history aggregation key — merges alias variants under one family. */
export function preferenceAggregationKey(exerciseName: string): string {
  return exerciseFamilyKey(exerciseName);
}

/** True when two exercise names resolve to the same ontology family. */
export function matchesExerciseFamily(storedName: string, candidateName: string): boolean {
  return preferenceAggregationKey(storedName) === preferenceAggregationKey(candidateName);
}

/** Find profile feature row keyed by family (progressions, rotation, acceptances, etc.). */
export function findByExerciseFamily<T extends { exerciseName: string }>(
  items: T[] | undefined | null,
  exerciseName: string,
): T | undefined {
  if (!items?.length) return undefined;
  const key = preferenceAggregationKey(exerciseName);
  return items.find(item => preferenceAggregationKey(item.exerciseName) === key);
}

/** Score 0–100: how suitable `to` is as a swap for `from` (same slot, different stimulus). */
export function substitutionCompatibilityScore(
  fromName: string,
  toName: string,
  targetGroup: string,
): number {
  if (fromName.toLowerCase() === toName.toLowerCase()) return 0;
  const from = resolveExerciseIdentity(fromName);
  const to = resolveExerciseIdentity(toName);
  const target = resolveMuscleToken(targetGroup) ?? targetGroup;

  if (!to.primaryGroups.includes(target as CanonicalMuscleGroup)
    && !to.secondaryGroups.includes(target as CanonicalMuscleGroup)) {
    return 0;
  }

  let score = 40;

  if (from.familyKey === to.familyKey) score += 15;

  if (from.movementPattern && to.movementPattern && from.movementPattern === to.movementPattern) {
    score += 20;
  }

  if (from.bicepsHeadEmphasis && to.bicepsHeadEmphasis) {
    if (from.bicepsHeadEmphasis !== to.bicepsHeadEmphasis) score += 18;
    else score += 5;
  }

  const fromEm = inferMuscleEmphasis(fromName, target as string);
  const toEm = inferMuscleEmphasis(toName, target as string);
  if (fromEm && toEm && fromEm !== toEm) score += 14;

  if (from.familyKey !== to.familyKey) score += 12;

  if (from.mapping?.exercise_type === to.mapping?.exercise_type) score += 8;

  return Math.min(100, score);
}

/** Bonus when selecting a second+ exercise in a group — prefer different family/emphasis. */
export function familyDiversityBonus(
  candidateName: string,
  alreadySelectedNames: string[],
  muscleGroup: string,
): number {
  if (alreadySelectedNames.length === 0) return 0;
  const candidateFamily = exerciseFamilyKey(candidateName);
  const selectedFamilies = new Set(alreadySelectedNames.map(exerciseFamilyKey));

  const ROTATION_GROUPS = new Set(['biceps', 'triceps', 'hamstrings', 'posterior_deltoid']);
  if (ROTATION_GROUPS.has(muscleGroup)) {
    const candEm = inferMuscleEmphasis(candidateName, muscleGroup);
    const usedEm = new Set(
      alreadySelectedNames.map(n => inferMuscleEmphasis(n, muscleGroup)).filter(Boolean),
    );
    if (candEm && !usedEm.has(candEm)) return 14;
    if (!selectedFamilies.has(candidateFamily)) return 10;
    return -6;
  }

  if (!selectedFamilies.has(candidateFamily)) return 8;
  return -6;
}

/** Normalize movement pattern aliases across analytics vs engine vocabularies. */
export function normalizeMovementPattern(raw: string | null | undefined): MovementPattern | null {
  if (!raw) return null;
  const k = String(raw).trim().toLowerCase();
  const ALIAS: Record<string, MovementPattern> = {
    hip_hinge: 'hinge',
    knee_dominant: 'squat',
    isolation_upper: 'flexion',
    isolation_lower: 'extension',
    horizontal_push: 'horizontal_push',
    horizontal_pull: 'horizontal_pull',
    vertical_push: 'vertical_push',
    vertical_pull: 'vertical_pull',
  };
  return ALIAS[k] ?? (k as MovementPattern);
}

export function listExerciseFamilies(): ExerciseFamilySpec[] {
  return [...FAMILY_BY_ID.values()];
}

export function countOntologyFamilies(): number {
  return FAMILY_RULES.length;
}

export function isOntologyFamilyKey(key: string): boolean {
  return FAMILY_BY_ID.has(key);
}

export function dominantCanonicalGroup(
  exerciseName: string,
  primaryMuscles?: string[] | null,
  secondaryMuscles?: string[] | null,
): CanonicalMuscleGroup | null {
  const { primary, secondary } = resolveExerciseCanonicalGroups(
    exerciseName,
    primaryMuscles,
    secondaryMuscles,
  );
  return primary[0] ?? secondary[0] ?? null;
}

/** Resolve muscle tokens from the exercise map (primary, secondary, stabilizers). */
export function resolveExerciseMuscleTokens(
  exerciseName: string,
  role: 'primary' | 'secondary' | 'stabilizer' | 'all' = 'all',
): CanonicalMuscleGroup[] {
  const mapping = getExerciseMapping(exerciseName);
  const primRaw = mapping?.primary_muscles ?? [];
  const secRaw = mapping?.secondary_muscles ?? [];
  const stabRaw = mapping?.stabilizer_muscles ?? [];

  if (role === 'primary') return normalizeMuscleGroupListFromTokens(primRaw);
  if (role === 'secondary') return normalizeMuscleGroupListFromTokens(secRaw);
  if (role === 'stabilizer') return normalizeMuscleGroupListFromTokens(stabRaw);

  return normalizeMuscleGroupListFromTokens([...primRaw, ...secRaw, ...stabRaw]);
}
