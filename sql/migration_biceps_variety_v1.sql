-- ════════════════════════════════════════════════════════════════════
-- Migration: biceps_variety_v1
-- Date:      2026-05-27
-- Purpose:   Expand biceps exercise variety. Library was 6 isolations +
--            5 compounds, missing common variants users expect: EZ-bar,
--            concentration, spider, reverse, drag, Bayesian (incline
--            cable), cross-body hammer, single-arm cable, rope hammer,
--            high cable, machine preacher.
--
--            User request: "Expand the types of biceps exercises and
--            get more specific."
--
-- Idempotent: yes (uses NOT EXISTS guards).
-- Runner:    `node scripts/run-sql-migration.mjs sql/migration_biceps_variety_v1.sql`
--            after which run `tsx scripts/enrich-exercises.ts` to
--            populate primary_muscles / movement_pattern / ml_exercise_type
--            from app/src/lib/exerciseMuscleMap.ts.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO public.exercise_library
  (name, category, body_part, sub_body_parts, equipment, is_custom, description)
SELECT v.name, v.category, v.body_part, v.sub_body_parts, v.equipment, v.is_custom, v.description
FROM (VALUES
  -- name, category, body_part, sub_body_parts (text[]), equipment (text[]), is_custom, description
  ('EZ-Bar Curl',
   'strength', 'arms',
   ARRAY['biceps']::text[],
   ARRAY['ez_bar']::text[],
   false,
   'Standing curl with cambered (EZ) bar. The angled grip reduces wrist strain vs straight barbell while keeping both heads loaded.'),

  ('Concentration Curl',
   'strength', 'arms',
   ARRAY['biceps']::text[],
   ARRAY['dumbbell','bench']::text[],
   false,
   'Seated, elbow braced against inner thigh. Eliminates body english and isolates peak contraction; emphasizes short head.'),

  ('Spider Curl',
   'strength', 'arms',
   ARRAY['biceps']::text[],
   ARRAY['barbell','dumbbell','bench']::text[],
   false,
   'Chest braced on the back of an incline bench, arms hanging straight down. Shortens the long head and maximizes short head + brachialis recruitment in the stretched position.'),

  ('Reverse Barbell Curl',
   'strength', 'arms',
   ARRAY['biceps','forearms']::text[],
   ARRAY['barbell']::text[],
   false,
   'Pronated grip curl. Loads brachialis and brachioradialis hard (under-trained in standard curls) and trains wrist extensors as a bonus.'),

  ('Cable Rope Hammer Curl',
   'strength', 'arms',
   ARRAY['biceps','brachialis']::text[],
   ARRAY['cable']::text[],
   false,
   'Two-handed neutral-grip curl with rope attachment. Cable keeps tension on brachialis and brachioradialis through full ROM.'),

  ('Single-Arm Cable Curl',
   'strength', 'arms',
   ARRAY['biceps']::text[],
   ARRAY['cable']::text[],
   false,
   'Unilateral curl with low pulley. Addresses side-to-side imbalances; allows true supinated finish without the off-hand cheating.'),

  ('Incline Cable Curl (Bayesian)',
   'strength', 'arms',
   ARRAY['biceps']::text[],
   ARRAY['cable','bench']::text[],
   false,
   'Standing with cable behind the body (or seated on incline with cable from low pulley). Shoulder extension creates a deep stretch on the long head — currently the highest-EMG biceps movement in published EMG comparisons.'),

  ('Drag Curl',
   'strength', 'arms',
   ARRAY['biceps']::text[],
   ARRAY['barbell']::text[],
   false,
   'Bar dragged up the torso with elbows pulling back. Removes the front-delt assist common in standard curls; isolates biceps short head.'),

  ('Cross-Body Hammer Curl',
   'strength', 'arms',
   ARRAY['biceps','brachialis']::text[],
   ARRAY['dumbbell']::text[],
   false,
   'Hammer curl across the body to the opposite shoulder. Targets brachialis + biceps long head with a slightly different fiber angle than parallel hammer.'),

  ('High Cable Curl',
   'strength', 'arms',
   ARRAY['biceps']::text[],
   ARRAY['cable']::text[],
   false,
   'Two-handed curl with cables from high pulleys, arms at shoulder height (crucifix position). Long-head emphasis with peak contraction at the short fascicle length.'),

  ('Machine Preacher Curl',
   'strength', 'arms',
   ARRAY['biceps']::text[],
   ARRAY['machine']::text[],
   false,
   'Plate-loaded or selectorized preacher machine. Pad fixes the shoulder, machine path enforces strict elbow flexion. Easier to push to true failure than free-weight preacher.')
) AS v(name, category, body_part, sub_body_parts, equipment, is_custom, description)
WHERE NOT EXISTS (
  SELECT 1 FROM public.exercise_library el WHERE el.name = v.name
);

COMMIT;
