-- Ontology v4 data capture upgrades:
-- 1) Set-level unilateral/load interpretation metadata
-- 2) Additional set-level effort/recovery fields
-- 3) User cardio capability envelope table
-- 4) Transformation audit table for safe historical backfills

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'workout_sets') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'workout_sets' AND column_name = 'is_unilateral'
    ) THEN
      ALTER TABLE workout_sets ADD COLUMN is_unilateral BOOLEAN NOT NULL DEFAULT false;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'workout_sets' AND column_name = 'load_interpretation'
    ) THEN
      ALTER TABLE workout_sets ADD COLUMN load_interpretation TEXT;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'workout_sets' AND column_name = 'reps_interpretation'
    ) THEN
      ALTER TABLE workout_sets ADD COLUMN reps_interpretation TEXT;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'workout_sets' AND column_name = 'set_rpe'
    ) THEN
      ALTER TABLE workout_sets ADD COLUMN set_rpe NUMERIC;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'workout_sets' AND column_name = 'actual_rir'
    ) THEN
      ALTER TABLE workout_sets ADD COLUMN actual_rir NUMERIC;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'workout_sets' AND column_name = 'rest_seconds_before'
    ) THEN
      ALTER TABLE workout_sets ADD COLUMN rest_seconds_before INTEGER;
    END IF;

    ALTER TABLE workout_sets DROP CONSTRAINT IF EXISTS workout_sets_load_interpretation_check;
    ALTER TABLE workout_sets
      ADD CONSTRAINT workout_sets_load_interpretation_check
      CHECK (
        load_interpretation IS NULL
        OR load_interpretation IN ('per_hand_per_side', 'total_both_per_side', 'unknown')
      );

    ALTER TABLE workout_sets DROP CONSTRAINT IF EXISTS workout_sets_reps_interpretation_check;
    ALTER TABLE workout_sets
      ADD CONSTRAINT workout_sets_reps_interpretation_check
      CHECK (
        reps_interpretation IS NULL
        OR reps_interpretation IN ('per_side', 'total_reps')
      );

    CREATE INDEX IF NOT EXISTS idx_workout_sets_unilateral
      ON workout_sets(is_unilateral, load_interpretation);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS cardio_capability_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  modality TEXT NOT NULL,
  max_speed NUMERIC,
  comfortable_speed NUMERIC,
  max_incline NUMERIC,
  preferred_hr_zone_low INTEGER,
  preferred_hr_zone_high INTEGER,
  confidence_score NUMERIC DEFAULT 0.5,
  observed_sessions INTEGER DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, modality)
);

CREATE INDEX IF NOT EXISTS idx_cardio_capability_profiles_user_modality
  ON cardio_capability_profiles(user_id, modality);

ALTER TABLE cardio_capability_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own cardio_capability_profiles" ON cardio_capability_profiles;
CREATE POLICY "Users can view own cardio_capability_profiles" ON cardio_capability_profiles
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own cardio_capability_profiles" ON cardio_capability_profiles;
CREATE POLICY "Users can insert own cardio_capability_profiles" ON cardio_capability_profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own cardio_capability_profiles" ON cardio_capability_profiles;
CREATE POLICY "Users can update own cardio_capability_profiles" ON cardio_capability_profiles
  FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own cardio_capability_profiles" ON cardio_capability_profiles;
CREATE POLICY "Users can delete own cardio_capability_profiles" ON cardio_capability_profiles
  FOR DELETE USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS set_transformation_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workout_set_id UUID,
  workout_id UUID,
  exercise_name TEXT,
  original_weight NUMERIC,
  transformed_weight NUMERIC,
  original_load_interpretation TEXT,
  transformed_load_interpretation TEXT,
  reason TEXT NOT NULL,
  confidence NUMERIC,
  batch_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_set_transformation_audit_user_created
  ON set_transformation_audit(user_id, created_at DESC);

ALTER TABLE set_transformation_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own set_transformation_audit" ON set_transformation_audit;
CREATE POLICY "Users can view own set_transformation_audit" ON set_transformation_audit
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own set_transformation_audit" ON set_transformation_audit;
CREATE POLICY "Users can insert own set_transformation_audit" ON set_transformation_audit
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own set_transformation_audit" ON set_transformation_audit;
CREATE POLICY "Users can update own set_transformation_audit" ON set_transformation_audit
  FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own set_transformation_audit" ON set_transformation_audit;
CREATE POLICY "Users can delete own set_transformation_audit" ON set_transformation_audit
  FOR DELETE USING (auth.uid() = user_id);

-- Hybrid historical backfill (high-confidence only):
-- Convert legacy unilateral dumbbell logs recorded as TOTAL of both DBs + per-side reps
-- into canonical per-hand/per-side representation.
DO $$
DECLARE
  v_batch_id TEXT := 'ontology_v4_unilateral_backfill_' || to_char(NOW(), 'YYYYMMDDHH24MISS');
BEGIN
  WITH candidates AS (
    SELECT
      ws.id AS workout_set_id,
      w.user_id AS user_id,
      w.id AS workout_id,
      we.exercise_name AS exercise_name,
      ws.weight AS original_weight
    FROM workout_sets ws
    JOIN workout_exercises we ON we.id = ws.workout_exercise_id
    JOIN workouts w ON w.id = we.workout_id
    WHERE
      ws.weight IS NOT NULL
      AND ws.weight > 0
      AND COALESCE(ws.is_bodyweight, false) = false
      AND COALESCE(ws.load_interpretation, 'unknown') IN ('unknown', '')
      AND (
        lower(COALESCE(we.exercise_name, '')) ~ '(single[ -]*(arm|leg)|one[ -]*(arm|leg)|unilateral|split squat|step[ -]*up|cossack)'
      )
  ),
  ins AS (
    INSERT INTO set_transformation_audit (
      user_id,
      workout_set_id,
      workout_id,
      exercise_name,
      original_weight,
      transformed_weight,
      original_load_interpretation,
      transformed_load_interpretation,
      reason,
      confidence,
      batch_id,
      metadata
    )
    SELECT
      c.user_id,
      c.workout_set_id,
      c.workout_id,
      c.exercise_name,
      c.original_weight,
      round((c.original_weight / 2.0)::numeric, 2),
      'total_both_per_side',
      'per_hand_per_side',
      'hybrid_high_confidence_unilateral_backfill',
      0.90,
      v_batch_id,
      jsonb_build_object('strategy', 'hybrid_high_confidence', 'version', 'ontology_v4')
    FROM candidates c
    WHERE NOT EXISTS (
      SELECT 1
      FROM set_transformation_audit a
      WHERE a.workout_set_id = c.workout_set_id
        AND a.reason = 'hybrid_high_confidence_unilateral_backfill'
    )
    RETURNING workout_set_id
  )
  UPDATE workout_sets ws
  SET
    weight = round((ws.weight / 2.0)::numeric, 2),
    is_unilateral = true,
    load_interpretation = 'per_hand_per_side',
    reps_interpretation = 'per_side'
  WHERE ws.id IN (SELECT workout_set_id FROM ins);
END $$;
