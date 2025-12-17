-- ============================================================================
-- Supabase RUN-ALL (SQL EDITOR COMPATIBLE)
-- Paste this entire file into Supabase SQL Editor and run.
-- Includes: complete_database_upgrade + feed + user_profiles constraints + social fixes + session_type + default_visibility
-- Idempotency: adds DROP guards for CREATE POLICY / CREATE TRIGGER.
-- NOTE: Does NOT include the optional exercise seed reset/rebuild script.
-- ============================================================================

-- ============================================================================
-- COMPLETE DATABASE UPGRADE MIGRATION
-- Purpose: All database enhancements in one comprehensive migration
-- Date: [Run Date]
-- 
-- This migration includes:
-- 1. Unified Health Metrics Table
-- 2. User Profile Enhancements
-- 3. Forward-Fill Metrics Function
-- 4. Exercise Library & Enhancements
-- 5. Nutrition Database
-- 6. Goals Enhancements
-- 7. Apple Watch Support
-- ============================================================================

-- ============================================================================
-- PHASE 1: Unified Health Metrics Table
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
  micros JSONB,
  water NUMERIC DEFAULT 0,
  calories_consumed NUMERIC,
  
  -- Source tracking
  source_provider TEXT, -- 'fitbit', 'oura', 'apple_watch', 'manual', 'merged'
  source_data JSONB, -- Store raw provider-specific data for reference
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, date)
);

-- Ensure nutrition micros column exists even if `health_metrics` was created previously.
ALTER TABLE health_metrics ADD COLUMN IF NOT EXISTS micros JSONB;

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

DROP POLICY IF EXISTS "Users can view own health_metrics" ON health_metrics;
CREATE POLICY "Users can view own health_metrics" ON health_metrics
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own health_metrics" ON health_metrics;
CREATE POLICY "Users can insert own health_metrics" ON health_metrics
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own health_metrics" ON health_metrics;
CREATE POLICY "Users can update own health_metrics" ON health_metrics
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own health_metrics" ON health_metrics;
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
-- First, ensure enhanced columns exist
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

-- Now migrate the data
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
  hrv, sleep_score, 
  CASE 
    WHEN sleep_time IS NULL THEN NULL
    WHEN sleep_time::text ~ '^[0-9]+:[0-9]+$' THEN 
      -- Parse time format HH:MM and convert to minutes
      (SPLIT_PART(sleep_time::text, ':', 1)::INTEGER * 60 + 
       SPLIT_PART(sleep_time::text, ':', 2)::INTEGER)::NUMERIC
    ELSE 
      -- Try direct numeric conversion (handles both numeric and text numeric values)
      CASE 
        WHEN sleep_time::text ~ '^[0-9]+\.?[0-9]*$' THEN sleep_time::text::NUMERIC
        ELSE NULL
      END
  END as sleep_duration,
  steps, calories,
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
  created_at = COALESCE(health_metrics.created_at, EXCLUDED.created_at),
  updated_at = NOW();

-- Mark old tables as deprecated (keep for backward compatibility)
COMMENT ON TABLE oura_daily IS 'DEPRECATED: Use health_metrics table instead. Kept for backward compatibility.';
COMMENT ON TABLE fitbit_daily IS 'DEPRECATED: Use health_metrics table instead. Kept for backward compatibility.';
COMMENT ON TABLE daily_metrics IS 'DEPRECATED: Use health_metrics table instead. Kept for backward compatibility.';

-- ============================================================================
-- PHASE 2: User Profile Enhancements
-- ============================================================================

-- Add date of birth, gender, and height columns
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'user_preferences' AND column_name = 'date_of_birth'
  ) THEN
    ALTER TABLE user_preferences ADD COLUMN date_of_birth DATE;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'user_preferences' AND column_name = 'gender'
  ) THEN
    ALTER TABLE user_preferences ADD COLUMN gender TEXT CHECK (gender IN ('male', 'female', 'other', 'prefer_not_to_say'));
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'user_preferences' AND column_name = 'height_inches'
  ) THEN
    ALTER TABLE user_preferences ADD COLUMN height_inches NUMERIC;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'user_preferences' AND column_name = 'height_feet'
  ) THEN
    ALTER TABLE user_preferences ADD COLUMN height_feet INTEGER;
  END IF;

  -- Lifter plan config (Planner)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_preferences' AND column_name = 'training_split'
  ) THEN
    ALTER TABLE user_preferences ADD COLUMN training_split TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_preferences' AND column_name = 'progression_model'
  ) THEN
    ALTER TABLE user_preferences ADD COLUMN progression_model TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_preferences' AND column_name = 'weekly_sets_targets'
  ) THEN
    ALTER TABLE user_preferences ADD COLUMN weekly_sets_targets JSONB NOT NULL DEFAULT '{}'::jsonb;
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

-- ============================================================================
-- PHASE 3: Forward-Fill Function for Manual Metrics
-- ============================================================================

-- Function to forward-fill manual metrics (weight, body_fat_percentage)
CREATE OR REPLACE FUNCTION forward_fill_manual_metrics(
  p_user_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS VOID AS $$
DECLARE
  loop_date DATE;
  last_weight NUMERIC := NULL;
  last_body_fat NUMERIC := NULL;
BEGIN
  -- Get the last known values before start_date
  SELECT weight, body_fat_percentage INTO last_weight, last_body_fat
  FROM health_metrics
  WHERE user_id = p_user_id
    AND date < p_start_date
    AND (weight IS NOT NULL OR body_fat_percentage IS NOT NULL)
  ORDER BY date DESC
  LIMIT 1;
  
  -- Iterate through each date and forward-fill
  loop_date := p_start_date;
  WHILE loop_date <= p_end_date LOOP
    UPDATE health_metrics
    SET 
      weight = COALESCE(weight, last_weight),
      body_fat_percentage = COALESCE(body_fat_percentage, last_body_fat),
      updated_at = CASE 
        WHEN weight IS NULL AND last_weight IS NOT NULL THEN NOW()
        WHEN body_fat_percentage IS NULL AND last_body_fat IS NOT NULL THEN NOW()
        ELSE updated_at
      END
    WHERE user_id = p_user_id
      AND date = loop_date
      AND (weight IS NULL OR body_fat_percentage IS NULL);
    
    -- Update last known values if this date has new data
    SELECT weight, body_fat_percentage INTO last_weight, last_body_fat
    FROM health_metrics
    WHERE user_id = p_user_id AND date = loop_date;
    
    loop_date := loop_date + INTERVAL '1 day';
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Trigger function to forward-fill when manual metrics are updated
CREATE OR REPLACE FUNCTION trigger_forward_fill_metrics()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'UPDATE' AND (
    (OLD.weight IS DISTINCT FROM NEW.weight AND NEW.weight IS NOT NULL) OR
    (OLD.body_fat_percentage IS DISTINCT FROM NEW.body_fat_percentage AND NEW.body_fat_percentage IS NOT NULL)
  )) OR (TG_OP = 'INSERT' AND (NEW.weight IS NOT NULL OR NEW.body_fat_percentage IS NOT NULL)) THEN
    -- Cast to DATE to ensure correct type (DATE + INTERVAL can become TIMESTAMP)
    PERFORM forward_fill_manual_metrics(
      NEW.user_id,
      (NEW.date + INTERVAL '1 day')::DATE,
      (NEW.date + INTERVAL '30 days')::DATE
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS auto_forward_fill_metrics ON health_metrics;
DROP TRIGGER IF EXISTS auto_forward_fill_metrics ON health_metrics;
CREATE TRIGGER auto_forward_fill_metrics
  AFTER INSERT OR UPDATE OF weight, body_fat_percentage ON health_metrics
  FOR EACH ROW
  EXECUTE FUNCTION trigger_forward_fill_metrics();

-- ============================================================================
-- PHASE 4: Exercise Library and Enhancements
-- ============================================================================

-- Create Exercise Library Table
CREATE TABLE IF NOT EXISTS exercise_library (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL, -- 'strength', 'cardio', 'flexibility', 'sport', etc.
  body_part TEXT NOT NULL, -- 'chest', 'back', 'legs', 'arms', 'core', 'full_body', 'cardio'
  sub_body_parts TEXT[], -- Array of sub body parts: ['glutes', 'quads', 'hamstrings']
  equipment TEXT[], -- Array of equipment needed: ['barbell', 'dumbbells', 'bodyweight']
  is_custom BOOLEAN DEFAULT FALSE, -- True if created by a user
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  description TEXT,
  instructions TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_exercise_library_category ON exercise_library(category);
CREATE INDEX IF NOT EXISTS idx_exercise_library_body_part ON exercise_library(body_part);
CREATE INDEX IF NOT EXISTS idx_exercise_library_custom ON exercise_library(created_by_user_id) WHERE is_custom = TRUE;

-- Partial unique indexes (for conditional uniqueness)
CREATE UNIQUE INDEX IF NOT EXISTS idx_exercise_library_custom_unique 
  ON exercise_library(name, created_by_user_id) WHERE is_custom = TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_exercise_library_system_unique 
  ON exercise_library(name) WHERE is_custom = FALSE;

-- Enable RLS
ALTER TABLE exercise_library ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Anyone can view system exercises" ON exercise_library;
DROP POLICY IF EXISTS "Users can view own custom exercises" ON exercise_library;
DROP POLICY IF EXISTS "Users can insert own custom exercises" ON exercise_library;
DROP POLICY IF EXISTS "Users can update own custom exercises" ON exercise_library;
DROP POLICY IF EXISTS "Users can delete own custom exercises" ON exercise_library;

DROP POLICY IF EXISTS "Anyone can view system exercises" ON exercise_library;
CREATE POLICY "Anyone can view system exercises" ON exercise_library
  FOR SELECT USING (is_custom = FALSE);

DROP POLICY IF EXISTS "Users can view own custom exercises" ON exercise_library;
CREATE POLICY "Users can view own custom exercises" ON exercise_library
  FOR SELECT USING (is_custom = TRUE AND auth.uid() = created_by_user_id);

DROP POLICY IF EXISTS "Users can insert own custom exercises" ON exercise_library;
CREATE POLICY "Users can insert own custom exercises" ON exercise_library
  FOR INSERT WITH CHECK (is_custom = TRUE AND auth.uid() = created_by_user_id);

DROP POLICY IF EXISTS "Users can update own custom exercises" ON exercise_library;
CREATE POLICY "Users can update own custom exercises" ON exercise_library
  FOR UPDATE USING (is_custom = TRUE AND auth.uid() = created_by_user_id);

DROP POLICY IF EXISTS "Users can delete own custom exercises" ON exercise_library;
CREATE POLICY "Users can delete own custom exercises" ON exercise_library
  FOR DELETE USING (is_custom = TRUE AND auth.uid() = created_by_user_id);

-- Enhance workout_exercises Table
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'workout_exercises' AND column_name = 'exercise_type'
  ) THEN
    ALTER TABLE workout_exercises ADD COLUMN exercise_type TEXT CHECK (exercise_type IN ('weightlifting', 'cardio'));
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'workout_exercises' AND column_name = 'distance'
  ) THEN
    ALTER TABLE workout_exercises ADD COLUMN distance NUMERIC;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'workout_exercises' AND column_name = 'distance_unit'
  ) THEN
    ALTER TABLE workout_exercises ADD COLUMN distance_unit TEXT DEFAULT 'km' CHECK (distance_unit IN ('km', 'miles'));
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'workout_exercises' AND column_name = 'exercise_library_id'
  ) THEN
    ALTER TABLE workout_exercises ADD COLUMN exercise_library_id UUID REFERENCES exercise_library(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Populate Exercise Library with Common Exercises
INSERT INTO exercise_library (name, category, body_part, sub_body_parts, equipment, is_custom) VALUES
-- Legs
('Squats', 'strength', 'legs', ARRAY['glutes', 'quads', 'hamstrings'], ARRAY['barbell', 'bodyweight'], FALSE),
('Deadlifts', 'strength', 'legs', ARRAY['glutes', 'hamstrings', 'lower_back'], ARRAY['barbell'], FALSE),
('Lunges', 'strength', 'legs', ARRAY['glutes', 'quads'], ARRAY['bodyweight', 'dumbbells'], FALSE),
('Leg Press', 'strength', 'legs', ARRAY['quads', 'glutes'], ARRAY['machine'], FALSE),
('Leg Curls', 'strength', 'legs', ARRAY['hamstrings'], ARRAY['machine'], FALSE),
('Leg Extensions', 'strength', 'legs', ARRAY['quads'], ARRAY['machine'], FALSE),
-- Chest
('Bench Press', 'strength', 'chest', ARRAY['chest', 'triceps', 'shoulders'], ARRAY['barbell', 'dumbbells'], FALSE),
('Push-ups', 'strength', 'chest', ARRAY['chest', 'triceps', 'shoulders'], ARRAY['bodyweight'], FALSE),
('Chest Fly', 'strength', 'chest', ARRAY['chest'], ARRAY['dumbbells', 'machine'], FALSE),
-- Back
('Pull-ups', 'strength', 'back', ARRAY['lats', 'biceps'], ARRAY['bodyweight', 'pull-up_bar'], FALSE),
('Rows', 'strength', 'back', ARRAY['lats', 'rhomboids', 'biceps'], ARRAY['barbell', 'dumbbells', 'machine'], FALSE),
('Lat Pulldown', 'strength', 'back', ARRAY['lats', 'biceps'], ARRAY['machine'], FALSE),
-- Shoulders
('Shoulder Press', 'strength', 'shoulders', ARRAY['shoulders', 'triceps'], ARRAY['dumbbells', 'barbell'], FALSE),
('Lateral Raises', 'strength', 'shoulders', ARRAY['shoulders'], ARRAY['dumbbells'], FALSE),
-- Arms
('Bicep Curls', 'strength', 'arms', ARRAY['biceps'], ARRAY['dumbbells', 'barbell'], FALSE),
('Tricep Extensions', 'strength', 'arms', ARRAY['triceps'], ARRAY['dumbbells', 'cable'], FALSE),
-- Cardio
('Running', 'cardio', 'cardio', ARRAY['legs', 'cardio'], ARRAY['none'], FALSE),
('Cycling', 'cardio', 'cardio', ARRAY['legs', 'cardio'], ARRAY['bicycle', 'stationary_bike'], FALSE),
('Rowing', 'cardio', 'cardio', ARRAY['full_body', 'cardio'], ARRAY['rowing_machine'], FALSE),
('Elliptical', 'cardio', 'cardio', ARRAY['legs', 'cardio'], ARRAY['elliptical_machine'], FALSE),
('Swimming', 'cardio', 'cardio', ARRAY['full_body', 'cardio'], ARRAY['pool'], FALSE)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- PHASE 5: Nutrition Database
-- ============================================================================

-- Create Food Categories Table
CREATE TABLE IF NOT EXISTS food_categories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert common categories
INSERT INTO food_categories (name) VALUES
('meat'), ('dairy'), ('grains'), ('fruits'), ('vegetables'), 
('nuts'), ('oils'), ('legumes'), ('seafood'), ('beverages'),
('snacks'), ('desserts'), ('condiments'), ('other')
ON CONFLICT (name) DO NOTHING;

-- Create Food Library Table
CREATE TABLE IF NOT EXISTS food_library (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  brand TEXT,
  barcode TEXT,
  category_id UUID REFERENCES food_categories(id),
  calories_per_100g NUMERIC NOT NULL,
  protein_per_100g NUMERIC DEFAULT 0,
  carbs_per_100g NUMERIC DEFAULT 0,
  fat_per_100g NUMERIC DEFAULT 0,
  fiber_per_100g NUMERIC DEFAULT 0,
  sugar_per_100g NUMERIC DEFAULT 0,
  sodium_per_100g NUMERIC DEFAULT 0,
  micros_per_100g JSONB DEFAULT '{}'::jsonb,
  is_custom BOOLEAN DEFAULT FALSE,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_food_library_category ON food_library(category_id);
CREATE INDEX IF NOT EXISTS idx_food_library_custom ON food_library(created_by_user_id) WHERE is_custom = TRUE;
CREATE INDEX IF NOT EXISTS idx_food_library_name ON food_library(name);

-- Ensure newer columns exist even if `food_library` was created previously.
ALTER TABLE food_library ADD COLUMN IF NOT EXISTS brand TEXT;
ALTER TABLE food_library ADD COLUMN IF NOT EXISTS barcode TEXT;
ALTER TABLE food_library ADD COLUMN IF NOT EXISTS micros_per_100g JSONB DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_food_library_barcode ON food_library(barcode) WHERE barcode IS NOT NULL;

-- Full-text search (built-in Postgres; no extensions required)
ALTER TABLE food_library
  ADD COLUMN IF NOT EXISTS name_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce(name, ''))) STORED;
CREATE INDEX IF NOT EXISTS idx_food_library_name_tsv ON food_library USING GIN (name_tsv);

-- Partial unique indexes (for conditional uniqueness)
CREATE UNIQUE INDEX IF NOT EXISTS idx_food_library_custom_unique 
  ON food_library(name, created_by_user_id) WHERE is_custom = TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_food_library_system_unique 
  ON food_library(name) WHERE is_custom = FALSE;

-- Enable RLS
ALTER TABLE food_library ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Anyone can view system foods" ON food_library;
DROP POLICY IF EXISTS "Users can view own custom foods" ON food_library;
DROP POLICY IF EXISTS "Users can insert own custom foods" ON food_library;
DROP POLICY IF EXISTS "Users can update own custom foods" ON food_library;
DROP POLICY IF EXISTS "Users can delete own custom foods" ON food_library;

DROP POLICY IF EXISTS "Anyone can view system foods" ON food_library;
CREATE POLICY "Anyone can view system foods" ON food_library
  FOR SELECT USING (is_custom = FALSE);

DROP POLICY IF EXISTS "Users can view own custom foods" ON food_library;
CREATE POLICY "Users can view own custom foods" ON food_library
  FOR SELECT USING (is_custom = TRUE AND auth.uid() = created_by_user_id);

DROP POLICY IF EXISTS "Users can insert own custom foods" ON food_library;
CREATE POLICY "Users can insert own custom foods" ON food_library
  FOR INSERT WITH CHECK (is_custom = TRUE AND auth.uid() = created_by_user_id);

DROP POLICY IF EXISTS "Users can update own custom foods" ON food_library;
CREATE POLICY "Users can update own custom foods" ON food_library
  FOR UPDATE USING (is_custom = TRUE AND auth.uid() = created_by_user_id);

DROP POLICY IF EXISTS "Users can delete own custom foods" ON food_library;
CREATE POLICY "Users can delete own custom foods" ON food_library
  FOR DELETE USING (is_custom = TRUE AND auth.uid() = created_by_user_id);

-- Create User Food Preferences Table
CREATE TABLE IF NOT EXISTS user_food_preferences (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  food_id UUID NOT NULL REFERENCES food_library(id) ON DELETE CASCADE,
  is_favorite BOOLEAN DEFAULT FALSE,
  last_used_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, food_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_food_prefs_user ON user_food_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_user_food_prefs_favorite ON user_food_preferences(user_id, is_favorite) WHERE is_favorite = TRUE;
CREATE INDEX IF NOT EXISTS idx_user_food_prefs_recent ON user_food_preferences(user_id, last_used_at DESC);

-- Enable RLS
ALTER TABLE user_food_preferences ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can manage own food preferences" ON user_food_preferences;

DROP POLICY IF EXISTS "Users can manage own food preferences" ON user_food_preferences;
CREATE POLICY "Users can manage own food preferences" ON user_food_preferences
  FOR ALL USING (auth.uid() = user_id);

-- Populate Common Foods
INSERT INTO food_library (name, category_id, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, is_custom) 
SELECT 
  f.name,
  fc.id,
  f.calories,
  f.protein,
  f.carbs,
  f.fat,
  FALSE
FROM (VALUES
  ('Chicken Breast', 'meat', 165, 31, 0, 3.6),
  ('Salmon', 'seafood', 208, 20, 0, 12),
  ('Eggs', 'dairy', 155, 13, 1.1, 11),
  ('Greek Yogurt', 'dairy', 59, 10, 3.6, 0.4),
  ('Brown Rice', 'grains', 111, 2.6, 23, 0.9),
  ('Quinoa', 'grains', 120, 4.4, 22, 1.9),
  ('Banana', 'fruits', 89, 1.1, 23, 0.3),
  ('Apple', 'fruits', 52, 0.3, 14, 0.2),
  ('Broccoli', 'vegetables', 34, 2.8, 7, 0.4),
  ('Spinach', 'vegetables', 23, 2.9, 3.6, 0.4),
  ('Almonds', 'nuts', 579, 21, 22, 50),
  ('Olive Oil', 'oils', 884, 0, 0, 100)
) AS f(name, category_name, calories, protein, carbs, fat)
JOIN food_categories fc ON fc.name = f.category_name
ON CONFLICT DO NOTHING;

-- Expanded system foods (idempotent)
INSERT INTO food_library (name, category_id, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, is_custom)
SELECT f.name, fc.id, f.calories, f.protein, f.carbs, f.fat, FALSE
FROM (VALUES
  -- Meat / protein
  ('Turkey Breast', 'meat', 135, 29, 0, 1.5),
  ('Ground Beef (90% lean)', 'meat', 176, 20, 0, 10),
  ('Lean Beef Steak', 'meat', 217, 26, 0, 12),
  ('Pork Loin', 'meat', 242, 27, 0, 14),
  ('Bacon', 'meat', 541, 37, 1.4, 42),
  ('Ham', 'meat', 145, 21, 1.5, 5),
  ('Chicken Thigh', 'meat', 209, 18, 0, 15),
  ('Chicken Wings', 'meat', 203, 30, 0, 8),
  ('Tofu (firm)', 'legumes', 144, 17, 3.4, 9),
  ('Tempeh', 'legumes', 193, 20, 9, 11),
  -- Seafood
  ('Tuna (canned in water)', 'seafood', 116, 26, 0, 1),
  ('Shrimp', 'seafood', 99, 24, 0.2, 0.3),
  ('Cod', 'seafood', 82, 18, 0, 0.7),
  ('Tilapia', 'seafood', 96, 20, 0, 1.7),
  ('Sardines', 'seafood', 208, 25, 0, 11),
  -- Dairy
  ('Milk (whole)', 'dairy', 61, 3.2, 4.8, 3.3),
  ('Milk (skim)', 'dairy', 34, 3.4, 5, 0.1),
  ('Cheddar Cheese', 'dairy', 403, 25, 1.3, 33),
  ('Mozzarella', 'dairy', 280, 28, 3, 17),
  ('Cottage Cheese', 'dairy', 98, 11, 3.4, 4.3),
  ('Butter', 'dairy', 717, 0.9, 0.1, 81),
  ('Sour Cream', 'dairy', 193, 2.4, 4.6, 19),
  -- Grains / carbs
  ('Oats (rolled)', 'grains', 389, 16.9, 66.3, 6.9),
  ('White Rice (cooked)', 'grains', 130, 2.4, 28.2, 0.3),
  ('Pasta (cooked)', 'grains', 131, 5, 25, 1.1),
  ('Bread (white)', 'grains', 266, 8.9, 49, 3.2),
  ('Bread (whole wheat)', 'grains', 247, 13, 41, 4.2),
  ('Tortilla (flour)', 'grains', 313, 8, 52, 8),
  ('Bagel', 'grains', 250, 10, 48, 1.5),
  ('Cereal (corn flakes)', 'grains', 357, 7.5, 84, 0.4),
  ('Granola', 'grains', 471, 10, 64, 20),
  -- Fruits
  ('Orange', 'fruits', 47, 0.9, 12, 0.1),
  ('Strawberries', 'fruits', 32, 0.7, 7.7, 0.3),
  ('Blueberries', 'fruits', 57, 0.7, 14, 0.3),
  ('Grapes', 'fruits', 69, 0.7, 18, 0.2),
  ('Pineapple', 'fruits', 50, 0.5, 13, 0.1),
  ('Mango', 'fruits', 60, 0.8, 15, 0.4),
  ('Watermelon', 'fruits', 30, 0.6, 8, 0.2),
  ('Pear', 'fruits', 57, 0.4, 15, 0.1),
  ('Peach', 'fruits', 39, 0.9, 10, 0.3),
  ('Kiwi', 'fruits', 61, 1.1, 15, 0.5),
  -- Vegetables
  ('Carrots', 'vegetables', 41, 0.9, 10, 0.2),
  ('Potatoes', 'vegetables', 77, 2, 17, 0.1),
  ('Sweet Potato', 'vegetables', 86, 1.6, 20, 0.1),
  ('Tomatoes', 'vegetables', 18, 0.9, 3.9, 0.2),
  ('Cucumber', 'vegetables', 15, 0.7, 3.6, 0.1),
  ('Onion', 'vegetables', 40, 1.1, 9.3, 0.1),
  ('Bell Pepper', 'vegetables', 31, 1, 6, 0.3),
  ('Zucchini', 'vegetables', 17, 1.2, 3.1, 0.3),
  ('Mushrooms', 'vegetables', 22, 3.1, 3.3, 0.3),
  ('Cauliflower', 'vegetables', 25, 1.9, 5, 0.3),
  -- Legumes
  ('Black Beans (cooked)', 'legumes', 132, 8.9, 23.7, 0.5),
  ('Chickpeas (cooked)', 'legumes', 164, 8.9, 27.4, 2.6),
  ('Lentils (cooked)', 'legumes', 116, 9, 20, 0.4),
  ('Kidney Beans (cooked)', 'legumes', 127, 8.7, 22.8, 0.5),
  -- Nuts / seeds
  ('Peanut Butter', 'nuts', 588, 25, 20, 50),
  ('Peanuts', 'nuts', 567, 25.8, 16.1, 49.2),
  ('Walnuts', 'nuts', 654, 15.2, 13.7, 65.2),
  ('Cashews', 'nuts', 553, 18.2, 30.2, 43.9),
  ('Chia Seeds', 'nuts', 486, 16.5, 42.1, 30.7),
  ('Flax Seeds', 'nuts', 534, 18.3, 28.9, 42.2),
  -- Oils
  ('Avocado Oil', 'oils', 884, 0, 0, 100),
  ('Coconut Oil', 'oils', 862, 0, 0, 100),
  ('Canola Oil', 'oils', 884, 0, 0, 100),
  -- Beverages
  ('Orange Juice', 'beverages', 45, 0.7, 10.4, 0.2),
  ('Apple Juice', 'beverages', 46, 0.1, 11.3, 0.1),
  ('Soda (cola)', 'beverages', 42, 0, 10.6, 0),
  ('Coffee (black)', 'beverages', 1, 0.1, 0, 0),
  ('Tea (unsweetened)', 'beverages', 1, 0, 0.3, 0),
  -- Snacks / desserts
  ('Protein Bar', 'snacks', 350, 25, 35, 10),
  ('Chips', 'snacks', 536, 7, 53, 34),
  ('Popcorn (air-popped)', 'snacks', 387, 12.9, 77.8, 4.5),
  ('Dark Chocolate', 'desserts', 546, 4.9, 61, 31),
  ('Ice Cream (vanilla)', 'desserts', 207, 3.5, 24, 11),
  -- Condiments
  ('Ketchup', 'condiments', 112, 1.3, 26, 0.2),
  ('Mustard', 'condiments', 66, 4.4, 5.8, 3.7),
  ('Mayonnaise', 'condiments', 680, 1, 0.6, 75),
  ('Soy Sauce', 'condiments', 53, 8.1, 4.9, 0.6),
  ('Salsa', 'condiments', 36, 1.5, 7, 0.2),
  ('Hot Sauce', 'condiments', 12, 0.5, 2.7, 0.1),
  ('BBQ Sauce', 'condiments', 172, 0.6, 41, 0.8),
  ('Ranch Dressing', 'condiments', 430, 1, 7, 44),
  ('Italian Dressing', 'condiments', 281, 0.4, 7, 28),
  ('Honey', 'condiments', 304, 0.3, 82, 0),
  ('Maple Syrup', 'condiments', 260, 0, 67, 0),
  ('Jam (strawberry)', 'condiments', 278, 0.3, 69, 0.1),
  ('Peanut Sauce', 'condiments', 320, 11, 18, 22),
  ('Hummus', 'legumes', 166, 8, 14, 10),
  ('Edamame', 'legumes', 122, 11.9, 9.9, 5.2),
  ('Green Peas', 'vegetables', 81, 5.4, 14.5, 0.4),
  ('Corn', 'vegetables', 86, 3.4, 19, 1.2),
  ('Green Beans', 'vegetables', 31, 1.8, 7, 0.1),
  ('Asparagus', 'vegetables', 20, 2.2, 3.9, 0.1),
  ('Kale', 'vegetables', 49, 4.3, 8.8, 0.9),
  ('Cabbage', 'vegetables', 25, 1.3, 5.8, 0.1),
  ('Brussels Sprouts', 'vegetables', 43, 3.4, 9, 0.3),
  ('Eggplant', 'vegetables', 25, 1, 6, 0.2),
  ('Celery', 'vegetables', 16, 0.7, 3, 0.2),
  ('Raspberries', 'fruits', 52, 1.2, 12, 0.7),
  ('Blackberries', 'fruits', 43, 1.4, 10, 0.5),
  ('Cherries', 'fruits', 63, 1.1, 16, 0.2),
  ('Plums', 'fruits', 46, 0.7, 11, 0.3),
  ('Apricots', 'fruits', 48, 1.4, 11, 0.4),
  ('Grapefruit', 'fruits', 42, 0.8, 11, 0.1),
  ('Lemon', 'fruits', 29, 1.1, 9.3, 0.3),
  ('Lime', 'fruits', 30, 0.7, 11, 0.2),
  ('Yogurt (plain)', 'dairy', 61, 3.5, 4.7, 3.3),
  ('Yogurt (low-fat)', 'dairy', 63, 5.3, 7, 1.6),
  ('Cream Cheese', 'dairy', 342, 6.2, 5.5, 34),
  ('Parmesan', 'dairy', 431, 38, 4.1, 29),
  ('Ricotta', 'dairy', 174, 11.3, 3, 13),
  ('Kefir', 'dairy', 41, 3.3, 4.8, 1),
  ('Whey Protein Powder', 'dairy', 400, 80, 10, 7),
  ('Couscous (cooked)', 'grains', 112, 3.8, 23.2, 0.2),
  ('Barley (cooked)', 'grains', 123, 2.3, 28.2, 0.4),
  ('Bulgur (cooked)', 'grains', 83, 3.1, 18.6, 0.2),
  ('Corn Tortilla', 'grains', 218, 5.7, 44.6, 2.9),
  ('Pita Bread', 'grains', 275, 9.1, 55.7, 1.2),
  ('Naan', 'grains', 310, 9, 55, 7),
  ('Crackers', 'grains', 502, 9, 65, 22),
  ('Pretzels', 'snacks', 380, 10, 80, 3),
  ('Cookies', 'desserts', 488, 5.5, 66, 24),
  ('Brownie', 'desserts', 405, 4.6, 55, 19),
  ('Pizza (cheese)', 'snacks', 266, 11, 33, 10),
  ('Hamburger', 'snacks', 295, 17, 24, 14),
  ('French Fries', 'snacks', 312, 3.4, 41, 15),
  ('Oat Milk', 'beverages', 47, 1, 6.7, 1.5),
  ('Almond Milk (unsweetened)', 'beverages', 15, 0.6, 0.3, 1.2),
  ('Sports Drink', 'beverages', 24, 0, 6, 0),
  ('Sparkling Water', 'beverages', 0, 0, 0, 0)
) AS f(name, category_name, calories, protein, carbs, fat)
JOIN food_categories fc ON fc.name = f.category_name
ON CONFLICT DO NOTHING;

-- ============================================================================
-- PHASE 6: Goals Enhancements
-- ============================================================================

-- Add new columns to goals table
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'goals' AND column_name = 'is_daily_goal'
  ) THEN
    ALTER TABLE goals ADD COLUMN is_daily_goal BOOLEAN DEFAULT FALSE;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'goals' AND column_name = 'daily_achievements'
  ) THEN
    ALTER TABLE goals ADD COLUMN daily_achievements JSONB;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'goals' AND column_name = 'progress_percentage'
  ) THEN
    ALTER TABLE goals ADD COLUMN progress_percentage NUMERIC DEFAULT 0 CHECK (progress_percentage >= 0 AND progress_percentage <= 100);
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'goals' AND column_name = 'last_calculated_at'
  ) THEN
    ALTER TABLE goals ADD COLUMN last_calculated_at TIMESTAMPTZ;
  END IF;
END $$;

-- Function to calculate and update goal progress
CREATE OR REPLACE FUNCTION calculate_goal_progress(p_goal_id UUID)
RETURNS VOID AS $$
DECLARE
  goal_record RECORD;
  calculated_value NUMERIC := 0;
  progress_pct NUMERIC;
BEGIN
  SELECT * INTO goal_record FROM goals WHERE id = p_goal_id;
  
  IF NOT FOUND THEN
    RETURN;
  END IF;
  
  CASE goal_record.type
    WHEN 'weight' THEN
      SELECT COALESCE(weight, 0) INTO calculated_value
      FROM health_metrics
      WHERE user_id = goal_record.user_id
        AND weight IS NOT NULL
      ORDER BY date DESC
      LIMIT 1;
      
    WHEN 'calories', 'calorie_intake' THEN
      SELECT COALESCE(calories_consumed, 0) INTO calculated_value
      FROM health_metrics
      WHERE user_id = goal_record.user_id
        AND date = CURRENT_DATE;
      
    WHEN 'protein', 'carbs', 'fat' THEN
      SELECT COALESCE((macros->>goal_record.type)::NUMERIC, 0) INTO calculated_value
      FROM health_metrics
      WHERE user_id = goal_record.user_id
        AND date = CURRENT_DATE;
        
    WHEN 'workouts_per_week' THEN
      SELECT COALESCE(COUNT(*)::NUMERIC, 0) INTO calculated_value
      FROM workouts
      WHERE user_id = goal_record.user_id
        AND date >= date_trunc('week', CURRENT_DATE)::DATE
        AND date <= CURRENT_DATE;
        
    WHEN 'steps' THEN
      SELECT COALESCE(steps, 0) INTO calculated_value
      FROM health_metrics
      WHERE user_id = goal_record.user_id
        AND date = CURRENT_DATE;
        
    ELSE
      calculated_value := COALESCE(goal_record.current_value, 0);
  END CASE;
  
  IF goal_record.target_value > 0 THEN
    IF goal_record.type IN ('weight') THEN
      progress_pct := 0;
    ELSE
      progress_pct := LEAST(100, (calculated_value / goal_record.target_value) * 100);
    END IF;
  END IF;
  
  UPDATE goals
  SET 
    current_value = calculated_value,
    progress_percentage = progress_pct,
    last_calculated_at = NOW()
  WHERE id = p_goal_id;
  
  IF goal_record.is_daily_goal THEN
    UPDATE goals
    SET daily_achievements = COALESCE(daily_achievements, '{}'::jsonb) || 
      jsonb_build_object(CURRENT_DATE::TEXT, (calculated_value >= goal_record.target_value))
    WHERE id = p_goal_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- PHASE 7: Apple Watch Support
-- ============================================================================

-- Add CHECK constraint to restrict providers
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'connected_accounts_provider_check'
  ) THEN
    ALTER TABLE connected_accounts 
    ADD CONSTRAINT connected_accounts_provider_check 
    CHECK (provider IN ('fitbit', 'oura', 'apple'));
  END IF;
END $$;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================



-- ============================================================================
-- MIGRATION: Create feed_items table for social feed
-- Purpose: Store shared workouts, nutrition, and health metrics for feed display
-- ============================================================================

CREATE TABLE IF NOT EXISTS feed_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('workout', 'nutrition', 'health')),
  date DATE NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT,
  data JSONB NOT NULL,
  shared BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE feed_items ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can view their own feed items and eventually others' (for social)
DROP POLICY IF EXISTS "Users can view own feed items" ON feed_items;
DROP POLICY IF EXISTS "Users can view own feed items" ON feed_items;
CREATE POLICY "Users can view own feed items" ON feed_items
  FOR SELECT USING (auth.uid() = user_id);

-- For now, only users can see their own items. Later we can add:
-- CREATE POLICY "Users can view public feed items" ON feed_items
--   FOR SELECT USING (is_public = true OR auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own feed items" ON feed_items;
DROP POLICY IF EXISTS "Users can insert own feed items" ON feed_items;
CREATE POLICY "Users can insert own feed items" ON feed_items
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own feed items" ON feed_items;
DROP POLICY IF EXISTS "Users can update own feed items" ON feed_items;
CREATE POLICY "Users can update own feed items" ON feed_items
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own feed items" ON feed_items;
DROP POLICY IF EXISTS "Users can delete own feed items" ON feed_items;
CREATE POLICY "Users can delete own feed items" ON feed_items
  FOR DELETE USING (auth.uid() = user_id);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_feed_items_user_id ON feed_items(user_id);
CREATE INDEX IF NOT EXISTS idx_feed_items_date ON feed_items(date);
CREATE INDEX IF NOT EXISTS idx_feed_items_created_at ON feed_items(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feed_items_type ON feed_items(type);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_feed_items_updated_at ON feed_items;
DROP TRIGGER IF EXISTS update_feed_items_updated_at ON feed_items;
CREATE TRIGGER update_feed_items_updated_at
  BEFORE UPDATE ON feed_items
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();



-- ============================================================================
-- MIGRATION: Paused Workouts table
-- Purpose: Allow users to pause and resume workouts later
-- ============================================================================

CREATE TABLE IF NOT EXISTS paused_workouts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  exercises JSONB NOT NULL,
  workout_time INTEGER DEFAULT 0,
  rest_time INTEGER DEFAULT 0,
  is_resting BOOLEAN DEFAULT false,
  template_id TEXT,
  paused_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Enable RLS
ALTER TABLE paused_workouts ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only access their own paused workouts
DROP POLICY IF EXISTS "Users can view own paused workouts" ON paused_workouts;
DROP POLICY IF EXISTS "Users can insert own paused workouts" ON paused_workouts;
DROP POLICY IF EXISTS "Users can update own paused workouts" ON paused_workouts;
DROP POLICY IF EXISTS "Users can delete own paused workouts" ON paused_workouts;

CREATE POLICY "Users can view own paused workouts" ON paused_workouts
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own paused workouts" ON paused_workouts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own paused workouts" ON paused_workouts
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own paused workouts" ON paused_workouts
  FOR DELETE USING (auth.uid() = user_id);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_paused_workouts_user_id ON paused_workouts(user_id);
CREATE INDEX IF NOT EXISTS idx_paused_workouts_date ON paused_workouts(date);



-- ============================================================================
-- MIGRATION: Unique Constraints for User Data
-- Purpose: Ensure only one phone number, email, and username per account
-- ============================================================================

-- Create user_profiles table if it doesn't exist
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT,
  phone_number TEXT,
  display_name TEXT,
  bio TEXT,
  profile_picture TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Ensure columns exist even if `user_profiles` was created previously with a smaller schema.
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS phone_number TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS profile_picture TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Enable RLS
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view own user_profiles" ON user_profiles;
DROP POLICY IF EXISTS "Users can view public user_profiles" ON user_profiles;
DROP POLICY IF EXISTS "Users can insert own user_profiles" ON user_profiles;
DROP POLICY IF EXISTS "Users can update own user_profiles" ON user_profiles;
DROP POLICY IF EXISTS "Users can delete own user_profiles" ON user_profiles;

-- RLS Policies
DROP POLICY IF EXISTS "Users can view own user_profiles" ON user_profiles;
CREATE POLICY "Users can view own user_profiles" ON user_profiles
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view public user_profiles" ON user_profiles;
CREATE POLICY "Users can view public user_profiles" ON user_profiles
  FOR SELECT USING (true); -- Allow viewing for friend search

DROP POLICY IF EXISTS "Users can insert own user_profiles" ON user_profiles;
CREATE POLICY "Users can insert own user_profiles" ON user_profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own user_profiles" ON user_profiles;
CREATE POLICY "Users can update own user_profiles" ON user_profiles
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own user_profiles" ON user_profiles;
CREATE POLICY "Users can delete own user_profiles" ON user_profiles
  FOR DELETE USING (auth.uid() = user_id);

-- Create unique constraint on username (case-insensitive)
-- First, create a function to normalize usernames
CREATE OR REPLACE FUNCTION normalize_username(username TEXT)
RETURNS TEXT AS $$
BEGIN
  IF username IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN LOWER(TRIM(username));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Create unique index on normalized username
CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_username_unique 
ON user_profiles(normalize_username(username)) 
WHERE username IS NOT NULL AND username != '';

-- Create unique constraint on phone_number (normalized - digits only)
-- First, create a function to normalize phone numbers
CREATE OR REPLACE FUNCTION normalize_phone(phone TEXT)
RETURNS TEXT AS $$
BEGIN
  IF phone IS NULL THEN
    RETURN NULL;
  END IF;
  -- Remove all non-digit characters
  RETURN regexp_replace(phone, '[^0-9]', '', 'g');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Create unique index on normalized phone number
CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_phone_unique 
ON user_profiles(normalize_phone(phone_number)) 
WHERE phone_number IS NOT NULL AND phone_number != '';

-- Note: Email uniqueness is already enforced by auth.users table
-- But we can add a trigger to ensure email is unique across the system
-- Create a function to check email uniqueness
CREATE OR REPLACE FUNCTION check_email_uniqueness()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if email already exists in auth.users (this is handled by Supabase Auth)
  -- We just need to ensure no duplicate emails in user_profiles if we add email there
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_user_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_profiles_updated_at ON user_profiles;
DROP TRIGGER IF EXISTS user_profiles_updated_at ON user_profiles;
CREATE TRIGGER user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_user_profiles_updated_at();

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_username ON user_profiles(username) WHERE username IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_profiles_phone ON user_profiles(phone_number) WHERE phone_number IS NOT NULL;



-- ============================================================================
-- MIGRATION: Social Media Features - Performance, Security, and Schema Fixes
-- Purpose: Fix all issues identified in social media audit
-- Date: January 2025
-- ============================================================================

-- ============================================================================
-- 1. FRIENDS TABLE FIXES
-- ============================================================================

-- Create friends table if it doesn't exist
CREATE TABLE IF NOT EXISTS friends (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  friend_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'blocked')),
  requested_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add unique constraint to prevent duplicate friendships
-- This ensures (user_id, friend_id) is unique regardless of order
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'unique_friendship'
  ) THEN
    ALTER TABLE friends 
    ADD CONSTRAINT unique_friendship 
    UNIQUE (user_id, friend_id);
  END IF;
END $$;

-- Add composite indexes for performance
CREATE INDEX IF NOT EXISTS idx_friends_user_status 
  ON friends(user_id, status) 
  WHERE status IN ('accepted', 'pending');

CREATE INDEX IF NOT EXISTS idx_friends_friend_status 
  ON friends(friend_id, status) 
  WHERE status IN ('accepted', 'pending');

CREATE INDEX IF NOT EXISTS idx_friends_bidirectional 
  ON friends(user_id, friend_id, status);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_friends_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS friends_updated_at ON friends;
DROP TRIGGER IF EXISTS friends_updated_at ON friends;
CREATE TRIGGER friends_updated_at
  BEFORE UPDATE ON friends
  FOR EACH ROW
  EXECUTE FUNCTION update_friends_updated_at();

-- Enable RLS on friends table
ALTER TABLE friends ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view own friendships" ON friends;
DROP POLICY IF EXISTS "Users can view friendships where they are friend" ON friends;
DROP POLICY IF EXISTS "Users can insert own friendships" ON friends;
DROP POLICY IF EXISTS "Users can update own friendships" ON friends;
DROP POLICY IF EXISTS "Users can delete own friendships" ON friends;

-- RLS Policies for friends table
-- Users can view friendships where they are the user_id
DROP POLICY IF EXISTS "Users can view own friendships" ON friends;
CREATE POLICY "Users can view own friendships" ON friends
  FOR SELECT USING (auth.uid() = user_id);

-- Users can view friendships where they are the friend_id
DROP POLICY IF EXISTS "Users can view friendships where they are friend" ON friends;
CREATE POLICY "Users can view friendships where they are friend" ON friends
  FOR SELECT USING (auth.uid() = friend_id);

-- Users can insert friendships where they are the user_id
DROP POLICY IF EXISTS "Users can insert own friendships" ON friends;
CREATE POLICY "Users can insert own friendships" ON friends
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update friendships where they are involved
DROP POLICY IF EXISTS "Users can update own friendships" ON friends;
CREATE POLICY "Users can update own friendships" ON friends
  FOR UPDATE USING (auth.uid() = user_id OR auth.uid() = friend_id);

-- Users can delete friendships where they are involved
DROP POLICY IF EXISTS "Users can delete own friendships" ON friends;
CREATE POLICY "Users can delete own friendships" ON friends
  FOR DELETE USING (auth.uid() = user_id OR auth.uid() = friend_id);

-- ============================================================================
-- 2. FEED_ITEMS TABLE FIXES
-- ============================================================================

-- Add visibility column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'feed_items' AND column_name = 'visibility'
  ) THEN
    ALTER TABLE feed_items 
    ADD COLUMN visibility TEXT DEFAULT 'public' 
    CHECK (visibility IN ('public', 'friends', 'private'));
  END IF;
END $$;

-- Add unique constraint to prevent duplicate feed items
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'unique_feed_item'
  ) THEN
    ALTER TABLE feed_items 
    ADD CONSTRAINT unique_feed_item 
    UNIQUE (user_id, date, type);
  END IF;
END $$;

-- Add composite index for feed queries (user_id, shared, created_at)
CREATE INDEX IF NOT EXISTS idx_feed_items_user_shared_created 
  ON feed_items(user_id, shared, created_at DESC) 
  WHERE shared = true;

-- Add composite index for friends feed queries
CREATE INDEX IF NOT EXISTS idx_feed_items_visibility_created 
  ON feed_items(visibility, created_at DESC) 
  WHERE visibility IN ('public', 'friends') AND shared = true;

-- Drop existing feed_items policies if they exist
DROP POLICY IF EXISTS "Users can view own feed items" ON feed_items;
DROP POLICY IF EXISTS "Users can view friends feed items" ON feed_items;
DROP POLICY IF EXISTS "Users can view public feed items" ON feed_items;
DROP POLICY IF EXISTS "Users can insert own feed items" ON feed_items;
DROP POLICY IF EXISTS "Users can update own feed items" ON feed_items;
DROP POLICY IF EXISTS "Users can delete own feed items" ON feed_items;

-- Enhanced RLS Policies for feed_items
-- Users can always view their own feed items
DROP POLICY IF EXISTS "Users can view own feed items" ON feed_items;
CREATE POLICY "Users can view own feed items" ON feed_items
  FOR SELECT USING (auth.uid() = user_id);

-- Users can view friends' feed items if visibility is 'friends' or 'public'
DROP POLICY IF EXISTS "Users can view friends feed items" ON feed_items;
CREATE POLICY "Users can view friends feed items" ON feed_items
  FOR SELECT USING (
    visibility IN ('friends', 'public') AND
    EXISTS (
      SELECT 1 FROM friends 
      WHERE (
        (friends.user_id = auth.uid() AND friends.friend_id = feed_items.user_id AND friends.status = 'accepted')
        OR
        (friends.friend_id = auth.uid() AND friends.user_id = feed_items.user_id AND friends.status = 'accepted')
      )
    )
  );

-- Users can view public feed items
DROP POLICY IF EXISTS "Users can view public feed items" ON feed_items;
CREATE POLICY "Users can view public feed items" ON feed_items
  FOR SELECT USING (visibility = 'public' AND shared = true);

-- Users can insert their own feed items
DROP POLICY IF EXISTS "Users can insert own feed items" ON feed_items;
CREATE POLICY "Users can insert own feed items" ON feed_items
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update their own feed items
DROP POLICY IF EXISTS "Users can update own feed items" ON feed_items;
CREATE POLICY "Users can update own feed items" ON feed_items
  FOR UPDATE USING (auth.uid() = user_id);

-- Users can delete their own feed items
DROP POLICY IF EXISTS "Users can delete own feed items" ON feed_items;
CREATE POLICY "Users can delete own feed items" ON feed_items
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================================================
-- 3. USER_PROFILES TABLE FIXES
-- ============================================================================

-- Ensure trigram extension exists before creating gin_trgm_ops indexes.
-- If you don't have permission to create extensions, these indexes will be skipped (no hard failure).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    BEGIN
      EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_trgm';
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE NOTICE 'Skipping pg_trgm extension creation (insufficient privilege).';
      WHEN OTHERS THEN
        RAISE NOTICE 'Skipping pg_trgm extension creation (error: %).', SQLERRM;
    END;
  END IF;
END $$;

-- Add full-text search index for username and display_name
-- This enables fast searches using PostgreSQL full-text search
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS idx_user_profiles_username_trgm
      ON user_profiles USING gin(username gin_trgm_ops)
      WHERE username IS NOT NULL;
  ELSE
    RAISE NOTICE 'pg_trgm extension not enabled; skipping idx_user_profiles_username_trgm.';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS idx_user_profiles_display_name_trgm
      ON user_profiles USING gin(display_name gin_trgm_ops)
      WHERE display_name IS NOT NULL;
  ELSE
    RAISE NOTICE 'pg_trgm extension not enabled; skipping idx_user_profiles_display_name_trgm.';
  END IF;
END $$;

-- Note: Requires pg_trgm extension
-- Run this first if extension doesn't exist:
-- CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Add composite index for common search patterns
CREATE INDEX IF NOT EXISTS idx_user_profiles_search 
  ON user_profiles(username, display_name) 
  WHERE username IS NOT NULL OR display_name IS NOT NULL;

-- ============================================================================
-- 4. HELPER FUNCTIONS
-- ============================================================================

-- Function to check if two users are friends
CREATE OR REPLACE FUNCTION are_friends(user1_id UUID, user2_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM friends 
    WHERE (
      (user_id = user1_id AND friend_id = user2_id AND status = 'accepted')
      OR
      (user_id = user2_id AND friend_id = user1_id AND status = 'accepted')
    )
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to get friend IDs for a user (both directions)
CREATE OR REPLACE FUNCTION get_friend_ids(user_id_param UUID)
RETURNS TABLE(friend_id UUID) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    CASE 
      WHEN f.user_id = user_id_param THEN f.friend_id
      ELSE f.user_id
    END AS friend_id
  FROM friends f
  WHERE (
    (f.user_id = user_id_param OR f.friend_id = user_id_param)
    AND f.status = 'accepted'
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- 5. CLEANUP DUPLICATES (if any exist)
-- ============================================================================

-- Remove duplicate friendships (keep the oldest one)
DELETE FROM friends f1
WHERE EXISTS (
  SELECT 1 FROM friends f2
  WHERE (
    (f2.user_id = f1.user_id AND f2.friend_id = f1.friend_id)
    OR
    (f2.user_id = f1.friend_id AND f2.friend_id = f1.user_id)
  )
  AND f2.id < f1.id
);

-- Remove duplicate feed items (keep the most recent one)
DELETE FROM feed_items f1
WHERE EXISTS (
  SELECT 1 FROM feed_items f2
  WHERE f2.user_id = f1.user_id
    AND f2.date = f1.date
    AND f2.type = f1.type
    AND f2.created_at > f1.created_at
);

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
-- 
-- Summary of fixes:
-- 1. Added unique constraints to prevent duplicates
-- 2. Added composite indexes for performance
-- 3. Added RLS policies for friends table
-- 4. Enhanced RLS policies for feed_items (friends visibility)
-- 5. Added full-text search indexes for user_profiles
-- 6. Added helper functions for friend queries
-- 7. Cleaned up any existing duplicates
--
-- Next steps:
-- 1. Run this migration in Supabase SQL editor
-- 2. Update application code to use optimized queries
-- 3. Test friend and feed functionality
-- ============================================================================



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



-- ============================================================================
-- MIGRATION: Scheduled workouts (Calendar)
-- Purpose: Allow users to schedule a workout template on a specific date
-- ============================================================================

CREATE TABLE IF NOT EXISTS scheduled_workouts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  template_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, date)
);

-- IMPORTANT: CREATE TABLE IF NOT EXISTS does NOT add new constraints to an existing table.
-- If you created scheduled_workouts before we added UNIQUE(user_id, date), PostgREST upserts with
-- on_conflict=user_id,date will fail with 400. This block ensures the unique constraint exists.
DO $$
BEGIN
  IF to_regclass('public.scheduled_workouts') IS NOT NULL THEN
    -- Same issue for columns: older tables may be missing created_at/updated_at, which breaks our update trigger.
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'scheduled_workouts' AND column_name = 'created_at'
    ) THEN
      ALTER TABLE public.scheduled_workouts
        ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'scheduled_workouts' AND column_name = 'updated_at'
    ) THEN
      ALTER TABLE public.scheduled_workouts
        ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint c
      WHERE c.conrelid = 'public.scheduled_workouts'::regclass
        AND c.contype = 'u'
        AND c.conname = 'scheduled_workouts_user_id_date_key'
    ) THEN
      ALTER TABLE public.scheduled_workouts
        ADD CONSTRAINT scheduled_workouts_user_id_date_key UNIQUE (user_id, date);
    END IF;
  END IF;
END
$$;

ALTER TABLE scheduled_workouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own scheduled_workouts" ON scheduled_workouts;
CREATE POLICY "Users can view own scheduled_workouts" ON scheduled_workouts
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own scheduled_workouts" ON scheduled_workouts;
CREATE POLICY "Users can insert own scheduled_workouts" ON scheduled_workouts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own scheduled_workouts" ON scheduled_workouts;
CREATE POLICY "Users can update own scheduled_workouts" ON scheduled_workouts
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own scheduled_workouts" ON scheduled_workouts;
CREATE POLICY "Users can delete own scheduled_workouts" ON scheduled_workouts
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_scheduled_workouts_user_date ON scheduled_workouts(user_id, date);
CREATE INDEX IF NOT EXISTS idx_scheduled_workouts_date ON scheduled_workouts(date);

DROP TRIGGER IF EXISTS update_scheduled_workouts_updated_at ON scheduled_workouts;
CREATE TRIGGER update_scheduled_workouts_updated_at
  BEFORE UPDATE ON scheduled_workouts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();


-- ============================================================================
-- MIGRATION: Coach Marketplace (Programs + Purchases)
-- Purpose: Allow coaches to publish programs (workout/nutrition/health bundles)
--          and users to buy/apply them. Payments integration is handled at the
--          application layer; this schema supports purchases and access gating.
-- ============================================================================

-- Coach profile (public)
CREATE TABLE IF NOT EXISTS coach_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  bio TEXT,
  profile_picture TEXT,
  stripe_account_id TEXT,
  is_verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE coach_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view coach_profiles" ON coach_profiles;
CREATE POLICY "Anyone can view coach_profiles" ON coach_profiles
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can insert own coach_profile" ON coach_profiles;
CREATE POLICY "Users can insert own coach_profile" ON coach_profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own coach_profile" ON coach_profiles;
CREATE POLICY "Users can update own coach_profile" ON coach_profiles
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own coach_profile" ON coach_profiles;
CREATE POLICY "Users can delete own coach_profile" ON coach_profiles
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_coach_profiles_display_name ON coach_profiles(display_name);

DROP TRIGGER IF EXISTS update_coach_profiles_updated_at ON coach_profiles;
CREATE TRIGGER update_coach_profiles_updated_at
  BEFORE UPDATE ON coach_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();


-- Programs (published marketplace items)
CREATE TABLE IF NOT EXISTS coach_programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'usd',
  tags TEXT[] NOT NULL DEFAULT '{}',
  preview JSONB NOT NULL DEFAULT '{}'::jsonb,
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE coach_programs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view published coach_programs" ON coach_programs;
CREATE POLICY "Anyone can view published coach_programs" ON coach_programs
  FOR SELECT USING (status = 'published' OR auth.uid() = coach_id);

DROP POLICY IF EXISTS "Coaches can insert own coach_programs" ON coach_programs;
CREATE POLICY "Coaches can insert own coach_programs" ON coach_programs
  FOR INSERT WITH CHECK (auth.uid() = coach_id);

DROP POLICY IF EXISTS "Coaches can update own coach_programs" ON coach_programs;
CREATE POLICY "Coaches can update own coach_programs" ON coach_programs
  FOR UPDATE USING (auth.uid() = coach_id);

DROP POLICY IF EXISTS "Coaches can delete own coach_programs" ON coach_programs;
CREATE POLICY "Coaches can delete own coach_programs" ON coach_programs
  FOR DELETE USING (auth.uid() = coach_id);

CREATE INDEX IF NOT EXISTS idx_coach_programs_coach_id ON coach_programs(coach_id);
CREATE INDEX IF NOT EXISTS idx_coach_programs_status ON coach_programs(status);
CREATE INDEX IF NOT EXISTS idx_coach_programs_published_at ON coach_programs(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_coach_programs_title ON coach_programs USING gin (to_tsvector('english', title));

DROP TRIGGER IF EXISTS update_coach_programs_updated_at ON coach_programs;
CREATE TRIGGER update_coach_programs_updated_at
  BEFORE UPDATE ON coach_programs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();


-- Purchases (who owns access to which program)
CREATE TABLE IF NOT EXISTS coach_program_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID NOT NULL REFERENCES coach_programs(id) ON DELETE CASCADE,
  buyer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'refunded', 'canceled')),
  amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'usd',
  provider TEXT NOT NULL DEFAULT 'manual', -- stripe, apple, etc. (future)
  provider_payment_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(program_id, buyer_id)
);

ALTER TABLE coach_program_purchases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Buyers can view own program purchases" ON coach_program_purchases;
CREATE POLICY "Buyers can view own program purchases" ON coach_program_purchases
  FOR SELECT USING (
    auth.uid() = buyer_id
    OR EXISTS (
      SELECT 1 FROM coach_programs p
      WHERE p.id = coach_program_purchases.program_id
        AND p.coach_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Buyers can insert own program purchases" ON coach_program_purchases;
CREATE POLICY "Buyers can insert own program purchases" ON coach_program_purchases
  FOR INSERT WITH CHECK (auth.uid() = buyer_id);

DROP POLICY IF EXISTS "Buyers can update own pending program purchases" ON coach_program_purchases;
CREATE POLICY "Buyers can update own pending program purchases" ON coach_program_purchases
  FOR UPDATE USING (auth.uid() = buyer_id);

DROP POLICY IF EXISTS "Buyers can delete own pending program purchases" ON coach_program_purchases;
CREATE POLICY "Buyers can delete own pending program purchases" ON coach_program_purchases
  FOR DELETE USING (auth.uid() = buyer_id);

CREATE INDEX IF NOT EXISTS idx_coach_program_purchases_buyer_id ON coach_program_purchases(buyer_id);
CREATE INDEX IF NOT EXISTS idx_coach_program_purchases_program_id ON coach_program_purchases(program_id);
CREATE INDEX IF NOT EXISTS idx_coach_program_purchases_created_at ON coach_program_purchases(created_at DESC);


-- Enrollments (coach-visible enrollment metadata + high-level progress fields)
CREATE TABLE IF NOT EXISTS coach_program_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID NOT NULL REFERENCES coach_programs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'enrolled' CHECK (status IN ('enrolled', 'unenrolled')),
  scheduled_count INTEGER NOT NULL DEFAULT 0 CHECK (scheduled_count >= 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(program_id, user_id)
);

ALTER TABLE coach_program_enrollments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own program enrollments" ON coach_program_enrollments;
CREATE POLICY "Users can view own program enrollments" ON coach_program_enrollments
  FOR SELECT USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM coach_programs p
      WHERE p.id = coach_program_enrollments.program_id
        AND p.coach_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert own program enrollments" ON coach_program_enrollments;
CREATE POLICY "Users can insert own program enrollments" ON coach_program_enrollments
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND (
      -- Owner can enroll in their own program for testing
      EXISTS (
        SELECT 1 FROM coach_programs p
        WHERE p.id = coach_program_enrollments.program_id
          AND p.coach_id = auth.uid()
      )
      OR
      -- Paid buyer can enroll
      EXISTS (
        SELECT 1 FROM coach_program_purchases pur
        WHERE pur.program_id = coach_program_enrollments.program_id
          AND pur.buyer_id = auth.uid()
          AND pur.status = 'paid'
      )
    )
  );

DROP POLICY IF EXISTS "Users can update own program enrollments" ON coach_program_enrollments;
CREATE POLICY "Users can update own program enrollments" ON coach_program_enrollments
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own program enrollments" ON coach_program_enrollments;
CREATE POLICY "Users can delete own program enrollments" ON coach_program_enrollments
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_coach_program_enrollments_program_id ON coach_program_enrollments(program_id);
CREATE INDEX IF NOT EXISTS idx_coach_program_enrollments_user_id ON coach_program_enrollments(user_id);
CREATE INDEX IF NOT EXISTS idx_coach_program_enrollments_updated_at ON coach_program_enrollments(updated_at DESC);

DROP TRIGGER IF EXISTS update_coach_program_enrollments_updated_at ON coach_program_enrollments;
CREATE TRIGGER update_coach_program_enrollments_updated_at
  BEFORE UPDATE ON coach_program_enrollments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();


-- ============================================================================
-- STORAGE: AVATARS BUCKET (Profile photos)
-- ============================================================================
-- This app prefers using Supabase Storage bucket `avatars` for profile photos.
-- It falls back to base64 if the bucket/policies are not present.
--
-- Idempotent: safe to re-run.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'avatars'
  ) THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('avatars', 'avatars', TRUE);
  ELSE
    -- Ensure the bucket is public because the frontend uses getPublicUrl().
    UPDATE storage.buckets SET public = TRUE WHERE id = 'avatars';
  END IF;
END $$;

-- Ensure RLS is enabled on storage.objects (usually already enabled in Supabase)
ALTER TABLE IF EXISTS storage.objects ENABLE ROW LEVEL SECURITY;

-- Public read for avatars (anyone can fetch the image URL)
DROP POLICY IF EXISTS "Avatars are publicly readable" ON storage.objects;
CREATE POLICY "Avatars are publicly readable"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'avatars');

-- Authenticated users can upload avatars only into their own folder: {user_id}/...
DROP POLICY IF EXISTS "Users can upload own avatars" ON storage.objects;
CREATE POLICY "Users can upload own avatars"
  ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'avatars'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Allow overwrite/upsert for own avatar objects
DROP POLICY IF EXISTS "Users can update own avatars" ON storage.objects;
CREATE POLICY "Users can update own avatars"
  ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'avatars'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Allow deleting own avatar objects
DROP POLICY IF EXISTS "Users can delete own avatars" ON storage.objects;
CREATE POLICY "Users can delete own avatars"
  ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'avatars'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );



