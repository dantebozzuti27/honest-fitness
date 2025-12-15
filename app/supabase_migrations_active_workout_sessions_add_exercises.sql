-- Add exercises column to active_workout_sessions table
-- This allows auto-saving exercise progress during workouts

DO $$ 
BEGIN
  -- Add exercises column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'active_workout_sessions' AND column_name = 'exercises'
  ) THEN
    ALTER TABLE active_workout_sessions 
    ADD COLUMN exercises JSONB DEFAULT '[]'::jsonb;
    
    -- Add comment
    COMMENT ON COLUMN active_workout_sessions.exercises IS 'Auto-saved exercise progress during active workout';
  END IF;
END $$;

