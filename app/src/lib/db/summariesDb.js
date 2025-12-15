// Lazy DB wrappers (Phase 3 trim): keep initial bundle small by loading the heavy supabaseDb module only when needed.

export async function getDailyWorkoutSummaries(userId, startDate = null, endDate = null) {
  const m = await import('../supabaseDb')
  return m.getDailyWorkoutSummaries(userId, startDate, endDate)
}

export async function getWeeklyWorkoutSummaries(userId, startDate = null, endDate = null) {
  const m = await import('../supabaseDb')
  return m.getWeeklyWorkoutSummaries(userId, startDate, endDate)
}

export async function getMonthlyWorkoutSummaries(userId, startDate = null, endDate = null) {
  const m = await import('../supabaseDb')
  return m.getMonthlyWorkoutSummaries(userId, startDate, endDate)
}

export async function getDailyHealthSummaries(userId, startDate = null, endDate = null) {
  const m = await import('../supabaseDb')
  return m.getDailyHealthSummaries(userId, startDate, endDate)
}

export async function getWeeklyHealthSummaries(userId, startDate = null, endDate = null) {
  const m = await import('../supabaseDb')
  return m.getWeeklyHealthSummaries(userId, startDate, endDate)
}

export async function getDailyNutritionSummaries(userId, startDate = null, endDate = null) {
  const m = await import('../supabaseDb')
  return m.getDailyNutritionSummaries(userId, startDate, endDate)
}

export async function getEngineeredFeatures(userId, featureType = null) {
  const m = await import('../supabaseDb')
  return m.getEngineeredFeatures(userId, featureType)
}


