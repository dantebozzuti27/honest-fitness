// Lazy DB wrappers (Phase 3 trim): keep initial bundle small by loading the heavy supabaseDb module only when needed.

export async function scheduleWorkoutSupabase(userId, date, templateId) {
  const m = await import('../supabaseDb')
  return m.scheduleWorkoutSupabase(userId, date, templateId)
}

export async function getScheduledWorkoutsFromSupabase(userId) {
  const m = await import('../supabaseDb')
  return m.getScheduledWorkoutsFromSupabase(userId)
}

export async function getScheduledWorkoutByDateFromSupabase(userId, date) {
  const m = await import('../supabaseDb')
  return m.getScheduledWorkoutByDateFromSupabase(userId, date)
}


