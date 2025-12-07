-- ============================================================================
-- MIGRATION: Nutrition Database
-- Purpose: Create food categories, food library, user food preferences
-- ============================================================================

-- Step 1: Create Food Categories Table
CREATE TABLE IF NOT EXISTS food_categories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE, -- 'meat', 'dairy', 'grains', 'fruits', 'vegetables', etc.
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert common categories
INSERT INTO food_categories (name) VALUES
('meat'), ('dairy'), ('grains'), ('fruits'), ('vegetables'), 
('nuts'), ('oils'), ('legumes'), ('seafood'), ('beverages'),
('snacks'), ('desserts'), ('condiments'), ('other')
ON CONFLICT (name) DO NOTHING;

-- Step 2: Create Food Library Table
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

-- Step 3: Create User Food Preferences Table
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
DROP POLICY IF EXISTS "Users can manage own food preferences" ON user_food_preferences;

CREATE POLICY "Users can manage own food preferences" ON user_food_preferences
  FOR ALL USING (auth.uid() = user_id);

-- Step 4: Populate Common Foods
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

