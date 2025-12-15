-- Materialized Views for Data Aggregations
-- Pre-computed aggregations for improved query performance

-- Daily workout summaries
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_workout_summaries AS
SELECT 
  user_id,
  date,
  COUNT(*) as workout_count,
  SUM(duration) as total_duration,
  AVG(duration) as avg_duration,
  COUNT(DISTINCT template_id) as unique_templates
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
  COUNT(DISTINCT template_id) as unique_templates
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
  COUNT(DISTINCT template_id) as unique_templates
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

-- Function to refresh materialized views incrementally (only recent data)
CREATE OR REPLACE FUNCTION refresh_materialized_views_incremental()
RETURNS void AS $$
DECLARE
  recent_date DATE := CURRENT_DATE - INTERVAL '7 days';
BEGIN
  -- Drop and recreate views with recent data only
  DROP MATERIALIZED VIEW IF EXISTS daily_workout_summaries;
  CREATE MATERIALIZED VIEW daily_workout_summaries AS
  SELECT 
    user_id,
    date,
    COUNT(*) as workout_count,
    SUM(duration) as total_duration,
    AVG(duration) as avg_duration,
    COUNT(DISTINCT template_id) as unique_templates
  FROM workouts
  WHERE date >= recent_date
  GROUP BY user_id, date;
  
  CREATE UNIQUE INDEX idx_daily_workout_summaries_user_date 
  ON daily_workout_summaries(user_id, date);
  
  -- Similar for other views...
  -- (Simplified for brevity - implement full incremental refresh)
END;
$$ LANGUAGE plpgsql;

-- Trigger to refresh views when data changes (simplified - use pg_cron in production)
-- Note: In production, schedule refresh_all_materialized_views() via pg_cron or external scheduler

