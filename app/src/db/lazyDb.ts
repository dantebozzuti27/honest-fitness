// Lazy wrapper around IndexedDB helpers with Supabase template sync.
// Templates sync to Supabase so they persist across devices.

async function loadDb() {
  return await import('./index.js')
}

// Track current user for template sync (set by callers or via auth context)
let _syncUserId: string | null = null

export function setTemplateSyncUserId(userId: string | null) {
  _syncUserId = userId
}

async function syncTemplatesToRemote(templates: any[]) {
  if (!_syncUserId) return
  try {
    const { saveTemplatesToSupabase } = await import('../lib/supabaseDb')
    await saveTemplatesToSupabase(_syncUserId, templates)
  } catch {
    // Best-effort sync
  }
}

// Exercises
export async function getAllExercises() {
  const db = await loadDb()
  return db.getAllExercises()
}

export async function bulkAddExercises(exercises: any) {
  const db = await loadDb()
  return db.bulkAddExercises(exercises)
}

export async function hasExercises() {
  const db = await loadDb()
  return db.hasExercises()
}

export async function clearExercises() {
  const db = await loadDb()
  return db.clearExercises()
}

// Templates (synced to Supabase)
export async function getAllTemplates() {
  const db = await loadDb()
  let local = await db.getAllTemplates()
  if (!Array.isArray(local)) local = []

  // If user is signed in, merge with remote templates
  if (_syncUserId) {
    try {
      const { getTemplatesFromSupabase } = await import('../lib/supabaseDb')
      const remote = await getTemplatesFromSupabase(_syncUserId)
      if (Array.isArray(remote) && remote.length > 0) {
        // Merge: remote is source of truth; add any local-only templates
        const remoteIds = new Set(remote.map((t: any) => t.id))
        const localOnly = local.filter((t: any) => !remoteIds.has(t.id))
        const merged = [...remote, ...localOnly]

        // Update local IndexedDB to match merged set
        await db.clearTemplates()
        if (merged.length > 0) await db.bulkAddTemplates(merged)

        // If there were local-only templates, push them to remote
        if (localOnly.length > 0) {
          syncTemplatesToRemote(merged)
        }

        return merged
      } else if (local.length > 0) {
        // Remote is empty, push local to remote
        syncTemplatesToRemote(local)
      }
    } catch {
      // Offline or remote unavailable — use local
    }
  }

  return local
}

export async function getTemplate(id: any) {
  const db = await loadDb()
  return db.getTemplate(id)
}

export async function saveTemplate(template: any) {
  const db = await loadDb()
  await db.saveTemplate(template)

  const all = await db.getAllTemplates()
  await syncTemplatesToRemote(Array.isArray(all) ? all : [])
}

export async function deleteTemplate(id: any) {
  const db = await loadDb()
  await db.deleteTemplate(id)

  const all = await db.getAllTemplates()
  await syncTemplatesToRemote(Array.isArray(all) ? all : [])
}

export async function bulkAddTemplates(templates: any) {
  const db = await loadDb()
  await db.bulkAddTemplates(templates)

  const all = await db.getAllTemplates()
  await syncTemplatesToRemote(Array.isArray(all) ? all : [])
}

// Workouts (local)
export async function saveWorkout(workout: any) {
  const db = await loadDb()
  return db.saveWorkout(workout)
}
