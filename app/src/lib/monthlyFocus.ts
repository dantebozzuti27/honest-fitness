import { normalizeMuscleGroupList, normalizeMuscleGroupName } from './volumeGuidelines'
import { getLocalDate, parseLocalDate } from '../utils/dateUtils'

/** Versioned monthly focuses persisted in `user_preferences.monthly_focus_state`. */
export interface MonthlyFocusStateV1 {
  month: string
  fitness_muscle: string | null
  life_label: string
  life_completions: Record<string, boolean>
}

export function currentMonthKey(d: Date = new Date()): string {
  return getLocalDate(d).slice(0, 7)
}

export function parseMonthlyFocusState(raw: unknown): MonthlyFocusStateV1 | null {
  if (raw == null) return null
  const obj = typeof raw === 'string' ? safeJson(raw) : raw
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
  const rec = obj as Record<string, unknown>
  const month = typeof rec.month === 'string' && /^\d{4}-\d{2}$/.test(rec.month) ? rec.month : null
  if (!month) return null
  const fitness = rec.fitness_muscle
  const fitness_muscle =
    fitness === null || fitness === undefined || fitness === ''
      ? null
      : typeof fitness === 'string'
        ? fitness
        : null
  const life_label = typeof rec.life_label === 'string' ? rec.life_label : ''
  const lc = rec.life_completions
  const life_completions: Record<string, boolean> = {}
  if (lc && typeof lc === 'object' && !Array.isArray(lc)) {
    for (const [k, v] of Object.entries(lc as Record<string, unknown>)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(k) && v === true) life_completions[k] = true
    }
  }
  return { month, fitness_muscle, life_label, life_completions }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s) as unknown
  } catch {
    return null
  }
}

export function defaultMonthlyFocusState(monthKey: string): MonthlyFocusStateV1 {
  return {
    month: monthKey,
    fitness_muscle: null,
    life_label: '',
    life_completions: {},
  }
}

export function displayMonthlyFocusState(
  raw: unknown,
  monthKey: string,
): MonthlyFocusStateV1 {
  const parsed = parseMonthlyFocusState(raw)
  if (parsed && parsed.month === monthKey) {
    return {
      ...defaultMonthlyFocusState(monthKey),
      ...parsed,
      life_completions: { ...parsed.life_completions },
    }
  }
  return defaultMonthlyFocusState(monthKey)
}

/** Canonical muscle id for engine when `month` matches the plan date's YYYY-MM. */
export function activeMonthlyFitnessMuscleForDate(
  state: MonthlyFocusStateV1 | null | undefined,
  planDateStr: string,
): string | null {
  const ym = planDateStr.slice(0, 7)
  if (!state || state.month !== ym || !state.fitness_muscle) return null
  return normalizeMuscleGroupName(state.fitness_muscle) ?? String(state.fitness_muscle).toLowerCase()
}

/**
 * Pretty label for a canonical muscle group id (`mid_chest` → `Mid Chest`,
 * `back_lats` → `Lats`, etc.). Used by surfaces outside Profile (Home,
 * TodayWorkout) so we don't fork the label table.
 *
 * Unknown ids fall back to a snake_case → Title Case conversion so we never
 * render an empty string when the user picks something the table doesn't
 * cover yet.
 */
const MUSCLE_DISPLAY_LABELS: Record<string, string> = {
  upper_chest: 'Upper Chest',
  mid_chest: 'Mid Chest',
  lower_chest: 'Lower Chest',
  back_lats: 'Lats',
  back_upper: 'Upper Back',
  upper_traps: 'Upper Traps',
  mid_traps: 'Mid Traps',
  lower_traps: 'Lower Traps',
  anterior_deltoid: 'Front Delt',
  lateral_deltoid: 'Side Delt',
  posterior_deltoid: 'Rear Delt',
  biceps: 'Biceps',
  triceps: 'Triceps',
  quadriceps: 'Quads',
  hamstrings: 'Hamstrings',
  glutes: 'Glutes',
  rotator_cuff: 'Rotator Cuff',
  hip_flexors: 'Hip Flexors',
  abductors: 'Hip Abductors',
  adductors: 'Hip Adductors',
  core: 'Core',
  forearms: 'Forearms',
  erector_spinae: 'Erectors',
  calves: 'Calves',
}

export function muscleGroupDisplayLabel(canonicalId: string | null | undefined): string {
  if (!canonicalId) return ''
  const key = String(canonicalId).trim().toLowerCase()
  if (!key) return ''
  if (MUSCLE_DISPLAY_LABELS[key]) return MUSCLE_DISPLAY_LABELS[key]
  return key
    .split('_')
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ')
}

/**
 * When tomorrow's scheduled split already includes the monthly focus muscle,
 * treat today as a "split guard" day — still allow layering, but cap stimulus
 * (see workout engine prescribe step) so heavy work lands on the dedicated day.
 */
export function computeMonthlyFocusSplitGuard(
  weeklySplitSchedule: Record<string, { groups?: string[] }> | null | undefined,
  restDays: number[] | null | undefined,
  planDateStr: string,
  muscle: string | null,
): boolean {
  if (!muscle || !weeklySplitSchedule) return false
  const norm = normalizeMuscleGroupName(muscle)
  if (!norm) return false
  const d = parseLocalDate(planDateStr)
  d.setDate(d.getDate() + 1)
  const tomorrowDow = d.getDay()
  const rest = new Set(restDays ?? [])
  if (rest.has(tomorrowDow)) return false
  const entry = weeklySplitSchedule[String(tomorrowDow)]
  const groups = Array.isArray(entry?.groups) ? normalizeMuscleGroupList(entry.groups) : []
  return groups.includes(norm)
}
