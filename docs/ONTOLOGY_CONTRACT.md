# Ontology Contract (v1)

This document defines the canonical entities and identifiers used across UI, backend, and database.

## Canonical entities

- `UserProfile`
- `WorkoutPlanVersion`
- `WorkoutPlanDay`
- `GeneratedWorkout`
- `WorkoutSessionActual`
- `WorkoutSessionOutcome`
- `ExerciseExecutionEvent`
- `ModelInferenceRun`

## Canonical IDs

- `user_id` (UUID)
- `plan_version_id` (UUID; `weekly_plan_versions.id`)
- `plan_day_id` (UUID; `weekly_plan_days.id`)
- `generated_workout_id` (UUID; `generated_workouts.id`)
- `workout_session_id` (UUID; `workouts.id`)
- `event_id` (UUID; immutable event identity)
- `idempotency_key` (TEXT; unique per user/event stream retry semantics)

## State machine (WorkoutPlanDay)

Allowed states:

- `planned`
- `adapted`
- `completed`
- `skipped`

Allowed transitions:

- `planned -> planned|adapted|completed|skipped`
- `adapted -> adapted|completed|skipped`
- `skipped -> skipped|planned`
- `completed -> completed` (terminal)

Invariants:

- `day_status = completed` requires `actual_workout_id IS NOT NULL`.
- `day_status IN (planned, adapted)` requires `actual_workout_id IS NULL`.

## Event stream semantics

Immutable event stream types:

- `plan_generated`
- `plan_day_adapted`
- `workout_started`
- `workout_completed`
- `outcome_logged`
- `model_feedback_verified`

Retry semantics:

- Event producers must emit a stable `idempotency_key`.
- Consumers write with conflict key `(user_id, idempotency_key)` to prevent duplicates.

## Temporal contract

All ML input series are **chronological ascending** by:

1. `date`
2. `created_at`
3. `id`

Latest datapoint is always `series[series.length - 1]`.

