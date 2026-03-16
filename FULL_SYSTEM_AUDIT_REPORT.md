# Full System Audit Report

Date: 2026-03-16
Scope: frontend app, backend API/ML engines, Supabase persistence contracts, wearable/public data ingestion, LLM integration, weekly planner UX/state model

---

## 1) Errors (Observed + Architectural Error Classes)

### Critical
- **Schema drift causes runtime 400s in nested Supabase selects**
  - Symptom seen in production: `workouts?...workout_exercises(...category, workout_sets(...is_warmup...))` returns 400.
  - Root cause: client queries assume optional columns exist everywhere.
  - Evidence: `TodayWorkout` had to add fallback query shapes in `app/src/pages/TodayWorkout.tsx`.
  - Impact: generation flow collapses when hydration fails.
  - Fix: move schema capability negotiation to startup, fail-fast with explicit migration status, and ban ad hoc column probing in UI paths.

- **Non-atomic weekly plan versioning can leave no valid active plan**
  - Evidence: `saveWeeklyPlanToSupabase` supersedes active version before new insert is guaranteed in `app/src/lib/supabaseDb.ts`.
  - Impact: broken weekly plan read model under transient write failures.
  - Fix: server-side transaction/RPC for version transition + day writes.

- **Inconsistent temporal ordering in backend ML pipelines**
  - Evidence: `backend/src/database/index.js` reads descending by date while engine logic uses positional assumptions in `backend/src/engines/ml/prediction.js`, `backend/src/engines/ml/readiness.js`.
  - Impact: stale/incorrect “latest” feature usage and trend inversion.
  - Fix: canonical chronological contract + assertion tests.

### High
- **Workout validation cache keyed too coarsely**
  - Evidence: `backend/src/routes/insights.js` caches validate-workout by user only.
  - Impact: stale LLM verdict/corrections applied to different workouts.
  - Fix: key by user + workout hash + model version.

- **Idempotency gaps in outcomes/execution telemetry**
  - Evidence: no event id dedupe in `backend/src/routes/input.js` and `app/src/lib/supabaseDb.ts` event writes.
  - Impact: duplicate labels and noisy feedback loops.
  - Fix: event UUID + DB unique constraints.

---

## 2) Palantir-Style Ontology / Entity Model Audit

### Core ontology gaps
- **No single canonical identity for prescription lineage**
  - `generated_workout_id` semantics differ across tables and code paths.
  - Evidence in schema/app contracts around `workouts`, `workout_outcomes`, `prescription_execution_events`, and TypeScript records in `app/src/lib/trainingAnalysis.ts`.
  - Fix: enforce UUID FK lineage as canonical across all plan/actual/outcome entities.

- **Entity/event mixing without strict state machine**
  - Weekly day has `planned_workout`, `actual_workout`, `day_status`, and diff records but no invariant enforcement.
  - Evidence: `weekly_plan_days` and `weekly_plan_diffs` in `sql/migration_ml_v2.sql`.
  - Fix: enforce transition constraints (`planned -> adapted -> completed/skipped`) at DB level.

- **Exercise identity is text-heavy, not entity-heavy**
  - Name snapshots (`exercise_name`) are used where stable IDs should be required.
  - Evidence: execution/swap/event flows in `app/src/lib/supabaseDb.ts` and schema.
  - Fix: store `exercise_library_id` first; keep names only as display snapshots.

### Ontology recommendation
- Define canonical entities:
  - `UserProfile`, `WorkoutPlanVersion`, `WorkoutPlanDay`, `GeneratedWorkout`, `WorkoutSessionActual`, `WorkoutSessionOutcome`, `ExerciseExecutionEvent`, `ModelInferenceRun`.
- Define canonical IDs:
  - `inference_id`, `plan_version_id`, `plan_day_id`, `workout_session_id`, `generated_workout_id`, `event_id`.
- Define immutable event streams:
  - plan_generated, plan_day_adapted, workout_started, workout_completed, outcome_logged, model_feedback_verified.

---

## 3) Parts of the App Not Talking to Each Other

### High
- **Broken route contract from Fitness -> Today AI workout**
  - Evidence: navigation to `'/today-workout'` in `app/src/pages/Fitness.tsx` while router uses `'/today'` in `app/src/App.tsx`.
  - Impact: dead CTA / inconsistent entry points.

- **Navigation mode contract mismatch**
  - Evidence: callers pass `state.mode='picker'`, but `ActiveWorkout` expects `openPicker` style state in `app/src/pages/ActiveWorkout.tsx`.
  - Impact: intent loss from launcher flows.

- **Profile fields saved in UI but not persisted in helper contracts**
  - Evidence: profile payload fields vs whitelist in `app/src/lib/supabaseDb.ts` (`saveUserPreferences` direct fields).
  - Impact: “saved” values not actually affecting behavior.

### Medium
- **Two week models previously coexisted (preview + adaptive day model)**
  - Evidence: duplicated week view/state mechanics in `app/src/pages/TodayWorkout.tsx`.
  - Impact: divergence between what user toggles and what adaptive planner stores.
  - Status: partially improved, still needs single canonical weekly view model across all components.

---

## 4) ML Model Gaps, Errors, and Shortfalls

### Critical / High
- **Objective function coherence is incomplete**
  - Evidence: `canonicalModelContext` and objective utility are partly diagnostic; optimization path remains heuristic-dominant in `app/src/lib/workoutEngine.ts` and feature path in `app/src/lib/trainingAnalysis.ts`.
  - Impact: weak linkage between objective scores and generated plan behavior.

- **Train/serve skew remains between backend ML and frontend generation**
  - Evidence: rich front-end feature/heuristic stack vs thinner backend engines in `backend/src/engines/ml/*`.
  - Impact: inconsistent outputs depending on path and invalid offline eval assumptions.

- **Confidence not calibrated**
  - Evidence: heuristic confidence in readiness/prediction engines (`backend/src/engines/ml/readiness.js`, `backend/src/engines/ml/prediction.js`).
  - Impact: UI confidence labels not probabilistically meaningful.

- **Evaluation harness not integrated as release gate**
  - Evidence: backtest scaffold exists (`backend/src/engines/ml/evalPrediction.js`) but no CI thresholding and weak cohort slicing.
  - Impact: regressions can ship undetected.

### Medium
- **Temporal parsing inconsistencies in analysis**
  - Evidence: mixed local-date-safe parsing and raw `new Date(date)` usage in `app/src/lib/trainingAnalysis.ts`.
  - Impact: timezone-edge drift in recency/frequency/volume features.

---

## 5) Public Data Shortfalls, Errors, and Gaps

### Critical / High
- **Oura sleep duration unit handling likely wrong in edge cases**
  - Evidence: threshold-based assumption in `api/oura/sync.js`.
  - Impact: extreme sleep-duration corruption and downstream model distortion.

- **Wearable sync success semantics can be “success with null metrics”**
  - Evidence: broad catch/fallback in `api/fitbit/sync.js`.
  - Impact: hidden missingness looks like valid data ingestion.

- **Stale source merge behavior**
  - Evidence: merge order in `app/src/lib/wearables.ts` can preserve stale values over fresh provider payloads.
  - Impact: subtle data freshness regressions.

### Medium
- **No strong DB-level guardrails on health metric units/ranges**
  - Evidence: loose numeric columns in schema and permissive fallback behavior.
  - Impact: bad public/provider data can persist and poison features.

---

## 6) LLM Integration Shortcomings

### High
- **Opaque verdict semantics for end-users**
  - Evidence: verdict labels surfaced without strong, structured explanation/action mapping in `TodayWorkout`.
  - Impact: user sees “major_issues” without operational confidence in what to do.

- **Cache and schema discipline weak for LLM validation**
  - Evidence: user-keyed cache in backend validation route and freeform correction ingestion.
  - Impact: stale or context-mismatched corrections.

- **Feedback provenance still partially permissive**
  - Evidence: model-review observations are filtered better than before, but ingestion/storage still allows mixed trust levels.
  - Impact: risk of noisy or circular supervision signals.

### Medium
- **Weak contract between LLM outputs and deterministic correction engine**
  - Evidence: correction application logic in `TodayWorkout` is practical but not strongly schema-versioned.
  - Impact: brittle behavior when output shapes evolve.

---

## 7) UI Errors, Shortcomings, and Gaps

### Critical / High
- **Weekly planner mobile readability and control ergonomics were broken**
  - Symptoms: unreadable day selectors, cramped tap targets, poor scroll behavior.
  - Evidence/fixes centered in `app/src/pages/TodayWorkout.tsx` and `app/src/pages/TodayWorkout.module.css`.
  - Remaining gap: needs stable mobile design tokens and visual regression tests.

- **Per-day control model incomplete before recent fixes**
  - Missing per-day regenerate and poor LLM issue transparency caused loss of trust.
  - Evidence: weekly adaptive section in `TodayWorkout`.

- **Duration representation mismatch**
  - Planned-day displayed duration could diverge from realistic exercise prescription time.
  - Evidence: estimated minutes derivation in weekly UI flow.
  - Remaining gap: show budget trace and duration breakdown by strength/cardio/rest.

### Medium
- **Bottom nav vs page routing semantics are inconsistent**
  - Evidence: `BottomNav` route targets vs canonical pages.
  - Impact: wrong active-state cues and navigation confusion.

- **Fixed-position controls and safe-area behavior**
  - Evidence: fixed `.actions` bottom offset in `TodayWorkout.module.css`.
  - Impact: overlap with bottom nav/keyboard on smaller devices.

---

## 8) Prioritized Remediation Plan

### P0 (Immediate)
- Implement transactional weekly-plan upsert (version + days + diffs).
- Canonicalize route contracts (`/today` only, typed navigation helpers).
- Add schema capability health-check on app boot; block incompatible feature paths with explicit UI message.
- Add event idempotency keys for outcomes/execution events.
- Fix backend temporal ordering contract and add tests.

### P1 (Near-term)
- Enforce ontology constraints:
  - strict UUID lineage for `generated_workout_id`,
  - day-state invariant checks,
  - exercise identity normalization to FK-first.
- Add calibrated confidence pipeline and confidence abstain thresholds.
- Harden LLM validation cache keys and response schema versioning.

### P2 (Mid-term)
- Formalize ontology as contract docs + typed DTOs (frontend/backend/db shared schemas).
- Add data quality score for wearable/public data and gate model influence by completeness.
- Add mobile visual regression suite for Today/Weekly Planner and interactive controls.

---

## 9) Immediate Test Matrix (Must Pass)

- Profile duration set to each option (`30/45/60/75/90/120`) and generator output respects it.
- Weekly plan for Mon-Sun produces non-identical adjacent day signatures unless constrained by very sparse exercise pool.
- Completed-day actual rendering always supersedes planned rendering for same day.
- LLM major/minor verdict panel shows actionable corrections and supports per-day regenerate.
- Missing optional schema columns do not break hydration/generation paths.
- Wearable sync partial failures surface degraded-state semantics (not silent success).

---

## 10) Conclusion

The system has strong ambition and useful foundations, but currently suffers from cross-layer contract drift: ontology looseness, schema variability, heuristic-heavy ML control, and UX/control-state inconsistency in high-impact workflows. The biggest risks are not isolated bugs; they are **contract integrity failures** between UI, generator, and persistence.

The remediation path should prioritize canonical state/IDs, transactional writes, strict typed contracts, and explicit degraded-mode behavior.

