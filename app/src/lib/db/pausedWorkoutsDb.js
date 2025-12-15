// Lazy DB wrappers (Phase 3 trim): keep initial bundle small by loading the heavy supabaseDb module only when needed.

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


