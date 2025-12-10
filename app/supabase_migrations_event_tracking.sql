-- Event Tracking Infrastructure
-- Creates table and indexes for comprehensive event tracking

-- Create user_events table
CREATE TABLE IF NOT EXISTS user_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  
  -- Event details
  event_name TEXT NOT NULL,
  event_category TEXT,
  event_action TEXT,
  event_label TEXT,
  
  -- Contextual metadata
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  timezone TEXT,
  device_type TEXT, -- 'mobile', 'tablet', 'desktop'
  device_info JSONB,
  app_version TEXT,
  network_type TEXT,
  battery_level INTEGER,
  
  -- Event properties
  properties JSONB,
  value NUMERIC,
  
  -- User context
  page_url TEXT,
  referrer TEXT,
  user_agent TEXT,
  
  -- Error tracking
  error_message TEXT,
  error_stack TEXT,
  error_type TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_user_events_user_id ON user_events(user_id);
CREATE INDEX IF NOT EXISTS idx_user_events_session_id ON user_events(session_id);
CREATE INDEX IF NOT EXISTS idx_user_events_event_name ON user_events(event_name);
CREATE INDEX IF NOT EXISTS idx_user_events_category ON user_events(event_category);
CREATE INDEX IF NOT EXISTS idx_user_events_timestamp ON user_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_user_events_user_timestamp ON user_events(user_id, timestamp DESC);

-- Composite index for common analytics queries
CREATE INDEX IF NOT EXISTS idx_user_events_category_action ON user_events(event_category, event_action);

-- Partial index for error events
CREATE INDEX IF NOT EXISTS idx_user_events_errors ON user_events(user_id, timestamp DESC) 
WHERE error_message IS NOT NULL;

-- Enable RLS
ALTER TABLE user_events ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can insert own events" ON user_events;
DROP POLICY IF EXISTS "Users can view own events" ON user_events;

CREATE POLICY "Users can insert own events" ON user_events
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own events" ON user_events
  FOR SELECT USING (auth.uid() = user_id);

-- Create function to get event counts by category
CREATE OR REPLACE FUNCTION get_event_counts_by_category(
  p_user_id UUID,
  p_start_date TIMESTAMPTZ DEFAULT NOW() - INTERVAL '30 days',
  p_end_date TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE (
  category TEXT,
  event_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    event_category,
    COUNT(*) as event_count
  FROM user_events
  WHERE user_id = p_user_id
    AND timestamp BETWEEN p_start_date AND p_end_date
  GROUP BY event_category
  ORDER BY event_count DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to get conversion funnel
CREATE OR REPLACE FUNCTION get_conversion_funnel(
  p_user_id UUID,
  p_start_date TIMESTAMPTZ DEFAULT NOW() - INTERVAL '30 days',
  p_end_date TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE (
  step TEXT,
  event_count BIGINT,
  conversion_rate NUMERIC
) AS $$
DECLARE
  total_users BIGINT;
BEGIN
  -- Get total users who started
  SELECT COUNT(DISTINCT user_id) INTO total_users
  FROM user_events
  WHERE user_id = p_user_id
    AND timestamp BETWEEN p_start_date AND p_end_date
    AND event_name = 'page_view';
  
  RETURN QUERY
  WITH funnel_steps AS (
    SELECT 
      CASE 
        WHEN event_name = 'page_view' THEN 'Page View'
        WHEN event_name = 'button_click' AND event_label LIKE '%signup%' THEN 'Signup Click'
        WHEN event_name = 'conversion' AND event_label = 'signup_complete' THEN 'Signup Complete'
        WHEN event_name = 'workout_event' AND event_action = 'start' THEN 'Workout Started'
        WHEN event_name = 'workout_event' AND event_action = 'complete' THEN 'Workout Completed'
        ELSE NULL
      END as step,
      COUNT(*) as event_count
    FROM user_events
    WHERE user_id = p_user_id
      AND timestamp BETWEEN p_start_date AND p_end_date
    GROUP BY step
    HAVING step IS NOT NULL
  )
  SELECT 
    step,
    event_count,
    CASE 
      WHEN total_users > 0 THEN (event_count::NUMERIC / total_users::NUMERIC * 100)
      ELSE 0
    END as conversion_rate
  FROM funnel_steps
  ORDER BY event_count DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

