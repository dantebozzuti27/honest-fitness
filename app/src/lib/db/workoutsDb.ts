// Lazy DB wrappers (Phase 3 trim): keep initial bundle small by loading the heavy supabaseDb module only when needed.

export async function saveWorkoutToSupabase(workout: any, userId: string) {
  const m = await import('../supabaseDb')
  return m.saveWorkoutToSupabase(workout, userId)
}

export async function getWorkoutsFromSupabase(userId: string) {
  const m = await import('../supabaseDb')
  return m.getWorkoutsFromSupabase(userId)
}

export async function getRecentWorkoutsFromSupabase(userId: string, limit = 30) {
  const m = await import('../supabaseDb')
  return m.getRecentWorkoutsFromSupabase(userId, limit)
}

export async function getWorkoutDatesFromSupabase(userId: string) {
  const m = await import('../supabaseDb')
  return m.getWorkoutDatesFromSupabase(userId)
}

export async function getWorkoutsByDateFromSupabase(userId: string, date: string) {
  const m = await import('../supabaseDb')
  return m.getWorkoutsByDateFromSupabase(userId, date)
}

export async function updateWorkoutInSupabase(workoutId: string, workout: any, userId: string) {
  const m = await import('../supabaseDb')
  return m.updateWorkoutInSupabase(workoutId, workout, userId)
}

export async function deleteWorkoutFromSupabase(workoutId: string, userId: string | null = null) {
  const m = await import('../supabaseDb')
  return m.deleteWorkoutFromSupabase(workoutId, userId)
}

export async function deleteAllWorkoutsFromSupabase(userId: string) {
  const m = await import('../supabaseDb')
  return m.deleteAllWorkoutsFromSupabase(userId)
}

export async function cleanupDuplicateWorkouts(userId: string) {
  const m = await import('../supabaseDb')
  return m.cleanupDuplicateWorkouts(userId)
}

export async function calculateStreakFromSupabase(userId: string) {
  const m = await import('../supabaseDb')
  return m.calculateStreakFromSupabase(userId)
}

export async function getWorkoutFrequency(userId: string, days = 30) {
  const m = await import('../supabaseDb')
  return m.getWorkoutFrequency(userId, days)
}

export async function getExerciseStats(userId: string) {
  const m = await import('../supabaseDb')
  return m.getExerciseStats(userId)
}

export async function getBodyPartStats(userId: string) {
  const m = await import('../supabaseDb')
  return m.getBodyPartStats(userId)
}

export async function getDetailedBodyPartStats(userId: string) {
  const m = await import('../supabaseDb')
  return m.getDetailedBodyPartStats(userId)
}

export async function saveActiveWorkoutSession(userId: string, sessionData: any) {
  const m = await import('../supabaseDb')
  return m.saveActiveWorkoutSession(userId, sessionData)
}

export async function getActiveWorkoutSession(userId: string) {
  const m = await import('../supabaseDb')
  return m.getActiveWorkoutSession(userId)
}

export async function deleteActiveWorkoutSession(userId: string) {
  const m = await import('../supabaseDb')
  return m.deleteActiveWorkoutSession(userId)
}
