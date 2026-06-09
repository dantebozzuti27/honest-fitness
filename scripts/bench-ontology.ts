/**
 * Microbenchmark for the exercise-ontology hot path.
 *
 * Simulates the per-candidate ontology resolution that workout generation runs
 * thousands of times: identity resolution, family keying, mapping lookup, and
 * family-diversity scoring across the full library.
 *
 * Usage: npx tsx scripts/bench-ontology.ts
 */

import { EXERCISE_MUSCLE_MAP, getExerciseMapping } from '../app/src/lib/exerciseMuscleMap.ts';
import {
  resolveExerciseIdentity,
  exerciseFamilyKey,
  familyDiversityBonus,
  preferenceAggregationKey,
  inferMuscleEmphasis,
} from '../app/src/lib/exerciseOntology.ts';

const names = Object.keys(EXERCISE_MUSCLE_MAP);
// Mix in some non-exact / user-typed variants that miss the exact-key fast path
// and exercise the canonicalize + regex fallback (the genuinely slow branch).
const messy = ['hack squats', 'pull ups', 'incline db press', 'rdl', 'pendulum squats', 'bicep curls'];
const pool = [...names, ...messy];
const selected = names.slice(0, 4);

function workload(iters: number): number {
  let acc = 0;
  for (let i = 0; i < iters; i++) {
    for (const n of pool) {
      const id = resolveExerciseIdentity(n);
      acc += id.primaryGroups.length;
      acc += exerciseFamilyKey(n).length;
      acc += getExerciseMapping(n) ? 1 : 0;
      acc += familyDiversityBonus(n, selected, 'biceps');
      acc += preferenceAggregationKey(n).length;
      acc += inferMuscleEmphasis(n, 'biceps') ? 1 : 0;
    }
  }
  return acc;
}

workload(3); // warmup / JIT

const ITERS = 300;
const t0 = performance.now();
const r = workload(ITERS);
const t1 = performance.now();

const callsPerName = 6;
const totalCalls = ITERS * pool.length * callsPerName;
const ms = t1 - t0;
console.log(
  `pool=${pool.length} iters=${ITERS} resolver-calls=${totalCalls.toLocaleString()} ` +
    `total=${ms.toFixed(1)}ms us/resolver-call=${((ms * 1000) / totalCalls).toFixed(3)} ` +
    `gen-equivalents/s≈${((ITERS / ms) * 1000).toFixed(0)} (acc=${r})`,
);
