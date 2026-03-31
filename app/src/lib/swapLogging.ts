import { logError } from '../utils/logger'
import { db } from './dbClient'

export type SwapContext = 'today_regen' | 'week_regen' | 'active_replace' | 'unknown'

export type LogExerciseSwapParams = {
  userId: string
  exerciseName: string
  replacementExerciseName?: string | null
  context: SwapContext
  workoutSessionId?: string | null
}

/**
 * Persists a swap event for substitution learning. Columns missing in older DBs are omitted on retry.
 */
export async function logExerciseSwapToSupabase(params: LogExerciseSwapParams): Promise<{ ok: boolean }> {
  if (!params.exerciseName || !String(params.exerciseName).trim()) {
    return { ok: false }
  }

  const base: Record<string, unknown> = {
    user_id: params.userId,
    exercise_name: String(params.exerciseName).toLowerCase().trim(),
  }
  const extended: Record<string, unknown> = {
    ...base,
    replacement_exercise_name: params.replacementExerciseName
      ? String(params.replacementExerciseName).toLowerCase().trim()
      : null,
    swap_context: params.context,
    workout_session_id: params.workoutSessionId ?? null,
  }

  let { error } = await db.from('exercise_swaps').insert(extended as any)
  if (error && (error.code === '42703' || `${error.message || ''}`.toLowerCase().includes('column'))) {
    const retry = await db.from('exercise_swaps').insert(base as any)
    error = retry.error
  }
  if (error) {
    logError('logExerciseSwapToSupabase', error)
    return { ok: false }
  }
  return { ok: true }
}
