-- Migration: weekly_split_schedule column on user_preferences
--
-- Adds the JSONB column that stores per-day-of-week muscle group selections
-- so the workout engine can hard-filter session candidates to the user's
-- chosen muscles for each day. This is the highest-priority split signal in
-- the engine — overrides preferred_split rotation, detected splits, and
-- historical day-of-week patterns.
--
-- Shape:
--   {
--     "0": { "focus": "Rest"|"Push"|..., "groups": ["upper_chest", "triceps", ...] },
--     "1": { "focus": "Pull",            "groups": ["back_lats", "biceps", ...] },
--     ...
--     "6": { ... }
--   }
-- Keys are day-of-week numbers as strings (Sunday=0 ... Saturday=6).
-- A day with empty groups is treated as a rest day for split-routing
-- purposes (the engine still falls back to detected pattern).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_preferences'
      AND column_name = 'weekly_split_schedule'
  ) THEN
    ALTER TABLE user_preferences
      ADD COLUMN weekly_split_schedule JSONB;
  END IF;
END $$;

-- No backfill: NULL is a valid "no schedule set" state. The engine treats
-- NULL as "fall through to preferred_split rotation or detected split".
