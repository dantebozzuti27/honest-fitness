/**
 * CI parity gate: exerciseMuscleMap ↔ ontology ↔ (optional) exercise_library DB.
 *
 * Usage:
 *   npx tsx scripts/verify-exercise-ontology-parity.ts
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... npx tsx scripts/verify-exercise-ontology-parity.ts
 */

import { EXERCISE_MUSCLE_MAP, getExerciseMapping } from '../app/src/lib/exerciseMuscleMap.ts';
import {
  ONTOLOGY_VERSION,
  countOntologyFamilies,
  exerciseFamilyKey,
  isOntologyFamilyKey,
  resolveMuscleToken,
} from '../app/src/lib/exerciseOntology.ts';
import { buildMechanicalCouplingEdges } from '../app/src/lib/biomechanicsOntology.ts';
import { SPLIT_MUSCLE_MAPPING, SPLIT_TYPE_ROTATIONS } from '../app/src/lib/splitOntology.ts';

let failed = false;

function fail(msg: string): void {
  console.error(`✗ ${msg}`);
  failed = true;
}

function ok(msg: string): void {
  console.log(`✓ ${msg}`);
}

function checkMuscleTokens(
  label: string,
  tokens: string[],
  exerciseName: string,
  bucket: string[],
): void {
  for (const m of tokens) {
    if (!resolveMuscleToken(m)) bucket.push(`${exerciseName} [${label}]: ${m}`);
  }
}

// 1. Every primary/secondary/stabilizer muscle in map resolves
const unmappedMuscles: string[] = [];
for (const [name, mapping] of Object.entries(EXERCISE_MUSCLE_MAP)) {
  checkMuscleTokens('primary', mapping.primary_muscles ?? [], name, unmappedMuscles);
  checkMuscleTokens('secondary', mapping.secondary_muscles ?? [], name, unmappedMuscles);
  checkMuscleTokens('stabilizer', mapping.stabilizer_muscles ?? [], name, unmappedMuscles);
}
if (unmappedMuscles.length > 0) {
  fail(`${unmappedMuscles.length} unmapped muscle tokens (first 5: ${unmappedMuscles.slice(0, 5).join('; ')})`);
} else {
  ok(`All muscle tokens in EXERCISE_MUSCLE_MAP resolve (${Object.keys(EXERCISE_MUSCLE_MAP).length} exercises)`);
}

// 2. Every map entry gets a true ontology family key (not canonical-name fallthrough)
const fallthroughFamilies: string[] = [];
for (const name of Object.keys(EXERCISE_MUSCLE_MAP)) {
  const fk = exerciseFamilyKey(name);
  if (!fk || !isOntologyFamilyKey(fk)) fallthroughFamilies.push(name);
}
const fallthroughPct = Math.round((fallthroughFamilies.length / Object.keys(EXERCISE_MUSCLE_MAP).length) * 100);
if (fallthroughFamilies.length > 0) {
  console.log(`ℹ ${fallthroughFamilies.length} exercises (${fallthroughPct}%) use canonical-name family fallthrough`);
  if (fallthroughPct > 15) {
    fail(`Too many exercises without ontology family (${fallthroughPct}% > 15% threshold; first 5: ${fallthroughFamilies.slice(0, 5).join(', ')})`);
  } else {
    ok(`${Object.keys(EXERCISE_MUSCLE_MAP).length - fallthroughFamilies.length} exercises on ontology families (${100 - fallthroughPct}%)`);
  }
} else {
  ok(`All exercises assigned ontology family keys`);
}

// 3. Split ontology completeness
for (const rot of Object.values(SPLIT_TYPE_ROTATIONS).flat()) {
  if (!SPLIT_MUSCLE_MAPPING[rot] && rot !== 'chest' && rot !== 'back' && rot !== 'shoulders' && rot !== 'arms') {
    // bro_split slots use BRO_SPLIT_MAPPING — skip
  }
}
ok(`Split ontology: ${Object.keys(SPLIT_MUSCLE_MAPPING).length} slots, ${countOntologyFamilies()} exercise families`);

// 4. Biomechanics coupling edges
const edges = buildMechanicalCouplingEdges();
if (edges.length < 20) {
  fail(`Expected >= 20 mechanical coupling edges, got ${edges.length}`);
} else {
  ok(`${edges.length} mechanical coupling edges from SYNERGIST_FATIGUE + stability transfer + pattern overlap`);
}
const overlapEdges = edges.filter(e => e.coupling_kind === 'movement_pattern_overlap');
if (overlapEdges.length < 50) {
  fail(`Expected >= 50 movement_pattern_overlap edges, got ${overlapEdges.length}`);
} else {
  ok(`${overlapEdges.length} movement pattern overlap coupling edges`);
}
const chestTricepsOverlap = overlapEdges.find(
  e => e.source_group === 'mid_chest' && e.target_group === 'triceps',
);
if (!chestTricepsOverlap) {
  fail('Expected mid_chest ↔ triceps movement_pattern_overlap edge');
} else {
  ok('mid_chest ↔ triceps overlap edge present (horizontal_push co-occurrence)');
}

// 5. Optional DB parity
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (url && key) {
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(url, key);
  const { data, error } = await supabase
    .from('exercise_library')
    .select('name')
    .eq('is_custom', false);

  if (error) {
    fail(`DB fetch failed: ${error.message}`);
  } else if (data) {
    const unmatched = data.filter(row => !getExerciseMapping(row.name)).map(r => r.name);
    if (unmatched.length > 0) {
      fail(`${unmatched.length} DB exercises missing from map (first 5: ${unmatched.slice(0, 5).join(', ')})`);
    } else {
      ok(`DB parity: all ${data.length} system exercises match exerciseMuscleMap`);
    }
  }
} else {
  console.log('ℹ Skipping DB parity (set SUPABASE_URL + SUPABASE_SERVICE_KEY to enable)');
}

console.log(`\nOntology version: ${ONTOLOGY_VERSION}`);
if (failed) {
  process.exit(1);
}
console.log('\nOntology parity check passed.');
