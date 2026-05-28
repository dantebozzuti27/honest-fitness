/** sessionStorage key written by TodayWorkout before navigating to ActiveWorkout */
export const GENERATED_WORKOUT_SESSION_KEY = 'generated_workout'

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function sessionStore(override?: StorageLike): StorageLike {
  return override ?? sessionStorage
}

function localStore(override?: StorageLike): StorageLike {
  return override ?? localStorage
}

export function generatedWorkoutPendingKey(userId: string): string {
  return `generated_workout_pending_${userId}`
}

/**
 * Stage a generated workout for ActiveWorkout.
 * sessionStorage is the primary handoff; localStorage pending survives Strict Mode remounts.
 */
export function stageGeneratedWorkoutPayload(
  userId: string | null | undefined,
  payload: unknown,
  sessionOverride?: StorageLike,
  localOverride?: StorageLike,
): void {
  const raw = JSON.stringify(payload)
  sessionStore(sessionOverride).setItem(GENERATED_WORKOUT_SESSION_KEY, raw)
  if (userId) {
    localStore(localOverride).setItem(generatedWorkoutPendingKey(userId), raw)
  }
}

/**
 * Read a staged generated workout without clearing pending storage.
 * Copies sessionStorage → localStorage pending so a remount can still recover.
 */
export function peekGeneratedWorkoutPayload(
  userId: string | null | undefined,
  sessionOverride?: StorageLike,
  localOverride?: StorageLike,
): string | null {
  try {
    const session = sessionStore(sessionOverride)
    const local = localStore(localOverride)
    const fromSession = session.getItem(GENERATED_WORKOUT_SESSION_KEY)
    if (fromSession) {
      if (userId) {
        local.setItem(generatedWorkoutPendingKey(userId), fromSession)
      }
      return fromSession
    }
    if (userId) {
      return local.getItem(generatedWorkoutPendingKey(userId))
    }
  } catch {
    // storage unavailable
  }
  return null
}

export function clearGeneratedWorkoutHandoff(
  userId: string | null | undefined,
  sessionOverride?: StorageLike,
  localOverride?: StorageLike,
): void {
  try {
    sessionStore(sessionOverride).removeItem(GENERATED_WORKOUT_SESSION_KEY)
    if (userId) {
      localStore(localOverride).removeItem(generatedWorkoutPendingKey(userId))
    }
  } catch {
    // ignore
  }
}

export function parseGeneratedWorkoutPayload(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}
