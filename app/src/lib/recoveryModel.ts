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

import {
  VOLUME_GUIDELINES,
  SYNERGIST_FATIGUE,
  MUSCLE_HEAD_TO_GROUP,
  type VolumeGuideline,
} from './volumeGuidelines';

export interface MuscleRecoveryStatus {
  muscleGroup: string;
  hoursSinceLastTrained: number;
  baselineRecoveryHours: number;
  directSetsLastSession: number;
  synergistFatiguePenalty: number;
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
  muscleGroup: string;
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
 * Computes synergist fatigue penalty for a given muscle group based on
 * what other muscle groups were recently trained.
 *
 * Returns additional "virtual hours of fatigue" to add to recovery time.
 */
export function computeSynergistPenalty(
  targetGroup: string,
  recentTraining: MuscleGroupTrainingRecord[],
  nowMs: number
): number {
  let penalty = 0;

  for (const record of recentTraining) {
    if (record.muscleGroup === targetGroup) continue;

    const fatigueMap = SYNERGIST_FATIGUE[record.muscleGroup];
    if (!fatigueMap || !fatigueMap[targetGroup]) continue;

    const hoursSince = (nowMs - record.lastTrainedAt.getTime()) / (1000 * 60 * 60);
    const guideline = VOLUME_GUIDELINES.find(g => g.muscleGroup === record.muscleGroup);
    const baseRecovery = guideline?.recoveryHours ?? 48;

    if (hoursSince < baseRecovery) {
      const remainingFatigueFraction = 1 - (hoursSince / baseRecovery);
      const crossFatigueCoeff = fatigueMap[targetGroup];
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
export function computeAllRecoveryStatuses(
  recentTraining: MuscleGroupTrainingRecord[],
  recoveryCtx: RecoveryContext,
  individualMods: Record<string, number> = {},
  now: Date = new Date()
): MuscleRecoveryStatus[] {
  const nowMs = now.getTime();
  const globalModifier = computeRecoveryModifier(recoveryCtx);

  return VOLUME_GUIDELINES.map(guideline => {
    const record = recentTraining.find(r => r.muscleGroup === guideline.muscleGroup);

    if (!record) {
      return {
        muscleGroup: guideline.muscleGroup,
        hoursSinceLastTrained: Infinity,
        baselineRecoveryHours: guideline.recoveryHours,
        directSetsLastSession: 0,
        synergistFatiguePenalty: 0,
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

    const effectiveRecoveryHours =
      (guideline.recoveryHours * volumeScaling) / (globalModifier * individualMod)
      + synergistPenalty;

    const recoveryPercent = Math.min(100, (hoursSince / effectiveRecoveryHours) * 100);

    return {
      muscleGroup: guideline.muscleGroup,
      hoursSinceLastTrained: Math.round(hoursSince * 10) / 10,
      baselineRecoveryHours: guideline.recoveryHours,
      directSetsLastSession: record.directSets,
      synergistFatiguePenalty: Math.round(synergistPenalty * 10) / 10,
      recoveryModifier: Math.round(globalModifier * 100) / 100,
      recoveryPercent: Math.round(recoveryPercent),
      readyToTrain: recoveryPercent >= 85,
    };
  });
}

/**
 * Converts a list of exercises (with their primary_muscles arrays) into
 * MuscleGroupTrainingRecords for recovery tracking.
 */
export function exercisesToMuscleGroupRecords(
  exercises: Array<{
    primary_muscles?: string[];
    secondary_muscles?: string[];
    sets: number;
  }>,
  trainedAt: Date
): MuscleGroupTrainingRecord[] {
  const groupSets: Record<string, number> = {};

  for (const ex of exercises) {
    for (const muscle of ex.primary_muscles ?? []) {
      const group = MUSCLE_HEAD_TO_GROUP[muscle];
      if (group) {
        groupSets[group] = (groupSets[group] ?? 0) + ex.sets;
      }
    }
    for (const muscle of ex.secondary_muscles ?? []) {
      const group = MUSCLE_HEAD_TO_GROUP[muscle];
      if (group) {
        groupSets[group] = (groupSets[group] ?? 0) + ex.sets * 0.5;
      }
    }
  }

  return Object.entries(groupSets).map(([muscleGroup, directSets]) => ({
    muscleGroup,
    lastTrainedAt: trainedAt,
    directSets: Math.round(directSets),
  }));
}
