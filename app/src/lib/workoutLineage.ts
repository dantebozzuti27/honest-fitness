import { isUuidV4 } from '../utils/uuid'

/** Extract generated workout lineage id from mixed client payloads. */
export function extractGeneratedWorkoutId(workout: Record<string, unknown> | null | undefined): string | null {
  if (!workout || typeof workout !== 'object') return null
  const candidates = [
    workout.generatedWorkoutId,
    workout.generated_workout_id,
    (workout as { generated_workout?: { id?: string } }).generated_workout?.id,
  ]
  for (const c of candidates) {
    if (isUuidV4(String(c ?? ''))) return String(c)
  }
  return null
}

export function attachGeneratedWorkoutId<T extends Record<string, unknown>>(workout: T): T {
  const genId = extractGeneratedWorkoutId(workout)
  if (!genId) return workout
  return { ...workout, generatedWorkoutId: genId, generated_workout_id: genId }
}
