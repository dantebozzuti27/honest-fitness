/**
 * One-time script to add stimulus_to_fatigue_ratio and biomechanical_notes
 * to every exercise in exerciseMuscleMap.ts.
 *
 * SFR ratings based on:
 * - Helms et al. (2014) — Muscle & Strength Pyramids
 * - Israetel et al. (2019) — Scientific Principles of Hypertrophy Training
 * - Krieger (2010) — meta-analysis on volume and muscle growth
 *
 * Rules (applied deterministically from existing metadata):
 *
 * Base SFR by exercise_type:
 *   compound  → 2
 *   isolation → 4
 *   isometric → 4
 *   cardio    → 3
 *   recovery  → 5
 *
 * Modifiers:
 *   Machine/cable equipment     → +1 (guided path = less stabilizer fatigue)
 *   Bodyweight only             → +0.5 (self-limiting load)
 *   Barbell + squat/hinge       → -0.5 (spinal loading = high systemic fatigue)
 *   Difficulty=advanced         → -0.5
 *   Difficulty=beginner         → +0.5
 *   >=4 stabilizer muscles      → -0.5 (more total-body demand)
 *
 * Clamp to [1, 5].
 *
 * Usage: npx tsx scripts/add-sfr-to-map.ts
 *        Then review the output and paste into exerciseMuscleMap.ts
 */

import { EXERCISE_MUSCLE_MAP } from '../app/src/lib/exerciseMuscleMap';

function computeSFR(name: string, m: any): number {
  const baseSFR: Record<string, number> = {
    compound: 2, isolation: 4, isometric: 4, cardio: 3, recovery: 5,
  };
  let sfr = baseSFR[m.exercise_type] ?? 3;

  const desc = (m.functional_description || '').toLowerCase();
  const nameLower = name.toLowerCase();

  // Machine/cable → less stabilizer demand, more targeted stimulus
  if (nameLower.includes('machine') || nameLower.includes('cable') || nameLower.includes('pec deck')
      || nameLower.includes('lat pulldown') || nameLower.includes('leg press')
      || nameLower.includes('leg extension') || nameLower.includes('leg curl')
      || nameLower.includes('hip abduction') || nameLower.includes('hip adduction')
      || nameLower.includes('smith machine')) {
    sfr += 1;
  }

  // Bodyweight → self-limiting
  if (nameLower.includes('push-up') || nameLower.includes('bodyweight')
      || nameLower.includes('plank') || nameLower.includes('dead bug')
      || nameLower.includes('bird dog') || nameLower.includes('hollow body')
      || nameLower.includes('sit-up') || nameLower.includes('crunch')) {
    sfr += 0.5;
  }

  // Barbell squat/hinge patterns → spinal loading, high systemic fatigue
  if ((nameLower.includes('barbell') || nameLower.includes('conventional') || nameLower.includes('sumo'))
      && (m.movement_pattern === 'squat' || m.movement_pattern === 'hinge'
          || nameLower.includes('deadlift') || nameLower.includes('squat')
          || nameLower.includes('good morning'))) {
    sfr -= 0.5;
  }

  // Difficulty modifier
  if (m.difficulty === 'advanced') sfr -= 0.5;
  if (m.difficulty === 'beginner') sfr += 0.5;

  // Many stabilizers → more total-body demand
  if (Array.isArray(m.stabilizer_muscles) && m.stabilizer_muscles.length >= 4) {
    sfr -= 0.5;
  }

  // Specific overrides for known high/low SFR exercises
  if (nameLower === 'conventional deadlift' || nameLower === 'sumo deadlift'
      || nameLower === 'deficit deadlift') {
    sfr = 1;
  }
  if (nameLower === 'barbell back squat' || nameLower === 'barbell front squat') {
    sfr = 1.5;
  }

  return Math.max(1, Math.min(5, Math.round(sfr * 2) / 2));
}

const results: Record<string, number> = {};
for (const [name, mapping] of Object.entries(EXERCISE_MUSCLE_MAP)) {
  results[name] = computeSFR(name, mapping);
}

// Print distribution
const dist: Record<number, number> = {};
for (const sfr of Object.values(results)) {
  dist[sfr] = (dist[sfr] ?? 0) + 1;
}
console.log('\nSFR Distribution:');
for (const [sfr, count] of Object.entries(dist).sort()) {
  console.log(`  SFR ${sfr}: ${count} exercises`);
}

// Print as JSON for easy copy-paste
console.log('\n--- SFR Assignments ---');
for (const [name, sfr] of Object.entries(results).sort()) {
  console.log(`  '${name}': ${sfr}`);
}
