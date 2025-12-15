-- ============================================================================
-- MIGRATION: Create feed_items table for social feed
-- Purpose: Store shared workouts, nutrition, and health metrics for feed display
-- ============================================================================

CREATE TABLE IF NOT EXISTS feed_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('workout', 'nutrition', 'health')),
  date DATE NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT,
  data JSONB NOT NULL,
  shared BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE feed_items ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can view their own feed items and eventually others' (for social)
DROP POLICY IF EXISTS "Users can view own feed items" ON feed_items;
CREATE POLICY "Users can view own feed items" ON feed_items
  FOR SELECT USING (auth.uid() = user_id);

-- For now, only users can see their own items. Later we can add:
-- CREATE POLICY "Users can view public feed items" ON feed_items
--   FOR SELECT USING (is_public = true OR auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own feed items" ON feed_items;
CREATE POLICY "Users can insert own feed items" ON feed_items
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own feed items" ON feed_items;
CREATE POLICY "Users can update own feed items" ON feed_items
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own feed items" ON feed_items;
CREATE POLICY "Users can delete own feed items" ON feed_items
  FOR DELETE USING (auth.uid() = user_id);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_feed_items_user_id ON feed_items(user_id);
CREATE INDEX IF NOT EXISTS idx_feed_items_date ON feed_items(date);
CREATE INDEX IF NOT EXISTS idx_feed_items_created_at ON feed_items(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feed_items_type ON feed_items(type);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_feed_items_updated_at ON feed_items;
CREATE TRIGGER update_feed_items_updated_at
  BEFORE UPDATE ON feed_items
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

