# HONEST FITNESS

HONEST FITNESS IS A FULL-STACK APP (VITE FRONTEND + NODE/EXPRESS BACKEND) DEPLOYED ON VERCEL. **AUTH IS AMAZON COGNITO** AND **DATA LIVES IN POSTGRES** (TYPICALLY **AMAZON RDS**), ACCESSED VIA THE BACKEND — NOT VIA SUPABASE.

## REPO STRUCTURE

- `app/` = FRONTEND (VITE/REACT)
- `backend/` = BACKEND (NODE/EXPRESS)
- `api/` = VERCEL SERVERLESS FUNCTIONS (OAUTH/CHAT, ETC.)
- `sql/` = ADDITIONAL POSTGRES MIGRATIONS (IDEMPOTENT SCRIPTS)

## TECH STACK (HIGH LEVEL)

- FRONTEND: REACT + VITE
- BACKEND: NODE + EXPRESS (+ VERCEL SERVERLESS WHERE CONFIGURED)
- AUTH: **AMAZON COGNITO** (JWT BEARER TO API)
- DATABASE: **POSTGRES** (`DATABASE_URL` — AWS RDS OR ANY MANAGED POSTGRES)
- DEPLOY: VERCEL

THE FRONTEND `db` CLIENT (`app/src/lib/dbClient.ts`) SPEAKS **POSTGREST-STYLE QUERIES** TO YOUR **`/api/db` PROXY**, WHICH RUNS SQL AGAINST POSTGRES. FILES NAMED `supabaseDb.ts` ARE **LEGACY NAMING**; THEY USE THAT CLIENT, NOT THE SUPABASE HOSTED PRODUCT.

## QUICK START (LOCAL)

PREREQS:

- NODE.JS (LTS RECOMMENDED)
- NPM

```bash
cd /Users/dantebozzuti/cursor/Projects/Business/honest-fitness

# INSTALL ROOT (USED FOR VERCEL/WORKSPACE CONSISTENCY)
npm install --package-lock-only

# FRONTEND
cd app
npm install

# BACKEND
cd ../backend
npm install

# RUN FRONTEND DEV SERVER (OPTIONAL)
cd ../app
npm run dev
```

## REQUIRED ENV VARS

**AUTHORITATIVE REFERENCE:** `.env.example` AT THE REPO ROOT (ALIGNED WITH COGNITO + RDS).

### MINIMUM FOR A REAL APP

- **`DATABASE_URL`** — POSTGRES CONNECTION STRING (E.G. RDS)
- **`COGNITO_USER_POOL_ID`**, **`COGNITO_CLIENT_ID`** (SERVER — SEE `.env.example`)
- **`VITE_COGNITO_USER_POOL_ID`**, **`VITE_COGNITO_CLIENT_ID`** (BROWSER)
- **`VITE_BACKEND_URL`** — API ORIGIN WHEN THE SPA IS NOT SAME-HOST AS THE API (LOCAL DEV OFTEN `http://localhost:3001` OR YOUR VERCEL API BASE)

### AI / OPTIONAL

- **`OPENAI_API_KEY`** (BACKEND / SERVERLESS)
- OPTIONAL: **`OPENAI_MODEL`**, **`CALAI_API_KEY`**

### OPTIONAL FRONTEND FLAGS

- `VITE_PUBLIC_SITE_URL` (HTTPS SITE; OAUTH REDIRECTS / NATIVE BUILDS)
- `VITE_ENABLE_TELEMETRY`, `VITE_ENABLE_PASSIVE_COLLECTION`, `VITE_ENABLE_WORKOUT_CLEANUP` (SEE `.env.example`)

### WEARABLES OAUTH (OPTIONAL)

FITBIT / OURA: SEE `.env.example` FOR FULL LIST.

## POSTGRES / RDS SCHEMA

The canonical RDS-targeted schema is **`sql/rds_schema_v1.sql`**. Its header documents what changed from the old Supabase bundle (no `auth.users`, no RLS, no Supabase Storage). Use this for fresh AWS RDS PostgreSQL 16 databases.

The legacy **`app/supabase_run_all.sql`** is kept for historical reference and for any environment still pinned to Supabase. **Do not use both** — pick one.

### Migrations (`sql/migration_*.sql`)

Each migration is **idempotent** (guarded with `IF NOT EXISTS` / `DO $$ BEGIN ... END $$`). Suggested order for a brand-new RDS database:

1. `sql/rds_schema_v1.sql` — base schema (users, workouts, prefs, exercise/food libraries, etc.)
2. `sql/migration_phase_start_date.sql`
3. `sql/migration_apollo_phase.sql`
4. `sql/migration_meal_logs.sql`
5. `sql/migration_hotel_mode_v1.sql`
6. `sql/migration_weekly_split_schedule_v1.sql`
7. `sql/migration_taxonomy_mesocycle_v1.sql`
8. `sql/migration_workout_exercises_missing_cols.sql`
9. `sql/migration_body_assessments_and_rom.sql`
10. `sql/migration_swap_learning_and_signals_v1.sql`
11. `sql/migration_exercise_library_dedupe_v1.sql`
12. `sql/migration_data_quality_v1.sql`
13. `sql/migration_audit_integrity_v1.sql`
14. `sql/migration_ml_v2.sql`
15. `sql/migration_model_integration_v3.sql`
16. `sql/migration_ontology_v4_data_capture.sql`
17. `sql/migration_monthly_focus_v1.sql` *(profile-level monthly fitness/life focus)*

Optional seeds (run after the schema + migrations are in):

- `app/supabase_seed_food_library_expanded.sql`
- `app/supabase_seed_exercise_library_reset_and_rebuild.sql` *(destructive to `is_custom = false` rows)*

### Running a migration against RDS

The repo includes a tiny runner that uses the backend's `pg` module so you don't have to install `psql`/libpq locally and so SSL behavior matches `backend/src/database/pg.js` (RDS chains are not in Node's default trust store, hence `ssl.rejectUnauthorized: false`).

```bash
# from repo root, with DATABASE_URL exported (or sourced from .env.vercel-prod)
node scripts/run-sql-migration.mjs sql/migration_monthly_focus_v1.sql
```

The runner wraps the file in a single `BEGIN`/`COMMIT`, so a partial failure rolls back. It is **not** a migration framework — there is no history table, no rollback DDL, no out-of-order detection. Apply files in order, on purpose.

## LOCAL DEV

### INSTALL

```bash
cd /Users/dantebozzuti/cursor/Projects/Business/honest-fitness
npm install --package-lock-only
cd app && npm install
cd ../backend && npm install
```

### RUN (OPTIONAL)

```bash
cd /Users/dantebozzuti/cursor/Projects/Business/honest-fitness/app
npm run dev
```

ENSURE **`VITE_BACKEND_URL`** POINTS AT A RUNNING API IF THE FRONTEND CALLS `/api/*` DIRECTLY.

## BUILD + TEST

```bash
cd /Users/dantebozzuti/cursor/Projects/Business/honest-fitness
cd app && npm run build
cd ../backend && npm test
```

## APP STORE (iOS) SUBMISSION

THE FRONTEND (`app/`) IS A WEB APP. **APPLE APP STORE REQUIRES A NATIVE iOS WRAPPER** (CAPACITOR IS THE SIMPLEST PATH).

### iOS WRAPPER (CAPACITOR)

FROM `app/`:

```bash
npm install
npm run ios:build
npx cap add ios
npm run cap:open:ios
```

NOTES:

- OAUTH PROVIDERS TYPICALLY REQUIRE AN HTTPS REDIRECT URL. SET **`VITE_PUBLIC_SITE_URL`** TO YOUR PRODUCTION DOMAIN AND CONFIGURE REDIRECT URLS IN **COGNITO / FITBIT / OURA** (NOT “SUPABASE AUTH”).

### REQUIRED IN-APP COMPLIANCE SURFACES

- PRIVACY POLICY: `/privacy`
- TERMS: `/terms`
- SUPPORT: `/support` (UPDATE `app/src/config/appStore.ts` WITH A REAL SUPPORT EMAIL)
- ACCOUNT DELETION: PROFILE → DELETE ACCOUNT
- DATA EXPORT: PROFILE → EXPORT DATA

## PROFILE FEATURES

### Monthly Focuses (fitness + life)

Profile → "This month's focuses" lets a user pin two priorities for the calendar month:

- **Fitness focus** — one canonical muscle group (chest, biceps, etc.). The workout engine layers extra volume for that group across the week **without overriding the user's split**. On the day **before** a scheduled session that already trains that muscle, the engine treats the day as a "split guard" day: lower priority, no priority-set bonus, and direct working sets for that muscle are capped at 2 with an explicit adjustment note. Heavy work lands on the dedicated split day, not the day before it.
- **Life focus** — free-text habit (e.g. "brush teeth 2× daily") plus per-day check-offs for the current month. Toggling a day writes immediately; the rest of the profile save also flushes the state.

### Storage

- Column: `user_preferences.monthly_focus_state JSONB NULL` (added by `sql/migration_monthly_focus_v1.sql`).
- Shape (`app/src/lib/monthlyFocus.ts`):
  ```ts
  {
    month: 'YYYY-MM',                 // calendar month the state belongs to
    fitness_muscle: string | null,    // canonical muscle key, e.g. 'biceps'
    life_label: string,               // user-defined habit description
    life_completions: { [yyyy_mm_dd: string]: true }
  }
  ```
- The state is **scoped to one month at a time**: when the month rolls over, the engine sees no active focus until the user picks a new one. Past completion history is not kept beyond the current `month` field; if you need long-term habit history, that is a separate concern that should live in its own table.

### Engine integration

- `app/src/lib/workoutEngine.ts` reads `monthly_focus_state` through `parseMonthlyFocusState`, computes `monthlyFocusMuscle` and `monthlyFocusSplitGuard` per planning date, and threads them into `stepSelectMuscleGroups` (priority/filter) and `stepPrescribe` (set cap when the guard is active).
- `app/src/pages/Profile.tsx` owns the picker UI and the daily check-off grid.
- `backend/src/routes/api.js` and `app/src/lib/supabaseDb.ts` whitelist the new column on save.

## IMPORTANT FRONTEND ARCHITECTURE NOTES

- **HTTP DB FACADE:** `app/src/lib/dbClient.ts` — POSTGREST-LIKE `.from().select()` BUILDER; REQUESTS GO TO **`/api/db`** WITH COGNITO **`Authorization: Bearer`**.
- **DOMAIN DB MODULES:** `app/src/lib/db/*` AND **`app/src/lib/supabaseDb.ts`** (LARGE MODULE; NAME IS LEGACY — WRITES/READS THROUGH `dbClient`).
- OFFLINE OUTBOX SYNC: `app/src/lib/syncOutbox.ts`
- INDEXEDDB: `app/src/db/index.ts` (DYNAMICALLY LOADED THROUGH `app/src/db/lazyDb.ts`)
- DESIGN SYSTEM COMPONENTS (CORE):
  - `app/src/components/Button.tsx`
  - `app/src/components/InputField.tsx`
  - `app/src/components/SelectField.tsx`
  - `app/src/components/TextAreaField.tsx`
  - `app/src/components/Skeleton.tsx`
  - `app/src/components/EmptyState.tsx`
  - `app/src/components/ConfirmDialog.tsx`
  - `app/src/components/Toast.tsx`

## IMPORTANT BACKEND / API NOTES

- BACKEND TESTS USE `node:test` AND START A REAL SERVER ON A FREE PORT:
  - `backend/tests/setup.js`
  - `backend/tests/example.test.js`
- SERVERLESS FUNCTIONS LIVE IN `api/` AND ARE DEPLOYED BY VERCEL.
- AI CALLS USE OPENAI (`OPENAI_API_KEY`). NO XAI KEYS SHOULD BE USED.

## VERCEL

THE PROJECT IS SET UP TO BUILD ON VERCEL.

DEPLOY CHECKLIST (TYPICAL):

- SET VERCEL ENV VARS: **`DATABASE_URL`**, **COGNITO POOL/CLIENT IDS**, **`OPENAI_API_KEY`** (AND OPTIONAL `OPENAI_MODEL`)
- ENSURE POSTGRES HAS BEEN INITIALIZED WITH **`sql/rds_schema_v1.sql`** AND ANY EXTRA **`sql/migration_*.sql`** YOUR BRANCH NEEDS (SEE THE “POSTGRES / RDS SCHEMA” SECTION ABOVE)

IMPORTANT: BACKEND/SERVERLESS CODE AVOIDS IMPORT-TIME HARD FAILURES BY LAZY-INITIALIZING CLIENTS WHERE NEEDED.

## TROUBLESHOOTING (COMMON FAILURES)

- **API / AUTH ERRORS AFTER LOGIN:**
  - VERIFY **`VITE_COGNITO_*`** MATCHES THE POOL/CLIENT USED BY THE SERVER
  - VERIFY **`VITE_BACKEND_URL`** MATCHES WHERE `/api` IS SERVED

- “THEN IS NOT A FUNCTION” ON HOME INIT:
  - THIS WAS CAUSED BY TREATING A SYNC HELPER AS A PROMISE; ENSURE DATE HELPERS ARE USED CONSISTENTLY

- POSTGRES / PROXY ERRORS:
  - CONFIRM **`DATABASE_URL`** ON THE API ENV
  - CONFIRM TABLES EXIST (SCHEMA BUNDLE + MIGRATIONS APPLIED)

- GOAL RPC “COLUMN REFERENCE ... IS AMBIGUOUS”:
  - ENSURE YOUR DB HAS THE LATEST DEFINITIONS FROM `sql/rds_schema_v1.sql` PLUS THE FOLLOW-ON `sql/migration_*.sql` FILES

## HISTORICAL DOCS

`AUDIT.md`, `FULL_SYSTEM_AUDIT_REPORT.md`, `ML_ENGINE_OVERHAUL.md`, and assorted notes still say **"Supabase"** in places. They were written before the migration to **AWS Cognito + RDS** and have been intentionally left as-is — they are point-in-time audits, not living docs. When they reference `app/src/lib/supabaseDb.ts` or `app/supabase_run_all.sql`, treat the names as **legacy filenames** for the same RDS-backed code paths described above.

## HOW TO COMMIT

```bash
cd /Users/dantebozzuti/cursor/Projects/Business/honest-fitness
git status
git add -A
git commit -m "YOUR MESSAGE"
git push
```
