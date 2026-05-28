/**
 * Monthly fitness focus as a weekly volume budget — not an append slot.
 *
 * Allocates direct sets for the focus muscle across the training week.
 * Split days that already train the muscle get the heavy share; other
 * days get layered maintenance dose.
 */

import { normalizeMuscleGroupName } from './volumeGuidelines';
import {
  activeMonthlyFitnessMuscleForDate,
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

/** Weekly direct-set target for the focus muscle (aggressive but finite). */
function weeklyFocusSetTarget(weekOfMonth: number): number {
  if (weekOfMonth === 1) return 14;
  if (weekOfMonth === 2 || weekOfMonth === 3) return 18;
  return 14; // week 4+ consolidation
}

/**
 * Distribute weekly focus sets across training days.
 * - Days where focus is in the split: ~65% of budget (heavy)
 * - Other training days: split remainder (layered)
 */
export function buildFocusWeeklyBudget(
  focusState: MonthlyFocusStateV1 | null | undefined,
  days: FocusBudgetDayInput[],
): FocusWeeklyBudgetV1 | null {
  if (!days.length) return null;
  const ym = days[0].planDate.slice(0, 7);
  const muscle = activeMonthlyFitnessMuscleForDate(focusState ?? null, days[0].planDate);
  if (!muscle) return null;

  const canonical = normalizeMuscleGroupName(muscle) ?? muscle;
  const weekOfMonth = focusWeekOfMonth(days[0].planDate);
  const total = weeklyFocusSetTarget(weekOfMonth);

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
