-- ════════════════════════════════════════════════════════════════════
-- Migration: biceps_variety_enrich_v1
-- Date:      2026-05-27
-- Purpose:   Enrich the 11 new biceps exercises (inserted by
--            `migration_biceps_variety_v1.sql`) with anatomical
--            `primary_muscles`, `secondary_muscles`, `movement_pattern`,
--            and `ml_exercise_type` so the workout engine can SELECT
--            them on biceps days.
--
--            Engine filter: `stepSelectExercises` calls
--            `resolveToCanonicalGroup(primary_muscle) === 'biceps'`.
--            An exercise won't be picked for a biceps slot unless at
--            least one of its `primary_muscles` maps to `biceps` via
--            `MUSCLE_HEAD_TO_GROUP` in volumeGuidelines.ts.
--
--            Source of truth for these values is
--            `app/src/lib/exerciseMuscleMap.ts` — keep them in sync.
--
-- Idempotent: yes (UPDATE by name).
-- Runner:    `node scripts/run-sql-migration.mjs sql/migration_biceps_variety_enrich_v1.sql`
-- ════════════════════════════════════════════════════════════════════

BEGIN;

UPDATE public.exercise_library SET
  primary_muscles = ARRAY['biceps_brachii_short_head', 'biceps_brachii_long_head']::text[],
  secondary_muscles = ARRAY['brachialis', 'brachioradialis']::text[],
  stabilizer_muscles = ARRAY['anterior_deltoid', 'wrist_flexors']::text[],
  movement_pattern = 'flexion',
  ml_exercise_type = 'isolation',
  force_type = 'pull',
  difficulty = 'beginner',
  default_tempo = '2-1-2',
  functional_description = 'Cambered (EZ) bar grip rotates the forearm into a slight semi-supination, reducing wrist strain vs straight barbell while keeping both biceps heads loaded.',
  musclesworked_id = 'local',
  updated_at = NOW()
WHERE name = 'EZ-Bar Curl';

UPDATE public.exercise_library SET
  primary_muscles = ARRAY['biceps_brachii_short_head']::text[],
  secondary_muscles = ARRAY['biceps_brachii_long_head', 'brachialis']::text[],
  stabilizer_muscles = ARRAY[]::text[],
  movement_pattern = 'flexion',
  ml_exercise_type = 'isolation',
  force_type = 'pull',
  difficulty = 'beginner',
  default_tempo = '2-1-2',
  functional_description = 'Seated, elbow braced against inner thigh. Eliminates body english and isolates peak contraction; biases short head due to shoulder flexion fixing the long head shorter.',
  musclesworked_id = 'local',
  updated_at = NOW()
WHERE name = 'Concentration Curl';

UPDATE public.exercise_library SET
  primary_muscles = ARRAY['biceps_brachii_short_head']::text[],
  secondary_muscles = ARRAY['biceps_brachii_long_head', 'brachialis']::text[],
  stabilizer_muscles = ARRAY['rectus_abdominis']::text[],
  movement_pattern = 'flexion',
  ml_exercise_type = 'isolation',
  force_type = 'pull',
  difficulty = 'beginner',
  default_tempo = '3-1-1',
  functional_description = 'Chest braced on the back of an incline bench, arms hanging straight down. Shortens the long head and forces strict elbow flexion — peak contraction is fully eccentrically loaded.',
  musclesworked_id = 'local',
  updated_at = NOW()
WHERE name = 'Spider Curl';

UPDATE public.exercise_library SET
  primary_muscles = ARRAY['brachialis', 'brachioradialis']::text[],
  secondary_muscles = ARRAY['biceps_brachii_long_head', 'wrist_extensors']::text[],
  stabilizer_muscles = ARRAY['anterior_deltoid']::text[],
  movement_pattern = 'flexion',
  ml_exercise_type = 'isolation',
  force_type = 'pull',
  difficulty = 'intermediate',
  default_tempo = '2-1-2',
  functional_description = 'Pronated grip curl. Loads the brachialis and brachioradialis hard (these get under-trained on standard curls) and trains wrist extensors as a bonus — addresses elbow tendinopathies long-term.',
  musclesworked_id = 'local',
  updated_at = NOW()
WHERE name = 'Reverse Barbell Curl';

UPDATE public.exercise_library SET
  primary_muscles = ARRAY['brachialis', 'brachioradialis', 'biceps_brachii_long_head']::text[],
  secondary_muscles = ARRAY['biceps_brachii_short_head']::text[],
  stabilizer_muscles = ARRAY['rectus_abdominis']::text[],
  movement_pattern = 'flexion',
  ml_exercise_type = 'isolation',
  force_type = 'pull',
  difficulty = 'beginner',
  default_tempo = '2-1-2',
  functional_description = 'Two-handed neutral grip with rope attachment. Constant cable tension keeps brachialis and brachioradialis loaded through full ROM where dumbbell hammers go slack at the top.',
  musclesworked_id = 'local',
  updated_at = NOW()
WHERE name = 'Cable Rope Hammer Curl';

UPDATE public.exercise_library SET
  primary_muscles = ARRAY['biceps_brachii_short_head', 'biceps_brachii_long_head']::text[],
  secondary_muscles = ARRAY['brachialis']::text[],
  stabilizer_muscles = ARRAY['rectus_abdominis', 'obliques']::text[],
  movement_pattern = 'flexion',
  ml_exercise_type = 'isolation',
  force_type = 'pull',
  difficulty = 'beginner',
  default_tempo = '2-1-2',
  functional_description = 'Unilateral curl at low pulley. Addresses side-to-side imbalances; supinated grip with no off-hand assist forces honest reps.',
  musclesworked_id = 'local',
  updated_at = NOW()
WHERE name = 'Single-Arm Cable Curl';

UPDATE public.exercise_library SET
  primary_muscles = ARRAY['biceps_brachii_long_head']::text[],
  secondary_muscles = ARRAY['biceps_brachii_short_head', 'brachialis']::text[],
  stabilizer_muscles = ARRAY['posterior_deltoid']::text[],
  movement_pattern = 'flexion',
  ml_exercise_type = 'isolation',
  force_type = 'pull',
  difficulty = 'intermediate',
  default_tempo = '3-1-1',
  functional_description = 'Standing with the cable behind the body (or seated on an incline bench with cable from low pulley). Shoulder extension creates a deep stretch on the long head — currently the highest-EMG biceps movement in published comparisons.',
  musclesworked_id = 'local',
  updated_at = NOW()
WHERE name = 'Incline Cable Curl (Bayesian)';

UPDATE public.exercise_library SET
  primary_muscles = ARRAY['biceps_brachii_short_head', 'biceps_brachii_long_head']::text[],
  secondary_muscles = ARRAY['brachialis']::text[],
  stabilizer_muscles = ARRAY['posterior_deltoid']::text[],
  movement_pattern = 'flexion',
  ml_exercise_type = 'isolation',
  force_type = 'pull',
  difficulty = 'intermediate',
  default_tempo = '2-1-2',
  functional_description = 'Bar dragged up the torso with elbows pulling back behind the body. Removes the front-delt assist common in standard curls; cleanly isolates biceps short head.',
  musclesworked_id = 'local',
  updated_at = NOW()
WHERE name = 'Drag Curl';

UPDATE public.exercise_library SET
  primary_muscles = ARRAY['brachialis', 'biceps_brachii_long_head']::text[],
  secondary_muscles = ARRAY['brachioradialis', 'biceps_brachii_short_head']::text[],
  stabilizer_muscles = ARRAY['anterior_deltoid']::text[],
  movement_pattern = 'flexion',
  ml_exercise_type = 'isolation',
  force_type = 'pull',
  difficulty = 'beginner',
  default_tempo = '2-1-2',
  functional_description = 'Hammer curl across the body toward the opposite shoulder. Brachialis emphasis with a slightly different fiber-angle pull than parallel hammer.',
  musclesworked_id = 'local',
  updated_at = NOW()
WHERE name = 'Cross-Body Hammer Curl';

UPDATE public.exercise_library SET
  primary_muscles = ARRAY['biceps_brachii_long_head']::text[],
  secondary_muscles = ARRAY['biceps_brachii_short_head', 'brachialis']::text[],
  stabilizer_muscles = ARRAY['posterior_deltoid']::text[],
  movement_pattern = 'flexion',
  ml_exercise_type = 'isolation',
  force_type = 'pull',
  difficulty = 'intermediate',
  default_tempo = '2-1-2',
  functional_description = 'Two-handed curl with cables from high pulleys, arms at shoulder height (crucifix position). Forces peak contraction in the shortened fascicle length; biceps short-head emphasis.',
  musclesworked_id = 'local',
  updated_at = NOW()
WHERE name = 'High Cable Curl';

UPDATE public.exercise_library SET
  primary_muscles = ARRAY['biceps_brachii_short_head']::text[],
  secondary_muscles = ARRAY['biceps_brachii_long_head', 'brachialis']::text[],
  stabilizer_muscles = ARRAY[]::text[],
  movement_pattern = 'flexion',
  ml_exercise_type = 'isolation',
  force_type = 'pull',
  difficulty = 'beginner',
  default_tempo = '2-1-2',
  functional_description = 'Plate-loaded or selectorized preacher. Pad fixes the shoulder; machine path enforces strict elbow flexion. Easier to push to true failure than free-weight preacher because the load handles itself on the eccentric.',
  musclesworked_id = 'local',
  updated_at = NOW()
WHERE name = 'Machine Preacher Curl';

COMMIT;

-- Verification:
SELECT name, primary_muscles, movement_pattern, ml_exercise_type
FROM public.exercise_library
WHERE name IN (
  'EZ-Bar Curl','Concentration Curl','Spider Curl','Reverse Barbell Curl',
  'Cable Rope Hammer Curl','Single-Arm Cable Curl','Incline Cable Curl (Bayesian)',
  'Drag Curl','Cross-Body Hammer Curl','High Cable Curl','Machine Preacher Curl'
)
ORDER BY name;
