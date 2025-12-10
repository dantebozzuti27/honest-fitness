-- A/B Testing Infrastructure
-- Tables for experiments, assignments, and event tracking

-- A/B tests table
CREATE TABLE IF NOT EXISTS ab_tests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  test_name TEXT NOT NULL UNIQUE,
  description TEXT,
  variants TEXT[] DEFAULT ARRAY['A', 'B'],
  status TEXT DEFAULT 'active', -- 'active', 'paused', 'completed'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- A/B test assignments
CREATE TABLE IF NOT EXISTS ab_test_assignments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  test_name TEXT NOT NULL,
  variant TEXT NOT NULL, -- 'A', 'B', etc.
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, test_name)
);

-- A/B test events
CREATE TABLE IF NOT EXISTS ab_test_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  test_name TEXT NOT NULL,
  variant TEXT NOT NULL,
  event_name TEXT NOT NULL,
  value NUMERIC,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ab_test_assignments_user ON ab_test_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_ab_test_assignments_test ON ab_test_assignments(test_name);
CREATE INDEX IF NOT EXISTS idx_ab_test_events_user ON ab_test_events(user_id);
CREATE INDEX IF NOT EXISTS idx_ab_test_events_test ON ab_test_events(test_name, variant);
CREATE INDEX IF NOT EXISTS idx_ab_test_events_timestamp ON ab_test_events(timestamp DESC);

-- Enable RLS
ALTER TABLE ab_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE ab_test_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ab_test_events ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Tests: only admins can view (adjust based on your needs)
CREATE POLICY "Users can view active tests" ON ab_tests
  FOR SELECT USING (status = 'active');

-- Assignments: users can view their own
CREATE POLICY "Users can view own assignments" ON ab_test_assignments
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own assignments" ON ab_test_assignments
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Events: users can insert their own
CREATE POLICY "Users can insert own events" ON ab_test_events
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own events" ON ab_test_events
  FOR SELECT USING (auth.uid() = user_id);

-- Function to get test statistics
CREATE OR REPLACE FUNCTION get_ab_test_statistics(
  p_test_name TEXT,
  p_event_name TEXT DEFAULT 'conversion'
)
RETURNS TABLE (
  variant TEXT,
  event_count BIGINT,
  unique_users BIGINT,
  conversion_rate NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    e.variant,
    COUNT(*) as event_count,
    COUNT(DISTINCT e.user_id) as unique_users,
    CASE 
      WHEN COUNT(DISTINCT a.user_id) > 0 
      THEN (COUNT(DISTINCT e.user_id)::NUMERIC / COUNT(DISTINCT a.user_id)::NUMERIC) * 100
      ELSE 0
    END as conversion_rate
  FROM ab_test_events e
  JOIN ab_test_assignments a ON e.user_id = a.user_id AND e.test_name = a.test_name
  WHERE e.test_name = p_test_name
    AND e.event_name = p_event_name
  GROUP BY e.variant;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

