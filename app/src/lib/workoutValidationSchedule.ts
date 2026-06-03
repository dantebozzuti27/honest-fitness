import { fetchWorkoutValidation, type WorkoutValidation } from './insightsApi';

const DEBOUNCE_MS = 2500;
const SESSION_PREFIX = 'hf:wv:';

const memoryCache = new Map<string, WorkoutValidation>();

/** Stable fingerprint so we do not re-call the LLM for the same prescription. */
export function workoutValidationFingerprint(workout: {
  id?: string | null;
  estimatedDurationMinutes?: number;
  exercises?: Array<{
    exerciseName?: string;
    sets?: number;
    targetReps?: number | null;
    targetWeight?: number | null;
    targetMuscleGroup?: string;
  }>;
}): string {
  const exercises = (workout.exercises ?? [])
    .map(
      (ex) =>
        `${String(ex.exerciseName || '').toLowerCase()}|${Number(ex.sets) || 0}|${Number(ex.targetReps) || 0}|${Number(ex.targetWeight) || 0}|${String(ex.targetMuscleGroup || '')}`,
    )
    .sort()
    .join(';');
  return `${workout.id ?? 'new'}:${workout.estimatedDurationMinutes ?? 0}:${exercises}`;
}

function readSessionCache(fp: string): WorkoutValidation | null {
  try {
    const raw = sessionStorage.getItem(`${SESSION_PREFIX}${fp}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WorkoutValidation;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSessionCache(fp: string, data: WorkoutValidation): void {
  try {
    sessionStorage.setItem(`${SESSION_PREFIX}${fp}`, JSON.stringify(data));
  } catch {
    /* quota / private mode */
  }
}

/**
 * Debounced validate-workout: waits for prescription to settle, dedupes by fingerprint.
 * Returns cancel function (call on unmount or before scheduling a new workout).
 */
export function scheduleWorkoutValidation(
  trainingProfile: unknown,
  workout: Parameters<typeof fetchWorkoutValidation>[1],
  onResult: (validation: WorkoutValidation) => void,
  onError?: (err: unknown) => void,
): () => void {
  const fp = workoutValidationFingerprint(workout);

  const mem = memoryCache.get(fp);
  if (mem) {
    onResult(mem);
    return () => {};
  }

  const session = readSessionCache(fp);
  if (session) {
    memoryCache.set(fp, session);
    onResult(session);
    return () => {};
  }

  let cancelled = false;
  const timer = setTimeout(() => {
    void (async () => {
      if (cancelled) return;
      try {
        const validation = await fetchWorkoutValidation(trainingProfile, workout);
        if (cancelled) return;
        memoryCache.set(fp, validation);
        writeSessionCache(fp, validation);
        onResult(validation);
      } catch (err) {
        if (!cancelled) onError?.(err);
      }
    })();
  }, DEBOUNCE_MS);

  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}

export function clearWorkoutValidationCache(): void {
  memoryCache.clear();
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(SESSION_PREFIX)) sessionStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
}
