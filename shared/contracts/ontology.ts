export type UUID = string

export type PlanDayStatus = 'planned' | 'adapted' | 'completed' | 'skipped'

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
  muscle_groups: string[]
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
  execution_accuracy: number | null
  idempotency_key: string | null
}

