# Materialized Views Refresh Setup

## Overview
Materialized views need to be refreshed periodically to keep data current. This document explains how to set up automatic refresh.

## Option 1: Supabase pg_cron (Recommended if available)

If your Supabase project has the `pg_cron` extension enabled, you can schedule automatic refreshes:

```sql
-- Enable pg_cron extension (run once)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule daily refresh at 2 AM UTC
SELECT cron.schedule(
  'refresh-materialized-views-daily',
  '0 2 * * *', -- 2 AM UTC daily
  $$SELECT refresh_all_materialized_views()$$
);

-- Schedule weekly refresh on Sundays at 3 AM UTC
SELECT cron.schedule(
  'refresh-materialized-views-weekly',
  '0 3 * * 0', -- 3 AM UTC on Sundays
  $$SELECT refresh_all_materialized_views()$$
);
```

## Option 2: Manual Refresh Function

You can manually refresh views by calling:

```sql
SELECT refresh_all_materialized_views();
```

## Option 3: Edge Function with Scheduled Trigger

Create a Supabase Edge Function that calls the refresh function, then set up a scheduled trigger via:
- Supabase Dashboard → Edge Functions → Schedule
- Or external cron service (GitHub Actions, Vercel Cron, etc.)

## Option 4: External Cron Job

Set up an external cron job (GitHub Actions, Vercel Cron, etc.) that calls:

```bash
curl -X POST 'https://YOUR_PROJECT.supabase.co/rest/v1/rpc/refresh_all_materialized_views' \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY"
```

## Current Refresh Function

The function `refresh_all_materialized_views()` is already created in the migration and refreshes:
- `daily_workout_summaries`
- `weekly_workout_summaries`
- `monthly_workout_summaries`
- `daily_health_summaries`
- `weekly_health_summaries`
- `daily_nutrition_summaries`

## Recommended Schedule

- **Daily refresh**: Run at 2 AM UTC (low traffic time)
- **After major data imports**: Run manually after bulk data operations
- **On-demand**: Call manually when needed for real-time analytics

## Monitoring

Check refresh status:
```sql
-- Check last refresh time (if you add a refresh_log table)
-- Or check materialized view data freshness
SELECT 
  schemaname,
  matviewname,
  hasindexes,
  ispopulated
FROM pg_matviews
WHERE schemaname = 'public';
```

