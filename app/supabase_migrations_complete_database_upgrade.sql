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
    PERFORM forward_fill_manual_metrics(
      NEW.user_id,
      NEW.date + INTERVAL '1 day',
      NEW.date + INTERVAL '30 days'
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
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

CREATE POLICY "Anyone can view system exercises" ON exercise_library
  FOR SELECT USING (is_custom = FALSE);

CREATE POLICY "Users can view own custom exercises" ON exercise_library
  FOR SELECT USING (is_custom = TRUE AND auth.uid() = created_by_user_id);

CREATE POLICY "Users can insert own custom exercises" ON exercise_library
  FOR INSERT WITH CHECK (is_custom = TRUE AND auth.uid() = created_by_user_id);

CREATE POLICY "Users can update own custom exercises" ON exercise_library
  FOR UPDATE USING (is_custom = TRUE AND auth.uid() = created_by_user_id);

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
  category_id UUID REFERENCES food_categories(id),
  calories_per_100g NUMERIC NOT NULL,
  protein_per_100g NUMERIC DEFAULT 0,
  carbs_per_100g NUMERIC DEFAULT 0,
  fat_per_100g NUMERIC DEFAULT 0,
  fiber_per_100g NUMERIC DEFAULT 0,
  sugar_per_100g NUMERIC DEFAULT 0,
  sodium_per_100g NUMERIC DEFAULT 0,
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

CREATE POLICY "Anyone can view system foods" ON food_library
  FOR SELECT USING (is_custom = FALSE);

CREATE POLICY "Users can view own custom foods" ON food_library
  FOR SELECT USING (is_custom = TRUE AND auth.uid() = created_by_user_id);

CREATE POLICY "Users can insert own custom foods" ON food_library
  FOR INSERT WITH CHECK (is_custom = TRUE AND auth.uid() = created_by_user_id);

CREATE POLICY "Users can update own custom foods" ON food_library
  FOR UPDATE USING (is_custom = TRUE AND auth.uid() = created_by_user_id);

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
  current_value NUMERIC;
  progress_pct NUMERIC;
BEGIN
  SELECT * INTO goal_record FROM goals WHERE id = p_goal_id;
  
  IF NOT FOUND THEN
    RETURN;
  END IF;
  
  CASE goal_record.type
    WHEN 'weight' THEN
      SELECT weight INTO current_value
      FROM health_metrics
      WHERE user_id = goal_record.user_id
        AND weight IS NOT NULL
      ORDER BY date DESC
      LIMIT 1;
      
    WHEN 'calories', 'calorie_intake' THEN
      SELECT calories_consumed INTO current_value
      FROM health_metrics
      WHERE user_id = goal_record.user_id
        AND date = CURRENT_DATE;
      
    WHEN 'protein', 'carbs', 'fat' THEN
      SELECT (macros->>goal_record.type)::NUMERIC INTO current_value
      FROM health_metrics
      WHERE user_id = goal_record.user_id
        AND date = CURRENT_DATE;
        
    WHEN 'workouts_per_week' THEN
      SELECT COUNT(*)::NUMERIC INTO current_value
      FROM workouts
      WHERE user_id = goal_record.user_id
        AND date >= date_trunc('week', CURRENT_DATE)
        AND date <= CURRENT_DATE;
        
    WHEN 'steps' THEN
      SELECT steps INTO current_value
      FROM health_metrics
      WHERE user_id = goal_record.user_id
        AND date = CURRENT_DATE;
        
    ELSE
      current_value := goal_record.current_value;
  END CASE;
  
  IF goal_record.target_value > 0 THEN
    IF goal_record.type IN ('weight') THEN
      progress_pct := 0;
    ELSE
      progress_pct := LEAST(100, (current_value / goal_record.target_value) * 100);
    END IF;
  END IF;
  
  UPDATE goals
  SET 
    current_value = COALESCE(current_value, goal_record.current_value),
    progress_percentage = progress_pct,
    last_calculated_at = NOW()
  WHERE id = p_goal_id;
  
  IF goal_record.is_daily_goal THEN
    UPDATE goals
    SET daily_achievements = COALESCE(daily_achievements, '{}'::jsonb) || 
      jsonb_build_object(CURRENT_DATE::TEXT, (current_value >= goal_record.target_value))
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

