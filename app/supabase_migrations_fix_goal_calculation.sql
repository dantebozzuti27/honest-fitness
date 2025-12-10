-- Fix goal calculation function to properly handle workouts_per_week
-- This fixes the issue where workouts aren't being counted correctly

CREATE OR REPLACE FUNCTION calculate_goal_progress(p_goal_id UUID)
RETURNS VOID AS $$
DECLARE
  goal_record RECORD;
  calculated_value NUMERIC := 0;
  progress_pct NUMERIC := 0;
BEGIN
  SELECT * INTO goal_record FROM goals WHERE id = p_goal_id;
  
  IF NOT FOUND THEN
    RETURN;
  END IF;
  
  CASE goal_record.type
    WHEN 'weight' THEN
      SELECT COALESCE(weight, 0) INTO calculated_value
      FROM health_metrics
      WHERE user_id = goal_record.user_id
        AND weight IS NOT NULL
      ORDER BY date DESC
      LIMIT 1;
      
    WHEN 'calories', 'calorie_intake' THEN
      -- Calories consumed (nutrition)
      SELECT COALESCE(calories_consumed, 0) INTO calculated_value
      FROM health_metrics
      WHERE user_id = goal_record.user_id
        AND date = CURRENT_DATE;
        
    WHEN 'calories_burned' THEN
      -- Calories burned (health/fitness)
      SELECT COALESCE(calories_burned, 0) INTO calculated_value
      FROM health_metrics
      WHERE user_id = goal_record.user_id
        AND date = CURRENT_DATE;
        
    WHEN 'protein', 'carbs', 'fat' THEN
      SELECT COALESCE((macros->>goal_record.type)::NUMERIC, 0) INTO calculated_value
      FROM health_metrics
      WHERE user_id = goal_record.user_id
        AND date = CURRENT_DATE;
        
    WHEN 'workouts_per_week' THEN
      -- Count workouts this week (Monday to Sunday)
      -- Use date_trunc to get start of week (Monday)
      SELECT COALESCE(COUNT(*)::NUMERIC, 0) INTO calculated_value
      FROM workouts
      WHERE user_id = goal_record.user_id
        AND date >= date_trunc('week', CURRENT_DATE)::DATE
        AND date <= CURRENT_DATE;
        
    WHEN 'steps' THEN
      SELECT COALESCE(steps, 0) INTO calculated_value
      FROM health_metrics
      WHERE user_id = goal_record.user_id
        AND date = CURRENT_DATE;
        
    WHEN 'sleep_hours', 'sleep' THEN
      -- Sleep duration is stored in minutes, convert to hours
      SELECT COALESCE((sleep_duration / 60.0), 0) INTO calculated_value
      FROM health_metrics
      WHERE user_id = goal_record.user_id
        AND date = CURRENT_DATE;
        
    WHEN 'hrv' THEN
      SELECT COALESCE(hrv, 0) INTO calculated_value
      FROM health_metrics
      WHERE user_id = goal_record.user_id
        AND date = CURRENT_DATE;
        
    ELSE
      calculated_value := COALESCE(goal_record.current_value, 0);
  END CASE;
  
  -- Ensure calculated_value is not NULL
  calculated_value := COALESCE(calculated_value, 0);
  
  -- Calculate progress percentage
  IF goal_record.target_value > 0 THEN
    IF goal_record.type IN ('weight') THEN
      progress_pct := 0;
    ELSE
      progress_pct := LEAST(100, (calculated_value / goal_record.target_value) * 100);
    END IF;
  ELSE
    progress_pct := 0;
  END IF;
  
  -- Update goal with calculated values
  -- Use calculated_value variable to avoid confusion with column name
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

