import { getLocalDate } from '../utils/dateUtils';
import { buildWeekPlanConstraints, type WeekPlanConstraintsV1 } from './weekPlanConstraints';
import type { UserPreferences, WeeklyPlan } from './workoutEngine';

export function getWeekStartMonday(dateStr: string): string {
  const d = new Date(`${dateStr.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr.slice(0, 10);
  const dow = d.getDay();
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
  return getLocalDate(d);
}

export function latestPlanDate(plan: WeeklyPlan | null | undefined): string | null {
  if (!plan?.days?.length) return null;
  let max = plan.days[0].planDate;
  for (const d of plan.days) {
    if (d.planDate > max) max = d.planDate;
  }
  return max;
}

/**
 * Force regeneration when there is no active plan for this week, plan horizon ended,
 * or constraints are missing (pre-migration plans).
 */
export function shouldForceWeeklyPlanRegen(
  existing: WeeklyPlan | null | undefined,
  today: string = getLocalDate(),
  prefs?: UserPreferences | null,
  restDays: number[] = [],
): boolean {
  if (!existing?.days?.length) return true;
  const weekStart = getWeekStartMonday(today);
  if (existing.weekStartDate && existing.weekStartDate.slice(0, 10) !== weekStart) return true;
  const last = latestPlanDate(existing);
  if (last && last < today) {
    const todayDow = new Date(`${today}T12:00:00`).getDay();
    const rest = new Set(restDays);
    if (!rest.has(todayDow)) return true;
  }
  if (!existing.planConstraints?.constraintsHash) return true;
  if (prefs) {
    const current = buildWeekPlanConstraints(prefs, weekStart, restDays);
    if (existing.planConstraints.constraintsHash !== current.constraintsHash) return true;
  }
  return false;
}

/** Attach current constraints hash to plans saved before constraints column existed. */
export function backfillPlanConstraints(
  plan: WeeklyPlan,
  prefs: UserPreferences,
  restDays: number[],
): WeeklyPlan {
  if (plan.planConstraints?.constraintsHash) return plan;
  const weekStart = plan.weekStartDate?.slice(0, 10) ?? getWeekStartMonday(getLocalDate());
  const constraints = buildWeekPlanConstraints(prefs, weekStart, restDays);
  return { ...plan, planConstraints: constraints };
}

/** Count surgical swaps in trailing 7 days — debounce full week regen when user is actively editing. */
export function countRecentSurgicalSwaps(
  swaps: Array<{ swap_context?: string; created_at?: string }> | null | undefined,
  withinDays: number = 7,
): number {
  if (!swaps?.length) return 0;
  const cutoff = Date.now() - withinDays * 86400000;
  return swaps.filter((s) => {
    if (s.swap_context !== 'today_surgical' && s.swap_context !== 'active_replace') return false;
    const t = s.created_at ? new Date(s.created_at).getTime() : 0;
    return t >= cutoff;
  }).length;
}

export function shouldSkipWeekRegenForSwapActivity(
  swapCountLast7Days: number,
  threshold: number = 4,
): boolean {
  return swapCountLast7Days >= threshold;
}
