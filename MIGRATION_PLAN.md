# Database Migration Plan - HonestFitness Upgrade
## Zero Data Loss Strategy

This plan outlines step-by-step migrations to implement the database upgrades while preserving all existing data.

---

## PHASE 1: Unified Health Metrics Table
**Goal:** Create a standardized `health_metrics` table that consolidates data from all wearable sources

### Step 1.1: Create New Unified Health Metrics Table
```sql
-- Create unified health_metrics table with all standardized columns
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

-- Enable RLS
ALTER TABLE health_metrics ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own health_metrics" ON health_metrics
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own health_metrics" ON health_metrics
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own health_metrics" ON health_metrics
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own health_metrics" ON health_metrics
  FOR DELETE USING (auth.uid() = user_id);
```

### Step 1.2: Migrate Existing Oura Data
```sql
-- Migrate oura_daily data to health_metrics
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
```

### Step 1.3: Migrate Existing Fitbit Data
```sql
-- Migrate fitbit_daily data to health_metrics
INSERT INTO health_metrics (
  user_id, date,
  resting_heart_rate, hrv, body_temp,
  sleep_duration, deep_sleep, rem_sleep, light_sleep,
  calories_burned, steps,
  source_provider, source_data,
  created_at, updated_at
)
SELECT 
  user_id, date,
  resting_heart_rate, hrv, body_temp,
  sleep_duration, NULL, NULL, NULL, -- Fitbit doesn't break down sleep stages the same way
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
```

### Step 1.4: Migrate Existing daily_metrics Data
```sql
-- Migrate daily_metrics data to health_metrics
INSERT INTO health_metrics (
  user_id, date,
  hrv, sleep_score, sleep_duration, steps, calories_burned,
  weight, resting_heart_rate, body_temp,
  source_provider, source_data,
  created_at, updated_at
)
SELECT 
  user_id, date,
  hrv, sleep_score, sleep_time, steps, calories,
  weight, resting_heart_rate, body_temp,
  COALESCE(source_provider, 'manual'),
  jsonb_build_object(
    'meals', meals,
    'macros', macros,
    'water', water,
    'calories_consumed', calories_consumed
  ),
  created_at, updated_at
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
  source_data = health_metrics.source_data || EXCLUDED.source_data,
  updated_at = NOW();
```

### Step 1.5: Mark Old Tables as Deprecated (Keep for Backward Compatibility)
```sql
-- Add comment to old tables indicating they're deprecated
COMMENT ON TABLE oura_daily IS 'DEPRECATED: Use health_metrics table instead. Kept for backward compatibility.';
COMMENT ON TABLE fitbit_daily IS 'DEPRECATED: Use health_metrics table instead. Kept for backward compatibility.';
COMMENT ON TABLE daily_metrics IS 'DEPRECATED: Use health_metrics table instead. Kept for backward compatibility.';
```

---

## PHASE 2: User Profile Enhancements
**Goal:** Add date of birth, gender, height to user_preferences with proper structure

### Step 2.1: Add New Columns to user_preferences
```sql
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
```

### Step 2.2: Create Function to Calculate Age from Date of Birth
```sql
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
```

---

## PHASE 3: Forward-Fill Function for Manual Metrics
**Goal:** Implement forward-fill logic for weight, body fat, etc.

### Step 3.1: Create Forward-Fill Function
```sql
-- Function to forward-fill manual metrics (weight, body_fat_percentage)
CREATE OR REPLACE FUNCTION forward_fill_manual_metrics(
  p_user_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS VOID AS $$
DECLARE
  current_date DATE;
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
  current_date := p_start_date;
  WHILE current_date <= p_end_date LOOP
    -- Check if we have a value for this date
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
      AND date = current_date
      AND (weight IS NULL OR body_fat_percentage IS NULL);
    
    -- Update last known values if this date has new data
    SELECT weight, body_fat_percentage INTO last_weight, last_body_fat
    FROM health_metrics
    WHERE user_id = p_user_id AND date = current_date;
    
    current_date := current_date + INTERVAL '1 day';
  END LOOP;
END;
$$ LANGUAGE plpgsql;
```

### Step 3.2: Create Trigger to Auto Forward-Fill on Insert/Update
```sql
-- Trigger function to forward-fill when manual metrics are updated
CREATE OR REPLACE FUNCTION trigger_forward_fill_metrics()
RETURNS TRIGGER AS $$
BEGIN
  -- If weight or body_fat_percentage was updated, forward-fill future dates
  IF (TG_OP = 'UPDATE' AND (
    (OLD.weight IS DISTINCT FROM NEW.weight AND NEW.weight IS NOT NULL) OR
    (OLD.body_fat_percentage IS DISTINCT FROM NEW.body_fat_percentage AND NEW.body_fat_percentage IS NOT NULL)
  )) OR (TG_OP = 'INSERT' AND (NEW.weight IS NOT NULL OR NEW.body_fat_percentage IS NOT NULL)) THEN
    -- Forward-fill up to 30 days ahead (can be adjusted)
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
```

---

## PHASE 4: Exercise Database Enhancements
**Goal:** Add exercise library, sub body parts, custom exercises, workout type differentiation

### Step 4.1: Create Exercise Library Table
```sql
-- Exercise library/reference table
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
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Unique constraint: same name can exist as custom for different users, but not as system exercise
  UNIQUE(name, created_by_user_id) WHERE is_custom = TRUE,
  UNIQUE(name) WHERE is_custom = FALSE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_exercise_library_category ON exercise_library(category);
CREATE INDEX IF NOT EXISTS idx_exercise_library_body_part ON exercise_library(body_part);
CREATE INDEX IF NOT EXISTS idx_exercise_library_custom ON exercise_library(created_by_user_id) WHERE is_custom = TRUE;

-- Enable RLS
ALTER TABLE exercise_library ENABLE ROW LEVEL SECURITY;

-- RLS Policies
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
```

### Step 4.2: Enhance workout_exercises Table
```sql
-- Add exercise_type and distance columns to workout_exercises
DO $$ 
BEGIN
  -- Exercise type: 'weightlifting' or 'cardio'
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'workout_exercises' AND column_name = 'exercise_type'
  ) THEN
    ALTER TABLE workout_exercises ADD COLUMN exercise_type TEXT CHECK (exercise_type IN ('weightlifting', 'cardio'));
  END IF;
  
  -- Distance for cardio exercises
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'workout_exercises' AND column_name = 'distance'
  ) THEN
    ALTER TABLE workout_exercises ADD COLUMN distance NUMERIC; -- in km or miles (standardize to km)
  END IF;
  
  -- Distance unit
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'workout_exercises' AND column_name = 'distance_unit'
  ) THEN
    ALTER TABLE workout_exercises ADD COLUMN distance_unit TEXT DEFAULT 'km' CHECK (distance_unit IN ('km', 'miles'));
  END IF;
  
  -- Link to exercise_library
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'workout_exercises' AND column_name = 'exercise_library_id'
  ) THEN
    ALTER TABLE workout_exercises ADD COLUMN exercise_library_id UUID REFERENCES exercise_library(id) ON DELETE SET NULL;
  END IF;
END $$;
```

### Step 4.3: Populate Exercise Library with Common Exercises
```sql
-- Insert common exercises (run this after table creation)
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
```

---

## PHASE 5: Nutrition Database
**Goal:** Create food database with categories, common foods, custom foods, favorites

### Step 5.1: Create Food Categories Table
```sql
-- Food categories
CREATE TABLE IF NOT EXISTS food_categories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE, -- 'meat', 'dairy', 'grains', 'fruits', 'vegetables', 'nuts', 'oils', etc.
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert common categories
INSERT INTO food_categories (name) VALUES
('meat'), ('dairy'), ('grains'), ('fruits'), ('vegetables'), 
('nuts'), ('oils'), ('legumes'), ('seafood'), ('beverages'),
('snacks'), ('desserts'), ('condiments'), ('other')
ON CONFLICT (name) DO NOTHING;
```

### Step 5.2: Create Food Library Table
```sql
-- Food library/reference table
CREATE TABLE IF NOT EXISTS food_library (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  category_id UUID REFERENCES food_categories(id),
  -- Nutrition per 100g (standardized)
  calories_per_100g NUMERIC NOT NULL,
  protein_per_100g NUMERIC DEFAULT 0,
  carbs_per_100g NUMERIC DEFAULT 0,
  fat_per_100g NUMERIC DEFAULT 0,
  fiber_per_100g NUMERIC DEFAULT 0,
  sugar_per_100g NUMERIC DEFAULT 0,
  sodium_per_100g NUMERIC DEFAULT 0, -- in mg
  is_custom BOOLEAN DEFAULT FALSE,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Unique constraint
  UNIQUE(name, created_by_user_id) WHERE is_custom = TRUE,
  UNIQUE(name) WHERE is_custom = FALSE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_food_library_category ON food_library(category_id);
CREATE INDEX IF NOT EXISTS idx_food_library_custom ON food_library(created_by_user_id) WHERE is_custom = TRUE;
CREATE INDEX IF NOT EXISTS idx_food_library_name ON food_library(name);

-- Enable RLS
ALTER TABLE food_library ENABLE ROW LEVEL SECURITY;

-- RLS Policies
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
```

### Step 5.3: Create User Food Preferences Table
```sql
-- User food favorites and recent foods
CREATE TABLE IF NOT EXISTS user_food_preferences (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  food_id UUID NOT NULL REFERENCES food_library(id) ON DELETE CASCADE,
  is_favorite BOOLEAN DEFAULT FALSE,
  last_used_at TIMESTAMPTZ DEFAULT NOW(), -- For "recent foods" functionality
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
CREATE POLICY "Users can manage own food preferences" ON user_food_preferences
  FOR ALL USING (auth.uid() = user_id);
```

### Step 5.4: Enhance health_metrics for Nutrition
```sql
-- Add nutrition tracking columns to health_metrics (if not already present)
DO $$ 
BEGIN
  -- Meals (JSONB - already exists, but ensure it's there)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'health_metrics' AND column_name = 'meals'
  ) THEN
    ALTER TABLE health_metrics ADD COLUMN meals JSONB;
  END IF;
  
  -- Macros (JSONB - already exists, but ensure it's there)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'health_metrics' AND column_name = 'macros'
  ) THEN
    ALTER TABLE health_metrics ADD COLUMN macros JSONB;
  END IF;
  
  -- Water intake
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'health_metrics' AND column_name = 'water'
  ) THEN
    ALTER TABLE health_metrics ADD COLUMN water NUMERIC DEFAULT 0; -- in liters or oz (standardize)
  END IF;
  
  -- Calories consumed (separate from burned)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'health_metrics' AND column_name = 'calories_consumed'
  ) THEN
    ALTER TABLE health_metrics ADD COLUMN calories_consumed NUMERIC;
  END IF;
END $$;
```

### Step 5.5: Populate Common Foods
```sql
-- Insert common foods (run after food_categories and food_library are created)
-- This is a sample - you'll want to expand this significantly
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
```

---

## PHASE 6: Goals Enhancements
**Goal:** Add daily goal tracking, progress tracking, and match structure to health/fitness/nutrition

### Step 6.1: Enhance Goals Table
```sql
-- Add new columns to goals table
DO $$ 
BEGIN
  -- Daily goal achievement (yes/no for daily goals like calorie intake)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'goals' AND column_name = 'is_daily_goal'
  ) THEN
    ALTER TABLE goals ADD COLUMN is_daily_goal BOOLEAN DEFAULT FALSE;
  END IF;
  
  -- Track daily achievement (for daily goals)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'goals' AND column_name = 'daily_achievements'
  ) THEN
    ALTER TABLE goals ADD COLUMN daily_achievements JSONB; 
    -- Structure: {"2024-01-15": true, "2024-01-16": false, ...}
  END IF;
  
  -- Progress percentage (for progress-based goals like weight)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'goals' AND column_name = 'progress_percentage'
  ) THEN
    ALTER TABLE goals ADD COLUMN progress_percentage NUMERIC DEFAULT 0 CHECK (progress_percentage >= 0 AND progress_percentage <= 100);
  END IF;
  
  -- Last calculated date (for tracking when progress was last updated)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'goals' AND column_name = 'last_calculated_at'
  ) THEN
    ALTER TABLE goals ADD COLUMN last_calculated_at TIMESTAMPTZ;
  END IF;
END $$;
```

### Step 6.2: Create Function to Calculate Goal Progress
```sql
-- Function to calculate and update goal progress
CREATE OR REPLACE FUNCTION calculate_goal_progress(p_goal_id UUID)
RETURNS VOID AS $$
DECLARE
  goal_record RECORD;
  current_value NUMERIC;
  progress_pct NUMERIC;
BEGIN
  -- Get goal details
  SELECT * INTO goal_record FROM goals WHERE id = p_goal_id;
  
  IF NOT FOUND THEN
    RETURN;
  END IF;
  
  -- Calculate current value based on goal type
  CASE goal_record.type
    WHEN 'weight' THEN
      -- Get most recent weight from health_metrics
      SELECT weight INTO current_value
      FROM health_metrics
      WHERE user_id = goal_record.user_id
        AND weight IS NOT NULL
      ORDER BY date DESC
      LIMIT 1;
      
    WHEN 'calories', 'calorie_intake' THEN
      -- Get today's calories consumed
      SELECT calories_consumed INTO current_value
      FROM health_metrics
      WHERE user_id = goal_record.user_id
        AND date = CURRENT_DATE;
      
    WHEN 'protein', 'carbs', 'fat' THEN
      -- Get today's macros
      SELECT (macros->>goal_record.type)::NUMERIC INTO current_value
      FROM health_metrics
      WHERE user_id = goal_record.user_id
        AND date = CURRENT_DATE;
        
    WHEN 'workouts_per_week' THEN
      -- Count workouts this week
      SELECT COUNT(*)::NUMERIC INTO current_value
      FROM workouts
      WHERE user_id = goal_record.user_id
        AND date >= date_trunc('week', CURRENT_DATE)
        AND date <= CURRENT_DATE;
        
    WHEN 'steps' THEN
      -- Get today's steps
      SELECT steps INTO current_value
      FROM health_metrics
      WHERE user_id = goal_record.user_id
        AND date = CURRENT_DATE;
        
    ELSE
      -- For custom goals, use current_value as is
      current_value := goal_record.current_value;
  END CASE;
  
  -- Calculate progress percentage
  IF goal_record.target_value > 0 THEN
    IF goal_record.type IN ('weight') THEN
      -- For weight loss goals, progress is (start - current) / (start - target)
      -- This is more complex and depends on start_date weight
      progress_pct := 0; -- Placeholder - implement based on your logic
    ELSE
      -- For gain goals, progress is current / target
      progress_pct := LEAST(100, (current_value / goal_record.target_value) * 100);
    END IF;
  END IF;
  
  -- Update goal
  UPDATE goals
  SET 
    current_value = COALESCE(current_value, goal_record.current_value),
    progress_percentage = progress_pct,
    last_calculated_at = NOW()
  WHERE id = p_goal_id;
  
  -- For daily goals, update daily_achievements
  IF goal_record.is_daily_goal THEN
    UPDATE goals
    SET daily_achievements = COALESCE(daily_achievements, '{}'::jsonb) || 
      jsonb_build_object(CURRENT_DATE::TEXT, (current_value >= goal_record.target_value))
    WHERE id = p_goal_id;
  END IF;
END;
$$ LANGUAGE plpgsql;
```

---

## PHASE 7: Apple Watch Support
**Goal:** Add Apple Watch to connected_accounts and ensure data normalization

### Step 7.1: Update connected_accounts Provider Constraint
```sql
-- The provider column already supports 'apple' based on the comment in the table
-- Just ensure it's documented. No migration needed if it already accepts 'apple'
-- If you want to restrict to only these three, you could add a CHECK constraint:

-- Optional: Add CHECK constraint to restrict providers (if not already restricted)
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
```

### Step 7.2: Create Apple Watch Data Normalization
```sql
-- Note: Apple Watch data will be inserted into health_metrics with source_provider = 'apple_watch'
-- The normalization logic should be handled in your application code to map Apple Health data
-- to the standardized health_metrics columns

-- Example mapping (to be implemented in application code):
-- Apple Health metrics -> health_metrics columns:
-- - restingHeartRate -> resting_heart_rate
-- - heartRateVariability -> hrv
-- - bodyTemperature -> body_temp
-- - sleepAnalysis -> sleep_duration, deep_sleep, rem_sleep, light_sleep
-- - activeEnergyBurned -> calories_burned
-- - stepCount -> steps
-- - respiratoryRate -> breathing_rate
-- - oxygenSaturation -> spo2
-- - workoutActivityType -> strain (calculated)
```

---

## PHASE 8: Data Migration & Validation
**Goal:** Ensure all existing data is properly migrated and validated

### Step 8.1: Create Migration Validation Queries
```sql
-- Validation queries to run after migrations

-- 1. Check that all oura_daily data was migrated
SELECT 
  (SELECT COUNT(*) FROM oura_daily) as oura_count,
  (SELECT COUNT(*) FROM health_metrics WHERE source_provider = 'oura') as migrated_oura_count;

-- 2. Check that all fitbit_daily data was migrated
SELECT 
  (SELECT COUNT(*) FROM fitbit_daily) as fitbit_count,
  (SELECT COUNT(*) FROM health_metrics WHERE source_provider = 'fitbit' OR source_data ? 'distance') as migrated_fitbit_count;

-- 3. Check for any missing user_id or date in health_metrics
SELECT COUNT(*) as missing_data_count
FROM health_metrics
WHERE user_id IS NULL OR date IS NULL;

-- 4. Check exercise library population
SELECT COUNT(*) as exercise_count FROM exercise_library WHERE is_custom = FALSE;

-- 5. Check food library population
SELECT COUNT(*) as food_count FROM food_library WHERE is_custom = FALSE;
```

### Step 8.2: Create Backup Recommendations
```sql
-- Before running migrations, recommend creating backups:
-- 1. Export oura_daily: SELECT * FROM oura_daily;
-- 2. Export fitbit_daily: SELECT * FROM fitbit_daily;
-- 3. Export daily_metrics: SELECT * FROM daily_metrics;
-- 4. Export workouts: SELECT * FROM workouts;
-- 5. Export workout_exercises: SELECT * FROM workout_exercises;
-- 6. Export workout_sets: SELECT * FROM workout_sets;
```

---

## PHASE 9: Application Code Updates Required
**Goal:** Document what code changes are needed

### 9.1: Update Wearable Sync Functions
- Update `saveOuraDaily()` to also write to `health_metrics`
- Update `saveFitbitDaily()` to also write to `health_metrics`
- Create `saveAppleWatchDaily()` function
- Update `mergeWearableDataToMetrics()` to use `health_metrics` instead of `daily_metrics`

### 9.2: Update Exercise Functions
- Update workout saving to link to `exercise_library`
- Add logic to create custom exercises in `exercise_library`
- Update exercise selection UI to use `exercise_library`
- Add sub body parts display

### 9.3: Update Nutrition Functions
- Create food selection from `food_library`
- Add custom food creation
- Update favorites/recent foods logic
- Update meal logging to use food_library

### 9.4: Update Goals Functions
- Add daily goal calculation
- Add progress tracking
- Update goal display to show achievement status

---

## EXECUTION ORDER

1. **Phase 1** - Create unified health_metrics table and migrate data
2. **Phase 2** - Add user profile enhancements
3. **Phase 3** - Implement forward-fill function
4. **Phase 4** - Exercise database enhancements
5. **Phase 5** - Nutrition database
6. **Phase 6** - Goals enhancements
7. **Phase 7** - Apple Watch support (mostly application code)
8. **Phase 8** - Validation and testing
9. **Phase 9** - Application code updates (parallel with testing)

---

## ROLLBACK PLAN

If issues occur:
1. Old tables (`oura_daily`, `fitbit_daily`, `daily_metrics`) are preserved
2. New tables can be dropped if needed
3. Application code can be reverted to use old tables
4. Data in `health_metrics` can be re-exported back to old tables if necessary

---

## NOTES

- All migrations use `IF NOT EXISTS` checks for safety
- Old tables are kept for backward compatibility
- Data is migrated, not moved (original data remains)
- RLS policies are applied to all new tables
- Indexes are created for performance
- Functions use proper error handling

