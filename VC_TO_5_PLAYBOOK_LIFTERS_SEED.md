# VC “TO 5/5” PLAYBOOK — HONESTFITNESS (LIFTERS, SEED)

THIS IS A BRUTAL EXECUTION PLAN TO TAKE EVERY SCORECARD CATEGORY IN `VC_BRUTAL_EVALUATION_LIFTERS_SEED.md` TO A **TRUE 5/5 STANDARD**.

IMPORTANT REALITY CHECK:
- “5/5” ACROSS EVERYTHING IS **NOT A WEEKEND PROJECT**.
- THE FASTEST PATH IS: **(1) PRODUCT+RETENTION = 5 FIRST, (2) TRUST = 5, (3) DISTRIBUTION = 5, (4) BUSINESS MODEL = 5**, THEN MOAT/EXPANSIONS.

---

## 1) PRODUCT (LIFTER UTILITY) → 5/5

### 5/5 DEFINITION (NON‑NEGOTIABLE)
- A serious lifter can:
  - start a session in < 10 seconds,
  - log a set in < 3 taps,
  - always know “what to do next” (next set, next load, next exercise),
  - finish a workout and instantly see progression (PRs, weekly volume, prescribed next session).

### DELIVERABLES
- **Progression Prescription Engine (MVP)** inside ActiveWorkout:
  - For each exercise: recommended load/reps (+/-) based on last best + RPE rules.
  - “Next set” defaults + one‑tap increments.
  - “Warmup sets” generator for heavy lifts (optional toggle).
- **Lifter-first templates**:
  - ultra-fast “Push/Pull/Legs”, “Upper/Lower”, “Powerbuilding” templates.
  - in-workout “swap exercise” flow without losing set history.
- **Today page becomes a decision engine**:
  - shows next workout + progression goals for the session (top 2 exercises to beat).
  - shows today health/nutrition only as supporting signals, not the main action.

### KPIs (MUST HIT)
- Median time-to-first-set: **< 30s**
- Median set-entry time: **< 10s** (target < 5s for power users)
- Workouts per active user per week: **≥ 2.5**

---

## 2) RETENTION (EVIDENCE) → 5/5

### 5/5 DEFINITION
You can show cohort retention with confidence and it’s strong for your ICP.

### DELIVERABLES
- **Instrumentation**:
  - activation events: first workout logged, second workout in 7 days, first PR, first schedule.
  - funnels: Auth → First workout started → First set logged → Workout saved.
- **Retention dashboards** (can be internal-only):
  - D1/D7/D30 by cohort (lifters only).
  - sessions/week distribution.
- **Lifecycle messaging** (minimal):
  - “you’re close” nudges based on missed training days.
  - weekly recap.

### KPIs (SEED 5/5 BAR)
- D7 (lifters): **≥ 35%**
- D30 (lifters): **≥ 18%**
- 8-week retention curve flattening: visible “core users”

---

## 3) MARKET/WEDGE → 5/5

### 5/5 DEFINITION
Your wedge is crisp, measurable, and makes switching obvious.

### DELIVERABLES
- Wedge statement (10 words):
  - “Fastest lifter logging + progression prescriptions that improve every session.”
- Positioning page + onboarding copy aligned to lifters (no generic fitness).
- Competitive teardown doc: Strong/Hevy/Fitbod vs HonestFitness.

### PROOF
- User quotes and conversion:
  - “I log faster here.”
  - “It tells me what to do next.”

---

## 4) MOAT → 5/5

### 5/5 DEFINITION
Copying the UI doesn’t copy the advantage.

### DELIVERABLES
- **Compounding training intelligence**:
  - per-user progression model: estimated strength curve, fatigue, adherence.
  - personalized next-session prescriptions.
- **Artifacts that spread**:
  - PR cards, weekly sets by muscle, “top lifts this month” share.
- Optional: community features only if they amplify distribution.

---

## 5) DISTRIBUTION → 5/5

### 5/5 DEFINITION
You have at least one predictable acquisition channel.

### DELIVERABLES (PICK ONE PRIMARY)
- Creator funnel:
  - share cards optimized for TikTok/IG stories.
  - “program template packs” lead magnets.
- Community funnel:
  - powerlifting/bodybuilding discord partnerships.
  - “train with me” weekly challenge.

### KPIs
- One channel with CAC test and retention:
  - CPA target and payback model
- Share rate: **≥ 20%** of retained users share/month

---

## 6) BUSINESS MODEL → 5/5

### 5/5 DEFINITION
Pricing maps to lifter value and gross margins are strong.

### DELIVERABLES
- Subscription tiers:
  - Free: logging + basic history
  - Pro: progression engine + advanced analytics + templates
- Paywall is respectful and timed after value moment.
- Unit economics model (even if early):
  - infra + AI costs accounted for.

### KPIs
- Conversion: **≥ 4–8%** to paid among retained lifters
- Gross margin: **≥ 85%**

---

## 7) TECH/RELIABILITY → 5/5

### 5/5 DEFINITION
The product feels like a bank; no data scares; offline is predictable.

### DELIVERABLES
- Explicit “Sync status” UI:
  - outbox pending count + last sync time
  - clear recovery actions
- Data integrity:
  - idempotent writes, no destructive reads, backoff + retry
- Observability:
  - crash-free sessions, error tracking, slow query tracking

### KPIs
- Crash-free sessions: **≥ 99.7%**
- Support tickets about lost data: **~0**

---

## 8) COMPLIANCE / APP STORE RISK → 5/5

### 5/5 DEFINITION
Apple review is boring; privacy disclosures are accurate; support is real.

### DELIVERABLES
- Real support email + support URL
- Accurate App Privacy answers for:
  - health/fitness data
  - identifiers/analytics
- Native wrapper ready (Capacitor + iOS config) and tested flows

---

## THE EXECUTION ORDER (SO THIS IS ACTUALLY POSSIBLE)

### PHASE 0 (7 DAYS): STOP BLEEDING
- Trust-grade reliability fixes
- Remove/disable distracting surfaces that hurt the lifter loop

### PHASE 1 (30 DAYS): PRODUCT+RETENTION TO 4/5
- Progression engine MVP
- KPI instrumentation
- Today is a decision engine

### PHASE 2 (60–90 DAYS): PRODUCT+RETENTION TO 5/5 + BEGIN DISTRIBUTION
- Share artifacts
- One acquisition channel experiment
- Paywall trial

### PHASE 3 (90–180 DAYS): DISTRIBUTION + BUSINESS MODEL TO 5/5
- Repeatable CAC
- Conversion improvements

---

## WHAT I NEED FROM YOU (TO EXECUTE FAST)
- Your intended **training model**: PPL / UL / powerlifting / bodybuilding?
- Your core metric: **Strength PRs** or **Hypertrophy volume**?





