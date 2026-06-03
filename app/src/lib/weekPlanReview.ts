import type { TrainingProfile } from './trainingAnalysis';
import { fetchWeekPlanReview } from './insightsApi';
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

export interface WeekPlanReviewMeta {
  summary: string;
  overallVerdict: WeekPlanReviewVerdict;
  reviewedAt: string;
  contentFingerprint: string;
  source?: 'deterministic' | 'llm' | 'merged';
}

const REVIEW_TTL_MS = 6 * 60 * 60 * 1000;

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

function statusRank(status: WeekPlanReviewDayNote['status']): number {
  if (status === 'concern') return 2;
  if (status === 'watch') return 1;
  return 0;
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

function overallFromDays(days: WeekPlanReviewDayNote[]): WeekPlanReviewVerdict {
  let max = 0;
  for (const d of days) max = Math.max(max, statusRank(d.status));
  if (max >= 2) return 'major_issues';
  if (max >= 1) return 'minor_issues';
  return 'pass';
}

/** Stable fingerprint — skip redundant LLM when plan content unchanged. */
export function weekPlanContentFingerprint(plan: WeeklyPlan, today: string): string {
  const parts = (plan.days ?? [])
    .filter((d) => d.planDate >= today)
    .map((d) => {
      const names = d.isRestDay
        ? 'rest'
        : (d.plannedWorkout?.exercises ?? [])
            .map((e) => String(e.exerciseName || '').toLowerCase())
            .sort()
            .join(',');
      return `${d.planDate}:${d.isRestDay ? 'R' : 'T'}:${names}:${d.estimatedMinutes ?? 0}:${(d.muscleGroups ?? []).join('+')}`;
    });
  return parts.join('|');
}

export function isWeekReviewFresh(plan: WeeklyPlan, fingerprint: string): boolean {
  const r = plan.weekPlanReview;
  if (!r?.summary || !r.contentFingerprint || !r.reviewedAt) return false;
  if (r.contentFingerprint !== fingerprint) return false;
  const age = Date.now() - new Date(r.reviewedAt).getTime();
  return Number.isFinite(age) && age >= 0 && age < REVIEW_TTL_MS;
}

/** Strip legacy per-day audit artifacts from older Week Ahead builds. */
export function sanitizeLegacyWeekPlanLlm(plan: WeeklyPlan): WeeklyPlan {
  return {
    ...plan,
    days: (plan.days ?? []).map((d) => ({
      ...d,
      llmCorrections: undefined,
      llmVerdict:
        d.llmVerdict === 'pending' || (Array.isArray(d.llmCorrections) && d.llmCorrections.length > 0)
          ? undefined
          : d.llmVerdict,
    })),
  };
}

function workoutSignature(day: WeeklyPlanDay): string {
  return (day.plannedWorkout?.exercises ?? [])
    .filter((ex) => !ex?.isCardio)
    .map(
      (ex) =>
        `${String(ex.exerciseName || '').toLowerCase()}|${Number(ex.sets) || 0}|${Number(ex.targetReps) || 0}`,
    )
    .join(';;');
}

function muscleOverlap(a: string[], b: string[]): number {
  const sa = new Set(a.map((g) => g.toLowerCase()));
  const sb = new Set(b.map((g) => g.toLowerCase()));
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const g of sa) if (sb.has(g)) inter += 1;
  const union = sa.size + sb.size - inter;
  return union > 0 ? inter / union : 0;
}

/** Fast local checks — no LLM. */
export function buildDeterministicWeekReview(
  profile: TrainingProfile,
  plan: WeeklyPlan,
  today: string,
  sessionBudgetMinutes?: number,
): WeekPlanReview {
  const budget =
    sessionBudgetMinutes && sessionBudgetMinutes > 0
      ? sessionBudgetMinutes
      : profile.avgSessionDuration > 0
        ? profile.avgSessionDuration
        : 90;

  const dayNotes = new Map<string, WeekPlanReviewDayNote>();
  for (const d of plan.days ?? []) {
    if (d.planDate < today) continue;
    dayNotes.set(d.planDate, { planDate: d.planDate, status: 'ok', note: '' });
  }

  const trainingDays = (plan.days ?? [])
    .filter((d) => d.planDate >= today && !d.isRestDay && d.plannedWorkout && d.dayStatus !== 'completed')
    .sort((a, b) => a.planDate.localeCompare(b.planDate));

  let prev: WeeklyPlanDay | null = null;
  for (const d of trainingDays) {
    const entry = dayNotes.get(d.planDate)!;
    if (d.estimatedMinutes > budget * 1.2) {
      entry.status = 'watch';
      entry.note = `Session ~${d.estimatedMinutes}m vs ~${budget}m budget`;
    }
    if (prev) {
      const sigA = workoutSignature(prev);
      const sigB = workoutSignature(d);
      if (sigA && sigA === sigB) {
        entry.status = 'concern';
        entry.note = `Same exercise lineup as ${prev.dayName} — low variety`;
      } else if (muscleOverlap(prev.muscleGroups ?? [], d.muscleGroups ?? []) >= 0.55) {
        const rank = statusRank(entry.status);
        if (rank < statusRank('watch')) entry.status = 'watch';
        entry.note = entry.note || `Back-to-back overlap with ${prev.dayName}`;
      }
    }
    prev = d;
  }

  if (profile.deloadRecommendation?.needed) {
    const heaviest = [...trainingDays].sort((a, b) => b.estimatedMinutes - a.estimatedMinutes)[0];
    if (heaviest) {
      const e = dayNotes.get(heaviest.planDate)!;
      if (statusRank(e.status) < statusRank('watch')) e.status = 'watch';
      e.note = e.note || 'Deload suggested — consider lighter volume this week';
    }
  }

  const flagged = [...dayNotes.values()].filter((d) => d.status !== 'ok');
  const summary =
    flagged.length === 0
      ? `Week is structured for your ${profile.goalProgress?.goalLabel?.toLowerCase() ?? 'training'} goal with ${trainingDays.length} training day${trainingDays.length === 1 ? '' : 's'} ahead.`
      : flagged.length === 1
        ? `Mostly solid week — one day (${flagged[0].planDate.slice(5)}) may need a small tweak.`
        : `Plan is usable; ${flagged.length} days have scheduling or volume notes to glance at.`;

  const days = [...dayNotes.values()];
  return {
    weekSummary: summary,
    overallVerdict: overallFromDays(days),
    days,
    schema_version: 'v1',
  };
}

export function mergeWeekReviews(base: WeekPlanReview, llm: WeekPlanReview): WeekPlanReview {
  const byDate = new Map<string, WeekPlanReviewDayNote>();
  for (const d of base.days) byDate.set(d.planDate, { ...d });
  for (const d of llm.days) {
    const existing = byDate.get(d.planDate);
    if (!existing) {
      byDate.set(d.planDate, d);
      continue;
    }
    const mergedStatus = statusRank(d.status) > statusRank(existing.status) ? d.status : existing.status;
    const note =
      statusRank(d.status) >= statusRank(existing.status) && d.note.trim()
        ? d.note.trim()
        : existing.note || d.note;
    byDate.set(d.planDate, { planDate: d.planDate, status: mergedStatus, note: note.slice(0, 200) });
  }

  const days = [...byDate.values()];
  const detSummary = base.weekSummary;
  const llmSummary = llm.weekSummary.trim();
  const weekSummary =
    llmSummary && !llmSummary.toLowerCase().includes('weekly plan generated')
      ? llmSummary
      : detSummary;

  return {
    weekSummary,
    overallVerdict: overallFromDays(days),
    days,
    schema_version: 'v1',
  };
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
      deloadRecommended: profile.deloadRecommendation?.needed ?? false,
      muscleVolumeAlerts: (profile.muscleVolumeStatuses ?? [])
        .filter((v) => v.status === 'above_mrv' || v.status === 'below_mev')
        .slice(0, 6)
        .map((v) => ({ group: v.muscleGroup, status: v.status, sets: v.weeklyDirectSets })),
      lowRecovery: (profile.muscleRecovery ?? [])
        .filter((r) => (r.recoveryPercent ?? 100) < 70)
        .slice(0, 6)
        .map((r) => ({ group: r.muscleGroup, pct: r.recoveryPercent })),
    },
    week: {
      weekStartDate: plan.weekStartDate,
      trainingDays: futureDays.length,
      days: plan.days.filter((d) => d.planDate >= today).map((d) => summarizePlanDay(d)),
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
    topExercises: ex.slice(0, 6).map((e) => ({
      name: e.exerciseName,
      group: e.targetMuscleGroup ?? e.bodyPart,
      sets: typeof e.sets === 'number' ? e.sets : 0,
    })),
    dayTheme: d.dayTheme ?? null,
  };
}

/** Apply review to plan — never mutates workouts. */
export function applyWeekPlanReviewToPlan(
  plan: WeeklyPlan,
  review: WeekPlanReview,
  fingerprint: string,
  source: WeekPlanReviewMeta['source'] = 'merged',
): WeeklyPlan {
  const byDate = new Map(review.days.map((d) => [d.planDate, d]));

  return {
    ...plan,
    weekPlanReview: {
      summary: review.weekSummary,
      overallVerdict: review.overallVerdict,
      reviewedAt: new Date().toISOString(),
      contentFingerprint: fingerprint,
      source,
    },
    days: plan.days.map((d) => {
      const note = byDate.get(d.planDate);
      if (!note || d.isRestDay || d.dayStatus === 'completed') {
        return { ...d, llmCorrections: undefined };
      }
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
    .slice(0, 14)
    .map((d) => {
      const row = d as Record<string, unknown>;
      const status = ['ok', 'watch', 'concern'].includes(String(row.status))
        ? (String(row.status) as WeekPlanReviewDayNote['status'])
        : 'ok';
      const note = String(row.note || '').trim();
      return {
        planDate: String(row.planDate),
        status: note ? status : 'ok',
        note: note.slice(0, 200),
      };
    });

  return {
    weekSummary: String(o.weekSummary || 'Weekly plan generated from your profile and split.').slice(0, 600),
    overallVerdict: mapOverallVerdict(String(o.overallVerdict || 'solid')),
    days,
    schema_version: 'v1',
  };
}

/** Main entry: deterministic review + optional LLM polish; cached by fingerprint. */
export async function reviewWeeklyPlan(
  profile: TrainingProfile,
  plan: WeeklyPlan,
  today: string,
  options?: { forceRefresh?: boolean; sessionBudgetMinutes?: number },
): Promise<WeeklyPlan> {
  const sanitized = sanitizeLegacyWeekPlanLlm(plan);
  const fingerprint = weekPlanContentFingerprint(sanitized, today);

  if (!options?.forceRefresh && isWeekReviewFresh(sanitized, fingerprint)) {
    return sanitized;
  }

  const deterministic = buildDeterministicWeekReview(
    profile,
    sanitized,
    today,
    options?.sessionBudgetMinutes,
  );
  let reviewed = applyWeekPlanReviewToPlan(sanitized, deterministic, fingerprint, 'deterministic');

  try {
    const payload = buildWeekPlanReviewPayload(profile, sanitized, today);
    const raw = await fetchWeekPlanReview(profile, payload);
    const llm = parseWeekPlanReviewResponse(raw);
    const merged = mergeWeekReviews(deterministic, llm);
    reviewed = applyWeekPlanReviewToPlan(sanitized, merged, fingerprint, 'merged');
  } catch {
    /* deterministic-only is fine */
  }

  return reviewed;
}

/** Attach review meta into engine snapshot for reload without re-calling LLM. */
export function attachWeekReviewToEngineSnapshot(plan: WeeklyPlan): WeeklyPlan {
  if (!plan.weekPlanReview || !plan.engineInputSnapshot) return plan;
  return {
    ...plan,
    engineInputSnapshot: {
      ...plan.engineInputSnapshot,
      weekPlanReview: plan.weekPlanReview,
    } as typeof plan.engineInputSnapshot,
  };
}

export function weekPlanReviewFromEngineSnapshot(plan: WeeklyPlan): WeeklyPlan {
  if (plan.weekPlanReview?.summary) return plan;
  const snap = plan.engineInputSnapshot as { weekPlanReview?: WeekPlanReviewMeta } | undefined;
  if (snap?.weekPlanReview) {
    return { ...plan, weekPlanReview: snap.weekPlanReview };
  }
  return plan;
}

export function dayReviewDotColor(day: WeeklyPlanDay): string | null {
  if (day.isRestDay || day.dayStatus === 'completed') return null;
  if (day.llmVerdict === 'major_issues') return 'var(--danger)';
  if (day.llmVerdict === 'minor_issues') return '#e6a800';
  return null;
}
