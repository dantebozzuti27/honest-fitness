/**
 * Smart superset pairing logic for workout exercises.
 *
 * Takes an ordered list of exercises and suggests superset pairings based on
 * three evidence-supported strategies: antagonist pairing, pre-exhaust, and
 * compound sets.
 *
 * References:
 *   - Robbins, D.W. et al. (2010). "The effect of an upper-body agonist-antagonist
 *     resistance training protocol on volume load and efficiency."
 *     Journal of Strength and Conditioning Research, 24(10), 2632–2640.
 *   - Paz, G.A. et al. (2017). "Effects of different antagonist protocols on
 *     repetition performance and muscle activation."
 *     Medicina Sportiva, 13(2), 2895–2905.
 */

export type SupersetType = 'antagonist' | 'pre_exhaust' | 'compound_set';

export interface SupersetSuggestion {
  groupId: number;
  type: SupersetType;
  exerciseIndices: [number, number];
  rationale: string;
  timeSavedMinutes: number;
}

/**
 * Bidirectional antagonist muscle group pairs.
 * Each entry represents two muscle groups that oppose each other's action,
 * allowing one to recover while the other works.
 */
const ANTAGONIST_PAIRS: ReadonlyArray<[string, string]> = [
  ['chest', 'back_lats'],
  ['chest', 'back_upper'],
  ['biceps', 'triceps'],
  ['quadriceps', 'hamstrings'],
  ['anterior_deltoid', 'posterior_deltoid'],
  ['core', 'erector_spinae'],
];

/**
 * Checks whether two muscle groups form an antagonist pair (order-independent).
 */
export function isAntagonistPair(groupA: string, groupB: string): boolean {
  return ANTAGONIST_PAIRS.some(
    ([a, b]) => (a === groupA && b === groupB) || (a === groupB && b === groupA),
  );
}

interface ExerciseInput {
  exerciseName: string;
  targetMuscleGroup: string;
  movementPattern: string;
  sets: number;
  restSeconds: number;
  isCardio: boolean;
  exerciseRole?: string;
}

function estimateTimeSavedMinutes(ex1: ExerciseInput, ex2: ExerciseInput): number {
  const avgSets = (ex1.sets + ex2.sets) / 2;
  const avgRest = (ex1.restSeconds + ex2.restSeconds) / 2;
  return (avgSets * avgRest) / 2 / 60;
}

function tryAntagonistPair(
  exercises: ExerciseInput[],
  i: number,
  j: number,
): SupersetSuggestion | null {
  const a = exercises[i];
  const b = exercises[j];
  if (!isAntagonistPair(a.targetMuscleGroup, b.targetMuscleGroup)) return null;

  return {
    groupId: 0,
    type: 'antagonist',
    exerciseIndices: [i, j],
    rationale:
      `Antagonist superset: ${a.exerciseName} (${a.targetMuscleGroup}) ↔ ` +
      `${b.exerciseName} (${b.targetMuscleGroup}). ` +
      `One muscle recovers while the other works (Robbins et al., 2010).`,
    timeSavedMinutes: estimateTimeSavedMinutes(a, b),
  };
}

function tryPreExhaustPair(
  exercises: ExerciseInput[],
  i: number,
  j: number,
): SupersetSuggestion | null {
  const first = exercises[i];
  const second = exercises[j];

  if (first.targetMuscleGroup !== second.targetMuscleGroup) return null;

  const firstType = first.exerciseRole ?? first.movementPattern;
  const secondType = second.exerciseRole ?? second.movementPattern;

  if (firstType !== 'isolation' || secondType !== 'compound') return null;

  return {
    groupId: 0,
    type: 'pre_exhaust',
    exerciseIndices: [i, j],
    rationale:
      `Pre-exhaust: ${first.exerciseName} (isolation) → ${second.exerciseName} (compound) ` +
      `for ${first.targetMuscleGroup}. Fatigues the target muscle before compound loading (Paz et al., 2017).`,
    timeSavedMinutes: estimateTimeSavedMinutes(first, second),
  };
}

function tryCompoundSetPair(
  exercises: ExerciseInput[],
  i: number,
  j: number,
): SupersetSuggestion | null {
  const a = exercises[i];
  const b = exercises[j];

  if (a.targetMuscleGroup !== b.targetMuscleGroup) return null;
  if (a.movementPattern === b.movementPattern) return null;

  return {
    groupId: 0,
    type: 'compound_set',
    exerciseIndices: [i, j],
    rationale:
      `Compound set: ${a.exerciseName} (${a.movementPattern}) + ` +
      `${b.exerciseName} (${b.movementPattern}) for ${a.targetMuscleGroup}. ` +
      `Different angles maximize fiber recruitment within the same muscle group.`,
    timeSavedMinutes: estimateTimeSavedMinutes(a, b),
  };
}

/**
 * Suggests superset pairings for an ordered list of exercises.
 *
 * Priority order:
 *   1. Antagonist pairs — strongest evidence for maintaining performance
 *   2. Pre-exhaust pairs — isolation before compound on the same muscle
 *   3. Compound sets — two exercises, same muscle, different movement patterns
 *
 * Each exercise appears in at most one superset. Cardio exercises are excluded.
 */
export function suggestSupersets(exercises: ExerciseInput[]): SupersetSuggestion[] {
  const paired = new Set<number>();
  const suggestions: SupersetSuggestion[] = [];
  let nextGroupId = 1;

  const eligible = exercises
    .map((ex, idx) => ({ ex, idx }))
    .filter(({ ex }) => !ex.isCardio);

  type PairFn = (exs: ExerciseInput[], i: number, j: number) => SupersetSuggestion | null;

  const strategies: PairFn[] = [tryAntagonistPair, tryPreExhaustPair, tryCompoundSetPair];

  for (const strategy of strategies) {
    for (let a = 0; a < eligible.length; a++) {
      if (paired.has(eligible[a].idx)) continue;

      for (let b = a + 1; b < eligible.length; b++) {
        if (paired.has(eligible[b].idx)) continue;

        const suggestion = strategy(exercises, eligible[a].idx, eligible[b].idx);
        if (suggestion) {
          suggestion.groupId = nextGroupId++;
          suggestions.push(suggestion);
          paired.add(eligible[a].idx);
          paired.add(eligible[b].idx);
          break;
        }
      }
    }
  }

  return suggestions.sort((a, b) => a.groupId - b.groupId);
}
