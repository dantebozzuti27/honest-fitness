# HonestFitness Database Infrastructure Overview

This document provides a comprehensive overview of your Supabase database structure, including all tables, relationships, and security policies.

## Database Architecture

Your database uses **PostgreSQL** (via Supabase) with the following key features:
- **Row Level Security (RLS)** enabled on all user-facing tables
- **Foreign key relationships** to `auth.users` for user isolation
- **Unique constraints** to prevent duplicate data
- **Indexes** for performance optimization
- **Triggers** for automatic timestamp updates

---

## Tables Overview

### 1. **connected_accounts**
Stores OAuth tokens and credentials for wearable device integrations.

**Columns:**
- `id` (UUID, PRIMARY KEY)
- `user_id` (UUID, FK → auth.users, ON DELETE CASCADE)
- `provider` (TEXT) - Values: 'oura', 'fitbit', 'apple', 'garmin', 'whoop'
- `access_token` (TEXT, NOT NULL)
- `refresh_token` (TEXT)
- `expires_at` (TIMESTAMPTZ)
- `token_type` (TEXT, DEFAULT 'Bearer')
- `scope` (TEXT)
- `created_at` (TIMESTAMPTZ, DEFAULT NOW())
- `updated_at` (TIMESTAMPTZ, DEFAULT NOW())

**Constraints:**
- UNIQUE(user_id, provider) - One connection per provider per user

**Indexes:**
- `idx_connected_accounts_user` on (user_id)
- `idx_connected_accounts_provider` on (provider)

**RLS Policies:**
- Users can only view/insert/update/delete their own connected accounts

---

### 2. **oura_daily**
Stores daily summary data from Oura Ring devices.

**Columns:**
- `id` (UUID, PRIMARY KEY)
- `user_id` (UUID, FK → auth.users, ON DELETE CASCADE)
- `date` (DATE, NOT NULL)
- `hrv` (NUMERIC) - Heart Rate Variability
- `resting_heart_rate` (NUMERIC)
- `body_temp` (NUMERIC)
- `sleep_score` (NUMERIC)
- `sleep_duration` (NUMERIC) - minutes
- `sleep_efficiency` (NUMERIC)
- `total_sleep` (NUMERIC) - minutes
- `deep_sleep` (NUMERIC) - minutes
- `rem_sleep` (NUMERIC) - minutes
- `light_sleep` (NUMERIC) - minutes
- `activity_score` (NUMERIC)
- `readiness_score` (NUMERIC)
- `calories` (NUMERIC)
- `steps` (INTEGER)
- `active_calories` (NUMERIC)
- `created_at` (TIMESTAMPTZ, DEFAULT NOW())
- `updated_at` (TIMESTAMPTZ, DEFAULT NOW())

**Constraints:**
- UNIQUE(user_id, date) - One record per user per day

**Indexes:**
- `idx_oura_daily_user_date` on (user_id, date)

**RLS Policies:**
- Users can only view/insert/update their own Oura data

---

### 3. **fitbit_daily**
Stores daily summary data from Fitbit devices.

**Columns:**
- `id` (UUID, PRIMARY KEY)
- `user_id` (UUID, FK → auth.users, ON DELETE CASCADE)
- `date` (DATE, NOT NULL)
- `hrv` (NUMERIC) - Heart Rate Variability
- `resting_heart_rate` (NUMERIC)
- `body_temp` (NUMERIC)
- `sleep_duration` (NUMERIC) - minutes
- `sleep_efficiency` (NUMERIC)
- `calories` (NUMERIC)
- `steps` (INTEGER)
- `active_calories` (NUMERIC)
- `distance` (NUMERIC) - km
- `floors` (INTEGER)
- `average_heart_rate` (NUMERIC)
- `sedentary_minutes` (INTEGER)
- `lightly_active_minutes` (INTEGER)
- `fairly_active_minutes` (INTEGER)
- `very_active_minutes` (INTEGER)
- `marginal_calories` (NUMERIC)
- `weight` (NUMERIC)
- `bmi` (NUMERIC)
- `fat` (NUMERIC) - Body fat percentage
- `created_at` (TIMESTAMPTZ, DEFAULT NOW())
- `updated_at` (TIMESTAMPTZ, DEFAULT NOW())

**Constraints:**
- UNIQUE(user_id, date) - One record per user per day

**Indexes:**
- `idx_fitbit_daily_user_date` on (user_id, date)

**RLS Policies:**
- Users can only view/insert/update their own Fitbit data

---

### 4. **honest_readiness**
Stores calculated daily readiness scores and component scores.

**Columns:**
- `id` (UUID, PRIMARY KEY)
- `user_id` (UUID, FK → auth.users, ON DELETE CASCADE)
- `date` (DATE, NOT NULL)
- `score` (INTEGER, NOT NULL) - CHECK (score >= 0 AND score <= 100)
- `zone` (TEXT, NOT NULL) - CHECK (zone IN ('green', 'yellow', 'red'))
- `ac_ratio` (INTEGER) - Acute:chronic ratio score
- `hrv_score` (INTEGER)
- `temp_score` (INTEGER)
- `sleep_score` (INTEGER)
- `strain_score` (INTEGER)
- `created_at` (TIMESTAMPTZ, DEFAULT NOW())
- `updated_at` (TIMESTAMPTZ, DEFAULT NOW())

**Constraints:**
- UNIQUE(user_id, date) - One readiness score per user per day

**Indexes:**
- `idx_honest_readiness_user_date` on (user_id, date)

**RLS Policies:**
- Users can only view/insert/update their own readiness scores

---

### 5. **daily_metrics**
Aggregated daily metrics table (likely the main table for dashboard/analytics).

**Columns:**
- `id` (UUID, PRIMARY KEY) - Assumed, not explicitly defined in migrations
- `user_id` (UUID, FK → auth.users) - Assumed
- `date` (DATE) - Assumed
- `sleep_score` (NUMERIC)
- `sleep_time` (NUMERIC)
- `hrv` (NUMERIC)
- `steps` (INTEGER)
- `calories` (NUMERIC) - calories burned
- `weight` (NUMERIC)
- `resting_heart_rate` (NUMERIC) - Added via migration
- `body_temp` (NUMERIC) - Added via migration
- `calories_consumed` (NUMERIC) - Added via migration
- `calories_burned` (NUMERIC) - Added via migration
- `meals` (JSONB) - Added via migration
- `macros` (JSONB) - Added via migration
- `water` (NUMERIC, DEFAULT 0) - Added via migration
- `created_at` (TIMESTAMPTZ) - Assumed
- `updated_at` (TIMESTAMPTZ, DEFAULT NOW()) - Added via migration

**Note:** This table structure is inferred from migrations and code usage. The base table creation SQL is not in the migration files, suggesting it may have been created manually or through Supabase UI.

---

### 6. **workouts**
Stores workout sessions.

**Columns:**
- `id` (UUID, PRIMARY KEY) - Assumed
- `user_id` (UUID, FK → auth.users) - Assumed
- `date` (DATE) - Workout date
- `duration` (NUMERIC) - Workout duration in minutes
- `template_name` (TEXT) - Optional workout template name
- `perceived_effort` (INTEGER) - 1-10 scale
- `mood_after` (TEXT) - Post-workout mood
- `notes` (TEXT) - Workout notes
- `day_of_week` (TEXT) - Day of week
- `created_at` (TIMESTAMPTZ, DEFAULT NOW())
- `updated_at` (TIMESTAMPTZ, DEFAULT NOW()) - Auto-updated via trigger

**Triggers:**
- `update_workouts_updated_at` - Automatically updates `updated_at` on row update

**Relationships:**
- One-to-many with `workout_exercises`

**Note:** Base table creation SQL not found in migrations, likely created manually.

---

### 7. **workout_exercises**
Stores exercises within a workout.

**Columns:**
- `id` (UUID, PRIMARY KEY) - Assumed
- `workout_id` (UUID, FK → workouts) - Assumed
- `exercise_name` (TEXT)
- `category` (TEXT)
- `body_part` (TEXT)
- `equipment` (TEXT)
- `exercise_order` (INTEGER) - Order within workout

**Relationships:**
- Many-to-one with `workouts`
- One-to-many with `workout_sets`

---

### 8. **workout_sets**
Stores individual sets for each exercise.

**Columns:**
- `id` (UUID, PRIMARY KEY) - Assumed
- `workout_exercise_id` (UUID, FK → workout_exercises) - Assumed
- `set_number` (INTEGER) - Set order (1, 2, 3...)
- `weight` (NUMERIC) - Weight used
- `reps` (NUMERIC) - Number of repetitions
- `time` (NUMERIC) - Time duration (for time-based exercises)
- `speed` (NUMERIC) - Speed (for cardio)
- `incline` (NUMERIC) - Incline (for cardio)

**Relationships:**
- Many-to-one with `workout_exercises`

---

### 9. **goals**
Stores user-defined goals across different categories.

**Columns:**
- `id` (UUID, PRIMARY KEY)
- `user_id` (UUID, FK → auth.users, ON DELETE CASCADE)
- `category` (TEXT, NOT NULL) - 'fitness', 'nutrition', 'health', 'custom'
- `type` (TEXT, NOT NULL) - e.g., 'calories', 'protein', 'workouts_per_week', 'steps', 'weight', 'custom'
- `custom_name` (TEXT) - For custom goals
- `target_value` (NUMERIC, NOT NULL)
- `current_value` (NUMERIC, DEFAULT 0)
- `unit` (TEXT, DEFAULT '')
- `start_date` (DATE, NOT NULL)
- `end_date` (DATE) - Optional end date
- `status` (TEXT, DEFAULT 'active') - 'active', 'completed', 'archived'
- `description` (TEXT)
- `created_at` (TIMESTAMPTZ, DEFAULT NOW())
- `updated_at` (TIMESTAMPTZ, DEFAULT NOW())

**Indexes:**
- `idx_goals_user_id` on (user_id)
- `idx_goals_category` on (category)
- `idx_goals_status` on (status)
- `idx_goals_user_category` on (user_id, category)

**RLS Policies:**
- Users can only view/insert/update/delete their own goals

---

### 10. **user_preferences**
Stores user profile and preference data.

**Columns:**
- `id` (UUID, PRIMARY KEY)
- `user_id` (UUID, FK → auth.users, ON DELETE CASCADE)
- `age` (INTEGER)
- `weight` (NUMERIC)
- `height` (NUMERIC)
- `goals` (JSONB) - User goals as JSON
- `preferences` (JSONB) - General preferences
- `nutrition_settings` (JSONB) - Nutrition-related settings
- `weekly_meal_plan` (JSONB) - Weekly meal planning data
- `username` (TEXT) - Added via migration
- `profile_picture` (TEXT) - Added via migration
- `created_at` (TIMESTAMPTZ, DEFAULT NOW())
- `updated_at` (TIMESTAMPTZ, DEFAULT NOW())

**Constraints:**
- UNIQUE(user_id) - One preference record per user
- UNIQUE(username) - Username must be unique (via index, where username IS NOT NULL)

**Indexes:**
- `idx_user_preferences_user` on (user_id)
- `user_preferences_username_unique` on (username) WHERE username IS NOT NULL

**RLS Policies:**
- Users can only view/insert/update/delete their own preferences

---

## Database Functions & Triggers

### `update_updated_at_column()`
**Purpose:** Automatically updates the `updated_at` timestamp when a row is modified.

**Used by:**
- `workouts` table (via trigger `update_workouts_updated_at`)

**Implementation:**
```sql
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

---

## Row Level Security (RLS)

All user-facing tables have RLS enabled with policies that ensure:
- Users can only access their own data (via `auth.uid() = user_id`)
- Full CRUD operations are restricted to the data owner
- Policies are named consistently: "Users can [action] own [table_name]"

**Tables with RLS:**
1. `connected_accounts`
2. `oura_daily`
3. `fitbit_daily`
4. `honest_readiness`
5. `goals`
6. `user_preferences`

**Note:** `daily_metrics`, `workouts`, `workout_exercises`, and `workout_sets` likely have RLS enabled but policies are not explicitly defined in the migration files.

---

## Data Flow & Relationships

```
auth.users (Supabase Auth)
  ├── connected_accounts (1:many)
  ├── oura_daily (1:many)
  ├── fitbit_daily (1:many)
  ├── honest_readiness (1:many)
  ├── daily_metrics (1:many)
  ├── goals (1:many)
  ├── user_preferences (1:1)
  └── workouts (1:many)
        └── workout_exercises (1:many)
              └── workout_sets (1:many)
```

---

## Migration Files

Your database migrations are organized in separate files:

1. **`supabase_migrations.sql`** - Core tables (connected_accounts, oura_daily, fitbit_daily, honest_readiness)
2. **`supabase_migrations_goals.sql`** - Goals table
3. **`supabase_migrations_nutrition_settings.sql`** - User preferences table with nutrition fields
4. **`supabase_migrations_user_profile.sql`** - Username and profile_picture columns
5. **`supabase_migrations_nutrition.sql`** - Nutrition columns in daily_metrics
6. **`supabase_migrations_daily_metrics_updated_at.sql`** - Additional daily_metrics columns
7. **`supabase_migrations_workouts_updated_at.sql`** - Workouts table timestamp trigger
8. **`supabase_migrations_fitbit_enhancements.sql`** - Additional Fitbit metrics

---

## Key Design Patterns

1. **User Isolation:** All tables reference `auth.users(id)` with CASCADE delete
2. **Date-based Uniqueness:** Wearable data tables use `UNIQUE(user_id, date)` to prevent duplicates
3. **JSONB for Flexibility:** Complex data stored as JSONB (meals, macros, preferences)
4. **Incremental Migrations:** Migrations use `DO $$ ... END $$` blocks to safely add columns
5. **Automatic Timestamps:** `created_at` and `updated_at` with triggers for auto-updates

---

## Recommendations for Working in Supabase

1. **Check Table Editor:** Use Supabase Dashboard → Table Editor to see actual table structures
2. **Verify RLS Policies:** Check Authentication → Policies to see all RLS policies
3. **Test Queries:** Use SQL Editor to test queries before implementing in code
4. **Monitor Indexes:** Check Database → Indexes to see all performance indexes
5. **Review Triggers:** Check Database → Functions to see all triggers and functions

---

## Common Queries You Might Need

### Get all tables
```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public'
ORDER BY table_name;
```

### Get table structure
```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'your_table_name'
ORDER BY ordinal_position;
```

### Check RLS policies
```sql
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

### View all indexes
```sql
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;
```

