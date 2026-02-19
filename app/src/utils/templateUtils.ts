/**
 * Template utilities
 *
 * We support legacy templates where `exercises` is `string[]` as well as the newer
 * preset shape where each entry is an object with sets/reps/time/notes.
 */

export type TemplateExercisePresetV2 = {
  name: string
  sets: number | string
  reps: string
  time: string
  notes: string
  stackGroup: string | null
}

/**
 * Normalize a template exercises list into a consistent preset object shape.
 * @param {unknown} list
 * @returns {TemplateExercisePresetV2[]}
 */
export function normalizeTemplateExercises(list: unknown): TemplateExercisePresetV2[] {
  const arr = Array.isArray(list) ? list : []
  return arr
    .map((e) => {
      if (!e) return null
      if (typeof e === 'string') {
        return { name: e, sets: '', reps: '', time: '', notes: '', stackGroup: null }
      }
      if (typeof e === 'object') {
        const obj = e as Record<string, unknown>
        const name = String(obj.name || '').trim()
        if (!name) return null
        const sets = obj.sets ?? ''
        const reps = obj.reps ?? ''
        const time = obj.time ?? ''
        const notes = obj.notes ?? ''
        const stackGroup = obj.stackGroup ?? null
        return { name, sets: typeof sets === 'number' || typeof sets === 'string' ? sets : String(sets), reps: String(reps), time: String(time), notes: String(notes), stackGroup: stackGroup == null ? null : String(stackGroup) }
      }
      return null
    })
    .filter((e): e is TemplateExercisePresetV2 => Boolean(e && e.name))
}


