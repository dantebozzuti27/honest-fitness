-- Additional columns for Fitbit data
-- Run this migration to add all Fitbit stats to fitbit_daily table

-- Add additional activity metrics
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'fitbit_daily' AND column_name = 'average_heart_rate'
  ) THEN
    ALTER TABLE fitbit_daily ADD COLUMN average_heart_rate NUMERIC;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'fitbit_daily' AND column_name = 'sedentary_minutes'
  ) THEN
    ALTER TABLE fitbit_daily ADD COLUMN sedentary_minutes INTEGER;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'fitbit_daily' AND column_name = 'lightly_active_minutes'
  ) THEN
    ALTER TABLE fitbit_daily ADD COLUMN lightly_active_minutes INTEGER;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'fitbit_daily' AND column_name = 'fairly_active_minutes'
  ) THEN
    ALTER TABLE fitbit_daily ADD COLUMN fairly_active_minutes INTEGER;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'fitbit_daily' AND column_name = 'very_active_minutes'
  ) THEN
    ALTER TABLE fitbit_daily ADD COLUMN very_active_minutes INTEGER;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'fitbit_daily' AND column_name = 'marginal_calories'
  ) THEN
    ALTER TABLE fitbit_daily ADD COLUMN marginal_calories NUMERIC;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'fitbit_daily' AND column_name = 'weight'
  ) THEN
    ALTER TABLE fitbit_daily ADD COLUMN weight NUMERIC;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'fitbit_daily' AND column_name = 'bmi'
  ) THEN
    ALTER TABLE fitbit_daily ADD COLUMN bmi NUMERIC;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'fitbit_daily' AND column_name = 'fat'
  ) THEN
    ALTER TABLE fitbit_daily ADD COLUMN fat NUMERIC;
  END IF;
END $$;

