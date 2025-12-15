-- ============================================================================
-- SEED: Expanded Food Library (system foods)
-- Purpose: Provide a much larger default searchable food catalog in food_library.
-- Safe to re-run (idempotent via ON CONFLICT DO NOTHING).
--
-- NOTE:
-- - Values are approximate per 100g for common foods.
-- - Add/adjust as needed; users can still create custom foods.
-- ============================================================================

-- Ensure common categories exist
INSERT INTO food_categories (name) VALUES
('meat'), ('dairy'), ('grains'), ('fruits'), ('vegetables'),
('nuts'), ('oils'), ('legumes'), ('seafood'), ('beverages'),
('snacks'), ('desserts'), ('condiments'), ('other')
ON CONFLICT (name) DO NOTHING;

-- Optional: speed up name search if pg_trgm is available
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS idx_food_library_name_trgm
      ON food_library USING gin(name gin_trgm_ops)
      WHERE is_custom = false;
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping idx_food_library_name_trgm (insufficient privilege).';
  WHEN OTHERS THEN
    RAISE NOTICE 'Skipping idx_food_library_name_trgm (error: %).', SQLERRM;
END $$;

-- Insert expanded system foods
INSERT INTO food_library (
  name, category_id,
  calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g,
  fiber_per_100g, sugar_per_100g, sodium_per_100g,
  is_custom
)
SELECT
  f.name,
  fc.id,
  f.calories,
  f.protein,
  f.carbs,
  f.fat,
  f.fiber,
  f.sugar,
  f.sodium_mg,
  FALSE
FROM (VALUES
  -- MEAT / POULTRY (per 100g)
  ('Chicken Thigh (cooked)', 'meat', 209, 26.0, 0.0, 10.9, 0.0, 0.0, 90),
  ('Chicken Breast (cooked)', 'meat', 165, 31.0, 0.0, 3.6, 0.0, 0.0, 74),
  ('Ground Turkey 93% (cooked)', 'meat', 176, 25.0, 0.0, 8.0, 0.0, 0.0, 85),
  ('Turkey Breast (deli)', 'meat', 104, 17.0, 2.0, 2.0, 0.0, 1.0, 1000),
  ('Ground Beef 90% (cooked)', 'meat', 217, 26.0, 0.0, 12.0, 0.0, 0.0, 72),
  ('Sirloin Steak (cooked)', 'meat', 206, 27.0, 0.0, 10.0, 0.0, 0.0, 60),
  ('Pork Loin (cooked)', 'meat', 242, 27.0, 0.0, 14.0, 0.0, 0.0, 62),
  ('Bacon', 'meat', 541, 37.0, 1.4, 42.0, 0.0, 0.0, 1800),

  -- SEAFOOD (per 100g)
  ('Salmon (cooked)', 'seafood', 208, 20.0, 0.0, 13.0, 0.0, 0.0, 59),
  ('Tuna (canned in water)', 'seafood', 116, 26.0, 0.0, 1.0, 0.0, 0.0, 300),
  ('Shrimp (cooked)', 'seafood', 99, 24.0, 0.2, 0.3, 0.0, 0.0, 111),
  ('Cod (cooked)', 'seafood', 105, 23.0, 0.0, 0.9, 0.0, 0.0, 78),

  -- DAIRY (per 100g)
  ('Whole Milk', 'dairy', 61, 3.2, 4.8, 3.3, 0.0, 5.0, 43),
  ('Skim Milk', 'dairy', 34, 3.4, 5.0, 0.1, 0.0, 5.0, 44),
  ('Cheddar Cheese', 'dairy', 403, 25.0, 1.3, 33.0, 0.0, 0.5, 620),
  ('Cottage Cheese (2%)', 'dairy', 82, 11.1, 3.4, 2.3, 0.0, 2.7, 364),
  ('Greek Yogurt (plain, nonfat)', 'dairy', 59, 10.0, 3.6, 0.4, 0.0, 3.6, 36),
  ('Egg (whole, raw)', 'dairy', 143, 13.0, 1.1, 10.0, 0.0, 1.1, 142),

  -- GRAINS / STARCHES (per 100g)
  ('White Rice (cooked)', 'grains', 130, 2.4, 28.0, 0.3, 0.4, 0.1, 1),
  ('Brown Rice (cooked)', 'grains', 111, 2.6, 23.0, 0.9, 1.8, 0.4, 5),
  ('Oats (dry)', 'grains', 389, 17.0, 66.0, 7.0, 11.0, 1.0, 2),
  ('Pasta (cooked)', 'grains', 131, 5.0, 25.0, 1.1, 1.3, 0.6, 1),
  ('Bread (whole wheat)', 'grains', 247, 13.0, 41.0, 4.2, 7.0, 6.0, 400),
  ('Tortilla (flour)', 'grains', 313, 8.0, 52.0, 8.0, 2.0, 4.0, 800),
  ('Potato (baked)', 'vegetables', 93, 2.5, 21.0, 0.1, 2.2, 1.2, 7),
  ('Sweet Potato (baked)', 'vegetables', 90, 2.0, 21.0, 0.2, 3.3, 6.5, 36),

  -- FRUITS (per 100g)
  ('Banana', 'fruits', 89, 1.1, 23.0, 0.3, 2.6, 12.0, 1),
  ('Apple', 'fruits', 52, 0.3, 14.0, 0.2, 2.4, 10.0, 1),
  ('Orange', 'fruits', 47, 0.9, 12.0, 0.1, 2.4, 9.0, 0),
  ('Blueberries', 'fruits', 57, 0.7, 14.0, 0.3, 2.4, 10.0, 1),
  ('Strawberries', 'fruits', 32, 0.7, 7.7, 0.3, 2.0, 4.9, 1),
  ('Grapes', 'fruits', 69, 0.7, 18.0, 0.2, 0.9, 15.0, 2),

  -- VEGETABLES (per 100g)
  ('Broccoli', 'vegetables', 34, 2.8, 7.0, 0.4, 2.6, 1.7, 33),
  ('Spinach', 'vegetables', 23, 2.9, 3.6, 0.4, 2.2, 0.4, 79),
  ('Carrots', 'vegetables', 41, 0.9, 10.0, 0.2, 2.8, 4.7, 69),
  ('Bell Pepper (red)', 'vegetables', 31, 1.0, 6.0, 0.3, 2.1, 4.2, 4),
  ('Onion', 'vegetables', 40, 1.1, 9.3, 0.1, 1.7, 4.2, 4),
  ('Tomato', 'vegetables', 18, 0.9, 3.9, 0.2, 1.2, 2.6, 5),
  ('Avocado', 'fruits', 160, 2.0, 8.5, 14.7, 6.7, 0.7, 7),

  -- LEGUMES (per 100g cooked)
  ('Black Beans (cooked)', 'legumes', 132, 8.9, 24.0, 0.5, 8.7, 0.3, 1),
  ('Chickpeas (cooked)', 'legumes', 164, 8.9, 27.0, 2.6, 7.6, 4.8, 7),
  ('Lentils (cooked)', 'legumes', 116, 9.0, 20.0, 0.4, 7.9, 1.8, 2),

  -- NUTS / NUT BUTTERS (per 100g)
  ('Almonds', 'nuts', 579, 21.0, 22.0, 50.0, 12.5, 4.4, 1),
  ('Peanut Butter', 'nuts', 588, 25.0, 20.0, 50.0, 6.0, 9.0, 400),
  ('Walnuts', 'nuts', 654, 15.0, 14.0, 65.0, 6.7, 2.6, 2),

  -- OILS / CONDIMENTS (per 100g)
  ('Olive Oil', 'oils', 884, 0.0, 0.0, 100.0, 0.0, 0.0, 0),
  ('Butter', 'dairy', 717, 0.9, 0.1, 81.0, 0.0, 0.1, 11),
  ('Ketchup', 'condiments', 112, 1.3, 26.0, 0.2, 0.3, 22.0, 900),
  ('Mayonnaise', 'condiments', 680, 1.0, 1.0, 75.0, 0.0, 1.0, 635),

  -- BEVERAGES (per 100g/ml)
  ('Coffee (black)', 'beverages', 1, 0.1, 0.0, 0.0, 0.0, 0.0, 2),
  ('Orange Juice', 'beverages', 45, 0.7, 10.0, 0.2, 0.2, 8.4, 1),
  ('Soda (cola)', 'beverages', 41, 0.0, 10.6, 0.0, 0.0, 10.6, 5),

  -- SNACKS / DESSERTS (per 100g)
  ('Granola', 'snacks', 471, 10.0, 64.0, 20.0, 6.0, 24.0, 50),
  ('Potato Chips', 'snacks', 536, 7.0, 53.0, 35.0, 4.0, 0.5, 525),
  ('Dark Chocolate (70%)', 'desserts', 598, 7.8, 46.0, 43.0, 11.0, 24.0, 20),
  ('Ice Cream (vanilla)', 'desserts', 207, 3.5, 24.0, 11.0, 0.0, 21.0, 80)
) AS f(name, category_name, calories, protein, carbs, fat, fiber, sugar, sodium_mg)
JOIN food_categories fc ON fc.name = f.category_name
ON CONFLICT DO NOTHING;


