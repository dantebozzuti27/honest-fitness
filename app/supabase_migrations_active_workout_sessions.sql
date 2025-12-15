-- Active Workout Sessions Table
-- Stores active workout timer state in the database instead of localStorage

CREATE TABLE IF NOT EXISTS active_workout_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workout_start_time TIMESTAMPTZ NOT NULL,
  paused_time_ms BIGINT DEFAULT 0,
  rest_start_time TIMESTAMPTZ,
  rest_duration_seconds INTEGER,
  is_resting BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Enable RLS
ALTER TABLE active_workout_sessions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can view own active workout sessions" ON active_workout_sessions;
DROP POLICY IF EXISTS "Users can insert own active workout sessions" ON active_workout_sessions;
DROP POLICY IF EXISTS "Users can update own active workout sessions" ON active_workout_sessions;
DROP POLICY IF EXISTS "Users can delete own active workout sessions" ON active_workout_sessions;

CREATE POLICY "Users can view own active workout sessions" ON active_workout_sessions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own active workout sessions" ON active_workout_sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own active workout sessions" ON active_workout_sessions
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own active workout sessions" ON active_workout_sessions
  FOR DELETE USING (auth.uid() = user_id);

-- Create index
CREATE INDEX IF NOT EXISTS idx_active_workout_sessions_user_id ON active_workout_sessions(user_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_active_workout_sessions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_active_workout_sessions_updated_at ON active_workout_sessions;
CREATE TRIGGER update_active_workout_sessions_updated_at
  BEFORE UPDATE ON active_workout_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_active_workout_sessions_updated_at();

