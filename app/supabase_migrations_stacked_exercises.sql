-- ============================================================================
-- MIGRATION: Stacked Exercises (Supersets & Circuits)
-- Purpose: Add support for saving stacked exercise information to workout_exercises
-- Date: [Run Date]
-- ============================================================================

-- Add stacked and stack_group columns to workout_exercises table
DO $$ 
BEGIN
  -- Add stacked column (boolean to indicate if exercise is part of a stack)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'workout_exercises' AND column_name = 'stacked'
  ) THEN
    ALTER TABLE workout_exercises ADD COLUMN stacked BOOLEAN DEFAULT FALSE;
  END IF;
  
  -- Add stack_group column (identifier to group exercises in the same stack)
  -- This allows multiple exercises to share the same stack_group ID
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'workout_exercises' AND column_name = 'stack_group'
  ) THEN
    ALTER TABLE workout_exercises ADD COLUMN stack_group TEXT;
  END IF;
END $$;

-- Create index for stack_group for efficient queries
CREATE INDEX IF NOT EXISTS idx_workout_exercises_stack_group 
  ON workout_exercises(workout_id, stack_group) 
  WHERE stack_group IS NOT NULL;

-- Add comment to document the columns
COMMENT ON COLUMN workout_exercises.stacked IS 'Indicates if this exercise is part of a superset (2 exercises) or circuit (3+ exercises)';
COMMENT ON COLUMN workout_exercises.stack_group IS 'Identifier to group exercises in the same stack. Exercises with the same stack_group are performed together.';

