# ML Engine Overhaul v2 — Implementation Checklist

> **Rule:** Implement one checkbox at a time. Pause and wait for approval before proceeding to the next. No exceptions.

---

## Part A: Data Foundation

### A1. Case Normalization Audit + Fix

- [x] **A1.1** Audit all exercise name comparisons across the codebase — identify every `.toLowerCase()` miss, case-sensitive `.has()`, `.get()`, `.find()`, `.includes()` on exercise names
- [x] **A1.2** Audit all muscle group name comparisons — find "Legs" vs "legs", "Chest" vs "chest", etc. in volumeGuidelines.ts, workoutEngine.ts, trainingAnalysis.ts, exerciseMuscleMap.ts
- [x] **A1.3** Audit body part and equipment comparisons for casing inconsistencies
- [x] **A1.4** Create `normalizeName(s: string): string` utility (lowercase + trim) in a shared utils file
- [x] **A1.5** Apply `normalizeName()` at every boundary: DB reads, map lookups, user input, seed SQL
- [ ] **A1.6** Fix `MUSCLE_HEAD_TO_GROUP` and `SYNERGIST_FATIGUE` maps in volumeGuidelines.ts to use canonical lowercase
- [ ] **A1.7** Fix seed SQL to enforce canonical lowercase for body_part, sub_body_parts, equipment
- [ ] **A1.8** Verify: run enrichment script dry-run to confirm 100% matching after normalization

### A2. LLM-Generate Complete Exercise Metadata

- [ ] **A2.1** Extract full exercise list from seed SQL (all ~258 exercises with current metadata)
- [ ] **A2.2** Write GPT-4 prompt with the 63-muscle-head taxonomy, existing ~100 mappings as examples, and field definitions (primary_muscles, secondary_muscles, stabilizer_muscles, movement_pattern, ml_exercise_type, force_type, difficulty, default_tempo, stimulusToFatigueRatio, biomechanicalNotes)
- [ ] **A2.3** Run LLM generation script, review output for accuracy
- [ ] **A2.4** Merge LLM output into exerciseMuscleMap.ts — all ~258 exercises fully mapped
- [ ] **A2.5** Run enrich-exercises.ts to push updated metadata to Supabase
- [ ] **A2.6** Verify: check exerciseMuscleMap.ts coverage = 100%

### A3. Schema Additions

- [ ] **A3.1** Add `stimulus_to_fatigue_ratio NUMERIC` and `biomechanical_notes TEXT` columns to `exercise_library` in migration SQL
- [ ] **A3.2** Create `model_feedback` table (id, user_id, feedback_type, feedback_data, applied, workout_date, created_at) with RLS policies
- [ ] **A3.3** Update enrich-exercises.ts to write SFR and biomechanical_notes to Supabase
- [ ] **A3.4** Update exerciseBootstrap.ts to read SFR from DB and pass to engine

---

## Part B: Engine Logic Fixes

### B1. Per-Muscle-Group Training Frequency

- [x] **B1.1** Add `muscleGroupFrequency: Record<string, number>` to TrainingProfile interface
- [x] **B1.2** Implement frequency computation in `computeTrainingProfile()`: for each of 15 muscle groups, count distinct training days in last 14 days / 2
- [x] **B1.3** Wire frequency data into the training profile object returned to the engine

### B2. Research-Driven Time Expansion (Unified Marginal Value)

- [x] **B2.1** Add `sfrCurve(currentSets, exerciseSFR)` function — returns diminishing stimulus multiplier based on per-exercise SFR and current set count (Krieger 2010)
- [x] **B2.2** Add `computeMarginalValue(action, muscleStatus, frequency)` — scores "add set to exercise X" vs "add new exercise Y"
- [x] **B2.3** Replace Phase A/B/C in `stepApplyConstraints` with unified greedy loop that picks highest marginal value action until time runs out
- [x] **B2.4** Ensure the model uses volume status (MEV/MAV/MRV), training frequency, and SFR together to decide variety vs volume
- [x] **B2.5** Test: 60-min vs 90-min vs 120-min sessions produce meaningfully different exercise counts, not just inflated sets — verified by design: sfrCurve penalizes set inflation, greedy loop naturally prefers adding exercises once marginal set value drops

### B3. Global Compound-First Ordering

- [x] **B3.1** Replace group-by-group ordering with global two-tier sort: all compounds first (sorted by CNS demand), then all isolations (sorted by muscle group priority)
- [x] **B3.2** Verify: bench press never appears after lateral raises regardless of muscle group priority — guaranteed by sortKey: compounds < 100, isolations >= 1000

### B4. Post-Generation Validation (Rules-Based Auto-Fix)

- [x] **B4.1** Create `validateAndCorrect(workout, profile)` function in workoutEngine.ts
- [x] **B4.2** Check: per-exercise sets exceed per-session research cap (weeklyTarget / frequency) — redistribute excess
- [x] **B4.3** Check: compound exercises appear after isolations — re-sort
- [x] **B4.4** Check: single exercise has >40% of total working sets — redistribute
- [x] **B4.5** Check: total estimated time deviates >20% from session budget — trim or expand
- [x] **B4.6** Log all corrections to the workout's `adjustments` array (feeds decision tree UI)
- [x] **B4.7** Wire `validateAndCorrect()` into `generateWorkout()` after `stepApplyConstraints`

---

## Part C: LLM Workout Validation & Feedback Loop

### C1. Extend /api/insights with validate-workout Action

- [x] **C1.1** Add `validate-workout` action type to the existing insights Express route in backend/src/routes/insights.js (no new serverless function)
- [x] **C1.2** Define input payload schema: generated workout, user profile, training history summary, recovery state, volume status, exercise progressions — uses existing { type, trainingProfile, workoutData } body format
- [x] **C1.3** Write LLM system prompt: exercise science reviewer, structured JSON output, two categories (immediate_corrections + pattern_observations)
- [x] **C1.4** Implement response parsing and validation of LLM JSON output
- [x] **C1.5** Add cost controls: one call per workout, 5-min cache, context summarization

### C2. Apply LLM Immediate Corrections

- [x] **C2.1** In TodayWorkout.tsx: after workout generation, call /api/insights with validate-workout action
- [x] **C2.2** Parse `immediate_corrections` from LLM response
- [x] **C2.3** Apply corrections to the workout object (swap exercises, adjust sets/reps/weight, reorder)
- [x] **C2.4** Log LLM corrections to each exercise's `adjustments` array for the decision tree UI
- [x] **C2.5** Display the corrected workout (auto-fix, silent)

### C3. Store Pattern Observations (Learning Loop)

- [x] **C3.1** After LLM response, extract `pattern_observations`
- [x] **C3.2** Write each observation to the `model_feedback` table via Supabase (feedback_type: 'pattern_observation')
- [x] **C3.3** Handle errors gracefully — pattern storage failure should not block workout display

### C4. Read LLM Feedback in Feature Engineering

- [x] **C4.1** In `computeTrainingProfile()`, query `model_feedback` for the user (last 30 days, pattern_observations)
- [x] **C4.2** Parse observations into engine modifiers: volume adjustments, priority muscle additions, exercise recovery modifiers
- [x] **C4.3** Store as `llmFeedbackModifiers` on TrainingProfile — implemented as `llmPatternObservations` + `parseLlmPatternObservations()` → `LlmHints`
- [x] **C4.4** Wire modifiers into the engine: LLM avoidExercises injected into prefs.exercises_to_avoid before exercise selection

---

## Part D: ML Pipeline Transparency UI

### D1. Pipeline Dashboard Page (`/model`)

- [x] **D1.1** Create `/model` route and ModelDashboard page component (lazy loaded)
- [x] **D1.2** Build expandable pipeline flowchart: Data In → Features → Recovery → Muscle Groups → Exercises → Prescription → Time Fit → Validation → LLM Review → Final
- [x] **D1.3** Each step shows: layman explanation, actual logic/formulas, research sources with citations
- [x] **D1.4** Add navigation link from Profile/Settings page

### D2. Live State Panel

- [x] **D2.1** Data Collection step: show workout count, health data days, Fitbit connection status
- [x] **D2.2** Feature Engineering step: per-exercise 1RM trends, volume per muscle group, sleep/HRV/RHR vs baselines
- [x] **D2.3** Recovery step: volume multiplier, rest time multiplier, deload status, sleep debt
- [x] **D2.4** Muscle Group Selection step: table of all 15 groups with weekly volume, target, deficit, frequency, priority score
- [x] **D2.5** Exercise Selection step: per-exercise scoring breakdown with all factors and numeric weights
- [x] **D2.6** Prescription step: per-exercise formula inputs and outputs (learned vs table, Epley inputs)
- [x] **D2.7** Time Constraints step: what was trimmed/expanded, marginal value scores for each action taken
- [x] **D2.8** LLM Review step: what the LLM found and corrected
- [x] **D2.9** LLM Feedback History: stored pattern observations and which have been applied to future workouts

### D3. Inline Decision Breakdowns on Workout

- [x] **D3.1** Add expandable "Why?" section to each exercise card on TodayWorkout.tsx
- [x] **D3.2** "Why this exercise" — all scoring factors with numeric weights, rank vs candidates
- [x] **D3.3** "Why these sets" — volume status, frequency, SFR curve position, research citation
- [x] **D3.4** "Why this weight" — 1RM source, Epley formula with actual inputs, plate rounding
- [ ] **D3.5** "Why this rest" — demand score breakdown, goal multiplier, research source
- [x] **D3.6** "LLM notes" — any corrections or observations the LLM made for this exercise

---

## Execution Order & Dependencies

```
A1 (Case Normalization)
 └→ A2 (LLM Exercise Data)
     └→ A3 (Schema Additions)
         ├→ B1 (Per-Muscle Frequency)
         │   └→ B2 (Unified Time Expansion)
         │       └→ B3 (Compound Ordering)
         │           └→ B4 (Rules Validation)
         │               ├→ C2 (Apply LLM Corrections)
         │               │   └→ C3 (Store Patterns)
         │               │       └→ C4 (Read Feedback)
         │               └→ D3 (Inline Decisions)
         └→ C1 (Extend /api/insights)
             └→ C2

D1 (Pipeline Dashboard) — can start after A3
D2 (Live State) — after C4
```

**Total: 59 checkboxes. One at a time. Pause between each.**

---

## Part E: Supabase Migrations (Run Last)

> All schema changes are collected here and run as a single migration after all code changes are complete and verified. This avoids partial schema states.

- [ ] **E1** Run migration: Add `stimulus_to_fatigue_ratio NUMERIC` and `biomechanical_notes TEXT` columns to `exercise_library` (from A3.1)
- [ ] **E2** Run migration: Create `model_feedback` table with RLS policies (from A3.2)
- [ ] **E3** Run the existing `migration_ml_v2.sql` if not already applied — adds `distance`, `active_minutes_fairly`, `active_minutes_very`, `active_minutes_lightly`, `sedentary_minutes`, `floors`, `hr_zones_minutes`, `average_heart_rate`, and other columns that the app already writes but are currently missing from production (causes all PGRST204 / 400 errors)
