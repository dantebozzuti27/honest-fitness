/**
 * Missed-Day Redistribution
 * ─────────────────────────
 *
 * Pure module that detects missed training days and proposes how to
 * redistribute the missed stimulus across the remaining days of the week.
 *
 * Why this exists
 *   Today the engine regenerates the full week whenever the user falls behind.
 *   That destroys plan stability (the user's #1 complaint) and ignores the
 *   fact that some days are *defensively* light specifically so they can absorb
 *   missed volume. The right behaviour is: detect the shortfall, propose a
 *   targeted edit to a future day, and surface it for user approval.
 *
 * Design constraints (from user)
 *   - "ask_user" — never auto-apply. We compute proposals; the UI shows them.
 *   - Theme stability — when the missed day was a `'schedule'`-sourced theme,
 *     the candidate day must accept the missed primary as either its own
 *     `dayTheme.primary` or a member of `allowedAccessories`. We do not
 *     overwrite a user-pinned theme.
 *   - Recovery — adjacent days (±1) are penalised because back-to-back
 *     volume on the same primary is the textbook recovery failure.
 *
 * What this module is NOT
 *   - Not a regenerator. The proposal is a *delta*: which exercises to add to
 *     which day. The engine still owns selection of those exercises (callers
 *     pass `proposeExercisesFor(theme, day, count)` or similar).
 *   - Not a scheduler. We do not move days; we add stimulus into existing
 *     non-rest days. Moving an entire training day would invalidate downstream
 *     UI state and is left to a future iteration.
 *
 * Mental model
 *   For each missed day we compute a candidate set of upcoming, non-rest,
 *   non-completed days. Each candidate is scored along three axes:
 *
 *     1. theme_compat   ∈ [0, 1]   does the candidate's theme allow the
 *                                  missed primary at all?
 *     2. volume_room    ∈ [0, 1]   how much room does the candidate's current
 *                                  programme have before it bumps into the
 *                                  per-muscle weekly cap?
 *     3. recovery_dist  ∈ [0, 1]   distance (in days) from another day that
 *                                  already trains this primary; closer = lower
 *
 *   The composite score is a weighted sum (default weights below). The top
 *   candidate becomes the proposal; ties resolve by earliest planDate so the
 *   user has the most time to act.
 *
 * Common misconception
 *   "If I miss Monday's chest day, just turn Wednesday into a chest day."
 *   That ignores the user's split topology — Wednesday is back day for a
 *   reason (recovery between chest sessions, antagonist programming). The
 *   correct move is usually to *augment* a compatible day (e.g. push two
 *   chest accessories into the chest-friendly arm/shoulder day) rather than
 *   wholesale theme replacement.
 */

import type { WeeklyPlan, WeeklyPlanDay, DayTheme } from './workoutEngine';

// ─────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────

export interface MissedDay {
  planDate: string;              // YYYY-MM-DD (local)
  dayName: string;               // "Monday"
  dayOfWeek: number;             // 0=Sun
  /** The theme the user *should* have trained that day. */
  theme: DayTheme | null;
  /** What was missed, in plain language, for UI. */
  summary: string;
  /** Total working sets that were prescribed and not done. */
  missedWorkingSets: number;
  /** Total minutes that were prescribed and not done. */
  missedMinutes: number;
}

export interface RedistributionCandidate {
  planDate: string;
  dayName: string;
  /** The candidate's existing theme (pre-redistribution). */
  existingTheme: DayTheme | null;
  /** Composite score in [0, 1]. Higher = better candidate. */
  score: number;
  /** Per-axis scores for transparency / debugging. */
  components: {
    themeCompat: number;
    volumeRoom: number;
    recoveryDist: number;
  };
  /** Why this candidate is suitable, in one sentence, for UI. */
  rationale: string;
}

export interface RedistributionProposal {
  missedDay: MissedDay;
  /** Ranked candidates, best first. UI may show top 1 or top N. */
  candidates: RedistributionCandidate[];
  /** Suggested action, expressed as a delta the engine can execute. */
  suggestedAction:
    | { kind: 'augment'; targetDate: string; primaryMuscle: string; addSets: number }
    | { kind: 'no_viable_day' };
}

export interface RedistributionInput {
  plan: WeeklyPlan;
  /** Local date (YYYY-MM-DD) used to define "past" vs "future". */
  todayLocal: string;
  /**
   * Optional weights override. The defaults are tuned for the cut-priority,
   * theme-stable use case described in the module header. Bulks may want to
   * weight `volumeRoom` higher (more capacity to absorb stimulus).
   */
  weights?: Partial<{
    themeCompat: number;
    volumeRoom: number;
    recoveryDist: number;
  }>;
  /**
   * Per-muscle weekly working-set cap used by `volumeRoom`. If not provided,
   * defaults to 22 sets/week per muscle group — the high end of MAV in the
   * Schoenfeld/Helms guidance for advanced trainees. Conservative for safety.
   */
  perMuscleWeeklyCap?: number;
}

// ─────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────

const DEFAULT_WEIGHTS = {
  themeCompat: 0.5,
  volumeRoom: 0.3,
  recoveryDist: 0.2,
};

const DEFAULT_PER_MUSCLE_WEEKLY_CAP = 22;

/** Normalise a muscle name for case-insensitive comparison. */
function norm(s: string | null | undefined): string {
  return String(s ?? '').trim().toLowerCase();
}

/**
 * True if `day` should count as "missed":
 *   - planDate is strictly before `todayLocal`
 *   - not a rest day
 *   - has a planned workout that wasn't completed
 *
 * `dayStatus === 'skipped'` (when explicit) also qualifies regardless of date,
 * but at the time of writing nothing in the codebase writes that value, so the
 * implicit definition is what bites in production.
 */
function isMissed(day: WeeklyPlanDay, todayLocal: string): boolean {
  if (day.dayStatus === 'completed') return false;
  if (day.isRestDay) return false;
  if (!day.plannedWorkout) return false;
  if (day.dayStatus === 'skipped') return true;
  return day.planDate < todayLocal;
}

/** Future, trainable, non-completed candidate days only. */
function isCandidateDay(day: WeeklyPlanDay, todayLocal: string): boolean {
  if (day.isRestDay) return false;
  if (day.dayStatus === 'completed') return false;
  if (!day.plannedWorkout) return false;
  return day.planDate >= todayLocal;
}

/**
 * Returns 1.0 if the missed primary IS the candidate's primary (perfect match,
 * but rare without theme replacement), 0.7 if it's an allowed accessory, 0.0
 * otherwise. The 0.7 tier is what enables "push chest into arm/shoulder day"
 * without overwriting that day's identity.
 */
function themeCompatScore(
  candidateTheme: DayTheme | null | undefined,
  missedPrimary: string,
): number {
  if (!candidateTheme || !missedPrimary) return 0;
  const primary = norm(candidateTheme.primary);
  if (primary === norm(missedPrimary)) return 1.0;
  const allowed = (candidateTheme.allowedAccessories ?? []).map(norm);
  if (allowed.includes(norm(missedPrimary))) return 0.7;
  // Family fallback: chest day accepts upper_chest, mid_chest, lower_chest.
  const family = familyOf(norm(missedPrimary));
  if (familyOf(primary) === family) return 0.85;
  if (allowed.some(g => familyOf(g) === family)) return 0.6;
  return 0;
}

/**
 * Map a granular muscle key to its broader family so theme matching can be
 * lenient where it should be (chest is chest), strict where it shouldn't
 * (quads ≠ glutes for a posterior-chain dominant day).
 */
function familyOf(group: string): string {
  if (!group) return '';
  if (group.endsWith('_chest')) return 'chest';
  if (group.startsWith('back_') || group.endsWith('_traps')) return 'back';
  if (group === 'quadriceps' || group === 'hamstrings' || group === 'glutes') return 'legs';
  if (group === 'calves' || group === 'tibialis_anterior') return 'lower_leg';
  if (group.endsWith('_deltoid')) return 'shoulders';
  if (group === 'biceps' || group === 'triceps' || group === 'forearms') return 'arms';
  if (group === 'abs' || group === 'obliques' || group === 'core') return 'core';
  return group;
}

/**
 * Sum of working sets across the entire week (planned, not completed-only) for
 * a given muscle group. Used as the "where is volume already concentrated"
 * signal for `volumeRoom`.
 */
function weeklyVolumeForMuscle(plan: WeeklyPlan, muscle: string): number {
  const m = norm(muscle);
  if (!m) return 0;
  let total = 0;
  for (const day of plan.days) {
    const w = day.plannedWorkout;
    if (!w) continue;
    for (const ex of w.exercises) {
      if (ex.isCardio) continue;
      if (norm(ex.targetMuscleGroup) === m) total += ex.sets;
    }
  }
  return total;
}

/**
 * `volumeRoom` ∈ [0, 1]: 1.0 = no volume on this muscle this week, 0.0 = at or
 * over the weekly cap. We add the proposed `addSets` *to the candidate* for
 * the purpose of scoring, so a candidate that would push the muscle past cap
 * scores as 0 and falls down the ranking automatically.
 */
function volumeRoomScore(currentWeeklyVolume: number, addSets: number, cap: number): number {
  const projected = currentWeeklyVolume + addSets;
  if (projected >= cap) return 0;
  if (projected <= 0) return 1;
  return Math.max(0, Math.min(1, 1 - projected / cap));
}

/**
 * `recoveryDist` ∈ [0, 1]: distance, in days, from the closest *other* day
 * that already trains the missed primary. 0 days apart (back-to-back) = 0.0,
 * 2 days = 1.0. 48h is the textbook minimum between sessions on the same
 * primary; we use that as the saturation point.
 */
function recoveryDistScore(
  candidateDate: string,
  missedPrimary: string,
  plan: WeeklyPlan,
): number {
  const m = norm(missedPrimary);
  if (!m) return 1;
  const cand = parseISO(candidateDate);
  let minDist = Number.POSITIVE_INFINITY;
  for (const d of plan.days) {
    if (d.planDate === candidateDate) continue;
    if (d.isRestDay) continue;
    const w = d.plannedWorkout;
    if (!w) continue;
    const trainsThis = w.exercises.some(
      ex => !ex.isCardio && (norm(ex.targetMuscleGroup) === m || familyOf(norm(ex.targetMuscleGroup)) === familyOf(m))
    );
    if (!trainsThis) continue;
    const other = parseISO(d.planDate);
    const dist = Math.abs((cand.getTime() - other.getTime()) / (24 * 3600 * 1000));
    if (dist < minDist) minDist = dist;
  }
  if (!Number.isFinite(minDist)) return 1; // no other day trains it → max recovery
  // Saturate at 2 days. Linear ramp below.
  return Math.max(0, Math.min(1, minDist / 2));
}

/** ISO `YYYY-MM-DD` → Date at local midnight (DST-safe enough for day math). */
function parseISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(n => parseInt(n, 10));
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/**
 * Sum of working sets prescribed for a workout, used to express "what was
 * missed" in volume terms. Does not include cardio (cardio loss is a separate
 * conversation handled by the cardio coverage invariant).
 */
function workingSetsOf(day: WeeklyPlanDay): number {
  const w = day.plannedWorkout;
  if (!w) return 0;
  return w.exercises.filter(e => !e.isCardio).reduce((s, e) => s + e.sets, 0);
}

// ─────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────

/**
 * Detect every missed day in the plan. Pure; safe to call on every render.
 *
 * Caveat: dayStatus is the source of truth when present. When it is not
 * (legacy plans, plans synced before Phase 1), we fall back to the implicit
 * "past + planned + not completed" rule. If your UI distinguishes between
 * "user explicitly skipped" and "engine inferred miss", read `dayStatus`
 * directly — this function intentionally collapses both into one bucket.
 */
export function detectMissedDays(plan: WeeklyPlan, todayLocal: string): MissedDay[] {
  const out: MissedDay[] = [];
  for (const day of plan.days) {
    if (!isMissed(day, todayLocal)) continue;
    const w = day.plannedWorkout;
    const sets = workingSetsOf(day);
    const minutes = w?.estimatedDurationMinutes ?? day.estimatedMinutes ?? 0;
    out.push({
      planDate: day.planDate,
      dayName: day.dayName,
      dayOfWeek: day.dayOfWeek,
      theme: day.dayTheme ?? null,
      summary: day.dayTheme?.primary
        ? `${day.dayName} (${familyOf(norm(day.dayTheme.primary))} day) — ${sets} sets, ${Math.round(minutes)} min`
        : `${day.dayName} — ${sets} sets, ${Math.round(minutes)} min`,
      missedWorkingSets: sets,
      missedMinutes: Math.round(minutes),
    });
  }
  return out;
}

/**
 * Propose where each missed day's stimulus should land. Returns one
 * `RedistributionProposal` per missed day.
 *
 * `addSets` defaults to `min(3, ceil(missedSets / 4))` — a deliberately
 * conservative dose. We are augmenting an already-programmed day, not
 * doubling it. The user will likely accept 2–3 added sets but reject 6.
 */
export function proposeRedistributions(
  input: RedistributionInput,
): RedistributionProposal[] {
  const { plan, todayLocal } = input;
  const weights = { ...DEFAULT_WEIGHTS, ...(input.weights ?? {}) };
  const cap = input.perMuscleWeeklyCap ?? DEFAULT_PER_MUSCLE_WEEKLY_CAP;

  const missed = detectMissedDays(plan, todayLocal);
  if (missed.length === 0) return [];

  // Pre-compute candidate days once; they're reused per missed-day.
  const candidates = plan.days.filter(d => isCandidateDay(d, todayLocal));

  const proposals: RedistributionProposal[] = [];
  for (const m of missed) {
    const missedPrimary = m.theme?.primary ?? '';
    const addSets = Math.min(3, Math.max(2, Math.ceil(m.missedWorkingSets / 4)));

    if (!missedPrimary || candidates.length === 0) {
      proposals.push({ missedDay: m, candidates: [], suggestedAction: { kind: 'no_viable_day' } });
      continue;
    }

    const currentMuscleVolume = weeklyVolumeForMuscle(plan, missedPrimary);

    const scored: RedistributionCandidate[] = candidates.map(c => {
      const themeCompat = themeCompatScore(c.dayTheme, missedPrimary);
      const volumeRoom = volumeRoomScore(currentMuscleVolume, addSets, cap);
      const recoveryDist = recoveryDistScore(c.planDate, missedPrimary, plan);
      const score =
        weights.themeCompat * themeCompat +
        weights.volumeRoom * volumeRoom +
        weights.recoveryDist * recoveryDist;

      return {
        planDate: c.planDate,
        dayName: c.dayName,
        existingTheme: c.dayTheme ?? null,
        score,
        components: { themeCompat, volumeRoom, recoveryDist },
        rationale: rationaleFor(c, missedPrimary, themeCompat, recoveryDist),
      };
    });

    // Drop incompatible candidates entirely (themeCompat 0 → cannot host the
    // missed primary at all). Then sort by score desc, break ties by date asc.
    const viable = scored
      .filter(c => c.components.themeCompat > 0)
      .sort((a, b) => b.score - a.score || a.planDate.localeCompare(b.planDate));

    if (viable.length === 0) {
      proposals.push({ missedDay: m, candidates: [], suggestedAction: { kind: 'no_viable_day' } });
      continue;
    }

    const top = viable[0];
    proposals.push({
      missedDay: m,
      candidates: viable,
      suggestedAction: {
        kind: 'augment',
        targetDate: top.planDate,
        primaryMuscle: missedPrimary,
        addSets,
      },
    });
  }
  return proposals;
}

/**
 * Result of applying a redistribution proposal.
 *
 *   - `applied: true`  — at least one exercise on the target day was bumped.
 *     `plan` is the updated plan (immutable copy).
 *   - `applied: false` — no exercise on the target day matched the missed
 *     primary's muscle family, so nothing to bump. UI should fall back to
 *     showing "no viable insertion point" or trigger a regen.
 *
 * Why no regen: the user explicitly asked for stability. We add sets to
 * existing exercises rather than synthesising new ones because (a) the user
 * already approved those exercises by virtue of them being on the plan,
 * (b) it preserves the day's flow / superset structure, and (c) it costs
 * zero engine cycles.
 *
 * Edge case worth flagging: bumping `sets` on an exercise will push the
 * day's estimated minutes up. The `single_exercise_volume_cap` invariant
 * will fire on the next regen pass if a bump pushes a single exercise past
 * 40% of total volume; that's correct behaviour — the user can re-evaluate.
 */
export interface ApplyRedistributionResult {
  applied: boolean;
  plan: WeeklyPlan;
  /** Exercises that were modified, for the UI's confirmation toast. */
  modified: Array<{ planDate: string; exerciseName: string; oldSets: number; newSets: number }>;
}

/**
 * Apply a `RedistributionProposal['suggestedAction']` of kind `'augment'` to
 * a plan. Pure: returns a new plan object; the input is not mutated.
 *
 * Strategy:
 *   1. Find non-cardio exercises on `targetDate` whose `targetMuscleGroup`
 *      matches the missed primary OR shares its family (chest day accepts
 *      mid_chest, upper_chest, etc.).
 *   2. Distribute `addSets` across those exercises in proportion to their
 *      current sets, with a per-exercise cap of +2 to avoid blowing through
 *      the single-exercise volume invariant.
 *   3. If no candidates exist on the target day, bail out (`applied: false`).
 *      The caller is responsible for surfacing this and (optionally) asking
 *      the engine to insert a new exercise — that path is intentionally not
 *      automated here because exercise selection is the engine's job.
 */
export function applyRedistribution(
  plan: WeeklyPlan,
  action: Extract<RedistributionProposal['suggestedAction'], { kind: 'augment' }>,
): ApplyRedistributionResult {
  const targetIdx = plan.days.findIndex(d => d.planDate === action.targetDate);
  if (targetIdx < 0) return { applied: false, plan, modified: [] };
  const targetDay = plan.days[targetIdx];
  const w = targetDay.plannedWorkout;
  if (!w) return { applied: false, plan, modified: [] };

  const missedFamily = familyOf(norm(action.primaryMuscle));
  const candidates = w.exercises
    .map((ex, idx) => ({ ex, idx }))
    .filter(({ ex }) => {
      if (ex.isCardio) return false;
      const g = norm(ex.targetMuscleGroup);
      return g === norm(action.primaryMuscle) || familyOf(g) === missedFamily;
    });

  if (candidates.length === 0) return { applied: false, plan, modified: [] };

  // Distribute addSets in proportion to current sets, with +2 per-exercise cap.
  const totalCurrent = candidates.reduce((s, c) => s + c.ex.sets, 0) || 1;
  let remaining = action.addSets;
  const bumpsByIdx = new Map<number, number>();
  for (const c of candidates) {
    if (remaining <= 0) break;
    const share = Math.min(2, Math.max(1, Math.round((c.ex.sets / totalCurrent) * action.addSets)));
    const bump = Math.min(share, remaining);
    bumpsByIdx.set(c.idx, bump);
    remaining -= bump;
  }
  // Spill any leftover onto the highest-volume candidate (still capped at +2).
  if (remaining > 0) {
    const sorted = [...candidates].sort((a, b) => b.ex.sets - a.ex.sets);
    for (const c of sorted) {
      if (remaining <= 0) break;
      const current = bumpsByIdx.get(c.idx) ?? 0;
      const room = 2 - current;
      if (room <= 0) continue;
      const extra = Math.min(room, remaining);
      bumpsByIdx.set(c.idx, current + extra);
      remaining -= extra;
    }
  }

  const modified: ApplyRedistributionResult['modified'] = [];
  const newExercises = w.exercises.map((ex, idx) => {
    const bump = bumpsByIdx.get(idx);
    if (!bump) return ex;
    const oldSets = ex.sets;
    const newSets = oldSets + bump;
    modified.push({ planDate: targetDay.planDate, exerciseName: ex.exerciseName, oldSets, newSets });
    return {
      ...ex,
      sets: newSets,
      adjustments: [
        ...(ex.adjustments ?? []),
        `Redistribution: +${bump} sets to absorb missed ${familyOf(norm(action.primaryMuscle))} day.`,
      ],
    };
  });

  if (modified.length === 0) return { applied: false, plan, modified: [] };

  const newDay: WeeklyPlanDay = {
    ...targetDay,
    plannedWorkout: { ...w, exercises: newExercises },
    dayStatus: targetDay.dayStatus === 'completed' ? 'completed' : 'adapted',
  };
  const newDays = plan.days.map((d, i) => (i === targetIdx ? newDay : d));
  return { applied: true, plan: { ...plan, days: newDays }, modified };
}

function rationaleFor(
  candidate: WeeklyPlanDay,
  missedPrimary: string,
  themeCompat: number,
  recoveryDist: number,
): string {
  const themeName = candidate.dayTheme?.primary
    ? familyOf(norm(candidate.dayTheme.primary))
    : 'flexible';
  const missedFamily = familyOf(norm(missedPrimary));
  if (themeCompat >= 1) {
    return `${candidate.dayName} is already a ${missedFamily} day — extra volume fits naturally.`;
  }
  if (themeCompat >= 0.85) {
    return `${candidate.dayName} (${themeName}) shares the ${missedFamily} family — safe to absorb.`;
  }
  if (themeCompat >= 0.7) {
    return `${candidate.dayName} (${themeName}) lists ${missedFamily} as an allowed accessory.`;
  }
  if (recoveryDist >= 1) {
    return `${candidate.dayName} is well-spaced from your other ${missedFamily} sessions.`;
  }
  return `${candidate.dayName} (${themeName}) — partial fit.`;
}
