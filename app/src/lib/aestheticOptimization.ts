/**
 * Aesthetic / recomposition priors from behavior + Fitbit weight trend only.
 * No meal logging or post-workout forms.
 */

import type { SessionTelemetryResult } from './sessionTelemetry';

export interface AestheticContext {
  trainingGoal?: string | null;
  experienceLevel?: string | null;
  bodyWeightLbs?: number | null;
  weightTrendLbsPerWeek?: number | null;
  sleepScoreMedian?: number | null;
  sessionTelemetry?: SessionTelemetryResult | null;
}

export interface AestheticAdjustments {
  volumeMultiplier: number;
  restTimeMultiplier: number;
  cardioMinutesBonus: number;
  notes: string[];
}

export function computeAestheticAdjustments(ctx: AestheticContext): AestheticAdjustments {
  const notes: string[] = [];
  let volumeMultiplier = 1;
  let restTimeMultiplier = 1;
  let cardioMinutesBonus = 0;

  const goal = String(ctx.trainingGoal || '').toLowerCase();
  const isCut = goal.includes('cut') || goal.includes('fat');
  const tel = ctx.sessionTelemetry;

  if (isCut) {
    if (ctx.weightTrendLbsPerWeek != null && ctx.weightTrendLbsPerWeek > 0.3) {
      volumeMultiplier *= 0.95;
      cardioMinutesBonus += 5;
      notes.push('Weight trending up on cut — slight volume trim + cardio bump.');
    }
    if (tel?.goalSignals.restOverextended) {
      restTimeMultiplier *= 0.92;
      notes.push('Rest periods often exceed prescription — tighten for session density.');
    }
  }

  if (tel?.goalSignals.restRushed && !isCut) {
    restTimeMultiplier *= 1.08;
    notes.push('Rest consistently under prescription — extend for hypertrophy recovery.');
  }

  if (ctx.sleepScoreMedian != null && ctx.sleepScoreMedian < 70) {
    volumeMultiplier *= 0.94;
    restTimeMultiplier *= 1.06;
    notes.push('Low sleep scores — conservative volume, longer rest.');
  }

  if (tel?.aestheticScore != null && tel.aestheticScore >= 0.75) {
    notes.push('Recent sessions show strong density + rest discipline.');
  }

  return {
    volumeMultiplier: Math.round(volumeMultiplier * 1000) / 1000,
    restTimeMultiplier: Math.round(restTimeMultiplier * 1000) / 1000,
    cardioMinutesBonus,
    notes,
  };
}
