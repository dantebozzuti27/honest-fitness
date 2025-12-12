-- Add workout wearable metrics columns to workouts table
-- Run this in your Supabase SQL editor
-- This adds workout_calories_burned and workout_steps columns to track wearable metrics during workouts

DO $$ 
BEGIN
  -- Add workout_calories_burned column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'workouts' 
    AND column_name = 'workout_calories_burned'
  ) THEN
    ALTER TABLE workouts ADD COLUMN workout_calories_burned NUMERIC;
  END IF;

  -- Add workout_steps column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'workouts' 
    AND column_name = 'workout_steps'
  ) THEN
    ALTER TABLE workouts ADD COLUMN workout_steps INTEGER;
  END IF;
END $$;

