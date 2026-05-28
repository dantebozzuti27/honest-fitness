/**
 * Week plan constraints — source of truth for weekly programming.
 *
 * Materialized `plannedWorkout` blobs are outputs, not inputs. When
 * constraints or engine version change, days rematerialize on read.
 */

import { BIOMECHANICS_ONTOLOGY_VERSION } from './biomechanicsOntology';
import { PRESCRIPTION_POLICY_VERSION, WORKOUT_ENGINE_VERSION } from './modelConfig';
import { ONTOLOGY_VERSION } from './exerciseOntology';
import type { MonthlyFocusStateV1 } from './monthlyFocus';
import type { CanonicalMuscleGroup } from './volumeGuidelines';
import type { UserPreferences } from './workoutEngine';

export interface WeekPlanConstraintsV1 {
  version: 1;
  engineVersion: string;
  prescriptionPolicyVersion: string;
  ontologyVersion: string;
  biomechanicsOntologyVersion: string;
  weekStartDate: string;
  trainingGoal: string;
  sessionDurationMinutes: number;
  restDays: number[];
  preferredSplit: string | null;
  weeklySplitSchedule: Record<string, { focus: string; groups: CanonicalMuscleGroup[] }> | null;
  monthlyFocusState: MonthlyFocusStateV1 | null;
  exercisesToAvoid: string[];
  mesocycleWeek: number | null;
  constraintsHash: string;
}

function stableStringify(obj: unknown): string {
  return JSON.stringify(obj, Object.keys(obj as object).sort());
}

export function hashConstraintsPayload(payload: Omit<WeekPlanConstraintsV1, 'constraintsHash' | 'engineVersion'>): string {
  let h = 0;
  const s = stableStringify(payload);
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return `c${Math.abs(h).toString(36)}`;
}

export function buildWeekPlanConstraints(
  prefs: UserPreferences,
  weekStartDate: string,
  restDays: number[],
): WeekPlanConstraintsV1 {
  const core = {
    version: 1 as const,
    prescriptionPolicyVersion: PRESCRIPTION_POLICY_VERSION,
    ontologyVersion: ONTOLOGY_VERSION,
    biomechanicsOntologyVersion: BIOMECHANICS_ONTOLOGY_VERSION,
    weekStartDate,
    trainingGoal: prefs.training_goal ?? 'maintain',
    sessionDurationMinutes: prefs.session_duration_minutes ?? 60,
    restDays: [...restDays].sort(),
    preferredSplit: prefs.preferred_split ?? null,
    weeklySplitSchedule: prefs.weekly_split_schedule ?? null,
    monthlyFocusState: prefs.monthly_focus_state ?? null,
    exercisesToAvoid: [...(prefs.exercises_to_avoid ?? [])].map(s => s.toLowerCase()).sort(),
    mesocycleWeek: prefs.mesocycle_week ?? null,
  };
  return {
    ...core,
    engineVersion: WORKOUT_ENGINE_VERSION,
    constraintsHash: hashConstraintsPayload(core),
  };
}

export function isWeeklyPlanDayStale(
  storedEngineVersion: string | null | undefined,
  storedConstraintsHash: string | null | undefined,
  current: WeekPlanConstraintsV1,
): boolean {
  if (!storedEngineVersion || storedEngineVersion !== current.engineVersion) return true;
  if (!storedConstraintsHash || storedConstraintsHash !== current.constraintsHash) return true;
  return false;
}
