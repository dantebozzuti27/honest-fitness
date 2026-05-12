/**
 * Workout Invariant Pipeline
 * ──────────────────────────
 *
 * A workout invariant is a pure boolean predicate over a `GeneratedWorkout`
 * with an optional auto-fix. Invariants are run in priority order by
 * `runInvariantPipeline`, with auto-fixes applied between checks. The
 * pipeline runs to a fixed point (bounded by `maxPasses`) so a fix from one
 * invariant can be observed by later checks.
 *
 * Why this exists
 *   The previous engine scattered "validate this, then fix it" logic across
 *   `validateAndCorrect`, `optimizePrescription`, and ad-hoc clamps inside
 *   `stepPrescribe`. There was no single place to (a) audit which checks ran,
 *   (b) reason about precedence, or (c) add a new check without surgery on
 *   1,000-line functions. Centralising the contract here makes invariants
 *   first-class, individually testable, and trivial to extend.
 *
 * Design choices
 *   - Pure functions only. An invariant must not read or mutate global state;
 *     all dependencies arrive through `WorkoutInvariantContext`.
 *   - Auto-fixes return a *new* workout (immutable update). Callers should
 *     treat the input as read-only.
 *   - Severity is two-level (`error` vs `warning`). Errors that survive the
 *     final pass are surfaced to the caller; warnings are informational and
 *     do not block.
 *   - The pipeline is *deterministic*. No randomness, no LLM calls, no I/O.
 *     This is the layer the user explicitly asked to keep cheap and
 *     predictable. LLM annotation lives one level up as a soft reviewer.
 *
 * Failure modes worth naming
 *   - Auto-fixes that *introduce* a new violation will re-trigger on the next
 *     pass. With `maxPasses = 2` this is bounded; if a pair of invariants
 *     thrashes against each other we leak both violations and let the caller
 *     decide. Add an integration test if you wire two fixers that touch the
 *     same field.
 *   - An invariant that depends on context that wasn't passed (e.g. a
 *     `dayTheme` invariant when no theme was supplied) MUST be a no-op, not
 *     an error. Missing context is not a violation.
 */

import type { GeneratedWorkout, BodyAssessment, UserPreferences, DayTheme } from './workoutEngine';
import type { TrainingProfile } from './trainingAnalysis';
import type { ModelConfig } from './modelConfig';

export type { DayTheme };

/**
 * Aggregate weekly cardio coverage so per-day invariants can know whether
 * the cardio modality already in this workout is *required* or *optional*.
 * In a cut, every training day should carry cardio; in bulk/maintain, only
 * `requiredDays` of the week need it.
 */
export interface WeeklyCardioContext {
  /** Total cardio sessions required this week (e.g. 7 on a cut, 3 on bulk). */
  requiredDaysThisWeek: number;
  /** Cardio sessions already counted in earlier days of the week. */
  coveredDaysSoFar: number;
  /** True if cardio in *this* day is required vs nice-to-have. */
  cardioRequiredToday: boolean;
}

export interface WorkoutInvariantContext {
  profile: TrainingProfile;
  preferences: UserPreferences;
  cfg: ModelConfig;
  bodyAssessment?: BodyAssessment | null;
  /** Optional — when omitted, theme-coherence invariant is a no-op. */
  dayTheme?: DayTheme | null;
  /** Optional — when omitted, weekly cardio invariant is a no-op. */
  weeklyCardio?: WeeklyCardioContext | null;
  /**
   * Active monthly fitness focus muscle (canonical, lowercase).
   *
   * The monthly-focus contract is "this muscle gets layered into every
   * workout, no matter what." So invariants like `theme_coherence` that
   * normally drop off-theme strength work MUST exempt this muscle —
   * otherwise the focus slot the engine deliberately appends gets killed
   * the moment it goes into a day whose schedule theme doesn't already
   * cover it (e.g. layered biceps on a chest/triceps push day).
   *
   * `null`/undefined when no monthly focus is configured for the planning
   * date.
   */
  monthlyFocusMuscle?: string | null;
}

export type InvariantSeverity = 'error' | 'warning';

export interface WorkoutInvariantViolation {
  invariantId: string;
  severity: InvariantSeverity;
  message: string;
  /** Index into `workout.exercises` when the violation is exercise-scoped. */
  exerciseIndex?: number;
  /** Free-form structured payload for callers that want machine-readable detail. */
  details?: Record<string, unknown>;
}

export interface WorkoutInvariantFixOutcome {
  /**
   * The (possibly modified) workout. Returning the same reference signals
   * "no change"; returning `null` signals "no fix possible — surface the
   * violation".
   */
  modifiedWorkout: GeneratedWorkout | null;
  /** Human-readable notes for inclusion in `adjustments[]` on affected exercises. */
  notes: string[];
}

export interface WorkoutInvariant {
  id: string;
  description: string;
  /** Pure check; MUST NOT mutate the workout. */
  check(workout: GeneratedWorkout, ctx: WorkoutInvariantContext): WorkoutInvariantViolation[];
  /** Optional auto-fix; called only when `check` reports violations. */
  autoFix?(
    workout: GeneratedWorkout,
    violations: WorkoutInvariantViolation[],
    ctx: WorkoutInvariantContext,
  ): WorkoutInvariantFixOutcome;
}

export interface InvariantPipelineResult {
  workout: GeneratedWorkout;
  /** Violations remaining after all passes (errors are blocking, warnings informational). */
  violations: WorkoutInvariantViolation[];
  /** Notes accumulated from auto-fixes across all passes. */
  notes: string[];
  /** True iff no `error`-severity violations remain. */
  passed: boolean;
  /** Number of passes the pipeline used (1..maxPasses). Useful for logging. */
  passesUsed: number;
}

/**
 * Run a fixed-point invariant pipeline.
 *
 * Algorithm:
 *   pass = 0
 *   while pass < maxPasses:
 *     run every invariant against current workout
 *     for each invariant with violations:
 *       if it has an autoFix and the fix returns a new workout:
 *         apply, accumulate notes, continue
 *       else:
 *         accumulate violations
 *     if no violations were accumulated this pass: break
 *
 * `maxPasses = 2` is the right default: pass 1 applies fixes, pass 2 verifies.
 * Higher values risk masking thrashing fixers. Don't increase without a test.
 */
export function runInvariantPipeline(
  workout: GeneratedWorkout,
  ctx: WorkoutInvariantContext,
  invariants: readonly WorkoutInvariant[],
  maxPasses = 2,
): InvariantPipelineResult {
  let current = workout;
  const allNotes: string[] = [];
  let violations: WorkoutInvariantViolation[] = [];
  let pass = 0;

  for (pass = 0; pass < maxPasses; pass++) {
    violations = [];
    let appliedFixThisPass = false;

    for (const inv of invariants) {
      const found = inv.check(current, ctx);
      if (found.length === 0) continue;

      if (inv.autoFix) {
        const fix = inv.autoFix(current, found, ctx);
        if (fix.modifiedWorkout && fix.modifiedWorkout !== current) {
          current = fix.modifiedWorkout;
          allNotes.push(...fix.notes);
          appliedFixThisPass = true;
          continue;
        }
      }
      violations.push(...found);
    }

    // No new fixes in this pass means another loop won't change anything.
    if (!appliedFixThisPass) break;
  }

  return {
    workout: current,
    violations,
    notes: allNotes,
    passed: violations.every(v => v.severity !== 'error'),
    passesUsed: pass + 1,
  };
}

/**
 * Convenience: filter violations by severity. Useful for callers that want
 * to log warnings but only block on errors.
 */
export function violationsBySeverity(
  result: InvariantPipelineResult,
): { errors: WorkoutInvariantViolation[]; warnings: WorkoutInvariantViolation[] } {
  return {
    errors: result.violations.filter(v => v.severity === 'error'),
    warnings: result.violations.filter(v => v.severity === 'warning'),
  };
}

// ────────────────────────────────────────────────────────────────────────
// Concrete invariants (Phase 5c)
// ────────────────────────────────────────────────────────────────────────
//
// Each invariant below is a deterministic, pure check. They are deliberately
// simple — complicated multi-objective reasoning belongs in selection /
// prescription, not here. The job of an invariant is to prevent a *known*
// failure mode from shipping, with a clear, auditable note explaining what
// happened and why.
//
// Wiring: `generateWorkout` builds the context and runs `runInvariantPipeline`
// with `DEFAULT_WORKOUT_INVARIANTS` after `validateAndCorrect` and before
// `stepGenerateRationale`.

const STRENGTH_GROUPS = new Set<string>([
  'mid_chest', 'upper_chest', 'lower_chest',
  'back_lats', 'back_upper', 'upper_traps', 'mid_traps', 'lower_traps',
  'anterior_deltoid', 'lateral_deltoid', 'posterior_deltoid',
  'biceps', 'triceps', 'forearms',
  'quadriceps', 'hamstrings', 'glutes',
  'calves', 'core', 'abductors', 'adductors', 'hip_flexors',
  'rotator_cuff', 'erector_spinae',
]);

/**
 * Theme coherence — when a `dayTheme` is set, every non-cardio exercise must
 * target either the theme's primary or one of its allowed accessories.
 * `schedule` and `rotation` themes use error severity and auto-drop off-theme
 * lifts. `default` stays warning-only so ambiguous history-based days are not
 * stripped to empty sessions.
 *
 * Cardio is unconditionally allowed. So are universally-permissible muscles
 * like `core`, `calves`, and `cardio` itself (handled inside the engine via
 * `UNIVERSAL_ACCESSORIES`; mirrored implicitly here by the allowedAccessories
 * the theme was built with).
 */
export const themeCoherenceInvariant: WorkoutInvariant = {
  id: 'theme_coherence',
  description: 'Every exercise must fit the day\'s primary theme + allowed accessories.',
  check(workout, ctx) {
    if (!ctx.dayTheme) return [];
    const theme = ctx.dayTheme;
    const allowed = new Set([
      String(theme.primary).toLowerCase(),
      ...theme.allowedAccessories.map(g => String(g).toLowerCase()),
    ]);
    const severity: InvariantSeverity =
      theme.source === 'schedule' || theme.source === 'rotation' ? 'error' : 'warning';
    const violations: WorkoutInvariantViolation[] = [];
    workout.exercises.forEach((ex, idx) => {
      if (ex.isCardio) return;
      // Hard user contract: an exercise marked undroppable at selection
      // time is always allowed, regardless of theme. The engine put it
      // there deliberately (today this is monthly fitness focus; the
      // shape generalises to future "must include" features). The
      // muscle-group-specific exemption that used to live here is now
      // obsolete — the flag travels with the exercise.
      if (ex.isUndroppable) return;
      const group = String(ex.targetMuscleGroup ?? '').toLowerCase();
      if (!group) return;
      if (!STRENGTH_GROUPS.has(group)) return; // only enforce on muscle-targeted strength work
      if (allowed.has(group)) return;
      violations.push({
        invariantId: 'theme_coherence',
        severity,
        exerciseIndex: idx,
        message: `${ex.exerciseName} targets "${group}" which is outside today's "${theme.primary}" theme (source: ${theme.source})`,
        details: { primary: theme.primary, themeSource: theme.source, group },
      });
    });
    return violations;
  },
  autoFix(workout, violations, _ctx) {
    // Auto-drop for schedule- or rotation-sourced theme errors. For warnings, do nothing.
    const dropIndices = new Set(
      violations.filter(v => v.severity === 'error').map(v => v.exerciseIndex!).filter(i => Number.isInteger(i)),
    );
    if (dropIndices.size === 0) return { modifiedWorkout: null, notes: [] };
    const kept = workout.exercises.filter((_, idx) => !dropIndices.has(idx));
    const droppedNames = workout.exercises
      .filter((_, idx) => dropIndices.has(idx))
      .map(ex => ex.exerciseName);
    return {
      modifiedWorkout: { ...workout, exercises: kept },
      notes: [`Theme guard: dropped ${droppedNames.join(', ')} — not in today's theme.`],
    };
  },
};

/**
 * Rep×Load identity guard (post-hoc verification).
 *
 * The selection-time guards (`stepPrescribe` Phase 0) should already catch
 * any unsafe weight×reps pairing. This invariant is the *backstop* — it
 * verifies the final workout has zero exercises whose `targetWeight` exceeds
 * what the user can move for `targetReps + targetRir` reps, given a derived
 * 1RM reference. If it fires, something upstream regressed; we still clamp
 * deterministically so the user is never asked to do an impossible set.
 */
export const repLoadVs1RMInvariant: WorkoutInvariant = {
  id: 'rep_load_vs_1rm',
  description: 'No prescribed weight may exceed Epley_inverse(e1RM, reps + RIR) × safetyMargin.',
  check(workout, ctx) {
    const margin = clampNumber(ctx.cfg.repLoadSafetyMargin, 0.5, 1.0);
    const violations: WorkoutInvariantViolation[] = [];
    workout.exercises.forEach((ex, idx) => {
      if (ex.isCardio || ex.isBodyweight) return;
      if (!ex.targetWeight || !ex.targetReps) return;
      // Find the user's e1RM signal for this exercise.
      const nameKey = ex.exerciseName.toLowerCase();
      const prog = ctx.profile.exerciseProgressions?.find(p => p.exerciseName.toLowerCase() === nameKey);
      const pref = ctx.profile.exercisePreferences?.find(p => p.exerciseName.toLowerCase() === nameKey);
      const e1rm = prog?.estimated1RM && prog.estimated1RM > 0
        ? prog.estimated1RM
        : (pref?.learnedWeight && pref?.learnedReps && pref.learnedWeight > 0 && pref.learnedReps > 0
          ? pref.learnedWeight * (1 + Math.max(1, Math.round(pref.learnedReps)) / 30)
          : null);
      if (e1rm == null) return;
      // RIR may be null (cardio, holds). Treat null as 0 for the safety check —
      // i.e. assume the user is grinding to failure. This is the most
      // conservative possible reading and matches how the prescriber treats
      // missing RIR upstream.
      const rirEffective = ex.targetRir ?? 0;
      const ceiling = e1rm / (1 + (ex.targetReps + rirEffective) / 30);
      const safeCeiling = ceiling * margin;
      if (ex.targetWeight > safeCeiling) {
        violations.push({
          invariantId: 'rep_load_vs_1rm',
          severity: 'error',
          exerciseIndex: idx,
          message: `${ex.exerciseName}: ${ex.targetWeight}lbs × ${ex.targetReps} @ RIR ${rirEffective} exceeds safe ceiling ${Math.round(safeCeiling)}lbs (e1RM ${Math.round(e1rm)})`,
          details: { e1rm, ceiling, safeCeiling, prescribed: ex.targetWeight },
        });
      }
    });
    return violations;
  },
  autoFix(workout, violations, _ctx) {
    if (violations.length === 0) return { modifiedWorkout: null, notes: [] };
    const exercises = workout.exercises.slice();
    const notes: string[] = [];
    for (const v of violations) {
      const idx = v.exerciseIndex;
      if (idx == null || idx < 0 || idx >= exercises.length) continue;
      const safeCeiling = Number((v.details ?? {}).safeCeiling);
      if (!Number.isFinite(safeCeiling) || safeCeiling <= 0) continue;
      const ex = exercises[idx];
      // Floor (not round) is mandatory — rounding can land 1 lb above the
      // ceiling and re-trigger the violation on the next pass. Floor is the
      // only function that guarantees `clamped ≤ safeCeiling`.
      const clamped = Math.max(0, Math.floor(safeCeiling));
      exercises[idx] = {
        ...ex,
        targetWeight: clamped,
        adjustments: [
          ...(ex.adjustments ?? []),
          `Invariant clamp (rep_load_vs_1rm): ${ex.targetWeight} → ${clamped} lbs`,
        ],
      };
      notes.push(`${ex.exerciseName}: invariant clamped ${ex.targetWeight} → ${clamped} lbs`);
    }
    return { modifiedWorkout: { ...workout, exercises }, notes };
  },
};

/**
 * Weekly cardio coverage (per-day check).
 *
 * Only fires when `ctx.weeklyCardio.cardioRequiredToday === true` (set by the
 * weekly planner when this day is one of the days that must carry cardio).
 * No auto-fix here — auto-injecting cardio safely requires the cardio
 * prescriber. The violation is informational; the planner's coverage
 * accounting (Phase 2) is the operational signal.
 */
export const weeklyCardioInvariant: WorkoutInvariant = {
  id: 'weekly_cardio_coverage',
  description: 'When this day must carry cardio per weekly policy, the workout must include a cardio exercise.',
  check(workout, ctx) {
    if (!ctx.weeklyCardio || !ctx.weeklyCardio.cardioRequiredToday) return [];
    const hasCardio = workout.exercises.some(ex => ex.isCardio);
    if (hasCardio) return [];
    return [{
      invariantId: 'weekly_cardio_coverage',
      severity: 'warning',
      message:
        `Cardio required today by weekly policy ` +
        `(${ctx.weeklyCardio.coveredDaysSoFar}/${ctx.weeklyCardio.requiredDaysThisWeek} covered so far) ` +
        `but no cardio exercise present.`,
    }];
  },
};

/**
 * Physique deficit priority (warning-only).
 *
 * When `bodyAssessment` flags a clear weak point and the day's theme primary
 * matches that weak point's muscle family, the workout should give that
 * muscle group meaningful volume. This invariant raises a warning when the
 * weak-point group has zero or trivially few sets relative to the rest of
 * the session — it's a signal the physique passthrough (Phase 4) didn't
 * affect selection enough on this particular day.
 *
 * Threshold rationale: "≥ 2 working sets" is the floor for hypertrophy
 * stimulus per Schoenfeld dose-response work; below that, the day can't be
 * said to be addressing the weak point at all.
 */
export const physiqueDeficitPriorityInvariant: WorkoutInvariant = {
  id: 'physique_deficit_priority',
  description: 'When the body assessment flags a deficit that aligns with today\'s theme, that muscle must get ≥2 working sets.',
  check(workout, ctx) {
    if (!ctx.bodyAssessment) return [];
    const themePrimary = String(ctx.dayTheme?.primary ?? '').toLowerCase();
    if (!themePrimary) return [];
    const deficitEntries = Object.entries(ctx.bodyAssessment.proportional_deficits ?? {})
      .filter(([, v]) => typeof v === 'number' && v < -0.10) // 10%+ below ideal
      .map(([k]) => String(k).toLowerCase());
    if (deficitEntries.length === 0) return [];
    // Aligns when any deficit shares its broader family with today's primary
    // (e.g. mid_chest day → upper_chest deficit also counts).
    const familyOf = (group: string): string => {
      if (group.endsWith('_chest')) return 'chest';
      if (group.startsWith('back_') || group.endsWith('_traps')) return 'back';
      if (group === 'quadriceps' || group === 'hamstrings' || group === 'glutes') return 'legs';
      if (group.endsWith('_deltoid')) return 'shoulders';
      return group;
    };
    const themeFamily = familyOf(themePrimary);
    const aligned = deficitEntries.filter(g => familyOf(g) === themeFamily);
    if (aligned.length === 0) return [];

    const violations: WorkoutInvariantViolation[] = [];
    for (const deficitGroup of aligned) {
      const sets = workout.exercises
        .filter(ex => !ex.isCardio && String(ex.targetMuscleGroup).toLowerCase() === deficitGroup)
        .reduce((s, ex) => s + ex.sets, 0);
      if (sets < 2) {
        violations.push({
          invariantId: 'physique_deficit_priority',
          severity: 'warning',
          message:
            `Physique assessment shows ${deficitGroup} as a deficit and today's theme is "${themePrimary}", ` +
            `but the workout has only ${sets} working set(s) on ${deficitGroup}.`,
          details: { deficitGroup, sets },
        });
      }
    }
    return violations;
  },
};

/**
 * Phase 5b — single-exercise volume cap.
 *
 * No single non-cardio exercise should consume >40% of the day's working sets,
 * with a floor of 3 sets so the rule never bites trivially small days. This
 * mirrors the long-standing `validateAndCorrect` check (B4.4) but lifts it
 * into the pipeline so it is auditable and individually testable. Running it
 * here is also a defensive second pass: if any modifier downstream of
 * `validateAndCorrect` re-inflates a single exercise's set count, this catches
 * it before the workout leaves the engine.
 *
 * Why 40%? It's the empirically robust ceiling above which a session
 * effectively becomes a single-exercise workout (one fatigued movement
 * dominates SFR for the whole day). The exact number is less important than
 * having *some* invariant; without one, time-budget trims can concentrate
 * volume on whichever exercise was least trimmed.
 */
export const singleExerciseVolumeCapInvariant: WorkoutInvariant = {
  id: 'single_exercise_volume_cap',
  description: 'No single non-cardio exercise may exceed 40% of the day\'s working sets (with sets > 3).',
  check(workout) {
    const totalSets = workout.exercises
      .filter(e => !e.isCardio)
      .reduce((s, e) => s + e.sets, 0);
    if (totalSets <= 0) return [];
    const violations: WorkoutInvariantViolation[] = [];
    workout.exercises.forEach((ex, idx) => {
      if (ex.isCardio) return;
      if (ex.sets <= 3) return;
      const pct = ex.sets / totalSets;
      if (pct <= 0.4) return;
      const maxAllowed = Math.max(3, Math.floor(totalSets * 0.4));
      if (ex.sets <= maxAllowed) return;
      violations.push({
        invariantId: 'single_exercise_volume_cap',
        severity: 'error',
        exerciseIndex: idx,
        message: `${ex.exerciseName} has ${ex.sets} sets (${Math.round(pct * 100)}% of ${totalSets} total). Cap is ${maxAllowed}.`,
        details: { current: ex.sets, cap: maxAllowed, totalSets, pct },
      });
    });
    return violations;
  },
  autoFix(workout, violations) {
    const next = { ...workout, exercises: workout.exercises.map(e => ({ ...e })) };
    const notes: string[] = [];
    for (const v of violations) {
      if (v.exerciseIndex == null) continue;
      const cap = (v.details as { cap?: number } | undefined)?.cap;
      if (cap == null) continue;
      const ex = next.exercises[v.exerciseIndex];
      if (!ex || ex.sets <= cap) continue;
      const old = ex.sets;
      ex.sets = cap;
      ex.adjustments = [...(ex.adjustments ?? []), `Sets reduced ${old} → ${cap} (single-exercise volume cap)`];
      notes.push(`Capped ${ex.exerciseName} ${old} → ${cap} sets (>40% of day's volume)`);
    }
    if (notes.length === 0) return { modifiedWorkout: null, notes: [] };
    return { modifiedWorkout: next, notes };
  },
};

/**
 * Phase 5b — compound-before-isolation ordering.
 *
 * CNS-tier 1–2 movements (and pattern-tagged compounds) should execute before
 * isolations within the strength block. The classical justification is that
 * compound performance is more sensitive to pre-fatigue: a fatigued triceps
 * tanks bench performance more than a fatigued bench tanks pushdown
 * performance. Running this as an invariant means future modifiers that
 * re-order the list (supersets, partner-pairing, density adjustments) are
 * guaranteed to be re-checked.
 *
 * Auto-fix preserves the relative position of cardio (cardio is appended after
 * the strength block; we don't reorder it).
 */
/**
 * Compound classification heuristic, kept local to this module.
 *
 * `GeneratedExercise` does not carry a `cnsDemandTier` field — the engine
 * computes it on demand from `exerciseName` and `movementPattern` via
 * `classifyCnsDemandFromName`. Re-importing that engine helper would create a
 * value-level cycle, so we use the same two signals here:
 *
 *   1. Movement pattern matches one of the canonical compound patterns
 *      (squat, hinge, lunge, carry, push, pull). This is the highest-quality
 *      signal because it comes from the structured exercise library.
 *   2. Name regex catches the common multi-joint barbell/dumbbell movements
 *      that the library may not have tagged consistently
 *      (bench, squat, deadlift, press, row, pull-up, dip, etc.).
 *
 * False positives are cheap (a misclassified isolation just sits earlier
 * than necessary). False negatives are the failure mode worth caring about,
 * which is why we union the two signals rather than intersect.
 */
const COMPOUND_NAME_RE =
  /\b(bench|squat|deadlift|dead\s*lift|overhead\s*press|ohp|military\s*press|push\s*press|row(?!ing)|pull[- ]?up|chin[- ]?up|dip|clean|snatch|jerk|thruster|lunge|split\s*squat|hip\s*thrust|good\s*morning|farmer)\b/i;
const COMPOUND_PATTERN_SET = new Set([
  'horizontal_push', 'vertical_push', 'horizontal_pull', 'vertical_pull',
  'squat', 'hinge', 'lunge', 'carry', 'compound',
]);

function isCompoundExercise(ex: { exerciseName: string; movementPattern?: string }): boolean {
  const pattern = String(ex.movementPattern ?? '').toLowerCase();
  if (COMPOUND_PATTERN_SET.has(pattern)) return true;
  if (COMPOUND_NAME_RE.test(String(ex.exerciseName ?? ''))) return true;
  return false;
}

export const compoundBeforeIsolationInvariant: WorkoutInvariant = {
  id: 'compound_before_isolation_order',
  description: 'Compound movements must precede isolations within the strength block.',
  check(workout) {
    const strength = workout.exercises.filter(e => !e.isCardio);
    let lastCompoundPos = -1;
    let firstIsolationPos = strength.length;
    strength.forEach((ex, pos) => {
      if (isCompoundExercise(ex)) lastCompoundPos = pos;
      else if (pos < firstIsolationPos) firstIsolationPos = pos;
    });
    if (lastCompoundPos <= firstIsolationPos) return [];
    return [{
      invariantId: 'compound_before_isolation_order',
      severity: 'error' as const,
      message: `Strength ordering violation: a compound appears after an isolation (compound at strength-pos ${lastCompoundPos}, isolation at ${firstIsolationPos}).`,
      details: { lastCompoundPos, firstIsolationPos },
    }];
  },
  autoFix(workout) {
    const cardio = workout.exercises.filter(e => e.isCardio);
    const compounds = workout.exercises.filter(e => !e.isCardio && isCompoundExercise(e));
    const isolations = workout.exercises.filter(e => !e.isCardio && !isCompoundExercise(e));
    // Preserve original relative ordering within each bucket — that ordering
    // already reflects the engine's selection priority (impactScore, role).
    const reordered = [...compounds, ...isolations, ...cardio];
    return {
      modifiedWorkout: { ...workout, exercises: reordered },
      notes: ['Re-sorted strength block: compounds before isolations.'],
    };
  },
};

/**
 * Daily-abs invariant.
 *
 * Every training day should carry at least one direct ab/core exercise,
 * regardless of phase. The selection layer in `stepSelectExercises`
 * enforces this upstream; this invariant exists as a defence-in-depth
 * check that catches cases where validateAndCorrect or a downstream
 * modifier dropped the only core exercise to fit the time budget.
 * Surfaces as a warning (not an auto-fixable error) because re-injecting
 * an exercise post-hoc requires library access that the pipeline doesn't
 * have.
 *
 * Why warning, not error: a missing daily ab on a single workout is a
 * minor stimulus deficit, not a safety issue. We reserve `error` severity
 * for invariants that, if violated, would produce a workout that's
 * actively unsafe or structurally wrong.
 */
export const dailyAbsInvariant: WorkoutInvariant = {
  id: 'daily_abs',
  description: 'Every training day should include at least one direct core/ab exercise.',
  check(workout, ctx) {
    const hasCore = workout.exercises.some(ex => {
      if (ex.isCardio) return false;
      const g = String(ex.targetMuscleGroup ?? '').toLowerCase();
      return g === 'core' || g === 'abs';
    });
    if (hasCore) return [];
    const phase = ctx.profile.bodyWeightTrend?.phase;
    const goal = String(ctx.preferences?.training_goal ?? '').toLowerCase();
    return [{
      invariantId: 'daily_abs',
      severity: 'warning' as const,
      message: 'This training day has no direct ab/core exercise. Daily low-dose ab work is enforced across all phases.',
      details: { phase, goal },
    }];
  },
};

/**
 * Default invariant set, ordered. Order matters when fixers cascade:
 *   1. theme_coherence — drops out-of-theme exercises first so later checks
 *      run against the canonical day shape
 *   2. single_exercise_volume_cap — caps any single exercise dominating volume
 *      (must run before ordering so the post-cap volume is what gets ordered)
 *   3. compound_before_isolation_order — re-orders surviving strength block
 *   4. rep_load_vs_1rm — clamps any unsafe pairings on the surviving exercises
 *   5. weekly_cardio_coverage — informational; runs after structural fixes
 *   6. physique_deficit_priority — informational; advisory layer
 *   7. daily_abs — informational; ab presence check (all phases)
 */
export const DEFAULT_WORKOUT_INVARIANTS: readonly WorkoutInvariant[] = [
  themeCoherenceInvariant,
  singleExerciseVolumeCapInvariant,
  compoundBeforeIsolationInvariant,
  repLoadVs1RMInvariant,
  weeklyCardioInvariant,
  physiqueDeficitPriorityInvariant,
  dailyAbsInvariant,
];

// Local helper — duplicated from workoutEngine to keep this module dependency-free
// at the value level (only types are imported). This avoids the cyclical import
// that would arise if the invariants imported runtime helpers from the engine.
function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
