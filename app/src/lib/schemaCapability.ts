/**
 * Schema capability health check.
 * Probes Supabase tables/columns at app boot to set capability flags.
 * Used by components to avoid 400s when optional columns are missing.
 */

import { requireSupabase } from './supabase'
import { logDebug, logWarn } from '../utils/logger'

export type SchemaCapabilities = {
  workoutsHasCategory: boolean
  workoutsHasIsWarmup: boolean
  workoutsHasSessionType: boolean
  workoutsHasGeneratedWorkoutId: boolean
  exercisesHasEquipment: boolean
  userPreferencesHasSportFocus: boolean
  weeklyPlanDaysHasDayStatus: boolean
  probedAt: number
}

export type SchemaGateResult = {
  ok: boolean
  missing: string[]
  message: string | null
}

let capabilities: SchemaCapabilities | null = null

async function probeColumn(table: string, column: string): Promise<boolean> {
  try {
    const supabase = requireSupabase()
    const { error } = await supabase
      .from(table)
      .select(column)
      .limit(1)
    return !error || error.code !== '42703'
  } catch {
    return false
  }
}

/**
 * Run schema capability probes. Safe to call multiple times; results cached.
 */
export async function probeSchemaCapabilities(): Promise<SchemaCapabilities> {
  if (capabilities && Date.now() - capabilities.probedAt < 60_000) {
    return capabilities
  }

  const [workoutsSessionType, workoutsCategory, workoutsWarmup, workoutsGenId, exercisesEquip, prefsSport, planDayStatus] =
    await Promise.all([
      probeColumn('workouts', 'session_type'),
      probeColumn('workout_exercises', 'category'),
      probeColumn('workout_exercises', 'is_warmup'),
      probeColumn('workouts', 'generated_workout_id'),
      probeColumn('exercises', 'equipment'),
      probeColumn('user_preferences', 'sport_focus'),
      probeColumn('weekly_plan_days', 'day_status'),
    ])

  capabilities = {
    workoutsHasCategory: workoutsCategory,
    workoutsHasIsWarmup: workoutsWarmup,
    workoutsHasSessionType: workoutsSessionType,
    workoutsHasGeneratedWorkoutId: workoutsGenId,
    exercisesHasEquipment: exercisesEquip,
    userPreferencesHasSportFocus: prefsSport,
    weeklyPlanDaysHasDayStatus: planDayStatus,
    probedAt: Date.now(),
  }

  logDebug('Schema capabilities probed', capabilities)
  return capabilities
}

/**
 * Get cached capabilities. Returns null if not yet probed.
 */
export function getSchemaCapabilities(): SchemaCapabilities | null {
  return capabilities
}

/**
 * Invalidate cache (e.g. after running a migration).
 */
export function invalidateSchemaCapabilities(): void {
  capabilities = null
}

/** Alias for App boot — runs probe and returns. */
export async function runSchemaCapabilityCheck(): Promise<SchemaCapabilities> {
  const caps = await probeSchemaCapabilities()
  const gate = evaluateSchemaGate(caps)
  if (!gate.ok) {
    logWarn('Schema capability gate failed', gate)
  }
  return caps
}

export function evaluateSchemaGate(caps: SchemaCapabilities | null): SchemaGateResult {
  if (!caps) {
    return {
      ok: false,
      missing: ['capability_probe'],
      message: 'Could not verify database schema compatibility. Please run the latest migration and retry.',
    }
  }

  const missing: string[] = []
  if (!caps.workoutsHasSessionType) missing.push('workouts.session_type')
  if (!caps.weeklyPlanDaysHasDayStatus) missing.push('weekly_plan_days.day_status')

  if (missing.length === 0) return { ok: true, missing, message: null }

  return {
    ok: false,
    missing,
    message: `Database migration required: missing ${missing.join(', ')}.`,
  }
}
