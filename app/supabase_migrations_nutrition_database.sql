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
  brand TEXT,
  barcode TEXT,
  category_id UUID REFERENCES food_categories(id),
  -- Nutrition per 100g (standardized)
  calories_per_100g NUMERIC NOT NULL,
  protein_per_100g NUMERIC DEFAULT 0,
  carbs_per_100g NUMERIC DEFAULT 0,
  fat_per_100g NUMERIC DEFAULT 0,
  fiber_per_100g NUMERIC DEFAULT 0,
  sugar_per_100g NUMERIC DEFAULT 0,
  sodium_per_100g NUMERIC DEFAULT 0, -- in mg
  -- Micronutrients per 100g (optional; flexible schema)
  -- Convention: keys like "potassium_mg", "calcium_mg", "iron_mg", "vitamin_c_mg", etc.
  micros_per_100g JSONB DEFAULT '{}'::jsonb,
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

-- Ensure newer columns exist even if `food_library` was created previously.
ALTER TABLE food_library ADD COLUMN IF NOT EXISTS brand TEXT;
ALTER TABLE food_library ADD COLUMN IF NOT EXISTS barcode TEXT;
ALTER TABLE food_library ADD COLUMN IF NOT EXISTS micros_per_100g JSONB DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_food_library_barcode ON food_library(barcode) WHERE barcode IS NOT NULL;

-- Full-text search (built-in Postgres; no extensions required)
-- This keeps search fast even as `food_library` grows to hundreds/thousands of rows.
ALTER TABLE food_library
  ADD COLUMN IF NOT EXISTS name_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce(name, ''))) STORED;
CREATE INDEX IF NOT EXISTS idx_food_library_name_tsv ON food_library USING GIN (name_tsv);

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

-- Step 5: Expanded System Foods (to provide way more search options out-of-the-box)
-- Notes:
-- - Values are generic per-100g approximations intended for quick logging/search.
-- - Users can still create custom foods for exact labels.
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

