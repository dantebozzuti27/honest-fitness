-- RDS-safe model integration v3 — tables live in rds_schema_v1.sql.
-- This migration verifies indexes/constraints without auth.users or RLS.

CREATE INDEX IF NOT EXISTS idx_nutrition_snapshots_user_date
  ON nutrition_adherence_daily_snapshots(user_id, snapshot_date DESC);

CREATE INDEX IF NOT EXISTS idx_provenance_user_date
  ON decision_provenance_events(user_id, event_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_provenance_workout
  ON decision_provenance_events(generated_workout_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_provenance_trace
  ON decision_provenance_events(trace_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_intervention_episodes_user
  ON intervention_episodes(user_id, started_on DESC);

CREATE INDEX IF NOT EXISTS idx_intervention_outcomes_episode
  ON intervention_episode_outcomes(intervention_episode_id, measured_on DESC);

CREATE INDEX IF NOT EXISTS idx_replay_scenarios_user
  ON replay_scenarios(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_replay_results_scenario
  ON replay_results(replay_scenario_id, created_at DESC);
