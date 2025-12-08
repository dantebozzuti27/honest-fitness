-- ============================================================================
-- FIX: Forward Fill Function Parameter Type Mismatch
-- Purpose: Fix trigger to cast DATE + INTERVAL back to DATE
-- ============================================================================

-- Fix the trigger function to properly cast dates
CREATE OR REPLACE FUNCTION trigger_forward_fill_metrics()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'UPDATE' AND (
    (OLD.weight IS DISTINCT FROM NEW.weight AND NEW.weight IS NOT NULL) OR
    (OLD.body_fat_percentage IS DISTINCT FROM NEW.body_fat_percentage AND NEW.body_fat_percentage IS NOT NULL)
  )) OR (TG_OP = 'INSERT' AND (NEW.weight IS NOT NULL OR NEW.body_fat_percentage IS NOT NULL)) THEN
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

