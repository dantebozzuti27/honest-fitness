-- ============================================================================
-- DATA RETENTION POLICY
-- Purpose: Automatically delete user data after 2 years of inactivity
-- GDPR/CCPA Compliant: Users can request deletion, and inactive data is purged
-- ============================================================================

-- Function to delete inactive user data (2 years of inactivity)
CREATE OR REPLACE FUNCTION delete_inactive_user_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  cutoff_date DATE;
  deleted_users INTEGER := 0;
BEGIN
  -- Calculate cutoff date (2 years ago)
  cutoff_date := CURRENT_DATE - INTERVAL '2 years';
  
  -- Delete data for users who haven't logged in for 2+ years
  -- Note: This deletes data, not the auth.users record (handled separately)
  
  -- Delete health metrics
  DELETE FROM health_metrics
  WHERE user_id IN (
    SELECT id FROM auth.users
    WHERE last_sign_in_at < cutoff_date OR (last_sign_in_at IS NULL AND created_at < cutoff_date)
  );
  
  -- Delete workouts and related data
  DELETE FROM workout_sets
  WHERE workout_exercise_id IN (
    SELECT we.id
    FROM workout_exercises we
    JOIN workouts w ON we.workout_id = w.id
    WHERE w.user_id IN (
      SELECT id FROM auth.users
      WHERE last_sign_in_at < cutoff_date OR (last_sign_in_at IS NULL AND created_at < cutoff_date)
    )
  );
  
  DELETE FROM workout_exercises
  WHERE workout_id IN (
    SELECT id FROM workouts
    WHERE user_id IN (
      SELECT id FROM auth.users
      WHERE last_sign_in_at < cutoff_date OR (last_sign_in_at IS NULL AND created_at < cutoff_date)
    )
  );
  
  DELETE FROM workouts
  WHERE user_id IN (
    SELECT id FROM auth.users
    WHERE last_sign_in_at < cutoff_date OR (last_sign_in_at IS NULL AND created_at < cutoff_date)
  );
  
  -- Delete goals
  DELETE FROM goals
  WHERE user_id IN (
    SELECT id FROM auth.users
    WHERE last_sign_in_at < cutoff_date OR (last_sign_in_at IS NULL AND created_at < cutoff_date)
  );
  
  -- Delete user preferences
  DELETE FROM user_preferences
  WHERE user_id IN (
    SELECT id FROM auth.users
    WHERE last_sign_in_at < cutoff_date OR (last_sign_in_at IS NULL AND created_at < cutoff_date)
  );
  
  -- Delete connected accounts
  DELETE FROM connected_accounts
  WHERE user_id IN (
    SELECT id FROM auth.users
    WHERE last_sign_in_at < cutoff_date OR (last_sign_in_at IS NULL AND created_at < cutoff_date)
  );
  
  -- Delete custom exercises
  DELETE FROM exercise_library
  WHERE created_by_user_id IN (
    SELECT id FROM auth.users
    WHERE last_sign_in_at < cutoff_date OR (last_sign_in_at IS NULL AND created_at < cutoff_date)
  );
  
  -- Delete custom foods
  DELETE FROM food_library
  WHERE created_by_user_id IN (
    SELECT id FROM auth.users
    WHERE last_sign_in_at < cutoff_date OR (last_sign_in_at IS NULL AND created_at < cutoff_date)
  );
  
  -- Delete user food preferences
  DELETE FROM user_food_preferences
  WHERE user_id IN (
    SELECT id FROM auth.users
    WHERE last_sign_in_at < cutoff_date OR (last_sign_in_at IS NULL AND created_at < cutoff_date)
  );
  
  -- Log the cleanup (optional - create audit table if needed)
  -- INSERT INTO data_retention_log (executed_at, cutoff_date, records_deleted) VALUES (NOW(), cutoff_date, deleted_users);
  
END;
$$;

-- Create a scheduled job to run this function monthly
-- Note: This requires pg_cron extension (available on Supabase Pro plan)
-- For free tier, run manually or use external cron service
-- 
-- SELECT cron.schedule(
--   'delete-inactive-user-data',
--   '0 0 1 * *', -- Run on the 1st of every month at midnight
--   $$SELECT delete_inactive_user_data();$$
-- );

-- Manual execution command:
-- SELECT delete_inactive_user_data();

