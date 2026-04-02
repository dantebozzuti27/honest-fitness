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
  muscleGroup: CanonicalMuscleGroup;
  tier: 'primary' | 'secondary';
  mev: number;
  mavLow: number;
  mavHigh: number;
  mrv: number;
  recoveryHours: number;
  volumeProgressionRate: number;
  indirectVolumeCredit: number;
  notes: string;
}

export const CANONICAL_MUSCLE_GROUPS = [
  'upper_chest',
  'mid_chest',
  'lower_chest',
  'back_lats',
  'back_upper',
  'upper_traps',
  'mid_traps',
  'lower_traps',
  'anterior_deltoid',
  'lateral_deltoid',
  'posterior_deltoid',
  'biceps',
  'triceps',
  'quadriceps',
  'hamstrings',
  'glutes',
  'rotator_cuff',
  'hip_flexors',
  'abductors',
  'adductors',
  'calves',
  'core',
  'forearms',
  'erector_spinae',
] as const;

export type CanonicalMuscleGroup = typeof CANONICAL_MUSCLE_GROUPS[number];

/** Use when a field can be a real muscle group OR the synthetic 'cardio' category */
export type MuscleGroupOrCardio = CanonicalMuscleGroup | 'cardio';

export type ExerciseRole = 'primary' | 'secondary' | 'isolation' | 'corrective' | 'cardio';

export type ExerciseType = 'compound' | 'isolation' | 'isometric' | 'cardio' | 'recovery';

export type MovementPattern =
  | 'squat' | 'lunge' | 'hinge' | 'hip_extension'
  | 'horizontal_push' | 'horizontal_pull'
  | 'vertical_push' | 'vertical_pull'
  | 'extension' | 'flexion' | 'rotation'
  | 'abduction' | 'adduction' | 'elevation'
  | 'anti_extension' | 'anti_rotation' | 'anti_lateral_flexion'
  | 'carry' | 'loaded_carry' | 'plyometric'
  | 'cardio_steady_state' | 'cardio_intervals'
  | 'recovery';

export type ForceType = 'push' | 'pull' | 'static' | 'dynamic';

export type Difficulty = 'beginner' | 'intermediate' | 'advanced';

export type GoalKind = 'strength' | 'hypertrophy' | 'general_fitness' | 'fat_loss' | 'endurance';

export const MUSCLE_GROUP_ALIASES: Record<string, string> = {
  chest: 'mid_chest',
  pecs: 'mid_chest',
  quad: 'quadriceps',
  quads: 'quadriceps',
  hamstring: 'hamstrings',
  hams: 'hamstrings',
  lat: 'back_lats',
  lats: 'back_lats',
  upper_back: 'back_upper',
  upperback: 'back_upper',
  traps: 'upper_traps',
  trapezius: 'upper_traps',
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
  incline_chest: 'upper_chest',
  decline_chest: 'lower_chest',
  clavicular_chest: 'upper_chest',
  sternal_chest: 'mid_chest',
  rotator: 'rotator_cuff',
  hip_flexor: 'hip_flexors',
};

export const VOLUME_GUIDELINES: VolumeGuideline[] = [
  {
    muscleGroup: 'upper_chest',
    tier: 'primary',
    mev: 4, mavLow: 6, mavHigh: 10, mrv: 14,
    recoveryHours: 48,
    volumeProgressionRate: 1,
    indirectVolumeCredit: 0.5,
    notes: 'Pectoralis major clavicular head. Incline pressing primary stimulus. Receives indirect from flat pressing.',
  },
  {
    muscleGroup: 'mid_chest',
    tier: 'primary',
    mev: 4, mavLow: 6, mavHigh: 10, mrv: 14,
    recoveryHours: 48,
    volumeProgressionRate: 1,
    indirectVolumeCredit: 0.5,
    notes: 'Pectoralis major sternal head (flat). Flat pressing and fly movements primary stimulus.',
  },
  {
    muscleGroup: 'lower_chest',
    tier: 'primary',
    mev: 3, mavLow: 4, mavHigh: 8, mrv: 12,
    recoveryHours: 48,
    volumeProgressionRate: 1,
    indirectVolumeCredit: 0.5,
    notes: 'Pectoralis major sternal-lower fibers. Decline pressing and dips primary stimulus.',
  },
  {
    muscleGroup: 'back_lats',
    tier: 'primary',
    mev: 8, mavLow: 10, mavHigh: 18, mrv: 22,
    recoveryHours: 48,
    volumeProgressionRate: 1,
    indirectVolumeCredit: 0.5,
    notes: 'Latissimus dorsi, teres major. Vertical pulling (pulldowns, pull-ups) primary stimulus.',
  },
  {
    muscleGroup: 'back_upper',
    tier: 'secondary',
    mev: 4, mavLow: 6, mavHigh: 12, mrv: 16,
    recoveryHours: 48,
    volumeProgressionRate: 0.5,
    indirectVolumeCredit: 0.4,
    notes: 'Rhomboids, levator scapulae (scapular retractors). Horizontal rows primary stimulus.',
  },
  {
    muscleGroup: 'upper_traps',
    tier: 'secondary',
    mev: 2, mavLow: 4, mavHigh: 8, mrv: 12,
    recoveryHours: 36,
    volumeProgressionRate: 0.5,
    indirectVolumeCredit: 0.4,
    notes: 'Trapezius upper fibers. Shrugs, upright rows, and overhead pressing provide stimulus.',
  },
  {
    muscleGroup: 'mid_traps',
    tier: 'secondary',
    mev: 2, mavLow: 4, mavHigh: 8, mrv: 12,
    recoveryHours: 36,
    volumeProgressionRate: 0.5,
    indirectVolumeCredit: 0.4,
    notes: 'Trapezius middle fibers. Face pulls, horizontal rows, and rear delt flies provide stimulus.',
  },
  {
    muscleGroup: 'lower_traps',
    tier: 'secondary',
    mev: 2, mavLow: 3, mavHigh: 6, mrv: 10,
    recoveryHours: 36,
    volumeProgressionRate: 0.5,
    indirectVolumeCredit: 0.3,
    notes: 'Trapezius lower fibers. Overhead pressing, Y-raises, and face pulls provide stimulus.',
  },
  {
    muscleGroup: 'anterior_deltoid',
    tier: 'primary',
    mev: 0, mavLow: 0, mavHigh: 6, mrv: 12,
    recoveryHours: 48,
    volumeProgressionRate: 0.5,
    indirectVolumeCredit: 0.5,
    notes: 'Usually receives sufficient volume from compound pressing. Direct work rarely needed unless pressing volume is very low.',
  },
  {
    muscleGroup: 'lateral_deltoid',
    tier: 'primary',
    mev: 6, mavLow: 8, mavHigh: 16, mrv: 22,
    recoveryHours: 36,
    volumeProgressionRate: 1,
    indirectVolumeCredit: 0.3,
    notes: 'Requires direct isolation (lateral raises). Not adequately stimulated by pressing alone.',
  },
  {
    muscleGroup: 'posterior_deltoid',
    tier: 'primary',
    mev: 6, mavLow: 8, mavHigh: 16, mrv: 22,
    recoveryHours: 36,
    volumeProgressionRate: 1,
    indirectVolumeCredit: 0.4,
    notes: 'Reverse flies, face pulls. Partially stimulated by horizontal rows.',
  },
  {
    muscleGroup: 'biceps',
    tier: 'primary',
    mev: 4, mavLow: 8, mavHigh: 14, mrv: 20,
    recoveryHours: 36,
    volumeProgressionRate: 1,
    indirectVolumeCredit: 0.4,
    notes: 'Long and short heads. Receives indirect volume from all pulling movements. Curl variations target different heads via shoulder position.',
  },
  {
    muscleGroup: 'triceps',
    tier: 'primary',
    mev: 4, mavLow: 6, mavHigh: 12, mrv: 18,
    recoveryHours: 36,
    volumeProgressionRate: 1,
    indirectVolumeCredit: 0.6,
    notes: 'Lateral, long, and medial heads. Receives substantial indirect volume from all pressing. Overhead extensions uniquely target long head.',
  },
  {
    muscleGroup: 'quadriceps',
    tier: 'primary',
    mev: 6, mavLow: 8, mavHigh: 16, mrv: 20,
    recoveryHours: 72,
    volumeProgressionRate: 1,
    indirectVolumeCredit: 0.5,
    notes: 'Rectus femoris, vastus lateralis/medialis/intermedius. High systemic fatigue from compound movements. Longer recovery needed.',
  },
  {
    muscleGroup: 'hamstrings',
    tier: 'primary',
    mev: 4, mavLow: 6, mavHigh: 12, mrv: 16,
    recoveryHours: 72,
    volumeProgressionRate: 1,
    indirectVolumeCredit: 0.5,
    notes: 'Biceps femoris, semimembranosus, semitendinosus. Hip hinge vs knee flexion target different portions.',
  },
  {
    muscleGroup: 'glutes',
    tier: 'primary',
    mev: 0, mavLow: 4, mavHigh: 12, mrv: 16,
    recoveryHours: 72,
    volumeProgressionRate: 1,
    indirectVolumeCredit: 0.5,
    notes: 'Gluteus maximus. Heavy squats and deadlifts provide substantial indirect volume.',
  },
  {
    muscleGroup: 'rotator_cuff',
    tier: 'secondary',
    mev: 2, mavLow: 3, mavHigh: 6, mrv: 10,
    recoveryHours: 24,
    volumeProgressionRate: 0.5,
    indirectVolumeCredit: 0.3,
    notes: 'Infraspinatus, teres minor, supraspinatus. External rotation exercises and face pulls. Critical for shoulder health.',
  },
  {
    muscleGroup: 'hip_flexors',
    tier: 'secondary',
    mev: 0, mavLow: 2, mavHigh: 6, mrv: 10,
    recoveryHours: 36,
    volumeProgressionRate: 0.5,
    indirectVolumeCredit: 0.3,
    notes: 'Iliopsoas, rectus femoris (cross-joint), sartorius. Hanging leg raises and front squats provide stimulus.',
  },
  {
    muscleGroup: 'abductors',
    tier: 'secondary',
    mev: 4, mavLow: 6, mavHigh: 12, mrv: 16,
    recoveryHours: 48,
    volumeProgressionRate: 0.5,
    indirectVolumeCredit: 0.3,
    notes: 'Gluteus medius/minimus, tensor fasciae latae. Gait stability, frontal-plane control, knee valgus prevention.',
  },
  {
    muscleGroup: 'adductors',
    tier: 'secondary',
    mev: 4, mavLow: 6, mavHigh: 12, mrv: 16,
    recoveryHours: 48,
    volumeProgressionRate: 0.5,
    indirectVolumeCredit: 0.3,
    notes: 'Hip adductor complex. Frontal-plane force transfer, cutting mechanics, groin resilience.',
  },
  {
    muscleGroup: 'calves',
    tier: 'secondary',
    mev: 0, mavLow: 0, mavHigh: 0, mrv: 0,
    recoveryHours: 36,
    volumeProgressionRate: 0,
    indirectVolumeCredit: 0.2,
    notes: 'Indirect only — never prescribe direct calf work. Receives passive stimulus from squats, leg press, and walking.',
  },
  {
    muscleGroup: 'core',
    tier: 'secondary',
    mev: 0, mavLow: 4, mavHigh: 12, mrv: 16,
    recoveryHours: 24,
    volumeProgressionRate: 0.5,
    indirectVolumeCredit: 0.3,
    notes: 'Rectus abdominis, obliques, transverse abdominis. Compounds provide significant indirect stimulation. Very fast recovery.',
  },
  {
    muscleGroup: 'forearms',
    tier: 'secondary',
    mev: 0, mavLow: 2, mavHigh: 8, mrv: 14,
    recoveryHours: 24,
    volumeProgressionRate: 0.5,
    indirectVolumeCredit: 0.25,
    notes: 'Flexors and extensors. Grip-intensive exercises (deadlifts, rows, curls) provide substantial indirect work.',
  },
  {
    muscleGroup: 'erector_spinae',
    tier: 'secondary',
    mev: 0, mavLow: 2, mavHigh: 8, mrv: 12,
    recoveryHours: 72,
    volumeProgressionRate: 0.5,
    indirectVolumeCredit: 0.3,
    notes: 'Heavily loaded during squats and deadlifts. Direct work only needed if those compounds are absent.',
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
export const MUSCLE_HEAD_TO_GROUP: Record<string, CanonicalMuscleGroup> = {
  pectoralis_major_sternal: 'mid_chest',
  pectoralis_major_clavicular: 'upper_chest',
  pectoralis_minor: 'upper_chest',
  pectoralis_major_lower: 'lower_chest',
  serratus_anterior: 'mid_chest',

  latissimus_dorsi: 'back_lats',
  teres_major: 'back_lats',

  rhomboids: 'back_upper',
  levator_scapulae: 'back_upper',

  trapezius_upper: 'upper_traps',
  trapezius_middle: 'mid_traps',
  trapezius_lower: 'lower_traps',

  infraspinatus: 'rotator_cuff',
  teres_minor: 'rotator_cuff',
  supraspinatus: 'rotator_cuff',
  rotator_cuff: 'rotator_cuff',

  anterior_deltoid: 'anterior_deltoid',
  lateral_deltoid: 'lateral_deltoid',
  posterior_deltoid: 'posterior_deltoid',

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

  hip_flexors: 'hip_flexors',
  iliopsoas: 'hip_flexors',
  sartorius: 'hip_flexors',
  adductors: 'adductors',
  abductors: 'abductors',
  popliteus: 'hamstrings',
};

/**
 * Synergist fatigue mapping: when muscle group A is trained heavily,
 * how much residual fatigue does it impose on group B (0-1 scale)?
 *
 * Used by the recovery model to account for cross-session interference.
 */
export const SYNERGIST_FATIGUE: Partial<Record<CanonicalMuscleGroup, Partial<Record<CanonicalMuscleGroup, number>>>> = {
  upper_chest: { triceps: 0.4, anterior_deltoid: 0.5, mid_chest: 0.3 },
  mid_chest: { triceps: 0.4, anterior_deltoid: 0.5, upper_chest: 0.3, lower_chest: 0.3 },
  lower_chest: { triceps: 0.5, mid_chest: 0.3 },
  back_lats: { biceps: 0.35, forearms: 0.25, posterior_deltoid: 0.2, lower_traps: 0.15 },
  back_upper: { biceps: 0.3, mid_traps: 0.3, forearms: 0.2 },
  upper_traps: { mid_traps: 0.3, lateral_deltoid: 0.2 },
  mid_traps: { back_upper: 0.4, lower_traps: 0.3, posterior_deltoid: 0.2 },
  lower_traps: { mid_traps: 0.3, rotator_cuff: 0.2 },
  anterior_deltoid: { triceps: 0.3, upper_chest: 0.15, mid_chest: 0.15 },
  lateral_deltoid: { upper_traps: 0.15 },
  posterior_deltoid: { mid_traps: 0.15, rotator_cuff: 0.1 },
  biceps: { forearms: 0.3 },
  triceps: { mid_chest: 0.1, anterior_deltoid: 0.1 },
  quadriceps: { glutes: 0.4, core: 0.2, erector_spinae: 0.15, hip_flexors: 0.2 },
  hamstrings: { glutes: 0.35, erector_spinae: 0.3 },
  glutes: { hamstrings: 0.2, quadriceps: 0.15, abductors: 0.25, adductors: 0.1 },
  rotator_cuff: { posterior_deltoid: 0.2, lower_traps: 0.1 },
  hip_flexors: { quadriceps: 0.15, core: 0.1 },
  abductors: { glutes: 0.2, adductors: 0.2, core: 0.15 },
  adductors: { glutes: 0.15, abductors: 0.1, hamstrings: 0.1 },
  calves: {},
  core: {},
  forearms: {},
  erector_spinae: { hamstrings: 0.15, glutes: 0.1 },
};

export function getGuidelineForGroup(muscleGroup: CanonicalMuscleGroup): VolumeGuideline | undefined {
  return VOLUME_GUIDELINES.find(g => g.muscleGroup === muscleGroup);
}

export const PRIMARY_MUSCLE_GROUPS: CanonicalMuscleGroup[] = VOLUME_GUIDELINES
  .filter(g => g.tier === 'primary')
  .map(g => g.muscleGroup);

export const SECONDARY_MUSCLE_GROUPS: CanonicalMuscleGroup[] = VOLUME_GUIDELINES
  .filter(g => g.tier === 'secondary')
  .map(g => g.muscleGroup);
