import { hasExercises, bulkAddExercises } from '../db/lazyDb'
import { getSystemExercises } from './exerciseLibrary'

function titleCase(s) {
  if (!s || typeof s !== 'string') return ''
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function normalizeCategory(cat) {
  const c = (cat || '').toString().trim()
  if (!c) return 'Strength'
  const lower = c.toLowerCase()
  if (lower === 'strength') return 'Strength'
  if (lower === 'cardio') return 'Cardio'
  if (lower === 'recovery') return 'Recovery'
  return titleCase(c)
}

/**
 * Ensure the local IndexedDB exercise cache is populated.
 * This prevents "exercise database is gone" when browser storage is cleared
 * or when switching domains (each domain has its own IndexedDB).
 */
export async function ensureLocalExercisesLoaded() {
  try {
    const already = await hasExercises()
    if (already) return { loaded: true, seeded: false }

    const systemExercises = await getSystemExercises()
    if (!systemExercises || systemExercises.length === 0) {
      return { loaded: false, seeded: false, reason: 'no_system_exercises_in_supabase' }
    }

    // Map Supabase rows → local IDB format used throughout UI
    // NOTE: do NOT supply `id` so IndexedDB autoIncrement works.
    const mapped = systemExercises.map((e) => ({
      name: e.name,
      category: normalizeCategory(e.category),
      bodyPart: e.body_part || e.bodyPart || 'Other',
      equipment: Array.isArray(e.equipment) ? e.equipment.join(', ') : (e.equipment || '')
    }))

    // Prevent duplicates (some datasets can include repeated names).
    const seen = new Set()
    const deduped = []
    for (const ex of mapped) {
      const key = `${String(ex?.name || '').trim().toLowerCase()}|${String(ex?.category || '').trim().toLowerCase()}|${String(ex?.bodyPart || '').trim().toLowerCase()}|${String(ex?.equipment || '').trim().toLowerCase()}`
      if (!key || key.startsWith('|')) continue
      if (seen.has(key)) continue
      seen.add(key)
      deduped.push(ex)
    }

    await bulkAddExercises(deduped)
    return { loaded: true, seeded: true, count: deduped.length }
  } catch (err) {
    return { loaded: false, seeded: false, error: err?.message || String(err) }
  }
}



