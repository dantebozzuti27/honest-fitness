-- Pipeline Monitoring Tables
-- Track ETL pipeline health, data flow, processing times, failures

CREATE TABLE IF NOT EXISTS pipeline_jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  job_name TEXT NOT NULL,
  status TEXT NOT NULL, -- 'success', 'failure', 'running'
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  duration_seconds NUMERIC,
  records_processed INTEGER DEFAULT 0,
  error_message TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_name ON pipeline_jobs(job_name);
CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_status ON pipeline_jobs(status);
CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_started ON pipeline_jobs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_name_status ON pipeline_jobs(job_name, status);

-- Enable RLS (adjust based on your needs - may want admin-only access)
ALTER TABLE pipeline_jobs ENABLE ROW LEVEL SECURITY;

-- RLS Policies (allow all authenticated users to view, but only service role to insert)
CREATE POLICY "Users can view pipeline jobs" ON pipeline_jobs
  FOR SELECT USING (true);

-- Function to get pipeline statistics
CREATE OR REPLACE FUNCTION get_pipeline_statistics(
  p_job_name TEXT DEFAULT NULL,
  p_days INTEGER DEFAULT 7
)
RETURNS TABLE (
  total_jobs BIGINT,
  successful_jobs BIGINT,
  failed_jobs BIGINT,
  success_rate NUMERIC,
  avg_duration_seconds NUMERIC,
  total_records_processed BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*) as total_jobs,
    COUNT(*) FILTER (WHERE status = 'success') as successful_jobs,
    COUNT(*) FILTER (WHERE status = 'failure') as failed_jobs,
    CASE 
      WHEN COUNT(*) > 0 
      THEN (COUNT(*) FILTER (WHERE status = 'success')::NUMERIC / COUNT(*)::NUMERIC) * 100
      ELSE 0
    END as success_rate,
    AVG(duration_seconds) as avg_duration_seconds,
    SUM(records_processed) as total_records_processed
  FROM pipeline_jobs
  WHERE started_at >= CURRENT_DATE - (p_days || ' days')::INTERVAL
    AND (p_job_name IS NULL OR job_name = p_job_name);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

