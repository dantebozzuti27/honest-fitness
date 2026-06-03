import type { TrainingProfile } from './trainingAnalysis';
import type { UserPreferences } from './workoutEngine';

/**
 * Blend prefs session budget with observed median duration (elite users often finish under budget).
 */
export function effectiveSessionDurationMinutes(
  prefs: UserPreferences,
  profile: TrainingProfile,
): number {
  const pref = Number(prefs.session_duration_minutes ?? 0);
  const observed = Number(profile.avgSessionDuration ?? 0);
  if (!Number.isFinite(pref) || pref <= 0) {
    return Number.isFinite(observed) && observed > 0 ? Math.round(observed) : 60;
  }
  if (!Number.isFinite(observed) || observed <= 0) return Math.round(pref);
  // Trust recent behavior at 70% + stated budget at 30%, capped to pref so UI contract holds.
  const blended = Math.round(observed * 0.7 + pref * 0.3);
  return Math.min(pref, Math.max(35, blended));
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
