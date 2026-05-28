/**
 * Split, theme, and synergist ontology — single source for day scheduling.
 *
 * Consolidates SPLIT_MUSCLE_MAPPING, BRO_SPLIT_MAPPING, SPLIT_SYNERGISTS,
 * SPLIT_TYPE_ROTATIONS, UNIVERSAL_ACCESSORIES, and THEME_LABEL_FAMILY_SYNONYMS
 * that previously lived in workoutEngine.ts and workoutTheme.ts.
 */

import type { CanonicalMuscleGroup } from './volumeGuidelines';
import { normalizeMuscleGroupList } from './volumeGuidelines';

export const SPLIT_ONTOLOGY_SCHEMA = '2026-05-28.1';

export const SPLIT_MUSCLE_MAPPING: Record<string, CanonicalMuscleGroup[]> = {
  push: ['upper_chest', 'mid_chest', 'lower_chest', 'anterior_deltoid', 'lateral_deltoid', 'triceps'],
  pull: ['back_lats', 'back_upper', 'upper_traps', 'mid_traps', 'lower_traps', 'biceps', 'posterior_deltoid', 'forearms', 'rotator_cuff'],
  legs: ['quadriceps', 'hamstrings', 'glutes', 'hip_flexors', 'abductors', 'adductors'],
  upper: ['upper_chest', 'mid_chest', 'lower_chest', 'back_lats', 'anterior_deltoid', 'biceps', 'triceps'],
  lower: ['quadriceps', 'hamstrings', 'glutes', 'hip_flexors', 'abductors', 'adductors'],
  full: ['mid_chest', 'back_lats', 'quadriceps', 'hamstrings', 'glutes', 'lateral_deltoid'],
};

export const SPLIT_TYPE_ROTATIONS: Record<string, string[]> = {
  push_pull_legs: ['push', 'pull', 'legs'],
  upper_lower: ['upper', 'lower'],
  full_body: ['full'],
  bro_split: ['chest', 'back', 'shoulders', 'arms', 'legs'],
};

export const BRO_SPLIT_MAPPING: Record<string, CanonicalMuscleGroup[]> = {
  chest: ['upper_chest', 'mid_chest', 'lower_chest'],
  back: ['back_lats', 'back_upper', 'upper_traps', 'mid_traps', 'lower_traps'],
  shoulders: ['anterior_deltoid', 'lateral_deltoid', 'posterior_deltoid'],
  arms: ['biceps', 'triceps', 'forearms'],
  legs: ['quadriceps', 'hamstrings', 'glutes', 'hip_flexors', 'abductors', 'adductors'],
};

export const SPLIT_SYNERGISTS: Record<string, string[]> = {
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

export const UNIVERSAL_ACCESSORIES: readonly string[] = ['core', 'calves', 'cardio'];

/** Movement-pattern → muscle groups for fatigue coupling (unified vocabulary). */
export const MOVEMENT_PATTERN_MUSCLE_MAP: Record<string, CanonicalMuscleGroup[]> = {
  horizontal_push: ['mid_chest', 'upper_chest', 'lower_chest', 'anterior_deltoid', 'triceps'],
  vertical_push: ['anterior_deltoid', 'lateral_deltoid', 'triceps'],
  horizontal_pull: ['back_upper', 'back_lats', 'mid_traps', 'posterior_deltoid', 'biceps', 'forearms'],
  vertical_pull: ['back_lats', 'back_upper', 'biceps', 'forearms', 'lower_traps'],
  hinge: ['hamstrings', 'glutes', 'erector_spinae'],
  hip_hinge: ['hamstrings', 'glutes', 'erector_spinae'],
  squat: ['quadriceps', 'glutes', 'adductors', 'hip_flexors'],
  knee_dominant: ['quadriceps', 'glutes', 'adductors', 'hip_flexors'],
  flexion: ['biceps', 'triceps', 'lateral_deltoid', 'posterior_deltoid', 'forearms', 'rotator_cuff'],
  isolation_upper: ['biceps', 'triceps', 'lateral_deltoid', 'posterior_deltoid', 'forearms', 'rotator_cuff'],
  extension: ['abductors', 'adductors', 'quadriceps', 'hamstrings', 'hip_flexors'],
  isolation_lower: ['abductors', 'adductors', 'quadriceps', 'hamstrings', 'hip_flexors'],
  anti_rotation: ['core', 'erector_spinae', 'abductors'],
  rotation: ['core', 'abductors', 'adductors'],
};

export const THEME_LABEL_FAMILY_SYNONYMS: ReadonlyMap<string, readonly string[]> = new Map([
  ['chest', ['mid_chest', 'upper_chest', 'lower_chest']],
  ['shoulders', ['anterior_deltoid', 'lateral_deltoid', 'posterior_deltoid']],
  ['delts', ['lateral_deltoid', 'anterior_deltoid', 'posterior_deltoid']],
  ['rear delts', ['posterior_deltoid']],
  ['back', ['back_lats', 'back_upper']],
  ['lats', ['back_lats']],
  ['traps', ['upper_traps', 'mid_traps', 'lower_traps']],
  ['legs', ['quadriceps', 'hamstrings', 'glutes']],
  ['quads', ['quadriceps']],
  ['hams', ['hamstrings']],
  ['arms', ['biceps', 'triceps']],
  ['biceps', ['biceps']],
  ['triceps', ['triceps']],
  ['push', ['mid_chest', 'anterior_deltoid', 'triceps']],
  ['pull', ['back_lats', 'biceps', 'posterior_deltoid']],
  ['upper', ['mid_chest', 'back_lats']],
  ['lower', ['quadriceps', 'glutes']],
]);

export const PRIMARY_MAJOR_GROUPS = new Set<CanonicalMuscleGroup>([
  'upper_chest', 'mid_chest', 'lower_chest', 'back_lats', 'quadriceps', 'hamstrings', 'glutes',
  'anterior_deltoid', 'lateral_deltoid', 'posterior_deltoid', 'biceps', 'triceps',
]);

export const ACCESSORY_MINOR_GROUPS = new Set<CanonicalMuscleGroup>([
  'forearms', 'abductors', 'adductors', 'core', 'erector_spinae', 'rotator_cuff', 'hip_flexors',
  'upper_traps', 'mid_traps', 'lower_traps', 'back_upper',
]);

export const PUSH_DAY_GROUPS = new Set<CanonicalMuscleGroup>(SPLIT_MUSCLE_MAPPING.push);
export const PULL_DAY_GROUPS = new Set<CanonicalMuscleGroup>(SPLIT_MUSCLE_MAPPING.pull);
export const LEG_DAY_GROUPS = new Set<CanonicalMuscleGroup>(SPLIT_MUSCLE_MAPPING.legs);

export type SessionSplitClass = 'push' | 'pull' | 'legs' | 'upper' | 'lower' | 'full' | 'mixed';

export function classifySessionMuscleGroups(groups: Iterable<string>): SessionSplitClass {
  const set = new Set(groups);
  const count = (slot: keyof typeof SPLIT_MUSCLE_MAPPING) =>
    SPLIT_MUSCLE_MAPPING[slot].filter(g => set.has(g)).length;
  const push = count('push'), pull = count('pull'), legs = count('legs');
  const upper = count('upper'), lower = count('lower'), full = count('full');
  if (push >= 2 && push >= pull && push >= legs) return 'push';
  if (pull >= 2 && pull >= push && pull >= legs) return 'pull';
  if (legs >= 2 && legs >= push && legs >= pull) return 'legs';
  if (upper >= 3) return 'upper';
  if (lower >= 3) return 'lower';
  if (full >= 3) return 'full';
  return 'mixed';
}

/** Resolve split slot name → canonical muscle groups. */
export function muscleGroupsForSplitSlot(splitName: string): CanonicalMuscleGroup[] {
  const key = String(splitName || '').trim().toLowerCase();
  return normalizeMuscleGroupList(
    BRO_SPLIT_MAPPING[key] ?? SPLIT_MUSCLE_MAPPING[key] ?? [],
  );
}

/** Expand primaries with synergists + universal accessories. */
export function expandWithSynergists(primaries: ReadonlySet<string> | string[]): Set<string> {
  const out = new Set<string>(
    typeof (primaries as Set<string>).has === 'function'
      ? Array.from(primaries as Set<string>)
      : (primaries as string[]),
  );
  for (const g of out) {
    for (const syn of (SPLIT_SYNERGISTS[g] ?? [])) out.add(syn);
  }
  for (const ua of UNIVERSAL_ACCESSORIES) out.add(ua);
  return out;
}

/** Groups impacted by a movement-pattern fatigue signal. */
export function muscleGroupsForMovementPattern(pattern: string): CanonicalMuscleGroup[] {
  const key = String(pattern || '').trim().toLowerCase();
  return MOVEMENT_PATTERN_MUSCLE_MAP[key] ?? [];
}

export function buildSplitOntologySnapshot(
  updatedAt: string = new Date().toISOString(),
): {
  schema_version: string;
  updated_at: string;
  split_slots: Record<string, CanonicalMuscleGroup[]>;
} {
  return {
    schema_version: SPLIT_ONTOLOGY_SCHEMA,
    updated_at: updatedAt,
    split_slots: { ...SPLIT_MUSCLE_MAPPING, ...BRO_SPLIT_MAPPING },
  };
}
