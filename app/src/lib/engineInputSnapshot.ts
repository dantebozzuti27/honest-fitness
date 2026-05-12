/**
 * Engine input snapshot — Phase A of the "move engine to backend" audit
 * (#3a).
 *
 * Captures the inputs the workout engine read when it generated a weekly
 * plan, so we can answer "what did the engine see when it produced this
 * plan?" without re-running the engine. This is the single most useful
 * artefact for incident response on personalised output:
 *
 *   - When a user reports "my Tuesday plan has hamstrings, but my split
 *     is back/biceps", the snapshot tells us EXACTLY what split, theme,
 *     focus, recovery, and volume state the engine consumed for that day.
 *     Today, that information is reconstructable only by re-running the
 *     engine with a recovery profile we can no longer reproduce.
 *
 *   - When we ship engine changes (we just bumped to 2026-05-12.2), the
 *     snapshot provides A/B-able input parity: the same snapshot fed to
 *     a new engine version should produce a different output, and the
 *     diff should be attributable to the version change rather than to
 *     drift in the user's underlying state.
 *
 * Schema versioning
 *   `version: 1` is locked. Adding fields → don't bump (consumers should
 *   tolerate unknown fields). Renaming or removing fields → bump and
 *   keep both in the union for one full release cycle. The DB column is
 *   `engine_input_snapshot JSONB` so adding fields requires zero
 *   migration.
 *
 * Size budget
 *   Each snapshot is bounded: per-muscle arrays are at most ~25
 *   entries (canonical muscle groups). Per-day section is at most 7.
 *   Empirical fit: ~3-8 KB per weekly plan. Negligible for our row
 *   counts.
 */

import type { TrainingProfile } from './trainingAnalysis';
import type { UserPreferences, WeeklyPlan } from './workoutEngine';
import { MODEL_CONFIG_VERSION, WORKOUT_ENGINE_VERSION } from './modelConfig';

/**
 * Bound on how many recovery / volume rows we persist per day. We
 * don't need every muscle in the universe; the canonical set is ~25.
 * Cap defensively so a malformed profile can't blow up snapshot size.
 */
const MAX_PER_DAY_MUSCLE_ROWS = 30;

/** Trim to keep snapshot size predictable. */
function bounded<T>(arr: readonly T[]): T[] {
  return arr.slice(0, MAX_PER_DAY_MUSCLE_ROWS);
}

export interface EngineInputSnapshotV1 {
  version: 1;
  capturedAt: string; // ISO timestamp
  engineVersion: string;
  modelConfigVersion: string;

  /**
   * Subset of `user_preferences` that influences engine output. We
   * intentionally do NOT capture every preference — body composition,
   * cardio prefs that the planner ignores, etc. — because the snapshot
   * exists for replay/debugging, not for full state archival.
   */
  preferences: {
    training_goal: string;
    session_duration_minutes: number;
    equipment_access: string;
    available_days_per_week: number;
    rest_days: number[];
    priority_muscles: string[];
    preferred_split: string | null;
    weekly_split_schedule: Record<string, { focus: string; groups: string[] }> | null;
    monthly_focus_state: unknown | null;
    injuries: Array<{ body_part: string; description: string; severity: string }>;
    exercises_to_avoid: string[];
    cardio_preference: string | null;
    cardio_frequency_per_week: number | null;
    cardio_duration_minutes: number | null;
    body_weight_lbs: number | null;
    weight_goal_lbs: number | null;
    weight_goal_date: string | null;
    experience_level: string | null;
    age: number | null;
    gender: string | null;
  };

  /**
   * Per-day inputs for each day in the weekly plan. Keyed by ISO date
   * string (`plan_date`) so consumers can join back to weekly_plan_days
   * without index gymnastics. Rest days are included with empty arrays
   * for completeness — knowing "Tuesday was a rest day per the snapshot"
   * is useful when Tuesday's plan disagrees.
   */
  perDay: Array<{
    planDate: string;
    dayOfWeek: number;
    isRestDay: boolean;
    /**
     * The muscle groups the engine actually selected to train on this
     * day. This is `weeklyPlan.days[i].plannedWorkout.muscleGroupsFocused`
     * captured verbatim — the contract is "what did the engine think
     * the day was?", not "what was the user's split?". The two should
     * match when the schedule is user-authored; they don't is itself
     * a useful signal.
     */
    selectedMuscleGroups: string[];
    /** The active monthly fitness focus muscle for this date, if any. */
    monthlyFocusMuscle: string | null;
  }>;

  /**
   * Profile-level snapshots — these don't change per-day, but are the
   * inputs the per-day generator consulted. Useful for "what was the
   * user's state at plan-time?" investigations.
   */
  profileState: {
    /** Per-muscle recovery percentage (0-100) at plan generation. */
    recoverySnapshot: Array<{
      muscleGroup: string;
      recoveryPercent: number;
      daysSinceLastTrained: number;
    }>;
    /** Per-muscle weekly volume vs target at plan generation. */
    volumeSnapshot: Array<{
      muscleGroup: string;
      weeklyDirectSets: number;
      daysSinceLastTrained: number;
    }>;
    /** Auto-detected split name + confidence at plan generation. */
    detectedSplit: {
      name: string;
      confidence: number;
    } | null;
    /** Body weight trend phase at plan generation. */
    bodyWeightPhase: string | null;
    /**
     * Any active deload recommendation flags. Only the boolean +
     * suggestion are captured; the full reasoning stays in the
     * decisionLog of individual workouts.
     */
    deloadActive: boolean;
  };
}

export function buildEngineInputSnapshot(
  profile: TrainingProfile,
  prefs: UserPreferences,
  weeklyPlan: WeeklyPlan,
  monthlyFocusByDate: (planDate: string) => string | null,
): EngineInputSnapshotV1 {
  const perDay: EngineInputSnapshotV1['perDay'] = (weeklyPlan.days ?? []).map((d) => ({
    planDate: d.planDate,
    dayOfWeek: d.dayOfWeek,
    isRestDay: !!d.isRestDay,
    selectedMuscleGroups: Array.isArray(d.plannedWorkout?.muscleGroupsFocused)
      ? (d.plannedWorkout!.muscleGroupsFocused as string[]).map(g => String(g))
      : [],
    monthlyFocusMuscle: monthlyFocusByDate(d.planDate),
  }));

  const recoverySnapshot = bounded(
    (profile.muscleRecovery ?? []).map((r) => ({
      muscleGroup: String(r.muscleGroup ?? ''),
      recoveryPercent: Number(r.recoveryPercent ?? 0),
      // The recovery model exposes hours; convert to days for snapshot
      // consumers (matches the volume side, where days is the unit).
      daysSinceLastTrained: r.hoursSinceLastTrained != null
        ? Math.round((r.hoursSinceLastTrained / 24) * 10) / 10
        : 0,
    })),
  );

  const volumeSnapshot = bounded(
    (profile.muscleVolumeStatuses ?? []).map((v) => ({
      muscleGroup: String(v.muscleGroup ?? ''),
      weeklyDirectSets: Number(v.weeklyDirectSets ?? 0),
      daysSinceLastTrained: Number(v.daysSinceLastTrained ?? 999),
    })),
  );

  return {
    version: 1,
    capturedAt: new Date().toISOString(),
    engineVersion: WORKOUT_ENGINE_VERSION,
    modelConfigVersion: MODEL_CONFIG_VERSION,
    preferences: {
      training_goal: String(prefs.training_goal ?? 'maintain'),
      session_duration_minutes: Number(prefs.session_duration_minutes ?? 60),
      equipment_access: String(prefs.equipment_access ?? 'full_gym'),
      available_days_per_week: Number(prefs.available_days_per_week ?? 4),
      rest_days: Array.isArray(prefs.rest_days) ? prefs.rest_days.slice() : [],
      priority_muscles: Array.isArray(prefs.priority_muscles)
        ? prefs.priority_muscles.map(String)
        : [],
      preferred_split: prefs.preferred_split ?? null,
      weekly_split_schedule: (prefs.weekly_split_schedule as never) ?? null,
      monthly_focus_state: prefs.monthly_focus_state ?? null,
      injuries: Array.isArray(prefs.injuries)
        ? prefs.injuries.map((i) => ({
            body_part: String(i.body_part ?? ''),
            description: String(i.description ?? ''),
            severity: String(i.severity ?? ''),
          }))
        : [],
      exercises_to_avoid: Array.isArray(prefs.exercises_to_avoid)
        ? prefs.exercises_to_avoid.map(String)
        : [],
      cardio_preference: prefs.cardio_preference ?? null,
      cardio_frequency_per_week: prefs.cardio_frequency_per_week ?? null,
      cardio_duration_minutes: prefs.cardio_duration_minutes ?? null,
      body_weight_lbs: prefs.body_weight_lbs ?? null,
      weight_goal_lbs: prefs.weight_goal_lbs ?? null,
      weight_goal_date: prefs.weight_goal_date ?? null,
      experience_level: prefs.experience_level ?? null,
      age: prefs.age ?? null,
      gender: prefs.gender ?? null,
    },
    perDay,
    profileState: {
      recoverySnapshot,
      volumeSnapshot,
      detectedSplit: profile.detectedSplit
        ? {
            name: String((profile.detectedSplit as { name?: string }).name ?? 'unknown'),
            confidence: Number((profile.detectedSplit as { confidence?: number }).confidence ?? 0),
          }
        : null,
      bodyWeightPhase: profile.bodyWeightTrend
        ? String((profile.bodyWeightTrend as { phase?: string }).phase ?? 'unknown')
        : null,
      deloadActive: Boolean(
        (profile.deloadRecommendation as { needed?: boolean } | undefined)?.needed,
      ),
    },
  };
}
