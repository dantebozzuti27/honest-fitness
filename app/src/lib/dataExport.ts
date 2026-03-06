/**
 * Data Export — JSON (full) and CSV (flat, ML-ready)
 */

import { supabase as supabaseClient, supabaseConfigErrorMessage } from './supabase'
import { logError } from '../utils/logger'

const supabase = supabaseClient ?? new Proxy({} as any, { get: () => { throw new Error(supabaseConfigErrorMessage) } })

// ─── helpers ───────────────────────────────────────────────────────────────

async function safeQuery(fn: () => Promise<any>): Promise<any> {
  try {
    return await fn()
  } catch (e: any) {
    const ignorable = e?.code === 'PGRST116' || e?.code === '42P01' ||
      e?.message?.includes('does not exist') || e?.message?.includes('relation')
    if (ignorable) return null
    throw e
  }
}

function csvEscape(v: any): string {
  if (v == null || v === '') return ''
  const s = String(v)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`
  return s
}

function csvRow(fields: any[]): string {
  return fields.map(csvEscape).join(',')
}

// ─── raw fetchers ──────────────────────────────────────────────────────────

async function fetchWorkouts(userId: string) {
  const { data, error } = await supabase
    .from('workouts')
    .select(`
      id, date, duration, template_name, perceived_effort, notes, created_at,
      workout_exercises (
        exercise_name, body_part,
        workout_sets ( set_number, weight, reps, time )
      )
    `)
    .eq('user_id', userId)
    .order('date', { ascending: false })
  if (error) throw error
  return data || []
}

async function fetchHealthMetrics(userId: string) {
  const { data, error } = await supabase
    .from('health_metrics')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: false })
  if (error) throw error
  return data || []
}

async function fetchPreferences(userId: string) {
  return safeQuery(async () => {
    const { data, error } = await supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()
    if (error) throw error
    return data
  })
}

// ─── public exports ────────────────────────────────────────────────────────

/**
 * Full JSON export — everything we have for this user.
 */
export async function exportUserDataJSON(userId: string) {
  try {
    const [workouts, healthMetrics, preferences] = await Promise.all([
      fetchWorkouts(userId),
      fetchHealthMetrics(userId),
      fetchPreferences(userId),
    ])

    return {
      export_date: new Date().toISOString(),
      user_id: userId,
      data: {
        workouts,
        health_metrics: healthMetrics,
        preferences,
      },
    }
  } catch (error) {
    logError('Error exporting user data as JSON', error)
    throw error
  }
}

/**
 * Flat CSV with one row per SET — this is what you want for ML.
 *
 * Columns: date, workout_id, template, duration_sec, perceived_effort,
 *          exercise, body_part, set_number, weight_lbs, reps, time_sec
 */
export async function exportWorkoutsCSV(userId: string) {
  try {
    const workouts = await fetchWorkouts(userId)
    if (!workouts.length) return 'No workout data available'

    const header = [
      'date', 'workout_id', 'template', 'duration_sec', 'perceived_effort',
      'exercise', 'body_part', 'set_number', 'weight_lbs', 'reps', 'time_sec', 'notes',
    ]
    const lines: string[] = [csvRow(header)]

    for (const w of workouts) {
      const exercises = w.workout_exercises || []
      if (exercises.length === 0) {
        lines.push(csvRow([
          w.date, w.id, w.template_name, w.duration, w.perceived_effort,
          '', '', '', '', '', '', w.notes,
        ]))
        continue
      }
      for (const ex of exercises) {
        const sets = (ex.workout_sets || []).sort((a: any, b: any) => (a.set_number || 0) - (b.set_number || 0))
        if (sets.length === 0) {
          lines.push(csvRow([
            w.date, w.id, w.template_name, w.duration, w.perceived_effort,
            ex.exercise_name, ex.body_part, '', '', '', '', w.notes,
          ]))
          continue
        }
        for (const s of sets) {
          lines.push(csvRow([
            w.date, w.id, w.template_name, w.duration, w.perceived_effort,
            ex.exercise_name, ex.body_part, s.set_number, s.weight, s.reps, s.time, w.notes,
          ]))
        }
      }
    }
    return lines.join('\n')
  } catch (error) {
    logError('Error exporting workouts as CSV', error)
    throw error
  }
}

/**
 * Health metrics CSV — one row per day.
 */
export async function exportHealthMetricsCSV(userId: string) {
  try {
    const metrics = await fetchHealthMetrics(userId)
    if (!metrics.length) return 'No health metrics data available'

    const header = [
      'date', 'weight_lbs', 'body_fat_pct', 'steps', 'calories_burned',
      'resting_hr', 'hrv', 'sleep_duration_min', 'sleep_score',
      'source_provider',
    ]
    const lines: string[] = [csvRow(header)]

    for (const m of metrics) {
      lines.push(csvRow([
        m.date, m.weight, m.body_fat_percentage, m.steps, m.calories_burned,
        m.resting_heart_rate, m.hrv, m.sleep_duration, m.sleep_score,
        m.source_provider,
      ]))
    }
    return lines.join('\n')
  } catch (error) {
    logError('Error exporting health metrics as CSV', error)
    throw error
  }
}

/**
 * Trigger a browser download of arbitrary data.
 */
export function downloadData(data: any, filename: string, mimeType = 'application/json') {
  const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
