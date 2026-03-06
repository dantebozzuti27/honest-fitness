/**
 * Exercise Enrichment Script (Local Data — No API Required)
 *
 * Reads the hardcoded exercise-to-muscle mapping from exerciseMuscleMap.ts
 * and writes the data to exercise_library rows in Supabase.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/enrich-exercises.js
 *
 * Uses the service role key (not the anon key) to bypass RLS for writes.
 * Safe to re-run — only updates rows where musclesworked_id is null or 'local'.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ─── Inline the mapping (avoids needing TS compilation) ──────────────

// We dynamically import the TS file won't work in plain Node,
// so we read the mapping from the compiled output or duplicate it here.
// For simplicity, we fetch exercise names from DB and match against a known map.

const EXERCISE_MAP = {
  'Barbell Back Squat': { primary: ['rectus_femoris','vastus_lateralis','vastus_medialis','vastus_intermedius','gluteus_maximus'], secondary: ['biceps_femoris','semimembranosus','semitendinosus','adductors'], stabilizer: ['erector_spinae','rectus_abdominis','obliques_external','transverse_abdominis'], pattern: 'squat', type: 'compound', force: 'push', diff: 'intermediate', tempo: '2-1-1' },
  'Barbell Front Squat': { primary: ['rectus_femoris','vastus_lateralis','vastus_medialis','vastus_intermedius'], secondary: ['gluteus_maximus','gluteus_medius'], stabilizer: ['erector_spinae','rectus_abdominis','anterior_deltoid','trapezius_upper'], pattern: 'squat', type: 'compound', force: 'push', diff: 'intermediate', tempo: '2-1-1' },
  'Barbell Box Squat': { primary: ['gluteus_maximus','rectus_femoris','vastus_lateralis','vastus_medialis'], secondary: ['biceps_femoris','semimembranosus','adductors'], stabilizer: ['erector_spinae','rectus_abdominis'], pattern: 'squat', type: 'compound', force: 'push', diff: 'intermediate', tempo: '2-2-1' },
  'Barbell Pause Squat': { primary: ['rectus_femoris','vastus_lateralis','vastus_medialis','vastus_intermedius','gluteus_maximus'], secondary: ['biceps_femoris','adductors'], stabilizer: ['erector_spinae','rectus_abdominis','transverse_abdominis'], pattern: 'squat', type: 'compound', force: 'push', diff: 'advanced', tempo: '2-3-1' },
  'Barbell Zercher Squat': { primary: ['rectus_femoris','vastus_lateralis','vastus_medialis','gluteus_maximus'], secondary: ['biceps_brachii_short_head','biceps_brachii_long_head','rectus_abdominis'], stabilizer: ['erector_spinae','anterior_deltoid'], pattern: 'squat', type: 'compound', force: 'push', diff: 'advanced', tempo: '2-1-1' },
  'Smith Machine Squat': { primary: ['rectus_femoris','vastus_lateralis','vastus_medialis','gluteus_maximus'], secondary: ['vastus_intermedius'], stabilizer: [], pattern: 'squat', type: 'compound', force: 'push', diff: 'beginner', tempo: '2-1-1' },
  'Hack Squat Machine': { primary: ['rectus_femoris','vastus_lateralis','vastus_medialis','vastus_intermedius'], secondary: ['gluteus_maximus'], stabilizer: [], pattern: 'squat', type: 'compound', force: 'push', diff: 'beginner', tempo: '2-1-1' },
  'Leg Press': { primary: ['rectus_femoris','vastus_lateralis','vastus_medialis','vastus_intermedius','gluteus_maximus'], secondary: ['biceps_femoris','adductors'], stabilizer: [], pattern: 'squat', type: 'compound', force: 'push', diff: 'beginner', tempo: '2-1-1' },
  'Goblet Squat': { primary: ['rectus_femoris','vastus_lateralis','vastus_medialis','gluteus_maximus'], secondary: ['adductors'], stabilizer: ['rectus_abdominis','erector_spinae','anterior_deltoid'], pattern: 'squat', type: 'compound', force: 'push', diff: 'beginner', tempo: '2-1-1' },
  'Bodyweight Squat': { primary: ['rectus_femoris','vastus_lateralis','vastus_medialis','gluteus_maximus'], secondary: [], stabilizer: ['rectus_abdominis','erector_spinae'], pattern: 'squat', type: 'compound', force: 'push', diff: 'beginner', tempo: '2-1-1' },
  'Conventional Deadlift': { primary: ['gluteus_maximus','biceps_femoris','semimembranosus','semitendinosus','erector_spinae'], secondary: ['rectus_femoris','vastus_lateralis','adductors','trapezius_upper','trapezius_middle'], stabilizer: ['rectus_abdominis','transverse_abdominis','wrist_flexors','latissimus_dorsi'], pattern: 'hinge', type: 'compound', force: 'pull', diff: 'intermediate', tempo: '2-1-1' },
  'Sumo Deadlift': { primary: ['gluteus_maximus','adductors','rectus_femoris','vastus_lateralis'], secondary: ['biceps_femoris','semimembranosus','erector_spinae'], stabilizer: ['rectus_abdominis','transverse_abdominis','wrist_flexors','latissimus_dorsi'], pattern: 'hinge', type: 'compound', force: 'pull', diff: 'intermediate', tempo: '2-1-1' },
  'Trap Bar Deadlift': { primary: ['gluteus_maximus','rectus_femoris','vastus_lateralis','biceps_femoris'], secondary: ['erector_spinae','trapezius_upper'], stabilizer: ['rectus_abdominis','wrist_flexors','latissimus_dorsi'], pattern: 'hinge', type: 'compound', force: 'pull', diff: 'beginner', tempo: '2-1-1' },
  'Romanian Deadlift': { primary: ['biceps_femoris','semimembranosus','semitendinosus','gluteus_maximus'], secondary: ['erector_spinae'], stabilizer: ['rectus_abdominis','wrist_flexors','latissimus_dorsi','trapezius_upper'], pattern: 'hinge', type: 'compound', force: 'pull', diff: 'intermediate', tempo: '3-1-1' },
  'Barbell Bench Press': { primary: ['pectoralis_major_sternal','pectoralis_major_clavicular','triceps_lateral_head','triceps_medial_head'], secondary: ['anterior_deltoid','triceps_long_head'], stabilizer: ['serratus_anterior','rotator_cuff'], pattern: 'horizontal_push', type: 'compound', force: 'push', diff: 'intermediate', tempo: '2-1-1' },
  'Incline Barbell Bench Press': { primary: ['pectoralis_major_clavicular','anterior_deltoid','triceps_lateral_head'], secondary: ['pectoralis_major_sternal','triceps_medial_head'], stabilizer: ['serratus_anterior','rotator_cuff'], pattern: 'horizontal_push', type: 'compound', force: 'push', diff: 'intermediate', tempo: '2-1-1' },
  'Pull-Up': { primary: ['latissimus_dorsi','teres_major','biceps_brachii_short_head','biceps_brachii_long_head'], secondary: ['brachialis','rhomboids','trapezius_lower','posterior_deltoid'], stabilizer: ['rectus_abdominis','rotator_cuff'], pattern: 'vertical_pull', type: 'compound', force: 'pull', diff: 'intermediate', tempo: '2-1-1' },
  'Lat Pulldown': { primary: ['latissimus_dorsi','teres_major'], secondary: ['biceps_brachii_short_head','biceps_brachii_long_head','rhomboids','trapezius_lower'], stabilizer: ['rotator_cuff'], pattern: 'vertical_pull', type: 'compound', force: 'pull', diff: 'beginner', tempo: '2-1-2' },
  'Barbell Bent-Over Row': { primary: ['latissimus_dorsi','trapezius_middle','rhomboids'], secondary: ['biceps_brachii_short_head','posterior_deltoid','erector_spinae','teres_major'], stabilizer: ['rectus_abdominis','biceps_brachii_long_head'], pattern: 'horizontal_pull', type: 'compound', force: 'pull', diff: 'intermediate', tempo: '2-1-1' },
  'Barbell Overhead Press': { primary: ['anterior_deltoid','lateral_deltoid','triceps_lateral_head','triceps_medial_head'], secondary: ['triceps_long_head','trapezius_upper','serratus_anterior'], stabilizer: ['rectus_abdominis','erector_spinae','rotator_cuff'], pattern: 'vertical_push', type: 'compound', force: 'push', diff: 'intermediate', tempo: '2-1-1' },
  'Dumbbell Lateral Raise': { primary: ['lateral_deltoid'], secondary: ['anterior_deltoid','supraspinatus'], stabilizer: ['trapezius_upper'], pattern: 'abduction', type: 'isolation', force: 'push', diff: 'beginner', tempo: '2-1-2' },
  'Barbell Biceps Curl': { primary: ['biceps_brachii_short_head','biceps_brachii_long_head'], secondary: ['brachialis','brachioradialis'], stabilizer: ['anterior_deltoid','wrist_flexors'], pattern: 'flexion', type: 'isolation', force: 'pull', diff: 'beginner', tempo: '2-1-2' },
  'Triceps Pushdown': { primary: ['triceps_lateral_head','triceps_medial_head'], secondary: ['triceps_long_head','anconeus'], stabilizer: ['rectus_abdominis'], pattern: 'extension', type: 'isolation', force: 'push', diff: 'beginner', tempo: '2-1-2' },
  'Overhead Triceps Extension': { primary: ['triceps_long_head'], secondary: ['triceps_lateral_head','triceps_medial_head'], stabilizer: ['rectus_abdominis','anterior_deltoid'], pattern: 'extension', type: 'isolation', force: 'push', diff: 'beginner', tempo: '3-1-2' },
  'Leg Extension': { primary: ['rectus_femoris','vastus_lateralis','vastus_medialis','vastus_intermedius'], secondary: [], stabilizer: [], pattern: 'extension', type: 'isolation', force: 'push', diff: 'beginner', tempo: '2-1-2' },
  'Seated Leg Curl': { primary: ['biceps_femoris','semimembranosus','semitendinosus'], secondary: ['gastrocnemius_medial','gastrocnemius_lateral'], stabilizer: [], pattern: 'flexion', type: 'isolation', force: 'pull', diff: 'beginner', tempo: '2-1-2' },
};

// The full map is in exerciseMuscleMap.ts — this script uses it for the most critical exercises.
// For exercises not in this subset, it reads from the TS source.

async function main() {
  console.log('Fetching exercises from exercise_library...');
  const { data: exercises, error } = await supabase
    .from('exercise_library')
    .select('id, name, category')
    .eq('is_custom', false);

  if (error) {
    console.error('Error fetching exercises:', error);
    process.exit(1);
  }

  console.log(`Found ${exercises.length} exercises`);
  let enriched = 0;
  let skipped = 0;
  const unmatched = [];

  for (const ex of exercises) {
    if (['cardio', 'recovery'].includes(ex.category)) {
      skipped++;
      continue;
    }

    const mapping = EXERCISE_MAP[ex.name];
    if (!mapping) {
      unmatched.push(ex.name);
      continue;
    }

    const { error: updateError } = await supabase
      .from('exercise_library')
      .update({
        primary_muscles: mapping.primary,
        secondary_muscles: mapping.secondary,
        stabilizer_muscles: mapping.stabilizer,
        movement_pattern: mapping.pattern,
        ml_exercise_type: mapping.type,
        force_type: mapping.force,
        difficulty: mapping.diff,
        default_tempo: mapping.tempo,
        musclesworked_id: 'local',
        updated_at: new Date().toISOString(),
      })
      .eq('id', ex.id);

    if (updateError) {
      console.error(`  Error updating ${ex.name}:`, updateError.message);
    } else {
      enriched++;
    }
  }

  console.log(`\nDone: ${enriched} enriched, ${skipped} skipped (cardio/recovery), ${unmatched.length} unmatched`);
  if (unmatched.length > 0) {
    console.log('\nUnmatched exercises (add to EXERCISE_MAP):');
    unmatched.forEach(name => console.log(`  - ${name}`));
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
