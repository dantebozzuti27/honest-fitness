# Code Updates Summary - Database Migration Alignment

This document summarizes all code changes made to align the application with the new unified database structure.

## Overview

All database interactions have been updated to use the new unified `health_metrics` table and new supporting tables (`exercise_library`, `food_library`, etc.) while maintaining backward compatibility with deprecated tables.

---

## Files Updated

### 1. **app/src/lib/wearables.js** ✅
**Changes:**
- `saveOuraDaily()` - Now writes to `health_metrics` table (primary) and `oura_daily` (backward compatibility)
- `getOuraDaily()` - Reads from `health_metrics` first, falls back to `oura_daily`
- `saveFitbitDaily()` - Now writes to `health_metrics` table (primary) and `fitbit_daily` (backward compatibility)
- `getFitbitDaily()` - Reads from `health_metrics` first, falls back to `fitbit_daily`
- `getMostRecentFitbitData()` - Updated to use `health_metrics`
- `mergeWearableDataToMetrics()` - Completely rewritten to merge data into `health_metrics` table

**Key Features:**
- All wearable data now stored in unified `health_metrics` table
- Source tracking via `source_provider` field ('oura', 'fitbit', 'apple_watch', 'merged', 'manual')
- Raw provider-specific data stored in `source_data` JSONB field
- Backward compatibility maintained with old tables

---

### 2. **app/src/lib/supabaseDb.js** ✅
**Changes:**
- `saveMetricsToSupabase()` - Updated to use `health_metrics` table with new column structure
  - Maps `sleepTime` → `sleep_duration`
  - Uses `calories_burned` instead of `calories`
  - Supports all new metrics: `breathing_rate`, `spo2`, `strain`, `body_fat_percentage`
- `getMetricsFromSupabase()` - Updated to read from `health_metrics`
- `getAllMetricsFromSupabase()` - Updated to read from `health_metrics`
- `saveWorkoutToSupabase()` - Enhanced to:
  - Link exercises to `exercise_library` table
  - Support `exercise_type` ('weightlifting' or 'cardio')
  - Support `distance` and `distance_unit` for cardio exercises
  - Auto-create custom exercises in `exercise_library`
- `updateWorkoutInSupabase()` - Same enhancements as `saveWorkoutToSupabase()`
- `saveUserPreferences()` - Added support for:
  - `date_of_birth`
  - `gender`
  - `height_inches`
  - `height_feet`

---

### 3. **app/src/lib/nutritionDb.js** ✅
**Changes:**
- `saveMealToSupabase()` - Updated to use `health_metrics` table
  - Uses `calories_consumed` instead of `calories`
  - Preserves `source_provider` when updating
- `getMealsFromSupabase()` - Updated to read from `health_metrics`
- `getNutritionRangeFromSupabase()` - Updated to use `health_metrics` and `calories_consumed`
- `updateWaterIntake()` - Updated to use `health_metrics`
- `deleteMealFromSupabase()` - Updated to use `health_metrics`

**Key Features:**
- All nutrition data now stored in `health_metrics` table
- `meals` and `macros` stored as JSONB
- `calories_consumed` separate from `calories_burned`

---

### 4. **app/src/lib/database.js** ✅
**Changes:**
- `saveMetricsToSupabase()` - Updated to use `health_metrics` table
  - Maps `sleepTime` → `sleep_duration`
  - Uses `calories_burned` instead of `calories`
- `getMetricsFromSupabase()` - Updated to read from `health_metrics`
- `getAllMetrics()` - Updated to read from `health_metrics`

---

### 5. **app/src/lib/goalsDb.js** ✅
**Changes:**
- `saveGoalToSupabase()` - Added support for:
  - `is_daily_goal` (boolean)
  - `daily_achievements` (JSONB)
  - `progress_percentage` (numeric)
  - `last_calculated_at` (timestamp)
- `updateGoalProgress()` - Enhanced to support `progress_percentage` and `last_calculated_at`
- **New Functions:**
  - `calculateGoalProgress()` - Calls database function to calculate goal progress
  - `updateDailyGoalAchievement()` - Updates daily achievement tracking

---

### 6. **backend/src/database/index.js** ✅
**Changes:**
- `saveToDatabase()` - Updated:
  - `nutrition` case: Now uses `health_metrics` table with `calories_consumed`
  - `health` case: Now uses unified `health_metrics` table with proper source tracking
  - `user` case: Added support for `date_of_birth`, `gender`, `height_inches`, `height_feet`
- `getFromDatabase()` - Updated:
  - `nutrition` case: Reads from `health_metrics`
  - `health` case: Reads from `health_metrics` (no longer source-specific tables)

---

### 7. **backend/src/layers/abstraction/user.js** ✅
**Changes:**
- Updated `UserSchema` to include:
  - `dateOfBirth` (string, YYYY-MM-DD format)
  - `gender` (enum: 'male', 'female', 'other', 'prefer_not_to_say')
  - `heightInches` (number, total inches)
  - `heightFeet` (number, feet component)
- Updated `normalizeUserData()` to map new fields

---

## New Files Created

### 8. **app/src/lib/exerciseLibrary.js** ✨ NEW
**Purpose:** Manage exercise library and custom exercises

**Functions:**
- `getSystemExercises()` - Get all system exercises with filters
- `getCustomExercises()` - Get user's custom exercises
- `createCustomExercise()` - Create a custom exercise
- `updateCustomExercise()` - Update a custom exercise
- `deleteCustomExercise()` - Delete a custom exercise
- `getExerciseByName()` - Find exercise by name (system or custom)

---

### 9. **app/src/lib/foodLibrary.js** ✨ NEW
**Purpose:** Manage food library, custom foods, favorites, and recent foods

**Functions:**
- `getSystemFoods()` - Get all system foods with filters
- `getFoodCategories()` - Get all food categories
- `getCustomFoods()` - Get user's custom foods
- `createCustomFood()` - Create a custom food
- `updateCustomFood()` - Update a custom food
- `deleteCustomFood()` - Delete a custom food
- `getFavoriteFoods()` - Get user's favorite foods
- `addFavoriteFood()` - Add food to favorites
- `removeFavoriteFood()` - Remove food from favorites
- `getRecentFoods()` - Get recently used foods
- `updateFoodLastUsed()` - Update food last used timestamp

---

## Database Structure Alignment

### Health Metrics Table
All health, wearable, and nutrition data now flows through `health_metrics`:

**Wearable Data:**
- Oura → `health_metrics` with `source_provider = 'oura'`
- Fitbit → `health_metrics` with `source_provider = 'fitbit'`
- Apple Watch → `health_metrics` with `source_provider = 'apple_watch'` (when implemented)
- Manual entries → `health_metrics` with `source_provider = 'manual'`
- Merged data → `health_metrics` with `source_provider = 'merged'`

**Nutrition Data:**
- Meals → `health_metrics.meals` (JSONB)
- Macros → `health_metrics.macros` (JSONB)
- Calories consumed → `health_metrics.calories_consumed`
- Water → `health_metrics.water`

**Manual Metrics:**
- Weight → `health_metrics.weight` (with forward-fill trigger)
- Body fat → `health_metrics.body_fat_percentage` (with forward-fill trigger)

---

### Exercise Structure
**Exercise Library:**
- System exercises in `exercise_library` (is_custom = false)
- Custom exercises in `exercise_library` (is_custom = true, created_by_user_id)
- Exercises linked to workouts via `workout_exercises.exercise_library_id`

**Workout Exercises:**
- `exercise_type` - 'weightlifting' or 'cardio'
- `distance` and `distance_unit` - For cardio exercises
- `exercise_library_id` - Link to exercise library

---

### Nutrition Structure
**Food Library:**
- System foods in `food_library` (is_custom = false)
- Custom foods in `food_library` (is_custom = true, created_by_user_id)
- Foods categorized via `food_categories`

**User Food Preferences:**
- Favorites tracked in `user_food_preferences` (is_favorite = true)
- Recent foods tracked via `user_food_preferences.last_used_at`

---

### Goals Structure
**Enhanced Goals:**
- `is_daily_goal` - Boolean flag for daily goals
- `daily_achievements` - JSONB tracking daily achievement: `{"2024-01-15": true, ...}`
- `progress_percentage` - Calculated progress (0-100)
- `last_calculated_at` - Timestamp of last calculation

**Goal Progress Calculation:**
- Uses `calculate_goal_progress()` database function
- Pulls data from `health_metrics` for current values
- Supports: weight, calories, protein, carbs, fat, workouts_per_week, steps

---

### User Preferences Structure
**New Profile Fields:**
- `date_of_birth` - DATE field for age calculation
- `gender` - TEXT with CHECK constraint
- `height_inches` - NUMERIC (total inches)
- `height_feet` - INTEGER (feet component)

**Age Calculation:**
- Use `calculate_age(date_of_birth)` database function
- Returns age in years

---

## Backward Compatibility

### Deprecated Tables (Still Functional)
The following tables are marked as deprecated but still functional for backward compatibility:
- `oura_daily` - Data still written for compatibility
- `fitbit_daily` - Data still written for compatibility
- `daily_metrics` - No longer written to, but data preserved

**Migration Strategy:**
- New data goes to `health_metrics`
- Old data remains in deprecated tables
- Read functions check `health_metrics` first, fall back to old tables if needed
- Old tables can be safely removed after full migration verification

---

## Data Flow Examples

### Oura Sync Flow:
1. `syncOuraData()` → `saveOuraDaily()`
2. `saveOuraDaily()` → Writes to `health_metrics` (primary)
3. `saveOuraDaily()` → Also writes to `oura_daily` (backward compatibility)
4. `mergeWearableDataToMetrics()` → Merges with other sources if needed

### Fitbit Sync Flow:
1. `syncFitbitData()` → API endpoint → `saveFitbitDaily()`
2. `saveFitbitDaily()` → Writes to `health_metrics` (primary)
3. `saveFitbitDaily()` → Also writes to `fitbit_daily` (backward compatibility)
4. `mergeWearableDataToMetrics()` → Merges with other sources if needed

### Manual Metrics Flow:
1. User enters weight → `saveMetricsToSupabase()`
2. Writes to `health_metrics` with `source_provider = 'manual'`
3. Forward-fill trigger automatically fills future dates

### Nutrition Flow:
1. User adds meal → `saveMealToSupabase()`
2. Reads existing `health_metrics` record for date
3. Updates `meals` JSONB array
4. Recalculates `calories_consumed` and `macros`
5. Upserts to `health_metrics`

### Workout Flow:
1. User finishes workout → `saveWorkoutToSupabase()`
2. Creates workout in `workouts` table
3. For each exercise:
   - Checks `exercise_library` for existing exercise
   - Creates custom exercise if needed
   - Links via `exercise_library_id`
   - Sets `exercise_type` and `distance` if cardio
4. Creates `workout_exercises` and `workout_sets`

---

## Testing Checklist

- [ ] Oura data syncs to `health_metrics`
- [ ] Fitbit data syncs to `health_metrics`
- [ ] Manual metrics save to `health_metrics`
- [ ] Nutrition data saves to `health_metrics`
- [ ] Forward-fill trigger works for weight/body fat
- [ ] Exercise library functions work
- [ ] Custom exercises created and linked
- [ ] Food library functions work
- [ ] Custom foods created
- [ ] Favorites and recent foods work
- [ ] Goals support new columns
- [ ] Goal progress calculation works
- [ ] Daily goal achievement tracking works
- [ ] User preferences support new profile fields
- [ ] Age calculation from date of birth works

---

## Next Steps

1. **Test all data flows** - Verify each integration point
2. **Update UI components** - Ensure frontend uses new data structure
3. **Update queries** - Check all data fetching queries
4. **Monitor performance** - Watch for any query performance issues
5. **Remove deprecated tables** - After full verification (optional, for cleanup)

---

## Notes

- All changes maintain backward compatibility
- Old tables are still written to for safety
- Read functions check new tables first, fall back to old tables
- No data loss during migration
- All new functions include proper error handling
- RLS policies are maintained on all new tables

