/**
 * Unified Performance Model — single capacity signal per exercise.
 *
 * Previously weight came from competing authorities (progression e1RM,
 * learned median, ratio fallback, invariants). This module merges them
 * into one `estimated1RM` per exercise and closes the loop from
 * prescribed-vs-actual execution deltas.
 */

import type { TrainingProfile, ExerciseProgression, ExercisePreference } from './trainingAnalysis';
import { learnedPreferenceToE1rm, epley1RMWithRir } from './e1rmEstimation';

export interface ExerciseExecutionDeltaV1 {
  avgWeightDeviation: number;
  avgRepsDeviation: number;
  sampleSize: number;
  completionRate: number;
  /**
   * 0–1 reliability of this delta as a signal. Grows with sample size and
   * shrinks with dispersion. Optional for backward compatibility with
   * hand-constructed deltas in tests.
   */
  confidence?: number;
}

/**
 * Prior strength (in pseudo-observations) for shrinking an execution-delta
 * mean toward zero (the "prescription was correct" null hypothesis).
 *
 * Empirical-Bayes / ridge intuition: the posterior mean under a Normal–Normal
 * model with a zero-centered prior of strength `k` is
 *   (k·0 + n·x̄) / (k + n) = x̄ · n/(n+k).
 * A single heroic (or sandbagged) session no longer swings capacity; the
 * estimate earns its magnitude as evidence accumulates. k=1 keeps this gentle
 * so genuine 2–3 session signals still register.
 */
const DELTA_SHRINKAGE_PRIOR = 1;

/**
 * Capacity confidence at/above which the unified e1RM estimate is trusted
 * exactly. Below it, the estimate is shrunk toward demonstrated capacity in
 * proportion to the confidence deficit. ~0.8 corresponds to roughly 4+ tracked
 * sessions of progression evidence.
 */
const CAPACITY_FULL_TRUST_CONFIDENCE = 0.8;

export interface ExerciseCapacityV1 {
  exerciseName: string;
  /** Unified 1RM estimate (lbs) — sole authority for prescribe. */
  estimated1RM: number;
  /** 0–1 confidence in this estimate. */
  confidence: number;
  lastWorkingWeight: number | null;
  /** Per-exercise execution delta when available. */
  executionDelta: ExerciseExecutionDeltaV1 | null;
  source: 'progression' | 'learned' | 'execution_boost' | 'blended';
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Sample standard deviation (Bessel-corrected); 0 for fewer than 2 points. */
function sampleStdDev(xs: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / n;
  const ss = xs.reduce((a, b) => a + (b - m) * (b - m), 0);
  return Math.sqrt(ss / (n - 1));
}

/** Posterior mean shrunk toward zero by `k` pseudo-observations. */
function shrunkMean(xs: number[], k = DELTA_SHRINKAGE_PRIOR): number {
  const n = xs.length;
  if (n === 0) return 0;
  const raw = xs.reduce((a, b) => a + b, 0) / n;
  return (n * raw) / (n + k);
}

/**
 * Reliability of a deviation series in [0,1]. Two independent discounts:
 *   - sample-size reliability  n/(n+k): more sessions → trust the mean more
 *   - noise penalty 1/(1+SE/ref): a wide spread (large standard error) relative
 *     to a 5% reference band erodes confidence even with many samples.
 */
function deltaConfidence(xs: number[], k = DELTA_SHRINKAGE_PRIOR): number {
  const n = xs.length;
  if (n === 0) return 0;
  const reliability = n / (n + k);
  const se = sampleStdDev(xs) / Math.sqrt(n);
  const noisePenalty = 1 / (1 + se / 0.05);
  return clamp(reliability * noisePenalty, 0, 1);
}

/** e1RM the user has actually demonstrated (peak logged set), used as a
 *  conservative anchor when the unified estimate is uncertain. */
function demonstratedE1rm(
  prog: ExerciseProgression | null | undefined,
  pref: ExercisePreference | null | undefined,
): number | null {
  if (prog?.bestSet && prog.bestSet.weight > 0 && prog.bestSet.reps > 0) {
    return epley1RMWithRir(prog.bestSet.weight, prog.bestSet.reps, 1);
  }
  if (pref?.learnedWeight && pref?.learnedReps) {
    return learnedPreferenceToE1rm(pref.learnedWeight, pref.learnedReps);
  }
  return null;
}

/**
 * Build per-exercise execution deltas from prescribed-vs-actual pairing.
 * Called from trainingAnalysis when computing compliance.
 */
export function aggregateExerciseExecutionDeltas(
  pairs: Array<{
    exerciseName: string;
    prescribedWeight: number | null;
    actualWeight: number | null;
    prescribedReps: number | null;
    actualReps: number | null;
    completed: boolean;
  }>,
): Record<string, ExerciseExecutionDeltaV1> {
  const byEx = new Map<string, {
    weightDev: number[];
    repsDev: number[];
    completed: number;
    prescribed: number;
  }>();

  for (const p of pairs) {
    const key = String(p.exerciseName || '').trim().toLowerCase();
    if (!key) continue;
    if (!byEx.has(key)) {
      byEx.set(key, { weightDev: [], repsDev: [], completed: 0, prescribed: 0 });
    }
    const agg = byEx.get(key)!;
    agg.prescribed += 1;
    if (p.completed) agg.completed += 1;
    if (p.prescribedWeight != null && p.prescribedWeight > 0 && p.actualWeight != null && p.actualWeight > 0) {
      agg.weightDev.push((p.actualWeight - p.prescribedWeight) / p.prescribedWeight);
    }
    if (p.prescribedReps != null && p.actualReps != null) {
      agg.repsDev.push(p.actualReps - p.prescribedReps);
    }
  }

  const out: Record<string, ExerciseExecutionDeltaV1> = {};
  for (const [key, agg] of byEx.entries()) {
    if (agg.prescribed < 1) continue;
    out[key] = {
      avgWeightDeviation: shrunkMean(agg.weightDev),
      avgRepsDeviation: shrunkMean(agg.repsDev),
      sampleSize: Math.max(agg.weightDev.length, agg.repsDev.length, agg.prescribed),
      completionRate: agg.prescribed > 0 ? agg.completed / agg.prescribed : 0,
      confidence: deltaConfidence(agg.weightDev),
    };
  }
  return out;
}

function learnedToE1rm(pref: ExercisePreference): number | null {
  return learnedPreferenceToE1rm(pref.learnedWeight, pref.learnedReps);
}

/**
 * Merge progression, learned, and execution signals into one capacity row.
 */
export function buildExerciseCapacity(
  exerciseName: string,
  prog: ExerciseProgression | null | undefined,
  pref: ExercisePreference | null | undefined,
  executionDelta: ExerciseExecutionDeltaV1 | null | undefined,
  globalWeightDev: number,
  globalCompliance: number,
): ExerciseCapacityV1 | null {
  const key = exerciseName.toLowerCase();
  let e1rm = 0;
  let confidence = 0;
  let source: ExerciseCapacityV1['source'] = 'blended';
  let lastWorkingWeight: number | null = prog?.lastWeight ?? pref?.learnedWeight ?? null;

  if (prog && prog.estimated1RM > 0) {
    e1rm = prog.estimated1RM;
    confidence = clamp(0.45 + prog.sessionsTracked * 0.08, 0.45, 0.92);
    source = 'progression';
  }

  const learnedE1rm = pref && pref.recentSessions >= 3 ? learnedToE1rm(pref) : null;
  if (learnedE1rm != null && learnedE1rm > 0) {
    if (e1rm <= 0) {
      e1rm = learnedE1rm;
      confidence = clamp(0.35 + pref!.recentSessions * 0.06, 0.35, 0.75);
      source = 'learned';
    } else {
      // Blend: trust progression more, but pull toward learned when they disagree modestly
      e1rm = e1rm * 0.72 + learnedE1rm * 0.28;
      source = 'blended';
    }
  }

  if (e1rm <= 0) return null;

  // Sanity: unified e1RM should not exceed 115% of last working weight × rep-capacity
  // (guards mis-logged sets and equipment confusion spikes).
  if (lastWorkingWeight != null && lastWorkingWeight > 0) {
    const repCeiling = lastWorkingWeight * (1 + 8 / 30);
    if (e1rm > repCeiling * 1.15) {
      e1rm = repCeiling * 1.15;
      source = 'blended';
    }
  }

  // Close the weight loop: execution deltas adjust e1RM directly (not just reps).
  const exDev = executionDelta;
  const wDev = exDev && exDev.sampleSize >= 2
    ? exDev.avgWeightDeviation
    : (globalCompliance >= 0.55 ? globalWeightDev : 0);
  const completion = exDev?.completionRate ?? globalCompliance;

  // Evidence weight of the execution signal itself (0 when we fell back to the
  // global deviation, which is a weak per-exercise prior).
  const execEvidence = exDev && exDev.sampleSize >= 2 ? (exDev.confidence ?? 0.5) : 0;

  if (wDev > 0.04 && completion >= 0.6) {
    // User consistently lifts heavier than prescribed — raise capacity.
    // Cap boost at +12% per cycle to avoid one heroic session overshooting.
    const boost = clamp(wDev * 0.85, 0.04, 0.12);
    e1rm = e1rm * (1 + boost);
    source = 'execution_boost';
    // Confidence gain scales with how much evidence backs the boost.
    confidence = clamp(confidence + 0.05 * execEvidence, 0, 0.95);
  } else if (wDev < -0.08 && completion < 0.65) {
    const cut = clamp(Math.abs(wDev) * 0.5, 0.03, 0.08);
    e1rm = e1rm * (1 - cut);
  }

  // Confidence-weighted conservatism: when the unified estimate exceeds what
  // the user has actually demonstrated, pull it back toward the demonstrated
  // peak — but only while the estimate is under-evidenced. At/above the
  // full-trust threshold the estimate is honored exactly; below it, the pull
  // ramps linearly to a full retreat to the anchor at zero confidence. This
  // only ever shrinks downward — it never inflates a weak estimate.
  const anchor = demonstratedE1rm(prog, pref);
  if (anchor != null && anchor > 0 && anchor < e1rm && confidence < CAPACITY_FULL_TRUST_CONFIDENCE) {
    const shrink = (CAPACITY_FULL_TRUST_CONFIDENCE - clamp(confidence, 0, 1)) / CAPACITY_FULL_TRUST_CONFIDENCE;
    e1rm = (1 - shrink) * e1rm + shrink * anchor;
  }

  return {
    exerciseName: key,
    estimated1RM: Math.round(e1rm * 10) / 10,
    confidence,
    lastWorkingWeight,
    executionDelta: exDev ?? null,
    source,
  };
}

export function buildExerciseCapacityIndex(profile: TrainingProfile): Map<string, ExerciseCapacityV1> {
  const index = new Map<string, ExerciseCapacityV1>();
  const globalDev = profile.prescribedVsActual?.avgWeightDeviation ?? 0;
  const globalCompliance = profile.prescribedVsActual?.complianceRate ?? 0.5;
  const exDeltas = profile.exerciseExecutionDeltas ?? {};

  const names = new Set<string>();
  for (const p of profile.exerciseProgressions) names.add(p.exerciseName.toLowerCase());
  for (const p of profile.exercisePreferences) names.add(p.exerciseName.toLowerCase());
  for (const k of Object.keys(exDeltas)) names.add(k.toLowerCase());

  for (const name of names) {
    const prog = profile.exerciseProgressions.find(p => p.exerciseName.toLowerCase() === name);
    const pref = profile.exercisePreferences.find(p => p.exerciseName.toLowerCase() === name);
    const cap = buildExerciseCapacity(
      name,
      prog,
      pref,
      exDeltas[name],
      globalDev,
      globalCompliance,
    );
    if (cap) index.set(name, cap);
  }
  return index;
}

/** Inverse Epley: working weight for target reps @ RIR. */
export function capacityToWorkingWeight(
  estimated1RM: number,
  targetReps: number,
  rir: number,
): number {
  if (estimated1RM <= 0 || targetReps <= 0) return 0;
  const effectiveReps = targetReps + Math.max(0, rir);
  return estimated1RM / (1 + effectiveReps / 30);
}
