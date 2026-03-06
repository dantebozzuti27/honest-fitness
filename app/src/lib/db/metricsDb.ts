// Lazy DB wrappers (Phase 3 trim): keep initial bundle small by loading the heavy supabaseDb module only when needed.

export async function saveMetricsToSupabase(userId: string, date: string, metrics: any, options: any = {}) {
  const m = await import('../supabaseDb')
  return m.saveMetricsToSupabase(userId, date, metrics, options)
}

export async function getMetricsFromSupabase(userId: string, startDate: string, endDate: string) {
  const m = await import('../supabaseDb')
  return m.getMetricsFromSupabase(userId, startDate, endDate)
}

export async function getAllMetricsFromSupabase(userId: string) {
  const m = await import('../supabaseDb')
  return m.getAllMetricsFromSupabase(userId)
}
