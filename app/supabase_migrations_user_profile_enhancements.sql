-- ============================================================================
-- MIGRATION: User Profile Enhancements
-- Purpose: Add date of birth, gender, height to user_preferences
-- ============================================================================

-- Add date of birth, gender, and height columns
DO $$ 
BEGIN
  -- Date of birth (for age calculation)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'user_preferences' AND column_name = 'date_of_birth'
  ) THEN
    ALTER TABLE user_preferences ADD COLUMN date_of_birth DATE;
  END IF;
  
  -- Gender
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'user_preferences' AND column_name = 'gender'
  ) THEN
    ALTER TABLE user_preferences ADD COLUMN gender TEXT CHECK (gender IN ('male', 'female', 'other', 'prefer_not_to_say'));
  END IF;
  
  -- Height in inches (store as total inches for easier calculation)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'user_preferences' AND column_name = 'height_inches'
  ) THEN
    ALTER TABLE user_preferences ADD COLUMN height_inches NUMERIC;
  END IF;
  
  -- Height in feet (for display purposes, calculated from height_inches)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'user_preferences' AND column_name = 'height_feet'
  ) THEN
    ALTER TABLE user_preferences ADD COLUMN height_feet INTEGER;
  END IF;
END $$;

-- Function to calculate age from date of birth
CREATE OR REPLACE FUNCTION calculate_age(date_of_birth DATE)
RETURNS INTEGER AS $$
BEGIN
  IF date_of_birth IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN EXTRACT(YEAR FROM AGE(date_of_birth));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

