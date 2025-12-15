-- ============================================================================
-- Supabase "run everything" entrypoint (PSQL ONLY)
-- Purpose: Execute the core schema + recent required migrations in ONE run.
--
-- IMPORTANT:
-- - This file uses psql meta-commands (`\i`) and will NOT run in Supabase SQL Editor.
-- - Use it from your terminal with `psql` against your Supabase Postgres connection.
-- - If you prefer Supabase SQL Editor, open and run the referenced files in order.
-- ============================================================================

\set ON_ERROR_STOP on

-- Optional but recommended for repeatability when running via psql:
-- \echo 'Running Honest Fitness Supabase migrations...'

-- Core schema / upgrade (big, includes health_metrics, exercise_library, goals, nutrition, etc.)
\i app/supabase_migrations_complete_database_upgrade.sql

-- Social tables + constraints/policies
\i app/supabase_migrations_feed.sql
\i app/supabase_migrations_unique_user_constraints.sql
\i app/supabase_migrations_social_fixes.sql

-- New app features
\i app/supabase_migrations_workouts_session_type.sql
\i app/supabase_migrations_user_preferences_visibility.sql

-- Optional: seed/rebuild system exercise catalog (destructive to system exercises only)
-- \i app/supabase_seed_exercise_library_reset_and_rebuild.sql



