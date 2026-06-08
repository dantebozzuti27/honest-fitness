/**
 * Per-muscle-group recovery model.
 *
 * Estimates recovery status for each muscle group based on:
 *   1. Research-based baseline recovery windows (hours since last trained)
 *   2. Synergist fatigue from training adjacent muscle groups
 *   3. Individual recovery rate adjustment (learned from user's data over time)
 *   4. Modifiers from sleep, HRV, RHR, and activity level
 *
 * Sources:
 *   Schoenfeld, Ogborn & Krieger (2016) "Effects of resistance training frequency"
 *   Damas et al. (2019) "Resistance training-induced changes in integrated myofibrillar
 *     protein synthesis are related to hypertrophy only after attenuation of muscle damage"
 *   Helms, Morgan & Valdez — The Muscle & Strength Pyramids
 */

import { resolveMuscleToken } from './exerciseOntology';
import {
  buildMechanicalCouplingEdges,
  computeCardioRecoveryPenalty,
  type CardioMechanicalLoadSignal,
} from './biomechanicsOntology';
import {
  VOLUME_GUIDELINES,
  getGuidelineForGroup,
  type CanonicalMuscleGroup,
} from './volumeGuidelines';

const SYNERGIST_COUPLING_EDGES = buildMechanicalCouplingEdges().filter(
  edge => edge.coupling_kind === 'synergist_fatigue',
);

export interface MuscleRecoveryStatus {
  muscleGroup: CanonicalMuscleGroup;
  hoursSinceLastTrained: number;
  baselineRecoveryHours: number;
  directSetsLastSession: number;
  synergistFatiguePenalty: number;
  cardioMechanicalPenalty: number;
  recoveryModifier: number;
  recoveryPercent: number;
  readyToTrain: boolean;
}

export interface RecoveryContext {
  sleepDurationLastNight: number | null;
  sleepBaseline30d: number | null;
  hrvLastNight: number | null;
  hrvBaseline30d: number | null;
  rhrLastNight: number | null;
  rhrBaseline30d: number | null;
  stepsYesterday: number | null;
  stepsBaseline30d: number | null;
}

export interface MuscleGroupTrainingRecord {
  muscleGroup: CanonicalMuscleGroup;
  lastTrainedAt: Date;
  directSets: number;
}

/**
 * Computes a global recovery modifier based on biometric signals.
 * Returns a multiplier: 1.0 = normal recovery, <1.0 = impaired, >1.0 = enhanced.
 */
export function computeRecoveryModifier(ctx: RecoveryContext): number {
  let modifier = 1.0;

  if (ctx.sleepDurationLastNight != null && ctx.sleepBaseline30d != null && ctx.sleepBaseline30d > 0) {
    const sleepRatio = ctx.sleepDurationLastNight / ctx.sleepBaseline30d;
    if (sleepRatio < 0.8) {
      modifier *= 0.7 + (sleepRatio * 0.375);
    } else if (sleepRatio > 1.1) {
      modifier *= Math.min(1.1, 1.0 + (sleepRatio - 1.1) * 0.2);
    }
  }

  if (ctx.hrvLastNight != null && ctx.hrvBaseline30d != null && ctx.hrvBaseline30d > 0) {
    const hrvRatio = ctx.hrvLastNight / ctx.hrvBaseline30d;
    if (hrvRatio < 0.85) {
      modifier *= 0.75 + (hrvRatio * 0.29);
    } else if (hrvRatio > 1.15) {
      modifier *= Math.min(1.1, 1.0 + (hrvRatio - 1.15) * 0.15);
    }
  }

  if (ctx.rhrLastNight != null && ctx.rhrBaseline30d != null && ctx.rhrBaseline30d > 0) {
    const rhrRatio = ctx.rhrLastNight / ctx.rhrBaseline30d;
    if (rhrRatio > 1.1) {
      modifier *= Math.max(0.7, 1.0 - (rhrRatio - 1.1) * 1.5);
    }
  }

  return Math.max(0.5, Math.min(1.2, modifier));
}

/**
 * De-correlated combination of readiness/recovery volume penalties.
 *
 * WHY THIS EXISTS
 *   Sleep duration, cumulative sleep debt, HRV, RHR, and their 30-day trends
 *   are NOT independent variables — they are noisy measurements of one latent
 *   state (autonomic recovery / systemic fatigue). A poor night simultaneously
 *   shortens sleep, depresses HRV, and elevates RHR. The ML sleep/HRV modifiers
 *   are re-derived from the same signals again.
 *
 *   Multiplying them as if independent (∏ mᵢ) therefore double- and triple-
 *   counts a single physiological event. Five mild −10%…−15% signals collapse
 *   to a ~50–65% volume cut, which is both unjustified by the evidence and
 *   demotivating. Conversely, a single severe signal should still cut hard.
 *
 * MODEL
 *   Convert each multiplier m (<1) to a penalty p = 1 − m. Rank penalties
 *   descending and sum them with a geometric decay on the *correlated*
 *   information each successive signal adds:
 *
 *       penalty = p₁ + d·p₂ + d²·p₃ + …            (0 ≤ d ≤ 1)
 *
 *   - d = 0  → only the dominant signal counts (signals perfectly correlated).
 *   - d = 1  → additive, treats signals as fully independent.
 *   - d ≈ 0.5 (default) → the worst signal counts fully; each additional
 *     correlated signal contributes with diminishing weight.
 *
 *   The total is capped at `maxPenalty` so readiness alone can never floor
 *   volume, and the result is clamped to [0, 1].
 *
 * KEY PROPERTY
 *   With a single active signal the output is identical to the old behaviour
 *   (1 − p₁ = m₁). The change is surgical: it only attenuates the compounding
 *   of multiple correlated signals, never the single-signal case.
 *
 * Multipliers ≥ 1 (boosts) are ignored here — readiness penalties and
 * performance boosts are combined separately by the caller.
 */
export function combineCorrelatedPenalties(
  multipliers: number[],
  opts: { correlationDecay?: number; maxPenalty?: number } = {},
): number {
  const decay = clampUnit(opts.correlationDecay ?? 0.5);
  const maxPenalty = clampUnit(opts.maxPenalty ?? 0.45);

  const penalties = multipliers
    .map(m => 1 - m)
    .filter(p => p > 1e-9) // reductions only
    .sort((a, b) => b - a); // dominant signal first

  if (penalties.length === 0) return 1;

  let total = 0;
  let weight = 1;
  for (const p of penalties) {
    total += weight * p;
    weight *= decay;
  }

  // The cap bounds penalty added by *correlation stacking*, so it can never
  // clip the dominant signal below itself: a single legitimately severe signal
  // must pass through unchanged (the absolute volume floor bounds it later).
  const cap = Math.max(penalties[0], maxPenalty);
  return 1 - Math.min(total, cap);
}

function clampUnit(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

/**
 * Computes synergist fatigue penalty for a given muscle group based on
 * what other muscle groups were recently trained.
 *
 * Returns additional "virtual hours of fatigue" to add to recovery time.
 */
export function computeSynergistPenalty(
  targetGroup: CanonicalMuscleGroup,
  recentTraining: MuscleGroupTrainingRecord[],
  nowMs: number
): number {
  let penalty = 0;

  for (const record of recentTraining) {
    if (record.muscleGroup === targetGroup) continue;

    const edge = SYNERGIST_COUPLING_EDGES.find(
      e => e.source_group === record.muscleGroup && e.target_group === targetGroup,
    );
    if (!edge) continue;

    const hoursSince = (nowMs - record.lastTrainedAt.getTime()) / (1000 * 60 * 60);
    const guideline = VOLUME_GUIDELINES.find(g => g.muscleGroup === record.muscleGroup);
    const baseRecovery = guideline?.recoveryHours ?? 48;

    if (hoursSince < baseRecovery) {
      const remainingFatigueFraction = 1 - (hoursSince / baseRecovery);
      const crossFatigueCoeff = edge.weight;
      penalty += remainingFatigueFraction * crossFatigueCoeff * baseRecovery * 0.5;
    }
  }

  return penalty;
}

/**
 * Computes recovery status for every muscle group.
 *
 * Inputs:
 *   recentTraining -- when each muscle group was last trained and how many direct sets
 *   recoveryCtx    -- biometric context (sleep, HRV, RHR)
 *   individualMods -- learned individual recovery rate modifiers per muscle group
 *                     (1.0 = average, <1.0 = slower recovery, >1.0 = faster recovery)
 */
/**
 * Age-based recovery scaling.
 * Research: ~1% slower recovery per year past 30 (Fell & Williams, 2008;
 * Lavender & Nosaka, 2006). Capped at ±20% to avoid extreme swings.
 * Returns a multiplier on recovery *speed* (lower = slower recovery).
 */
export function ageRecoveryFactor(age: number | null): number {
  if (age == null || age <= 0) return 1.0;
  if (age <= 30) return Math.min(1.10, 1.0 + (30 - age) * 0.005); // slight bonus for youth
  const yearsOver30 = age - 30;
  return Math.max(0.80, 1.0 - yearsOver30 * 0.008);
}

/**
 * recoverySpeedMultiplier scales all baseline recovery windows.
 * 1.0 = population default, 2.0 = recovers 2x faster (halves recovery hours),
 * 0.5 = recovers 2x slower.
 * An elite D1 athlete who recovers upper body in ~20h and legs in ~40h
 * would use ~2.0 (48h→24h upper, 72h→36h legs).
 *
 * age: optional age for automatic recovery rate adjustment.
 */
/**
 * Project per-muscle recovery forward in time for future-dated planning.
 * Week Ahead must not treat "just finished chest today" as "chest unavailable
 * on Thursday" — advance hoursSinceLastTrained by the horizon to planDate.
 */
export function projectMuscleRecoveryForward(
  statuses: MuscleRecoveryStatus[],
  hoursForward: number,
  muscleReadyThresholdPct: number = 85,
): MuscleRecoveryStatus[] {
  if (hoursForward <= 0) return statuses;
  return statuses.map((r) => {
    if (!Number.isFinite(r.hoursSinceLastTrained) || r.hoursSinceLastTrained <= 0) {
      return r;
    }
    const effectiveHours = r.recoveryPercent > 0
      ? r.hoursSinceLastTrained / (r.recoveryPercent / 100)
      : r.baselineRecoveryHours + r.synergistFatiguePenalty + r.cardioMechanicalPenalty;
    const safeEffective = Math.max(effectiveHours, r.baselineRecoveryHours * 0.5);
    const projectedHours = r.hoursSinceLastTrained + hoursForward;
    const projectedPercent = Math.min(100, Math.round((projectedHours / safeEffective) * 100));
    return {
      ...r,
      hoursSinceLastTrained: Math.round(projectedHours * 10) / 10,
      recoveryPercent: projectedPercent,
      readyToTrain: projectedPercent >= muscleReadyThresholdPct,
    };
  });
}

export function computeAllRecoveryStatuses(
  recentTraining: MuscleGroupTrainingRecord[],
  recoveryCtx: RecoveryContext,
  individualMods: Partial<Record<CanonicalMuscleGroup, number>> = {},
  now: Date = new Date(),
  recoverySpeedMultiplier: number = 1.0,
  muscleReadyThreshold: number = 85,
  age: number | null = null,
  cardioSignal?: CardioMechanicalLoadSignal,
): MuscleRecoveryStatus[] {
  const nowMs = now.getTime();
  const globalModifier = computeRecoveryModifier(recoveryCtx);
  const ageFactor = ageRecoveryFactor(age);
  const speedMult = Math.max(0.25, Math.min(4.0, recoverySpeedMultiplier * ageFactor));

  return VOLUME_GUIDELINES.map(guideline => {
    const record = recentTraining.find(r => r.muscleGroup === guideline.muscleGroup);

    if (!record) {
      return {
        muscleGroup: guideline.muscleGroup,
        hoursSinceLastTrained: Infinity,
        baselineRecoveryHours: guideline.recoveryHours,
        directSetsLastSession: 0,
        synergistFatiguePenalty: 0,
        cardioMechanicalPenalty: 0,
        recoveryModifier: globalModifier,
        recoveryPercent: 100,
        readyToTrain: true,
      };
    }

    const hoursSince = (nowMs - record.lastTrainedAt.getTime()) / (1000 * 60 * 60);

    const volumeScaling = record.directSets > 10
      ? 1 + (record.directSets - 10) * 0.05
      : 1.0;

    const individualMod = individualMods[guideline.muscleGroup] ?? 1.0;

    const synergistPenalty = computeSynergistPenalty(
      guideline.muscleGroup,
      recentTraining,
      nowMs
    );

    const cardioPenalty = cardioSignal
      ? computeCardioRecoveryPenalty(guideline.muscleGroup, cardioSignal)
      : 0;

    const effectiveRecoveryHours =
      (guideline.recoveryHours * volumeScaling) / (globalModifier * individualMod * speedMult)
      + (synergistPenalty / speedMult)
      + (cardioPenalty / speedMult);

    const recoveryPercent = Math.min(100, (hoursSince / effectiveRecoveryHours) * 100);

    return {
      muscleGroup: guideline.muscleGroup,
      hoursSinceLastTrained: Math.round(hoursSince * 10) / 10,
      baselineRecoveryHours: guideline.recoveryHours,
      directSetsLastSession: record.directSets,
      synergistFatiguePenalty: Math.round(synergistPenalty * 10) / 10,
      cardioMechanicalPenalty: Math.round(cardioPenalty * 10) / 10,
      recoveryModifier: Math.round(globalModifier * 100) / 100,
      recoveryPercent: Math.round(recoveryPercent),
      readyToTrain: recoveryPercent >= muscleReadyThreshold,
    };
  });
}

/**
 * Converts a list of exercises (with their primary_muscles arrays) into
 * MuscleGroupTrainingRecords for recovery tracking.
 */
/**
 * Converts exercises to muscle group records for recovery tracking.
 * Cardio exercises are excluded — they don't impose meaningful
 * muscle-specific recovery demands.
 */
export function exercisesToMuscleGroupRecords(
  exercises: Array<{
    primary_muscles?: string[];
    secondary_muscles?: string[];
    category?: string;
    sets: number;
  }>,
  trainedAt: Date
): MuscleGroupTrainingRecord[] {
  const groupSets: Record<string, number> = {};

  for (const ex of exercises) {
    if (ex.category?.toLowerCase() === 'cardio') continue;

    const primary = Array.isArray(ex.primary_muscles) ? ex.primary_muscles : [];
    const secondary = Array.isArray(ex.secondary_muscles) ? ex.secondary_muscles : [];
    for (const muscle of primary) {
      const group = resolveMuscleToken(muscle);
      if (group) {
        groupSets[group] = (groupSets[group] ?? 0) + ex.sets;
      }
    }
    for (const muscle of secondary) {
      const group = resolveMuscleToken(muscle);
      if (group) {
        const guideline = getGuidelineForGroup(group);
        const credit = guideline?.indirectVolumeCredit ?? 0.5;
        groupSets[group] = (groupSets[group] ?? 0) + ex.sets * credit;
      }
    }
  }

  return Object.entries(groupSets).map(([muscleGroup, directSets]) => ({
    muscleGroup: muscleGroup as CanonicalMuscleGroup,
    lastTrainedAt: trainedAt,
    directSets: Math.round(directSets),
  }));
}
