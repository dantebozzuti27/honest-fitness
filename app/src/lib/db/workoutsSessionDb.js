// Lazy DB wrappers (Phase 3 trim): keep initial bundle small by loading the heavy supabaseDb module only when needed.

export async function saveWorkoutToSupabase(workout, userId) {
  const m = await import('../supabaseDb')
  return m.saveWorkoutToSupabase(workout, userId)
}

export async function savePausedWorkoutToSupabase(workoutState, userId) {
  const m = await import('../supabaseDb')
  return m.savePausedWorkoutToSupabase(workoutState, userId)
}

export async function getPausedWorkoutFromSupabase(userId) {
  const m = await import('../supabaseDb')
  return m.getPausedWorkoutFromSupabase(userId)
}

export async function deletePausedWorkoutFromSupabase(userId) {
  const m = await import('../supabaseDb')
  return m.deletePausedWorkoutFromSupabase(userId)
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


