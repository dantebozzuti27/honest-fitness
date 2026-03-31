-- ============================================================================
-- HONEST FITNESS — Consolidated RDS Schema v1
-- Target: AWS RDS PostgreSQL 16 (us-east-1)
-- Source: supabase_run_all.sql + 6 migration files
-- Changes from Supabase:
--   - auth.users(id) replaced with local users table
--   - All RLS policies removed (enforced at application layer)
--   - Supabase Storage blocks removed
--   - auth.uid() references removed
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================================================
-- USERS TABLE (replaces Supabase auth.users)
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  cognito_sub TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- HEALTH METRICS
-- ============================================================================
CREATE TABLE IF NOT EXISTS health_metrics (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  resting_heart_rate NUMERIC,
  hrv NUMERIC,
  body_temp NUMERIC,
  sleep_score NUMERIC,
  sleep_duration NUMERIC,
  deep_sleep NUMERIC,
  rem_sleep NUMERIC,
  light_sleep NUMERIC,
  calories_burned NUMERIC,
  steps INTEGER,
  breathing_rate NUMERIC,
  spo2 NUMERIC,
  strain NUMERIC,
  weight NUMERIC,
  body_fat_percentage NUMERIC,
  meals JSONB,
  macros JSONB,
  micros JSONB,
  water NUMERIC DEFAULT 0,
  calories_consumed NUMERIC,
  source_provider TEXT,
  source_data JSONB,
  hr_zones_minutes JSONB,
  max_heart_rate INTEGER,
  active_minutes_fairly INTEGER,
  active_minutes_very INTEGER,
  active_minutes_lightly INTEGER,
  sedentary_minutes INTEGER,
  floors INTEGER,
  distance NUMERIC,
  average_heart_rate INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_health_metrics_user_date ON health_metrics(user_id, date);
CREATE INDEX IF NOT EXISTS idx_health_metrics_date ON health_metrics(date);
CREATE INDEX IF NOT EXISTS idx_health_metrics_source ON health_metrics(source_provider);

-- ============================================================================
-- USER PREFERENCES
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_preferences (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date_of_birth DATE,
  gender TEXT CHECK (gender IN ('male', 'female', 'other', 'prefer_not_to_say')),
  height_inches NUMERIC,
  height_feet INTEGER,
  training_split TEXT,
  progression_model TEXT,
  weekly_sets_targets JSONB NOT NULL DEFAULT '{}'::jsonb,
  injuries JSONB DEFAULT '[]'::jsonb,
  job_activity_level TEXT CHECK (job_activity_level IN ('sedentary', 'lightly_active', 'active', 'very_active')),
  available_days_per_week INTEGER,
  available_days TEXT[],
  training_goal TEXT CHECK (training_goal IN ('strength', 'hypertrophy', 'general_fitness', 'fat_loss')),
  session_duration_minutes INTEGER,
  equipment_access TEXT CHECK (equipment_access IN ('full_gym', 'home_gym', 'limited')),
  exercises_to_avoid TEXT[],
  performance_goals JSONB DEFAULT '[]'::jsonb,
  preferred_split TEXT,
  body_weight_lbs NUMERIC,
  experience_level TEXT,
  cardio_preference TEXT,
  cardio_frequency_per_week INTEGER,
  cardio_duration_minutes INTEGER,
  preferred_exercises TEXT[],
  recovery_speed NUMERIC,
  weight_goal_lbs NUMERIC,
  weight_goal_date DATE,
  primary_goal TEXT,
  secondary_goal TEXT,
  priority_muscles JSONB DEFAULT '[]'::jsonb,
  weekday_deadlines JSONB DEFAULT '{}'::jsonb,
  gym_profiles JSONB DEFAULT '[]'::jsonb,
  active_gym_profile TEXT,
  age INTEGER,
  rest_days JSONB DEFAULT '[]'::jsonb,
  sport_focus TEXT,
  sport_season TEXT,
  default_visibility TEXT NOT NULL DEFAULT 'public' CHECK (default_visibility IN ('public', 'friends', 'private')),
  hotel_mode BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- WORKOUTS + EXERCISES + SETS
-- ============================================================================
CREATE TABLE IF NOT EXISTS workouts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  duration INTEGER,
  template_name TEXT,
  perceived_effort NUMERIC,
  notes TEXT,
  session_type TEXT NOT NULL DEFAULT 'workout' CHECK (session_type IN ('workout', 'recovery')),
  generated_workout_id TEXT,
  session_rpe NUMERIC,
  training_density NUMERIC,
  workout_avg_hr NUMERIC,
  workout_peak_hr NUMERIC,
  workout_hr_zones JSONB,
  workout_start_time TIMESTAMPTZ,
  workout_end_time TIMESTAMPTZ,
  workout_active_minutes INTEGER,
  workout_hr_timeline JSONB,
  workout_calories_burned NUMERIC,
  workout_steps INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workouts_user_date ON workouts(user_id, date);
CREATE INDEX IF NOT EXISTS idx_workouts_user_date_session_type ON workouts(user_id, date, session_type);
CREATE INDEX IF NOT EXISTS idx_workouts_generated_workout_id ON workouts(generated_workout_id);

CREATE TABLE IF NOT EXISTS exercise_library (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  body_part TEXT NOT NULL,
  sub_body_parts TEXT[],
  equipment TEXT[],
  is_custom BOOLEAN DEFAULT FALSE,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  description TEXT,
  instructions TEXT,
  movement_pattern TEXT,
  ml_exercise_type TEXT CHECK (ml_exercise_type IN ('compound', 'isolation', 'isometric', 'cardio', 'recovery')),
  force_type TEXT CHECK (force_type IN ('push', 'pull', 'static', 'dynamic')),
  difficulty TEXT CHECK (difficulty IN ('beginner', 'intermediate', 'advanced')),
  primary_muscles TEXT[],
  secondary_muscles TEXT[],
  stabilizer_muscles TEXT[],
  default_tempo TEXT,
  musclesworked_id TEXT,
  functional_description TEXT,
  stimulus_to_fatigue_ratio NUMERIC,
  biomechanical_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exercise_library_category ON exercise_library(category);
CREATE INDEX IF NOT EXISTS idx_exercise_library_body_part ON exercise_library(body_part);
CREATE INDEX IF NOT EXISTS idx_exercise_library_custom ON exercise_library(created_by_user_id) WHERE is_custom = TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_exercise_library_custom_unique ON exercise_library(name, created_by_user_id) WHERE is_custom = TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_exercise_library_system_unique ON exercise_library(name) WHERE is_custom = FALSE;

CREATE TABLE IF NOT EXISTS workout_exercises (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workout_id UUID NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  exercise_name TEXT NOT NULL,
  category TEXT,
  body_part TEXT,
  equipment TEXT,
  exercise_order INTEGER DEFAULT 0,
  exercise_type TEXT CHECK (exercise_type IN ('weightlifting', 'cardio')),
  distance NUMERIC,
  distance_unit TEXT DEFAULT 'km' CHECK (distance_unit IN ('km', 'miles')),
  stacked BOOLEAN DEFAULT FALSE,
  stack_group TEXT,
  exercise_library_id UUID REFERENCES exercise_library(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT workout_exercises_identity_source_chk CHECK (exercise_library_id IS NOT NULL OR exercise_name IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_workout_exercises_library_id ON workout_exercises(exercise_library_id);

CREATE TABLE IF NOT EXISTS workout_sets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workout_exercise_id UUID NOT NULL REFERENCES workout_exercises(id) ON DELETE CASCADE,
  set_number INTEGER,
  weight NUMERIC,
  reps INTEGER,
  time NUMERIC,
  is_bodyweight BOOLEAN DEFAULT FALSE,
  weight_label TEXT,
  tempo_eccentric_sec NUMERIC,
  tempo_pause_sec NUMERIC,
  tempo_concentric_sec NUMERIC,
  logged_at TIMESTAMPTZ DEFAULT NOW(),
  is_unilateral BOOLEAN NOT NULL DEFAULT false,
  load_interpretation TEXT,
  reps_interpretation TEXT,
  set_rpe NUMERIC,
  actual_rir NUMERIC,
  rest_seconds_before INTEGER,
  CONSTRAINT workout_sets_bodyweight_weight_null CHECK (NOT is_bodyweight OR weight IS NULL),
  CONSTRAINT workout_sets_load_interpretation_check CHECK (load_interpretation IS NULL OR load_interpretation IN ('per_hand_per_side', 'total_both_per_side', 'unknown')),
  CONSTRAINT workout_sets_reps_interpretation_check CHECK (reps_interpretation IS NULL OR reps_interpretation IN ('per_side', 'total_reps'))
);

CREATE INDEX IF NOT EXISTS idx_workout_sets_unilateral ON workout_sets(is_unilateral, load_interpretation);

-- ============================================================================
-- GENERATED WORKOUTS + FEEDBACK LOOP
-- ============================================================================
CREATE TABLE IF NOT EXISTS generated_workouts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  training_goal TEXT,
  session_duration_minutes INTEGER,
  recovery_status JSONB,
  exercises JSONB NOT NULL,
  rationale TEXT,
  adjustments JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_generated_workouts_user_date ON generated_workouts(user_id, date);

CREATE TABLE IF NOT EXISTS workout_outcomes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  generated_workout_id UUID REFERENCES generated_workouts(id) ON DELETE SET NULL,
  workout_date DATE NOT NULL DEFAULT CURRENT_DATE,
  session_outcome_score NUMERIC CHECK (session_outcome_score >= 0 AND session_outcome_score <= 1),
  outcome_notes TEXT,
  idempotency_key TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workout_outcomes_user_date ON workout_outcomes(user_id, workout_date DESC);
CREATE INDEX IF NOT EXISTS idx_workout_outcomes_generated ON workout_outcomes(generated_workout_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workout_outcomes_user_idempotency ON workout_outcomes(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS prescription_execution_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
  idempotency_key TEXT,
  event_id UUID DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prescription_exec_user_date ON prescription_execution_events(user_id, workout_date DESC);
CREATE INDEX IF NOT EXISTS idx_prescription_exec_generated ON prescription_execution_events(generated_workout_id, set_number);
CREATE UNIQUE INDEX IF NOT EXISTS idx_prescription_exec_user_idempotency ON prescription_execution_events(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ============================================================================
-- EXERCISE SWAPS
-- ============================================================================
CREATE TABLE IF NOT EXISTS exercise_swaps (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exercise_name TEXT NOT NULL,
  swap_date DATE NOT NULL DEFAULT CURRENT_DATE,
  replacement_exercise_name TEXT,
  swap_context TEXT NOT NULL DEFAULT 'unknown',
  workout_session_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exercise_swaps_user ON exercise_swaps(user_id);
CREATE INDEX IF NOT EXISTS idx_exercise_swaps_exercise ON exercise_swaps(user_id, exercise_name);
CREATE INDEX IF NOT EXISTS idx_exercise_swaps_user_created ON exercise_swaps(user_id, created_at DESC);

-- ============================================================================
-- MODEL FEEDBACK
-- ============================================================================
CREATE TABLE IF NOT EXISTS model_feedback (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feedback_type TEXT NOT NULL CHECK (feedback_type IN ('immediate_correction', 'pattern_observation')),
  feedback_data JSONB NOT NULL,
  applied BOOLEAN DEFAULT false,
  workout_date DATE,
  feedback_source TEXT CHECK (feedback_source IN ('human', 'model_review', 'system_rule')),
  feedback_quality TEXT CHECK (feedback_quality IN ('unverified', 'verified', 'trusted')),
  verified_by_user BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_model_feedback_user ON model_feedback(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_model_feedback_type ON model_feedback(user_id, feedback_type, created_at DESC);

-- ============================================================================
-- WEEKLY PLANS
-- ============================================================================
CREATE TABLE IF NOT EXISTS weekly_plan_versions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded')),
  feature_snapshot_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_weekly_plan_versions_user_week_status ON weekly_plan_versions(user_id, week_start_date, status);
CREATE INDEX IF NOT EXISTS idx_weekly_plan_versions_user_created ON weekly_plan_versions(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS weekly_plan_days (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  weekly_plan_id UUID NOT NULL REFERENCES weekly_plan_versions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_date DATE NOT NULL,
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  is_rest_day BOOLEAN NOT NULL DEFAULT false,
  focus TEXT,
  muscle_groups JSONB NOT NULL DEFAULT '[]'::jsonb,
  planned_workout JSONB,
  estimated_minutes INTEGER,
  confidence NUMERIC DEFAULT 0.5,
  llm_verdict TEXT CHECK (llm_verdict IN ('pass', 'minor_issues', 'major_issues')),
  llm_corrections JSONB,
  day_status TEXT CHECK (day_status IN ('planned', 'adapted', 'completed', 'skipped')) DEFAULT 'planned',
  actual_workout_id UUID REFERENCES workouts(id) ON DELETE SET NULL,
  actual_workout JSONB,
  last_reconciled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_weekly_plan_days_unique ON weekly_plan_days(weekly_plan_id, plan_date);
CREATE INDEX IF NOT EXISTS idx_weekly_plan_days_user_date ON weekly_plan_days(user_id, plan_date);
CREATE INDEX IF NOT EXISTS idx_weekly_plan_days_actual_workout_id ON weekly_plan_days(actual_workout_id);

CREATE TABLE IF NOT EXISTS weekly_plan_diffs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  weekly_plan_id UUID NOT NULL REFERENCES weekly_plan_versions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_date DATE NOT NULL,
  reason_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
  before_workout JSONB,
  after_workout JSONB,
  diff_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_weekly_plan_diffs_user_date ON weekly_plan_diffs(user_id, plan_date, created_at DESC);

-- Day-state transition trigger (no auth.uid dependency)
CREATE OR REPLACE FUNCTION enforce_weekly_plan_day_state_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.day_status = 'completed' AND NEW.actual_workout_id IS NULL THEN
    RAISE EXCEPTION 'weekly_plan_days: completed state requires actual_workout_id';
  END IF;
  IF NEW.day_status IN ('planned', 'adapted') AND NEW.actual_workout_id IS NOT NULL THEN
    RAISE EXCEPTION 'weekly_plan_days: planned/adapted cannot have actual_workout_id';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.day_status = 'adapted' AND NEW.day_status NOT IN ('adapted', 'completed', 'skipped') THEN
      RAISE EXCEPTION 'weekly_plan_days: invalid transition adapted -> %', NEW.day_status;
    ELSIF OLD.day_status = 'skipped' AND NEW.day_status NOT IN ('skipped', 'planned') THEN
      RAISE EXCEPTION 'weekly_plan_days: invalid transition skipped -> %', NEW.day_status;
    ELSIF OLD.day_status = 'completed' AND NEW.day_status <> 'completed' THEN
      RAISE EXCEPTION 'weekly_plan_days: completed is terminal';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_weekly_plan_day_state_transition ON weekly_plan_days;
CREATE TRIGGER trg_weekly_plan_day_state_transition
BEFORE INSERT OR UPDATE ON weekly_plan_days
FOR EACH ROW EXECUTE FUNCTION enforce_weekly_plan_day_state_transition();

-- ============================================================================
-- CARDIO CAPABILITY PROFILES
-- ============================================================================
CREATE TABLE IF NOT EXISTS cardio_capability_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  modality TEXT NOT NULL,
  max_speed NUMERIC,
  comfortable_speed NUMERIC,
  max_incline NUMERIC,
  preferred_hr_zone_low INTEGER,
  preferred_hr_zone_high INTEGER,
  confidence_score NUMERIC DEFAULT 0.5,
  observed_sessions INTEGER DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, modality)
);

CREATE INDEX IF NOT EXISTS idx_cardio_capability_profiles_user_modality ON cardio_capability_profiles(user_id, modality);

-- ============================================================================
-- CARDIO SET FEEDBACK
-- ============================================================================
CREATE TABLE IF NOT EXISTS cardio_set_feedback (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workout_id UUID,
  exercise_name TEXT NOT NULL,
  target_hr_min INT,
  target_hr_max INT,
  perceived_effort INT CHECK (perceived_effort IS NULL OR (perceived_effort >= 1 AND perceived_effort <= 10)),
  avg_hr_observed INT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cardio_set_feedback_user ON cardio_set_feedback(user_id, created_at DESC);

-- ============================================================================
-- SET TRANSFORMATION AUDIT
-- ============================================================================
CREATE TABLE IF NOT EXISTS set_transformation_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workout_set_id UUID,
  workout_id UUID,
  exercise_name TEXT,
  original_weight NUMERIC,
  transformed_weight NUMERIC,
  original_load_interpretation TEXT,
  transformed_load_interpretation TEXT,
  reason TEXT NOT NULL,
  confidence NUMERIC,
  batch_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_set_transformation_audit_user_created ON set_transformation_audit(user_id, created_at DESC);

-- ============================================================================
-- MODEL INTEGRATION V3 TABLES
-- ============================================================================
CREATE TABLE IF NOT EXISTS nutrition_adherence_daily_snapshots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  target_calories NUMERIC,
  actual_calories NUMERIC,
  target_protein_g NUMERIC,
  actual_protein_g NUMERIC,
  target_carbs_g NUMERIC,
  actual_carbs_g NUMERIC,
  target_fat_g NUMERIC,
  actual_fat_g NUMERIC,
  calorie_adherence_score NUMERIC CHECK (calorie_adherence_score >= 0 AND calorie_adherence_score <= 1),
  macro_adherence_score NUMERIC CHECK (macro_adherence_score >= 0 AND macro_adherence_score <= 1),
  source TEXT DEFAULT 'derived' CHECK (source IN ('manual', 'derived', 'imported')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_nutrition_snapshots_user_date ON nutrition_adherence_daily_snapshots(user_id, snapshot_date DESC);

CREATE TABLE IF NOT EXISTS decision_provenance_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_date DATE NOT NULL DEFAULT CURRENT_DATE,
  source_type TEXT NOT NULL CHECK (source_type IN ('observed', 'inferred', 'policy', 'learned')),
  decision_stage TEXT NOT NULL,
  decision_key TEXT NOT NULL,
  decision_value JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence NUMERIC CHECK (confidence >= 0 AND confidence <= 1),
  generated_workout_id UUID REFERENCES generated_workouts(id) ON DELETE SET NULL,
  weekly_plan_id UUID REFERENCES weekly_plan_versions(id) ON DELETE SET NULL,
  model_version TEXT,
  policy_version TEXT,
  trace_id UUID DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_provenance_user_date ON decision_provenance_events(user_id, event_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_provenance_workout ON decision_provenance_events(generated_workout_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_provenance_trace ON decision_provenance_events(trace_id, created_at ASC);

CREATE TABLE IF NOT EXISTS intervention_episodes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  episode_key TEXT NOT NULL,
  started_on DATE NOT NULL,
  ended_on DATE,
  goal_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  active_policy_params JSONB NOT NULL DEFAULT '{}'::jsonb,
  safety_bounds JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'aborted')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, episode_key)
);

CREATE INDEX IF NOT EXISTS idx_intervention_episodes_user_started ON intervention_episodes(user_id, started_on DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS intervention_episode_outcomes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  intervention_episode_id UUID NOT NULL REFERENCES intervention_episodes(id) ON DELETE CASCADE,
  measured_on DATE NOT NULL,
  adherence_score NUMERIC CHECK (adherence_score >= 0 AND adherence_score <= 1),
  readiness_delta NUMERIC,
  strength_delta NUMERIC,
  weight_trend_delta NUMERIC,
  objective_score NUMERIC,
  regret_score NUMERIC,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (intervention_episode_id, measured_on)
);

CREATE INDEX IF NOT EXISTS idx_intervention_episode_outcomes_user_date ON intervention_episode_outcomes(user_id, measured_on DESC);

CREATE TABLE IF NOT EXISTS replay_scenarios (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scenario_name TEXT NOT NULL,
  baseline_policy_version TEXT NOT NULL,
  candidate_policy_version TEXT NOT NULL,
  date_start DATE NOT NULL,
  date_end DATE NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_replay_scenarios_user_created ON replay_scenarios(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS replay_results (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  replay_scenario_id UUID NOT NULL REFERENCES replay_scenarios(id) ON DELETE CASCADE,
  workout_date DATE,
  baseline_score NUMERIC,
  candidate_score NUMERIC,
  regret_delta NUMERIC,
  promoted BOOLEAN DEFAULT false,
  result_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_replay_results_scenario_date ON replay_results(replay_scenario_id, workout_date DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS llm_validation_artifacts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  generated_workout_id UUID REFERENCES generated_workouts(id) ON DELETE SET NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('pass', 'minor_issues', 'major_issues')),
  rejection_classes JSONB NOT NULL DEFAULT '[]'::jsonb,
  rationale TEXT,
  immediate_corrections JSONB NOT NULL DEFAULT '[]'::jsonb,
  pattern_observations JSONB NOT NULL DEFAULT '[]'::jsonb,
  schema_version TEXT NOT NULL,
  model_version TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_llm_validation_artifacts_user_created ON llm_validation_artifacts(user_id, created_at DESC);

-- ============================================================================
-- SOCIAL / FEED / FRIENDS
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username TEXT,
  phone_number TEXT,
  display_name TEXT,
  bio TEXT,
  profile_picture TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_username ON user_profiles(username) WHERE username IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_profiles_phone ON user_profiles(phone_number) WHERE phone_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_profiles_search ON user_profiles(username, display_name) WHERE username IS NOT NULL OR display_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_profiles_username_trgm ON user_profiles USING gin(username gin_trgm_ops) WHERE username IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_profiles_display_name_trgm ON user_profiles USING gin(display_name gin_trgm_ops) WHERE display_name IS NOT NULL;

CREATE TABLE IF NOT EXISTS friends (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'blocked')),
  requested_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_friendship UNIQUE (user_id, friend_id)
);

CREATE INDEX IF NOT EXISTS idx_friends_user_status ON friends(user_id, status) WHERE status IN ('accepted', 'pending');
CREATE INDEX IF NOT EXISTS idx_friends_friend_status ON friends(friend_id, status) WHERE status IN ('accepted', 'pending');
CREATE INDEX IF NOT EXISTS idx_friends_bidirectional ON friends(user_id, friend_id, status);

CREATE TABLE IF NOT EXISTS feed_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('workout', 'nutrition', 'health')),
  date DATE NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT,
  data JSONB NOT NULL,
  shared BOOLEAN DEFAULT true,
  visibility TEXT DEFAULT 'public' CHECK (visibility IN ('public', 'friends', 'private')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_feed_item UNIQUE (user_id, date, type)
);

CREATE INDEX IF NOT EXISTS idx_feed_items_user_id ON feed_items(user_id);
CREATE INDEX IF NOT EXISTS idx_feed_items_date ON feed_items(date);
CREATE INDEX IF NOT EXISTS idx_feed_items_created_at ON feed_items(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feed_items_type ON feed_items(type);
CREATE INDEX IF NOT EXISTS idx_feed_items_user_shared_created ON feed_items(user_id, shared, created_at DESC) WHERE shared = true;
CREATE INDEX IF NOT EXISTS idx_feed_items_visibility_created ON feed_items(visibility, created_at DESC) WHERE visibility IN ('public', 'friends') AND shared = true;

-- ============================================================================
-- NUTRITION / FOOD
-- ============================================================================
CREATE TABLE IF NOT EXISTS food_categories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS food_library (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  brand TEXT,
  barcode TEXT,
  category_id UUID REFERENCES food_categories(id),
  calories_per_100g NUMERIC NOT NULL,
  protein_per_100g NUMERIC DEFAULT 0,
  carbs_per_100g NUMERIC DEFAULT 0,
  fat_per_100g NUMERIC DEFAULT 0,
  fiber_per_100g NUMERIC DEFAULT 0,
  sugar_per_100g NUMERIC DEFAULT 0,
  sodium_per_100g NUMERIC DEFAULT 0,
  micros_per_100g JSONB DEFAULT '{}'::jsonb,
  is_custom BOOLEAN DEFAULT FALSE,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  description TEXT,
  name_tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(name, ''))) STORED,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_food_library_category ON food_library(category_id);
CREATE INDEX IF NOT EXISTS idx_food_library_custom ON food_library(created_by_user_id) WHERE is_custom = TRUE;
CREATE INDEX IF NOT EXISTS idx_food_library_name ON food_library(name);
CREATE INDEX IF NOT EXISTS idx_food_library_barcode ON food_library(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_food_library_name_tsv ON food_library USING GIN (name_tsv);
CREATE UNIQUE INDEX IF NOT EXISTS idx_food_library_custom_unique ON food_library(name, created_by_user_id) WHERE is_custom = TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_food_library_system_unique ON food_library(name) WHERE is_custom = FALSE;

CREATE TABLE IF NOT EXISTS user_food_preferences (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  food_id UUID NOT NULL REFERENCES food_library(id) ON DELETE CASCADE,
  is_favorite BOOLEAN DEFAULT FALSE,
  last_used_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, food_id)
);

CREATE INDEX IF NOT EXISTS idx_user_food_prefs_user ON user_food_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_user_food_prefs_favorite ON user_food_preferences(user_id, is_favorite) WHERE is_favorite = TRUE;
CREATE INDEX IF NOT EXISTS idx_user_food_prefs_recent ON user_food_preferences(user_id, last_used_at DESC);

-- ============================================================================
-- MISC TABLES
-- ============================================================================
CREATE TABLE IF NOT EXISTS paused_workouts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  exercises JSONB NOT NULL,
  workout_time INTEGER DEFAULT 0,
  rest_time INTEGER DEFAULT 0,
  is_resting BOOLEAN DEFAULT false,
  template_id TEXT,
  paused_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_paused_workouts_user_id ON paused_workouts(user_id);
CREATE INDEX IF NOT EXISTS idx_paused_workouts_date ON paused_workouts(date);

CREATE TABLE IF NOT EXISTS scheduled_workouts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  template_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_scheduled_workouts_user_date ON scheduled_workouts(user_id, date);
CREATE INDEX IF NOT EXISTS idx_scheduled_workouts_date ON scheduled_workouts(date);

CREATE TABLE IF NOT EXISTS active_workout_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE TABLE IF NOT EXISTS connected_accounts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('fitbit', 'oura', 'apple')),
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  provider_user_id TEXT,
  scopes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, provider)
);

CREATE TABLE IF NOT EXISTS fitbit_daily (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  steps INTEGER,
  calories NUMERIC,
  active_calories NUMERIC,
  distance NUMERIC,
  floors INTEGER,
  resting_heart_rate NUMERIC,
  hrv NUMERIC,
  body_temp NUMERIC,
  sleep_duration NUMERIC,
  sleep_efficiency NUMERIC,
  average_heart_rate NUMERIC,
  sedentary_minutes INTEGER,
  lightly_active_minutes INTEGER,
  fairly_active_minutes INTEGER,
  very_active_minutes INTEGER,
  marginal_calories NUMERIC,
  weight NUMERIC,
  bmi NUMERIC,
  fat NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, date)
);

CREATE TABLE IF NOT EXISTS goals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT,
  target_value NUMERIC,
  current_value NUMERIC DEFAULT 0,
  is_daily_goal BOOLEAN DEFAULT FALSE,
  daily_achievements JSONB,
  progress_percentage NUMERIC DEFAULT 0 CHECK (progress_percentage >= 0 AND progress_percentage <= 100),
  last_calculated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- COACH MARKETPLACE
-- ============================================================================
CREATE TABLE IF NOT EXISTS coach_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT,
  bio TEXT,
  profile_picture TEXT,
  stripe_account_id TEXT,
  is_verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coach_profiles_display_name ON coach_profiles(display_name);

CREATE TABLE IF NOT EXISTS coach_programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'usd',
  tags TEXT[] NOT NULL DEFAULT '{}',
  preview JSONB NOT NULL DEFAULT '{}'::jsonb,
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coach_programs_coach_id ON coach_programs(coach_id);
CREATE INDEX IF NOT EXISTS idx_coach_programs_status ON coach_programs(status);
CREATE INDEX IF NOT EXISTS idx_coach_programs_published_at ON coach_programs(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_coach_programs_title ON coach_programs USING gin (to_tsvector('english', title));

CREATE TABLE IF NOT EXISTS coach_program_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID NOT NULL REFERENCES coach_programs(id) ON DELETE CASCADE,
  buyer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'refunded', 'canceled')),
  amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'usd',
  provider TEXT NOT NULL DEFAULT 'manual',
  provider_payment_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(program_id, buyer_id)
);

CREATE INDEX IF NOT EXISTS idx_coach_program_purchases_buyer_id ON coach_program_purchases(buyer_id);
CREATE INDEX IF NOT EXISTS idx_coach_program_purchases_program_id ON coach_program_purchases(program_id);

CREATE TABLE IF NOT EXISTS coach_program_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID NOT NULL REFERENCES coach_programs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'enrolled' CHECK (status IN ('enrolled', 'unenrolled')),
  scheduled_count INTEGER NOT NULL DEFAULT 0 CHECK (scheduled_count >= 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(program_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_coach_program_enrollments_program_id ON coach_program_enrollments(program_id);
CREATE INDEX IF NOT EXISTS idx_coach_program_enrollments_user_id ON coach_program_enrollments(user_id);

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================
CREATE OR REPLACE FUNCTION calculate_age(date_of_birth DATE) RETURNS INTEGER AS $$
BEGIN
  IF date_of_birth IS NULL THEN RETURN NULL; END IF;
  RETURN EXTRACT(YEAR FROM AGE(date_of_birth));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION normalize_username(username TEXT) RETURNS TEXT AS $$
BEGIN
  IF username IS NULL THEN RETURN NULL; END IF;
  RETURN LOWER(TRIM(username));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_username_unique ON user_profiles(normalize_username(username)) WHERE username IS NOT NULL AND username != '';

CREATE OR REPLACE FUNCTION normalize_phone(phone TEXT) RETURNS TEXT AS $$
BEGIN
  IF phone IS NULL THEN RETURN NULL; END IF;
  RETURN regexp_replace(phone, '[^0-9]', '', 'g');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_phone_unique ON user_profiles(normalize_phone(phone_number)) WHERE phone_number IS NOT NULL AND phone_number != '';

CREATE OR REPLACE FUNCTION forward_fill_manual_metrics(p_user_id UUID, p_start_date DATE, p_end_date DATE) RETURNS VOID AS $$
DECLARE
  loop_date DATE;
  last_weight NUMERIC := NULL;
  last_body_fat NUMERIC := NULL;
BEGIN
  SELECT weight, body_fat_percentage INTO last_weight, last_body_fat
  FROM health_metrics WHERE user_id = p_user_id AND date < p_start_date AND (weight IS NOT NULL OR body_fat_percentage IS NOT NULL)
  ORDER BY date DESC LIMIT 1;
  loop_date := p_start_date;
  WHILE loop_date <= p_end_date LOOP
    UPDATE health_metrics SET
      weight = COALESCE(weight, last_weight),
      body_fat_percentage = COALESCE(body_fat_percentage, last_body_fat),
      updated_at = CASE WHEN weight IS NULL AND last_weight IS NOT NULL THEN NOW() WHEN body_fat_percentage IS NULL AND last_body_fat IS NOT NULL THEN NOW() ELSE updated_at END
    WHERE user_id = p_user_id AND date = loop_date AND (weight IS NULL OR body_fat_percentage IS NULL);
    SELECT weight, body_fat_percentage INTO last_weight, last_body_fat FROM health_metrics WHERE user_id = p_user_id AND date = loop_date;
    loop_date := loop_date + INTERVAL '1 day';
  END LOOP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trigger_forward_fill_metrics() RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'UPDATE' AND (
    (OLD.weight IS DISTINCT FROM NEW.weight AND NEW.weight IS NOT NULL) OR
    (OLD.body_fat_percentage IS DISTINCT FROM NEW.body_fat_percentage AND NEW.body_fat_percentage IS NOT NULL)
  )) OR (TG_OP = 'INSERT' AND (NEW.weight IS NOT NULL OR NEW.body_fat_percentage IS NOT NULL)) THEN
    PERFORM forward_fill_manual_metrics(NEW.user_id, (NEW.date + INTERVAL '1 day')::DATE, (NEW.date + INTERVAL '30 days')::DATE);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS auto_forward_fill_metrics ON health_metrics;
CREATE TRIGGER auto_forward_fill_metrics
  AFTER INSERT OR UPDATE OF weight, body_fat_percentage ON health_metrics
  FOR EACH ROW EXECUTE FUNCTION trigger_forward_fill_metrics();

CREATE OR REPLACE FUNCTION update_updated_at_column() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_feed_items_updated_at ON feed_items;
CREATE TRIGGER update_feed_items_updated_at BEFORE UPDATE ON feed_items FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION update_user_profiles_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_profiles_updated_at ON user_profiles;
CREATE TRIGGER user_profiles_updated_at BEFORE UPDATE ON user_profiles FOR EACH ROW EXECUTE FUNCTION update_user_profiles_updated_at();

CREATE OR REPLACE FUNCTION update_friends_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS friends_updated_at ON friends;
CREATE TRIGGER friends_updated_at BEFORE UPDATE ON friends FOR EACH ROW EXECUTE FUNCTION update_friends_updated_at();

DROP TRIGGER IF EXISTS update_scheduled_workouts_updated_at ON scheduled_workouts;
CREATE TRIGGER update_scheduled_workouts_updated_at BEFORE UPDATE ON scheduled_workouts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_coach_profiles_updated_at ON coach_profiles;
CREATE TRIGGER update_coach_profiles_updated_at BEFORE UPDATE ON coach_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_coach_programs_updated_at ON coach_programs;
CREATE TRIGGER update_coach_programs_updated_at BEFORE UPDATE ON coach_programs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_coach_program_enrollments_updated_at ON coach_program_enrollments;
CREATE TRIGGER update_coach_program_enrollments_updated_at BEFORE UPDATE ON coach_program_enrollments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION are_friends(user1_id UUID, user2_id UUID) RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM friends WHERE (user_id = user1_id AND friend_id = user2_id AND status = 'accepted') OR (user_id = user2_id AND friend_id = user1_id AND status = 'accepted'));
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION get_friend_ids(user_id_param UUID) RETURNS TABLE(friend_id UUID) AS $$
BEGIN
  RETURN QUERY SELECT CASE WHEN f.user_id = user_id_param THEN f.friend_id ELSE f.user_id END AS friend_id FROM friends f WHERE (f.user_id = user_id_param OR f.friend_id = user_id_param) AND f.status = 'accepted';
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION calculate_goal_progress(p_goal_id UUID) RETURNS VOID AS $$
DECLARE goal_record RECORD; calculated_value NUMERIC := 0; progress_pct NUMERIC;
BEGIN
  SELECT * INTO goal_record FROM goals WHERE id = p_goal_id;
  IF NOT FOUND THEN RETURN; END IF;
  CASE goal_record.type
    WHEN 'weight' THEN SELECT COALESCE(weight, 0) INTO calculated_value FROM health_metrics WHERE user_id = goal_record.user_id AND weight IS NOT NULL ORDER BY date DESC LIMIT 1;
    WHEN 'calories', 'calorie_intake' THEN SELECT COALESCE(calories_consumed, 0) INTO calculated_value FROM health_metrics WHERE user_id = goal_record.user_id AND date = CURRENT_DATE;
    WHEN 'protein', 'carbs', 'fat' THEN SELECT COALESCE((macros->>goal_record.type)::NUMERIC, 0) INTO calculated_value FROM health_metrics WHERE user_id = goal_record.user_id AND date = CURRENT_DATE;
    WHEN 'workouts_per_week' THEN SELECT COALESCE(COUNT(*)::NUMERIC, 0) INTO calculated_value FROM workouts WHERE user_id = goal_record.user_id AND date >= date_trunc('week', CURRENT_DATE)::DATE AND date <= CURRENT_DATE;
    WHEN 'steps' THEN SELECT COALESCE(steps, 0) INTO calculated_value FROM health_metrics WHERE user_id = goal_record.user_id AND date = CURRENT_DATE;
    ELSE calculated_value := COALESCE(goal_record.current_value, 0);
  END CASE;
  IF goal_record.target_value > 0 THEN
    IF goal_record.type IN ('weight') THEN progress_pct := 0; ELSE progress_pct := LEAST(100, (calculated_value / goal_record.target_value) * 100); END IF;
  END IF;
  UPDATE goals SET current_value = calculated_value, progress_percentage = progress_pct, last_calculated_at = NOW() WHERE id = p_goal_id;
  IF goal_record.is_daily_goal THEN
    UPDATE goals SET daily_achievements = COALESCE(daily_achievements, '{}'::jsonb) || jsonb_build_object(CURRENT_DATE::TEXT, (calculated_value >= goal_record.target_value)) WHERE id = p_goal_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- SEED DATA: Food categories
-- ============================================================================
INSERT INTO food_categories (name) VALUES
('meat'), ('dairy'), ('grains'), ('fruits'), ('vegetables'),
('nuts'), ('oils'), ('legumes'), ('seafood'), ('beverages'),
('snacks'), ('desserts'), ('condiments'), ('other')
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- SEED DATA: Exercise Library
-- ============================================================================
INSERT INTO exercise_library (name, category, body_part, sub_body_parts, equipment, is_custom) VALUES
('Squats', 'strength', 'legs', ARRAY['glutes', 'quads', 'hamstrings'], ARRAY['barbell', 'bodyweight'], FALSE),
('Deadlifts', 'strength', 'legs', ARRAY['glutes', 'hamstrings', 'lower_back'], ARRAY['barbell'], FALSE),
('Lunges', 'strength', 'legs', ARRAY['glutes', 'quads'], ARRAY['bodyweight', 'dumbbells'], FALSE),
('Leg Press', 'strength', 'legs', ARRAY['quads', 'glutes'], ARRAY['machine'], FALSE),
('Leg Curls', 'strength', 'legs', ARRAY['hamstrings'], ARRAY['machine'], FALSE),
('Leg Extensions', 'strength', 'legs', ARRAY['quads'], ARRAY['machine'], FALSE),
('Bench Press', 'strength', 'chest', ARRAY['chest', 'triceps', 'shoulders'], ARRAY['barbell', 'dumbbells'], FALSE),
('Push-ups', 'strength', 'chest', ARRAY['chest', 'triceps', 'shoulders'], ARRAY['bodyweight'], FALSE),
('Chest Fly', 'strength', 'chest', ARRAY['chest'], ARRAY['dumbbells', 'machine'], FALSE),
('Pull-ups', 'strength', 'back', ARRAY['lats', 'biceps'], ARRAY['bodyweight', 'pull-up_bar'], FALSE),
('Rows', 'strength', 'back', ARRAY['lats', 'rhomboids', 'biceps'], ARRAY['barbell', 'dumbbells', 'machine'], FALSE),
('Lat Pulldown', 'strength', 'back', ARRAY['lats', 'biceps'], ARRAY['machine'], FALSE),
('Shoulder Press', 'strength', 'shoulders', ARRAY['shoulders', 'triceps'], ARRAY['dumbbells', 'barbell'], FALSE),
('Lateral Raises', 'strength', 'shoulders', ARRAY['shoulders'], ARRAY['dumbbells'], FALSE),
('Bicep Curls', 'strength', 'arms', ARRAY['biceps'], ARRAY['dumbbells', 'barbell'], FALSE),
('Tricep Extensions', 'strength', 'arms', ARRAY['triceps'], ARRAY['dumbbells', 'cable'], FALSE),
('Running', 'cardio', 'cardio', ARRAY['legs', 'cardio'], ARRAY['none'], FALSE),
('Cycling', 'cardio', 'cardio', ARRAY['legs', 'cardio'], ARRAY['bicycle', 'stationary_bike'], FALSE),
('Rowing', 'cardio', 'cardio', ARRAY['full_body', 'cardio'], ARRAY['rowing_machine'], FALSE),
('Elliptical', 'cardio', 'cardio', ARRAY['legs', 'cardio'], ARRAY['elliptical_machine'], FALSE),
('Swimming', 'cardio', 'cardio', ARRAY['full_body', 'cardio'], ARRAY['pool'], FALSE)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- SEED DATA: Food Library (common foods)
-- ============================================================================
INSERT INTO food_library (name, category_id, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, is_custom)
SELECT f.name, fc.id, f.calories, f.protein, f.carbs, f.fat, FALSE
FROM (VALUES
  ('Chicken Breast', 'meat', 165, 31, 0, 3.6), ('Salmon', 'seafood', 208, 20, 0, 12),
  ('Eggs', 'dairy', 155, 13, 1.1, 11), ('Greek Yogurt', 'dairy', 59, 10, 3.6, 0.4),
  ('Brown Rice', 'grains', 111, 2.6, 23, 0.9), ('Quinoa', 'grains', 120, 4.4, 22, 1.9),
  ('Banana', 'fruits', 89, 1.1, 23, 0.3), ('Apple', 'fruits', 52, 0.3, 14, 0.2),
  ('Broccoli', 'vegetables', 34, 2.8, 7, 0.4), ('Spinach', 'vegetables', 23, 2.9, 3.6, 0.4),
  ('Almonds', 'nuts', 579, 21, 22, 50), ('Olive Oil', 'oils', 884, 0, 0, 100),
  ('Turkey Breast', 'meat', 135, 29, 0, 1.5), ('Ground Beef (90% lean)', 'meat', 176, 20, 0, 10),
  ('Oats (rolled)', 'grains', 389, 16.9, 66.3, 6.9), ('White Rice (cooked)', 'grains', 130, 2.4, 28.2, 0.3),
  ('Pasta (cooked)', 'grains', 131, 5, 25, 1.1), ('Bread (whole wheat)', 'grains', 247, 13, 41, 4.2),
  ('Orange', 'fruits', 47, 0.9, 12, 0.1), ('Strawberries', 'fruits', 32, 0.7, 7.7, 0.3),
  ('Blueberries', 'fruits', 57, 0.7, 14, 0.3), ('Sweet Potato', 'vegetables', 86, 1.6, 20, 0.1),
  ('Potatoes', 'vegetables', 77, 2, 17, 0.1), ('Carrots', 'vegetables', 41, 0.9, 10, 0.2),
  ('Tuna (canned in water)', 'seafood', 116, 26, 0, 1), ('Shrimp', 'seafood', 99, 24, 0.2, 0.3),
  ('Peanut Butter', 'nuts', 588, 25, 20, 50), ('Whey Protein Powder', 'dairy', 400, 80, 10, 7),
  ('Cottage Cheese', 'dairy', 98, 11, 3.4, 4.3), ('Milk (whole)', 'dairy', 61, 3.2, 4.8, 3.3),
  ('Tofu (firm)', 'legumes', 144, 17, 3.4, 9), ('Black Beans (cooked)', 'legumes', 132, 8.9, 23.7, 0.5),
  ('Chickpeas (cooked)', 'legumes', 164, 8.9, 27.4, 2.6), ('Lentils (cooked)', 'legumes', 116, 9, 20, 0.4),
  ('Coffee (black)', 'beverages', 1, 0.1, 0, 0), ('Protein Bar', 'snacks', 350, 25, 35, 10)
) AS f(name, category_name, calories, protein, carbs, fat)
JOIN food_categories fc ON fc.name = f.category_name
ON CONFLICT DO NOTHING;

-- ============================================================================
-- SCHEMA COMPLETE
-- ============================================================================
