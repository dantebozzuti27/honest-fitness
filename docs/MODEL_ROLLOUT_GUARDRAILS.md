# Model Rollout Guardrails (Single-Wave)

This document defines operational rollback behavior for the integrated model stack.

## Runtime Kill Switches

Client runtime flags (read from `localStorage` with key prefix `hf.flag.`):

- `pid_controller`
- `policy_learning`
- `replay_promotions`
- `nutrition_feedback`
- `llm_extended_validation`

Server runtime flag:

- `HF_ENABLE_REPLAY_PROMOTIONS` (env var; defaults to enabled)

## Fallback Behavior

- If `pid_controller` is disabled, fat-loss PID outputs are replaced with neutral multipliers.
- If `nutrition_feedback` is disabled, policy fusion multipliers are not applied.
- If replay promotions are disabled, `/api/ml/policy/replay` rejects promotion runs with HTTP 403.
- If new tables are not yet deployed, writes are non-fatal and degrade gracefully (warnings only).

## Rollback Procedure

1. Disable `pid_controller` and `nutrition_feedback` flags in impacted clients.
2. Set `HF_ENABLE_REPLAY_PROMOTIONS=false` on backend to prevent policy promotion.
3. Keep provenance and artifact logging enabled for postmortem observability.
4. Revert to last stable policy version by selecting baseline policy in replay configs.

## Promotion Gate

Replay promotion should only be considered when:

- replay sample size >= 8,
- average regret delta <= -0.02 (candidate better than baseline),
- episode evaluator reports non-trivial adherence and objective score.
