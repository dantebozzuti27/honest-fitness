/**
 * CANONICAL SOURCE OF TRUTH for CanonicalMuscleGroup is app/src/lib/volumeGuidelines.ts.
 * This file re-declares for consumers outside the app tsconfig boundary.
 * Keep in sync with volumeGuidelines.ts CANONICAL_MUSCLE_GROUPS array.
 */

export type UUID = string

export type PlanDayStatus = 'planned' | 'adapted' | 'completed' | 'skipped'
export type CanonicalMuscleGroup =
  | 'upper_chest'
  | 'mid_chest'
  | 'lower_chest'
  | 'back_lats'
  | 'back_upper'
  | 'upper_traps'
  | 'mid_traps'
  | 'lower_traps'
  | 'anterior_deltoid'
  | 'lateral_deltoid'
  | 'posterior_deltoid'
  | 'biceps'
  | 'triceps'
  | 'quadriceps'
  | 'hamstrings'
  | 'glutes'
  | 'rotator_cuff'
  | 'hip_flexors'
  | 'abductors'
  | 'adductors'
  | 'calves'
  | 'core'
  | 'forearms'
  | 'erector_spinae'

export interface WorkoutPlanVersionDTO {
  id: UUID
  user_id: UUID
  week_start_date: string
  status: 'active' | 'superseded'
  feature_snapshot_id: string | null
  created_at: string
}

export interface WorkoutPlanDayDTO {
  id: UUID
  weekly_plan_id: UUID
  user_id: UUID
  plan_date: string
  day_of_week: number
  day_status: PlanDayStatus
  is_rest_day: boolean
  focus: string | null
  muscle_groups: CanonicalMuscleGroup[]
  planned_workout: Record<string, unknown> | null
  estimated_minutes: number | null
  actual_workout_id: UUID | null
  actual_workout: Record<string, unknown> | null
  llm_verdict: 'pass' | 'minor_issues' | 'major_issues' | null
  llm_corrections: Record<string, unknown>[] | null
}

export interface WorkoutOutcomeEventDTO {
  id: UUID
  user_id: UUID
  generated_workout_id: UUID | null
  workout_date: string
  session_outcome_score: number | null
  outcome_notes: string | null
  idempotency_key: string | null
}

export interface ExerciseExecutionEventDTO {
  id: UUID
  event_id: UUID
  user_id: UUID
  workout_id: UUID | null
  workout_exercise_id: UUID | null
  generated_workout_id: UUID | null
  workout_date: string
  exercise_name: string | null
  set_number: number
  target_weight: number | null
  actual_weight: number | null
  target_reps: number | null
  actual_reps: number | null
  target_time_seconds: number | null
  actual_time_seconds: number | null
  target_rir?: number | null
  actual_rir?: number | null
  set_rpe?: number | null
  is_unilateral?: boolean
  load_interpretation?: 'per_hand_per_side' | 'total_both_per_side' | 'unknown' | null
  reps_interpretation?: 'per_side' | 'total_reps' | null
  execution_accuracy: number | null
  idempotency_key: string | null
}

export type DecisionSourceType = 'observed' | 'inferred' | 'policy' | 'learned'

export interface DecisionProvenanceEventDTO {
  id: UUID
  user_id: UUID
  event_date: string
  source_type: DecisionSourceType
  decision_stage: string
  decision_key: string
  decision_value: Record<string, unknown>
  confidence: number | null
  generated_workout_id: UUID | null
  weekly_plan_id: UUID | null
  model_version: string | null
  policy_version: string | null
  trace_id: UUID
  created_at: string
}

export interface NutritionAdherenceSnapshotDTO {
  id: UUID
  user_id: UUID
  snapshot_date: string
  target_calories: number | null
  actual_calories: number | null
  target_protein_g: number | null
  actual_protein_g: number | null
  target_carbs_g: number | null
  actual_carbs_g: number | null
  target_fat_g: number | null
  actual_fat_g: number | null
  calorie_adherence_score: number | null
  macro_adherence_score: number | null
  source: 'manual' | 'derived' | 'imported'
}

export interface InterventionEpisodeDTO {
  id: UUID
  user_id: UUID
  episode_key: string
  started_on: string
  ended_on: string | null
  goal_context: Record<string, unknown>
  active_policy_params: Record<string, unknown>
  safety_bounds: Record<string, unknown>
  status: 'active' | 'completed' | 'aborted'
  notes: string | null
  created_at: string
  updated_at: string
}

export interface InterventionEpisodeOutcomeDTO {
  id: UUID
  user_id: UUID
  intervention_episode_id: UUID
  measured_on: string
  adherence_score: number | null
  readiness_delta: number | null
  strength_delta: number | null
  weight_trend_delta: number | null
  objective_score: number | null
  regret_score: number | null
  summary: Record<string, unknown>
  created_at: string
}

export interface ReplayScenarioDTO {
  id: UUID
  user_id: UUID
  scenario_name: string
  baseline_policy_version: string
  candidate_policy_version: string
  date_start: string
  date_end: string
  config: Record<string, unknown>
  status: 'pending' | 'running' | 'completed' | 'failed'
  created_at: string
}

export interface ReplayResultDTO {
  id: UUID
  user_id: UUID
  replay_scenario_id: UUID
  workout_date: string | null
  baseline_score: number | null
  candidate_score: number | null
  regret_delta: number | null
  promoted: boolean
  result_payload: Record<string, unknown>
  created_at: string
}

export interface LlmValidationArtifactDTO {
  id: UUID
  user_id: UUID
  generated_workout_id: UUID | null
  verdict: 'pass' | 'minor_issues' | 'major_issues'
  rejection_classes: string[]
  rationale: string | null
  immediate_corrections: Array<Record<string, unknown>>
  pattern_observations: Array<Record<string, unknown>>
  schema_version: string
  model_version: string | null
  created_at: string
}

// Biomechanics ontology used by planning/policy layers.
// This complements the persistence DTOs with first-principles structure.
export type HipActionClass =
  | 'abduction_external_rotation'
  | 'adduction_internal_rotation'
  | 'extension'
  | 'flexion'

export interface MuscleFunctionalRole {
  muscle_group: CanonicalMuscleGroup
  prime_actions: HipActionClass[]
  stabilizer_actions: HipActionClass[]
  interactions: string[]
}

export interface CardioMechanicalLoadSignal {
  source: 'walking' | 'incline_walking' | 'stairs' | 'running' | 'mixed'
  frontal_plane_stability_load: number
  sagittal_plane_load: number
  external_rotation_bias: number
  internal_rotation_bias: number
}

export interface BiomechanicsOntologySnapshot {
  schema_version: string
  updated_at: string
  hip_roles: MuscleFunctionalRole[]
}

export interface MechanicalCouplingEdge {
  source_group: CanonicalMuscleGroup
  target_group: CanonicalMuscleGroup
  coupling_kind: 'synergist_fatigue' | 'stability_transfer' | 'movement_pattern_overlap'
  weight: number
  rationale: string
}

/** @see CardioCapabilityProfile in app/src/lib/trainingAnalysis.ts for the active runtime type */
export interface CardioCapabilityProfileDTO {
  id: UUID
  user_id: UUID
  modality: string
  max_speed: number | null
  comfortable_speed: number | null
  max_incline: number | null
  preferred_hr_zone_low: number | null
  preferred_hr_zone_high: number | null
  confidence_score: number | null
  observed_sessions: number | null
  metadata: Record<string, unknown>
  updated_at: string
  created_at: string
}

export interface SetTransformationAuditDTO {
  id: UUID
  user_id: UUID
  workout_set_id: UUID | null
  workout_id: UUID | null
  exercise_name: string | null
  original_weight: number | null
  transformed_weight: number | null
  original_load_interpretation: string | null
  transformed_load_interpretation: string | null
  reason: string
  confidence: number | null
  batch_id: string | null
  metadata: Record<string, unknown>
  created_at: string
}

