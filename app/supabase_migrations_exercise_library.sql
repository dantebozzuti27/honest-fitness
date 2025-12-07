-- ============================================================================
-- MIGRATION: Exercise Library and Enhancements
-- Purpose: Create exercise library, add sub body parts, custom exercises, workout types
-- ============================================================================

-- Step 1: Create Exercise Library Table
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

-- Step 2: Enhance workout_exercises Table
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

-- Step 3: Populate Exercise Library with Common Exercises
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

