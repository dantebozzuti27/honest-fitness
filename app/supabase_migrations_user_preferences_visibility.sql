-- ============================================================================
-- MIGRATION: User preferences - default feed visibility
-- Purpose: Public-by-default safety rail with user-controlled default
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_preferences'
      AND column_name = 'default_visibility'
  ) THEN
    ALTER TABLE public.user_preferences
      ADD COLUMN default_visibility TEXT NOT NULL DEFAULT 'public'
      CHECK (default_visibility IN ('public', 'friends', 'private'));
  END IF;
END $$;


