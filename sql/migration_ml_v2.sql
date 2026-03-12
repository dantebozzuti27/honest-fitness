-- ============================================================================
-- ML WORKOUT SYSTEM v2 - SCHEMA MIGRATION
-- Purpose: Add columns for intelligent workout generation
-- Safety: All operations are ADD COLUMN IF NOT EXISTS - no data is modified/deleted
-- ============================================================================

-- ============================================================================
-- 1. EXERCISE LIBRARY ENRICHMENT COLUMNS
-- Adds muscle-head-level mapping, movement classification, and tempo defaults
-- ============================================================================
DO $$
BEGIN
  -- Movement classification (horizontal_push, vertical_pull, hinge, squat, etc.)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'exercise_library' AND column_name = 'movement_pattern'
  ) THEN
    ALTER TABLE exercise_library ADD COLUMN movement_pattern TEXT;
  END IF;

  -- Compound vs isolation vs isometric vs cardio vs recovery
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'exercise_library' AND column_name = 'ml_exercise_type'
  ) THEN
    ALTER TABLE exercise_library ADD COLUMN ml_exercise_type TEXT
      CHECK (ml_exercise_type IN ('compound', 'isolation', 'isometric', 'cardio', 'recovery'));
  ELSE
    -- Update CHECK constraint if column already exists with old constraint
    ALTER TABLE exercise_library DROP CONSTRAINT IF EXISTS exercise_library_ml_exercise_type_check;
    ALTER TABLE exercise_library ADD CONSTRAINT exercise_library_ml_exercise_type_check
      CHECK (ml_exercise_type IN ('compound', 'isolation', 'isometric', 'cardio', 'recovery'));
  END IF;

  -- Push vs pull vs static vs dynamic
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'exercise_library' AND column_name = 'force_type'
  ) THEN
    ALTER TABLE exercise_library ADD COLUMN force_type TEXT
      CHECK (force_type IN ('push', 'pull', 'static', 'dynamic'));
  ELSE
    ALTER TABLE exercise_library DROP CONSTRAINT IF EXISTS exercise_library_force_type_check;
    ALTER TABLE exercise_library ADD CONSTRAINT exercise_library_force_type_check
      CHECK (force_type IN ('push', 'pull', 'static', 'dynamic'));
  END IF;

  -- Difficulty level
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'exercise_library' AND column_name = 'difficulty'
  ) THEN
    ALTER TABLE exercise_library ADD COLUMN difficulty TEXT
      CHECK (difficulty IN ('beginner', 'intermediate', 'advanced'));
  END IF;

  -- Muscle-head-level arrays from MusclesWorked 63-muscle taxonomy
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'exercise_library' AND column_name = 'primary_muscles'
  ) THEN
    ALTER TABLE exercise_library ADD COLUMN primary_muscles TEXT[];
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'exercise_library' AND column_name = 'secondary_muscles'
  ) THEN
    ALTER TABLE exercise_library ADD COLUMN secondary_muscles TEXT[];
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'exercise_library' AND column_name = 'stabilizer_muscles'
  ) THEN
    ALTER TABLE exercise_library ADD COLUMN stabilizer_muscles TEXT[];
  END IF;

  -- Default tempo prescription: "eccentric-pause-concentric" in seconds, e.g. "3-1-2"
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'exercise_library' AND column_name = 'default_tempo'
  ) THEN
    ALTER TABLE exercise_library ADD COLUMN default_tempo TEXT;
  END IF;

  -- MusclesWorked API exercise ID for traceability
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'exercise_library' AND column_name = 'musclesworked_id'
  ) THEN
    ALTER TABLE exercise_library ADD COLUMN musclesworked_id TEXT;
  END IF;

  -- Functional description: what makes this exercise unique at the muscle-head level
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'exercise_library' AND column_name = 'functional_description'
  ) THEN
    ALTER TABLE exercise_library ADD COLUMN functional_description TEXT;
  END IF;
END $$;

-- ============================================================================
-- 2. WORKOUT SETS - TEMPO TRACKING
-- Adds per-set tempo fields and a timestamp for rest-time inference
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'workout_sets') THEN
    -- Eccentric (lowering) phase in seconds
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'workout_sets' AND column_name = 'tempo_eccentric_sec'
    ) THEN
      ALTER TABLE workout_sets ADD COLUMN tempo_eccentric_sec NUMERIC;
    END IF;

    -- Pause/transition phase in seconds
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'workout_sets' AND column_name = 'tempo_pause_sec'
    ) THEN
      ALTER TABLE workout_sets ADD COLUMN tempo_pause_sec NUMERIC;
    END IF;

    -- Concentric (lifting) phase in seconds
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'workout_sets' AND column_name = 'tempo_concentric_sec'
    ) THEN
      ALTER TABLE workout_sets ADD COLUMN tempo_concentric_sec NUMERIC;
    END IF;

    -- Timestamp of when each set was logged (enables rest time calculation between sets)
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'workout_sets' AND column_name = 'logged_at'
    ) THEN
      ALTER TABLE workout_sets ADD COLUMN logged_at TIMESTAMPTZ DEFAULT NOW();
    END IF;
  END IF;
END $$;

-- ============================================================================
-- 3. USER PREFERENCES - TRAINING PROFILE
-- Adds fields needed for intelligent workout generation
-- ============================================================================
DO $$
BEGIN
  -- Injuries: [{body_part, description, severity, date_added}]
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_preferences' AND column_name = 'injuries'
  ) THEN
    ALTER TABLE user_preferences ADD COLUMN injuries JSONB DEFAULT '[]'::jsonb;
  END IF;

  -- Job activity level affects recovery capacity
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_preferences' AND column_name = 'job_activity_level'
  ) THEN
    ALTER TABLE user_preferences ADD COLUMN job_activity_level TEXT
      CHECK (job_activity_level IN ('sedentary', 'lightly_active', 'active', 'very_active'));
  END IF;

  -- How many days per week the user can train
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_preferences' AND column_name = 'available_days_per_week'
  ) THEN
    ALTER TABLE user_preferences ADD COLUMN available_days_per_week INTEGER;
  END IF;

  -- Specific days if schedule is fixed
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_preferences' AND column_name = 'available_days'
  ) THEN
    ALTER TABLE user_preferences ADD COLUMN available_days TEXT[];
  END IF;

  -- Primary training goal
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_preferences' AND column_name = 'training_goal'
  ) THEN
    ALTER TABLE user_preferences ADD COLUMN training_goal TEXT
      CHECK (training_goal IN ('strength', 'hypertrophy', 'general_fitness', 'fat_loss'));
  END IF;

  -- Target session duration in minutes
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_preferences' AND column_name = 'session_duration_minutes'
  ) THEN
    ALTER TABLE user_preferences ADD COLUMN session_duration_minutes INTEGER;
  END IF;

  -- Equipment availability
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_preferences' AND column_name = 'equipment_access'
  ) THEN
    ALTER TABLE user_preferences ADD COLUMN equipment_access TEXT
      CHECK (equipment_access IN ('full_gym', 'home_gym', 'limited'));
  END IF;

  -- Exercises the user never wants prescribed
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_preferences' AND column_name = 'exercises_to_avoid'
  ) THEN
    ALTER TABLE user_preferences ADD COLUMN exercises_to_avoid TEXT[];
  END IF;

  -- Performance goals: [{exercise, targetWeight, targetReps}]
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_preferences' AND column_name = 'performance_goals'
  ) THEN
    ALTER TABLE user_preferences ADD COLUMN performance_goals JSONB DEFAULT '[]'::jsonb;
  END IF;

  -- Preferred training split (overrides auto-detection)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_preferences' AND column_name = 'preferred_split'
  ) THEN
    ALTER TABLE user_preferences ADD COLUMN preferred_split TEXT;
  END IF;

  -- Body weight for relative strength calculations
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_preferences' AND column_name = 'body_weight_lbs'
  ) THEN
    ALTER TABLE user_preferences ADD COLUMN body_weight_lbs NUMERIC;
  END IF;

  -- Experience level for volume/intensity calibration
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_preferences' AND column_name = 'experience_level'
  ) THEN
    ALTER TABLE user_preferences ADD COLUMN experience_level TEXT;
  END IF;

  -- Cardio preference (daily, most_days, few_days, minimal, none)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_preferences' AND column_name = 'cardio_preference'
  ) THEN
    ALTER TABLE user_preferences ADD COLUMN cardio_preference TEXT;
  END IF;

  -- Cardio frequency (sessions per week)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_preferences' AND column_name = 'cardio_frequency_per_week'
  ) THEN
    ALTER TABLE user_preferences ADD COLUMN cardio_frequency_per_week INTEGER;
  END IF;

  -- Cardio duration (minutes per session)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_preferences' AND column_name = 'cardio_duration_minutes'
  ) THEN
    ALTER TABLE user_preferences ADD COLUMN cardio_duration_minutes INTEGER;
  END IF;

  -- Preferred exercises (always include these)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_preferences' AND column_name = 'preferred_exercises'
  ) THEN
    ALTER TABLE user_preferences ADD COLUMN preferred_exercises TEXT[];
  END IF;
END $$;

-- ============================================================================
-- 4. WORKOUTS - FEEDBACK LOOP
-- Links generated workouts to actual logged workouts for prescribed vs actual comparison
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'workouts') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'workouts' AND column_name = 'generated_workout_id'
    ) THEN
      ALTER TABLE workouts ADD COLUMN generated_workout_id TEXT;
    END IF;
  END IF;
END $$;

-- ============================================================================
-- 5. GENERATED WORKOUTS TABLE
-- Stores ML-generated workout prescriptions for comparison with actuals
-- ============================================================================
CREATE TABLE IF NOT EXISTS generated_workouts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  training_goal TEXT,
  session_duration_minutes INTEGER,
  recovery_status JSONB,
  exercises JSONB NOT NULL,
  rationale TEXT,
  adjustments JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_generated_workouts_user_date
  ON generated_workouts(user_id, date);

ALTER TABLE generated_workouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own generated_workouts" ON generated_workouts;
CREATE POLICY "Users can view own generated_workouts" ON generated_workouts
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own generated_workouts" ON generated_workouts;
CREATE POLICY "Users can insert own generated_workouts" ON generated_workouts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own generated_workouts" ON generated_workouts;
CREATE POLICY "Users can delete own generated_workouts" ON generated_workouts
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================================================
-- MIGRATION COMPLETE
-- Summary:
--   exercise_library: +10 columns (movement_pattern, ml_exercise_type, force_type,
--     difficulty, primary_muscles, secondary_muscles, stabilizer_muscles,
--     default_tempo, musclesworked_id, functional_description)
--   workout_sets: +4 columns (tempo_eccentric_sec, tempo_pause_sec,
--     tempo_concentric_sec, logged_at)
--   user_preferences: +8 columns (injuries, job_activity_level,
--     available_days_per_week, available_days, training_goal,
--     session_duration_minutes, equipment_access, exercises_to_avoid)
--   workouts: +1 column (generated_workout_id)
--   generated_workouts: new table
-- Renames: Stair Climber -> StairMaster (exercise_library + workout_exercises)
-- No existing data was deleted.
-- ============================================================================

-- ============================================================================
-- EXERCISE LIBRARY: Rename Stair Climber -> StairMaster
-- Matches the canonical name used in user templates and workout history.
-- Also updates workout_exercises.exercise_name for consistency.
-- ============================================================================
UPDATE public.exercise_library
  SET name = 'StairMaster',
      description = 'StairMaster revolving staircase machine. Uses levels 1-20.',
      equipment = array['stairmaster']
  WHERE name = 'Stair Climber' AND is_custom = false;

UPDATE public.exercise_library
  SET name = 'StairMaster Intervals',
      description = 'Interval protocol alternating levels on StairMaster.',
      equipment = array['stairmaster']
  WHERE name = 'Stair Climber Intervals' AND is_custom = false;

UPDATE public.workout_exercises
  SET exercise_name = 'StairMaster'
  WHERE exercise_name = 'Stair Climber';

UPDATE public.workout_exercises
  SET exercise_name = 'StairMaster Intervals'
  WHERE exercise_name = 'Stair Climber Intervals';

-- Recovery speed & weight goal columns
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_preferences' AND column_name = 'recovery_speed') THEN
    ALTER TABLE user_preferences ADD COLUMN recovery_speed NUMERIC;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_preferences' AND column_name = 'weight_goal_lbs') THEN
    ALTER TABLE user_preferences ADD COLUMN weight_goal_lbs NUMERIC;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_preferences' AND column_name = 'weight_goal_date') THEN
    ALTER TABLE user_preferences ADD COLUMN weight_goal_date DATE;
  END IF;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- Workout Prescription Engine v2 — New user_preferences columns
-- All additive ALTER TABLE ADD COLUMN IF NOT EXISTS — safe for existing data
-- ══════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  -- Stacked goals: primary + secondary
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_preferences' AND column_name = 'primary_goal') THEN
    ALTER TABLE user_preferences ADD COLUMN primary_goal TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_preferences' AND column_name = 'secondary_goal') THEN
    ALTER TABLE user_preferences ADD COLUMN secondary_goal TEXT;
  END IF;

  -- Priority muscle groups (JSONB array of strings)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_preferences' AND column_name = 'priority_muscles') THEN
    ALTER TABLE user_preferences ADD COLUMN priority_muscles JSONB DEFAULT '[]'::jsonb;
  END IF;

  -- Weekday deadlines: {dayOfWeek: "HH:MM"} e.g. {"1": "07:30", "2": "07:30"}
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_preferences' AND column_name = 'weekday_deadlines') THEN
    ALTER TABLE user_preferences ADD COLUMN weekday_deadlines JSONB DEFAULT '{}'::jsonb;
  END IF;

  -- Gym profiles: array of {name, equipment[]}
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_preferences' AND column_name = 'gym_profiles') THEN
    ALTER TABLE user_preferences ADD COLUMN gym_profiles JSONB DEFAULT '[]'::jsonb;
  END IF;

  -- Active gym profile name
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_preferences' AND column_name = 'active_gym_profile') THEN
    ALTER TABLE user_preferences ADD COLUMN active_gym_profile TEXT;
  END IF;

  -- Age (integer, for max HR estimation)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_preferences' AND column_name = 'age') THEN
    ALTER TABLE user_preferences ADD COLUMN age INTEGER;
  END IF;

  -- Session RPE on workouts table
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'workouts' AND column_name = 'session_rpe') THEN
    ALTER TABLE workouts ADD COLUMN session_rpe NUMERIC;
  END IF;

  -- Training density on workouts table
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'workouts' AND column_name = 'training_density') THEN
    ALTER TABLE workouts ADD COLUMN training_density NUMERIC;
  END IF;

  -- Per-workout HR data
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'workouts' AND column_name = 'workout_avg_hr') THEN
    ALTER TABLE workouts ADD COLUMN workout_avg_hr NUMERIC;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'workouts' AND column_name = 'workout_peak_hr') THEN
    ALTER TABLE workouts ADD COLUMN workout_peak_hr NUMERIC;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'workouts' AND column_name = 'workout_hr_zones') THEN
    ALTER TABLE workouts ADD COLUMN workout_hr_zones JSONB;
  END IF;

  -- Workout timestamps for intraday Fitbit slicing
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'workouts' AND column_name = 'workout_start_time') THEN
    ALTER TABLE workouts ADD COLUMN workout_start_time TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'workouts' AND column_name = 'workout_end_time') THEN
    ALTER TABLE workouts ADD COLUMN workout_end_time TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'workouts' AND column_name = 'workout_active_minutes') THEN
    ALTER TABLE workouts ADD COLUMN workout_active_minutes INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'workouts' AND column_name = 'workout_hr_timeline') THEN
    ALTER TABLE workouts ADD COLUMN workout_hr_timeline JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'workouts' AND column_name = 'workout_calories_burned') THEN
    ALTER TABLE workouts ADD COLUMN workout_calories_burned NUMERIC;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'workouts' AND column_name = 'workout_steps') THEN
    ALTER TABLE workouts ADD COLUMN workout_steps INTEGER;
  END IF;

  -- Intraday HR storage on health_metrics
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'health_metrics' AND column_name = 'hr_zones_minutes') THEN
    ALTER TABLE health_metrics ADD COLUMN hr_zones_minutes JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'health_metrics' AND column_name = 'max_heart_rate') THEN
    ALTER TABLE health_metrics ADD COLUMN max_heart_rate INTEGER;
  END IF;

  -- Rest days configuration (array of day-of-week integers, 0=Sunday..6=Saturday)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_preferences' AND column_name = 'rest_days') THEN
    ALTER TABLE user_preferences ADD COLUMN rest_days JSONB DEFAULT '[]'::jsonb;
  END IF;

  -- Fitbit wearable extended metrics on health_metrics
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'health_metrics' AND column_name = 'active_minutes_fairly') THEN
    ALTER TABLE health_metrics ADD COLUMN active_minutes_fairly INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'health_metrics' AND column_name = 'active_minutes_very') THEN
    ALTER TABLE health_metrics ADD COLUMN active_minutes_very INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'health_metrics' AND column_name = 'active_minutes_lightly') THEN
    ALTER TABLE health_metrics ADD COLUMN active_minutes_lightly INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'health_metrics' AND column_name = 'sedentary_minutes') THEN
    ALTER TABLE health_metrics ADD COLUMN sedentary_minutes INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'health_metrics' AND column_name = 'floors') THEN
    ALTER TABLE health_metrics ADD COLUMN floors INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'health_metrics' AND column_name = 'distance') THEN
    ALTER TABLE health_metrics ADD COLUMN distance NUMERIC;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'health_metrics' AND column_name = 'average_heart_rate') THEN
    ALTER TABLE health_metrics ADD COLUMN average_heart_rate INTEGER;
  END IF;

  -- Sport focus columns
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_preferences' AND column_name = 'sport_focus') THEN
    ALTER TABLE user_preferences ADD COLUMN sport_focus TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_preferences' AND column_name = 'sport_season') THEN
    ALTER TABLE user_preferences ADD COLUMN sport_season TEXT;
  END IF;
END $$;

-- Exercise swap tracking for ML swap learning
CREATE TABLE IF NOT EXISTS exercise_swaps (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  exercise_name TEXT NOT NULL,
  swap_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exercise_swaps_user ON exercise_swaps(user_id);
CREATE INDEX IF NOT EXISTS idx_exercise_swaps_exercise ON exercise_swaps(user_id, exercise_name);

ALTER TABLE exercise_swaps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_own_swaps" ON exercise_swaps;
CREATE POLICY "users_own_swaps" ON exercise_swaps
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Sport-specific training preferences
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_preferences' AND column_name = 'sport_focus') THEN
    ALTER TABLE user_preferences ADD COLUMN sport_focus TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_preferences' AND column_name = 'sport_season') THEN
    ALTER TABLE user_preferences ADD COLUMN sport_season TEXT;
  END IF;
END $$;

-- ============================================================================
-- EXERCISE LIBRARY: Stimulus-to-Fatigue Ratio + Biomechanical Notes
-- ============================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'exercise_library' AND column_name = 'stimulus_to_fatigue_ratio') THEN
    ALTER TABLE exercise_library ADD COLUMN stimulus_to_fatigue_ratio NUMERIC;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'exercise_library' AND column_name = 'biomechanical_notes') THEN
    ALTER TABLE exercise_library ADD COLUMN biomechanical_notes TEXT;
  END IF;
END $$;

-- ============================================================================
-- MODEL FEEDBACK TABLE
-- Stores LLM workout review feedback for the engine's learning loop.
-- immediate_correction: applied to current workout before display
-- pattern_observation: stored and read by computeTrainingProfile for future workouts
-- ============================================================================
CREATE TABLE IF NOT EXISTS model_feedback (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feedback_type TEXT NOT NULL CHECK (feedback_type IN ('immediate_correction', 'pattern_observation')),
  feedback_data JSONB NOT NULL,
  applied BOOLEAN DEFAULT false,
  workout_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Feedback provenance fields (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'model_feedback' AND column_name = 'feedback_source'
  ) THEN
    ALTER TABLE model_feedback ADD COLUMN feedback_source TEXT
      CHECK (feedback_source IN ('human', 'model_review', 'system_rule'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'model_feedback' AND column_name = 'feedback_quality'
  ) THEN
    ALTER TABLE model_feedback ADD COLUMN feedback_quality TEXT
      CHECK (feedback_quality IN ('unverified', 'verified', 'trusted'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'model_feedback' AND column_name = 'verified_by_user'
  ) THEN
    ALTER TABLE model_feedback ADD COLUMN verified_by_user BOOLEAN DEFAULT false;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_model_feedback_user
  ON model_feedback(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_model_feedback_type
  ON model_feedback(user_id, feedback_type, created_at DESC);

ALTER TABLE model_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own model_feedback" ON model_feedback;
CREATE POLICY "Users can view own model_feedback" ON model_feedback
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own model_feedback" ON model_feedback;
CREATE POLICY "Users can insert own model_feedback" ON model_feedback
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own model_feedback" ON model_feedback;
CREATE POLICY "Users can update own model_feedback" ON model_feedback
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own model_feedback" ON model_feedback;
CREATE POLICY "Users can delete own model_feedback" ON model_feedback
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================================================
-- WORKOUT OUTCOMES TABLE
-- Minimal post-session labels linked to generated workout prescriptions.
-- ============================================================================
CREATE TABLE IF NOT EXISTS workout_outcomes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  generated_workout_id UUID REFERENCES generated_workouts(id) ON DELETE SET NULL,
  workout_date DATE NOT NULL DEFAULT CURRENT_DATE,
  session_outcome_score NUMERIC CHECK (session_outcome_score >= 0 AND session_outcome_score <= 1),
  outcome_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workout_outcomes_user_date
  ON workout_outcomes(user_id, workout_date DESC);

CREATE INDEX IF NOT EXISTS idx_workout_outcomes_generated
  ON workout_outcomes(generated_workout_id);

ALTER TABLE workout_outcomes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own workout_outcomes" ON workout_outcomes;
CREATE POLICY "Users can view own workout_outcomes" ON workout_outcomes
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own workout_outcomes" ON workout_outcomes;
CREATE POLICY "Users can insert own workout_outcomes" ON workout_outcomes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own workout_outcomes" ON workout_outcomes;
CREATE POLICY "Users can update own workout_outcomes" ON workout_outcomes
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own workout_outcomes" ON workout_outcomes;
CREATE POLICY "Users can delete own workout_outcomes" ON workout_outcomes
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================================================
-- PRESCRIPTION EXECUTION EVENTS
-- Set-level target-vs-actual labels for high-fidelity model training.
-- ============================================================================
CREATE TABLE IF NOT EXISTS prescription_execution_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workout_id UUID REFERENCES workouts(id) ON DELETE CASCADE,
  workout_exercise_id UUID REFERENCES workout_exercises(id) ON DELETE CASCADE,
  generated_workout_id UUID REFERENCES generated_workouts(id) ON DELETE SET NULL,
  workout_date DATE NOT NULL DEFAULT CURRENT_DATE,
  exercise_name TEXT,
  set_number INTEGER NOT NULL,
  target_weight NUMERIC,
  actual_weight NUMERIC,
  target_reps INTEGER,
  actual_reps INTEGER,
  target_time_seconds NUMERIC,
  actual_time_seconds NUMERIC,
  target_rir NUMERIC,
  actual_rir NUMERIC,
  execution_accuracy NUMERIC CHECK (execution_accuracy >= 0 AND execution_accuracy <= 1),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prescription_exec_user_date
  ON prescription_execution_events(user_id, workout_date DESC);

CREATE INDEX IF NOT EXISTS idx_prescription_exec_generated
  ON prescription_execution_events(generated_workout_id, set_number);

ALTER TABLE prescription_execution_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own prescription_execution_events" ON prescription_execution_events;
CREATE POLICY "Users can view own prescription_execution_events" ON prescription_execution_events
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own prescription_execution_events" ON prescription_execution_events;
CREATE POLICY "Users can insert own prescription_execution_events" ON prescription_execution_events
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own prescription_execution_events" ON prescription_execution_events;
CREATE POLICY "Users can update own prescription_execution_events" ON prescription_execution_events
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own prescription_execution_events" ON prescription_execution_events;
CREATE POLICY "Users can delete own prescription_execution_events" ON prescription_execution_events
  FOR DELETE USING (auth.uid() = user_id);
