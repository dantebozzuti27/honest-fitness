-- Migration: Add missing columns to workout_exercises
-- These columns are referenced by saveWorkoutToSupabase but were never added to the schema.
-- Without them, every exercise INSERT fails with 42703, leaving saved workouts empty.

ALTER TABLE workout_exercises ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE workout_exercises ADD COLUMN IF NOT EXISTS equipment TEXT;
ALTER TABLE workout_exercises ADD COLUMN IF NOT EXISTS exercise_order INTEGER DEFAULT 0;
ALTER TABLE workout_exercises ADD COLUMN IF NOT EXISTS stacked BOOLEAN DEFAULT FALSE;
ALTER TABLE workout_exercises ADD COLUMN IF NOT EXISTS stack_group TEXT;
