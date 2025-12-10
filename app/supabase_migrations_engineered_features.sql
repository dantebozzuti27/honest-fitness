-- Engineered Features Storage
-- Stores calculated features for ML models

CREATE TABLE IF NOT EXISTS engineered_features (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature_type TEXT NOT NULL, -- 'rolling_stats', 'ratio_features', 'interaction_features'
  features JSONB NOT NULL,
  calculated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, feature_type)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_engineered_features_user_id ON engineered_features(user_id);
CREATE INDEX IF NOT EXISTS idx_engineered_features_type ON engineered_features(feature_type);
CREATE INDEX IF NOT EXISTS idx_engineered_features_calculated ON engineered_features(calculated_at DESC);

-- Enable RLS
ALTER TABLE engineered_features ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can view own features" ON engineered_features;
DROP POLICY IF EXISTS "Users can insert own features" ON engineered_features;
DROP POLICY IF EXISTS "Users can update own features" ON engineered_features;

CREATE POLICY "Users can view own features" ON engineered_features
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own features" ON engineered_features
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own features" ON engineered_features
  FOR UPDATE USING (auth.uid() = user_id);

