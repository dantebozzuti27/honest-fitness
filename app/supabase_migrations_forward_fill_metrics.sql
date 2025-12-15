-- ============================================================================
-- MIGRATION: Forward-Fill Function for Manual Metrics
-- Purpose: Implement forward-fill logic for weight, body fat, etc.
-- ============================================================================

-- Function to forward-fill manual metrics (weight, body_fat_percentage)
CREATE OR REPLACE FUNCTION forward_fill_manual_metrics(
  p_user_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS VOID AS $$
DECLARE
  current_date DATE;
  last_weight NUMERIC := NULL;
  last_body_fat NUMERIC := NULL;
BEGIN
  -- Get the last known values before start_date
  SELECT weight, body_fat_percentage INTO last_weight, last_body_fat
  FROM health_metrics
  WHERE user_id = p_user_id
    AND date < p_start_date
    AND (weight IS NOT NULL OR body_fat_percentage IS NOT NULL)
  ORDER BY date DESC
  LIMIT 1;
  
  -- Iterate through each date and forward-fill
  current_date := p_start_date;
  WHILE current_date <= p_end_date LOOP
    -- Check if we have a value for this date
    UPDATE health_metrics
    SET 
      weight = COALESCE(weight, last_weight),
      body_fat_percentage = COALESCE(body_fat_percentage, last_body_fat),
      updated_at = CASE 
        WHEN weight IS NULL AND last_weight IS NOT NULL THEN NOW()
        WHEN body_fat_percentage IS NULL AND last_body_fat IS NOT NULL THEN NOW()
        ELSE updated_at
      END
    WHERE user_id = p_user_id
      AND date = current_date
      AND (weight IS NULL OR body_fat_percentage IS NULL);
    
    -- Update last known values if this date has new data
    SELECT weight, body_fat_percentage INTO last_weight, last_body_fat
    FROM health_metrics
    WHERE user_id = p_user_id AND date = current_date;
    
    current_date := current_date + INTERVAL '1 day';
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Trigger function to forward-fill when manual metrics are updated
CREATE OR REPLACE FUNCTION trigger_forward_fill_metrics()
RETURNS TRIGGER AS $$
BEGIN
  -- If weight or body_fat_percentage was updated, forward-fill future dates
  IF (TG_OP = 'UPDATE' AND (
    (OLD.weight IS DISTINCT FROM NEW.weight AND NEW.weight IS NOT NULL) OR
    (OLD.body_fat_percentage IS DISTINCT FROM NEW.body_fat_percentage AND NEW.body_fat_percentage IS NOT NULL)
  )) OR (TG_OP = 'INSERT' AND (NEW.weight IS NOT NULL OR NEW.body_fat_percentage IS NOT NULL)) THEN
    -- Forward-fill up to 30 days ahead (can be adjusted)
    -- Cast to DATE to ensure correct type (DATE + INTERVAL can become TIMESTAMP)
    PERFORM forward_fill_manual_metrics(
      NEW.user_id,
      (NEW.date + INTERVAL '1 day')::DATE,
      (NEW.date + INTERVAL '30 days')::DATE
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS auto_forward_fill_metrics ON health_metrics;
CREATE TRIGGER auto_forward_fill_metrics
  AFTER INSERT OR UPDATE OF weight, body_fat_percentage ON health_metrics
  FOR EACH ROW
  EXECUTE FUNCTION trigger_forward_fill_metrics();

