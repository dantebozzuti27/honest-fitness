-- Add phase_start_date to user_preferences
-- Stores when the user began their current cut/bulk phase.
-- Used by Phase Plan to compute milestones and progress relative to phase start.
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS phase_start_date DATE;
