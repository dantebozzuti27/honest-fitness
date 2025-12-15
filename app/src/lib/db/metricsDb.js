// Lazy DB wrappers (Phase 3 trim): keep initial bundle small by loading the heavy supabaseDb module only when needed.

export async function saveMetricsToSupabase(userId, date, metrics, options = {}) {
  const m = await import('../supabaseDb')
  return m.saveMetricsToSupabase(userId, date, metrics, options)
}

export async function getMetricsFromSupabase(userId, startDate, endDate) {
  const m = await import('../supabaseDb')
  return m.getMetricsFromSupabase(userId, startDate, endDate)
}

export async function getAllMetricsFromSupabase(userId) {
  const m = await import('../supabaseDb')
  return m.getAllMetricsFromSupabase(userId)
}


