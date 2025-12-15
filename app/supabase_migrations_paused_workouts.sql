-- Paused Workouts table migration
-- Allows users to pause and resume workouts later

CREATE TABLE IF NOT EXISTS paused_workouts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  exercises JSONB NOT NULL,
  workout_time INTEGER DEFAULT 0,
  rest_time INTEGER DEFAULT 0,
  is_resting BOOLEAN DEFAULT false,
  template_id TEXT,
  paused_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Enable RLS
ALTER TABLE paused_workouts ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only access their own paused workouts
DROP POLICY IF EXISTS "Users can view own paused workouts" ON paused_workouts;
DROP POLICY IF EXISTS "Users can insert own paused workouts" ON paused_workouts;
DROP POLICY IF EXISTS "Users can update own paused workouts" ON paused_workouts;
DROP POLICY IF EXISTS "Users can delete own paused workouts" ON paused_workouts;

CREATE POLICY "Users can view own paused workouts" ON paused_workouts
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own paused workouts" ON paused_workouts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own paused workouts" ON paused_workouts
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own paused workouts" ON paused_workouts
  FOR DELETE USING (auth.uid() = user_id);

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_paused_workouts_user_id ON paused_workouts(user_id);
CREATE INDEX IF NOT EXISTS idx_paused_workouts_date ON paused_workouts(date);

