-- ============================================================================
-- DATA-FIRST COMPANY: COMPLETE MIGRATION
-- Issues 1-50 Implementation
-- Run this entire script in Supabase SQL Editor
-- ============================================================================

-- ============================================================================
-- SECTION 1: EVENT TRACKING INFRASTRUCTURE (Issue 1)
-- ============================================================================

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
CREATE INDEX IF NOT EXISTS idx_user_events_category_action ON user_events(event_category, event_action);
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

-- Function to get event counts by category
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

-- Function to get conversion funnel
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

-- ============================================================================
-- SECTION 2: PASSIVE DATA COLLECTION (Issue 3)
-- ============================================================================

-- Create user_sessions table
CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  page_views INTEGER DEFAULT 0,
  interactions INTEGER DEFAULT 0,
  device_type TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_session_id ON user_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_start_time ON user_sessions(start_time DESC);

-- Enable RLS
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can insert own sessions" ON user_sessions;
DROP POLICY IF EXISTS "Users can view own sessions" ON user_sessions;

CREATE POLICY "Users can insert own sessions" ON user_sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own sessions" ON user_sessions
  FOR SELECT USING (auth.uid() = user_id);

-- Function to get session statistics
CREATE OR REPLACE FUNCTION get_session_statistics(
  p_user_id UUID,
  p_start_date TIMESTAMPTZ DEFAULT NOW() - INTERVAL '30 days',
  p_end_date TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE (
  total_sessions BIGINT,
  avg_duration_seconds NUMERIC,
  total_duration_seconds BIGINT,
  avg_page_views NUMERIC,
  avg_interactions NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*) as total_sessions,
    AVG(duration_seconds) as avg_duration_seconds,
    SUM(duration_seconds) as total_duration_seconds,
    AVG(page_views) as avg_page_views,
    AVG(interactions) as avg_interactions
  FROM user_sessions
  WHERE user_id = p_user_id
    AND start_time BETWEEN p_start_date AND p_end_date;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- SECTION 3: DATA ENRICHMENT (Issue 15)
-- ============================================================================

-- Create data_enrichments table
CREATE TABLE IF NOT EXISTS data_enrichments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  data_type TEXT NOT NULL, -- 'workout', 'nutrition', 'health'
  data_id UUID NOT NULL, -- ID of the original data record
  derived_metrics JSONB NOT NULL, -- All derived metrics, scores, recommendations
  enriched_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, data_type, data_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_data_enrichments_user_id ON data_enrichments(user_id);
CREATE INDEX IF NOT EXISTS idx_data_enrichments_type ON data_enrichments(data_type);
CREATE INDEX IF NOT EXISTS idx_data_enrichments_data_id ON data_enrichments(data_id);
CREATE INDEX IF NOT EXISTS idx_data_enrichments_user_type ON data_enrichments(user_id, data_type);

-- Enable RLS
ALTER TABLE data_enrichments ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can view own enrichments" ON data_enrichments;
DROP POLICY IF EXISTS "Users can insert own enrichments" ON data_enrichments;
DROP POLICY IF EXISTS "Users can update own enrichments" ON data_enrichments;

CREATE POLICY "Users can view own enrichments" ON data_enrichments
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own enrichments" ON data_enrichments
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own enrichments" ON data_enrichments
  FOR UPDATE USING (auth.uid() = user_id);

-- Function to get enrichment statistics
CREATE OR REPLACE FUNCTION get_enrichment_statistics(
  p_user_id UUID,
  p_data_type TEXT,
  p_start_date TIMESTAMPTZ DEFAULT NOW() - INTERVAL '30 days',
  p_end_date TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE (
  avg_score NUMERIC,
  total_records BIGINT,
  score_distribution JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    AVG((derived_metrics->>'quality_score')::NUMERIC) as avg_score,
    COUNT(*) as total_records,
    jsonb_build_object(
      'high', COUNT(*) FILTER (WHERE (derived_metrics->>'quality_score')::NUMERIC >= 80),
      'medium', COUNT(*) FILTER (WHERE (derived_metrics->>'quality_score')::NUMERIC >= 60 AND (derived_metrics->>'quality_score')::NUMERIC < 80),
      'low', COUNT(*) FILTER (WHERE (derived_metrics->>'quality_score')::NUMERIC < 60)
    ) as score_distribution
  FROM data_enrichments
  WHERE user_id = p_user_id
    AND data_type = p_data_type
    AND enriched_at BETWEEN p_start_date AND p_end_date;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- SECTION 4: DATA QUALITY MONITORING (Issue 17, 20)
-- ============================================================================

-- Create data_quality_metrics table
CREATE TABLE IF NOT EXISTS data_quality_metrics (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  completeness_score INTEGER NOT NULL, -- 0-100
  freshness_score INTEGER NOT NULL, -- 0-100
  accuracy_score INTEGER NOT NULL, -- 0-100
  consistency_score INTEGER NOT NULL, -- 0-100
  overall_score INTEGER NOT NULL, -- 0-100
  issues_count INTEGER DEFAULT 0,
  metrics_date DATE NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, metrics_date)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_data_quality_user_id ON data_quality_metrics(user_id);
CREATE INDEX IF NOT EXISTS idx_data_quality_date ON data_quality_metrics(metrics_date DESC);
CREATE INDEX IF NOT EXISTS idx_data_quality_score ON data_quality_metrics(overall_score);

-- Enable RLS
ALTER TABLE data_quality_metrics ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can view own quality metrics" ON data_quality_metrics;
DROP POLICY IF EXISTS "Users can insert own quality metrics" ON data_quality_metrics;

CREATE POLICY "Users can view own quality metrics" ON data_quality_metrics
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own quality metrics" ON data_quality_metrics
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Function to get quality trends
CREATE OR REPLACE FUNCTION get_quality_trends(
  p_user_id UUID,
  p_days INTEGER DEFAULT 30
)
RETURNS TABLE (
  metrics_date DATE,
  overall_score INTEGER,
  completeness_score INTEGER,
  freshness_score INTEGER,
  accuracy_score INTEGER,
  consistency_score INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    metrics_date,
    overall_score,
    completeness_score,
    freshness_score,
    accuracy_score,
    consistency_score
  FROM data_quality_metrics
  WHERE user_id = p_user_id
    AND metrics_date >= CURRENT_DATE - (p_days || ' days')::INTERVAL
  ORDER BY metrics_date DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- SECTION 5: ENHANCED INDEXING (Issue 9)
-- ============================================================================

-- Composite indexes for common query patterns

-- Workouts: user_id + date + created_at (for feed and history)
CREATE INDEX IF NOT EXISTS idx_workouts_user_date_created 
ON workouts(user_id, date DESC, created_at DESC);

-- Workouts: user_id + template_name (for template usage analysis)
CREATE INDEX IF NOT EXISTS idx_workouts_user_template 
ON workouts(user_id, template_name) 
WHERE template_name IS NOT NULL;

-- Health metrics: user_id + date + source_provider (for provider-specific queries)
CREATE INDEX IF NOT EXISTS idx_health_metrics_user_date_source 
ON health_metrics(user_id, date DESC, source_provider);

-- Health metrics: user_id + date (covering index for common selects)
CREATE INDEX IF NOT EXISTS idx_health_metrics_user_date_covering 
ON health_metrics(user_id, date DESC) 
INCLUDE (sleep_score, hrv, steps, weight, calories_burned, resting_heart_rate);

-- Goals: user_id + status + category (for active goals by category)
CREATE INDEX IF NOT EXISTS idx_goals_user_status_category 
ON goals(user_id, status, category) 
WHERE status = 'active';

-- Goals: user_id + end_date (for upcoming deadlines)
CREATE INDEX IF NOT EXISTS idx_goals_user_end_date 
ON goals(user_id, end_date) 
WHERE end_date IS NOT NULL AND status = 'active';

-- Workout exercises: workout_id + body_part (for body part analysis)
CREATE INDEX IF NOT EXISTS idx_workout_exercises_workout_bodypart 
ON workout_exercises(workout_id, body_part);

-- Workout sets: workout_exercise_id + set_number (for set ordering)
CREATE INDEX IF NOT EXISTS idx_workout_sets_exercise_setnum 
ON workout_sets(workout_exercise_id, set_number);

-- Partial indexes for filtered queries

-- Active workout sessions (table only stores active sessions, deleted when workout ends)
CREATE INDEX IF NOT EXISTS idx_active_workout_sessions_active 
ON active_workout_sessions(user_id, updated_at DESC);

-- Shared feed items (only shared ones)
CREATE INDEX IF NOT EXISTS idx_feed_items_shared 
ON feed_items(created_at DESC) 
WHERE shared = true;

-- Connected accounts by provider
-- Note: Cannot use NOW() in index predicate (not immutable), so index all accounts
CREATE INDEX IF NOT EXISTS idx_connected_accounts_provider 
ON connected_accounts(user_id, provider);

-- User events by category (for analytics)
-- Note: Cannot use NOW() in index predicate (not immutable), so index all events
-- The timestamp DESC ordering will naturally help with recent queries
CREATE INDEX IF NOT EXISTS idx_user_events_category_timestamp 
ON user_events(event_category, timestamp DESC);

-- Covering indexes to eliminate table lookups

-- Workout summary (covers common workout queries)
CREATE INDEX IF NOT EXISTS idx_workouts_summary_covering 
ON workouts(user_id, date DESC) 
INCLUDE (duration, template_name, created_at);

-- Health metrics summary (covers common health queries)
CREATE INDEX IF NOT EXISTS idx_health_metrics_summary_covering 
ON health_metrics(user_id, date DESC) 
INCLUDE (sleep_score, hrv, steps, weight, calories_burned);

-- Goals summary (covers active goals queries)
CREATE INDEX IF NOT EXISTS idx_goals_summary_covering 
ON goals(user_id, status, category) 
INCLUDE (target_value, current_value, progress_percentage, end_date) 
WHERE status = 'active';

-- GIN indexes for JSONB queries

-- Health metrics source_data (for provider-specific data queries)
CREATE INDEX IF NOT EXISTS idx_health_metrics_source_data_gin 
ON health_metrics USING GIN (source_data) 
WHERE source_data IS NOT NULL;

-- User events properties (for event property queries)
CREATE INDEX IF NOT EXISTS idx_user_events_properties_gin 
ON user_events USING GIN (properties) 
WHERE properties IS NOT NULL;

-- Data enrichments derived_metrics (for enrichment queries)
CREATE INDEX IF NOT EXISTS idx_data_enrichments_metrics_gin 
ON data_enrichments USING GIN (derived_metrics) 
WHERE derived_metrics IS NOT NULL;

-- Analyze tables after index creation
ANALYZE workouts;
ANALYZE health_metrics;
ANALYZE goals;
ANALYZE workout_exercises;
ANALYZE workout_sets;
ANALYZE user_events;
ANALYZE data_enrichments;

-- ============================================================================
-- SECTION 6: AUDIT TRAIL (Issue 10)
-- ============================================================================

-- Create audit_log table
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  table_name TEXT NOT NULL,
  record_id UUID NOT NULL,
  action TEXT NOT NULL, -- 'INSERT', 'UPDATE', 'DELETE'
  old_values JSONB,
  new_values JSONB,
  changed_fields TEXT[],
  change_reason TEXT,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for audit log
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_table_record ON audit_log(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);

-- Enable RLS
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can view own audit logs" ON audit_log;

CREATE POLICY "Users can view own audit logs" ON audit_log
  FOR SELECT USING (auth.uid() = user_id);

-- Function to create audit log entry
CREATE OR REPLACE FUNCTION create_audit_log(
  p_table_name TEXT,
  p_record_id UUID,
  p_action TEXT,
  p_old_values JSONB DEFAULT NULL,
  p_new_values JSONB DEFAULT NULL,
  p_change_reason TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_audit_id UUID;
  v_changed_fields TEXT[];
BEGIN
  -- Calculate changed fields
  IF p_old_values IS NOT NULL AND p_new_values IS NOT NULL THEN
    SELECT ARRAY_AGG(key) INTO v_changed_fields
    FROM (
      SELECT key FROM jsonb_each(p_new_values)
      EXCEPT
      SELECT key FROM jsonb_each(p_old_values)
      WHERE jsonb_extract_path(p_old_values, key) IS DISTINCT FROM jsonb_extract_path(p_new_values, key)
    ) changed;
  END IF;
  
  -- Insert audit log
  INSERT INTO audit_log (
    user_id,
    table_name,
    record_id,
    action,
    old_values,
    new_values,
    changed_fields,
    change_reason
  ) VALUES (
    auth.uid(),
    p_table_name,
    p_record_id,
    p_action,
    p_old_values,
    p_new_values,
    v_changed_fields,
    p_change_reason
  ) RETURNING id INTO v_audit_id;
  
  RETURN v_audit_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger function for workouts table
CREATE OR REPLACE FUNCTION audit_workouts()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    PERFORM create_audit_log(
      'workouts',
      NEW.id,
      'INSERT',
      NULL,
      row_to_json(NEW)::JSONB
    );
    RETURN NEW;
  ELSIF (TG_OP = 'UPDATE') THEN
    PERFORM create_audit_log(
      'workouts',
      NEW.id,
      'UPDATE',
      row_to_json(OLD)::JSONB,
      row_to_json(NEW)::JSONB
    );
    RETURN NEW;
  ELSIF (TG_OP = 'DELETE') THEN
    PERFORM create_audit_log(
      'workouts',
      OLD.id,
      'DELETE',
      row_to_json(OLD)::JSONB,
      NULL
    );
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for workouts
DROP TRIGGER IF EXISTS workouts_audit_trigger ON workouts;
CREATE TRIGGER workouts_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON workouts
  FOR EACH ROW EXECUTE FUNCTION audit_workouts();

-- Trigger function for health_metrics table
CREATE OR REPLACE FUNCTION audit_health_metrics()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    PERFORM create_audit_log(
      'health_metrics',
      NEW.id,
      'INSERT',
      NULL,
      row_to_json(NEW)::JSONB
    );
    RETURN NEW;
  ELSIF (TG_OP = 'UPDATE') THEN
    PERFORM create_audit_log(
      'health_metrics',
      NEW.id,
      'UPDATE',
      row_to_json(OLD)::JSONB,
      row_to_json(NEW)::JSONB
    );
    RETURN NEW;
  ELSIF (TG_OP = 'DELETE') THEN
    PERFORM create_audit_log(
      'health_metrics',
      OLD.id,
      'DELETE',
      row_to_json(OLD)::JSONB,
      NULL
    );
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for health_metrics
DROP TRIGGER IF EXISTS health_metrics_audit_trigger ON health_metrics;
CREATE TRIGGER health_metrics_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON health_metrics
  FOR EACH ROW EXECUTE FUNCTION audit_health_metrics();

-- Trigger function for goals table
CREATE OR REPLACE FUNCTION audit_goals()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    PERFORM create_audit_log(
      'goals',
      NEW.id,
      'INSERT',
      NULL,
      row_to_json(NEW)::JSONB
    );
    RETURN NEW;
  ELSIF (TG_OP = 'UPDATE') THEN
    PERFORM create_audit_log(
      'goals',
      NEW.id,
      'UPDATE',
      row_to_json(OLD)::JSONB,
      row_to_json(NEW)::JSONB
    );
    RETURN NEW;
  ELSIF (TG_OP = 'DELETE') THEN
    PERFORM create_audit_log(
      'goals',
      OLD.id,
      'DELETE',
      row_to_json(OLD)::JSONB,
      NULL
    );
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for goals
DROP TRIGGER IF EXISTS goals_audit_trigger ON goals;
CREATE TRIGGER goals_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON goals
  FOR EACH ROW EXECUTE FUNCTION audit_goals();

-- Function to get audit history for a record
CREATE OR REPLACE FUNCTION get_audit_history(
  p_table_name TEXT,
  p_record_id UUID
)
RETURNS TABLE (
  id UUID,
  action TEXT,
  old_values JSONB,
  new_values JSONB,
  changed_fields TEXT[],
  change_reason TEXT,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    a.id,
    a.action,
    a.old_values,
    a.new_values,
    a.changed_fields,
    a.change_reason,
    a.created_at
  FROM audit_log a
  WHERE a.table_name = p_table_name
    AND a.record_id = p_record_id
    AND a.user_id = auth.uid()
  ORDER BY a.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- SECTION 7: MATERIALIZED VIEWS (Issue 13)
-- ============================================================================

-- Daily workout summaries
DROP MATERIALIZED VIEW IF EXISTS daily_workout_summaries;
CREATE MATERIALIZED VIEW daily_workout_summaries AS
SELECT 
  user_id,
  date,
  COUNT(*) as workout_count,
  SUM(duration) as total_duration,
  AVG(duration) as avg_duration,
  COUNT(DISTINCT template_name) as unique_templates
FROM workouts
GROUP BY user_id, date;

-- Create index on materialized view
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_workout_summaries_user_date 
ON daily_workout_summaries(user_id, date);

-- Weekly workout summaries
DROP MATERIALIZED VIEW IF EXISTS weekly_workout_summaries;
CREATE MATERIALIZED VIEW weekly_workout_summaries AS
SELECT 
  user_id,
  DATE_TRUNC('week', date)::DATE as week_start,
  COUNT(*) as workout_count,
  SUM(duration) as total_duration,
  AVG(duration) as avg_duration,
  COUNT(DISTINCT template_name) as unique_templates
FROM workouts
GROUP BY user_id, DATE_TRUNC('week', date)::DATE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_weekly_workout_summaries_user_week 
ON weekly_workout_summaries(user_id, week_start);

-- Monthly workout summaries
DROP MATERIALIZED VIEW IF EXISTS monthly_workout_summaries;
CREATE MATERIALIZED VIEW monthly_workout_summaries AS
SELECT 
  user_id,
  DATE_TRUNC('month', date)::DATE as month_start,
  COUNT(*) as workout_count,
  SUM(duration) as total_duration,
  AVG(duration) as avg_duration,
  COUNT(DISTINCT template_name) as unique_templates
FROM workouts
GROUP BY user_id, DATE_TRUNC('month', date)::DATE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_monthly_workout_summaries_user_month 
ON monthly_workout_summaries(user_id, month_start);

-- Daily health metrics summaries
DROP MATERIALIZED VIEW IF EXISTS daily_health_summaries;
CREATE MATERIALIZED VIEW daily_health_summaries AS
SELECT 
  user_id,
  date,
  AVG(sleep_score) as avg_sleep_score,
  AVG(hrv) as avg_hrv,
  AVG(resting_heart_rate) as avg_resting_hr,
  SUM(steps) as total_steps,
  AVG(weight) as avg_weight,
  SUM(calories_burned) as total_calories_burned
FROM health_metrics
WHERE date >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY user_id, date;

CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_health_summaries_user_date 
ON daily_health_summaries(user_id, date);

-- Weekly health metrics summaries
DROP MATERIALIZED VIEW IF EXISTS weekly_health_summaries;
CREATE MATERIALIZED VIEW weekly_health_summaries AS
SELECT 
  user_id,
  DATE_TRUNC('week', date)::DATE as week_start,
  AVG(sleep_score) as avg_sleep_score,
  AVG(hrv) as avg_hrv,
  AVG(resting_heart_rate) as avg_resting_hr,
  AVG(steps) as avg_steps,
  AVG(weight) as avg_weight,
  AVG(calories_burned) as avg_calories_burned
FROM health_metrics
WHERE date >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY user_id, DATE_TRUNC('week', date)::DATE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_weekly_health_summaries_user_week 
ON weekly_health_summaries(user_id, week_start);

-- Daily nutrition summaries
DROP MATERIALIZED VIEW IF EXISTS daily_nutrition_summaries;
CREATE MATERIALIZED VIEW daily_nutrition_summaries AS
SELECT 
  user_id,
  date,
  SUM(calories_consumed) as total_calories,
  AVG(calories_consumed) as avg_calories,
  SUM((macros->>'protein')::NUMERIC) as total_protein,
  SUM((macros->>'carbs')::NUMERIC) as total_carbs,
  SUM((macros->>'fat')::NUMERIC) as total_fat,
  SUM(water) as total_water
FROM health_metrics
WHERE calories_consumed IS NOT NULL
  AND date >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY user_id, date;

CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_nutrition_summaries_user_date 
ON daily_nutrition_summaries(user_id, date);

-- Function to refresh all materialized views
CREATE OR REPLACE FUNCTION refresh_all_materialized_views()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY daily_workout_summaries;
  REFRESH MATERIALIZED VIEW CONCURRENTLY weekly_workout_summaries;
  REFRESH MATERIALIZED VIEW CONCURRENTLY monthly_workout_summaries;
  REFRESH MATERIALIZED VIEW CONCURRENTLY daily_health_summaries;
  REFRESH MATERIALIZED VIEW CONCURRENTLY weekly_health_summaries;
  REFRESH MATERIALIZED VIEW CONCURRENTLY daily_nutrition_summaries;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- SECTION 8: ENGINEERED FEATURES (Issue 22)
-- ============================================================================

CREATE TABLE IF NOT EXISTS engineered_features (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature_type TEXT NOT NULL, -- 'rolling_stats', 'ratio_features', 'interaction_features'
  features JSONB NOT NULL,
  calculated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, feature_type)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_engineered_features_user_id ON engineered_features(user_id);
CREATE INDEX IF NOT EXISTS idx_engineered_features_type ON engineered_features(feature_type);
CREATE INDEX IF NOT EXISTS idx_engineered_features_calculated ON engineered_features(calculated_at DESC);

-- Enable RLS
ALTER TABLE engineered_features ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can view own features" ON engineered_features;
DROP POLICY IF EXISTS "Users can insert own features" ON engineered_features;
DROP POLICY IF EXISTS "Users can update own features" ON engineered_features;

CREATE POLICY "Users can view own features" ON engineered_features
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own features" ON engineered_features
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own features" ON engineered_features
  FOR UPDATE USING (auth.uid() = user_id);

-- ============================================================================
-- SECTION 9: A/B TESTING (Issue 24)
-- ============================================================================

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
DROP POLICY IF EXISTS "Users can view active tests" ON ab_tests;
CREATE POLICY "Users can view active tests" ON ab_tests
  FOR SELECT USING (status = 'active');

DROP POLICY IF EXISTS "Users can view own assignments" ON ab_test_assignments;
CREATE POLICY "Users can view own assignments" ON ab_test_assignments
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own assignments" ON ab_test_assignments;
CREATE POLICY "Users can insert own assignments" ON ab_test_assignments
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own events" ON ab_test_events;
CREATE POLICY "Users can insert own events" ON ab_test_events
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own events" ON ab_test_events;
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

-- ============================================================================
-- SECTION 10: PIPELINE MONITORING (Issue 31)
-- ============================================================================

CREATE TABLE IF NOT EXISTS pipeline_jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  job_name TEXT NOT NULL,
  status TEXT NOT NULL, -- 'success', 'failure', 'running'
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  duration_seconds NUMERIC,
  records_processed INTEGER DEFAULT 0,
  error_message TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_name ON pipeline_jobs(job_name);
CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_status ON pipeline_jobs(status);
CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_started ON pipeline_jobs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_name_status ON pipeline_jobs(job_name, status);

-- Enable RLS
ALTER TABLE pipeline_jobs ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can view pipeline jobs" ON pipeline_jobs;
CREATE POLICY "Users can view pipeline jobs" ON pipeline_jobs
  FOR SELECT USING (true);

-- Function to get pipeline statistics
CREATE OR REPLACE FUNCTION get_pipeline_statistics(
  p_job_name TEXT DEFAULT NULL,
  p_days INTEGER DEFAULT 7
)
RETURNS TABLE (
  total_jobs BIGINT,
  successful_jobs BIGINT,
  failed_jobs BIGINT,
  success_rate NUMERIC,
  avg_duration_seconds NUMERIC,
  total_records_processed BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*) as total_jobs,
    COUNT(*) FILTER (WHERE status = 'success') as successful_jobs,
    COUNT(*) FILTER (WHERE status = 'failure') as failed_jobs,
    CASE 
      WHEN COUNT(*) > 0 
      THEN (COUNT(*) FILTER (WHERE status = 'success')::NUMERIC / COUNT(*)::NUMERIC) * 100
      ELSE 0
    END as success_rate,
    AVG(duration_seconds) as avg_duration_seconds,
    SUM(records_processed) as total_records_processed
  FROM pipeline_jobs
  WHERE started_at >= CURRENT_DATE - (p_days || ' days')::INTERVAL
    AND (p_job_name IS NULL OR job_name = p_job_name);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- SECTION 11: SLA MONITORING (Issue 46)
-- ============================================================================

CREATE TABLE IF NOT EXISTS sla_metrics (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  metric_type TEXT NOT NULL, -- 'data_freshness', 'processing_time', 'availability', 'query_performance'
  metric_value NUMERIC,
  threshold NUMERIC,
  status TEXT NOT NULL, -- 'compliant', 'violation', 'warning'
  measured_at TIMESTAMPTZ DEFAULT NOW(),
  details JSONB
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sla_metrics_type ON sla_metrics(metric_type);
CREATE INDEX IF NOT EXISTS idx_sla_metrics_status ON sla_metrics(status);
CREATE INDEX IF NOT EXISTS idx_sla_metrics_measured ON sla_metrics(measured_at DESC);

-- Enable RLS
ALTER TABLE sla_metrics ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can view SLA metrics" ON sla_metrics;
CREATE POLICY "Users can view SLA metrics" ON sla_metrics
  FOR SELECT USING (true);

-- Function to get SLA compliance summary
CREATE OR REPLACE FUNCTION get_sla_compliance_summary(
  p_metric_type TEXT DEFAULT NULL,
  p_days INTEGER DEFAULT 7
)
RETURNS TABLE (
  metric_type TEXT,
  total_measurements BIGINT,
  compliant_count BIGINT,
  violation_count BIGINT,
  compliance_rate NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    m.metric_type,
    COUNT(*) as total_measurements,
    COUNT(*) FILTER (WHERE status = 'compliant') as compliant_count,
    COUNT(*) FILTER (WHERE status = 'violation') as violation_count,
    CASE 
      WHEN COUNT(*) > 0 
      THEN (COUNT(*) FILTER (WHERE status = 'compliant')::NUMERIC / COUNT(*)::NUMERIC) * 100
      ELSE 0
    END as compliance_rate
  FROM sla_metrics m
  WHERE measured_at >= CURRENT_DATE - (p_days || ' days')::INTERVAL
    AND (p_metric_type IS NULL OR m.metric_type = p_metric_type)
  GROUP BY m.metric_type;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- COMPLETION
-- ============================================================================

-- Refresh materialized views after initial setup
SELECT refresh_all_materialized_views();

-- Final message
DO $$
BEGIN
  RAISE NOTICE 'Data-First Migration Complete! All tables, indexes, functions, and triggers have been created.';
END $$;

