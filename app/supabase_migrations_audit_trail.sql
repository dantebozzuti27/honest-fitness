-- Data Versioning and Audit Trail
-- Tracks all data changes with before/after values, user, timestamp, and reason

-- Create audit_log table
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  table_name TEXT NOT NULL,
  record_id UUID NOT NULL,
  action TEXT NOT NULL, -- 'INSERT', 'UPDATE', 'DELETE'
  old_values JSONB,
  new_values JSONB,
  changed_fields TEXT[],
  change_reason TEXT,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for audit log
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_table_record ON audit_log(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);

-- Enable RLS
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- RLS Policies - users can only see their own audit logs
DROP POLICY IF EXISTS "Users can view own audit logs" ON audit_log;

CREATE POLICY "Users can view own audit logs" ON audit_log
  FOR SELECT USING (auth.uid() = user_id);

-- Function to create audit log entry
CREATE OR REPLACE FUNCTION create_audit_log(
  p_table_name TEXT,
  p_record_id UUID,
  p_action TEXT,
  p_old_values JSONB DEFAULT NULL,
  p_new_values JSONB DEFAULT NULL,
  p_change_reason TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_audit_id UUID;
  v_changed_fields TEXT[];
BEGIN
  -- Calculate changed fields
  IF p_old_values IS NOT NULL AND p_new_values IS NOT NULL THEN
    SELECT ARRAY_AGG(key) INTO v_changed_fields
    FROM (
      SELECT key FROM jsonb_each(p_new_values)
      EXCEPT
      SELECT key FROM jsonb_each(p_old_values)
      WHERE jsonb_extract_path(p_old_values, key) IS DISTINCT FROM jsonb_extract_path(p_new_values, key)
    ) changed;
  END IF;
  
  -- Insert audit log
  INSERT INTO audit_log (
    user_id,
    table_name,
    record_id,
    action,
    old_values,
    new_values,
    changed_fields,
    change_reason
  ) VALUES (
    auth.uid(),
    p_table_name,
    p_record_id,
    p_action,
    p_old_values,
    p_new_values,
    v_changed_fields,
    p_change_reason
  ) RETURNING id INTO v_audit_id;
  
  RETURN v_audit_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger function for workouts table
CREATE OR REPLACE FUNCTION audit_workouts()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    PERFORM create_audit_log(
      'workouts',
      NEW.id,
      'INSERT',
      NULL,
      row_to_json(NEW)::JSONB
    );
    RETURN NEW;
  ELSIF (TG_OP = 'UPDATE') THEN
    PERFORM create_audit_log(
      'workouts',
      NEW.id,
      'UPDATE',
      row_to_json(OLD)::JSONB,
      row_to_json(NEW)::JSONB
    );
    RETURN NEW;
  ELSIF (TG_OP = 'DELETE') THEN
    PERFORM create_audit_log(
      'workouts',
      OLD.id,
      'DELETE',
      row_to_json(OLD)::JSONB,
      NULL
    );
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for workouts
DROP TRIGGER IF EXISTS workouts_audit_trigger ON workouts;
CREATE TRIGGER workouts_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON workouts
  FOR EACH ROW EXECUTE FUNCTION audit_workouts();

-- Trigger function for health_metrics table
CREATE OR REPLACE FUNCTION audit_health_metrics()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    PERFORM create_audit_log(
      'health_metrics',
      NEW.id,
      'INSERT',
      NULL,
      row_to_json(NEW)::JSONB
    );
    RETURN NEW;
  ELSIF (TG_OP = 'UPDATE') THEN
    PERFORM create_audit_log(
      'health_metrics',
      NEW.id,
      'UPDATE',
      row_to_json(OLD)::JSONB,
      row_to_json(NEW)::JSONB
    );
    RETURN NEW;
  ELSIF (TG_OP = 'DELETE') THEN
    PERFORM create_audit_log(
      'health_metrics',
      OLD.id,
      'DELETE',
      row_to_json(OLD)::JSONB,
      NULL
    );
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for health_metrics
DROP TRIGGER IF EXISTS health_metrics_audit_trigger ON health_metrics;
CREATE TRIGGER health_metrics_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON health_metrics
  FOR EACH ROW EXECUTE FUNCTION audit_health_metrics();

-- Trigger function for goals table
CREATE OR REPLACE FUNCTION audit_goals()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    PERFORM create_audit_log(
      'goals',
      NEW.id,
      'INSERT',
      NULL,
      row_to_json(NEW)::JSONB
    );
    RETURN NEW;
  ELSIF (TG_OP = 'UPDATE') THEN
    PERFORM create_audit_log(
      'goals',
      NEW.id,
      'UPDATE',
      row_to_json(OLD)::JSONB,
      row_to_json(NEW)::JSONB
    );
    RETURN NEW;
  ELSIF (TG_OP = 'DELETE') THEN
    PERFORM create_audit_log(
      'goals',
      OLD.id,
      'DELETE',
      row_to_json(OLD)::JSONB,
      NULL
    );
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for goals
DROP TRIGGER IF EXISTS goals_audit_trigger ON goals;
CREATE TRIGGER goals_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON goals
  FOR EACH ROW EXECUTE FUNCTION audit_goals();

-- Function to get audit history for a record
CREATE OR REPLACE FUNCTION get_audit_history(
  p_table_name TEXT,
  p_record_id UUID
)
RETURNS TABLE (
  id UUID,
  action TEXT,
  old_values JSONB,
  new_values JSONB,
  changed_fields TEXT[],
  change_reason TEXT,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    a.id,
    a.action,
    a.old_values,
    a.new_values,
    a.changed_fields,
    a.change_reason,
    a.created_at
  FROM audit_log a
  WHERE a.table_name = p_table_name
    AND a.record_id = p_record_id
    AND a.user_id = auth.uid()
  ORDER BY a.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

