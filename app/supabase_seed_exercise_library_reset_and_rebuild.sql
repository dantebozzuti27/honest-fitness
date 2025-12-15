-- ============================================================================
-- SEED: Exercise Library (System Catalog) - Reset + Rebuild
-- Purpose:
--   - Delete ONLY system exercises (is_custom = false)
--   - Rebuild a large, curated catalog of strength + cardio exercises
--
-- Notes:
--   - This does NOT delete user custom exercises (is_custom = true)
--   - This assumes the table exists: public.exercise_library
--   - Run in Supabase SQL Editor
-- ============================================================================

begin;

-- 0) Sanity check: table exists
do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'exercise_library'
  ) then
    raise exception 'public.exercise_library does not exist. Run app/supabase_migrations_exercise_library.sql first.';
  end if;
end $$;

-- 1) Delete ONLY system exercises
delete from public.exercise_library
where is_custom = false;

-- 2) Insert system exercises
-- Conventions:
--   category: 'strength' | 'cardio'
--   body_part: 'chest' | 'back' | 'legs' | 'arms' | 'shoulders' | 'core' | 'full_body' | 'cardio'
--   equipment: array of canonical tokens (lowercase)

insert into public.exercise_library
  (name, category, body_part, sub_body_parts, equipment, is_custom, description)
values

-- =========================
-- STRENGTH — LEGS (SQUAT)
-- =========================
('Barbell Back Squat', 'strength', 'legs', array['quads','glutes','hamstrings'], array['barbell','rack'], false, 'Back squat with barbell on upper back.'),
('Barbell Front Squat', 'strength', 'legs', array['quads','glutes','core'], array['barbell','rack'], false, 'Front-rack squat emphasizing quads and trunk.'),
('Barbell Box Squat', 'strength', 'legs', array['glutes','quads','hamstrings'], array['barbell','rack','box'], false, 'Squat to a box to control depth and tension.'),
('Barbell Pause Squat', 'strength', 'legs', array['quads','glutes','core'], array['barbell','rack'], false, 'Pause at the bottom position before standing.'),
('Barbell Zercher Squat', 'strength', 'legs', array['quads','glutes','core'], array['barbell','rack'], false, 'Barbell held in elbows; strong trunk demand.'),
('Smith Machine Squat', 'strength', 'legs', array['quads','glutes'], array['smith_machine'], false, 'Squat using a fixed-path bar.'),
('Hack Squat Machine', 'strength', 'legs', array['quads','glutes'], array['machine'], false, 'Machine hack squat emphasizing quads.'),
('Leg Press', 'strength', 'legs', array['quads','glutes','hamstrings'], array['machine'], false, 'Press sled with feet; heavy lower-body compound.'),
('Goblet Squat', 'strength', 'legs', array['quads','glutes','core'], array['dumbbells','kettlebell'], false, 'Squat holding weight at chest.'),
('Dumbbell Front Squat', 'strength', 'legs', array['quads','glutes','core'], array['dumbbells'], false, 'Front-loaded squat with dumbbells.'),
('Kettlebell Front Squat', 'strength', 'legs', array['quads','glutes','core'], array['kettlebell'], false, 'Front-loaded squat with kettlebells.'),
('Bodyweight Squat', 'strength', 'legs', array['quads','glutes'], array['bodyweight'], false, 'Air squat.'),
('Split Squat', 'strength', 'legs', array['quads','glutes'], array['bodyweight'], false, 'Static lunge pattern.'),
('Bulgarian Split Squat', 'strength', 'legs', array['quads','glutes'], array['bench','bodyweight'], false, 'Rear-foot elevated split squat.'),
('Dumbbell Bulgarian Split Squat', 'strength', 'legs', array['quads','glutes'], array['dumbbells','bench'], false, 'Rear-foot elevated split squat with dumbbells.'),
('Barbell Bulgarian Split Squat', 'strength', 'legs', array['quads','glutes','core'], array['barbell','rack','bench'], false, 'Rear-foot elevated split squat with barbell.'),
('Walking Lunge', 'strength', 'legs', array['quads','glutes','hamstrings'], array['bodyweight'], false, 'Alternating forward lunges while walking.'),
('Dumbbell Walking Lunge', 'strength', 'legs', array['quads','glutes','hamstrings'], array['dumbbells'], false, 'Walking lunge with dumbbells.'),
('Barbell Walking Lunge', 'strength', 'legs', array['quads','glutes','core'], array['barbell'], false, 'Walking lunge with barbell.'),
('Reverse Lunge', 'strength', 'legs', array['glutes','quads'], array['bodyweight'], false, 'Step back into lunge; knee-friendly for many.'),
('Dumbbell Reverse Lunge', 'strength', 'legs', array['glutes','quads'], array['dumbbells'], false, 'Reverse lunge with dumbbells.'),
('Curtsy Lunge', 'strength', 'legs', array['glutes','adductors','abductors'], array['bodyweight'], false, 'Cross-behind lunge emphasizing glute med/adductors.'),
('Step-Up', 'strength', 'legs', array['quads','glutes'], array['box','bench','bodyweight'], false, 'Step onto box/bench and drive through lead leg.'),
('Dumbbell Step-Up', 'strength', 'legs', array['quads','glutes'], array['dumbbells','box','bench'], false, 'Step-up holding dumbbells.'),
('Sissy Squat', 'strength', 'legs', array['quads'], array['bodyweight'], false, 'Quad-focused knee travel squat variation.'),

-- =========================
-- STRENGTH — LEGS (HINGE)
-- =========================
('Conventional Deadlift', 'strength', 'legs', array['glutes','hamstrings','lower_back'], array['barbell'], false, 'Standard deadlift from floor.'),
('Sumo Deadlift', 'strength', 'legs', array['glutes','adductors','hamstrings'], array['barbell'], false, 'Wide-stance deadlift.'),
('Trap Bar Deadlift', 'strength', 'legs', array['glutes','quads','hamstrings'], array['trap_bar'], false, 'Neutral-grip deadlift using hex bar.'),
('Romanian Deadlift', 'strength', 'legs', array['hamstrings','glutes','lower_back'], array['barbell'], false, 'Hip hinge with minimal knee bend.'),
('Dumbbell Romanian Deadlift', 'strength', 'legs', array['hamstrings','glutes'], array['dumbbells'], false, 'RDL with dumbbells.'),
('Single-Leg Romanian Deadlift', 'strength', 'legs', array['hamstrings','glutes','core'], array['bodyweight'], false, 'Unilateral hinge for balance and posterior chain.'),
('Dumbbell Single-Leg Romanian Deadlift', 'strength', 'legs', array['hamstrings','glutes','core'], array['dumbbells'], false, 'Unilateral hinge with dumbbells.'),
('Stiff-Leg Deadlift', 'strength', 'legs', array['hamstrings','glutes','lower_back'], array['barbell'], false, 'Long-lever hinge; advanced hamstring load.'),
('Good Morning', 'strength', 'legs', array['hamstrings','glutes','lower_back'], array['barbell'], false, 'Hip hinge with barbell on back.'),
('Hip Thrust', 'strength', 'legs', array['glutes','hamstrings'], array['bodyweight','bench'], false, 'Glute bridge with upper back on bench.'),
('Barbell Hip Thrust', 'strength', 'legs', array['glutes','hamstrings'], array['barbell','bench'], false, 'Loaded hip thrust emphasizing glutes.'),
('Dumbbell Hip Thrust', 'strength', 'legs', array['glutes','hamstrings'], array['dumbbells','bench'], false, 'Hip thrust holding a dumbbell.'),
('Glute Bridge', 'strength', 'legs', array['glutes','hamstrings'], array['bodyweight'], false, 'Floor glute bridge.'),
('Barbell Glute Bridge', 'strength', 'legs', array['glutes','hamstrings'], array['barbell'], false, 'Floor glute bridge with barbell.'),
('Cable Pull-Through', 'strength', 'legs', array['glutes','hamstrings'], array['cable'], false, 'Cable hinge movement with rope attachment.'),
('Back Extension', 'strength', 'legs', array['lower_back','glutes','hamstrings'], array['machine','bodyweight'], false, 'Hip extension on roman chair.'),
('45-Degree Back Extension', 'strength', 'legs', array['lower_back','glutes','hamstrings'], array['machine'], false, 'Back extension on 45-degree bench.'),

-- =========================
-- STRENGTH — LEGS (KNEE FLEX/EXT + CALVES)
-- =========================
('Leg Extension', 'strength', 'legs', array['quads'], array['machine'], false, 'Machine knee extension.'),
('Seated Leg Curl', 'strength', 'legs', array['hamstrings'], array['machine'], false, 'Machine hamstring curl (seated).'),
('Lying Leg Curl', 'strength', 'legs', array['hamstrings'], array['machine'], false, 'Machine hamstring curl (lying).'),
('Nordic Hamstring Curl', 'strength', 'legs', array['hamstrings'], array['bodyweight'], false, 'Partner/anchor-assisted hamstring eccentric.'),
('Glute-Ham Raise', 'strength', 'legs', array['hamstrings','glutes'], array['machine'], false, 'GHR on dedicated station.'),
('Standing Calf Raise', 'strength', 'legs', array['calves'], array['machine'], false, 'Machine standing calf raise.'),
('Seated Calf Raise', 'strength', 'legs', array['calves'], array['machine'], false, 'Machine seated calf raise.'),
('Single-Leg Calf Raise', 'strength', 'legs', array['calves'], array['bodyweight'], false, 'Unilateral calf raise on step.'),
('Dumbbell Calf Raise', 'strength', 'legs', array['calves'], array['dumbbells'], false, 'Calf raise holding dumbbells.'),
('Tibialis Raise', 'strength', 'legs', array['tibialis_anterior'], array['bodyweight'], false, 'Anterior shin raise; ankle resilience.'),
('Hip Abduction Machine', 'strength', 'legs', array['abductors','glute_medius'], array['machine'], false, 'Machine hip abduction.'),
('Hip Adduction Machine', 'strength', 'legs', array['adductors'], array['machine'], false, 'Machine hip adduction.'),

-- =========================
-- STRENGTH — CHEST (PRESS/FLY)
-- =========================
('Barbell Bench Press', 'strength', 'chest', array['pecs','triceps','front_delts'], array['barbell','bench','rack'], false, 'Flat bench press.'),
('Dumbbell Bench Press', 'strength', 'chest', array['pecs','triceps','front_delts'], array['dumbbells','bench'], false, 'Flat dumbbell press.'),
('Incline Barbell Bench Press', 'strength', 'chest', array['upper_pecs','triceps','front_delts'], array['barbell','bench','rack'], false, 'Incline bench press.'),
('Incline Dumbbell Bench Press', 'strength', 'chest', array['upper_pecs','triceps','front_delts'], array['dumbbells','bench'], false, 'Incline dumbbell press.'),
('Decline Barbell Bench Press', 'strength', 'chest', array['lower_pecs','triceps'], array['barbell','bench','rack'], false, 'Decline bench press.'),
('Machine Chest Press', 'strength', 'chest', array['pecs','triceps'], array['machine'], false, 'Chest press machine.'),
('Smith Machine Bench Press', 'strength', 'chest', array['pecs','triceps'], array['smith_machine','bench'], false, 'Bench press on smith machine.'),
('Push-Up', 'strength', 'chest', array['pecs','triceps','front_delts'], array['bodyweight'], false, 'Bodyweight horizontal press.'),
('Incline Push-Up', 'strength', 'chest', array['pecs','triceps'], array['bodyweight','bench'], false, 'Elevated hands push-up.'),
('Decline Push-Up', 'strength', 'chest', array['pecs','triceps','front_delts'], array['bodyweight','bench'], false, 'Feet elevated push-up.'),
('Chest Dip', 'strength', 'chest', array['lower_pecs','triceps'], array['dip_bars','bodyweight'], false, 'Forward-lean dip emphasizing chest.'),
('Dumbbell Fly', 'strength', 'chest', array['pecs'], array['dumbbells','bench'], false, 'Chest fly with dumbbells.'),
('Incline Dumbbell Fly', 'strength', 'chest', array['upper_pecs'], array['dumbbells','bench'], false, 'Incline fly focusing upper chest.'),
('Cable Fly', 'strength', 'chest', array['pecs'], array['cable'], false, 'Cable crossover fly.'),
('Low-to-High Cable Fly', 'strength', 'chest', array['upper_pecs'], array['cable'], false, 'Cables from low to high path.'),
('High-to-Low Cable Fly', 'strength', 'chest', array['lower_pecs'], array['cable'], false, 'Cables from high to low path.'),
('Pec Deck Fly', 'strength', 'chest', array['pecs'], array['machine'], false, 'Machine pec deck fly.'),

-- =========================
-- STRENGTH — BACK (PULL/ROW)
-- =========================
('Pull-Up', 'strength', 'back', array['lats','biceps'], array['pull_up_bar','bodyweight'], false, 'Vertical pull with bodyweight.'),
('Chin-Up', 'strength', 'back', array['lats','biceps'], array['pull_up_bar','bodyweight'], false, 'Supinated grip vertical pull.'),
('Assisted Pull-Up', 'strength', 'back', array['lats','biceps'], array['machine'], false, 'Machine/band assisted pull-up.'),
('Lat Pulldown', 'strength', 'back', array['lats','biceps'], array['cable','machine'], false, 'Cable vertical pull.'),
('Close-Grip Lat Pulldown', 'strength', 'back', array['lats','biceps'], array['cable'], false, 'V-handle lat pulldown.'),
('Straight-Arm Pulldown', 'strength', 'back', array['lats','serratus'], array['cable'], false, 'Lat isolation pulldown with straight arms.'),
('Barbell Bent-Over Row', 'strength', 'back', array['lats','upper_back','rhomboids','biceps'], array['barbell'], false, 'Row with barbell in hip hinge.'),
('Pendlay Row', 'strength', 'back', array['lats','upper_back','rhomboids'], array['barbell'], false, 'Row from floor each rep.'),
('One-Arm Dumbbell Row', 'strength', 'back', array['lats','upper_back','biceps'], array['dumbbells','bench'], false, 'Unilateral row supported on bench.'),
('Chest-Supported Dumbbell Row', 'strength', 'back', array['upper_back','rhomboids','lats'], array['dumbbells','bench'], false, 'Incline bench supported row.'),
('Seated Cable Row', 'strength', 'back', array['lats','rhomboids','biceps'], array['cable'], false, 'Horizontal cable row.'),
('Machine Row', 'strength', 'back', array['upper_back','lats','rhomboids'], array['machine'], false, 'Machine row variation.'),
('T-Bar Row', 'strength', 'back', array['lats','upper_back','rhomboids'], array['machine','barbell'], false, 'T-bar row (landmine or machine).'),
('Landmine Row', 'strength', 'back', array['lats','upper_back'], array['landmine','barbell'], false, 'Row using barbell anchored in landmine.'),
('Inverted Row', 'strength', 'back', array['upper_back','lats','biceps'], array['bodyweight','bar'], false, 'Bodyweight row under bar.'),
('Face Pull', 'strength', 'shoulders', array['rear_delts','upper_back','traps'], array['cable','band'], false, 'Rear delt/upper back pull.'),
('Rear Delt Cable Fly', 'strength', 'shoulders', array['rear_delts','upper_back'], array['cable'], false, 'Cable rear-delt fly.'),
('Dumbbell Rear Delt Fly', 'strength', 'shoulders', array['rear_delts','upper_back'], array['dumbbells'], false, 'Bent-over rear-delt fly.'),
('Shrug', 'strength', 'shoulders', array['traps'], array['dumbbells','barbell'], false, 'Trap shrug.'),

-- =========================
-- STRENGTH — SHOULDERS (PRESS/RAISE)
-- =========================
('Barbell Overhead Press', 'strength', 'shoulders', array['front_delts','triceps','core'], array['barbell','rack'], false, 'Standing overhead press.'),
('Dumbbell Shoulder Press', 'strength', 'shoulders', array['front_delts','triceps'], array['dumbbells','bench'], false, 'Seated or standing DB press.'),
('Arnold Press', 'strength', 'shoulders', array['front_delts','side_delts','triceps'], array['dumbbells'], false, 'Rotational dumbbell press.'),
('Machine Shoulder Press', 'strength', 'shoulders', array['front_delts','triceps'], array['machine'], false, 'Shoulder press machine.'),
('Landmine Press', 'strength', 'shoulders', array['front_delts','serratus','core'], array['landmine','barbell'], false, 'Angled press using landmine.'),
('Dumbbell Lateral Raise', 'strength', 'shoulders', array['side_delts'], array['dumbbells'], false, 'Lateral raise for side delts.'),
('Cable Lateral Raise', 'strength', 'shoulders', array['side_delts'], array['cable'], false, 'Lateral raise using cable.'),
('Dumbbell Front Raise', 'strength', 'shoulders', array['front_delts'], array['dumbbells'], false, 'Front delt isolation raise.'),
('Cable Front Raise', 'strength', 'shoulders', array['front_delts'], array['cable'], false, 'Front raise using cable.'),
('Upright Row', 'strength', 'shoulders', array['side_delts','traps'], array['barbell','dumbbells','cable'], false, 'Vertical pull to chest height.'),

-- =========================
-- STRENGTH — ARMS (BICEPS/TRICEPS/FOREARMS)
-- =========================
('Barbell Biceps Curl', 'strength', 'arms', array['biceps'], array['barbell'], false, 'Standing barbell curl.'),
('Dumbbell Biceps Curl', 'strength', 'arms', array['biceps'], array['dumbbells'], false, 'Alternating or simultaneous DB curl.'),
('Hammer Curl', 'strength', 'arms', array['biceps','brachialis','forearms'], array['dumbbells'], false, 'Neutral-grip curl.'),
('Incline Dumbbell Curl', 'strength', 'arms', array['biceps'], array['dumbbells','bench'], false, 'Incline bench stretch curl.'),
('Preacher Curl', 'strength', 'arms', array['biceps'], array['machine','barbell','dumbbells'], false, 'Curl supported on preacher pad.'),
('Cable Curl', 'strength', 'arms', array['biceps'], array['cable'], false, 'Cable biceps curl.'),
('Triceps Pushdown', 'strength', 'arms', array['triceps'], array['cable'], false, 'Cable pressdown for triceps.'),
('Overhead Triceps Extension', 'strength', 'arms', array['triceps'], array['dumbbells','cable'], false, 'Overhead extension emphasizing long head.'),
('Skull Crusher', 'strength', 'arms', array['triceps'], array['barbell','dumbbells','bench'], false, 'Lying triceps extension.'),
('Close-Grip Bench Press', 'strength', 'chest', array['triceps','pecs'], array['barbell','bench','rack'], false, 'Bench press emphasizing triceps.'),
('Parallel Bar Dip', 'strength', 'arms', array['triceps','pecs'], array['dip_bars','bodyweight'], false, 'Dip emphasizing triceps depending on torso angle.'),
('Cable Triceps Kickback', 'strength', 'arms', array['triceps'], array['cable'], false, 'Triceps extension pattern.'),
('Dumbbell Triceps Kickback', 'strength', 'arms', array['triceps'], array['dumbbells'], false, 'Triceps kickback.'),
('Wrist Curl', 'strength', 'arms', array['forearms'], array['dumbbells','barbell'], false, 'Forearm flexor curl.'),
('Reverse Wrist Curl', 'strength', 'arms', array['forearms'], array['dumbbells','barbell'], false, 'Forearm extensor curl.'),
('Farmer Carry', 'strength', 'full_body', array['forearms','core','traps'], array['dumbbells','kettlebell'], false, 'Loaded carry for grip and trunk.'),

-- =========================
-- STRENGTH — CORE
-- =========================
('Plank', 'strength', 'core', array['abs','obliques'], array['bodyweight'], false, 'Front plank hold.'),
('Side Plank', 'strength', 'core', array['obliques'], array['bodyweight'], false, 'Side plank hold.'),
('Dead Bug', 'strength', 'core', array['abs'], array['bodyweight'], false, 'Anti-extension core drill.'),
('Bird Dog', 'strength', 'core', array['core','lower_back'], array['bodyweight'], false, 'Quadruped trunk stability drill.'),
('Hanging Knee Raise', 'strength', 'core', array['abs','hip_flexors'], array['pull_up_bar'], false, 'Knee raise while hanging.'),
('Hanging Leg Raise', 'strength', 'core', array['abs','hip_flexors'], array['pull_up_bar'], false, 'Leg raise while hanging.'),
('Cable Crunch', 'strength', 'core', array['abs'], array['cable'], false, 'Weighted cable crunch.'),
('Russian Twist', 'strength', 'core', array['obliques'], array['bodyweight','medicine_ball'], false, 'Rotational core work.'),
('Ab Wheel Rollout', 'strength', 'core', array['abs'], array['ab_wheel'], false, 'Anti-extension rollout.'),
('Pallof Press', 'strength', 'core', array['obliques','core'], array['cable','band'], false, 'Anti-rotation press.'),

-- =========================
-- STRENGTH — FULL BODY / POWER
-- =========================
('Kettlebell Swing', 'strength', 'full_body', array['glutes','hamstrings','core'], array['kettlebell'], false, 'Explosive hinge swing.'),
('Dumbbell Thruster', 'strength', 'full_body', array['quads','glutes','shoulders'], array['dumbbells'], false, 'Front squat into overhead press.'),
('Barbell Thruster', 'strength', 'full_body', array['quads','glutes','shoulders'], array['barbell','rack'], false, 'Squat to press with barbell.'),
('Power Clean', 'strength', 'full_body', array['glutes','hamstrings','traps'], array['barbell'], false, 'Explosive pull to rack position.'),
('Hang Power Clean', 'strength', 'full_body', array['glutes','hamstrings','traps'], array['barbell'], false, 'Power clean from hang.'),
('Push Press', 'strength', 'shoulders', array['front_delts','triceps','legs'], array['barbell','rack'], false, 'Dip-drive overhead press.'),
('Medicine Ball Slam', 'strength', 'full_body', array['core','shoulders'], array['medicine_ball'], false, 'Explosive slam for conditioning/power.'),
('Sled Push', 'strength', 'full_body', array['quads','glutes','core'], array['sled'], false, 'Heavy sled push.'),
('Sled Pull', 'strength', 'full_body', array['hamstrings','glutes','back'], array['sled'], false, 'Backward/forward sled pull.'),

-- =========================
-- CARDIO — ENDURANCE MACHINES
-- =========================
('Treadmill Run', 'cardio', 'cardio', array['legs'], array['treadmill'], false, 'Running on treadmill.'),
('Outdoor Run', 'cardio', 'cardio', array['legs'], array['none'], false, 'Running outdoors.'),
('Stationary Bike', 'cardio', 'cardio', array['legs'], array['stationary_bike'], false, 'Indoor cycling.'),
('Outdoor Cycling', 'cardio', 'cardio', array['legs'], array['bicycle'], false, 'Cycling outdoors.'),
('Rowing Machine', 'cardio', 'cardio', array['full_body'], array['rowing_machine'], false, 'Row erg.'),
('Elliptical', 'cardio', 'cardio', array['legs'], array['elliptical_machine'], false, 'Elliptical trainer.'),
('Stair Climber', 'cardio', 'cardio', array['legs','glutes'], array['stair_climber'], false, 'Stair stepping machine.'),
('Ski Erg', 'cardio', 'cardio', array['full_body'], array['ski_erg'], false, 'Ski ergometer.'),

-- CARDIO — BODYWEIGHT / FIELD
('Jump Rope', 'cardio', 'cardio', array['calves','legs'], array['jump_rope'], false, 'Skipping rope.'),
('High Knees', 'cardio', 'cardio', array['legs','core'], array['bodyweight'], false, 'Running-in-place with high knees.'),
('Mountain Climbers', 'cardio', 'cardio', array['core','shoulders','legs'], array['bodyweight'], false, 'Fast alternating knee drives in plank.'),
('Burpees', 'cardio', 'cardio', array['full_body'], array['bodyweight'], false, 'Full-body conditioning movement.'),
('Jumping Jacks', 'cardio', 'cardio', array['full_body'], array['bodyweight'], false, 'Plyometric full-body movement.'),
('Shuttle Run', 'cardio', 'cardio', array['legs'], array['none'], false, 'Back-and-forth sprint intervals.'),
('Hill Sprints', 'cardio', 'cardio', array['legs','glutes'], array['none'], false, 'Sprint intervals on an incline.'),

-- CARDIO — SWIM
('Swimming (Freestyle)', 'cardio', 'cardio', array['full_body'], array['pool'], false, 'Freestyle swim.'),
('Swimming (Breaststroke)', 'cardio', 'cardio', array['full_body'], array['pool'], false, 'Breaststroke swim.'),
('Swimming (Backstroke)', 'cardio', 'cardio', array['full_body'], array['pool'], false, 'Backstroke swim.'),
('Swimming (Butterfly)', 'cardio', 'cardio', array['full_body'], array['pool'], false, 'Butterfly swim.'),

-- CARDIO — WEIGHTED CONDITIONING
('Battle Ropes', 'cardio', 'cardio', array['arms','shoulders','core'], array['battle_ropes'], false, 'Conditioning using battle ropes.'),
('Kettlebell Snatch (Conditioning)', 'cardio', 'cardio', array['full_body'], array['kettlebell'], false, 'High-rep KB snatch conditioning.'),
('Kettlebell Clean & Press (Conditioning)', 'cardio', 'cardio', array['full_body'], array['kettlebell'], false, 'Complex for conditioning.'),
('Sandbag Carry', 'cardio', 'cardio', array['full_body'], array['sandbag'], false, 'Loaded carry for conditioning.'),
('Farmer Carry (Conditioning)', 'cardio', 'cardio', array['full_body'], array['dumbbells','kettlebell'], false, 'Continuous loaded carry conditioning.'),

-- CARDIO — WALK / HIKE
('Brisk Walk', 'cardio', 'cardio', array['legs'], array['none'], false, 'Brisk walking.'),
('Incline Treadmill Walk', 'cardio', 'cardio', array['legs','glutes'], array['treadmill'], false, 'Incline walking on treadmill.'),
('Hiking', 'cardio', 'cardio', array['legs','glutes'], array['none'], false, 'Outdoor hiking.'),

-- =========================
-- STRENGTH — EXTRA COVERAGE (PUSH/PULL/LEGS/CORE)
-- =========================
('Dumbbell Floor Press', 'strength', 'chest', array['pecs','triceps'], array['dumbbells'], false, 'Press lying on floor; limits shoulder extension.'),
('Cable Chest Press', 'strength', 'chest', array['pecs','triceps'], array['cable'], false, 'Standing or seated cable press.'),
('Incline Machine Chest Press', 'strength', 'chest', array['upper_pecs','triceps'], array['machine'], false, 'Incline chest press machine.'),
('Decline Machine Chest Press', 'strength', 'chest', array['lower_pecs','triceps'], array['machine'], false, 'Decline chest press machine.'),
('Weighted Push-Up', 'strength', 'chest', array['pecs','triceps','front_delts'], array['bodyweight','weight_plate'], false, 'Push-up with external load.'),
('Ring Push-Up', 'strength', 'chest', array['pecs','triceps','core'], array['rings'], false, 'Push-up on rings for stability demand.'),
('Ring Dip', 'strength', 'chest', array['pecs','triceps','shoulders'], array['rings'], false, 'Dip on rings; advanced.'),

('Neutral-Grip Pull-Up', 'strength', 'back', array['lats','biceps'], array['pull_up_bar','bodyweight'], false, 'Pull-up with neutral handles.'),
('Wide-Grip Pull-Up', 'strength', 'back', array['lats','upper_back'], array['pull_up_bar','bodyweight'], false, 'Wide grip pull-up.'),
('Wide-Grip Lat Pulldown', 'strength', 'back', array['lats','upper_back'], array['cable'], false, 'Wide grip lat pulldown.'),
('Single-Arm Lat Pulldown', 'strength', 'back', array['lats','biceps'], array['cable'], false, 'Unilateral lat pulldown.'),
('Single-Arm Cable Row', 'strength', 'back', array['lats','rhomboids','biceps'], array['cable'], false, 'Unilateral cable row.'),
('Meadows Row', 'strength', 'back', array['lats','upper_back'], array['landmine','barbell'], false, 'Landmine row variation.'),
('Dumbbell Pullover', 'strength', 'chest', array['pecs','lats'], array['dumbbells','bench'], false, 'Pullover emphasizing lats/pecs depending on form.'),
('Cable Pullover', 'strength', 'back', array['lats'], array['cable'], false, 'Straight-arm cable pullover.'),

('Barbell Hip Hinge (RDL)', 'strength', 'legs', array['hamstrings','glutes'], array['barbell'], false, 'Romanian deadlift style hinge.'),
('Deficit Deadlift', 'strength', 'legs', array['glutes','hamstrings','lower_back'], array['barbell','plate'], false, 'Deadlift standing on a deficit.'),
('Block Pull', 'strength', 'legs', array['glutes','hamstrings','lower_back'], array['barbell','blocks'], false, 'Deadlift from blocks/rack pull height.'),
('Rack Pull', 'strength', 'legs', array['glutes','hamstrings','upper_back'], array['barbell','rack'], false, 'Deadlift from pins/rack.'),
('Barbell Step-Up', 'strength', 'legs', array['quads','glutes','core'], array['barbell','box','bench'], false, 'Step-up with barbell.'),
('Front-Foot Elevated Split Squat', 'strength', 'legs', array['quads','glutes'], array['bodyweight','plate'], false, 'Split squat with front foot elevated.'),
('Dumbbell Front-Foot Elevated Split Squat', 'strength', 'legs', array['quads','glutes'], array['dumbbells','plate'], false, 'FFESS with dumbbells.'),
('Cossack Squat', 'strength', 'legs', array['adductors','glutes','quads'], array['bodyweight'], false, 'Lateral squat for adductors/hips.'),
('Lateral Lunge', 'strength', 'legs', array['adductors','glutes'], array['bodyweight'], false, 'Side lunge.'),
('Dumbbell Lateral Lunge', 'strength', 'legs', array['adductors','glutes'], array['dumbbells'], false, 'Side lunge with dumbbells.'),

('Cable Woodchop', 'strength', 'core', array['obliques'], array['cable'], false, 'Rotational core chop.'),
('Hollow Body Hold', 'strength', 'core', array['abs'], array['bodyweight'], false, 'Hollow hold core position.'),
('Reverse Crunch', 'strength', 'core', array['abs'], array['bodyweight'], false, 'Posterior pelvic tilt crunch.'),
('Bicycle Crunch', 'strength', 'core', array['abs','obliques'], array['bodyweight'], false, 'Alternating bicycle crunch.'),
('Sit-Up', 'strength', 'core', array['abs'], array['bodyweight'], false, 'Full range sit-up.'),
('Weighted Sit-Up', 'strength', 'core', array['abs'], array['bodyweight','weight_plate'], false, 'Sit-up holding plate.'),
('Cable Pallof Press', 'strength', 'core', array['obliques','core'], array['cable'], false, 'Anti-rotation press on cable.'),

-- =========================
-- CARDIO — EXTRA COVERAGE (INTERVALS / SPORTS / MACHINES)
-- =========================
('Air Bike', 'cardio', 'cardio', array['legs','arms'], array['air_bike'], false, 'Fan bike conditioning.'),
('Assault Bike Intervals', 'cardio', 'cardio', array['legs','arms'], array['air_bike'], false, 'Interval protocol on air bike.'),
('Treadmill Intervals', 'cardio', 'cardio', array['legs'], array['treadmill'], false, 'Interval running on treadmill.'),
('Rowing Intervals', 'cardio', 'cardio', array['full_body'], array['rowing_machine'], false, 'Interval rowing on erg.'),
('Stair Climber Intervals', 'cardio', 'cardio', array['legs','glutes'], array['stair_climber'], false, 'Intervals on stair climber.'),
('Elliptical Intervals', 'cardio', 'cardio', array['legs'], array['elliptical_machine'], false, 'Intervals on elliptical.'),
('Box Jumps', 'cardio', 'cardio', array['legs'], array['box','bodyweight'], false, 'Plyometric box jumps for conditioning.'),
('Medicine Ball Throws', 'cardio', 'cardio', array['full_body'], array['medicine_ball'], false, 'Explosive throws for conditioning.'),
('Shadow Boxing', 'cardio', 'cardio', array['full_body'], array['none'], false, 'Light boxing footwork and punches.'),
('Heavy Bag Rounds', 'cardio', 'cardio', array['full_body'], array['heavy_bag'], false, 'Boxing rounds on heavy bag.'),
('Basketball (Pickup)', 'cardio', 'cardio', array['full_body'], array['basketball'], false, 'Sport cardio (pickup basketball).'),
('Soccer (Pickup)', 'cardio', 'cardio', array['full_body'], array['soccer_ball'], false, 'Sport cardio (pickup soccer).'),

-- =========================
-- RECOVERY — MODALITIES (LOG AS RECOVERY SESSIONS)
-- Note: Category = 'recovery' so frontend can auto-classify the session.
-- =========================
('Sauna', 'recovery', 'recovery', array['heat'], array['sauna'], false, 'Dry sauna session. Log time in sets (e.g., 15:00).'),
('Infrared Sauna', 'recovery', 'recovery', array['heat'], array['infrared_sauna'], false, 'Infrared sauna session. Log time.'),
('Steam Room', 'recovery', 'recovery', array['heat'], array['steam_room'], false, 'Steam room session. Log time.'),
('Hot Tub', 'recovery', 'recovery', array['heat'], array['hot_tub'], false, 'Hot tub soak. Log time.'),
('Cold Plunge', 'recovery', 'recovery', array['cold'], array['cold_plunge'], false, 'Cold plunge / cold tub. Log time.'),
('Cold Shower', 'recovery', 'recovery', array['cold'], array['shower'], false, 'Cold shower. Log time.'),
('Contrast Therapy', 'recovery', 'recovery', array['heat','cold'], array['sauna'], false, 'Alternating hot/cold exposure. Log total time and/or rounds.'),
('Breathwork', 'recovery', 'recovery', array['nervous_system'], array['none'], false, 'Guided or self-directed breathwork. Log time.'),
('Meditation', 'recovery', 'recovery', array['nervous_system'], array['none'], false, 'Meditation session. Log time.'),
('Yoga (Recovery)', 'recovery', 'recovery', array['mobility'], array['yoga_mat'], false, 'Light yoga for recovery. Log time.'),
('Stretching (Full Body)', 'recovery', 'recovery', array['mobility'], array['none'], false, 'Full-body stretching. Log time.'),
('Foam Rolling', 'recovery', 'recovery', array['soft_tissue'], array['foam_roller'], false, 'Foam rolling / self-myofascial release. Log time.'),
('Massage Gun', 'recovery', 'recovery', array['soft_tissue'], array['massage_gun'], false, 'Percussive therapy. Log time.'),
('Sports Massage', 'recovery', 'recovery', array['soft_tissue'], array['none'], false, 'Manual massage session. Log time.'),
('Mobility (Hips)', 'recovery', 'recovery', array['mobility','hips'], array['none'], false, 'Hip mobility session. Log time.'),
('Mobility (Shoulders)', 'recovery', 'recovery', array['mobility','shoulders'], array['none'], false, 'Shoulder mobility session. Log time.')
;

-- 3) Verify counts after seed
-- (Run this select after commit if you want)
-- select
--   count(*) as total,
--   sum(case when is_custom = false then 1 else 0 end) as system_exercises,
--   sum(case when is_custom = true then 1 else 0 end) as custom_exercises
-- from public.exercise_library;

commit;


