// Lazy DB wrappers (Phase 3 trim): keep initial bundle small by loading the heavy supabaseDb module only when needed.

export async function saveWorkoutToSupabase(workout: any, userId: string) {
  const m = await import('../supabaseDb')
  return m.saveWorkoutToSupabase(workout, userId)
}

export async function savePausedWorkoutToSupabase(workoutState: any, userId: string) {
  const m = await import('../supabaseDb')
  return m.savePausedWorkoutToSupabase(workoutState, userId)
}

export async function getPausedWorkoutFromSupabase(userId: string) {
  const m = await import('../supabaseDb')
  return m.getPausedWorkoutFromSupabase(userId)
}

export async function deletePausedWorkoutFromSupabase(userId: string) {
  const m = await import('../supabaseDb')
  return m.deletePausedWorkoutFromSupabase(userId)
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
