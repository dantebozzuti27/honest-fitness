# HONEST FITNESS

HONEST FITNESS IS A FULL-STACK APP (VITE FRONTEND + NODE/EXPRESS BACKEND) USING SUPABASE FOR AUTH + POSTGRES.

## REPO STRUCTURE

- `app/` = FRONTEND (VITE/REACT)
- `backend/` = BACKEND (NODE/EXPRESS)
- `api/` = VERCEL SERVERLESS FUNCTIONS (OAUTH/CHAT, ETC)

## TECH STACK (HIGH LEVEL)

- FRONTEND: REACT + VITE
- BACKEND: NODE + EXPRESS
- DB/AUTH: SUPABASE (POSTGRES + POSTGREST + AUTH)
- DEPLOY: VERCEL

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

### FRONTEND (`app/.env`)

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- OPTIONAL:
  - `VITE_ENABLE_TELEMETRY=true` (DEFAULT IS OFF)
  - `VITE_ENABLE_PASSIVE_COLLECTION=true` (DEFAULT IS OFF)
  - `VITE_ENABLE_WORKOUT_CLEANUP=true` (DEFAULT IS OFF)

### BACKEND / SERVERLESS (VERCEL ENV)

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- OPTIONAL:
  - `OPENAI_MODEL`

## SUPABASE SQL (CANONICAL)

RUN THIS IN SUPABASE SQL EDITOR (SAFE/IDEMPOTENT). THIS IS THE ONLY CANONICAL “MIGRATION” FILE IN THE REPO:

- `app/supabase_run_all.sql`

OPTIONAL SEEDS:

- `app/supabase_seed_food_library_expanded.sql` (ADDS MORE SYSTEM FOODS)
- `app/supabase_seed_exercise_library_reset_and_rebuild.sql` (REBUILDS SYSTEM EXERCISES; DESTRUCTIVE TO `IS_CUSTOM = FALSE` ONLY)

RECOMMENDED ORDER FOR A FRESH PROJECT:

1) RUN `app/supabase_run_all.sql`
2) (OPTIONAL) RUN `app/supabase_seed_food_library_expanded.sql`
3) (OPTIONAL) RUN `app/supabase_seed_exercise_library_reset_and_rebuild.sql`

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

## BUILD + TEST

```bash
cd /Users/dantebozzuti/cursor/Projects/Business/honest-fitness
cd app && npm run build
cd ../backend && npm test
```

## IMPORTANT FRONTEND ARCHITECTURE NOTES

- SUPABASE CLIENT SETUP: `app/src/lib/supabase.js`
  - THE SUPABASE CLIENT MAY BE `NULL` IF ENV IS MISSING.
  - UI SHOULD SHOW A CONFIG ERROR SCREEN INSTEAD OF CRASHING.
  - USE `requireSupabase()` WHEN A CALL MUST HARD-FAIL WITH A CLEAR MESSAGE.

- DOMAIN DB MODULES: `app/src/lib/db/*`
  - `workoutsDb.js`, `metricsDb.js`, `feedDb.js`, `scheduledWorkoutsDb.js`, `pausedWorkoutsDb.js`, `userPreferencesDb.js`, `userEventsDb.js`, `summariesDb.js`, `workoutsSessionDb.js`
  - `app/src/lib/supabaseDb.js` EXISTS PRIMARILY FOR BACKWARDS COMPAT RE-EXPORTS.

- OFFLINE OUTBOX SYNC: `app/src/lib/syncOutbox.js`
  - CAPTURES OFFLINE WRITES AND FLUSHES WHEN ONLINE.
  - DISPATCHES `outboxUpdated` EVENT FOR UI UPDATES.

- INDEXEDDB: `app/src/db/index.js` (DYNAMICALLY LOADED THROUGH `app/src/db/lazyDb.js`)

- DESIGN SYSTEM COMPONENTS (CORE):
  - `app/src/components/Button.jsx`
  - `app/src/components/InputField.jsx`
  - `app/src/components/SelectField.jsx`
  - `app/src/components/TextAreaField.jsx`
  - `app/src/components/Skeleton.jsx`
  - `app/src/components/EmptyState.jsx`
  - `app/src/components/ConfirmDialog.jsx`
  - `app/src/components/Toast.jsx`

## IMPORTANT BACKEND / API NOTES

- BACKEND TESTS USE `node:test` AND START A REAL SERVER ON A FREE PORT:
  - `backend/tests/setup.js`
  - `backend/tests/example.test.js`

- SERVERLESS FUNCTIONS LIVE IN `api/` AND ARE DEPLOYED BY VERCEL.
- AI CALLS USE OPENAI (`OPENAI_API_KEY`). NO XAI KEYS SHOULD BE USED.

## VERCEL

THE PROJECT IS SET UP TO BUILD ON VERCEL.

DEPLOY CHECKLIST:

- SET VERCEL ENV VARS: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY` (AND OPTIONAL `OPENAI_MODEL`)
- ENSURE SUPABASE DB IS MIGRATED USING `app/supabase_run_all.sql`

IMPORTANT: BACKEND/SERVERLESS CODE AVOIDS IMPORT-TIME HARD FAILURES BY LAZY-INITIALIZING CLIENTS WHERE NEEDED.

## TROUBLESHOOTING (COMMON FAILURES)

- BLANK/BLACK SCREEN WITH NAV VISIBLE:
  - CHECK `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` IN `app/.env`
  - APP SHOULD RENDER A CONFIG ERROR SCREEN IF ENV IS MISSING

- “THEN IS NOT A FUNCTION” ON HOME INIT:
  - THIS WAS CAUSED BY TREATING A SYNC HELPER AS A PROMISE; ENSURE DATE HELPERS ARE USED CONSISTENTLY

- POSTGREST 406 / 404 / SCHEMA CACHE ISSUES:
  - USE `.maybeSingle()` FOR OPTIONAL SINGLE ROW QUERIES
  - AVOID EMBEDDED JOINS THAT RELY ON POSTGREST RELATIONSHIP CACHE; FETCH IN TWO QUERIES IF NEEDED

- GOAL RPC “COLUMN REFERENCE ... IS AMBIGUOUS”:
  - ENSURE YOU RAN THE LATEST `app/supabase_run_all.sql` (IT CONTAINS THE FIX)

## HOW TO COMMIT

```bash
cd /Users/dantebozzuti/cursor/Projects/Business/honest-fitness
git status
git add -A
git commit -m "YOUR MESSAGE"
git push
```


