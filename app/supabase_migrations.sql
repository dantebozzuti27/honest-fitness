-- HonestFitness v3 Database Tables
-- Run this in your Supabase SQL editor

-- 1. connected_accounts - stores OAuth tokens for wearables
CREATE TABLE IF NOT EXISTS connected_accounts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, -- 'oura', 'fitbit', 'apple', 'garmin', 'whoop'
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ,
  token_type TEXT DEFAULT 'Bearer',
  scope TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, provider)
);

-- 2. oura_daily - nightly Oura summaries
CREATE TABLE IF NOT EXISTS oura_daily (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  hrv NUMERIC,
  resting_heart_rate NUMERIC,
  body_temp NUMERIC,
  sleep_score NUMERIC,
  sleep_duration NUMERIC, -- minutes
  sleep_efficiency NUMERIC,
  total_sleep NUMERIC, -- minutes
  deep_sleep NUMERIC, -- minutes
  rem_sleep NUMERIC, -- minutes
  light_sleep NUMERIC, -- minutes
  activity_score NUMERIC,
  readiness_score NUMERIC,
  calories NUMERIC,
  steps INTEGER,
  active_calories NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, date)
);

-- 3. fitbit_daily - daily Fitbit summaries
CREATE TABLE IF NOT EXISTS fitbit_daily (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  resting_heart_rate NUMERIC,
  body_temp NUMERIC,
  sleep_duration NUMERIC, -- minutes
  sleep_efficiency NUMERIC,
  calories NUMERIC,
  steps INTEGER,
  active_calories NUMERIC,
  distance NUMERIC, -- km
  floors INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, date)
);

-- 4. honest_readiness - daily readiness score + components
CREATE TABLE IF NOT EXISTS honest_readiness (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
  zone TEXT NOT NULL CHECK (zone IN ('green', 'yellow', 'red')),
  ac_ratio INTEGER, -- Acute:chronic ratio score
  hrv_score INTEGER,
  temp_score INTEGER,
  sleep_score INTEGER,
  strain_score INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, date)
);

-- Add body_temp to daily_metrics if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'daily_metrics' AND column_name = 'body_temp'
  ) THEN
    ALTER TABLE daily_metrics ADD COLUMN body_temp NUMERIC;
  END IF;
END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_connected_accounts_user ON connected_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_connected_accounts_provider ON connected_accounts(provider);
CREATE INDEX IF NOT EXISTS idx_oura_daily_user_date ON oura_daily(user_id, date);
CREATE INDEX IF NOT EXISTS idx_fitbit_daily_user_date ON fitbit_daily(user_id, date);
CREATE INDEX IF NOT EXISTS idx_honest_readiness_user_date ON honest_readiness(user_id, date);

-- Enable RLS (Row Level Security)
ALTER TABLE connected_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE oura_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE fitbit_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE honest_readiness ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only access their own data
CREATE POLICY "Users can view own connected_accounts" ON connected_accounts
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own connected_accounts" ON connected_accounts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own connected_accounts" ON connected_accounts
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own connected_accounts" ON connected_accounts
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own oura_daily" ON oura_daily
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own oura_daily" ON oura_daily
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own oura_daily" ON oura_daily
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own fitbit_daily" ON fitbit_daily
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own fitbit_daily" ON fitbit_daily
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own fitbit_daily" ON fitbit_daily
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own honest_readiness" ON honest_readiness
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own honest_readiness" ON honest_readiness
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own honest_readiness" ON honest_readiness
  FOR UPDATE USING (auth.uid() = user_id);

