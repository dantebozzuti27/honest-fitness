/**
 * Shadowing audit: for every library exercise, report all family rules whose
 * regex matches, and the winner chosen by the priority-ranked matcher. Cases
 * where >1 rule matches are where authoring order / priority actually decides
 * the family — the places a generic rule could be silently shadowing a more
 * specific one.
 *
 * Usage: npx tsx scripts/audit-family-shadowing.ts
 */
import { EXERCISE_MUSCLE_MAP } from '../app/src/lib/exerciseMuscleMap.ts';
import { exerciseFamilyKey, __debugMatchingFamilyRules } from '../app/src/lib/exerciseOntology.ts';

const names = Object.keys(EXERCISE_MUSCLE_MAP).sort();
let multi = 0;
for (const name of names) {
  const matches = __debugMatchingFamilyRules(name); // [{id, priority}], in rank order
  if (matches.length <= 1) continue;
  multi++;
  const winner = exerciseFamilyKey(name);
  const others = matches.filter(m => m.id !== winner).map(m => `${m.id}(p${m.priority})`);
  console.log(`${name}\n    winner: ${winner}\n    also matched: ${others.join(', ')}`);
}
console.log(`\n${multi} of ${names.length} exercises match >1 family rule.`);
