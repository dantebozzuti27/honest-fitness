-- ============================================================================
-- ONBOARDING COMPLETION TRACKING
-- Purpose: Add column to track if user has completed onboarding
-- ============================================================================

-- Add onboarding_completed column to user_preferences
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'user_preferences' AND column_name = 'onboarding_completed'
  ) THEN
    ALTER TABLE user_preferences ADD COLUMN onboarding_completed BOOLEAN DEFAULT FALSE;
  END IF;
END $$;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_preferences_onboarding ON user_preferences(user_id, onboarding_completed) WHERE onboarding_completed = FALSE;

