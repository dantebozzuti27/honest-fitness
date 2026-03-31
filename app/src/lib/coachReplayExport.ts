import type { TrainingProfile } from './trainingAnalysis'
import type { GeneratedWorkout } from './workoutEngine'

/**
 * Privacy-oriented snapshot for debugging / replay: no raw body-weight series,
 * only coarse trend metadata plus engine decisions.
 */
export function buildCoachDecisionReplaySnapshot(input: {
  profile: TrainingProfile
  workout?: GeneratedWorkout | null
  generatedAt?: string
}) {
  const p = input.profile
  const w = input.workout
  const b = p.bodyWeightTrend
  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    featureSnapshotId: p.featureSnapshotId,
    nutritionLoggingCoverage14d: p.nutritionLoggingCoverage14d,
    bodyWeightTrendSummary: b
      ? {
          phase: b.phase,
          slopeBucket:
            b.slope > 0.25 ? 'up' : b.slope < -0.25 ? 'down' : 'flat',
          dataPointCount: b.dataPointCount,
          trendSpanDays: b.trendSpanDays,
          trendConfidence: b.trendConfidence,
        }
      : null,
    swapHistoryTop: (p.exerciseSwapHistory ?? []).slice(0, 12).map(s => ({
      exerciseName: s.exerciseName,
      swapCount: s.swapCount,
      effectiveSwapWeight: s.effectiveSwapWeight,
      lastSwapDate: s.lastSwapDate,
    })),
    substitutionAffinitiesTop: (p.substitutionAffinities ?? []).slice(0, 12),
    workoutPolicy: w?.policyState ?? null,
    fatLossDoseExplanation: w?.fatLossDoseExplanation ?? null,
    decisionProvenance: w?.decisionProvenance ?? null,
    runtimeFlags: w?.runtimeFlags ?? null,
  }
}
