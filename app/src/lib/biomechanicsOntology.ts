/**
 * Biomechanics ontology — implements shared/contracts/ontology.ts types at runtime.
 *
 * Derives mechanical coupling edges from SYNERGIST_FATIGUE and hip/cardio
 * load signals. Consumed by workoutEngine coupling + recovery prioritization.
 */

export type { CardioMechanicalLoadSignal } from '../../../shared/contracts/ontology';
import type {
  BiomechanicsOntologySnapshot,
  CardioMechanicalLoadSignal,
  HipActionClass,
  MechanicalCouplingEdge,
  MuscleFunctionalRole,
} from '../../../shared/contracts/ontology';
import type { TrainingProfile } from './trainingAnalysis';
import { MOVEMENT_PATTERN_MUSCLE_MAP } from './splitOntology';
import {
  SYNERGIST_FATIGUE,
  getGuidelineForGroup,
  type CanonicalMuscleGroup,
} from './volumeGuidelines';

export const BIOMECHANICS_ONTOLOGY_SCHEMA = '2026-05-28.4';
export const BIOMECHANICS_ONTOLOGY_VERSION = BIOMECHANICS_ONTOLOGY_SCHEMA;

/** Frontal-plane / trunk stability transfer (lower coupling weight than synergist fatigue). */
const STABILITY_TRANSFER: Partial<Record<CanonicalMuscleGroup, Partial<Record<CanonicalMuscleGroup, number>>>> = {
  glutes: { abductors: 0.35, adductors: 0.2, erector_spinae: 0.25 },
  abductors: { glutes: 0.3, adductors: 0.2 },
  core: { erector_spinae: 0.3, hip_flexors: 0.15 },
  erector_spinae: { glutes: 0.2, hamstrings: 0.15 },
  rotator_cuff: { posterior_deltoid: 0.25, lower_traps: 0.15 },
};

const HIP_ROLE_SPECS: MuscleFunctionalRole[] = [
  {
    muscle_group: 'abductors',
    prime_actions: ['abduction_external_rotation'],
    stabilizer_actions: ['extension'],
    interactions: ['gluteus_medius', 'TFL', 'frontal_plane_gait'],
  },
  {
    muscle_group: 'adductors',
    prime_actions: ['adduction_internal_rotation'],
    stabilizer_actions: ['flexion'],
    interactions: ['adductor_magnus', 'groin_stability'],
  },
  {
    muscle_group: 'glutes',
    prime_actions: ['extension', 'abduction_external_rotation'],
    stabilizer_actions: ['abduction_external_rotation'],
    interactions: ['gluteus_maximus', 'hip_extension'],
  },
  {
    muscle_group: 'hip_flexors',
    prime_actions: ['flexion'],
    stabilizer_actions: ['flexion'],
    interactions: ['iliopsoas', 'sitting_posture'],
  },
];

/** Co-occurrence edges from shared movement patterns in split ontology. */
export function buildMovementPatternOverlapEdges(): MechanicalCouplingEdge[] {
  const groupPatterns = new Map<CanonicalMuscleGroup, Set<string>>();
  for (const [pattern, groups] of Object.entries(MOVEMENT_PATTERN_MUSCLE_MAP)) {
    for (const group of groups) {
      if (!groupPatterns.has(group)) groupPatterns.set(group, new Set());
      groupPatterns.get(group)!.add(pattern);
    }
  }

  const edges: MechanicalCouplingEdge[] = [];
  const groups = [...groupPatterns.keys()].sort();
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const source = groups[i];
      const target = groups[j];
      const sourcePatterns = groupPatterns.get(source)!;
      const targetPatterns = groupPatterns.get(target)!;
      const shared: string[] = [];
      for (const pattern of sourcePatterns) {
        if (targetPatterns.has(pattern)) shared.push(pattern);
      }
      if (shared.length === 0) continue;

      const weight = Math.min(
        1,
        shared.length / Math.max(sourcePatterns.size, targetPatterns.size, 1),
      );
      edges.push({
        source_group: source,
        target_group: target,
        coupling_kind: 'movement_pattern_overlap',
        weight: Math.round(weight * 100) / 100,
        rationale: `${source} and ${target} co-occur in ${shared.length} movement pattern(s): ${shared.sort().join(', ')}`,
      });
    }
  }
  return edges;
}

/** Build coupling edges from volume-guidelines synergist fatigue table. */
export function buildMechanicalCouplingEdges(): MechanicalCouplingEdge[] {
  const edges: MechanicalCouplingEdge[] = [];
  for (const [source, targets] of Object.entries(SYNERGIST_FATIGUE)) {
    if (!targets) continue;
    for (const [target, weight] of Object.entries(targets)) {
      if (weight == null || weight <= 0) continue;
      edges.push({
        source_group: source as CanonicalMuscleGroup,
        target_group: target as CanonicalMuscleGroup,
        coupling_kind: 'synergist_fatigue',
        weight,
        rationale: `${source} training imposes ${Math.round(weight * 100)}% residual fatigue on ${target}`,
      });
    }
  }
  for (const [source, targets] of Object.entries(STABILITY_TRANSFER)) {
    if (!targets) continue;
    for (const [target, weight] of Object.entries(targets)) {
      if (weight == null || weight <= 0) continue;
      edges.push({
        source_group: source as CanonicalMuscleGroup,
        target_group: target as CanonicalMuscleGroup,
        coupling_kind: 'stability_transfer',
        weight,
        rationale: `${source} stability load transfers ${Math.round(weight * 100)}% demand to ${target}`,
      });
    }
  }
  edges.push(...buildMovementPatternOverlapEdges());
  return edges;
}

export function buildBiomechanicsOntologySnapshot(
  updatedAt: string = new Date().toISOString(),
): BiomechanicsOntologySnapshot {
  return {
    schema_version: BIOMECHANICS_ONTOLOGY_SCHEMA,
    updated_at: updatedAt,
    hip_roles: HIP_ROLE_SPECS,
  };
}

export type HipAbductorLoadSignal = {
  weeklyAmbulatoryHours: number;
  externalHipLoadScore: number;
  internalHipLoadScore: number;
  abductorPriorityBoost: number;
  adductorPriorityBoost: number;
  adductorPriorityPenalty: number;
  adaptiveSuppression: number;
  suppressDirectIsolation: boolean;
  shouldFrontLoadAbductors: boolean;
  cardioMechanical: CardioMechanicalLoadSignal;
};

export type CouplingSignal = {
  priorityDelta: number;
  reasons: string[];
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

type CardioModality = 'walk' | 'run' | 'stair' | 'bike' | 'row' | 'elliptical' | 'other';

function classifyCardioModality(nameLC: string): CardioModality {
  // `stair` covers stairmaster / stair master / stair climber / stairclimber / stairs;
  // `step ?mill` + `stepper` catch the remaining vertical-stepping machines. Checked
  // first because these dominate frontal-plane + plantarflexion hip/calf load.
  if (/stair|stepmill|step ?mill|stepper/.test(nameLC)) return 'stair';
  if (/bike|cycle|spin/.test(nameLC)) return 'bike';
  if (/row/.test(nameLC)) return 'row';
  if (/elliptical|cross ?trainer/.test(nameLC)) return 'elliptical';
  if (/run|jog|sprint/.test(nameLC)) return 'run';
  if (/walk|treadmill|incline|hike|ruck/.test(nameLC)) return 'walk';
  return 'other';
}

/** Cardio → frontal/sagittal hip load (implements CardioMechanicalLoadSignal). */
export function buildCardioMechanicalLoadSignal(profile: TrainingProfile): CardioMechanicalLoadSignal {
  const WEEKS = 4;
  const cardio = profile.cardioHistory ?? [];
  let walkHours = 0;
  let inclineHours = 0;
  let stairHours = 0;
  let runHours = 0;

  for (const c of cardio) {
    const m = classifyCardioModality(String(c.exerciseName || '').toLowerCase());
    const hrs = (((c.avgDurationSeconds ?? 0) / 60) * ((c.recentSessions ?? 0) / WEEKS)) / 60;
    if (m === 'walk') {
      walkHours += hrs;
      const incline = Number(c.avgIncline ?? 0);
      if (incline > 0) inclineHours += hrs * (1 + Math.min(0.8, incline / 12));
    } else if (m === 'stair') {
      stairHours += hrs;
    } else if (m === 'run') {
      runHours += hrs;
    }
  }

  const frontal = clamp(walkHours * 0.4 + inclineHours * 0.55 + stairHours * 0.7, 0, 3);
  const sagittal = clamp(walkHours * 0.25 + runHours * 0.5 + stairHours * 0.35, 0, 3);
  const plantarflexion = clamp(runHours * 0.65 + stairHours * 0.55 + walkHours * 0.12, 0, 3);
  const hipFlexor = clamp(runHours * 0.5 + stairHours * 0.6 + inclineHours * 0.3, 0, 3);

  let source: CardioMechanicalLoadSignal['source'] = 'mixed';
  if (stairHours >= walkHours && stairHours >= runHours) source = 'stairs';
  else if (inclineHours > walkHours * 0.5) source = 'incline_walking';
  else if (walkHours >= runHours) source = 'walking';
  else if (runHours > 0) source = 'running';

  return {
    source,
    frontal_plane_stability_load: Math.round(frontal * 100) / 100,
    sagittal_plane_load: Math.round(sagittal * 100) / 100,
    external_rotation_bias: Math.round((inclineHours * 0.3 + stairHours * 0.2) * 100) / 100,
    internal_rotation_bias: Math.round(walkHours * 0.08 * 100) / 100,
    plantarflexion_load: Math.round(plantarflexion * 100) / 100,
    hip_flexor_demand: Math.round(hipFlexor * 100) / 100,
  };
}

/** Hip abductor/adductor priority from ambulatory + direct-volume saturation. */
export function computeHipAbductorLoadSignal(profile: TrainingProfile): HipAbductorLoadSignal {
  const WEEKS = 4;
  const cardio = profile.cardioHistory ?? [];
  const cardioMech = buildCardioMechanicalLoadSignal(profile);

  const ambulatory = cardio.filter(c => {
    const m = classifyCardioModality(String(c.exerciseName || '').toLowerCase());
    return m === 'walk' || m === 'stair';
  });
  const weeklyAmbulatoryHours = ambulatory.reduce((sum, c) => {
    const weeklyMinutes = ((c.avgDurationSeconds ?? 0) / 60) * ((c.recentSessions ?? 0) / WEEKS);
    return sum + (weeklyMinutes / 60);
  }, 0);

  const externalHipLoadScore = clamp(
    cardioMech.frontal_plane_stability_load * 0.85 + cardioMech.sagittal_plane_load * 0.35,
    0,
    3,
  );
  const internalHipLoadScore = clamp(
    cardioMech.internal_rotation_bias * 2 + Math.max(0, weeklyAmbulatoryHours - 2) * 0.08,
    0,
    2.2,
  );
  const hipLoadImbalance = Math.max(0, externalHipLoadScore - internalHipLoadScore);

  const volumeByGroup = new Map(
    (profile.muscleVolumeStatuses ?? []).map(v => [String(v.muscleGroup || '').toLowerCase(), Number(v.weeklyDirectSets || 0)]),
  );
  const freqByGroup = profile.muscleGroupFrequency ?? {};
  const abductorDirect = Math.max(0, Number(volumeByGroup.get('abductors') ?? 0));
  const adductorDirect = Math.max(0, Number(volumeByGroup.get('adductors') ?? 0));
  const hipDirectExposure = abductorDirect + adductorDirect;
  const hipFreq = Math.max(0, Number(freqByGroup.abductors ?? 0)) + Math.max(0, Number(freqByGroup.adductors ?? 0));
  const targetDirectBand = 8;
  const volumeSaturation = clamp((hipDirectExposure - targetDirectBand) / Math.max(targetDirectBand, 1), 0, 1.25);
  const freqSaturation = clamp((hipFreq - 2.1) / 1.6, 0, 1.2);
  const adaptiveSuppression = clamp(1 - (volumeSaturation * 0.55) - (freqSaturation * 0.45), 0.25, 1);

  const abductorPriorityBoost = clamp(
    (externalHipLoadScore >= 0.35 ? 0.06 + externalHipLoadScore * 0.12 : 0) * adaptiveSuppression,
    0,
    0.46,
  );
  const adductorPriorityBoost = clamp(
    (internalHipLoadScore >= 0.55 ? 0.05 + internalHipLoadScore * 0.08 : 0) * adaptiveSuppression,
    0,
    0.22,
  );
  const adductorPriorityPenalty = clamp(
    (hipLoadImbalance >= 0.6 ? hipLoadImbalance * 0.08 : 0)
    + (adaptiveSuppression < 0.7 ? (0.7 - adaptiveSuppression) * 0.12 : 0),
    0,
    0.24,
  );

  return {
    weeklyAmbulatoryHours,
    externalHipLoadScore,
    internalHipLoadScore,
    abductorPriorityBoost,
    adductorPriorityBoost,
    adductorPriorityPenalty,
    adaptiveSuppression,
    suppressDirectIsolation: hipDirectExposure >= (targetDirectBand * 1.25) || hipFreq >= 3.1,
    shouldFrontLoadAbductors: externalHipLoadScore >= 0.9 && adaptiveSuppression >= 0.7,
    cardioMechanical: cardioMech,
  };
}

/**
 * Apply biomechanics ontology → per-group coupling priority deltas.
 * Replaces inline hip + pattern fatigue logic with contract-backed edges.
 */
export function computeCouplingSignalsFromOntology(
  profile: TrainingProfile,
  hipSignal: HipAbductorLoadSignal,
  edges: MechanicalCouplingEdge[] = buildMechanicalCouplingEdges(),
): Record<string, CouplingSignal> {
  const byGroup: Record<string, CouplingSignal> = {};
  const add = (group: string, delta: number, reason: string) => {
    if (!byGroup[group]) byGroup[group] = { priorityDelta: 0, reasons: [] };
    byGroup[group].priorityDelta += delta;
    if (!byGroup[group].reasons.includes(reason)) byGroup[group].reasons.push(reason);
  };

  if (hipSignal.abductorPriorityBoost > 0) {
    add('abductors', hipSignal.abductorPriorityBoost, `external-hip demand ${hipSignal.externalHipLoadScore.toFixed(2)}`);
  }
  if (hipSignal.adductorPriorityBoost > 0) {
    add('adductors', hipSignal.adductorPriorityBoost, `internal-hip demand ${hipSignal.internalHipLoadScore.toFixed(2)}`);
  }
  if (hipSignal.adductorPriorityPenalty > 0) {
    add('adductors', -hipSignal.adductorPriorityPenalty, 'external/internal hip imbalance');
  }
  if (hipSignal.adaptiveSuppression < 0.95) {
    const suppressionPenalty = clamp((1 - hipSignal.adaptiveSuppression) * 0.18, 0.01, 0.14);
    add('abductors', -suppressionPenalty, `hip direct-dose saturation (${hipSignal.adaptiveSuppression.toFixed(2)})`);
    add('adductors', -suppressionPenalty, `hip direct-dose saturation (${hipSignal.adaptiveSuppression.toFixed(2)})`);
  }

  const patternFatigueByKey = new Map(
    (profile.movementPatternFatigue ?? []).map(p => [String(p.pattern || '').toLowerCase(), p]),
  );

  // Synergist fatigue + stability transfer edges: if source group trained recently, nudge target down slightly.
  for (const edge of edges) {
    if (edge.coupling_kind !== 'synergist_fatigue' && edge.coupling_kind !== 'stability_transfer') continue;
    const srcVol = profile.muscleVolumeStatuses?.find(
      v => v.muscleGroup === edge.source_group,
    );
    const daysSince = srcVol?.daysSinceLastTrained ?? 999;
    const couplingScale = edge.coupling_kind === 'stability_transfer' ? 0.06 : 0.08;
    if (daysSince <= 2 && edge.weight >= 0.25) {
      add(
        edge.target_group,
        -edge.weight * couplingScale,
        `${edge.coupling_kind === 'stability_transfer' ? 'stability transfer' : 'synergist fatigue'} from ${edge.source_group} (${Math.round(edge.weight * 100)}%)`,
      );
    }
  }

  // Movement pattern overlap: shared-pattern fatigue nudges co-occurring groups down.
  for (const edge of edges) {
    if (edge.coupling_kind !== 'movement_pattern_overlap') continue;
    const sharedPatterns = Object.entries(MOVEMENT_PATTERN_MUSCLE_MAP)
      .filter(([, groups]) => groups.includes(edge.source_group) && groups.includes(edge.target_group))
      .map(([pattern]) => pattern);
    for (const pattern of sharedPatterns) {
      const fatigue = patternFatigueByKey.get(pattern.toLowerCase());
      if (!fatigue) continue;
      if (fatigue.fatigueLevel === 'high') {
        const delta = -edge.weight * 0.12;
        add(edge.source_group, delta, `${pattern} pattern overlap fatigue (high)`);
        add(edge.target_group, delta, `${pattern} pattern overlap fatigue (high)`);
      } else if (fatigue.fatigueLevel === 'moderate') {
        const delta = -edge.weight * 0.06;
        add(edge.source_group, delta, `${pattern} pattern overlap fatigue (moderate)`);
        add(edge.target_group, delta, `${pattern} pattern overlap fatigue (moderate)`);
      }
    }
  }

  return byGroup;
}

const CARDIO_RECOVERY_GROUPS: CanonicalMuscleGroup[] = [
  'abductors', 'adductors', 'glutes', 'calves', 'hip_flexors',
];

/** Map cardio mechanical signal → per-group load scores (0–3 scale). */
export function cardioMechanicalLoadByGroup(
  signal: CardioMechanicalLoadSignal,
): Partial<Record<CanonicalMuscleGroup, number>> {
  const plantarflexion = signal.plantarflexion_load ?? 0;
  const hipFlexor = signal.hip_flexor_demand ?? 0;
  return {
    abductors: signal.frontal_plane_stability_load,
    adductors: clamp(signal.internal_rotation_bias * 2 + signal.frontal_plane_stability_load * 0.25, 0, 3),
    glutes: clamp(signal.sagittal_plane_load * 0.85 + signal.frontal_plane_stability_load * 0.2, 0, 3),
    calves: plantarflexion,
    hip_flexors: hipFlexor,
  };
}

/** Virtual fatigue hours from recent cardio mechanical load on lower-body stabilizers. */
export function computeCardioRecoveryPenalty(
  targetGroup: CanonicalMuscleGroup,
  cardioSignal: CardioMechanicalLoadSignal,
): number {
  if (!CARDIO_RECOVERY_GROUPS.includes(targetGroup)) return 0;
  const load = cardioMechanicalLoadByGroup(cardioSignal)[targetGroup] ?? 0;
  if (load <= 0) return 0;
  const recoveryHours = getGuidelineForGroup(targetGroup)?.recoveryHours ?? 36;
  return Math.round(load * recoveryHours * 0.22 * 100) / 100;
}

export function listHipActionClasses(): HipActionClass[] {
  return ['abduction_external_rotation', 'adduction_internal_rotation', 'extension', 'flexion'];
}
