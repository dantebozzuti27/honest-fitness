// Lazy DB wrappers (Phase 3 trim): keep initial bundle small by loading the heavy supabaseDb module only when needed.

export async function getUserPreferences(userId: string) {
  const m = await import('../supabaseDb')
  return m.getUserPreferences(userId)
}

export async function saveUserPreferences(userId: string, prefs: any) {
  const m = await import('../supabaseDb')
  return m.saveUserPreferences(userId, prefs)
}

export async function deleteUserPreferences(userId: string) {
  const m = await import('../supabaseDb')
  return m.deleteUserPreferences(userId)
}
