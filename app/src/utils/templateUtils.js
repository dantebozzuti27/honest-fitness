/**
 * Template utilities
 *
 * We support legacy templates where `exercises` is `string[]` as well as the newer
 * preset shape where each entry is an object with sets/reps/time/notes.
 */

/**
 * @typedef {{name: string, sets: (number|string), reps: string, time: string, notes: string}} TemplateExercisePreset
 */

/**
 * Normalize a template exercises list into a consistent preset object shape.
 * @param {unknown} list
 * @returns {TemplateExercisePreset[]}
 */
export function normalizeTemplateExercises(list) {
  const arr = Array.isArray(list) ? list : []
  return arr
    .map((e) => {
      if (!e) return null
      if (typeof e === 'string') {
        return { name: e, sets: '', reps: '', time: '', notes: '' }
      }
      if (typeof e === 'object') {
        // @ts-ignore - this file is JS, callers may pass any shape
        const name = String(e.name || '').trim()
        if (!name) return null
        // @ts-ignore
        const sets = e.sets ?? ''
        // @ts-ignore
        const reps = e.reps ?? ''
        // @ts-ignore
        const time = e.time ?? ''
        // @ts-ignore
        const notes = e.notes ?? ''
        return { name, sets, reps: String(reps), time: String(time), notes: String(notes) }
      }
      return null
    })
    .filter((e) => e?.name)
}


