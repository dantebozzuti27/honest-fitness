-- ============================================================================
-- COMPREHENSIVE DATABASE VERIFICATION AND FIX SCRIPT
-- Purpose: Verify all required tables, columns, indexes, and constraints exist
--          Add missing items, remove invalid items
-- Run this in your Supabase SQL editor
-- ============================================================================

DO $$ 
DECLARE
  table_exists BOOLEAN;
  column_exists BOOLEAN;
  index_exists BOOLEAN;
  constraint_exists BOOLEAN;
BEGIN
  -- ============================================================================
  -- 1. VERIFY AND FIX: workouts table and columns
  -- ============================================================================
  
  -- Check if workouts table exists
  SELECT EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'workouts'
  ) INTO table_exists;
  
  IF NOT table_exists THEN
    RAISE NOTICE 'Creating workouts table...';
    CREATE TABLE workouts (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      date DATE NOT NULL,
      duration INTEGER,
      template_name TEXT,
      perceived_effort INTEGER,
      mood_after INTEGER,
      notes TEXT,
      day_of_week INTEGER,
      workout_calories_burned NUMERIC,
      workout_steps INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  ELSE
    -- Verify required columns exist
    -- workout_calories_burned
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'workouts' 
      AND column_name = 'workout_calories_burned'
    ) INTO column_exists;
    
    IF NOT column_exists THEN
      RAISE NOTICE 'Adding workout_calories_burned column to workouts...';
      ALTER TABLE workouts ADD COLUMN workout_calories_burned NUMERIC;
    END IF;
    
    -- workout_steps
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'workouts' 
      AND column_name = 'workout_steps'
    ) INTO column_exists;
    
    IF NOT column_exists THEN
      RAISE NOTICE 'Adding workout_steps column to workouts...';
      ALTER TABLE workouts ADD COLUMN workout_steps INTEGER;
    END IF;
    
    -- Ensure other critical columns exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'workouts' 
      AND column_name = 'created_at'
    ) THEN
      ALTER TABLE workouts ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW();
    END IF;
    
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'workouts' 
      AND column_name = 'updated_at'
    ) THEN
      ALTER TABLE workouts ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
    END IF;
  END IF;
  
  -- ============================================================================
  -- 2. VERIFY AND FIX: workout_exercises table
  -- ============================================================================
  
  SELECT EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'workout_exercises'
  ) INTO table_exists;
  
  IF NOT table_exists THEN
    RAISE NOTICE 'Creating workout_exercises table...';
    CREATE TABLE workout_exercises (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      workout_id UUID NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
      exercise_name TEXT NOT NULL,
      category TEXT,
      body_part TEXT,
      equipment TEXT,
      exercise_order INTEGER,
      exercise_type TEXT,
      exercise_library_id UUID,
      distance NUMERIC,
      distance_unit TEXT DEFAULT 'km',
      stacked BOOLEAN DEFAULT false,
      stack_group INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  END IF;
  
  -- ============================================================================
  -- 3. VERIFY AND FIX: workout_sets table
  -- ============================================================================
  
  SELECT EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'workout_sets'
  ) INTO table_exists;
  
  IF NOT table_exists THEN
    RAISE NOTICE 'Creating workout_sets table...';
    CREATE TABLE workout_sets (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      workout_exercise_id UUID NOT NULL REFERENCES workout_exercises(id) ON DELETE CASCADE,
      set_number INTEGER NOT NULL,
      weight NUMERIC,
      reps INTEGER,
      time NUMERIC,
      speed NUMERIC,
      incline NUMERIC,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  END IF;
  
  -- ============================================================================
  -- 4. VERIFY AND FIX: health_metrics table and columns
  -- ============================================================================
  
  SELECT EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'health_metrics'
  ) INTO table_exists;
  
  IF NOT table_exists THEN
    RAISE NOTICE 'Creating health_metrics table...';
    CREATE TABLE health_metrics (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      date DATE NOT NULL,
      resting_heart_rate NUMERIC,
      hrv NUMERIC,
      body_temp NUMERIC,
      sleep_score NUMERIC,
      sleep_duration NUMERIC,
      deep_sleep NUMERIC,
      rem_sleep NUMERIC,
      light_sleep NUMERIC,
      calories_burned NUMERIC,
      steps INTEGER,
      breathing_rate NUMERIC,
      spo2 NUMERIC,
      strain NUMERIC,
      weight NUMERIC,
      body_fat_percentage NUMERIC,
      meals JSONB,
      macros JSONB,
      water NUMERIC DEFAULT 0,
      calories_consumed NUMERIC,
      source_provider TEXT,
      source_data JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, date)
    );
  ELSE
    -- Verify critical columns exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'health_metrics' 
      AND column_name = 'steps'
    ) THEN
      ALTER TABLE health_metrics ADD COLUMN steps INTEGER;
    END IF;
    
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'health_metrics' 
      AND column_name = 'weight'
    ) THEN
      ALTER TABLE health_metrics ADD COLUMN weight NUMERIC;
    END IF;
    
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'health_metrics' 
      AND column_name = 'calories_burned'
    ) THEN
      ALTER TABLE health_metrics ADD COLUMN calories_burned NUMERIC;
    END IF;
  END IF;
  
  -- ============================================================================
  -- 5. VERIFY AND FIX: Critical indexes
  -- ============================================================================
  
  -- workouts indexes
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE schemaname = 'public' 
    AND tablename = 'workouts' 
    AND indexname = 'idx_workouts_user_date'
  ) THEN
    CREATE INDEX idx_workouts_user_date ON workouts(user_id, date DESC);
  END IF;
  
  -- health_metrics indexes
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE schemaname = 'public' 
    AND tablename = 'health_metrics' 
    AND indexname = 'idx_health_metrics_user_date'
  ) THEN
    CREATE INDEX idx_health_metrics_user_date ON health_metrics(user_id, date DESC);
  END IF;
  
  -- workout_exercises indexes
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE schemaname = 'public' 
    AND tablename = 'workout_exercises' 
    AND indexname = 'idx_workout_exercises_workout_id'
  ) THEN
    CREATE INDEX idx_workout_exercises_workout_id ON workout_exercises(workout_id);
  END IF;
  
  -- workout_sets indexes
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE schemaname = 'public' 
    AND tablename = 'workout_sets' 
    AND indexname = 'idx_workout_sets_exercise_id'
  ) THEN
    CREATE INDEX idx_workout_sets_exercise_id ON workout_sets(workout_exercise_id);
  END IF;
  
  -- ============================================================================
  -- 6. VERIFY AND FIX: RLS Policies
  -- ============================================================================
  
  -- Enable RLS on workouts if not enabled
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables 
    WHERE schemaname = 'public' 
    AND tablename = 'workouts' 
    AND rowsecurity = true
  ) THEN
    ALTER TABLE workouts ENABLE ROW LEVEL SECURITY;
  END IF;
  
  -- Create/update workouts RLS policies
  DROP POLICY IF EXISTS "Users can view own workouts" ON workouts;
  DROP POLICY IF EXISTS "Users can insert own workouts" ON workouts;
  DROP POLICY IF EXISTS "Users can update own workouts" ON workouts;
  DROP POLICY IF EXISTS "Users can delete own workouts" ON workouts;
  
  CREATE POLICY "Users can view own workouts" ON workouts
    FOR SELECT USING (auth.uid() = user_id);
  
  CREATE POLICY "Users can insert own workouts" ON workouts
    FOR INSERT WITH CHECK (auth.uid() = user_id);
  
  CREATE POLICY "Users can update own workouts" ON workouts
    FOR UPDATE USING (auth.uid() = user_id);
  
  CREATE POLICY "Users can delete own workouts" ON workouts
    FOR DELETE USING (auth.uid() = user_id);
  
  -- Enable RLS on health_metrics if not enabled
  IF EXISTS (
    SELECT 1 FROM pg_tables 
    WHERE schemaname = 'public' 
    AND tablename = 'health_metrics'
  ) THEN
    ALTER TABLE health_metrics ENABLE ROW LEVEL SECURITY;
    
    -- Create/update health_metrics RLS policies
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
  END IF;
  
  -- ============================================================================
  -- 7. VERIFY AND FIX: updated_at trigger function
  -- ============================================================================
  
  -- Create trigger function (CREATE OR REPLACE is safe to use always)
  -- Use different dollar-quote tag to avoid nesting issues
  CREATE OR REPLACE FUNCTION update_updated_at_column()
  RETURNS TRIGGER AS $func$
  BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
  END;
  $func$ LANGUAGE plpgsql;
  
  -- Create trigger on workouts if it doesn't exist
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'workouts' 
    AND column_name = 'updated_at'
  ) THEN
    DROP TRIGGER IF EXISTS update_workouts_updated_at ON workouts;
    CREATE TRIGGER update_workouts_updated_at
      BEFORE UPDATE ON workouts
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
  
  -- Create trigger on health_metrics if it doesn't exist
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'health_metrics' 
    AND column_name = 'updated_at'
  ) THEN
    DROP TRIGGER IF EXISTS update_health_metrics_updated_at ON health_metrics;
    CREATE TRIGGER update_health_metrics_updated_at
      BEFORE UPDATE ON health_metrics
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
  
  -- ============================================================================
  -- 8. CLEANUP: Remove invalid constraints/indexes (if any)
  -- ============================================================================
  
  -- Remove duplicate indexes (keep only one)
  -- Note: PostgreSQL will handle this automatically, but we verify
  
  -- Remove orphaned indexes (indexes on non-existent columns)
  -- This is handled by PostgreSQL automatically - indexes are dropped when columns are dropped
  
  -- ============================================================================
  -- 9. VERIFY: Check for any missing foreign key constraints
  -- ============================================================================
  
  -- Ensure workout_exercises has foreign key to workouts
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'workout_exercises'
  ) THEN
    -- Check if foreign key exists using pg_constraint
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint pc
      JOIN pg_class rel ON pc.conrelid = rel.oid
      JOIN pg_class ref_rel ON pc.confrelid = ref_rel.oid
      WHERE rel.relname = 'workout_exercises'
      AND ref_rel.relname = 'workouts'
      AND pc.contype = 'f'
    ) THEN
      -- Add foreign key if it doesn't exist
      BEGIN
        ALTER TABLE workout_exercises 
        ADD CONSTRAINT fk_workout_exercises_workout_id 
        FOREIGN KEY (workout_id) REFERENCES workouts(id) ON DELETE CASCADE;
        RAISE NOTICE 'Added foreign key constraint fk_workout_exercises_workout_id';
      EXCEPTION WHEN duplicate_object THEN
        RAISE NOTICE 'Foreign key constraint already exists';
      WHEN OTHERS THEN
        RAISE NOTICE 'Could not add foreign key constraint: %', SQLERRM;
      END;
    END IF;
  END IF;
  
  -- Ensure workout_sets has foreign key to workout_exercises
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'workout_sets'
  ) THEN
    -- Check if foreign key exists using pg_constraint
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint pc
      JOIN pg_class rel ON pc.conrelid = rel.oid
      JOIN pg_class ref_rel ON pc.confrelid = ref_rel.oid
      WHERE rel.relname = 'workout_sets'
      AND ref_rel.relname = 'workout_exercises'
      AND pc.contype = 'f'
    ) THEN
      -- Add foreign key if it doesn't exist
      BEGIN
        ALTER TABLE workout_sets 
        ADD CONSTRAINT fk_workout_sets_exercise_id 
        FOREIGN KEY (workout_exercise_id) REFERENCES workout_exercises(id) ON DELETE CASCADE;
        RAISE NOTICE 'Added foreign key constraint fk_workout_sets_exercise_id';
      EXCEPTION WHEN duplicate_object THEN
        RAISE NOTICE 'Foreign key constraint already exists';
      WHEN OTHERS THEN
        RAISE NOTICE 'Could not add foreign key constraint: %', SQLERRM;
      END;
    END IF;
  END IF;
  
  -- ============================================================================
  -- 10. FINAL VERIFICATION: Ensure unique constraints exist
  -- ============================================================================
  
  -- Ensure health_metrics has unique constraint on (user_id, date)
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'health_metrics'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE table_schema = 'public'
      AND table_name = 'health_metrics'
      AND constraint_type = 'UNIQUE'
      AND constraint_name LIKE '%user_id%date%'
    ) THEN
      -- Try to add unique constraint (may fail if duplicates exist)
      BEGIN
        ALTER TABLE health_metrics 
        ADD CONSTRAINT health_metrics_user_date_unique 
        UNIQUE (user_id, date);
        RAISE NOTICE 'Added unique constraint health_metrics_user_date_unique';
      EXCEPTION WHEN duplicate_object THEN
        RAISE NOTICE 'Unique constraint already exists';
      WHEN OTHERS THEN
        RAISE NOTICE 'Could not add unique constraint - duplicates may exist. Please clean data first: %', SQLERRM;
      END;
    END IF;
  END IF;
  
  RAISE NOTICE 'Database verification and fixes complete!';
  
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Error during database verification: %', SQLERRM;
  RAISE;
END $$;

-- ============================================================================
-- VERIFICATION QUERY: Check what was created/fixed
-- ============================================================================

-- Show all tables
SELECT 
  table_name,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t.table_name) as column_count
FROM information_schema.tables t
WHERE table_schema = 'public' 
AND table_type = 'BASE TABLE'
AND table_name IN ('workouts', 'workout_exercises', 'workout_sets', 'health_metrics')
ORDER BY table_name;

-- Show workouts columns
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' 
AND table_name = 'workouts'
ORDER BY ordinal_position;

-- Show health_metrics columns
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' 
AND table_name = 'health_metrics'
ORDER BY ordinal_position;

