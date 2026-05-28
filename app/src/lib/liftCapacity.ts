/**
 * Unified Performance Model — single capacity signal per exercise.
 *
 * Previously weight came from competing authorities (progression e1RM,
 * learned median, ratio fallback, invariants). This module merges them
 * into one `estimated1RM` per exercise and closes the loop from
 * prescribed-vs-actual execution deltas.
 */

import type { TrainingProfile, ExerciseProgression, ExercisePreference } from './trainingAnalysis';

export interface ExerciseExecutionDeltaV1 {
  avgWeightDeviation: number;
  avgRepsDeviation: number;
  sampleSize: number;
  completionRate: number;
}

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
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    out[key] = {
      avgWeightDeviation: mean(agg.weightDev),
      avgRepsDeviation: mean(agg.repsDev),
      sampleSize: Math.max(agg.weightDev.length, agg.repsDev.length, agg.prescribed),
      completionRate: agg.prescribed > 0 ? agg.completed / agg.prescribed : 0,
    };
  }
  return out;
}

function learnedToE1rm(pref: ExercisePreference): number | null {
  if (pref.learnedWeight == null || pref.learnedWeight <= 0) return null;
  if (pref.learnedReps == null || pref.learnedReps <= 0) return null;
  const reps = Math.max(1, Math.round(pref.learnedReps));
  const effectiveReps = reps + 1; // assume ~1 RIR on logged working sets
  return pref.learnedWeight * (1 + effectiveReps / 30);
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

  // Close the weight loop: execution deltas adjust e1RM directly (not just reps).
  const exDev = executionDelta;
  const wDev = exDev && exDev.sampleSize >= 2
    ? exDev.avgWeightDeviation
    : (globalCompliance >= 0.55 ? globalWeightDev : 0);
  const completion = exDev?.completionRate ?? globalCompliance;

  if (wDev > 0.04 && completion >= 0.6) {
    // User consistently lifts heavier than prescribed — raise capacity.
    // Cap boost at +12% per cycle to avoid one heroic session overshooting.
    const boost = clamp(wDev * 0.85, 0.04, 0.12);
    e1rm = e1rm * (1 + boost);
    source = 'execution_boost';
    confidence = clamp(confidence + 0.05, 0, 0.95);
  } else if (wDev < -0.08 && completion < 0.65) {
    const cut = clamp(Math.abs(wDev) * 0.5, 0.03, 0.08);
    e1rm = e1rm * (1 - cut);
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
