/**
 * Injects stimulus_to_fatigue_ratio into exerciseMuscleMap.ts entries.
 * Reads the file, adds the field after functional_description (or cardio_fatigue_factor),
 * and writes it back.
 */

import * as fs from 'fs';
import * as path from 'path';
import { EXERCISE_MUSCLE_MAP } from '../app/src/lib/exerciseMuscleMap';

function computeSFR(name: string, m: any): number {
  const baseSFR: Record<string, number> = {
    compound: 2, isolation: 4, isometric: 4, cardio: 3, recovery: 5,
  };
  let sfr = baseSFR[m.exercise_type] ?? 3;
  const nameLower = name.toLowerCase();

  if (nameLower.includes('machine') || nameLower.includes('cable') || nameLower.includes('pec deck')
      || nameLower.includes('lat pulldown') || nameLower.includes('leg press')
      || nameLower.includes('leg extension') || nameLower.includes('leg curl')
      || nameLower.includes('hip abduction') || nameLower.includes('hip adduction')
      || nameLower.includes('smith machine')) {
    sfr += 1;
  }

  if (nameLower.includes('push-up') || nameLower.includes('bodyweight')
      || nameLower.includes('plank') || nameLower.includes('dead bug')
      || nameLower.includes('bird dog') || nameLower.includes('hollow body')
      || nameLower.includes('sit-up') || nameLower.includes('crunch')) {
    sfr += 0.5;
  }

  if ((nameLower.includes('barbell') || nameLower.includes('conventional') || nameLower.includes('sumo'))
      && (m.movement_pattern === 'squat' || m.movement_pattern === 'hinge'
          || nameLower.includes('deadlift') || nameLower.includes('squat')
          || nameLower.includes('good morning'))) {
    sfr -= 0.5;
  }

  if (m.difficulty === 'advanced') sfr -= 0.5;
  if (m.difficulty === 'beginner') sfr += 0.5;

  if (Array.isArray(m.stabilizer_muscles) && m.stabilizer_muscles.length >= 4) {
    sfr -= 0.5;
  }

  if (nameLower === 'conventional deadlift' || nameLower === 'sumo deadlift'
      || nameLower === 'deficit deadlift') {
    sfr = 1;
  }
  if (nameLower === 'barbell back squat' || nameLower === 'barbell front squat') {
    sfr = 1.5;
  }

  return Math.max(1, Math.min(5, Math.round(sfr * 2) / 2));
}

const sfrMap = new Map<string, number>();
for (const [name, mapping] of Object.entries(EXERCISE_MUSCLE_MAP)) {
  sfrMap.set(name, computeSFR(name, mapping));
}

const filePath = path.resolve(import.meta.dirname, '../app/src/lib/exerciseMuscleMap.ts');
let content = fs.readFileSync(filePath, 'utf-8');

let injected = 0;
for (const [name, sfr] of sfrMap) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Match the closing of each exercise entry: find the last property line before the closing },
  // We'll add stimulus_to_fatigue_ratio after functional_description or cardio_fatigue_factor
  
  // Pattern: find the exercise block and add SFR before the closing },
  // Look for the functional_description or cardio_fatigue_factor line followed by optional },
  const patterns = [
    // Has cardio_fatigue_factor — add after it
    new RegExp(
      `('${escapedName}':\\s*\\{[\\s\\S]*?cardio_fatigue_factor:\\s*[\\d.]+,?)\\s*\\n(\\s*\\})`,
    ),
    // Has functional_description as last field — add after it  
    new RegExp(
      `('${escapedName}':\\s*\\{[\\s\\S]*?functional_description:\\s*'[^']*',?)\\s*\\n(\\s*\\})`,
    ),
  ];

  let matched = false;
  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) {
      const lastProp = match[1].endsWith(',') ? match[1] : match[1] + ',';
      content = content.replace(pattern, `${lastProp}\n    stimulus_to_fatigue_ratio: ${sfr},\n${match[2]}`);
      injected++;
      matched = true;
      break;
    }
  }
  if (!matched) {
    // Fallback: couldn't match — skip and report
    console.log(`  SKIP: ${name} (couldn't find insertion point)`);
  }
}

fs.writeFileSync(filePath, content);
console.log(`\nInjected SFR into ${injected} of ${sfrMap.size} entries`);
