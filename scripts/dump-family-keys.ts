/** Dump exerciseFamilyKey for every library exercise (+ aliases) for diffing. */
import { EXERCISE_MUSCLE_MAP } from '../app/src/lib/exerciseMuscleMap.ts';
import { exerciseFamilyKey } from '../app/src/lib/exerciseOntology.ts';

const extra = ['Lying Leg Curl', 'Seated Leg Curl', 'Nordic Hamstring Curl', 'Leg Curls', 'Reverse Wrist Curl', 'Wrist Curl'];
const names = [...new Set([...Object.keys(EXERCISE_MUSCLE_MAP), ...extra])].sort();
for (const n of names) {
  console.log(`${exerciseFamilyKey(n)}\t${n}`);
}
