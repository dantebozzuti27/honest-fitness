-- ============================================================================
-- MIGRATION: Social Media Features
-- Purpose: Add friends, user profiles, and feed privacy for social features
-- ============================================================================

-- ============================================================================
-- 1. User Profiles Table (username, display_name, bio, etc.)
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  username TEXT UNIQUE,
  display_name TEXT,
  bio TEXT,
  profile_picture TEXT, -- URL or base64
  location TEXT,
  website TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- RLS Policies for user_profiles
CREATE POLICY "Users can view all profiles" ON user_profiles
  FOR SELECT USING (true); -- Public profiles

CREATE POLICY "Users can update own profile" ON user_profiles
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own profile" ON user_profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_username ON user_profiles(username) WHERE username IS NOT NULL;

-- ============================================================================
-- 2. Friends Table (friend relationships)
-- ============================================================================
CREATE TABLE IF NOT EXISTS friends (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  friend_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'blocked')),
  requested_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, -- Who sent the request
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, friend_id)
);

-- Enable RLS
ALTER TABLE friends ENABLE ROW LEVEL SECURITY;

-- RLS Policies for friends
CREATE POLICY "Users can view own friend relationships" ON friends
  FOR SELECT USING (auth.uid() = user_id OR auth.uid() = friend_id);

CREATE POLICY "Users can insert friend requests" ON friends
  FOR INSERT WITH CHECK (auth.uid() = requested_by);

CREATE POLICY "Users can update own friend relationships" ON friends
  FOR UPDATE USING (auth.uid() = user_id OR auth.uid() = friend_id);

CREATE POLICY "Users can delete own friend relationships" ON friends
  FOR DELETE USING (auth.uid() = user_id OR auth.uid() = friend_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_friends_user_id ON friends(user_id);
CREATE INDEX IF NOT EXISTS idx_friends_friend_id ON friends(friend_id);
CREATE INDEX IF NOT EXISTS idx_friends_status ON friends(status);
CREATE INDEX IF NOT EXISTS idx_friends_user_status ON friends(user_id, status);

-- ============================================================================
-- 3. Update feed_items table to support privacy
-- ============================================================================
-- Add visibility column to feed_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'feed_items' AND column_name = 'visibility'
  ) THEN
    ALTER TABLE feed_items ADD COLUMN visibility TEXT DEFAULT 'public' CHECK (visibility IN ('public', 'friends', 'private'));
  END IF;
END $$;

-- Update RLS policies for feed_items to support friends
DROP POLICY IF EXISTS "Users can view own feed items" ON feed_items;
DROP POLICY IF EXISTS "Users can view public feed items" ON feed_items;

-- New RLS policies for feed_items
CREATE POLICY "Users can view own feed items" ON feed_items
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can view public feed items" ON feed_items
  FOR SELECT USING (visibility = 'public' AND shared = true);

CREATE POLICY "Users can view friends feed items" ON feed_items
  FOR SELECT USING (
    visibility = 'friends' 
    AND shared = true 
    AND (
      auth.uid() = user_id OR
      EXISTS (
        SELECT 1 FROM friends
        WHERE (
          (friends.user_id = auth.uid() AND friends.friend_id = feed_items.user_id) OR
          (friends.friend_id = auth.uid() AND friends.user_id = feed_items.user_id)
        )
        AND friends.status = 'accepted'
      )
    )
  );

-- Index for visibility
CREATE INDEX IF NOT EXISTS idx_feed_items_visibility ON feed_items(visibility) WHERE shared = true;

-- ============================================================================
-- 4. Add updated_at trigger for user_profiles
-- ============================================================================
CREATE TRIGGER update_user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 5. Add updated_at trigger for friends
-- ============================================================================
CREATE TRIGGER update_friends_updated_at
  BEFORE UPDATE ON friends
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

