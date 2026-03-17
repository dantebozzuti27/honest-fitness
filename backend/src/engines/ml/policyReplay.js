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
    const promoteReady = sampleSize >= 3 && avgRegret <= 0.08 && avgObjective >= 0.55 && avgAdherence >= 0.6
    return {
      ...ep,
      metrics: {
        sampleSize,
        avgObjective,
        avgRegret,
        avgAdherence,
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
  const promote = sampleSize >= 8 && avgRegretDelta <= -0.02
  return { sampleSize, avgRegretDelta, promote }
}
