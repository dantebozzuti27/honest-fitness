-- SLA Monitoring Tables
-- Track SLA compliance for data freshness, availability, processing times

CREATE TABLE IF NOT EXISTS sla_metrics (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  metric_type TEXT NOT NULL, -- 'data_freshness', 'processing_time', 'availability', 'query_performance'
  metric_value NUMERIC,
  threshold NUMERIC,
  status TEXT NOT NULL, -- 'compliant', 'violation', 'warning'
  measured_at TIMESTAMPTZ DEFAULT NOW(),
  details JSONB
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sla_metrics_type ON sla_metrics(metric_type);
CREATE INDEX IF NOT EXISTS idx_sla_metrics_status ON sla_metrics(status);
CREATE INDEX IF NOT EXISTS idx_sla_metrics_measured ON sla_metrics(measured_at DESC);

-- Enable RLS
ALTER TABLE sla_metrics ENABLE ROW LEVEL SECURITY;

-- RLS Policies (adjust based on your needs)
CREATE POLICY "Users can view SLA metrics" ON sla_metrics
  FOR SELECT USING (true);

-- Function to get SLA compliance summary
CREATE OR REPLACE FUNCTION get_sla_compliance_summary(
  p_metric_type TEXT DEFAULT NULL,
  p_days INTEGER DEFAULT 7
)
RETURNS TABLE (
  metric_type TEXT,
  total_measurements BIGINT,
  compliant_count BIGINT,
  violation_count BIGINT,
  compliance_rate NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    m.metric_type,
    COUNT(*) as total_measurements,
    COUNT(*) FILTER (WHERE status = 'compliant') as compliant_count,
    COUNT(*) FILTER (WHERE status = 'violation') as violation_count,
    CASE 
      WHEN COUNT(*) > 0 
      THEN (COUNT(*) FILTER (WHERE status = 'compliant')::NUMERIC / COUNT(*)::NUMERIC) * 100
      ELSE 0
    END as compliance_rate
  FROM sla_metrics m
  WHERE measured_at >= CURRENT_DATE - (p_days || ' days')::INTERVAL
    AND (p_metric_type IS NULL OR m.metric_type = p_metric_type)
  GROUP BY m.metric_type;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

