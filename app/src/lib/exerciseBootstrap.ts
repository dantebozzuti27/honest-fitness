import { clearExercises, bulkAddExercises } from '../db/lazyDb'
import { getSystemExercises } from './exerciseLibrary'

const CACHE_VERSION_KEY = 'hf_exercise_cache_version'
const CURRENT_CACHE_VERSION = '2'

function titleCase(s: string) {
  if (!s || typeof s !== 'string') return ''
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function normalizeCategory(cat: unknown) {
  const c = (cat || '').toString().trim()
  if (!c) return 'Strength'
  const lower = c.toLowerCase()
  if (lower === 'strength') return 'Strength'
  if (lower === 'cardio') return 'Cardio'
  if (lower === 'recovery') return 'Recovery'
  return titleCase(c)
}

/**
 * Sync the local IndexedDB exercise cache from Supabase exercise_library.
 *
 * Re-fetches on every session to ensure the picker always reflects the latest
 * library state (new exercises, renames, ML enrichment columns).  The Supabase
 * query is lightweight (~200-300 rows, single round-trip) so the cost is negligible.
 *
 * A localStorage version stamp lets us skip the clear+re-insert when nothing
 * has changed on the Supabase side (bump CURRENT_CACHE_VERSION to force).
 */
export async function ensureLocalExercisesLoaded() {
  try {
    const cachedVersion = localStorage.getItem(CACHE_VERSION_KEY)
    const needsForceRefresh = cachedVersion !== CURRENT_CACHE_VERSION

    const systemExercises = await getSystemExercises()
    if (!systemExercises || systemExercises.length === 0) {
      return { loaded: false, seeded: false, reason: 'no_system_exercises_in_supabase' }
    }

    // Map Supabase rows -> local IDB format used throughout UI.
    // Include ML enrichment fields so the exercise picker can display
    // muscle data, movement patterns, and difficulty.
    const mapped = systemExercises.map((e: any) => ({
      name: e.name,
      category: normalizeCategory(e.category),
      bodyPart: e.body_part || e.bodyPart || 'Other',
      equipment: Array.isArray(e.equipment) ? e.equipment.join(', ') : (e.equipment || ''),
      exercise_library_id: e.id || null,
      primary_muscles: e.primary_muscles || [],
      secondary_muscles: e.secondary_muscles || [],
      movement_pattern: e.movement_pattern || null,
      ml_exercise_type: e.ml_exercise_type || null,
      difficulty: e.difficulty || null,
    }))

    const seen = new Set<string>()
    const deduped: typeof mapped = []
    for (const ex of mapped) {
      const key = String(ex?.name || '').trim().toLowerCase()
      if (!key) continue
      if (seen.has(key)) continue
      seen.add(key)
      deduped.push(ex)
    }

    if (needsForceRefresh || deduped.length > 0) {
      await clearExercises()
      await bulkAddExercises(deduped)
      localStorage.setItem(CACHE_VERSION_KEY, CURRENT_CACHE_VERSION)
    }

    return { loaded: true, seeded: needsForceRefresh, count: deduped.length }
  } catch (err: any) {
    return { loaded: false, seeded: false, error: err?.message || String(err) }
  }
}
