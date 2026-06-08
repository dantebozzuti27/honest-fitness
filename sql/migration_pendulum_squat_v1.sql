-- ════════════════════════════════════════════════════════════════════
-- Migration: pendulum_squat_v1
-- Date:      2026-06-07
-- Purpose:   Add the Pendulum Squat to the exercise library and enrich it
--            with anatomical primary/secondary muscles, movement pattern,
--            and ml_exercise_type so the workout engine can SELECT it on
--            quad/leg days.
--
--            User request: "add pendulum squats".
--
--            The pendulum squat is a back-supported, arcing machine squat:
--            near-constant tension and a deep loaded stretch make it a
--            high-stimulus quad movement with minimal spinal loading. It
--            joins the squat_pattern ontology family (matched automatically
--            by the squat keyword rule in exerciseOntology.ts).
--
--            Source of truth for these values is
--            app/src/lib/exerciseMuscleMap.ts — keep them in sync.
--
-- Idempotent: yes (NOT EXISTS guard on insert; UPDATE by name on enrich).
-- Runner:    `node scripts/run-sql-migration.mjs sql/migration_pendulum_squat_v1.sql`
-- ════════════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO public.exercise_library
  (name, category, body_part, sub_body_parts, equipment, is_custom, description)
SELECT v.name, v.category, v.body_part, v.sub_body_parts, v.equipment, v.is_custom, v.description
FROM (VALUES
  ('Pendulum Squat',
   'strength', 'legs',
   ARRAY['quads','glutes']::text[],
   ARRAY['machine']::text[],
   false,
   'Back-supported arcing machine squat; constant tension and deep loaded stretch for high quad stimulus with minimal spinal load.')
) AS v(name, category, body_part, sub_body_parts, equipment, is_custom, description)
WHERE NOT EXISTS (
  SELECT 1 FROM public.exercise_library el WHERE el.name = v.name
);

UPDATE public.exercise_library SET
  primary_muscles = ARRAY['rectus_femoris', 'vastus_lateralis', 'vastus_medialis', 'vastus_intermedius']::text[],
  secondary_muscles = ARRAY['gluteus_maximus', 'adductors']::text[],
  stabilizer_muscles = ARRAY[]::text[],
  movement_pattern = 'squat',
  ml_exercise_type = 'compound',
  force_type = 'push',
  difficulty = 'beginner',
  default_tempo = '3-1-1',
  functional_description = 'Back-supported arcing squat that keeps near-constant tension and loads deep knee flexion under stretch — high quad stimulus with minimal spinal load. Controlled eccentric emphasizes the lengthened position; deep range recruits adductors and glutes.',
  musclesworked_id = 'local',
  updated_at = NOW()
WHERE name = 'Pendulum Squat';

COMMIT;

-- Verification:
SELECT name, primary_muscles, secondary_muscles, movement_pattern, ml_exercise_type, default_tempo
FROM public.exercise_library
WHERE name = 'Pendulum Squat';
