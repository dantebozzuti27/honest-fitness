# Full Model + Ontology Audit Report

## Scope

Audited code paths:

- `app/src/lib/workoutEngine.ts`
- `app/src/lib/trainingAnalysis.ts`
- `app/src/lib/volumeGuidelines.ts`
- `shared/contracts/ontology.ts`
- `app/src/pages/OntologyDashboard.tsx`
- `app/src/lib/supabaseDb.ts`
- `backend/src/engines/ml/policyReplay.js`
- `backend/src/routes/ml.js`
- `backend/tests/policyReplay.test.js`
- `sql/migration_ontology_v4_data_capture.sql`
- `sql/migration_hotel_mode_v1.sql`

---

## Executive Summary

The model stack has serious correctness and governance issues in four areas:

1. **Post-optimization invariant breakage** in workout generation.
2. **Ontology/persistence drift** between contracts, schema, and writes.
3. **Promotion-gate trust gap** (client-controlled quality signals).
4. **Inconsistent muscle semantics** between analysis subsystems.

These are structural quality risks, not cosmetic issues.

---

## Findings (Severity Ranked)

## Critical

1. **Adaptive pass can invalidate validated plans**
- **Path:** `app/src/lib/workoutEngine.ts`, `app/src/lib/adaptiveLearningPolicy.ts`
- **Issue:** validation is applied, then adaptive mutation changes sets/reps/rest/cardio without a final full revalidation + recomputed durations.
- **Impact:** generated workout can violate cap/time/invariant expectations after being marked valid.
- **Fix:** run full `validateAndCorrect` + duration recompute after adaptive optimization.

2. **Deadline constraints can be unintentionally cleared**
- **Path:** `app/src/lib/workoutEngine.ts`
- **Issue:** `weekday_deadlines` are reset in certain generation paths when no explicit override is passed.
- **Impact:** time-budget behavior diverges from profile settings; apparent “ignoring constraints.”
- **Fix:** preserve persisted deadline map by default; only patch specific override keys.

3. **Strict promotion gates trust caller-provided quality metrics**
- **Path:** `backend/src/routes/ml.js`, `backend/src/engines/ml/policyReplay.js`
- **Issue:** `/policy/replay` accepts `req.body.qualityGate` and uses it for strict promotion checks.
- **Impact:** spoofable promotion decisions; integrity of model rollout gates is compromised.
- **Fix:** compute gate metrics server-side from trusted telemetry; reject missing metrics in strict mode.

4. **Weekly plan reconciliation can target wrong active plan row**
- **Path:** `app/src/lib/supabaseDb.ts`
- **Issue:** reconciliation updates latest active `weekly_plan_versions` row without strict week scoping.
- **Impact:** wrong/empty plan-day reconciliation, lineage corruption.
- **Fix:** scope by derived `week_start_date` from `workoutDate` plus `user_id`.

5. **Unilateral load interpretation still allows silent miscanonicalization**
- **Path:** `app/src/lib/supabaseDb.ts`, `sql/migration_ontology_v4_data_capture.sql`
- **Issue:** unilateral semantics default heuristics can store wrong per-hand vs total loads when user intent is ambiguous.
- **Impact:** training data poisoning for load progression and model learning.
- **Fix:** require explicit unilateral interpretation in UI; store raw + canonical + confidence.

## High

1. **Ontology dashboard uses incorrect plan-version table name**
- **Path:** `app/src/pages/OntologyDashboard.tsx`
- **Issue:** references `weekly_plans` while schema uses `weekly_plan_versions`.
- **Impact:** incorrect row counts/relationship display; debugging graph is misleading.
- **Fix:** switch to canonical table names and align edge metadata with SQL schema.

2. **Dual muscle-mapping sources create semantic drift**
- **Path:** `app/src/lib/trainingAnalysis.ts`
- **Issue:** some metrics use DB `exercise_library` muscles while others use static exercise map.
- **Impact:** same workout yields inconsistent per-muscle conclusions across features.
- **Fix:** one canonical resolver with explicit fallback policy.

3. **Contract/schema mismatch for execution-event ontology fields**
- **Path:** `shared/contracts/ontology.ts`, `app/src/lib/supabaseDb.ts`, SQL migrations
- **Issue:** DTO fields (`set_rpe`, unilateral semantics, etc.) not consistently persisted in all paths/tables.
- **Impact:** partial ontology capture, downstream feature sparsity.
- **Fix:** align migration + write-paths + DTOs; enforce by schema checks.

4. **Update workflow misses model-critical side-channel writes**
- **Path:** `app/src/lib/supabaseDb.ts`
- **Issue:** `updateWorkoutInSupabase` does not mirror save-time execution events/audit writes.
- **Impact:** edited workouts drift from model-facing truth tables.
- **Fix:** shared write pipeline for save/update; rebuild dependent rows on update.

5. **Promotion logic is synthetic, not true counterfactual replay**
- **Path:** `backend/src/engines/ml/policyReplay.js`
- **Issue:** candidate score is a fixed boost over baseline, not policy simulation.
- **Impact:** “promote” signal is weakly grounded and can overstate improvements.
- **Fix:** label current path as synthetic; gate production promotion on real replay/eval.

6. **Strict gates fail-open on missing telemetry**
- **Path:** `backend/src/engines/ml/policyReplay.js`
- **Issue:** absent/NaN quality fields skip checks instead of failing.
- **Impact:** strict mode is weaker than expected.
- **Fix:** require complete trusted telemetry in strict mode.

## Medium

1. **Duration accounting offset in rationale total**
- **Path:** `app/src/lib/workoutEngine.ts`
- **Issue:** total duration reduce starts with non-zero base.
- **Impact:** constant upward bias in displayed duration.
- **Fix:** normalize accumulator to zero and centralize one duration function.

2. **Case-normalization inconsistency for muscle head mapping**
- **Path:** `app/src/lib/workoutEngine.ts`, `app/src/lib/trainingAnalysis.ts`
- **Issue:** lookups are not uniformly normalized before map resolution.
- **Impact:** intermittent dropped mapping for otherwise valid exercises.
- **Fix:** normalize keys at boundary and assert canonical inputs.

3. **Split taxonomy divergence between detection and planner assumptions**
- **Path:** `app/src/lib/trainingAnalysis.ts`, `app/src/lib/workoutEngine.ts`
- **Issue:** group membership definitions differ for some muscles.
- **Impact:** detected split and generated split can disagree.
- **Fix:** shared split taxonomy module.

4. **Rolling trend set counts use different filtering semantics**
- **Path:** `app/src/lib/trainingAnalysis.ts`
- **Issue:** some aggregates include raw sets while others use filtered working sets.
- **Impact:** confusing and inconsistent trend interpretation.
- **Fix:** standardize set semantics (`working`, `warmup`, `cardio`) across all trend metrics.

5. **Backfill and live unilateral transform heuristics are not fully aligned**
- **Path:** `sql/migration_ontology_v4_data_capture.sql`, `app/src/lib/supabaseDb.ts`
- **Issue:** pattern sets and confidence criteria differ.
- **Impact:** historical and live data normalization may diverge.
- **Fix:** centralize classifier logic and version it.

6. **Scenario status lifecycle lacks robust failure-state handling**
- **Path:** `backend/src/routes/ml.js`
- **Issue:** partial route failures can leave replay scenarios in inconsistent status.
- **Impact:** operational confusion and dashboard noise.
- **Fix:** transaction/RPC wrapper + explicit failed-state updates.

## Low

1. **`CanonicalMuscleGroup` is duplicated in two modules**
- **Path:** `app/src/lib/volumeGuidelines.ts`, `shared/contracts/ontology.ts`
- **Impact:** future drift risk.
- **Fix:** single source type export.

2. **Minor ontology UI semantics mismatch (`llm_verdict` pending state)**
- **Path:** `shared/contracts/ontology.ts`, app consumers
- **Impact:** type/value mismatch risk.
- **Fix:** extend union or map null consistently at adapter boundary.

---

## Root-Cause Themes

- **Late-stage mutation without final normalization pass**
- **Multiple “truth sources” for ontology mapping**
- **Permissive backward-compatibility patterns that silently degrade data quality**
- **Promotion/evaluation infrastructure designed as placeholder but used as gating**

---

## Priority Remediation Plan

## 0-48 hours

1. Enforce final `recompute -> revalidate -> recompute` pass at end of generation pipeline.
2. Lock strict promotion gates to server-derived metrics only.
3. Fix `weekly_plan_versions` reconciliation scoping by workout week.
4. Fix dashboard table references to canonical schema names.

## 1 week

1. Unify muscle mapping resolver across analysis/planner/trends.
2. Unify save/update persistence paths for execution/audit tables.
3. Enforce explicit unilateral interpretation capture; stop heuristic default in ambiguous cases.
4. Add strict-mode fail-closed behavior when required telemetry is missing.

## 2-4 weeks

1. Replace synthetic replay promotions with real offline evaluation.
2. Introduce schema version checks and hard alerts on stripped columns.
3. Consolidate ontology type declarations into one canonical contract module.
4. Add invariant regression tests for:
   - staple/compound preservation under trimming
   - deadline adherence
   - duration consistency after adaptive pass
   - promotion-gate spoof resistance

---

## Acceptance Criteria

- No workout leaves generator with broken hard constraints after adaptive tuning.
- No promotion decision depends on client-supplied quality metrics.
- No plan-day reconciliation writes against wrong week version.
- Muscle-volume/trend outputs are consistent for same input workout history.
- Save/update/edit paths produce identical ontology capture completeness.

---

## Addendum: Why Exercise Selection Feels Unchallenging

User-requested deep dive on challenge quality and treadmill walk intensity semantics.

## High

1. **Selection scoring is over-biased toward familiarity, under-weighting challenge drivers**
- **Path:** `app/src/lib/workoutEngine.ts` (`stepSelectExercises`)
- **Evidence:**
  - Familiarity bonus: `pref.recencyScore * 2.5` plus `+4` staple and `+2` recent-use.
  - Novel exercise penalty: `neverUsedPenalty = -8` from `app/src/lib/modelConfig.ts`.
  - Compound incentive is only `+2`.
- **Why it produces “unchallenging” plans:** the optimizer strongly prefers already-used accessories over higher-challenge compounds unless goal/constraints force otherwise.
- **Fix:** cap recency contribution, reduce default never-used penalty, and add a challenge utility term (compound density, loadability, progression headroom) with hard floor per session.

2. **Challenge objective is implicit; no explicit “minimum effective challenge” constraint**
- **Path:** `app/src/lib/workoutEngine.ts`
- **Issue:** pipeline optimizes for recovery fit/time fit/novelty/diversification but has no final hard constraint like:
  - min number of heavy compounds,
  - min session compound stimulus share,
  - min predicted RPE/RIR challenge budget per goal.
- **Impact:** valid-but-easy sessions pass constraints, especially when accessory groups dominate selection.
- **Fix:** add explicit challenge constraints in final validation (not just selection heuristics).

3. **Accessory-dominant group selection can crowd out demanding anchors**
- **Path:** `app/src/lib/workoutEngine.ts` (`computeHipAbductorLoadSignal`, coupling + ordering + time trimming)
- **Issue:** hip/coupling corrections can front-load or boost isolation priorities, while time-pressure phases then trim by low impact scores; without a hard challenge floor this can leave mostly accessories.
- **Fix:** protect required challenge anchors through all phases (selection, trim, duration stabilization, adaptive pass).

## Medium

4. **Progression/challenge signal is weakly tied to selection score**
- **Path:** `app/src/lib/workoutEngine.ts` (`stepSelectExercises`)
- **Issue:** progression status contributes only `+3/+1/-1`, much smaller than recency/staple stacking.
- **Impact:** engine can continue selecting familiar but low-progression exercises over better overload candidates.
- **Fix:** make progression headroom a first-class weighted objective with bounded but meaningful influence.

---

## Addendum: Why “Speed 4 Treadmill Walk” Is Treated as Low-Impact

## High

1. **Walk-mode speed cap hard-codes a low walk band around ~4.1-4.8 mph**
- **Path:** `app/src/lib/workoutEngine.ts` (`stepPrescribe`, cardio branch)
- **Evidence:** walk inference sets `inferred = clamp(histSpeed + 0.35 or 4.2, 4.1, 4.8)` and then caps speed to this band.
- **Impact:** treadmill walking near 4 mph is algorithmically treated as normal low-impact walk context, not high-intensity cardio, unless incline/duration compensation takes over.
- **Fix:** replace static walk cap with individualized treadmill capability + HR response model; support transition classes (brisk walk / power walk / jog) explicitly.

2. **Modality semantics conflate “walk” intensity with impact category**
- **Path:** `app/src/lib/workoutEngine.ts` (walk modality and interference assumptions)
- **Issue:** walk/treadmill is globally treated as walk-like modality, then adjusted mostly with incline/duration for fat-loss HR compensation.
- **Impact:** user perception (“4 mph is not low impact for me”) diverges from policy assumptions.
- **Fix:** classify cardio intensity by expected HR zone for that user (and body mass, incline, stride), not by activity name alone.

## Medium

3. **Capability profile can be absent; fallback defaults dominate**
- **Path:** `app/src/lib/workoutEngine.ts` (uses `cardioCapabilityProfiles`; fallback to inferred defaults)
- **Issue:** when capability data is sparse, hardcoded fallback band drives behavior.
- **Impact:** prescriptions feel generic.
- **Fix:** require minimum capability calibration samples or conservative adaptive exploration with explicit confidence.
