import { normalizeMuscleGroupName, type CanonicalMuscleGroup } from './volumeGuidelines';
import { MAX_MONTHLY_FITNESS_FOCUS_MUSCLES, parseFitnessMusclesFromRecord } from './monthlyFocus';

const CHEST_ALIASES: Record<string, string> = {
  chest: 'mid_chest',
  pecs: 'mid_chest',
  pec: 'mid_chest',
};

/** Map legacy priority muscle ids to canonical volume-model groups. */
export function normalizePriorityMuscles(raw: unknown): CanonicalMuscleGroup[] {
  if (!Array.isArray(raw)) return [];
  const out: CanonicalMuscleGroup[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || !item.trim()) continue;
    const key = item.trim().toLowerCase();
    const alias = CHEST_ALIASES[key];
    const canon = (alias ?? normalizeMuscleGroupName(key) ?? key) as CanonicalMuscleGroup;
    if (canon && !out.includes(canon)) out.push(canon);
  }
  return out.slice(0, 3);
}

export function normalizeMonthlyFocusStateForSave(raw: {
  month: string;
  fitness_muscles?: string[];
  fitness_muscle?: string | null;
  life_label?: string;
  life_completions?: Record<string, boolean>;
}): {
  month: string;
  fitness_muscles: string[];
  life_label: string;
  life_completions: Record<string, boolean>;
} {
  const muscles = raw.fitness_muscles?.length
    ? normalizePriorityMuscles(raw.fitness_muscles).slice(0, MAX_MONTHLY_FITNESS_FOCUS_MUSCLES)
    : parseFitnessMusclesFromRecord(raw as Record<string, unknown>);
  return {
    month: raw.month,
    fitness_muscles: muscles,
    life_label: String(raw.life_label ?? '').trim(),
    life_completions: raw.life_completions ?? {},
  };
}

const LEG_GROUPS = new Set(['quadriceps', 'hamstrings', 'glutes', 'hip_flexors', 'abductors', 'adductors']);

/** Warn when a schedule day label says "Legs" but groups are pull-dominant. */
export function validateWeeklySplitSchedule(
  schedule: Record<string, { focus?: string; groups?: string[] }> | null | undefined,
): string[] {
  const warnings: string[] = [];
  if (!schedule) return warnings;
  for (const [dow, entry] of Object.entries(schedule)) {
    const focus = String(entry?.focus ?? '').toLowerCase();
    const groups = Array.isArray(entry?.groups)
      ? entry.groups.map((g) => normalizeMuscleGroupName(g) ?? String(g).toLowerCase()).filter(Boolean)
      : [];
    if (!groups.length) continue;
    const legCount = groups.filter((g) => LEG_GROUPS.has(g)).length;
    const looksLikeLegDay = focus.includes('leg') || focus.includes('quad') || focus.includes('hamstring');
    if (looksLikeLegDay && legCount < 2) {
      warnings.push(`Day ${dow} (${entry?.focus}): label suggests legs but only ${legCount} leg groups scheduled — engine may mis-layer recovery.`);
    }
  }
  return warnings;
}
