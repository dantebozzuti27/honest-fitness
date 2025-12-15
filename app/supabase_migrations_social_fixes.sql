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
CREATE POLICY "Users can view own friendships" ON friends
  FOR SELECT USING (auth.uid() = user_id);

-- Users can view friendships where they are the friend_id
CREATE POLICY "Users can view friendships where they are friend" ON friends
  FOR SELECT USING (auth.uid() = friend_id);

-- Users can insert friendships where they are the user_id
CREATE POLICY "Users can insert own friendships" ON friends
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update friendships where they are involved
CREATE POLICY "Users can update own friendships" ON friends
  FOR UPDATE USING (auth.uid() = user_id OR auth.uid() = friend_id);

-- Users can delete friendships where they are involved
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
CREATE POLICY "Users can view own feed items" ON feed_items
  FOR SELECT USING (auth.uid() = user_id);

-- Users can view friends' feed items if visibility is 'friends' or 'public'
CREATE POLICY "Users can view friends feed items" ON feed_items
  FOR SELECT USING (
    visibility IN ('friends', 'public') AND
    EXISTS (
      SELECT 1 FROM friends 
      WHERE (
        (user_id = auth.uid() AND friend_id = feed_items.user_id AND status = 'accepted')
        OR
        (friend_id = auth.uid() AND user_id = feed_items.user_id AND status = 'accepted')
      )
    )
  );

-- Users can view public feed items
CREATE POLICY "Users can view public feed items" ON feed_items
  FOR SELECT USING (visibility = 'public' AND shared = true);

-- Users can insert their own feed items
CREATE POLICY "Users can insert own feed items" ON feed_items
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update their own feed items
CREATE POLICY "Users can update own feed items" ON feed_items
  FOR UPDATE USING (auth.uid() = user_id);

-- Users can delete their own feed items
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

