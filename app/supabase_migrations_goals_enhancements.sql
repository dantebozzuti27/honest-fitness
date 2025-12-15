-- ============================================================================
-- MIGRATION: Goals Enhancements
-- Purpose: Add daily goal tracking, progress tracking
-- ============================================================================

-- Add new columns to goals table
DO $$ 
BEGIN
  -- Daily goal achievement (yes/no for daily goals like calorie intake)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'goals' AND column_name = 'is_daily_goal'
  ) THEN
    ALTER TABLE goals ADD COLUMN is_daily_goal BOOLEAN DEFAULT FALSE;
  END IF;
  
  -- Track daily achievement (for daily goals)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'goals' AND column_name = 'daily_achievements'
  ) THEN
    ALTER TABLE goals ADD COLUMN daily_achievements JSONB; 
    -- Structure: {"2024-01-15": true, "2024-01-16": false, ...}
  END IF;
  
  -- Progress percentage (for progress-based goals like weight)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'goals' AND column_name = 'progress_percentage'
  ) THEN
    ALTER TABLE goals ADD COLUMN progress_percentage NUMERIC DEFAULT 0 CHECK (progress_percentage >= 0 AND progress_percentage <= 100);
  END IF;
  
  -- Last calculated date (for tracking when progress was last updated)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'goals' AND column_name = 'last_calculated_at'
  ) THEN
    ALTER TABLE goals ADD COLUMN last_calculated_at TIMESTAMPTZ;
  END IF;
END $$;

-- Function to calculate and update goal progress
CREATE OR REPLACE FUNCTION calculate_goal_progress(p_goal_id UUID)
RETURNS VOID AS $$
DECLARE
  goal_record RECORD;
  calculated_value NUMERIC := 0;
  progress_pct NUMERIC;
BEGIN
  -- Get goal details
  SELECT * INTO goal_record FROM goals WHERE id = p_goal_id;
  
  IF NOT FOUND THEN
    RETURN;
  END IF;
  
  -- Calculate current value based on goal type
  CASE goal_record.type
    WHEN 'weight' THEN
      -- Get most recent weight from health_metrics
      SELECT COALESCE(weight, 0) INTO calculated_value
      FROM health_metrics
      WHERE user_id = goal_record.user_id
        AND weight IS NOT NULL
      ORDER BY date DESC
      LIMIT 1;
      
    WHEN 'calories', 'calorie_intake' THEN
      -- Get today's calories consumed
      SELECT COALESCE(calories_consumed, 0) INTO calculated_value
      FROM health_metrics
      WHERE user_id = goal_record.user_id
        AND date = CURRENT_DATE;
      
    WHEN 'protein', 'carbs', 'fat' THEN
      -- Get today's macros
      SELECT COALESCE((macros->>goal_record.type)::NUMERIC, 0) INTO calculated_value
      FROM health_metrics
      WHERE user_id = goal_record.user_id
        AND date = CURRENT_DATE;
        
    WHEN 'workouts_per_week' THEN
      -- Count workouts this week
      SELECT COALESCE(COUNT(*)::NUMERIC, 0) INTO calculated_value
      FROM workouts
      WHERE user_id = goal_record.user_id
        AND date >= date_trunc('week', CURRENT_DATE)::DATE
        AND date <= CURRENT_DATE;
        
    WHEN 'steps' THEN
      -- Get today's steps
      SELECT COALESCE(steps, 0) INTO calculated_value
      FROM health_metrics
      WHERE user_id = goal_record.user_id
        AND date = CURRENT_DATE;
        
    ELSE
      -- For custom goals, use current_value as is
      calculated_value := COALESCE(goal_record.current_value, 0);
  END CASE;
  
  -- Calculate progress percentage
  IF goal_record.target_value > 0 THEN
    IF goal_record.type IN ('weight') THEN
      -- For weight loss goals, progress is (start - current) / (start - target)
      -- This is more complex and depends on start_date weight
      progress_pct := 0; -- Placeholder - implement based on your logic
    ELSE
      -- For gain goals, progress is current / target
      progress_pct := LEAST(100, (calculated_value / goal_record.target_value) * 100);
    END IF;
  END IF;
  
  -- Update goal
  UPDATE goals
  SET 
    current_value = calculated_value,
    progress_percentage = progress_pct,
    last_calculated_at = NOW()
  WHERE id = p_goal_id;
  
  -- For daily goals, update daily_achievements
  IF goal_record.is_daily_goal THEN
    UPDATE goals
    SET daily_achievements = COALESCE(daily_achievements, '{}'::jsonb) || 
      jsonb_build_object(CURRENT_DATE::TEXT, (calculated_value >= goal_record.target_value))
    WHERE id = p_goal_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

