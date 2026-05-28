-- RDS-safe excerpt: workout_sets ontology columns + backfill
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
