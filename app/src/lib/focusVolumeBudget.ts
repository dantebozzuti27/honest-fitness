/**
 * Monthly fitness focus as a weekly volume budget — not an append slot.
 *
 * Allocates direct sets for each focus muscle across the training week.
 * Split days that already train the muscle get the heavy share; other
 * days get layered maintenance dose.
 */

import { normalizeMuscleGroupName } from './volumeGuidelines';
import {
  activeMonthlyFitnessMusclesForDate,
  focusWeekOfMonth,
  type MonthlyFocusStateV1,
} from './monthlyFocus';

export interface FocusWeeklyBudgetV1 {
  muscle: string;
  weekOfMonth: number;
  totalDirectSets: number;
  allocatedByDate: Record<string, number>;
}

export interface FocusBudgetDayInput {
  planDate: string;
  isRestDay: boolean;
  scheduledGroups: string[];
}

/** Weekly direct-set target for one focus muscle (aggressive but finite). */
function weeklyFocusSetTarget(weekOfMonth: number, focusMuscleCount: number): number {
  const base =
    weekOfMonth === 1 ? 14 :
    weekOfMonth === 2 || weekOfMonth === 3 ? 18 :
    14;
  if (focusMuscleCount <= 1) return base;
  return Math.max(6, Math.round(base / focusMuscleCount));
}

function buildFocusWeeklyBudgetForMuscle(
  focusState: MonthlyFocusStateV1 | null | undefined,
  days: FocusBudgetDayInput[],
  muscle: string,
  focusMuscleCount: number,
): FocusWeeklyBudgetV1 | null {
  if (!days.length) return null;
  const canonical = normalizeMuscleGroupName(muscle) ?? muscle;
  const weekOfMonth = focusWeekOfMonth(days[0].planDate);
  const total = weeklyFocusSetTarget(weekOfMonth, focusMuscleCount);

  const trainingDays = days.filter(d => !d.isRestDay);
  if (trainingDays.length === 0) return null;

  const splitDays = trainingDays.filter(d =>
    d.scheduledGroups.some(g => (normalizeMuscleGroupName(g) ?? g) === canonical),
  );
  const layerDays = trainingDays.filter(d => !splitDays.includes(d));

  const splitShare = splitDays.length > 0 ? Math.round(total * 0.65) : 0;
  const layerShare = total - splitShare;

  const perSplit = splitDays.length > 0
    ? Math.max(3, Math.round(splitShare / splitDays.length))
    : 0;
  const perLayer = layerDays.length > 0
    ? Math.max(2, Math.round(layerShare / layerDays.length))
    : 0;

  const allocatedByDate: Record<string, number> = {};
  for (const d of splitDays) {
    allocatedByDate[d.planDate] = perSplit;
  }
  for (const d of layerDays) {
    allocatedByDate[d.planDate] = perLayer;
  }

  return {
    muscle: canonical,
    weekOfMonth,
    totalDirectSets: total,
    allocatedByDate,
  };
}

/** Budget for the first active focus muscle (legacy single-focus callers). */
export function buildFocusWeeklyBudget(
  focusState: MonthlyFocusStateV1 | null | undefined,
  days: FocusBudgetDayInput[],
): FocusWeeklyBudgetV1 | null {
  const budgets = buildFocusWeeklyBudgets(focusState, days);
  return budgets[0] ?? null;
}

/** One weekly budget per active monthly focus muscle. */
export function buildFocusWeeklyBudgets(
  focusState: MonthlyFocusStateV1 | null | undefined,
  days: FocusBudgetDayInput[],
): FocusWeeklyBudgetV1[] {
  if (!days.length) return [];
  const muscles = activeMonthlyFitnessMusclesForDate(focusState ?? null, days[0].planDate);
  if (!muscles.length) return [];
  return muscles
    .map((muscle) => buildFocusWeeklyBudgetForMuscle(focusState, days, muscle, muscles.length))
    .filter((b): b is FocusWeeklyBudgetV1 => b != null);
}

/** Sets budget for a single plan date (0 if rest or no focus). */
export function focusSetBudgetForDate(
  budget: FocusWeeklyBudgetV1 | null | undefined,
  planDate: string,
  isSplitGuardDay: boolean,
): number {
  if (!budget) return 0;
  const raw = budget.allocatedByDate[planDate] ?? 0;
  if (isSplitGuardDay) return Math.max(2, Math.floor(raw * 0.55));
  return raw;
}

/** Per-muscle set budgets for one plan date. */
export function focusSetBudgetsForDate(
  budgets: FocusWeeklyBudgetV1[],
  planDate: string,
  splitGuardByMuscle: Record<string, boolean>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const budget of budgets) {
    out[budget.muscle] = focusSetBudgetForDate(
      budget,
      planDate,
      Boolean(splitGuardByMuscle[budget.muscle]),
    );
  }
  return out;
}
