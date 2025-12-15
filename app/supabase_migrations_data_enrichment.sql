-- Data Enrichment Tables
-- Stores derived metrics, scores, and recommendations

-- Create data_enrichments table
CREATE TABLE IF NOT EXISTS data_enrichments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  data_type TEXT NOT NULL, -- 'workout', 'nutrition', 'health'
  data_id UUID NOT NULL, -- ID of the original data record
  derived_metrics JSONB NOT NULL, -- All derived metrics, scores, recommendations
  enriched_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, data_type, data_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_data_enrichments_user_id ON data_enrichments(user_id);
CREATE INDEX IF NOT EXISTS idx_data_enrichments_type ON data_enrichments(data_type);
CREATE INDEX IF NOT EXISTS idx_data_enrichments_data_id ON data_enrichments(data_id);
CREATE INDEX IF NOT EXISTS idx_data_enrichments_user_type ON data_enrichments(user_id, data_type);

-- Enable RLS
ALTER TABLE data_enrichments ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can view own enrichments" ON data_enrichments;
DROP POLICY IF EXISTS "Users can insert own enrichments" ON data_enrichments;
DROP POLICY IF EXISTS "Users can update own enrichments" ON data_enrichments;

CREATE POLICY "Users can view own enrichments" ON data_enrichments
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own enrichments" ON data_enrichments
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own enrichments" ON data_enrichments
  FOR UPDATE USING (auth.uid() = user_id);

-- Create function to get enrichment statistics
CREATE OR REPLACE FUNCTION get_enrichment_statistics(
  p_user_id UUID,
  p_data_type TEXT,
  p_start_date TIMESTAMPTZ DEFAULT NOW() - INTERVAL '30 days',
  p_end_date TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE (
  avg_score NUMERIC,
  total_records BIGINT,
  score_distribution JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    AVG((derived_metrics->>'quality_score')::NUMERIC) as avg_score,
    COUNT(*) as total_records,
    jsonb_build_object(
      'high', COUNT(*) FILTER (WHERE (derived_metrics->>'quality_score')::NUMERIC >= 80),
      'medium', COUNT(*) FILTER (WHERE (derived_metrics->>'quality_score')::NUMERIC >= 60 AND (derived_metrics->>'quality_score')::NUMERIC < 80),
      'low', COUNT(*) FILTER (WHERE (derived_metrics->>'quality_score')::NUMERIC < 60)
    ) as score_distribution
  FROM data_enrichments
  WHERE user_id = p_user_id
    AND data_type = p_data_type
    AND enriched_at BETWEEN p_start_date AND p_end_date;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

