-- ============================================================================
-- ALL-IN-ONE DATABASE MIGRATION
-- Combines all 5 migrations for easy execution
-- Run this entire file in Supabase SQL Editor
-- ============================================================================

-- ============================================================================
-- 1. MATERIALIZED VIEWS
-- Pre-computed aggregations for improved query performance
-- ============================================================================

-- Daily workout summaries
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_workout_summaries AS
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
CREATE MATERIALIZED VIEW IF NOT EXISTS weekly_workout_summaries AS
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
CREATE MATERIALIZED VIEW IF NOT EXISTS monthly_workout_summaries AS
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
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_health_summaries AS
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
CREATE MATERIALIZED VIEW IF NOT EXISTS weekly_health_summaries AS
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
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_nutrition_summaries AS
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
-- 2. ENGINEERED FEATURES
-- Stores calculated features for ML models
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
-- 3. A/B TESTING INFRASTRUCTURE
-- Tables for experiments, assignments, and event tracking
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
-- 4. PIPELINE MONITORING
-- Track ETL pipeline health, data flow, processing times, failures
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
-- 5. SLA MONITORING
-- Track SLA compliance for data freshness, availability, processing times
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
-- MIGRATION COMPLETE
-- All tables, views, indexes, and functions have been created
-- ============================================================================

