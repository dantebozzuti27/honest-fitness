-- Swap learning v2: full event shape + optional cardio feedback for HR/RPE loop
-- Run after migration_ml_v2.sql (exercise_swaps exists).
-- RDS-compatible (no auth schema / RLS — auth handled at API layer)

ALTER TABLE exercise_swaps
  ADD COLUMN IF NOT EXISTS replacement_exercise_name TEXT,
  ADD COLUMN IF NOT EXISTS swap_context TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS workout_session_id UUID;

COMMENT ON COLUMN exercise_swaps.replacement_exercise_name IS 'Exercise the user chose or received instead (nullable for legacy rows).';
COMMENT ON COLUMN exercise_swaps.swap_context IS 'today_regen | week_regen | active_replace | unknown';
COMMENT ON COLUMN exercise_swaps.workout_session_id IS 'Optional link to active workout / session.';

CREATE INDEX IF NOT EXISTS idx_exercise_swaps_user_created ON exercise_swaps(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS cardio_set_feedback (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  workout_id UUID,
  exercise_name TEXT NOT NULL,
  target_hr_min INT,
  target_hr_max INT,
  perceived_effort INT CHECK (perceived_effort IS NULL OR (perceived_effort >= 1 AND perceived_effort <= 10)),
  avg_hr_observed INT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cardio_set_feedback_user ON cardio_set_feedback(user_id, created_at DESC);
