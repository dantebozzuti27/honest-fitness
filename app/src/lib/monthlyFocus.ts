import { normalizeMuscleGroupList, normalizeMuscleGroupName } from './volumeGuidelines'
import { getLocalDate, parseLocalDate } from '../utils/dateUtils'

/** Versioned monthly focuses persisted in `user_preferences.monthly_focus_state`. */
export interface MonthlyFocusStateV1 {
  month: string
  /** Canonical muscle group ids emphasized this month (multi-select). */
  fitness_muscles: string[]
  life_label: string
  life_completions: Record<string, boolean>
}

export const MAX_MONTHLY_FITNESS_FOCUS_MUSCLES = 3

export function currentMonthKey(d: Date = new Date()): string {
  return getLocalDate(d).slice(0, 7)
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s) as unknown
  } catch {
    return null
  }
}

/** Parse legacy `fitness_muscle` (string) or `fitness_muscles` (array) into canonical ids. */
export function parseFitnessMusclesFromRecord(rec: Record<string, unknown>): string[] {
  const rawArr = rec.fitness_muscles
  if (Array.isArray(rawArr)) {
    const out: string[] = []
    for (const item of rawArr) {
      if (typeof item !== 'string' || !item.trim()) continue
      const canon = normalizeMuscleGroupName(item) ?? item.trim().toLowerCase()
      if (canon && !out.includes(canon)) out.push(canon)
    }
    return out.slice(0, MAX_MONTHLY_FITNESS_FOCUS_MUSCLES)
  }
  const legacy = rec.fitness_muscle
  if (legacy === null || legacy === undefined || legacy === '') return []
  if (typeof legacy === 'string') {
    const canon = normalizeMuscleGroupName(legacy) ?? legacy.trim().toLowerCase()
    return canon ? [canon] : []
  }
  return []
}

export function parseMonthlyFocusState(raw: unknown): MonthlyFocusStateV1 | null {
  if (raw == null) return null
  const obj = typeof raw === 'string' ? safeJson(raw) : raw
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
  const rec = obj as Record<string, unknown>
  const month = typeof rec.month === 'string' && /^\d{4}-\d{2}$/.test(rec.month) ? rec.month : null
  if (!month) return null
  const fitness_muscles = parseFitnessMusclesFromRecord(rec)
  const life_label = typeof rec.life_label === 'string' ? rec.life_label : ''
  const lc = rec.life_completions
  const life_completions: Record<string, boolean> = {}
  if (lc && typeof lc === 'object' && !Array.isArray(lc)) {
    for (const [k, v] of Object.entries(lc as Record<string, unknown>)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(k) && v === true) life_completions[k] = true
    }
  }
  return { month, fitness_muscles, life_label, life_completions }
}

export function defaultMonthlyFocusState(monthKey: string): MonthlyFocusStateV1 {
  return {
    month: monthKey,
    fitness_muscles: [],
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
      fitness_muscles: [...parsed.fitness_muscles],
      life_completions: { ...parsed.life_completions },
    }
  }
  return defaultMonthlyFocusState(monthKey)
}

/** Active focus muscles for the plan date's calendar month (canonical ids). */
export function activeMonthlyFitnessMusclesForDate(
  state: MonthlyFocusStateV1 | null | undefined,
  planDateStr: string,
): string[] {
  const ym = planDateStr.slice(0, 7)
  if (!state || state.month !== ym || !state.fitness_muscles.length) return []
  return state.fitness_muscles
}

/** First active focus muscle — legacy single-muscle call sites. */
export function activeMonthlyFitnessMuscleForDate(
  state: MonthlyFocusStateV1 | null | undefined,
  planDateStr: string,
): string | null {
  const muscles = activeMonthlyFitnessMusclesForDate(state, planDateStr)
  return muscles[0] ?? null
}

export interface MonthlyFocusDayContext {
  muscles: string[]
  splitGuardByMuscle: Record<string, boolean>
  volumeBoostByMuscle: Record<string, number>
  setBudgetByMuscle: Record<string, number>
}

/** Per-muscle split guard, volume boost, and optional set budgets for one plan date. */
export function buildMonthlyFocusDayContext(
  state: MonthlyFocusStateV1 | null | undefined,
  planDateStr: string,
  weeklySplitSchedule: Record<string, { groups?: string[] }> | null | undefined,
  restDays: number[] | null | undefined,
  options?: {
    splitGuardByMuscle?: Record<string, boolean>
    setBudgetByMuscle?: Record<string, number>
    /** Legacy: single guard flag applied when only one focus muscle is active. */
    monthlyFocusSplitGuard?: boolean
    focusDaySetBudget?: number
  },
): MonthlyFocusDayContext {
  const muscles = activeMonthlyFitnessMusclesForDate(state, planDateStr)
  const splitGuardByMuscle: Record<string, boolean> = {}
  const volumeBoostByMuscle: Record<string, number> = {}
  const setBudgetByMuscle: Record<string, number> = {}

  for (const muscle of muscles) {
    const guard = options?.splitGuardByMuscle?.[muscle] !== undefined
      ? Boolean(options.splitGuardByMuscle[muscle])
      : options?.monthlyFocusSplitGuard !== undefined && muscles.length === 1
        ? Boolean(options.monthlyFocusSplitGuard)
        : computeMonthlyFocusSplitGuard(weeklySplitSchedule, restDays, planDateStr, muscle)
    splitGuardByMuscle[muscle] = guard
    volumeBoostByMuscle[muscle] = monthlyFocusVolumeBonusForMuscle(state, planDateStr, guard)
    const budget = options?.setBudgetByMuscle?.[muscle]
    if (budget !== undefined) {
      setBudgetByMuscle[muscle] = budget
    } else if (options?.focusDaySetBudget !== undefined && muscles.length === 1) {
      setBudgetByMuscle[muscle] = options.focusDaySetBudget
    } else {
      setBudgetByMuscle[muscle] = 0
    }
  }

  return { muscles, splitGuardByMuscle, volumeBoostByMuscle, setBudgetByMuscle }
}

/**
 * Pretty label for a canonical muscle group id (`mid_chest` → `Mid Chest`,
 * `back_lats` → `Lats`, etc.). Used by surfaces outside Profile (Home,
 * TodayWorkout) so we don't fork the label table.
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

export function muscleGroupsDisplayLabels(muscles: string[]): string {
  return muscles.map((m) => muscleGroupDisplayLabel(m)).filter(Boolean).join(', ')
}

export function focusWeekOfMonth(planDateStr: string): number {
  const m = /^\d{4}-\d{2}-(\d{2})$/.exec(planDateStr)
  if (!m) return 1
  const day = Number(m[1])
  if (!Number.isFinite(day) || day < 1) return 1
  return Math.min(5, Math.ceil(day / 7))
}

function baseVolumeBonusForWeek(week: number): number {
  if (week === 1) return 1
  if (week === 2 || week === 3) return 2
  if (week === 4) return 1
  return 1
}

export function monthlyFocusVolumeBonusForMuscle(
  state: MonthlyFocusStateV1 | null | undefined,
  planDateStr: string,
  isSplitGuardDay: boolean = false,
): number {
  if (!activeMonthlyFitnessMusclesForDate(state, planDateStr).length) return 0
  const week = focusWeekOfMonth(planDateStr)
  const baseBonus = baseVolumeBonusForWeek(week)
  if (isSplitGuardDay) return Math.floor(baseBonus / 2)
  return baseBonus
}

/** Extra-set volume bonus when any monthly fitness focus is active. */
export function monthlyFocusVolumeBonus(
  state: MonthlyFocusStateV1 | null | undefined,
  planDateStr: string,
  isSplitGuardDay: boolean = false,
): number {
  return monthlyFocusVolumeBonusForMuscle(state, planDateStr, isSplitGuardDay)
}

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

/** True when tomorrow's split includes any of the focus muscles. */
export function computeMonthlyFocusSplitGuardForAny(
  weeklySplitSchedule: Record<string, { groups?: string[] }> | null | undefined,
  restDays: number[] | null | undefined,
  planDateStr: string,
  muscles: string[],
): boolean {
  return muscles.some((m) =>
    computeMonthlyFocusSplitGuard(weeklySplitSchedule, restDays, planDateStr, m),
  )
}
