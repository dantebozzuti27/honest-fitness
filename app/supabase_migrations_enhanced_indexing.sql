-- Enhanced Indexing Strategy
-- Adds composite indexes, partial indexes, and covering indexes for optimal query performance

-- Composite indexes for common query patterns

-- Workouts: user_id + date + created_at (for feed and history)
CREATE INDEX IF NOT EXISTS idx_workouts_user_date_created 
ON workouts(user_id, date DESC, created_at DESC);

-- Workouts: user_id + template_id (for template usage analysis)
CREATE INDEX IF NOT EXISTS idx_workouts_user_template 
ON workouts(user_id, template_id) 
WHERE template_id IS NOT NULL;

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

-- Active workout sessions (only active ones)
CREATE INDEX IF NOT EXISTS idx_active_workout_sessions_active 
ON active_workout_sessions(user_id, updated_at DESC) 
WHERE is_active = true;

-- Shared feed items (only shared ones)
CREATE INDEX IF NOT EXISTS idx_feed_items_shared 
ON feed_items(created_at DESC) 
WHERE shared = true;

-- Connected accounts by provider
CREATE INDEX IF NOT EXISTS idx_connected_accounts_provider 
ON connected_accounts(user_id, provider) 
WHERE expires_at > NOW() OR expires_at IS NULL;

-- User events by category (for analytics)
CREATE INDEX IF NOT EXISTS idx_user_events_category_timestamp 
ON user_events(event_category, timestamp DESC) 
WHERE timestamp >= NOW() - INTERVAL '90 days';

-- Covering indexes to eliminate table lookups

-- Workout summary (covers common workout queries)
CREATE INDEX IF NOT EXISTS idx_workouts_summary_covering 
ON workouts(user_id, date DESC) 
INCLUDE (duration, template_id, created_at);

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

