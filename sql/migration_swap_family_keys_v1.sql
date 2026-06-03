-- Anti-oscillation analytics: staple family keys on swap rows
-- Run after migration_swap_learning_and_signals_v1.sql

ALTER TABLE exercise_swaps
  ADD COLUMN IF NOT EXISTS from_family_key TEXT,
  ADD COLUMN IF NOT EXISTS to_family_key TEXT;

COMMENT ON COLUMN exercise_swaps.from_family_key IS 'Ontology staple family of exercise removed (optional).';
COMMENT ON COLUMN exercise_swaps.to_family_key IS 'Ontology staple family of replacement exercise (optional).';

CREATE INDEX IF NOT EXISTS idx_exercise_swaps_user_families
  ON exercise_swaps(user_id, from_family_key, to_family_key)
  WHERE from_family_key IS NOT NULL OR to_family_key IS NOT NULL;
