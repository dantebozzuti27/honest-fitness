/**
 * Infer session effort and outcomes from what the user actually did —
 * no post-workout forms, no manual RPE. Fitbit + set logs + rest timer only.
 */

import type { SessionTelemetryResult } from './sessionTelemetry';

export interface BehavioralSessionInference {
  inferredRpe: number;
  inferredEffortScore: number;
  behavioralOutcomeScore: number;
  signals: {
    completionRate: number;
    restDiscipline: number;
    densitySignal: number;
    volumeSignal: number;
    source: 'behavioral_v1';
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Map observed training behavior → session RPE (1–10) and outcome score (0–1).
 */
export function inferBehavioralSession(
  telemetry: SessionTelemetryResult,
  opts: {
    durationMinutes: number;
    prescribedExerciseCount: number;
    completedExerciseCount: number;
    fitbitCalories?: number | null;
    trainingGoal?: string | null;
  },
): BehavioralSessionInference {
  const prescribed = Math.max(1, opts.prescribedExerciseCount);
  const completionRate = clamp(opts.completedExerciseCount / prescribed, 0, 1);

  const restDiscipline =
    telemetry.medianRestVsPrescribed != null
      ? clamp(1 - Math.abs(telemetry.medianRestVsPrescribed - 1) * 1.2, 0, 1)
      : telemetry.setsWithRestLogged > 0
        ? 0.6
        : 0.5;

  const density = telemetry.sessionDensity ?? 0;
  const densitySignal =
    density > 0 ? clamp((density - 30) / 70, 0, 1) : completionRate > 0 ? 0.5 : 0.3;

  const volumeSignal = clamp(telemetry.tonnage / 80000, 0, 1);

  let rpe = 6.5;
  if (density > 75) rpe += 1.2;
  else if (density > 55) rpe += 0.6;
  else if (density < 35 && opts.durationMinutes > 20) rpe -= 0.5;

  if (telemetry.medianRestVsPrescribed != null && telemetry.medianRestVsPrescribed < 0.72) rpe += 0.8;
  if (telemetry.workingSetCount >= 18) rpe += 0.5;
  if (telemetry.workingSetCount <= 6 && opts.durationMinutes < 45) rpe -= 0.8;

  if (opts.fitbitCalories != null && opts.fitbitCalories > 350) rpe += 0.4;

  const isCut =
    String(opts.trainingGoal || '').includes('cut') ||
    String(opts.trainingGoal || '').includes('fat');
  if (isCut && telemetry.goalSignals.restOverextended) rpe -= 0.3;

  rpe = Math.round(clamp(rpe, 4, 9.5) * 10) / 10;

  const inferredEffortScore = clamp(
    completionRate * 0.35 +
      restDiscipline * 0.25 +
      densitySignal * 0.2 +
      volumeSignal * 0.2,
    0,
    1,
  );

  const behavioralOutcomeScore = Math.round(
    clamp(
      completionRate * 0.45 +
        restDiscipline * 0.25 +
        (telemetry.aestheticScore ?? inferredEffortScore) * 0.3,
      0.35,
      1,
    ) * 1000,
  ) / 1000;

  return {
    inferredRpe: rpe,
    inferredEffortScore: Math.round(inferredEffortScore * 1000) / 1000,
    behavioralOutcomeScore,
    signals: {
      completionRate: Math.round(completionRate * 1000) / 1000,
      restDiscipline: Math.round(restDiscipline * 1000) / 1000,
      densitySignal: Math.round(densitySignal * 1000) / 1000,
      volumeSignal: Math.round(volumeSignal * 1000) / 1000,
      source: 'behavioral_v1',
    },
  };
}
