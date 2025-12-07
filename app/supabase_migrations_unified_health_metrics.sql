-- ============================================================================
-- MIGRATION: Unified Health Metrics Table
-- Purpose: Create standardized health_metrics table and migrate existing data
-- Date: [To be filled]
-- ============================================================================

-- Step 1: Create unified health_metrics table
CREATE TABLE IF NOT EXISTS health_metrics (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  
  -- Standardized wearable metrics (from Fitbit, Oura, Apple Watch)
  resting_heart_rate NUMERIC,
  hrv NUMERIC,
  body_temp NUMERIC,
  sleep_score NUMERIC,
  sleep_duration NUMERIC, -- minutes
  deep_sleep NUMERIC, -- minutes
  rem_sleep NUMERIC, -- minutes
  light_sleep NUMERIC, -- minutes
  calories_burned NUMERIC,
  steps INTEGER,
  breathing_rate NUMERIC,
  spo2 NUMERIC, -- Blood oxygen saturation
  strain NUMERIC,
  
  -- Manual input metrics (with forward-fill logic)
  weight NUMERIC,
  body_fat_percentage NUMERIC,
  
  -- Nutrition (from daily_metrics)
  meals JSONB,
  macros JSONB,
  water NUMERIC DEFAULT 0,
  calories_consumed NUMERIC,
  
  -- Source tracking
  source_provider TEXT, -- 'fitbit', 'oura', 'apple_watch', 'manual', 'merged'
  source_data JSONB, -- Store raw provider-specific data for reference
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, date)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_health_metrics_user_date ON health_metrics(user_id, date);
CREATE INDEX IF NOT EXISTS idx_health_metrics_date ON health_metrics(date);
CREATE INDEX IF NOT EXISTS idx_health_metrics_source ON health_metrics(source_provider);

-- Enable RLS
ALTER TABLE health_metrics ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can view own health_metrics" ON health_metrics;
DROP POLICY IF EXISTS "Users can insert own health_metrics" ON health_metrics;
DROP POLICY IF EXISTS "Users can update own health_metrics" ON health_metrics;
DROP POLICY IF EXISTS "Users can delete own health_metrics" ON health_metrics;

CREATE POLICY "Users can view own health_metrics" ON health_metrics
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own health_metrics" ON health_metrics
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own health_metrics" ON health_metrics
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own health_metrics" ON health_metrics
  FOR DELETE USING (auth.uid() = user_id);

-- Step 2: Migrate Oura data
INSERT INTO health_metrics (
  user_id, date,
  resting_heart_rate, hrv, body_temp,
  sleep_score, sleep_duration, deep_sleep, rem_sleep, light_sleep,
  calories_burned, steps,
  source_provider, source_data,
  created_at, updated_at
)
SELECT 
  user_id, date,
  resting_heart_rate, hrv, body_temp,
  sleep_score, total_sleep, deep_sleep, rem_sleep, light_sleep,
  calories, steps,
  'oura',
  jsonb_build_object(
    'activity_score', activity_score,
    'readiness_score', readiness_score,
    'sleep_efficiency', sleep_efficiency,
    'active_calories', active_calories
  ),
  created_at, updated_at
FROM oura_daily
ON CONFLICT (user_id, date) DO UPDATE SET
  resting_heart_rate = COALESCE(EXCLUDED.resting_heart_rate, health_metrics.resting_heart_rate),
  hrv = COALESCE(EXCLUDED.hrv, health_metrics.hrv),
  body_temp = COALESCE(EXCLUDED.body_temp, health_metrics.body_temp),
  sleep_score = COALESCE(EXCLUDED.sleep_score, health_metrics.sleep_score),
  sleep_duration = COALESCE(EXCLUDED.sleep_duration, health_metrics.sleep_duration),
  deep_sleep = COALESCE(EXCLUDED.deep_sleep, health_metrics.deep_sleep),
  rem_sleep = COALESCE(EXCLUDED.rem_sleep, health_metrics.rem_sleep),
  light_sleep = COALESCE(EXCLUDED.light_sleep, health_metrics.light_sleep),
  calories_burned = COALESCE(EXCLUDED.calories_burned, health_metrics.calories_burned),
  steps = COALESCE(EXCLUDED.steps, health_metrics.steps),
  source_provider = CASE 
    WHEN health_metrics.source_provider = 'merged' THEN 'merged'
    WHEN health_metrics.source_provider != EXCLUDED.source_provider THEN 'merged'
    ELSE EXCLUDED.source_provider
  END,
  source_data = health_metrics.source_data || EXCLUDED.source_data,
  updated_at = NOW();

-- Step 3: Migrate Fitbit data
-- First, ensure enhanced columns exist (run fitbit_enhancements migration first if needed)
DO $$ 
BEGIN
  -- Add enhanced columns if they don't exist (from fitbit_enhancements migration)
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

-- Now migrate the data (all columns should exist now)
INSERT INTO health_metrics (
  user_id, date,
  resting_heart_rate, hrv, body_temp,
  sleep_duration,
  calories_burned, steps,
  source_provider, source_data,
  created_at, updated_at
)
SELECT 
  user_id, date,
  resting_heart_rate, hrv, body_temp,
  sleep_duration,
  calories, steps,
  'fitbit',
  jsonb_build_object(
    'sleep_efficiency', sleep_efficiency,
    'active_calories', active_calories,
    'distance', distance,
    'floors', floors,
    'average_heart_rate', average_heart_rate,
    'sedentary_minutes', sedentary_minutes,
    'lightly_active_minutes', lightly_active_minutes,
    'fairly_active_minutes', fairly_active_minutes,
    'very_active_minutes', very_active_minutes,
    'marginal_calories', marginal_calories,
    'weight', weight,
    'bmi', bmi,
    'fat', fat
  ),
  created_at, updated_at
FROM fitbit_daily
ON CONFLICT (user_id, date) DO UPDATE SET
  resting_heart_rate = COALESCE(EXCLUDED.resting_heart_rate, health_metrics.resting_heart_rate),
  hrv = COALESCE(EXCLUDED.hrv, health_metrics.hrv),
  body_temp = COALESCE(EXCLUDED.body_temp, health_metrics.body_temp),
  sleep_duration = COALESCE(EXCLUDED.sleep_duration, health_metrics.sleep_duration),
  calories_burned = COALESCE(EXCLUDED.calories_burned, health_metrics.calories_burned),
  steps = COALESCE(EXCLUDED.steps, health_metrics.steps),
  source_provider = CASE 
    WHEN health_metrics.source_provider = 'merged' THEN 'merged'
    WHEN health_metrics.source_provider != EXCLUDED.source_provider THEN 'merged'
    ELSE EXCLUDED.source_provider
  END,
  source_data = health_metrics.source_data || EXCLUDED.source_data,
  updated_at = NOW();

-- Step 4: Migrate daily_metrics data
-- First, ensure created_at and updated_at exist in daily_metrics
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'daily_metrics' AND column_name = 'created_at'
  ) THEN
    ALTER TABLE daily_metrics ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW();
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'daily_metrics' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE daily_metrics ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
  END IF;
END $$;

-- Now migrate the data
INSERT INTO health_metrics (
  user_id, date,
  hrv, sleep_score, sleep_duration, steps, calories_burned,
  weight, resting_heart_rate, body_temp,
  meals, macros, water, calories_consumed,
  source_provider, source_data,
  created_at, updated_at
)
SELECT 
  user_id, date,
  hrv, sleep_score, sleep_time, steps, calories,
  weight, resting_heart_rate, body_temp,
  meals, macros, water, calories_consumed,
  'manual',
  jsonb_build_object('migrated_from', 'daily_metrics'),
  COALESCE(created_at, NOW()),
  COALESCE(updated_at, NOW())
FROM daily_metrics
WHERE user_id IS NOT NULL AND date IS NOT NULL
ON CONFLICT (user_id, date) DO UPDATE SET
  hrv = COALESCE(EXCLUDED.hrv, health_metrics.hrv),
  sleep_score = COALESCE(EXCLUDED.sleep_score, health_metrics.sleep_score),
  sleep_duration = COALESCE(EXCLUDED.sleep_duration, health_metrics.sleep_duration),
  steps = COALESCE(EXCLUDED.steps, health_metrics.steps),
  calories_burned = COALESCE(EXCLUDED.calories_burned, health_metrics.calories_burned),
  weight = COALESCE(EXCLUDED.weight, health_metrics.weight),
  resting_heart_rate = COALESCE(EXCLUDED.resting_heart_rate, health_metrics.resting_heart_rate),
  body_temp = COALESCE(EXCLUDED.body_temp, health_metrics.body_temp),
  meals = COALESCE(EXCLUDED.meals, health_metrics.meals),
  macros = COALESCE(EXCLUDED.macros, health_metrics.macros),
  water = COALESCE(EXCLUDED.water, health_metrics.water),
  calories_consumed = COALESCE(EXCLUDED.calories_consumed, health_metrics.calories_consumed),
  source_provider = CASE 
    WHEN health_metrics.source_provider = 'merged' THEN 'merged'
    WHEN health_metrics.source_provider != EXCLUDED.source_provider THEN 'merged'
    ELSE EXCLUDED.source_provider
  END,
  source_data = health_metrics.source_data || EXCLUDED.source_data,
  -- Preserve original created_at, only update updated_at
  created_at = COALESCE(health_metrics.created_at, EXCLUDED.created_at),
  updated_at = NOW();

-- Step 5: Mark old tables as deprecated (keep for backward compatibility)
COMMENT ON TABLE oura_daily IS 'DEPRECATED: Use health_metrics table instead. Kept for backward compatibility.';
COMMENT ON TABLE fitbit_daily IS 'DEPRECATED: Use health_metrics table instead. Kept for backward compatibility.';
COMMENT ON TABLE daily_metrics IS 'DEPRECATED: Use health_metrics table instead. Kept for backward compatibility.';

