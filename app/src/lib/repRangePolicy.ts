/**
 * Apollo rep-range policy — goal-aware tables + weekly frequency cycling.
 *
 * Bulk (hypertrophy) must not inherit cut/strength cycling defaults (4–6 primary,
 * 12–20 isolation on every accessory).
 */

import { DEFAULT_MODEL_CONFIG, type ModelConfig } from './modelConfig';
import type { ExerciseRole } from './volumeGuidelines';

export type ApolloPhase = 'bulk' | 'cut' | 'maintain';

export type RepRange = { min: number; max: number; target: number };

function rangeTuple(range: readonly [number, number]): RepRange {
  return { min: range[0], max: range[1], target: Math.round((range[0] + range[1]) / 2) };
}

/** Which intensity tier to use for this session given goal + weekly muscle frequency. */
export function resolveDayOccurrenceIndex(
  goal: ApolloPhase,
  avgWeeklyFrequency: number,
): 0 | 1 {
  if (goal === 'bulk') {
    // Hypertrophy: moderate reps by default; heavy anchors only when 2+/wk supports it.
    return avgWeeklyFrequency >= 2.0 ? 0 : 1;
  }
  // Cut/maintain: low frequency → heavier per-session stimulus.
  return avgWeeklyFrequency >= 1.5 ? 1 : 0;
}

function isolationRangeForGoal(
  goal: ApolloPhase,
  repRangeTable: ModelConfig['repRangeTable'],
  cfg: ModelConfig,
): RepRange {
  if (goal === 'cut') {
    return rangeTuple(cfg.metabolicRepRange);
  }
  const fromTable = repRangeTable[goal]?.isolation ?? repRangeTable.maintain.isolation;
  return { min: fromTable.min, max: fromTable.max, target: fromTable.target };
}

function cycledCompoundRange(
  goal: ApolloPhase,
  roleKey: 'primary' | 'secondary',
  isHeavyDay: boolean,
  cfg: ModelConfig,
): RepRange {
  // Building phase is hypertrophy-first — no strength-biased heavy cycling.
  if (goal === 'bulk') {
    if (roleKey === 'primary') {
      return rangeTuple(cfg.bulkModerateRepRange);
    }
    return rangeTuple(cfg.bulkModerateSecondaryRepRange);
  }

  if (roleKey === 'primary') {
    return rangeTuple(isHeavyDay ? cfg.heavyRepRange : cfg.moderateRepRange);
  }

  // Cut / maintain secondaries
  const secondaryHeavy: [number, number] = goal === 'cut' ? [6, 8] : [8, 10];
  const secondaryModerate: [number, number] = [10, 15];
  return rangeTuple(isHeavyDay ? secondaryHeavy : secondaryModerate);
}

export function getRepRangeByRole(
  role: ExerciseRole,
  primaryGoal: ApolloPhase,
  secondaryGoal: string | null,
  dayOccurrenceIndex: number | undefined,
  cfg: ModelConfig = DEFAULT_MODEL_CONFIG,
  exerciseType?: string | null,
  repRangeTable: ModelConfig['repRangeTable'] = cfg.repRangeTable,
): RepRange {
  const roleKey = role === 'corrective' ? 'isolation' : role === 'cardio' ? 'isolation' : role;
  const goal = primaryGoal === 'bulk' || primaryGoal === 'cut' || primaryGoal === 'maintain'
    ? primaryGoal
    : 'maintain';

  if (dayOccurrenceIndex !== undefined && roleKey !== 'isolation') {
    const isHeavyDay = dayOccurrenceIndex === 0;
    if (roleKey === 'primary' || roleKey === 'secondary') {
      return cycledCompoundRange(goal, roleKey, isHeavyDay, cfg);
    }
  }

  if (roleKey === 'isolation') {
    return isolationRangeForGoal(goal, repRangeTable, cfg);
  }

  const primary = repRangeTable[goal]?.[roleKey] ?? repRangeTable.maintain[roleKey];
  let result: RepRange;
  if (!secondaryGoal || secondaryGoal === goal) {
    result = primary;
  } else {
    const secondary = repRangeTable[secondaryGoal]?.[roleKey] ?? primary;
    result = {
      min: Math.round(primary.min * 0.7 + secondary.min * 0.3),
      max: Math.round(primary.max * 0.7 + secondary.max * 0.3),
      target: Math.round(primary.target * 0.7 + secondary.target * 0.3),
    };
  }

  const isCompound = exerciseType === 'compound';
  if (isCompound && roleKey === 'primary') {
    result = {
      min: result.min,
      max: Math.min(result.max, cfg.maxCompoundRepsPrimary),
      target: Math.min(result.target, cfg.maxCompoundRepsPrimary),
    };
  } else if (isCompound && roleKey === 'secondary') {
    result = {
      min: result.min,
      max: Math.min(result.max, cfg.maxCompoundRepsSecondary),
      target: Math.min(result.target, cfg.maxCompoundRepsSecondary),
    };
  }

  return result;
}

/** Match stepPrescribe floor logic for time-expansion / fill paths. */
export function resolveTargetRepsForRole(
  role: ExerciseRole,
  goal: ApolloPhase,
  secondaryGoal: string | null,
  dayOccurrenceIndex: number | undefined,
  cfg: ModelConfig,
  exerciseType: string | null | undefined,
  learnedReps: number | null | undefined,
  hasLearnedData: boolean,
): number {
  const tableRange = getRepRangeByRole(
    role,
    goal,
    secondaryGoal,
    dayOccurrenceIndex,
    cfg,
    exerciseType,
  );
  const learnedRounded = hasLearnedData && learnedReps != null
    ? Math.round(learnedReps)
    : null;
  const target = learnedRounded != null
    ? Math.max(tableRange.target, Math.min(tableRange.max, learnedRounded))
    : tableRange.target;
  return humanizeRepTarget(target, tableRange.min, tableRange.max);
}

export function humanizeRepTarget(value: number, min: number, max: number): number {
  const allowed = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 20, 25].filter(v => v >= min && v <= max);
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
