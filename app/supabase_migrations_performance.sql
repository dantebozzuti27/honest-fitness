-- Performance and data integrity improvements
-- Add missing indexes and unique constraints

-- 1. Add unique constraint to feed_items to prevent duplicates
-- First, clean up existing duplicates by keeping only the most recent one
DO $$ 
BEGIN
  -- Only proceed if feed_items table exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'feed_items') THEN
    -- Delete duplicate feed_items, keeping only the most recent one (by created_at)
    DELETE FROM feed_items
    WHERE id IN (
      SELECT id
      FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY user_id, date, type 
                 ORDER BY created_at DESC, id DESC
               ) as rn
        FROM feed_items
      ) t
      WHERE t.rn > 1
    );
    
    -- Now add the unique constraint
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint 
      WHERE conname = 'feed_items_user_date_type_unique'
    ) THEN
      ALTER TABLE feed_items 
      ADD CONSTRAINT feed_items_user_date_type_unique 
      UNIQUE (user_id, date, type);
    END IF;
  END IF;
END $$;

-- 2. Add unique constraint to friends table to prevent duplicate relationships
-- First, clean up existing duplicates by keeping only the most recent one
DO $$ 
BEGIN
  -- Only proceed if friends table exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'friends') THEN
    -- Check if created_at column exists
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'friends' AND column_name = 'created_at'
    ) THEN
      -- Delete duplicate friendships, keeping only the most recent one (by created_at)
      DELETE FROM friends
      WHERE id IN (
        SELECT id
        FROM (
          SELECT id,
                 ROW_NUMBER() OVER (
                   PARTITION BY user_id, friend_id 
                   ORDER BY created_at DESC, id DESC
                 ) as rn
          FROM friends
        ) t
        WHERE t.rn > 1
      );
    ELSE
      -- If no created_at column, use id for ordering (keep highest id)
      DELETE FROM friends
      WHERE id IN (
        SELECT id
        FROM (
          SELECT id,
                 ROW_NUMBER() OVER (
                   PARTITION BY user_id, friend_id 
                   ORDER BY id DESC
                 ) as rn
          FROM friends
        ) t
        WHERE t.rn > 1
      );
    END IF;
    
    -- Now add the unique constraint
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint 
      WHERE conname = 'friends_user_friend_unique'
    ) THEN
      ALTER TABLE friends 
      ADD CONSTRAINT friends_user_friend_unique 
      UNIQUE (user_id, friend_id);
    END IF;
  END IF;
END $$;

-- 3. Add composite indexes for frequently queried columns
-- All index creations are conditional - they only create if the table exists

DO $$ 
BEGIN
  -- Feed items queries (user_id + created_at for feed loading)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'feed_items') THEN
    CREATE INDEX IF NOT EXISTS idx_feed_items_user_created 
    ON feed_items(user_id, created_at DESC);
    
    -- Feed items queries (shared + created_at for social feed)
    CREATE INDEX IF NOT EXISTS idx_feed_items_shared_created 
    ON feed_items(shared, created_at DESC) 
    WHERE shared = true;
  END IF;
  
  -- Friends queries (user_id + status for friend list)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'friends') THEN
    CREATE INDEX IF NOT EXISTS idx_friends_user_status 
    ON friends(user_id, status);
    
    -- Friends queries (friend_id + status for reverse lookups)
    CREATE INDEX IF NOT EXISTS idx_friends_friend_status 
    ON friends(friend_id, status);
  END IF;
  
  -- Workouts queries (user_id + date for workout history)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'workouts') THEN
    CREATE INDEX IF NOT EXISTS idx_workouts_user_date 
    ON workouts(user_id, date DESC);
    
    -- Workouts queries (user_id + created_at for feed)
    CREATE INDEX IF NOT EXISTS idx_workouts_user_created 
    ON workouts(user_id, created_at DESC);
  END IF;
  
  -- Workout exercises (workout_id for loading workout details)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'workout_exercises') THEN
    CREATE INDEX IF NOT EXISTS idx_workout_exercises_workout 
    ON workout_exercises(workout_id);
  END IF;
  
  -- Workout sets (workout_exercise_id for loading sets)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'workout_sets') THEN
    CREATE INDEX IF NOT EXISTS idx_workout_sets_exercise 
    ON workout_sets(workout_exercise_id);
  END IF;
  
  -- User profiles (username for lookups)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_profiles') THEN
    CREATE INDEX IF NOT EXISTS idx_user_profiles_username 
    ON user_profiles(username);
  END IF;
  
  -- Nutrition data is stored in health_metrics table, so no separate nutrition table index needed
  -- (Nutrition queries use health_metrics table which already has idx_health_metrics_user_date)
  
  -- Health metrics (user_id + date for health history)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'health_metrics') THEN
    CREATE INDEX IF NOT EXISTS idx_health_metrics_user_date 
    ON health_metrics(user_id, date DESC);
  END IF;
  
  -- Paused workouts (user_id for loading paused workouts)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'paused_workouts') THEN
    CREATE INDEX IF NOT EXISTS idx_paused_workouts_user 
    ON paused_workouts(user_id);
  END IF;
END $$;

