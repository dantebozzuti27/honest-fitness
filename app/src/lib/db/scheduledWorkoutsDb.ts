// Lazy DB wrappers (Phase 3 trim): keep initial bundle small by loading the heavy supabaseDb module only when needed.

export async function scheduleWorkoutSupabase(userId: string, date: string, templateId: string) {
  const m = await import('../supabaseDb')
  return m.scheduleWorkoutSupabase(userId, date, templateId)
}

export async function getScheduledWorkoutsFromSupabase(userId: string) {
  const m = await import('../supabaseDb')
  return m.getScheduledWorkoutsFromSupabase(userId)
}

export async function getScheduledWorkoutByDateFromSupabase(userId: string, date: string) {
  const m = await import('../supabaseDb')
  return m.getScheduledWorkoutByDateFromSupabase(userId, date)
}

export async function getScheduledWorkoutsByDateFromSupabase(userId: string, date: string) {
  const m = await import('../supabaseDb')
  return m.getScheduledWorkoutsByDateFromSupabase(userId, date)
}

export async function deleteScheduledWorkoutByDateFromSupabase(userId: string, date: string) {
  const m = await import('../supabaseDb')
  return m.deleteScheduledWorkoutByDateFromSupabase(userId, date)
}

export async function deleteScheduledWorkoutByIdFromSupabase(userId: string, id: string) {
  const m = await import('../supabaseDb')
  return m.deleteScheduledWorkoutByIdFromSupabase(userId, id)
}

export async function deleteScheduledWorkoutsByTemplatePrefixFromSupabase(userId: string, templateIdPrefix: string) {
  const m = await import('../supabaseDb')
  return m.deleteScheduledWorkoutsByTemplatePrefixFromSupabase(userId, templateIdPrefix)
}
