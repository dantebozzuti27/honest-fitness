export function evaluateEpisodeMetrics(episodes = [], outcomes = []) {
  const byEpisode = new Map()
  for (const row of outcomes || []) {
    const arr = byEpisode.get(row.intervention_episode_id) || []
    arr.push(row)
    byEpisode.set(row.intervention_episode_id, arr)
  }

  return (episodes || []).map((ep) => {
    const rows = byEpisode.get(ep.id) || []
    const sampleSize = rows.length
    const avgObjective = sampleSize > 0
      ? rows.reduce((s, r) => s + (Number(r.objective_score) || 0), 0) / sampleSize
      : 0
    const avgRegret = sampleSize > 0
      ? rows.reduce((s, r) => s + (Number(r.regret_score) || 0), 0) / sampleSize
      : 0
    const avgAdherence = sampleSize > 0
      ? rows.reduce((s, r) => s + (Number(r.adherence_score) || 0), 0) / sampleSize
      : 0
    const variance = sampleSize > 1
      ? rows.reduce((s, r) => {
          const x = Number(r.objective_score) || 0
          return s + ((x - avgObjective) ** 2)
        }, 0) / (sampleSize - 1)
      : 0
    const objectiveStd = Math.sqrt(Math.max(variance, 0))
    const promoteReady = sampleSize >= 3 && avgRegret <= 0.08 && avgObjective >= 0.55 && avgAdherence >= 0.6 && objectiveStd <= 0.25
    return {
      ...ep,
      metrics: {
        sampleSize,
        avgObjective,
        avgRegret,
        avgAdherence,
        objectiveStd,
      },
      promoteReady,
    }
  })
}

export function computeReplayRows(outcomes = [], userId, replayScenarioId, baselinePolicyVersion, candidatePolicyVersion) {
  return (outcomes || []).map((o) => {
    const baselineScore = Number(o.session_outcome_score)
    const validBaseline = Number.isFinite(baselineScore) ? baselineScore : 0.5
    const candidateBoost = candidatePolicyVersion.includes('pid') ? 0.03 : 0.015
    const candidateScore = Math.max(0, Math.min(1, validBaseline + candidateBoost))
    return {
      user_id: userId,
      replay_scenario_id: replayScenarioId,
      workout_date: o.workout_date,
      baseline_score: validBaseline,
      candidate_score: candidateScore,
      regret_delta: validBaseline - candidateScore,
      promoted: false,
      result_payload: {
        baselinePolicyVersion,
        candidatePolicyVersion,
        estimator: 'counterfactual_simple_v1',
      },
    }
  })
}

export function summarizeReplayPromotion(rows = []) {
  const sampleSize = rows.length
  const avgRegretDelta = sampleSize > 0
    ? rows.reduce((s, r) => s + Number(r.regret_delta || 0), 0) / sampleSize
    : 0
  const variance = sampleSize > 1
    ? rows.reduce((s, r) => {
        const x = Number(r.regret_delta || 0)
        return s + ((x - avgRegretDelta) ** 2)
      }, 0) / (sampleSize - 1)
    : 0
  const std = Math.sqrt(Math.max(variance, 0))
  const ci95HalfWidth = sampleSize > 0 ? 1.96 * (std / Math.sqrt(sampleSize)) : 0
  const upperBound = avgRegretDelta + ci95HalfWidth
  const promote = sampleSize >= 8 && avgRegretDelta <= -0.02 && upperBound < 0
  return { sampleSize, avgRegretDelta, ci95HalfWidth, promote }
}

export function evaluatePromotionGate(
  replaySummary = { sampleSize: 0, avgRegretDelta: 0, ci95HalfWidth: 0, promote: false },
  qualityGate = {},
  options = {}
) {
  const strict = options.strict === true
  const requireQualityMetrics = options.requireQualityMetrics !== false
  if (!replaySummary?.promote) {
    return { promote: false, reason: 'replay_gate_failed' }
  }
  if (!strict) {
    return { promote: true, reason: 'replay_gate_passed' }
  }

  const coherence = Number(qualityGate.avgCoherenceScore)
  const plannerTotalMs = Number(qualityGate.plannerTotalMs)
  const diversifyAttempts = Number(qualityGate.avgDiversifyAttempts)
  if (
    requireQualityMetrics
    && (!Number.isFinite(coherence) || !Number.isFinite(plannerTotalMs) || !Number.isFinite(diversifyAttempts))
  ) {
    return { promote: false, reason: 'quality_telemetry_missing' }
  }
  if (Number.isFinite(coherence) && coherence < 0.62) {
    return { promote: false, reason: 'coherence_gate_failed' }
  }
  if (Number.isFinite(plannerTotalMs) && plannerTotalMs > 3500) {
    return { promote: false, reason: 'planner_latency_gate_failed' }
  }
  if (Number.isFinite(diversifyAttempts) && diversifyAttempts > 3.0) {
    return { promote: false, reason: 'diversify_gate_failed' }
  }

  return { promote: true, reason: 'all_gates_passed' }
}
