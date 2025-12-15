# HonestFitness Full-Scale Audit Report
**Date:** 2025-12-14  
**Scope:** ~316 text files / ~77,947 LOC (excluding `node_modules/`, `.git/`, built assets)  
**Goal:** Production-grade quality across **security, data, ML, performance, UI/UX, reliability, and maintainability**.

---

## Executive Summary

This codebase has **a strong feature surface** (workouts, nutrition, health metrics, social, wearables, AI/ML hooks), but it is currently held back by a few systemic issues:

- **Security boundary gaps (P0)**: Several serverless endpoints (`/api/fitbit/*`, `/api/oura/*`, `/api/chat`) accept **user-controlled `userId`** and use **Supabase service role** internally. Without strict request authentication + `userId` binding, this creates a **high-impact escalation risk** (data/token exfiltration, cross-user sync, token refresh abuse).
- **Schema drift + “graceful degradation” masking failures (P0/P1)**: Many UI flows attempt queries, then fall back to localStorage or silently continue if tables/columns don’t exist. This makes prod behavior inconsistent and hard to debug.
- **Reliability + UX issues from blocking dialogs (P1)**: Heavy use of `alert()` / `confirm()` across core pages (93 occurrences in ~20 files) causes poor mobile UX and breaks app polish.
- **Data model inconsistencies (P1)**: Unified `health_metrics` is a good direction, but there are still legacy tables (e.g., `oura_daily`, `fitbit_daily`) and mixed storage patterns (nutrition sometimes in `health_metrics`, sometimes elsewhere). This complicates ML features and analytics.
- **Large, monolithic modules (P2)**: A few files (`app/src/lib/supabaseDb.js` ~2234 LOC, `ActiveWorkout.jsx` ~2023 LOC, `Analytics.jsx` massive) carry too much responsibility and increase regression risk.

**Overall assessment**: **Great foundation** with real product features, but needs **security hardening** + **data/migration discipline** + **UX polish** + **modularization** to be production-grade at scale.

---

## Architecture Overview (as implemented)

### Frontend (`app/`)
- React (Vite) + Supabase client.
- Heavy client-side business logic in `app/src/lib/*`.
- Social feed rendered on `app/src/pages/Home.jsx` using `getSocialFeedItems()` in `app/src/lib/supabaseDb.js`.
- Wearables sync via serverless `/api/*` endpoints (Fitbit/Oura).
- AI “chat” via `/api/chat` (xAI Grok) used to generate workouts in multiple pages.

### Backend (`backend/`)
- Express app with routes under `/api/*` (input, ML, personalization, output, pipeline).
- Auth middleware verifies Supabase JWT via `supabase.auth.getUser(token)`.
- DB layer uses Supabase client.

### Vercel (`/api` + `vercel.json`)
- `vercel.json` rewrites `/api/:path*` → `/api/index.js`, and everything else → `/index.html`.
- There are *also* individual serverless handlers under `/api/fitbit/*`, `/api/oura/*`, `/api/chat.js`.  
  **Important:** The rewrite can interact with function routing in surprising ways; treat this deployment surface carefully.

---

## P0 (Critical) Issues — Fix Before Scaling

## 1) Serverless endpoints accept arbitrary `userId` + use service role (privilege escalation risk)

### What we saw
- `api/fitbit/sync.js`, `api/fitbit/refresh.js`, `api/oura/sync.js`, `api/oura/refresh.js` take `{ userId, ... }` from `req.body`.
- Those endpoints create a Supabase client using `SUPABASE_SERVICE_ROLE_KEY`.
- Some requests include `Authorization` header from the client (e.g. `syncFitbitData()`), but the serverless handlers **do not validate it** and **do not bind `userId` to the authenticated subject**.

**Files:**
- `api/fitbit/sync.js`
- `api/fitbit/refresh.js`
- `api/oura/sync.js`
- `api/oura/refresh.js`
- `app/src/lib/wearables.js` (calls `/api/fitbit/sync`, `/api/fitbit/refresh`, `/api/oura/sync`, `/api/oura/refresh`)

### Impact
If an attacker can call these endpoints, they can:
- request token refresh for another user (by passing their `userId`)
- retrieve or overwrite token rows in `connected_accounts`
- trigger wearable sync for another user

This is a **high-severity** security issue because service role bypasses RLS.

### Action plan
- **P0-A**: Require Authorization on all wearable endpoints and validate it server-side.
  - Verify JWT with Supabase (`auth.getUser(token)`).
  - Ignore `userId` from request body; instead derive `userId = authUser.id`.
- **P0-B**: Remove or strictly gate endpoints that accept a refresh token in the request body.
  - Prefer refresh token retrieval from DB for the authenticated user.
- **P0-C**: Add per-user rate limiting and anti-abuse checks.
- **P0-D**: Log structured security events and alert on anomalies (e.g., repeated refresh failures, cross-user attempts).

---

## 2) `api/chat.js` lacks auth + allows arbitrary external LLM calls

### What we saw
`api/chat.js` proxies to xAI with `XAI_API_KEY`. It accepts `messages` and returns the response. There is no authentication/rate limiting tied to a user identity. Multiple pages call it (e.g. `Fitness.jsx`).

**Files:**
- `api/chat.js`
- `app/src/pages/Fitness.jsx` (calls `/api/chat`)
- `app/src/pages/Nutrition.jsx`, `app/src/pages/Workout.jsx`, `app/src/pages/Goals.jsx`, `app/src/pages/Planner.jsx` (calls `/api/chat`)

### Impact
- Cost/rate-limit exposure (anyone can hammer it).
- Prompt injection risk (expected).
- Potential leakage of user context if you later add more context to prompts.

### Action plan
- **P0-E**: Add authentication and per-user rate limiting to `/api/chat`.
- **P0-F**: Enforce request size limits and validate schema (`zod`).
- **P0-G**: Add allowlist models and hard caps (max tokens, max messages length).
- **P0-H**: Add server-side logging of request metadata (not raw content) + error analytics.

---

## 3) Token leakage incident (process issue)

You previously pasted a GitHub token into chat. Treat this as a reminder:
- Never paste secrets into chat/console logs.
- Rotate any token immediately when exposed.

### Action plan
- **P0-I**: Add a “secret hygiene” checklist to your dev workflow.
- **P0-J**: Add a pre-commit secret scan (e.g., gitleaks) locally.

---

## P1 (High) Issues — Next Sprint

## 4) Schema drift + “graceful degradation” hides real problems

### What we saw
Code frequently handles missing columns/tables with silent catches and local fallbacks:
- Feed items: if `feed_items` missing → logs, fallback behavior
- Active workout sessions: if server table missing → store to `localStorage`
- Nutrition settings columns: warn “migration not run”

**Files:**
- `app/src/lib/supabaseDb.js`
- `app/src/pages/ActiveWorkout.jsx`
- `app/src/lib/nutritionDb.js`
- `app/src/lib/wearables.js`

### Impact
- Production behavior varies based on migration state.
- Hard to debug: app “sort of works” but silently loses features.
- Risk of corrupted/incomplete data.

### Action plan
- **P1-A**: Make migrations mandatory and versioned:
  - Store `schema_version` in DB.
  - App checks it at startup and prompts admins if out of date.
- **P1-B**: Remove silent fallbacks for core tables in production (fail loudly).
  - Keep fallbacks only behind explicit DEV flags.

---

## 5) Local storage used for critical state + PII-adjacent data

### What we saw
Local/session storage usage is high, including “active workout” state and “ghost mode” nutrition.
Top offender: `ActiveWorkout.jsx`.

**Files:**
- `app/src/pages/ActiveWorkout.jsx`
- `app/src/pages/Nutrition.jsx`
- `app/src/pages/GhostMode.jsx`
- `app/src/lib/eventTracking.js` (queues)
- `app/src/components/ShareModal.jsx` (fallback feed share)

### Impact
- Data integrity issues (stale/partial state)
- Privacy concerns on shared devices
- Storage size/eviction risks

### Action plan
- **P1-C**: Move workout state to IndexedDB (you already depend on `idb`) with TTL + versioning.
- **P1-D**: Use server persistence for recovery flows (`active_workout_sessions`) and remove local fallback in prod.
- **P1-E**: Add encryption-at-rest for any sensitive local data or avoid storing it.

---

## 6) Blocking UX: heavy use of `alert()` and `confirm()`

### What we saw

Blocking dialogs are used heavily across core workflows (profile, wearables, workout creation, deletion, sharing).

**Measured:** ~93 occurrences across ~20 files (highest counts in `Profile.jsx`, `Wearables.jsx`, `Workout.jsx`, `Nutrition.jsx`, `ActiveWorkout.jsx`).

**Files (examples):**
- `app/src/pages/Profile.jsx`
- `app/src/pages/Wearables.jsx`
- `app/src/pages/ActiveWorkout.jsx`
- `app/src/components/ShareModal.jsx`

### Impact
- Bad mobile UX (focus traps, awkward keyboard behavior).
- Inconsistent UI styling (breaks “Apple polish” goals).
- Hard to internationalize and test.

### Action plan
- **P1-F**: Replace alerts/confirms with a single non-blocking modal/toast system.
  - Use `useToast()` + `<Toast />` everywhere for notifications.
  - Use a shared `<ConfirmDialog />` component for confirmations.
- **P1-G**: Add consistent error surfaces (empty state + retry CTA) instead of `alert('Failed…')`.

---

## 7) Profile pictures stored as base64 in DB (cost + performance)

### What we saw
`Profile.jsx` reads images as base64 and stores in `user_profiles.profile_picture` (and also in preferences).

**File:**
- `app/src/pages/Profile.jsx`

### Impact
- DB bloat + slower queries.
- More bandwidth for every feed/profile lookup.
- Harder to cache, optimize, or invalidate.

### Action plan
- **P1-H**: Use Supabase Storage (or another object store).
  - Store `profile_picture_url` in DB.
  - Keep base64 only as short-term preview state client-side.

---

## 8) Mixed backend strategy (two “backends” live at once)

### What we saw
- Frontend uses Supabase directly for most CRUD (`supabaseDb.js`), **and** has a “new backend” client (`app/src/lib/backend.js`) that talks to the Express backend.
- AI chat uses serverless `/api/chat`, not the Express backend.

**Files:**
- `app/src/lib/supabaseDb.js`
- `app/src/lib/backend.js`
- `backend/src/routes/*`
- `api/chat.js`

### Impact
- Confusing source of truth.
- Hard to enforce validation/rate limits consistently.
- Repeated logic (data shaping and validation in multiple places).

### Action plan
- **P1-I**: Pick a single “API boundary” for business logic.
  - Either: frontend → backend → DB (preferred for scale/security), or
  - frontend → Supabase only (then serverless only for OAuth/3p).
- **P1-J**: If keeping backend: move chat/wearables endpoints behind the same auth + logging + rate limit layer.

---

## P2 (Medium) Issues — Improve Maintainability & Speed

## 9) Monolithic modules and high regression risk

### What we saw
- `app/src/lib/supabaseDb.js` (~2234 LOC): workout CRUD, feed, metrics, summaries, everything.
- `app/src/pages/ActiveWorkout.jsx` (~2023 LOC): timers, autosave, UI, sync, recovery, sharing.
- `app/src/pages/Analytics.jsx`: extremely large, many responsibilities.

### Impact
- Hard to reason about.
- Small changes can break unrelated flows.
- Slow iteration velocity.

### Action plan
- **P2-A**: Split `supabaseDb.js` into domain modules:
  - `workoutsDb.js`, `healthDb.js`, `feedDb.js`, `profilesDb.js`, `summariesDb.js`
- **P2-B**: Split `ActiveWorkout.jsx`:
  - `useWorkoutTimer`, `useWorkoutAutosave`, `useWorkoutRecovery`, `useWorkoutShare`
- **P2-C**: Add thin typed interfaces (TypeScript or Zod schemas at boundaries).

---

## 10) Inconsistent error handling & missing observability

### What we saw
- Mixed patterns: silent catches, `console.error`, `alert`, and `logError`.
- Frontend logger exists, but not uniformly used.
- No centralized error reporting (Sentry/etc.).

**Files (examples):**
- `app/src/utils/logger.js`
- `backend/src/utils/logger.js`
- `app/src/pages/Profile.jsx` (many `alert()` + console)

### Action plan
- **P2-D**: Standardize:
  - Frontend: always use `logError()` + user-facing `Toast`.
  - Backend: structured logs + consistent error JSON shape.
- **P2-E**: Add production error reporting (Sentry) and performance telemetry (basic).

---

## 11) Wearables data pipeline: duplication + incomplete auth on serverless

### What we saw
- Fitbit and Oura logic exists in multiple layers (frontend lib, serverless, backend input routes).
- Token refresh logic duplicated (`tokenManager.js`, `wearables.js`, serverless refresh handlers).

### Action plan
- **P2-F**: Consolidate token refresh into one path (prefer server-side).
- **P2-G**: Remove duplication between backend `routes/input.js` and Vercel `/api/*` or clearly separate their roles.

---

## UI/UX Audit Highlights

## 12) Navigation & information architecture

### What we saw
The app is feature-rich, but the UI surfaces many advanced concepts without progressive disclosure.

**Examples:**
- Analytics page imports many capabilities and charts; risk of being overwhelming.
- Home feed mixes scheduling + social + pull-to-refresh + friend management.

### Action plan
- **P2-H**: “Beginner mode” onboarding:
  - First-run: focus on logging a workout + viewing one insight.
  - Progressive unlock: wearables, analytics, goals, social.
- **P2-I**: Add consistent empty states + “what to do next” CTAs.

---

## Data/ML Audit Highlights

## 13) Schema direction is good but needs consolidation

### What we saw
`health_metrics` is intended as a unified table with RLS policies (good). However:
- Materialized views assume consistent metrics presence.
- Legacy tables exist (`oura_daily`, `fitbit_daily`) and code still writes to them.
- Nutrition appears in `health_metrics` and also has separate flows.

**Files:**
- `app/supabase_migrations_unified_health_metrics.sql`
- `app/supabase_migrations_all_in_one.sql`
- `app/src/lib/wearables.js`

### Action plan
- **P2-J**: Define “golden tables” and “deprecated tables”.
- **P2-K**: Add a one-time backfill + cut-over plan.
- **P2-L**: Add schema tests: migrations should be idempotent and ordered.

---

## Deployment/Config Audit Highlights

## 14) Vercel routing complexity

### What we saw
`vercel.json` rewrites all `/api/*` to `/api/index.js`, while multiple serverless handlers exist under `/api/*`.

### Risk
- Routing collisions and surprising behavior.
- Security and auth assumptions can differ by deployment path.

### Action plan
- **P2-M**: Decide:
  - Either use `/api/index.js` (Express) as the only `/api/*` handler and move Fitbit/Oura/chat behind it, or
  - Keep separate serverless handlers and remove broad rewrite.

---

## Prioritized Action Plan (Phased)

## Phase 0 (Today–48h): Stop the bleeding (P0)
- **P0-A** Authenticate + bind `userId` server-side for wearables endpoints.
- **P0-E** Authenticate + rate limit `/api/chat`.
- **P0-I** Add secret scanning + rotation SOP.

## Phase 1 (This week): Make prod behavior deterministic (P1)
- **P1-A** Enforce migration baseline, remove silent fallbacks in prod.
- **P1-F** Replace `alert/confirm` with Toast/Modal system.
- **P1-H** Move profile pics to Storage.
- **P1-I** Choose a single backend boundary and align all integrations.

## Phase 2 (This sprint): Pay down tech debt (P2)
- **P2-A/B/C** Split monolith files, introduce typed boundaries.
- **P2-D/E** Add Sentry, unify error strategy.
- **P2-J/K/L** Consolidate schema, deprecate legacy tables cleanly.
- **P2-M** Simplify Vercel routing.

---

## “Next 10 Tasks” (Concrete)

1. **(P0)** Add JWT verification to `api/fitbit/*` and bind `userId` from token (ignore body).
2. **(P0)** Add JWT verification + limiter to `api/chat.js`.
3. **(P1)** Replace `alert/confirm` in `Profile.jsx`, `Wearables.jsx`, `ShareModal.jsx` with Toast + ConfirmDialog.
4. **(P1)** Migrate profile pictures to Supabase Storage and store URL in `user_profiles`.
5. **(P1)** Add `schema_version` table + enforce minimum version at app startup.
6. **(P1)** Remove prod localStorage fallback for `active_workout_sessions` once migration is in place.
7. **(P2)** Extract feed logic from `supabaseDb.js` into `feedDb.js` and add explicit pagination.
8. **(P2)** Reduce `ActiveWorkout.jsx` responsibilities via hooks.
9. **(P2)** Consolidate wearables token refresh into server-only flow.
10. **(P2)** Add Sentry (frontend + backend) and wire into `logError`.

---

## Appendix: Key File Hotspots (by risk)

- **Security/Secrets**
  - `api/fitbit/sync.js`, `api/fitbit/refresh.js`
  - `api/oura/sync.js`, `api/oura/refresh.js`
  - `api/chat.js`
  - `backend/src/middleware/auth.js`
- **Data integrity / state**
  - `app/src/pages/ActiveWorkout.jsx`
  - `app/src/lib/supabaseDb.js`
  - `app/src/lib/wearables.js`
- **UX + reliability**
  - `app/src/pages/Profile.jsx`
  - `app/src/pages/Wearables.jsx`
  - `app/src/components/ShareModal.jsx`
  - `app/src/pages/Analytics.jsx`


