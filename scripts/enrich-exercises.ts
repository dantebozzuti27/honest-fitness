/**
 * Exercise Enrichment Script (Local Data — No API Required)
 *
 * Reads the hardcoded exercise-to-muscle mapping from exerciseMuscleMap.ts
 * and writes the data to exercise_library rows in Supabase.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... npx tsx scripts/enrich-exercises.ts
 *
 * Uses the service role key (not the anon key) to bypass RLS for writes.
 * Safe to re-run — updates all rows matching by name.
 */

import { createClient } from '@supabase/supabase-js';
import { EXERCISE_MUSCLE_MAP, getExerciseMapping } from '../app/src/lib/exerciseMuscleMap';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

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

  console.log(`Found ${exercises.length} exercises in DB`);
  console.log(`Local map has ${Object.keys(EXERCISE_MUSCLE_MAP).length} entries\n`);

  let enriched = 0;
  let skipped = 0;
  const unmatched: string[] = [];

  for (const ex of exercises) {
    const mapping = getExerciseMapping(ex.name);
    if (!mapping) {
      unmatched.push(`${ex.name} [${ex.category}]`);
      continue;
    }

    const { error: updateError } = await supabase
      .from('exercise_library')
      .update({
        primary_muscles: mapping.primary_muscles,
        secondary_muscles: mapping.secondary_muscles,
        stabilizer_muscles: mapping.stabilizer_muscles,
        movement_pattern: mapping.movement_pattern,
        ml_exercise_type: mapping.exercise_type,
        force_type: mapping.force_type,
        difficulty: mapping.difficulty,
        default_tempo: mapping.default_tempo,
        functional_description: mapping.functional_description,
        musclesworked_id: 'local',
        updated_at: new Date().toISOString(),
      })
      .eq('id', ex.id);

    if (updateError) {
      console.error(`  ✗ ${ex.name}: ${updateError.message}`);
    } else {
      enriched++;
      if (enriched % 20 === 0) console.log(`  ... enriched ${enriched} exercises`);
    }
  }

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`Done: ${enriched} enriched, ${unmatched.length} unmatched`);
  if (unmatched.length > 0) {
    console.log('\nUnmatched exercises (need to add to exerciseMuscleMap.ts):');
    unmatched.forEach(name => console.log(`  - ${name}`));
  }
  console.log(`${'═'.repeat(50)}`);

  // Data integrity check
  console.log('\n--- Data Integrity Verification ---');
  const { count: totalExercises } = await supabase
    .from('exercise_library')
    .select('*', { count: 'exact', head: true })
    .eq('is_custom', false);

  const { count: enrichedCount } = await supabase
    .from('exercise_library')
    .select('*', { count: 'exact', head: true })
    .eq('is_custom', false)
    .not('primary_muscles', 'is', null);

  console.log(`Total system exercises: ${totalExercises}`);
  console.log(`Exercises with muscle data: ${enrichedCount}`);
  console.log(`Coverage: ${totalExercises ? Math.round((enrichedCount! / totalExercises) * 100) : 0}%`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
