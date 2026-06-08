import type { TrainingProfile } from './trainingAnalysis';
import type { UserPreferences } from './workoutEngine';

/**
 * Resolve the session-time budget to plan against.
 *
 * The stated `session_duration_minutes` is an EXPLICIT user instruction — the
 * time they have allocated — and is the primary signal. Observed median
 * duration is behavioral evidence used only to trim mild, consistent
 * over-budgeting (users who reliably finish early), never to silently gut the
 * plan: a 120-minute budget must not collapse to ~80.
 *
 * Two guarantees:
 *   1. The stated budget dominates the blend (65% stated / 35% observed) and
 *      the result is floored at 88% of stated, so behavior can shave a few
 *      minutes but cannot halve an explicitly requested long session.
 *   2. `honorStatedBudget` (future/preview planning) bypasses the blend
 *      entirely — a week you haven't trained yet has no "observed" duration,
 *      so planning intent is the only honest signal.
 */
export function effectiveSessionDurationMinutes(
  prefs: UserPreferences,
  profile: TrainingProfile,
  opts?: { honorStatedBudget?: boolean },
): number {
  const pref = Number(prefs.session_duration_minutes ?? 0);
  const observed = Number(profile.avgSessionDuration ?? 0);
  if (!Number.isFinite(pref) || pref <= 0) {
    return Number.isFinite(observed) && observed > 0 ? Math.round(observed) : 60;
  }
  // Future/preview planning: the stated budget IS the plan.
  if (opts?.honorStatedBudget) return Math.round(pref);
  if (!Number.isFinite(observed) || observed <= 0) return Math.round(pref);
  // Stated budget dominates; observed only trims mild, consistent early
  // finishes. Floor at 88% of stated so a long session is never gutted.
  const blended = Math.round(pref * 0.65 + observed * 0.35);
  const floor = Math.round(pref * 0.88);
  return Math.min(pref, Math.max(floor, blended));
}

/** Days since last logged workout from preference recency (global). */
export function daysSinceLastWorkout(profile: TrainingProfile): number {
  if (!profile.exercisePreferences?.length) return 999;
  return Math.min(...profile.exercisePreferences.map((p) => Number(p.lastUsedDaysAgo ?? 999)));
}

/**
 * Return-from-break volume multiplier. Stronger ramp after 6+ days off (audit: 10-day gaps).
 */
export function computeBreakRampMultiplier(profile: TrainingProfile): number {
  const days = daysSinceLastWorkout(profile);
  if (days < 6) return 1;
  if (days >= 14) return 0.55;
  return Math.max(0.55, 1 - (days - 5) * 0.035);
}

/** True when priority and monthly focus overlap — avoid double priority boosts. */
export function isOverlappingFocusAndPriority(
  muscle: string,
  priorityMuscles: string[],
  monthlyFocusMuscles: string[],
): boolean {
  return priorityMuscles.includes(muscle) && monthlyFocusMuscles.includes(muscle);
}

/** Nudge prescribed rest from observed timer compliance (training_session_features). */
export function learnedRestMultiplierFromTelemetry(medianRestVsPrescribed: number | null): number {
  if (medianRestVsPrescribed == null || !Number.isFinite(medianRestVsPrescribed)) return 1;
  if (medianRestVsPrescribed < 0.78) return 1.08;
  if (medianRestVsPrescribed > 1.28) return 0.92;
  return 1;
}
