-- Migration: Taxonomy expansion + mesocycle tracking (RDS-compatible)
-- Date: 2026-03-26
-- Description:
--   1. Add mesocycle tracking columns to user_preferences
--   2. Add pectoralis_major_lower to decline/dip exercises (text[] columns)
--   3. Update weekly_split_schedule with new 24-group taxonomy

BEGIN;

-- 1. Mesocycle tracking columns
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS mesocycle_week INTEGER DEFAULT 1;
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS mesocycle_start_date DATE DEFAULT NULL;

-- 2. Update exercise_library: add pectoralis_major_lower to exercises targeting lower chest
-- primary_muscles is text[], not jsonb — use array_append
UPDATE exercise_library
SET primary_muscles = array_append(primary_muscles, 'pectoralis_major_lower')
WHERE name = 'Decline Barbell Bench Press'
  AND NOT ('pectoralis_major_lower' = ANY(primary_muscles));

UPDATE exercise_library
SET primary_muscles = array_append(primary_muscles, 'pectoralis_major_lower')
WHERE name = 'Chest Dip'
  AND NOT ('pectoralis_major_lower' = ANY(primary_muscles));

UPDATE exercise_library
SET primary_muscles = array_append(primary_muscles, 'pectoralis_major_lower')
WHERE name = 'Ring Dip'
  AND NOT ('pectoralis_major_lower' = ANY(primary_muscles));

UPDATE exercise_library
SET primary_muscles = array_append(primary_muscles, 'pectoralis_major_lower')
WHERE name = 'Decline Machine Chest Press'
  AND NOT ('pectoralis_major_lower' = ANY(primary_muscles));

UPDATE exercise_library
SET primary_muscles = array_append(primary_muscles, 'pectoralis_major_lower')
WHERE name = 'High-to-Low Cable Fly'
  AND NOT ('pectoralis_major_lower' = ANY(primary_muscles));

-- 3. Update weekly_split_schedule with new taxonomy group names
-- Target user by user_id directly (no auth.users table in RDS)
-- UPDATE user_preferences SET weekly_split_schedule = '...'::jsonb WHERE user_id = '<user_id>';

COMMIT;
