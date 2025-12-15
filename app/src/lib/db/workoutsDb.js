// Lazy DB wrappers (Phase 3 trim): keep initial bundle small by loading the heavy supabaseDb module only when needed.

export async function saveWorkoutToSupabase(workout, userId) {
  const m = await import('../supabaseDb')
  return m.saveWorkoutToSupabase(workout, userId)
}

export async function getWorkoutsFromSupabase(userId) {
  const m = await import('../supabaseDb')
  return m.getWorkoutsFromSupabase(userId)
}

export async function getWorkoutDatesFromSupabase(userId) {
  const m = await import('../supabaseDb')
  return m.getWorkoutDatesFromSupabase(userId)
}

export async function getWorkoutsByDateFromSupabase(userId, date) {
  const m = await import('../supabaseDb')
  return m.getWorkoutsByDateFromSupabase(userId, date)
}

export async function updateWorkoutInSupabase(workoutId, workout, userId) {
  const m = await import('../supabaseDb')
  return m.updateWorkoutInSupabase(workoutId, workout, userId)
}

export async function deleteWorkoutFromSupabase(workoutId, userId = null) {
  const m = await import('../supabaseDb')
  return m.deleteWorkoutFromSupabase(workoutId, userId)
}

export async function deleteAllWorkoutsFromSupabase(userId) {
  const m = await import('../supabaseDb')
  return m.deleteAllWorkoutsFromSupabase(userId)
}

export async function cleanupDuplicateWorkouts(userId) {
  const m = await import('../supabaseDb')
  return m.cleanupDuplicateWorkouts(userId)
}

export async function calculateStreakFromSupabase(userId) {
  const m = await import('../supabaseDb')
  return m.calculateStreakFromSupabase(userId)
}

export async function getWorkoutFrequency(userId, days = 30) {
  const m = await import('../supabaseDb')
  return m.getWorkoutFrequency(userId, days)
}

export async function getExerciseStats(userId) {
  const m = await import('../supabaseDb')
  return m.getExerciseStats(userId)
}

export async function getBodyPartStats(userId) {
  const m = await import('../supabaseDb')
  return m.getBodyPartStats(userId)
}

export async function getDetailedBodyPartStats(userId) {
  const m = await import('../supabaseDb')
  return m.getDetailedBodyPartStats(userId)
}

export async function saveActiveWorkoutSession(userId, sessionData) {
  const m = await import('../supabaseDb')
  return m.saveActiveWorkoutSession(userId, sessionData)
}

export async function getActiveWorkoutSession(userId) {
  const m = await import('../supabaseDb')
  return m.getActiveWorkoutSession(userId)
}

export async function deleteActiveWorkoutSession(userId) {
  const m = await import('../supabaseDb')
  return m.deleteActiveWorkoutSession(userId)
}


