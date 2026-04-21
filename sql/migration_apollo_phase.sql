-- Apollo Phase Migration
-- Replaces the old training_goal system (strength/hypertrophy/general_fitness/fat_loss)
-- with Apollo phases (bulk/cut/maintain).

ALTER TABLE user_preferences
  DROP CONSTRAINT IF EXISTS user_preferences_training_goal_check;

UPDATE user_preferences
  SET training_goal = 'maintain'
  WHERE training_goal NOT IN ('bulk', 'cut', 'maintain') OR training_goal IS NULL;

ALTER TABLE user_preferences
  ADD CONSTRAINT user_preferences_training_goal_check
  CHECK (training_goal IN ('bulk', 'cut', 'maintain'));
