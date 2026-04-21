-- Migration: body_assessments table + exercise ROM column
-- For Apollo Physique Intelligence System

-- Body assessments: stores photo-derived scores, manual measurements, and Reeves proportional data
CREATE TABLE IF NOT EXISTS body_assessments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,

  -- Muscle group development scores (1-10 scale, keyed to engine canonical groups)
  scores JSONB NOT NULL DEFAULT '{}',

  -- Proportional ratios
  shoulder_to_waist_ratio NUMERIC,
  left_right_symmetry NUMERIC,
  estimated_body_fat_pct NUMERIC,

  -- Manual tape measurements (inches)
  measurements JSONB DEFAULT '{}',

  -- Reeves ideal targets (computed from bone measurements)
  reeves_ideals JSONB DEFAULT '{}',

  -- Deficit analysis
  weak_points JSONB DEFAULT '[]',
  strong_points JSONB DEFAULT '[]',
  proportional_deficits JSONB DEFAULT '{}',

  analysis_notes TEXT,
  photos_used INTEGER DEFAULT 0,
  source TEXT DEFAULT 'photo_ai' CHECK (source IN ('photo_ai', 'manual', 'combined')),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_body_assessments_user_date
  ON body_assessments (user_id, date DESC);

-- Add estimated ROM to exercise_library for mechanical work calculation
ALTER TABLE exercise_library
  ADD COLUMN IF NOT EXISTS estimated_rom_meters NUMERIC;
