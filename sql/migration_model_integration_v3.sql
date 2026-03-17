-- ============================================================================
-- MODEL INTEGRATION V3
-- Provenance + intervention memory + replay/regret + nutrition adherence
-- ============================================================================

-- Nutrition adherence snapshots (daily control-loop inputs)
CREATE TABLE IF NOT EXISTS nutrition_adherence_daily_snapshots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_nutrition_snapshots_user_date
  ON nutrition_adherence_daily_snapshots(user_id, snapshot_date DESC);

ALTER TABLE nutrition_adherence_daily_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own nutrition_adherence_daily_snapshots" ON nutrition_adherence_daily_snapshots;
CREATE POLICY "Users can view own nutrition_adherence_daily_snapshots" ON nutrition_adherence_daily_snapshots
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own nutrition_adherence_daily_snapshots" ON nutrition_adherence_daily_snapshots;
CREATE POLICY "Users can insert own nutrition_adherence_daily_snapshots" ON nutrition_adherence_daily_snapshots
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own nutrition_adherence_daily_snapshots" ON nutrition_adherence_daily_snapshots;
CREATE POLICY "Users can update own nutrition_adherence_daily_snapshots" ON nutrition_adherence_daily_snapshots
  FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own nutrition_adherence_daily_snapshots" ON nutrition_adherence_daily_snapshots;
CREATE POLICY "Users can delete own nutrition_adherence_daily_snapshots" ON nutrition_adherence_daily_snapshots
  FOR DELETE USING (auth.uid() = user_id);

-- Decision provenance events (Observed/Inferred/Policy/Learned lineage)
CREATE TABLE IF NOT EXISTS decision_provenance_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_provenance_user_date
  ON decision_provenance_events(user_id, event_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_provenance_workout
  ON decision_provenance_events(generated_workout_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_provenance_trace
  ON decision_provenance_events(trace_id, created_at ASC);

ALTER TABLE decision_provenance_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own decision_provenance_events" ON decision_provenance_events;
CREATE POLICY "Users can view own decision_provenance_events" ON decision_provenance_events
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own decision_provenance_events" ON decision_provenance_events;
CREATE POLICY "Users can insert own decision_provenance_events" ON decision_provenance_events
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own decision_provenance_events" ON decision_provenance_events;
CREATE POLICY "Users can update own decision_provenance_events" ON decision_provenance_events
  FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own decision_provenance_events" ON decision_provenance_events;
CREATE POLICY "Users can delete own decision_provenance_events" ON decision_provenance_events
  FOR DELETE USING (auth.uid() = user_id);

-- Intervention episodes (controller memory)
CREATE TABLE IF NOT EXISTS intervention_episodes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_intervention_episodes_user_started
  ON intervention_episodes(user_id, started_on DESC, created_at DESC);

ALTER TABLE intervention_episodes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own intervention_episodes" ON intervention_episodes;
CREATE POLICY "Users can view own intervention_episodes" ON intervention_episodes
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own intervention_episodes" ON intervention_episodes;
CREATE POLICY "Users can insert own intervention_episodes" ON intervention_episodes
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own intervention_episodes" ON intervention_episodes;
CREATE POLICY "Users can update own intervention_episodes" ON intervention_episodes
  FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own intervention_episodes" ON intervention_episodes;
CREATE POLICY "Users can delete own intervention_episodes" ON intervention_episodes
  FOR DELETE USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS intervention_episode_outcomes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_intervention_episode_outcomes_user_date
  ON intervention_episode_outcomes(user_id, measured_on DESC);

ALTER TABLE intervention_episode_outcomes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own intervention_episode_outcomes" ON intervention_episode_outcomes;
CREATE POLICY "Users can view own intervention_episode_outcomes" ON intervention_episode_outcomes
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own intervention_episode_outcomes" ON intervention_episode_outcomes;
CREATE POLICY "Users can insert own intervention_episode_outcomes" ON intervention_episode_outcomes
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own intervention_episode_outcomes" ON intervention_episode_outcomes;
CREATE POLICY "Users can update own intervention_episode_outcomes" ON intervention_episode_outcomes
  FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own intervention_episode_outcomes" ON intervention_episode_outcomes;
CREATE POLICY "Users can delete own intervention_episode_outcomes" ON intervention_episode_outcomes
  FOR DELETE USING (auth.uid() = user_id);

-- Replay / regret analysis tables
CREATE TABLE IF NOT EXISTS replay_scenarios (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scenario_name TEXT NOT NULL,
  baseline_policy_version TEXT NOT NULL,
  candidate_policy_version TEXT NOT NULL,
  date_start DATE NOT NULL,
  date_end DATE NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_replay_scenarios_user_created
  ON replay_scenarios(user_id, created_at DESC);

ALTER TABLE replay_scenarios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own replay_scenarios" ON replay_scenarios;
CREATE POLICY "Users can view own replay_scenarios" ON replay_scenarios
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own replay_scenarios" ON replay_scenarios;
CREATE POLICY "Users can insert own replay_scenarios" ON replay_scenarios
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own replay_scenarios" ON replay_scenarios;
CREATE POLICY "Users can update own replay_scenarios" ON replay_scenarios
  FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own replay_scenarios" ON replay_scenarios;
CREATE POLICY "Users can delete own replay_scenarios" ON replay_scenarios
  FOR DELETE USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS replay_results (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  replay_scenario_id UUID NOT NULL REFERENCES replay_scenarios(id) ON DELETE CASCADE,
  workout_date DATE,
  baseline_score NUMERIC,
  candidate_score NUMERIC,
  regret_delta NUMERIC,
  promoted BOOLEAN DEFAULT false,
  result_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_replay_results_scenario_date
  ON replay_results(replay_scenario_id, workout_date DESC, created_at DESC);

ALTER TABLE replay_results ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own replay_results" ON replay_results;
CREATE POLICY "Users can view own replay_results" ON replay_results
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own replay_results" ON replay_results;
CREATE POLICY "Users can insert own replay_results" ON replay_results
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own replay_results" ON replay_results;
CREATE POLICY "Users can update own replay_results" ON replay_results
  FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own replay_results" ON replay_results;
CREATE POLICY "Users can delete own replay_results" ON replay_results
  FOR DELETE USING (auth.uid() = user_id);

-- LLM validator artifacts (taxonomy + rationale history)
CREATE TABLE IF NOT EXISTS llm_validation_artifacts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_llm_validation_artifacts_user_created
  ON llm_validation_artifacts(user_id, created_at DESC);

ALTER TABLE llm_validation_artifacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own llm_validation_artifacts" ON llm_validation_artifacts;
CREATE POLICY "Users can view own llm_validation_artifacts" ON llm_validation_artifacts
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own llm_validation_artifacts" ON llm_validation_artifacts;
CREATE POLICY "Users can insert own llm_validation_artifacts" ON llm_validation_artifacts
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own llm_validation_artifacts" ON llm_validation_artifacts;
CREATE POLICY "Users can update own llm_validation_artifacts" ON llm_validation_artifacts
  FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own llm_validation_artifacts" ON llm_validation_artifacts;
CREATE POLICY "Users can delete own llm_validation_artifacts" ON llm_validation_artifacts
  FOR DELETE USING (auth.uid() = user_id);
