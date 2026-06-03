import type { TrainingProfile } from './trainingAnalysis';
import type { WeeklyPlan, WeeklyPlanDay } from './workoutEngine';

export type WeekPlanReviewVerdict = 'pass' | 'minor_issues' | 'major_issues';

export interface WeekPlanReviewDayNote {
  planDate: string;
  status: 'ok' | 'watch' | 'concern';
  note: string;
}

export interface WeekPlanReview {
  weekSummary: string;
  overallVerdict: WeekPlanReviewVerdict;
  days: WeekPlanReviewDayNote[];
  schema_version?: 'v1';
}

export function verdictLabel(verdict: string | undefined | null): string {
  switch (verdict) {
    case 'pass':
      return 'Plan OK';
    case 'minor_issues':
      return 'Minor notes';
    case 'major_issues':
      return 'Review suggested';
    default:
      return 'Pending';
  }
}

export function verdictColor(verdict: string | undefined | null): string {
  switch (verdict) {
    case 'pass':
      return 'var(--success)';
    case 'minor_issues':
      return '#e6a800';
    case 'major_issues':
      return 'var(--danger)';
    default:
      return 'var(--text-tertiary)';
  }
}

function mapDayStatus(status: string): WeekPlanReviewVerdict {
  if (status === 'concern') return 'major_issues';
  if (status === 'watch') return 'minor_issues';
  return 'pass';
}

function mapOverallVerdict(v: string): WeekPlanReviewVerdict {
  if (v === 'problematic' || v === 'major_issues') return 'major_issues';
  if (v === 'needs_tweaks' || v === 'minor_issues') return 'minor_issues';
  return 'pass';
}

/** Compact week payload for one LLM call (not 7× validate-workout). */
export function buildWeekPlanReviewPayload(
  profile: TrainingProfile,
  plan: WeeklyPlan,
  today: string,
): { profileSummary: Record<string, unknown>; week: Record<string, unknown> } {
  const futureDays = plan.days.filter((d) => d.planDate >= today && !d.isRestDay && d.plannedWorkout);

  return {
    profileSummary: {
      goal: profile.goalProgress?.goalLabel ?? profile.goalProgress?.primaryGoal,
      trainingFrequency: profile.trainingFrequency,
      avgSessionMinutes: profile.avgSessionDuration,
      sessionBudgetMinutes: profile.avgSessionDuration,
      priorityMuscles: (profile as any).priority_muscles ?? null,
      deloadRecommended: profile.deloadRecommendation?.needed ?? false,
      muscleVolumeAlerts: (profile.muscleVolumeStatuses ?? [])
        .filter((v) => v.status === 'above_mrv' || v.status === 'below_mev')
        .slice(0, 8)
        .map((v) => ({ group: v.muscleGroup, status: v.status, sets: v.weeklyDirectSets })),
      lowRecovery: (profile.muscleRecovery ?? [])
        .filter((r) => (r.recoveryPercent ?? 100) < 70)
        .slice(0, 8)
        .map((r) => ({ group: r.muscleGroup, pct: r.recoveryPercent })),
    },
    week: {
      weekStartDate: plan.weekStartDate,
      trainingDays: futureDays.length,
      days: plan.days
        .filter((d) => d.planDate >= today)
        .map((d) => summarizePlanDay(d)),
    },
  };
}

function summarizePlanDay(d: WeeklyPlanDay) {
  const ex = d.plannedWorkout?.exercises ?? [];
  return {
    planDate: d.planDate,
    dayName: d.dayName,
    isRestDay: d.isRestDay,
    focus: d.focus,
    muscleGroups: d.muscleGroups,
    estimatedMinutes: d.estimatedMinutes,
    exerciseCount: ex.length,
    topExercises: ex.slice(0, 8).map((e) => ({
      name: e.exerciseName,
      group: e.targetMuscleGroup ?? e.bodyPart,
      sets: typeof e.sets === 'number' ? e.sets : 0,
      role: e.exerciseRole,
    })),
    dayTheme: d.dayTheme ?? null,
  };
}

/** Apply week review to plan days — does not mutate workouts. */
export function applyWeekPlanReviewToPlan(plan: WeeklyPlan, review: WeekPlanReview): WeeklyPlan {
  const byDate = new Map(review.days.map((d) => [d.planDate, d]));

  return {
    ...plan,
    weekPlanReview: {
      summary: review.weekSummary,
      overallVerdict: review.overallVerdict,
      reviewedAt: new Date().toISOString(),
    },
    days: plan.days.map((d) => {
      const note = byDate.get(d.planDate);
      if (!note || d.isRestDay || d.dayStatus === 'completed') return d;
      const llmVerdict = mapDayStatus(note.status);
      return {
        ...d,
        llmVerdict,
        llmDayNote: note.note?.trim() || undefined,
        llmCorrections: undefined,
        dayStatus: d.dayStatus || 'planned',
      };
    }),
  };
}

export function parseWeekPlanReviewResponse(raw: unknown): WeekPlanReview {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const daysRaw = Array.isArray(o.days) ? o.days : [];
  const days: WeekPlanReviewDayNote[] = daysRaw
    .filter((d) => d && typeof d === 'object' && typeof (d as any).planDate === 'string')
    .slice(0, 7)
    .map((d) => {
      const row = d as Record<string, unknown>;
      const status = ['ok', 'watch', 'concern'].includes(String(row.status))
        ? (String(row.status) as WeekPlanReviewDayNote['status'])
        : 'ok';
      return {
        planDate: String(row.planDate),
        status,
        note: String(row.note || '').slice(0, 200),
      };
    });

  return {
    weekSummary: String(o.weekSummary || 'Weekly plan generated from your profile and split.').slice(0, 600),
    overallVerdict: mapOverallVerdict(String(o.overallVerdict || 'solid')),
    days,
    schema_version: 'v1',
  };
}
