/**
 * Surgical exercise swap — one-slot replacement using learned affinities.
 *
 * Replaces full-session regenerate + unbounded exercises_to_avoid growth.
 */

import type { TrainingProfile, EnrichedExercise } from './trainingAnalysis';
import type { GeneratedExercise, GeneratedWorkout } from './workoutEngine';
import {
  familyDiversityBonus,
  findByExerciseFamily,
  preferenceAggregationKey,
  resolveMuscleToken,
  substitutionCompatibilityScore,
} from './exerciseOntology';

export interface SurgicalSwapResult {
  workout: GeneratedWorkout;
  replacementName: string | null;
  method: 'affinity' | 'library' | 'none';
}

function scoreCandidate(
  ex: EnrichedExercise,
  targetGroup: string,
  fromName: string,
  profile: TrainingProfile,
  inWorkout: Set<string>,
  sameGroupInWorkout: string[],
): number {
  const key = ex.name.toLowerCase();
  if (inWorkout.has(key)) return -999;
  if (key === fromName.toLowerCase()) return -999;

  const groups = (Array.isArray(ex.primary_muscles) ? ex.primary_muscles : [])
    .map(m => resolveMuscleToken(m))
    .filter(Boolean);
  if (!groups.includes(targetGroup as typeof groups[number])) return -999;

  let score = substitutionCompatibilityScore(fromName, ex.name, targetGroup);
  if (score <= 0) return -999;
  score += familyDiversityBonus(ex.name, sameGroupInWorkout, targetGroup);
  for (const a of profile.substitutionAffinities ?? []) {
    const fromKey = preferenceAggregationKey(a.fromExercise);
    const toKey = preferenceAggregationKey(a.toExercise);
    if (
      fromKey === preferenceAggregationKey(fromName)
      && toKey === preferenceAggregationKey(ex.name)
    ) {
      score += Math.min(40, a.affinity * 2);
    }
  }
  const acceptance = findByExerciseFamily(profile.exerciseAcceptances, ex.name);
  if (acceptance) score += Math.min(15, acceptance.effectiveWeight * 15);

  const swapPen = findByExerciseFamily(profile.exerciseSwapHistory, ex.name);
  if (swapPen && swapPen.swapCount >= 2) score -= Math.min(20, swapPen.swapCount * 3);

  if (ex.ml_exercise_type === 'isolation') score += 2;
  return score;
}

export function pickSwapReplacement(
  fromExercise: GeneratedExercise,
  profile: TrainingProfile,
  library: EnrichedExercise[],
  workout: GeneratedWorkout,
): { exercise: EnrichedExercise | null; method: SurgicalSwapResult['method'] } {
  const fromName = fromExercise.exerciseName.toLowerCase();
  const targetGroup = fromExercise.targetMuscleGroup;
  const inWorkout = new Set(workout.exercises.map(e => e.exerciseName.toLowerCase()));
  const sameGroupInWorkout = workout.exercises
    .filter(e => e.targetMuscleGroup === targetGroup)
    .map(e => e.exerciseName);

  const ranked = library
    .map(ex => ({ ex, score: scoreCandidate(ex, targetGroup, fromName, profile, inWorkout, sameGroupInWorkout) }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score);

  if (ranked.length === 0) return { exercise: null, method: 'none' };

  const top = ranked[0];
  const usedAffinity = (profile.substitutionAffinities ?? []).some(
    a => preferenceAggregationKey(a.fromExercise) === preferenceAggregationKey(fromName)
      && preferenceAggregationKey(a.toExercise) === preferenceAggregationKey(top.ex.name),
  );
  return {
    exercise: top.ex,
    method: usedAffinity ? 'affinity' : 'library',
  };
}

/**
 * Replace one exercise slot in-place. Prescription fields copy from the
 * outgoing exercise; caller may re-prescribe via engine if needed.
 */
export function applySurgicalSwap(
  workout: GeneratedWorkout,
  exerciseIndex: number,
  replacement: EnrichedExercise,
): GeneratedWorkout {
  const exercises = workout.exercises.slice();
  const old = exercises[exerciseIndex];
  if (!old) return workout;

  exercises[exerciseIndex] = {
    ...old,
    exerciseName: replacement.name,
    exerciseLibraryId: replacement.id,
    bodyPart: replacement.body_part,
    primaryMuscles: Array.isArray(replacement.primary_muscles) ? replacement.primary_muscles : [],
    secondaryMuscles: Array.isArray(replacement.secondary_muscles) ? replacement.secondary_muscles : [],
    movementPattern: replacement.movement_pattern ?? old.movementPattern,
    rationale: `Surgical swap: ${old.exerciseName} → ${replacement.name}`,
    adjustments: [
      ...(old.adjustments ?? []),
      `Swapped from ${old.exerciseName} (affinity/library match)`,
    ],
  };

  return { ...workout, exercises };
}
