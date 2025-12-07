# Database Migration Execution Guide

## Quick Start

Execute these migrations in order in your Supabase SQL Editor. Each migration is safe to run multiple times (uses IF NOT EXISTS checks).

---

## Execution Order

### 1. **Unified Health Metrics** ⭐ START HERE
**File:** `app/supabase_migrations_unified_health_metrics.sql`

**What it does:**
- Creates new `health_metrics` table with standardized columns
- Migrates data from `oura_daily`, `fitbit_daily`, and `daily_metrics`
- Preserves all existing data in old tables
- Sets up RLS policies

**Time:** ~2-5 minutes depending on data volume

**Verify after:**
```sql
SELECT COUNT(*) FROM health_metrics;
SELECT source_provider, COUNT(*) FROM health_metrics GROUP BY source_provider;
```

---

### 2. **User Profile Enhancements**
**File:** `app/supabase_migrations_user_profile_enhancements.sql`

**What it does:**
- Adds `date_of_birth`, `gender`, `height_inches`, `height_feet` to `user_preferences`
- Creates `calculate_age()` function

**Time:** < 1 minute

**Verify after:**
```sql
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'user_preferences' 
AND column_name IN ('date_of_birth', 'gender', 'height_inches', 'height_feet');
```

---

### 3. **Forward-Fill Metrics**
**File:** `app/supabase_migrations_forward_fill_metrics.sql`

**What it does:**
- Creates `forward_fill_manual_metrics()` function
- Creates trigger to auto forward-fill weight and body fat when updated
- Ensures manual metrics carry forward to future dates

**Time:** < 1 minute

**Verify after:**
```sql
SELECT routine_name FROM information_schema.routines 
WHERE routine_name = 'forward_fill_manual_metrics';
```

---

### 4. **Exercise Library**
**File:** `app/supabase_migrations_exercise_library.sql`

**What it does:**
- Creates `exercise_library` table
- Adds `exercise_type`, `distance`, `distance_unit`, `exercise_library_id` to `workout_exercises`
- Populates common exercises with sub body parts

**Time:** ~1-2 minutes

**Verify after:**
```sql
SELECT COUNT(*) FROM exercise_library WHERE is_custom = FALSE;
SELECT exercise_type, COUNT(*) FROM workout_exercises GROUP BY exercise_type;
```

---

### 5. **Nutrition Database**
**File:** `app/supabase_migrations_nutrition_database.sql`

**What it does:**
- Creates `food_categories` table
- Creates `food_library` table
- Creates `user_food_preferences` table (favorites & recent)
- Populates common foods

**Time:** ~1-2 minutes

**Verify after:**
```sql
SELECT COUNT(*) FROM food_categories;
SELECT COUNT(*) FROM food_library WHERE is_custom = FALSE;
```

---

### 6. **Goals Enhancements**
**File:** `app/supabase_migrations_goals_enhancements.sql`

**What it does:**
- Adds `is_daily_goal`, `daily_achievements`, `progress_percentage`, `last_calculated_at` to `goals`
- Creates `calculate_goal_progress()` function

**Time:** < 1 minute

**Verify after:**
```sql
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'goals' 
AND column_name IN ('is_daily_goal', 'daily_achievements', 'progress_percentage');
```

---

### 7. **Apple Watch Support**
**File:** `app/supabase_migrations_apple_watch_support.sql`

**What it does:**
- Adds CHECK constraint to restrict `connected_accounts.provider` to 'fitbit', 'oura', 'apple'

**Time:** < 1 minute

**Verify after:**
```sql
SELECT constraint_name FROM information_schema.table_constraints 
WHERE table_name = 'connected_accounts' 
AND constraint_name = 'connected_accounts_provider_check';
```

---

## Post-Migration Validation

Run these queries to verify everything worked:

```sql
-- 1. Check health_metrics migration
SELECT 
  (SELECT COUNT(*) FROM oura_daily) as oura_count,
  (SELECT COUNT(*) FROM fitbit_daily) as fitbit_count,
  (SELECT COUNT(*) FROM health_metrics WHERE source_provider = 'oura') as migrated_oura,
  (SELECT COUNT(*) FROM health_metrics WHERE source_provider = 'fitbit') as migrated_fitbit;

-- 2. Check new tables exist
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('health_metrics', 'exercise_library', 'food_library', 'food_categories', 'user_food_preferences')
ORDER BY table_name;

-- 3. Check exercise library populated
SELECT COUNT(*) as exercise_count FROM exercise_library WHERE is_custom = FALSE;

-- 4. Check food library populated
SELECT COUNT(*) as food_count FROM food_library WHERE is_custom = FALSE;

-- 5. Check functions exist
SELECT routine_name FROM information_schema.routines 
WHERE routine_name IN ('forward_fill_manual_metrics', 'calculate_goal_progress', 'calculate_age')
ORDER BY routine_name;
```

---

## Rollback (If Needed)

If you need to rollback:

1. **New tables can be dropped:**
```sql
DROP TABLE IF EXISTS health_metrics CASCADE;
DROP TABLE IF EXISTS exercise_library CASCADE;
DROP TABLE IF EXISTS food_library CASCADE;
DROP TABLE IF EXISTS food_categories CASCADE;
DROP TABLE IF EXISTS user_food_preferences CASCADE;
```

2. **Old tables are preserved** - your original data is safe in:
   - `oura_daily`
   - `fitbit_daily`
   - `daily_metrics`

3. **Functions can be dropped:**
```sql
DROP FUNCTION IF EXISTS forward_fill_manual_metrics(UUID, DATE, DATE);
DROP FUNCTION IF EXISTS trigger_forward_fill_metrics();
DROP FUNCTION IF EXISTS calculate_goal_progress(UUID);
DROP FUNCTION IF EXISTS calculate_age(DATE);
```

---

## Next Steps After Migration

1. **Update Application Code:**
   - Update wearable sync functions to write to `health_metrics`
   - Update exercise selection to use `exercise_library`
   - Update nutrition logging to use `food_library`
   - Update goals calculation to use new columns

2. **Test Data Flow:**
   - Test Oura sync → `health_metrics`
   - Test Fitbit sync → `health_metrics`
   - Test manual weight entry → forward-fill trigger
   - Test custom exercise creation
   - Test custom food creation

3. **Monitor Performance:**
   - Check query performance in Supabase Dashboard
   - Monitor trigger execution times
   - Review index usage

---

## Important Notes

- ✅ All migrations use `IF NOT EXISTS` - safe to run multiple times
- ✅ Old tables are preserved - no data loss
- ✅ RLS policies are applied to all new tables
- ✅ Indexes are created for performance
- ⚠️ Large datasets may take longer to migrate
- ⚠️ Test in a development environment first if possible

---

## Support

If you encounter issues:
1. Check Supabase logs in Dashboard → Logs
2. Verify RLS policies are correct
3. Check that foreign key constraints are satisfied
4. Ensure user_id values are valid UUIDs

