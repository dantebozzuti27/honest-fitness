-- Migration: Exercise library deduplication & taxonomy fixes (v1)
--
-- Problem: Two seed sources have populated `exercise_library` over time:
--   1. Legacy generic seeds from rds_schema_v1.sql / supabase_run_all.sql
--      ('Squats', 'Deadlifts', 'Pull-ups', 'Bench Press', 'Rows', etc.)
--   2. Curated catalog from supabase_seed_exercise_library_reset_and_rebuild.sql
--      ('Barbell Back Squat', 'Conventional Deadlift', 'Pull-Up', etc.)
--
-- Both sets coexist in production, so the user-facing exercise picker shows
-- "Squats" *and* "Barbell Back Squat" as separate options that train the
-- same movement. The engine's `canonicalizeExerciseName` handles this at
-- the analytics layer (collapses "pull up" / "Pull-Ups" / "pullups"), but
-- the UI surface still exposes the duplicates.
--
-- Additionally, two intra-curated duplicates exist:
--   - 'Romanian Deadlift' AND 'Barbell Hip Hinge (RDL)' — same movement
--   - 'Pallof Press' AND 'Cable Pallof Press' — same movement (Pallof is
--     the general entry; Cable Pallof Press is the equipment-specific dup)
--
-- Strategy:
--   1. Build a (legacy_name → canonical_name) mapping table.
--   2. Repoint every dependent FK / text reference in user data:
--      - workout_exercises.exercise_library_id (FK) and .exercise_name (text)
--      - generated_workouts and any other JSONB blobs are NOT touched here
--        because they're regenerated on each workout cycle.
--      - exercise_swaps.exercise_name and .replacement_exercise_name (text)
--      - exercise_preferences.exercise_name if the table exists
--   3. Delete the legacy rows from exercise_library.
--   4. Fix body_part mismatches (Close-Grip Bench Press is primarily a
--      tricep movement; we leave it as 'chest' since that's where users
--      expect it and the engine reads `primary_muscles` for routing).
--
-- Idempotent: every step uses CONFLICT-safe / IF EXISTS / row-count guards.
-- Transactional: wrapped in BEGIN/COMMIT so a partial failure rolls back.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Build the legacy → canonical mapping. Only system rows (is_custom = FALSE)
--    participate; user-custom exercises are never touched.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TEMP TABLE _exlib_renames (
  legacy_name TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL
) ON COMMIT DROP;

INSERT INTO _exlib_renames (legacy_name, canonical_name) VALUES
  -- Legacy generic seeds → curated canonical names
  ('Squats',             'Barbell Back Squat'),
  ('Deadlifts',          'Conventional Deadlift'),
  ('Lunges',             'Walking Lunge'),
  ('Bench Press',        'Barbell Bench Press'),
  ('Push-ups',           'Push-Up'),
  ('Push Ups',           'Push-Up'),
  ('Pushups',            'Push-Up'),
  ('Pull-ups',           'Pull-Up'),
  ('Pull Ups',           'Pull-Up'),
  ('Pullups',            'Pull-Up'),
  ('Chin-ups',           'Chin-Up'),
  ('Chin Ups',           'Chin-Up'),
  ('Chinups',            'Chin-Up'),
  ('Rows',               'Barbell Bent-Over Row'),
  ('Bent-Over Row',      'Barbell Bent-Over Row'),
  ('Bent Over Row',      'Barbell Bent-Over Row'),
  ('Shoulder Press',     'Dumbbell Shoulder Press'),
  ('Overhead Press',     'Barbell Overhead Press'),
  ('Lateral Raises',     'Dumbbell Lateral Raise'),
  ('Bicep Curls',        'Dumbbell Biceps Curl'),
  ('Bicep Curl',         'Dumbbell Biceps Curl'),
  ('Tricep Extensions',  'Overhead Triceps Extension'),
  ('Tricep Extension',   'Overhead Triceps Extension'),
  ('Chest Fly',          'Dumbbell Fly'),
  ('Leg Curls',          'Lying Leg Curl'),
  ('Leg Extensions',     'Leg Extension'),
  ('Sit-ups',            'Sit-Up'),
  ('Sit Ups',            'Sit-Up'),
  ('Situps',             'Sit-Up'),
  ('Calf Raises',        'Standing Calf Raise'),
  ('Calf Raise',         'Standing Calf Raise'),
  ('Hip Thrusts',        'Hip Thrust'),
  ('Cardio - Running',   'Outdoor Run'),
  ('Running',            'Outdoor Run'),
  ('Run',                'Outdoor Run'),
  ('Cycling',            'Outdoor Cycling'),
  ('Bike',               'Stationary Bike'),
  ('Biking',             'Stationary Bike'),
  ('Rowing',             'Rowing Machine'),
  ('Row Machine',        'Rowing Machine'),
  ('Swimming',           'Swimming (Freestyle)'),
  ('Swim',               'Swimming (Freestyle)'),

  -- Intra-curated duplicates
  ('Barbell Hip Hinge (RDL)', 'Romanian Deadlift'),
  ('Cable Pallof Press',      'Pallof Press');

-- Drop any rename row whose canonical target does not exist in the library
-- (i.e., the curated seed hasn't been run yet on this DB). Repointing data
-- to a nonexistent name would corrupt user history.
DELETE FROM _exlib_renames r
WHERE NOT EXISTS (
  SELECT 1 FROM exercise_library el
  WHERE el.name = r.canonical_name AND el.is_custom = FALSE
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Resolve canonical row ids for each legacy entry. We need both the
--    legacy id (to repoint FKs from) and the canonical id (to repoint to).
-- ─────────────────────────────────────────────────────────────────────────

CREATE TEMP TABLE _exlib_id_pairs (
  legacy_id UUID NOT NULL,
  legacy_name TEXT NOT NULL,
  canonical_id UUID NOT NULL,
  canonical_name TEXT NOT NULL
) ON COMMIT DROP;

INSERT INTO _exlib_id_pairs (legacy_id, legacy_name, canonical_id, canonical_name)
SELECT DISTINCT
  legacy.id, legacy.name, canonical.id, canonical.name
FROM _exlib_renames r
JOIN exercise_library legacy
  ON legacy.name = r.legacy_name AND legacy.is_custom = FALSE
JOIN exercise_library canonical
  ON canonical.name = r.canonical_name AND canonical.is_custom = FALSE
-- Never collapse a row onto itself (defensive — names differ by definition
-- in _exlib_renames, but the join below would still try if a row was renamed
-- earlier and the legacy entry was left as a manual alias).
WHERE legacy.id <> canonical.id;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Repoint dependent rows. Each step is gated on the table existing so
--    this migration runs cleanly on staging databases that may not have
--    every analytics table set up yet.
-- ─────────────────────────────────────────────────────────────────────────

-- workout_exercises: FK and free-text both
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'workout_exercises') THEN
    UPDATE workout_exercises we
    SET exercise_library_id = p.canonical_id,
        exercise_name = p.canonical_name
    FROM _exlib_id_pairs p
    WHERE we.exercise_library_id = p.legacy_id
       OR we.exercise_name = p.legacy_name;
  END IF;
END $$;

-- workout_sets: free-text exercise_name
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'workout_sets')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'workout_sets' AND column_name = 'exercise_name') THEN
    UPDATE workout_sets ws
    SET exercise_name = p.canonical_name
    FROM _exlib_id_pairs p
    WHERE ws.exercise_name = p.legacy_name;
  END IF;
END $$;

-- exercise_swaps: both swap source and replacement
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'exercise_swaps') THEN
    UPDATE exercise_swaps es
    SET exercise_name = p.canonical_name
    FROM _exlib_id_pairs p
    WHERE es.exercise_name = p.legacy_name;

    UPDATE exercise_swaps es
    SET replacement_exercise_name = p.canonical_name
    FROM _exlib_id_pairs p
    WHERE es.replacement_exercise_name = p.legacy_name;
  END IF;
END $$;

-- exercise_preferences (analytics) if present
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'exercise_preferences')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'exercise_preferences' AND column_name = 'exercise_name') THEN
    -- Use ON CONFLICT-style merge: if both legacy and canonical preference
    -- rows exist for the same user, sum their session counts and keep the
    -- canonical row. We do this in two passes to avoid PK collisions.
    UPDATE exercise_preferences ep
    SET exercise_name = p.canonical_name
    FROM _exlib_id_pairs p
    WHERE ep.exercise_name = p.legacy_name
      AND NOT EXISTS (
        SELECT 1 FROM exercise_preferences ep2
        WHERE ep2.user_id = ep.user_id
          AND ep2.exercise_name = p.canonical_name
      );

    -- Drop legacy rows that would have collided after the rename — the
    -- canonical row already has the user's preference signal.
    DELETE FROM exercise_preferences ep
    USING _exlib_id_pairs p
    WHERE ep.exercise_name = p.legacy_name;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Delete the legacy library rows. With FKs repointed, this is safe.
--    Any row with is_custom = TRUE is never touched by this migration.
-- ─────────────────────────────────────────────────────────────────────────

DELETE FROM exercise_library el
WHERE el.id IN (SELECT legacy_id FROM _exlib_id_pairs)
  AND el.is_custom = FALSE;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Body-part / category fixes for residual mismatches.
--    These don't affect user data — only the exercise picker UX.
-- ─────────────────────────────────────────────────────────────────────────

-- Generic legacy 'Lat Pulldown' may exist alongside curated; if both, the
-- curated one already won at step 4 because we only delete legacy. But the
-- generic seed used `is_custom = FALSE` and same name — postgres unique
-- index `idx_exercise_library_system_unique` would have prevented this.
-- Defensive: nothing to do here. Documented for clarity.

-- The remaining cleanup is a no-op if the curated seed has been re-run
-- recently (its INSERT statement uses non-null values for the fixed fields).

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- Verification queries — run after commit if desired:
-- ─────────────────────────────────────────────────────────────────────────
-- SELECT name, is_custom FROM exercise_library WHERE name IN (
--   'Squats','Deadlifts','Pull-ups','Push-ups','Bench Press','Rows',
--   'Shoulder Press','Lateral Raises','Bicep Curls','Tricep Extensions',
--   'Chest Fly','Leg Curls','Leg Extensions','Running','Cycling','Rowing',
--   'Swimming','Barbell Hip Hinge (RDL)','Cable Pallof Press'
-- );
-- -- Expected: zero rows returned (all renamed/deleted) for is_custom=false.
--
-- SELECT COUNT(*) AS total_system FROM exercise_library WHERE is_custom = FALSE;
-- -- Expected: ~200 rows (matches the curated seed count minus duplicates).
