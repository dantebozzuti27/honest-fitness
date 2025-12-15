// Lazy DB wrappers (Phase 3 trim): keep initial bundle small by loading the heavy supabaseDb module only when needed.

export async function getUserPreferences(userId) {
  const m = await import('../supabaseDb')
  return m.getUserPreferences(userId)
}

export async function saveUserPreferences(userId, prefs) {
  const m = await import('../supabaseDb')
  return m.saveUserPreferences(userId, prefs)
}

export async function deleteUserPreferences(userId) {
  const m = await import('../supabaseDb')
  return m.deleteUserPreferences(userId)
}

export async function getDefaultVisibilityPreference(userId) {
  const m = await import('../supabaseDb')
  return m.getDefaultVisibilityPreference(userId)
}

export async function setDefaultVisibilityPreference(userId, visibility) {
  const m = await import('../supabaseDb')
  return m.setDefaultVisibilityPreference(userId, visibility)
}


