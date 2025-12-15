## Touched-files audit (coverage-based)

This report audits **every in-scope file we touched** (committed + current working tree), excluding vendor/build artifacts (`app/node_modules/`, `app/dist/`).

### Coverage
- **Touched in-scope files**: 107
- **Coverage list source**: `AUDIT_TOUCHED_FILES_LIST_EFFECTIVE.txt`

### Key automated scan signals (heuristics)
- `import_time_throw`: top-level throws that can blank the app
- `window_global`: direct `window/document` usage (needs SSR/safety checks)
- `service_role`: backend/service-role coupling risk

### Executive summary (what’s most likely to break the app)
- **P0 — Repo hygiene incident (must fix ASAP)**: `app/node_modules/` and `app/dist/` were committed previously (and partially removed). This causes cross-platform churn (Windows binaries deleted) and huge diffs. Fix is: ensure `app/node_modules/` and `app/dist/` are **gitignored** and **removed from tracking** via `git rm -r --cached`.
- **P0 — “Blank pages” class of failures**: most commonly caused by **import-time crashes** or config/env mismatches. We have multiple “import_time_throw” hits across touched files and multiple modules coupled to environment variables and `window` globals.
- **P0 — Outbox UI currently broken**: `BottomNav` calls `getOutboxPendingCount()` with **no userId**, but `syncOutbox.getOutboxPendingCount(userId)` returns 0 if `userId` is missing. Also `enqueueOutboxItem` does **not** dispatch the `outboxUpdated` event that `BottomNav` subscribes to. Net: the pending-sync badge will not update / often never show.

### P0 findings (fix order)
#### 1) Stop tracking build/vendor outputs
- **Files involved**: `.gitignore`, `app/node_modules/*` (should not be tracked), `app/dist/*` (should not be tracked)
- **Impact**: platform-specific build artifacts cause random deletions and “it works on my machine” chaos.
- **Fix**: add to `.gitignore` and run `git rm -r --cached app/node_modules app/dist`.

#### 2) Make app boot deterministic (no import-time throws)
- **Files**: `app/src/main.jsx`, `app/src/lib/supabase.js`, plus any file flagged `import_time_throw`
- **Impact**: one top-level throw can cause “nav renders but routes fail” or a blank render depending on bundling.
- **Fix**: never `throw` at module top-level for configuration. Prefer “config ok” flags and render an explicit error surface.

#### 3) Fix outbox badge + events (currently broken)
- **Files**: `app/src/components/BottomNav.jsx`, `app/src/lib/syncOutbox.js`
- **Bug**:
  - `BottomNav` calls `getOutboxPendingCount()` with no args.
  - `syncOutbox.enqueueOutboxItem` doesn’t emit `window.dispatchEvent(new CustomEvent('outboxUpdated'))`.
- **Fix**:
  - Call `getOutboxPendingCount(user.id)`
  - Emit `outboxUpdated` in enqueue + after flush updates.

### P1 findings (serious, but not immediate crashers)
#### SQL “run-all” ergonomics and idempotency
- **Files**: `app/supabase_run_all.sql`, `app/supabase_migrations_feed.sql`, `app/supabase_migrations_social_fixes.sql`
- **Risk**: Supabase SQL editor runs can fail mid-file unless every `CREATE POLICY` / `CREATE TRIGGER` / extension-dependent index is guarded.
- **Status**: we added guards for policies/triggers and `pg_trgm`-dependent trigram indexes (skip-if-not-available).
- **Remaining risk**: very large concatenated scripts can time out; safer to run in ordered chunks for real production migration history.

#### Supabase DB write patterns risk data loss / performance regressions
- **File**: `app/src/lib/supabaseDb.js`
- **Risk areas**:
  - “Duplicate workout” cleanup by date with deletes can remove legitimate multiple sessions in one day.
  - Large `.select('*')` patterns; missing pagination in places; wide payload reads.
  - Mixed schema “graceful degradation” (catching missing columns/tables) can hide real schema drift.
- **Fix direction**: enforce a stable schema and constraints (unique keys where intended) and remove “delete duplicates” heuristics in favor of real identifiers.

#### Wearables integration has production footguns
- **File**: `app/src/lib/wearables.js`
- **Risk**: PAT (personal access token) methods throw in production; UI must ensure these flows are not reachable in prod builds.

### P2 notes (quality/maintainability)
- **Design system**: `Button`, `InputField`, `SelectField`, `TextAreaField`, `Skeleton`, `EmptyState`, `ConfirmDialog` are directionally good; next step is to remove remaining per-page ad hoc button styling (class-based) and standardize variants/sizes.
- **Debugging UX**: `app/src/components/DebugOverlay.jsx` is useful for unblocking runtime diagnosis; keep it gated behind `?debug=1`.

### Focused file notes (highest leverage touched files)
#### Frontend boot + routing
- **`app/src/main.jsx`**:
  - **Good**: fails “loudly” with a fallback UI when render throws; aggressive SW unregistration reduces “stale asset” blanks.
  - **Risk**: repeated auto-reloads if root stays empty; can loop if an exception occurs before first paint. Prefer a single reload attempt and then a stable error screen.
- **`app/src/App.jsx`**:
  - **Good**: route-level lazy loading + Suspense boundaries; global error capture.
  - **Risk**: a lot of side effects in `useEffect` (outbox flush, wearable sync, onboarding check). If any of those throws synchronously, pages can appear “blank” under nav. Keep everything best-effort and isolate to per-feature hooks.
- **`app/src/lib/supabase.js`**:
  - **Critical**: never throw at import time. Export a config status and ensure the app renders an explicit configuration screen if missing.

#### Data integrity / offline
- **`app/src/lib/syncOutbox.js`**:
  - **Good**: bounded queue + exponential backoff.
  - **Bug**: no `outboxUpdated` event dispatch; UI won’t update.
  - **Gap**: `getOutboxPendingCount(userId)` signature mismatch with current `BottomNav` usage.
- **`app/src/components/BottomNav.jsx`**:
  - **Bug**: calls `getOutboxPendingCount()` with no `userId` → badge stays 0.
  - **Fix**: `getOutboxPendingCount(user.id)` plus ensure outbox emits `outboxUpdated`.

#### Supabase database operations
- **`app/src/lib/supabaseDb.js`**:
  - **High-risk behavior**: “delete duplicate workouts by date” can delete legitimate multiple sessions in a single day.
  - **Recommendation**: treat workouts as immutable sessions keyed by `id`; if you need “one-per-day,” enforce it by constraint and UX, not deletes.
- **`app/src/lib/nutritionDb.js`**:
  - **Recent bug fix**: had malformed `try/catch` that broke Vite import analysis; now fixed.
  - **Recommendation**: keep it strict ES syntax; avoid mixing huge nested try blocks—extract helpers.

#### Wearables
- **`app/src/lib/wearables.js`**:
  - **Risk**: PAT flows must not be reachable in prod; ensure UI hides them.
  - **Recommendation**: split PAT-only functions into a dev-only module to avoid accidental production usage.

#### Exercise catalog (your “cable + machine” complaint)
- **`app/supabase_seed_exercise_library_reset_and_rebuild.sql`**:
  - **Reality**: it already includes some **machine** and **cable** entries (e.g., `Hack Squat Machine`, `Leg Press`, `Machine Chest Press`, `Cable Pull-Through`) but the catalog is not yet “complete” for cable stack / machine variations.
  - **Next step**: expand coverage for *all major cable* movements (row/pulldown/press/fly/curl/pushdown/lateral raise/woodchop/Pallof) and *selectorized/plate-loaded* machines across all body parts, with consistent equipment tokens (`cable`, `machine`, `selectorized`, `plate_loaded`, `attachments:*`).

#### Backend test reliability
- **`backend/tests/setup.js`**, **`backend/tests/example.test.js`**:
  - **Good**: server is started/stopped in tests; no hard dependency on manual server startup.
  - **Risk**: tests currently depend on the full backend import graph; avoid import-time side effects (e.g. OpenAI client instantiation).
- **`backend/src/engines/ai/index.js`**:
  - **Good**: OpenAI client is now lazy; missing key doesn’t crash tests at import time.

### File-by-file coverage list

| Class | File | Risk signals |
|---|---|---|
| app-config | `app/index.html` |  |
| app-config | `app/package-lock.json` |  |
| app-other | `app/src/App.jsx` | window_global |
| app-other | `app/src/main.jsx` | console_calls, supabase_env, window_global |
| audit-artifact | `AUDIT_IN_SCOPE_FILES.txt` |  |
| audit-artifact | `AUDIT_TOUCHED_FILES_IN_SCOPE.json` |  |
| audit-artifact | `AUDIT_TOUCHED_FILES_LIST.txt` |  |
| audit-artifact | `AUDIT_TOUCHED_FILES_SCAN.json` |  |
| audit-artifact | `FULL_AUDIT_FILE_MANIFEST.txt` |  |
| backend | `backend/src/database/index.js` | import_time_throw, service_role, supabase_env |
| backend | `backend/src/engines/ai/index.js` |  |
| backend | `backend/src/index.js` | service_role, supabase_env |
| backend-tests | `backend/tests/example.test.js` | fetch_api |
| backend-tests | `backend/tests/setup.js` | console_calls, fetch_api, import_time_throw, service_role, supabase_env |
| docs | `ONE_MONTH_APPLE_GRADE_ACTION_PLAN.md` | window_global |
| docs | `WORK_LOG_NEXT_STEPS_2025-12-15.md` |  |
| frontend-component | `app/src/components/AddFriend.jsx` |  |
| frontend-component | `app/src/components/BackButton.jsx` | window_global |
| frontend-component | `app/src/components/BackButton.module.css` |  |
| frontend-component | `app/src/components/BarChart.jsx` | window_global |
| frontend-component | `app/src/components/BottomNav.jsx` | window_global |
| frontend-component | `app/src/components/BottomNav.module.css` |  |
| frontend-component | `app/src/components/Button.jsx` |  |
| frontend-component | `app/src/components/Button.module.css` |  |
| frontend-component | `app/src/components/ChartExample.jsx` |  |
| frontend-component | `app/src/components/CommandPalette.jsx` | window_global |
| frontend-component | `app/src/components/CommandPalette.module.css` |  |
| frontend-component | `app/src/components/ConfirmDialog.jsx` | window_global |
| frontend-component | `app/src/components/ConfirmDialog.module.css` |  |
| frontend-component | `app/src/components/DebugOverlay.jsx` |  |
| frontend-component | `app/src/components/EmailCapture.jsx` |  |
| frontend-component | `app/src/components/EmptyState.jsx` |  |
| frontend-component | `app/src/components/EmptyState.module.css` |  |
| frontend-component | `app/src/components/ErrorBoundary.jsx` | window_global |
| frontend-component | `app/src/components/ExercisePicker.jsx` |  |
| frontend-component | `app/src/components/ExercisePicker.module.css` |  |
| frontend-component | `app/src/components/FriendRequests.jsx` | window_global |
| frontend-component | `app/src/components/HistoryCard.jsx` |  |
| frontend-component | `app/src/components/HistoryCard.module.css` |  |
| frontend-component | `app/src/components/Icons.jsx` |  |
| frontend-component | `app/src/components/InputField.jsx` |  |
| frontend-component | `app/src/components/InputField.module.css` |  |
| frontend-component | `app/src/components/InsightsCard.jsx` |  |
| frontend-component | `app/src/components/InviteFriends.jsx` | window_global |
| frontend-component | `app/src/components/Onboarding.jsx` | window_global |
| frontend-component | `app/src/components/PasswordStrengthIndicator.jsx` |  |
| frontend-component | `app/src/components/PredictiveInsights.jsx` |  |
| frontend-component | `app/src/components/SelectField.jsx` |  |
| frontend-component | `app/src/components/ShareCard.jsx` |  |
| frontend-component | `app/src/components/ShareModal.jsx` | fetch_api, window_global |
| frontend-component | `app/src/components/ShareModal.module.css` |  |
| frontend-component | `app/src/components/Skeleton.jsx` |  |
| frontend-component | `app/src/components/Skeleton.module.css` |  |
| frontend-component | `app/src/components/TemplateEditor.jsx` |  |
| frontend-component | `app/src/components/TextAreaField.jsx` |  |
| frontend-component | `app/src/components/Toast.jsx` |  |
| frontend-context | `app/src/context/AuthContext.jsx` | import_time_throw |
| frontend-lib | `app/src/lib/exerciseBootstrap.js` |  |
| frontend-lib | `app/src/lib/fitbitAuth.js` | import_time_throw, window_global |
| frontend-lib | `app/src/lib/goalsDb.js` | import_time_throw |
| frontend-lib | `app/src/lib/nutritionDb.js` | import_time_throw |
| frontend-lib | `app/src/lib/ouraAuth.js` | import_time_throw, window_global |
| frontend-lib | `app/src/lib/readiness.js` |  |
| frontend-lib | `app/src/lib/supabase.js` |  |
| frontend-lib | `app/src/lib/supabaseDb.js` | import_time_throw, window_global |
| frontend-lib | `app/src/lib/syncOutbox.js` |  |
| frontend-lib | `app/src/lib/wearables.js` | fetch_api, import_time_throw |
| frontend-page | `app/src/pages/Account.jsx` |  |
| frontend-page | `app/src/pages/ActiveWorkout.jsx` | window_global |
| frontend-page | `app/src/pages/ActiveWorkout.module.css` |  |
| frontend-page | `app/src/pages/Analytics.jsx` | window_global |
| frontend-page | `app/src/pages/Auth.jsx` | window_global |
| frontend-page | `app/src/pages/Calendar.jsx` | window_global |
| frontend-page | `app/src/pages/DataExplorer.jsx` |  |
| frontend-page | `app/src/pages/Fitness.jsx` | window_global |
| frontend-page | `app/src/pages/GhostMode.jsx` |  |
| frontend-page | `app/src/pages/Goals.jsx` |  |
| frontend-page | `app/src/pages/Health.jsx` | window_global |
| frontend-page | `app/src/pages/Home.jsx` | window_global |
| frontend-page | `app/src/pages/Home.module.css` |  |
| frontend-page | `app/src/pages/Invite.jsx` |  |
| frontend-page | `app/src/pages/Log.jsx` | window_global |
| frontend-page | `app/src/pages/Log.module.css` |  |
| frontend-page | `app/src/pages/Login.jsx` |  |
| frontend-page | `app/src/pages/Login.module.css` |  |
| frontend-page | `app/src/pages/Nutrition.jsx` | import_time_throw, window_global |
| frontend-page | `app/src/pages/Planner.jsx` |  |
| frontend-page | `app/src/pages/Privacy.jsx` |  |
| frontend-page | `app/src/pages/Profile.jsx` |  |
| frontend-page | `app/src/pages/Profile.module.css` |  |
| frontend-page | `app/src/pages/Progress.jsx` |  |
| frontend-page | `app/src/pages/Progress.module.css` |  |
| frontend-page | `app/src/pages/Terms.jsx` |  |
| frontend-page | `app/src/pages/Wearables.jsx` | window_global |
| frontend-page | `app/src/pages/Workout.jsx` | window_global |
| frontend-styles | `app/src/styles/global.css` |  |
| frontend-utils | `app/src/utils/haptics.js` |  |
| frontend-utils | `app/src/utils/shareAnalytics.js` | window_global |
| frontend-utils | `app/src/utils/shareUtils.js` | fetch_api, window_global |
| other | `.gitignore` |  |
| sql | `app/supabase_migrations_feed.sql` |  |
| sql | `app/supabase_migrations_social_fixes.sql` |  |
| sql | `app/supabase_migrations_user_preferences_visibility.sql` |  |
| sql | `app/supabase_migrations_workouts_session_type.sql` |  |
| sql | `app/supabase_run_all.psql.sql` |  |
| sql | `app/supabase_run_all.sql` |  |
| sql | `app/supabase_seed_exercise_library_reset_and_rebuild.sql` |  |
