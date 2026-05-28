/**
 * Apollo prescription controller — one control loop before selection/prescribe.
 *
 * setpoint (goal, phase, focus) − measured (execution, readiness, utility)
 * = error → actuators (volume, RIR, weight bias, mesocycle nudge)
 */

import type { TrainingProfile } from './trainingAnalysis';
import type { UserPreferences } from './workoutEngine';

export interface PrescriptionControllerOutput {
  volumeMultiplier: number;
  rirOffset: number;
  weightBias: number;
  progressionScale: number;
  suggestMesocycleWeek: number | null;
  forceConservative: boolean;
  rationale: string[];
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Compute unified controller adjustments from measured performance signals.
 * Called once at the start of `generateWorkout` before muscle selection.
 */
export function computePrescriptionController(
  profile: TrainingProfile,
  prefs: UserPreferences,
): PrescriptionControllerOutput {
  const rationale: string[] = [];
  let volumeMultiplier = 1.0;
  let rirOffset = 0;
  let weightBias = 1.0;
  let progressionScale = 1.0;
  let suggestMesocycleWeek: number | null = null;
  let forceConservative = false;

  const utility = profile.canonicalModelContext?.objectiveUtility ?? 0.5;
  const readiness = profile.fitnessFatigueModel?.readiness ?? 0.5;
  const compliance = profile.prescribedVsActual?.complianceRate ?? 0.5;
  const weightDev = profile.prescribedVsActual?.avgWeightDeviation ?? 0;
  const repsDev = profile.prescribedVsActual?.avgRepsDeviation ?? 0;

  // Objective utility gate — was decorative; now drives structure.
  if (utility < 0.42) {
    volumeMultiplier *= 0.88;
    rirOffset += 1;
    forceConservative = true;
    rationale.push(`Low program utility (${Math.round(utility * 100)}%): conservative volume`);
  } else if (utility > 0.72 && compliance >= 0.65) {
    volumeMultiplier *= 1.08;
    rirOffset -= 1;
    weightBias *= 1.04;
    progressionScale *= 1.06;
    rationale.push(`Strong utility (${Math.round(utility * 100)}%): push dose`);
  }

  // Execution coupling — close the "not challenging enough" loop at controller level.
  if (weightDev > 0.06 && compliance >= 0.6) {
    weightBias *= clamp(1 + weightDev * 0.6, 1.0, 1.1);
    if (repsDev > 1) rirOffset -= 1;
    rationale.push(`Execution above prescription (Δw ${(weightDev * 100).toFixed(0)}%): weight bias ×${weightBias.toFixed(2)}`);
  } else if (weightDev < -0.08 && compliance < 0.7) {
    weightBias *= clamp(1 + weightDev * 0.4, 0.9, 1.0);
    rirOffset += 1;
    rationale.push(`Execution below prescription: ease load`);
  }

  // Readiness from Banister model
  if (readiness < 0.38) {
    volumeMultiplier *= 0.9;
    rirOffset += 1;
    rationale.push(`Low readiness (${Math.round(readiness * 100)}%)`);
  } else if (readiness > 0.72 && utility >= 0.55) {
    volumeMultiplier *= 1.05;
    rationale.push(`High readiness (${Math.round(readiness * 100)}%)`);
  }

  // Mesocycle auto-advance (uses mesocycleRecoverySignalThreshold concept)
  const currentWeek = prefs.mesocycle_week ?? 1;
  if (profile.exerciseProgressions.length >= 8) {
    const progressing = profile.exerciseProgressions.filter(p => p.status === 'progressing').length;
    const regressing = profile.exerciseProgressions.filter(p => p.status === 'regressing').length;
    const ratio = progressing / Math.max(1, profile.exerciseProgressions.length);
    if (currentWeek <= 2 && ratio >= 0.45 && readiness >= 0.55 && utility >= 0.5) {
      suggestMesocycleWeek = Math.min(4, currentWeek + 1);
      rationale.push(`Mesocycle advance suggested: week ${currentWeek} → ${suggestMesocycleWeek}`);
    } else if (regressing >= 3 || readiness < 0.35) {
      suggestMesocycleWeek = 4; // deload week
      rationale.push('Mesocycle deload suggested from regression/readiness');
    }
  }

  volumeMultiplier = clamp(volumeMultiplier, 0.82, 1.15);
  weightBias = clamp(weightBias, 0.88, 1.12);
  progressionScale = clamp(progressionScale, 0.85, 1.15);
  rirOffset = clamp(rirOffset, -2, 3);

  return {
    volumeMultiplier,
    rirOffset,
    weightBias,
    progressionScale,
    suggestMesocycleWeek,
    forceConservative,
    rationale,
  };
}
