// Lazy DB wrappers (Phase 3 trim): keep initial bundle small by loading the heavy supabaseDb module only when needed.

export async function getUserEvents(userId, startDate = null, endDate = null, eventName = null, limit = 1000) {
  const m = await import('../supabaseDb')
  return m.getUserEvents(userId, startDate, endDate, eventName, limit)
}

export async function getUserEventStats(userId, days = 30) {
  const m = await import('../supabaseDb')
  return m.getUserEventStats(userId, days)
}


