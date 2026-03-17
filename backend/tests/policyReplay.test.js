import test from 'node:test'
import assert from 'node:assert/strict'

import { computeReplayRows, evaluateEpisodeMetrics, summarizeReplayPromotion } from '../src/engines/ml/policyReplay.js'

test('evaluateEpisodeMetrics computes averages and promotion readiness', () => {
  const episodes = [{ id: 'ep-1', episode_key: 'k1' }]
  const outcomes = [
    { intervention_episode_id: 'ep-1', objective_score: 0.7, regret_score: 0.04, adherence_score: 0.8 },
    { intervention_episode_id: 'ep-1', objective_score: 0.6, regret_score: 0.05, adherence_score: 0.7 },
    { intervention_episode_id: 'ep-1', objective_score: 0.65, regret_score: 0.07, adherence_score: 0.65 },
  ]
  const [result] = evaluateEpisodeMetrics(episodes, outcomes)
  assert.equal(result.metrics.sampleSize, 3)
  assert.equal(result.promoteReady, true)
  assert.ok(result.metrics.avgObjective > 0.6)
  assert.ok(result.metrics.avgRegret < 0.08)
})

test('computeReplayRows boosts candidate score for pid candidates', () => {
  const rows = computeReplayRows(
    [{ workout_date: '2026-01-01', session_outcome_score: 0.5 }],
    'u1',
    'scenario-1',
    'baseline',
    'policy_pid_candidate'
  )
  assert.equal(rows.length, 1)
  assert.equal(rows[0].baseline_score, 0.5)
  assert.equal(rows[0].candidate_score, 0.53)
  assert.ok(Math.abs(rows[0].regret_delta - (-0.03)) < 1e-9)
})

test('summarizeReplayPromotion respects sample size and regret gate', () => {
  const small = summarizeReplayPromotion([{ regret_delta: -0.5 }])
  assert.equal(small.promote, false)

  const bigRows = Array.from({ length: 10 }).map(() => ({ regret_delta: -0.03 }))
  const summary = summarizeReplayPromotion(bigRows)
  assert.equal(summary.promote, true)
  assert.ok(summary.avgRegretDelta <= -0.02)
})
