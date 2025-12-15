-- Data Quality Monitoring Tables
-- Tracks data completeness, freshness, accuracy, and consistency

-- Create data_quality_metrics table
CREATE TABLE IF NOT EXISTS data_quality_metrics (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  completeness_score INTEGER NOT NULL, -- 0-100
  freshness_score INTEGER NOT NULL, -- 0-100
  accuracy_score INTEGER NOT NULL, -- 0-100
  consistency_score INTEGER NOT NULL, -- 0-100
  overall_score INTEGER NOT NULL, -- 0-100
  issues_count INTEGER DEFAULT 0,
  metrics_date DATE NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, metrics_date)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_data_quality_user_id ON data_quality_metrics(user_id);
CREATE INDEX IF NOT EXISTS idx_data_quality_date ON data_quality_metrics(metrics_date DESC);
CREATE INDEX IF NOT EXISTS idx_data_quality_score ON data_quality_metrics(overall_score);

-- Enable RLS
ALTER TABLE data_quality_metrics ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can view own quality metrics" ON data_quality_metrics;
DROP POLICY IF EXISTS "Users can insert own quality metrics" ON data_quality_metrics;

CREATE POLICY "Users can view own quality metrics" ON data_quality_metrics
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own quality metrics" ON data_quality_metrics
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Create function to get quality trends
CREATE OR REPLACE FUNCTION get_quality_trends(
  p_user_id UUID,
  p_days INTEGER DEFAULT 30
)
RETURNS TABLE (
  metrics_date DATE,
  overall_score INTEGER,
  completeness_score INTEGER,
  freshness_score INTEGER,
  accuracy_score INTEGER,
  consistency_score INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    metrics_date,
    overall_score,
    completeness_score,
    freshness_score,
    accuracy_score,
    consistency_score
  FROM data_quality_metrics
  WHERE user_id = p_user_id
    AND metrics_date >= CURRENT_DATE - (p_days || ' days')::INTERVAL
  ORDER BY metrics_date DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

