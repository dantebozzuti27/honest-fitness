-- Migration: Data Quality Fixes
-- Fixes: #2 dedup March 26, #5 null completed, #9 split schedule taxonomy

BEGIN;

-- ── #2: Deduplicate March 26 test workout data ──
-- Keep one workout per date+template, delete duplicates.
-- Uses window function since MIN() doesn't work on UUID.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY date, template_name ORDER BY created_at ASC) AS rn
  FROM workouts
  WHERE date = '2026-03-26'
)
DELETE FROM workouts
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- ── #5: Set completed = true for all finished workouts ──
-- Any workout with exercises is considered completed.
-- First, add the column if it doesn't exist.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'workouts' AND column_name = 'completed'
  ) THEN
    ALTER TABLE workouts ADD COLUMN completed BOOLEAN DEFAULT true;
  END IF;
END $$;

UPDATE workouts SET completed = true WHERE completed IS NULL;

-- ── Duration fix: convert any remaining seconds-stored values to minutes ──
UPDATE workouts SET duration = ROUND(duration / 60.0)
WHERE duration > 300;

-- ── #5: Set completed = true for workouts with exercises ──
-- (Already handled above via UPDATE SET completed = true WHERE NULL)

-- ── #9: Migrate weekly_split_schedule to 24-group taxonomy ──
-- Replace old group names with new canonical names in the JSON schedule.
-- This handles the user_preferences.weekly_split_schedule JSONB column.
UPDATE user_preferences
SET weekly_split_schedule = (
  SELECT jsonb_object_agg(
    key,
    jsonb_build_object(
      'focus', value->>'focus',
      'groups', (
        SELECT jsonb_agg(
          CASE elem::text
            WHEN '"chest"' THEN '"upper_chest"'
            WHEN '"back"' THEN '"back_lats"'
            WHEN '"traps"' THEN '"upper_traps"'
            WHEN '"shoulders"' THEN '"front_delts"'
            WHEN '"calves"' THEN NULL
            ELSE elem
          END
        )
        FROM jsonb_array_elements(value->'groups') AS elem
        WHERE CASE elem::text WHEN '"calves"' THEN false ELSE true END
      )
    )
  )
  FROM jsonb_each(weekly_split_schedule)
)
WHERE weekly_split_schedule IS NOT NULL;

-- ── Fix body_part = 'Other' where we can resolve from exercise_library ──
UPDATE workout_exercises we
SET body_part = el.body_part
FROM exercise_library el
WHERE we.exercise_library_id = el.id
  AND (we.body_part IS NULL OR we.body_part = 'Other')
  AND el.body_part IS NOT NULL
  AND el.body_part != 'Other';

COMMIT;
