# SQL Migrations - Run Instructions

## ⚠️ IMPORTANT: Run these migrations in Supabase SQL Editor

These migrations need to be executed in your Supabase project to enable the new data infrastructure features.

## Migration Order

Run these migrations **in order** in the Supabase SQL Editor:

### 1. Materialized Views
**File:** `app/supabase_migrations_materialized_views.sql`
- Creates pre-computed aggregations for faster analytics
- Daily/weekly/monthly summaries for workouts, health metrics, nutrition
- **Action:** Copy entire file content and run in Supabase SQL Editor

### 2. Engineered Features
**File:** `app/supabase_migrations_engineered_features.sql`
- Stores ML features for predictions
- **Action:** Copy entire file content and run in Supabase SQL Editor

### 3. A/B Testing
**File:** `app/supabase_migrations_ab_testing.sql`
- Enables A/B testing infrastructure
- **Action:** Copy entire file content and run in Supabase SQL Editor

### 4. Pipeline Monitoring
**File:** `app/supabase_migrations_pipeline_monitoring.sql`
- Tracks ETL pipeline health
- **Action:** Copy entire file content and run in Supabase SQL Editor

### 5. SLA Monitoring
**File:** `app/supabase_migrations_sla_monitoring.sql`
- Monitors data freshness SLAs
- **Action:** Copy entire file content and run in Supabase SQL Editor

## How to Run

1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Open each migration file
4. Copy the entire SQL content
5. Paste into SQL Editor
6. Click **Run** (or press Cmd/Ctrl + Enter)
7. Verify success (check for errors)

## Post-Migration Setup

After running migrations, you may want to:

1. **Schedule Materialized View Refresh:**
   - Set up a cron job to call `refresh_all_materialized_views()` daily
   - Or use Supabase Edge Functions with scheduled triggers

2. **Verify Tables Created:**
   ```sql
   SELECT table_name 
   FROM information_schema.tables 
   WHERE table_schema = 'public' 
   AND table_name IN (
     'engineered_features',
     'ab_tests',
     'ab_test_assignments',
     'pipeline_jobs',
     'sla_metrics'
   );
   ```

3. **Test Materialized Views:**
   ```sql
   SELECT * FROM daily_workout_summaries LIMIT 5;
   SELECT * FROM daily_health_summaries LIMIT 5;
   ```

## Notes

- These migrations are **idempotent** (safe to run multiple times)
- They use `IF NOT EXISTS` clauses to prevent errors
- No data will be lost or modified
- All migrations add new tables/views, no existing tables are altered

## Troubleshooting

If you encounter errors:
- Check that you have the necessary permissions
- Ensure you're running in the correct database
- Verify table names don't conflict with existing tables
- Check Supabase logs for detailed error messages

