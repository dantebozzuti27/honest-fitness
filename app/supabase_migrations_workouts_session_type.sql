-- ============================================================================
-- MIGRATION: Workout session type (workout vs recovery)
-- Purpose: Differentiate strength/cardio workouts from recovery sessions
-- ============================================================================

-- Add column (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'workouts'
      AND column_name = 'session_type'
  ) THEN
    ALTER TABLE public.workouts
      ADD COLUMN session_type TEXT NOT NULL DEFAULT 'workout'
      CHECK (session_type IN ('workout', 'recovery'));

    CREATE INDEX IF NOT EXISTS idx_workouts_user_date_session_type
      ON public.workouts (user_id, date, session_type);
  END IF;
END $$;



