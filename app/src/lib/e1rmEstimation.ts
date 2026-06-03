/**
 * Robust estimated-1RM helpers shared by trainingAnalysis, liftCapacity, and workoutEngine.
 *
 * Goals:
 * - RIR-corrected Epley everywhere strength sets are interpreted
 * - Ignore warmup-flagged and sub-65% heuristic warmups (caller filters)
 * - Cap high-rep sets (≥13 reps) from dominating e1RM
 * - Session best = top set unless top exceeds second-best by >12% (logging spike guard)
 * - Cap session peak vs rolling median to kill equipment/logging spikes
 */

export const MAX_REPS_FOR_E1RM = 12;
export const MIN_REPS_FOR_E1RM = 1;

export function epley1RM(weight: number, reps: number): number {
  if (reps <= 0 || weight <= 0) return 0;
  if (reps === 1) return weight;
  return weight * (1 + reps / 30);
}

export function epley1RMWithRir(
  weight: number,
  reps: number,
  rir: number | null | undefined,
): number {
  if (reps <= 0 || weight <= 0) return 0;
  const cappedReps = Math.min(MAX_REPS_FOR_E1RM, Math.max(MIN_REPS_FOR_E1RM, Math.round(reps)));
  const adjustedRir = rir == null ? 1 : Math.max(0, Math.min(4, rir));
  const effectiveReps = cappedReps + adjustedRir;
  if (effectiveReps === 1) return weight;
  return weight * (1 + effectiveReps / 30);
}

export function rirFromSet(set: {
  actual_rir?: number | null;
  set_rpe?: number | null;
}): number | null {
  if (set.actual_rir != null && Number.isFinite(Number(set.actual_rir))) {
    return Math.max(0, Math.min(4, Number(set.actual_rir)));
  }
  if (set.set_rpe != null && Number.isFinite(Number(set.set_rpe))) {
    return Math.max(0, Math.min(4, 10 - Number(set.set_rpe)));
  }
  return null;
}

export interface SetE1rmInput {
  weight: number | null;
  reps: number | null;
  is_bodyweight?: boolean;
  actual_rir?: number | null;
  set_rpe?: number | null;
}

/** Best set e1RM in one session; drops a lone spike vs second-best set. */
export function sessionBestE1rmFromSets(
  sets: SetE1rmInput[],
  effectiveBodyweight?: number | null,
  bwFraction: number = 0.7,
): { e1rm: number; weight: number; reps: number } | null {
  const estimates: Array<{ e1rm: number; weight: number; reps: number }> = [];
  for (const s of sets) {
    let w = s.weight;
    const reps = s.reps;
    if (reps == null || reps < MIN_REPS_FOR_E1RM) continue;
    if (reps > 20) continue;
    if (s.is_bodyweight && effectiveBodyweight && effectiveBodyweight > 0) {
      w = Math.round(effectiveBodyweight * bwFraction);
    }
    if (w == null || w <= 0) continue;
    const e1rm = epley1RMWithRir(w, reps, rirFromSet(s));
    if (e1rm > 0) estimates.push({ e1rm, weight: w, reps });
  }
  if (!estimates.length) return null;
  estimates.sort((a, b) => a.e1rm - b.e1rm);
  const top = estimates[estimates.length - 1];
  const second = estimates.length >= 2 ? estimates[estimates.length - 2] : null;
  if (second && top.e1rm > second.e1rm * 1.12) return second;
  return top;
}

/** Cap a candidate e1RM vs recent session peaks (prevents one bad log from jumping +20%). */
export function capE1rmVsRecentMedian(
  candidate: number,
  recentSessionPeaks: number[],
  maxJumpRatio: number = 1.12,
): number {
  if (candidate <= 0 || !recentSessionPeaks.length) return candidate;
  const sorted = [...recentSessionPeaks].filter((n) => n > 0).sort((a, b) => a - b);
  if (!sorted.length) return candidate;
  const median = sorted[Math.floor(sorted.length / 2)];
  if (median <= 0) return candidate;
  return Math.min(candidate, median * maxJumpRatio);
}

export function robustRecentPeakE1rm(
  sessionPeaks: number[],
  window: number = 4,
): number {
  if (!sessionPeaks.length) return 0;
  const recent = sessionPeaks.slice(-window).filter((n) => n > 0);
  if (!recent.length) return 0;
  const rawPeak = Math.max(...recent);
  return capE1rmVsRecentMedian(rawPeak, recent.slice(0, -1).length ? recent.slice(0, -1) : recent);
}

export function learnedPreferenceToE1rm(
  learnedWeight: number | null | undefined,
  learnedReps: number | null | undefined,
): number | null {
  if (learnedWeight == null || learnedWeight <= 0) return null;
  if (learnedReps == null || learnedReps <= 0) return null;
  return epley1RMWithRir(learnedWeight, Math.round(learnedReps), 1);
}
