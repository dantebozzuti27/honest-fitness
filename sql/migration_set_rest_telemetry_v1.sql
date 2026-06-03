-- Per-set rest telemetry + session feature store for ML / aesthetic optimization

ALTER TABLE workout_sets
  ADD COLUMN IF NOT EXISTS prescribed_rest_seconds INT,
  ADD COLUMN IF NOT EXISTS rest_seconds_actual INT;

COMMENT ON COLUMN workout_sets.rest_seconds_before IS 'Seconds before this set (timer-derived or inter-set gap).';
COMMENT ON COLUMN workout_sets.prescribed_rest_seconds IS 'Engine-prescribed rest when timer started.';
COMMENT ON COLUMN workout_sets.rest_seconds_actual IS 'Actual rest taken (timer elapsed or logged gap).';

ALTER TABLE workouts
  ADD COLUMN IF NOT EXISTS session_rest_seconds_total INT,
  ADD COLUMN IF NOT EXISTS session_work_seconds_total INT,
  ADD COLUMN IF NOT EXISTS rest_compliance_ratio NUMERIC(6,3);

CREATE TABLE IF NOT EXISTS training_session_features (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  workout_id UUID NOT NULL,
  workout_date DATE NOT NULL,
  feature_version TEXT NOT NULL DEFAULT '2026-06-03.1',
  features JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, workout_id)
);

CREATE INDEX IF NOT EXISTS idx_training_session_features_user_date
  ON training_session_features(user_id, workout_date DESC);
