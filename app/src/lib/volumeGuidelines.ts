/**
 * Evidence-based volume guidelines per muscle group.
 *
 * MEV  = Minimum Effective Volume (sets/week) -- below this, no meaningful growth stimulus
 * MAV  = Maximum Adaptive Volume (sets/week)  -- the "sweet spot" range producing best gains
 * MRV  = Maximum Recoverable Volume (sets/week) -- beyond this, recovery cannot keep up
 *
 * Sources:
 *   Schoenfeld et al. (2017) "Dose-response relationship between weekly resistance
 *     training volume and increases in muscle mass" — J Sports Sci 35(11):1073-1082
 *   Krieger (2010) "Single vs. multiple sets of resistance exercise for muscle
 *     hypertrophy: A meta-analysis" — J Strength Cond Res 24(4):1150-1159
 *   Helms, Morgan & Valdez — The Muscle & Strength Pyramids (2nd ed.)
 *   Nuckols (2017) — Stronger By Science volume recommendations
 *   Ralston et al. (2017) "The effect of weekly set volume on strength gain"
 *     — Sports Med 47(12):2585-2601
 *
 * These are population-level starting points. The individual MRV detector
 * (trainingAnalysis.ts) overrides them with user-specific values once enough data exists.
 */

export interface VolumeGuideline {
  muscleGroup: string;
  mev: number;
  mavLow: number;
  mavHigh: number;
  mrv: number;
  recoveryHours: number;
  notes: string;
}

export const CANONICAL_MUSCLE_GROUPS = [
  'chest',
  'back_lats',
  'back_upper',
  'anterior_deltoid',
  'lateral_deltoid',
  'posterior_deltoid',
  'biceps',
  'triceps',
  'quadriceps',
  'hamstrings',
  'glutes',
  'abductors',
  'adductors',
  'calves',
  'core',
  'forearms',
  'erector_spinae',
] as const;

export type CanonicalMuscleGroup = typeof CANONICAL_MUSCLE_GROUPS[number];

export const MUSCLE_GROUP_ALIASES: Record<string, string> = {
  quad: 'quadriceps',
  quads: 'quadriceps',
  hamstring: 'hamstrings',
  hams: 'hamstrings',
  lat: 'back_lats',
  lats: 'back_lats',
  upper_back: 'back_upper',
  upperback: 'back_upper',
  rear_delts: 'posterior_deltoid',
  rear_delt: 'posterior_deltoid',
  side_delts: 'lateral_deltoid',
  side_delt: 'lateral_deltoid',
  front_delts: 'anterior_deltoid',
  front_delt: 'anterior_deltoid',
  abs: 'core',
  abdominals: 'core',
  spinal_erectors: 'erector_spinae',
  lower_back: 'erector_spinae',
  hip_abductors: 'abductors',
  hip_adductors: 'adductors',
  adductor: 'adductors',
  abductor: 'abductors',
  glute: 'glutes',
};

export const VOLUME_GUIDELINES: VolumeGuideline[] = [
  {
    muscleGroup: 'chest',
    mev: 8,
    mavLow: 10,
    mavHigh: 18,
    mrv: 22,
    recoveryHours: 48,
    notes: 'Includes pectoralis_major_sternal, pectoralis_major_clavicular, pectoralis_minor. Compound pressing contributes to anterior deltoid and triceps volume.',
  },
  {
    muscleGroup: 'back_lats',
    mev: 8,
    mavLow: 10,
    mavHigh: 18,
    mrv: 22,
    recoveryHours: 48,
    notes: 'Latissimus dorsi, teres major. Vertical pulling (pulldowns, pull-ups) primary stimulus.',
  },
  {
    muscleGroup: 'back_upper',
    mev: 6,
    mavLow: 8,
    mavHigh: 16,
    mrv: 20,
    recoveryHours: 48,
    notes: 'Trapezius (upper/mid/lower), rhomboids. Horizontal rows and face pulls primary stimulus.',
  },
  {
    muscleGroup: 'anterior_deltoid',
    mev: 0,
    mavLow: 0,
    mavHigh: 6,
    mrv: 12,
    recoveryHours: 48,
    notes: 'Usually receives sufficient volume from compound pressing. Direct work rarely needed unless pressing volume is very low.',
  },
  {
    muscleGroup: 'lateral_deltoid',
    mev: 6,
    mavLow: 8,
    mavHigh: 16,
    mrv: 22,
    recoveryHours: 36,
    notes: 'Requires direct isolation (lateral raises). Not adequately stimulated by pressing alone.',
  },
  {
    muscleGroup: 'posterior_deltoid',
    mev: 6,
    mavLow: 8,
    mavHigh: 16,
    mrv: 22,
    recoveryHours: 36,
    notes: 'Reverse flies, face pulls. Partially stimulated by horizontal rows.',
  },
  {
    muscleGroup: 'biceps',
    mev: 4,
    mavLow: 8,
    mavHigh: 14,
    mrv: 20,
    recoveryHours: 36,
    notes: 'Biceps_brachii_long_head and short_head. Receives indirect volume from all pulling movements. Curl variations target different heads via shoulder position.',
  },
  {
    muscleGroup: 'triceps',
    mev: 4,
    mavLow: 6,
    mavHigh: 12,
    mrv: 18,
    recoveryHours: 36,
    notes: 'Lateral, long, and medial heads. Receives indirect volume from all pressing. Overhead extensions uniquely target long head.',
  },
  {
    muscleGroup: 'quadriceps',
    mev: 6,
    mavLow: 8,
    mavHigh: 16,
    mrv: 20,
    recoveryHours: 72,
    notes: 'Rectus femoris, vastus lateralis/medialis/intermedius. High systemic fatigue from compound movements (squats, leg press). Longer recovery needed.',
  },
  {
    muscleGroup: 'hamstrings',
    mev: 4,
    mavLow: 6,
    mavHigh: 12,
    mrv: 16,
    recoveryHours: 72,
    notes: 'Biceps femoris, semimembranosus, semitendinosus. Hip hinge movements vs knee flexion target different portions.',
  },
  {
    muscleGroup: 'glutes',
    mev: 0,
    mavLow: 4,
    mavHigh: 12,
    mrv: 16,
    recoveryHours: 72,
    notes: 'Gluteus maximus, medius, minimus. Heavy squats and deadlifts provide substantial indirect volume.',
  },
  {
    muscleGroup: 'abductors',
    mev: 4,
    mavLow: 6,
    mavHigh: 12,
    mrv: 16,
    recoveryHours: 48,
    notes: 'Hip abductors (gluteus medius/minimus, tensor fasciae latae). High relevance for gait, frontal-plane stability, and knee valgus control under ambulatory/cardio load.',
  },
  {
    muscleGroup: 'adductors',
    mev: 4,
    mavLow: 6,
    mavHigh: 12,
    mrv: 16,
    recoveryHours: 48,
    notes: 'Hip adductor complex. Important for frontal-plane force transfer, cutting mechanics, and groin resilience. Distinct from glute-driven abduction demands.',
  },
  {
    muscleGroup: 'calves',
    mev: 6,
    mavLow: 8,
    mavHigh: 14,
    mrv: 20,
    recoveryHours: 36,
    notes: 'Gastrocnemius (medial/lateral heads) and soleus. High fatigue resistance — can tolerate higher frequencies.',
  },
  {
    muscleGroup: 'core',
    mev: 0,
    mavLow: 4,
    mavHigh: 12,
    mrv: 16,
    recoveryHours: 24,
    notes: 'Rectus abdominis, obliques (internal/external), transverse abdominis. Compounds provide significant indirect stimulation. Very fast recovery.',
  },
  {
    muscleGroup: 'forearms',
    mev: 0,
    mavLow: 2,
    mavHigh: 8,
    mrv: 14,
    recoveryHours: 24,
    notes: 'Flexors and extensors. Grip-intensive exercises (deadlifts, rows, curls) provide substantial indirect work.',
  },
  {
    muscleGroup: 'erector_spinae',
    mev: 0,
    mavLow: 2,
    mavHigh: 8,
    mrv: 12,
    recoveryHours: 72,
    notes: 'Heavily loaded during squats and deadlifts. Direct work (back extensions, good mornings) only needed if those compounds are absent.',
  },
];

const CANONICAL_GROUP_SET = new Set<string>(CANONICAL_MUSCLE_GROUPS);

export function normalizeMuscleGroupName(value: unknown): CanonicalMuscleGroup | null {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return null;
  if (CANONICAL_GROUP_SET.has(raw)) return raw as CanonicalMuscleGroup;
  const normalizedSeparators = raw.replace(/\s+/g, '_').replace(/-+/g, '_');
  if (CANONICAL_GROUP_SET.has(normalizedSeparators)) return normalizedSeparators as CanonicalMuscleGroup;
  const alias = MUSCLE_GROUP_ALIASES[normalizedSeparators];
  if (alias && CANONICAL_GROUP_SET.has(alias)) return alias as CanonicalMuscleGroup;
  return null;
}

export function normalizeMuscleGroupList(values: unknown[]): CanonicalMuscleGroup[] {
  const out: CanonicalMuscleGroup[] = [];
  const seen = new Set<CanonicalMuscleGroup>();
  for (const v of values ?? []) {
    const g = normalizeMuscleGroupName(v);
    if (!g || seen.has(g)) continue;
    seen.add(g);
    out.push(g);
  }
  return out;
}

/**
 * Maps individual muscle heads (from MusclesWorked 63-muscle taxonomy)
 * to the higher-level muscle groups used for volume tracking.
 */
export const MUSCLE_HEAD_TO_GROUP: Record<string, string> = {
  pectoralis_major_sternal: 'chest',
  pectoralis_major_clavicular: 'chest',
  pectoralis_minor: 'chest',
  serratus_anterior: 'chest',

  latissimus_dorsi: 'back_lats',
  teres_major: 'back_lats',
  teres_minor: 'back_upper',
  trapezius_upper: 'back_upper',
  trapezius_middle: 'back_upper',
  trapezius_lower: 'back_upper',
  rhomboids: 'back_upper',
  infraspinatus: 'back_upper',

  anterior_deltoid: 'anterior_deltoid',
  lateral_deltoid: 'lateral_deltoid',
  posterior_deltoid: 'posterior_deltoid',
  supraspinatus: 'lateral_deltoid',
  rotator_cuff: 'posterior_deltoid',

  biceps_brachii_long_head: 'biceps',
  biceps_brachii_short_head: 'biceps',
  brachialis: 'biceps',
  brachioradialis: 'forearms',

  triceps_lateral_head: 'triceps',
  triceps_long_head: 'triceps',
  triceps_medial_head: 'triceps',
  anconeus: 'triceps',

  rectus_femoris: 'quadriceps',
  vastus_lateralis: 'quadriceps',
  vastus_medialis: 'quadriceps',
  vastus_intermedius: 'quadriceps',

  biceps_femoris: 'hamstrings',
  semimembranosus: 'hamstrings',
  semitendinosus: 'hamstrings',

  gluteus_maximus: 'glutes',
  gluteus_medius: 'abductors',
  gluteus_minimus: 'abductors',
  tensor_fasciae_latae: 'abductors',

  gastrocnemius_medial: 'calves',
  gastrocnemius_lateral: 'calves',
  soleus: 'calves',
  tibialis_anterior: 'calves',

  rectus_abdominis: 'core',
  obliques_external: 'core',
  obliques_internal: 'core',
  transverse_abdominis: 'core',

  erector_spinae: 'erector_spinae',
  multifidus: 'erector_spinae',

  wrist_flexors: 'forearms',
  wrist_extensors: 'forearms',
  pronator_teres: 'forearms',
  supinator: 'forearms',

  hip_flexors: 'quadriceps',
  iliopsoas: 'quadriceps',
  sartorius: 'quadriceps',
  adductors: 'adductors',
  abductors: 'abductors',
  popliteus: 'hamstrings',
  levator_scapulae: 'back_upper',
};

/**
 * Synergist fatigue mapping: when muscle group A is trained heavily,
 * how much residual fatigue does it impose on group B (0-1 scale)?
 *
 * Used by the recovery model to account for cross-session interference.
 * E.g., heavy bench press (chest) partially fatigues triceps (0.4) and anterior delts (0.5).
 */
export const SYNERGIST_FATIGUE: Record<string, Record<string, number>> = {
  chest: { triceps: 0.4, anterior_deltoid: 0.5 },
  back_lats: { biceps: 0.35, forearms: 0.25, posterior_deltoid: 0.2 },
  back_upper: { biceps: 0.3, posterior_deltoid: 0.35, forearms: 0.2 },
  anterior_deltoid: { triceps: 0.3, chest: 0.15 },
  lateral_deltoid: {},
  posterior_deltoid: { back_upper: 0.1 },
  biceps: { forearms: 0.3 },
  triceps: { chest: 0.1, anterior_deltoid: 0.1 },
  quadriceps: { glutes: 0.4, core: 0.2, erector_spinae: 0.15 },
  hamstrings: { glutes: 0.35, erector_spinae: 0.3 },
  glutes: { hamstrings: 0.2, quadriceps: 0.15, abductors: 0.25, adductors: 0.1 },
  abductors: { glutes: 0.2, adductors: 0.2, core: 0.15 },
  adductors: { glutes: 0.15, abductors: 0.1, hamstrings: 0.1 },
  calves: {},
  core: {},
  forearms: {},
  erector_spinae: { hamstrings: 0.15, glutes: 0.1 },
};

export function getGuidelineForGroup(muscleGroup: string): VolumeGuideline | undefined {
  return VOLUME_GUIDELINES.find(g => g.muscleGroup === muscleGroup);
}

