# RUNNING AUDIT — ALL APP PAGES (`app/src/pages/*`)

This is a **living audit log**. I will update it incrementally while reviewing each page for:
- clarity of purpose
- safeguards / confirmations / undo
- UI label ↔ behavior consistency
- friction / flow quality
- data accuracy + sourcing (user vs wearable vs calculated)
- error handling (specific, actionable, timely)
- trust + privacy implications
- empty/first-time/partial states
- power-user scalability
- accessibility (keyboard, SR, focus, contrast, tap targets)
- performance (fetch, rendering, re-renders, subscriptions)
- timezones / daily boundaries
- offline/intermittent connectivity behavior

## Route map (from `app/src/App.jsx`)
- `/` → `Home.jsx`
- `/auth` → `Auth.jsx`
- `/privacy` → `Privacy.jsx`
- `/terms` → `Terms.jsx`
- `/fitness` and `/workout` → `Fitness.jsx`
- `/workout/active` → `ActiveWorkout.jsx`
- `/nutrition` and `/ghost-mode` → `Nutrition.jsx`
- `/health` → `Health.jsx`
- `/calendar` → `Calendar.jsx`
- `/analytics` → `Analytics.jsx`
- `/progress` → `Progress.jsx`
- `/planner` → `Planner.jsx`
- `/log` → `Log.jsx`
- `/goals` → `Goals.jsx`
- `/profile` and `/account` → `Profile.jsx`
- `/wearables` → `Wearables.jsx`
- `/invite/:identifier` → `Invite.jsx`
- `/data-catalog` → `DataCatalog.jsx`
- `/market` → `Marketplace.jsx`
- `/market/:programId` → `ProgramDetail.jsx`
- `/coach-studio` → `CoachStudio.jsx`
- `/library` → `Library.jsx`

## Cross-cutting issues (rolling)

### P0 (must-fix)
- **Timezone / “day boundary” inconsistencies**: Some pages use `getTodayEST()` while others use `new Date().toISOString().split('T')[0]` or `toISOString().slice(0,10)`. This can cause “wrong day” scheduling / labeling for users outside UTC.
- **Modal accessibility**: Many modals/overlays close on click/mousedown but do not show evidence of focus trap + ESC close consistency.
- **Date boundary mismatch in Calendar**: `Calendar.jsx` uses `getTodayEST()` for “today” but `isFutureDate()` uses UTC date string (`new Date().toISOString().split('T')[0]`).

### P1 (should-fix)
- **Silent failure patterns**: common `.catch(() => {})` hides backend/schema issues; needs a consistent “non-blocking but visible” strategy.
- **LocalStorage vs server drift**: some pages still rely on local-only state (e.g. `Library.jsx` enrollment display) even when server-side truth exists.

### P2 (nice-to-have)
- **Power-user scaling**: several pages render large lists without virtualization; will degrade with lots of history.

---

## Per-page audit notes (rolling)

### `Home.jsx` (`/`)
- **Purpose clarity**: home/feed + quick actions; readable.
- **Safeguards**: delete feed post uses confirm (good).
- **Data + sources**:
  - feed items (social), scheduled workouts, streak, Fitbit steps/readiness.
  - uses `getTodayEST()` for schedule and some feed dating; but also constructs dates with `toISOString()` (risk).
- **Error handling**:
  - uses one-time-toasts via `shownErrorsRef` (good), but some silent catches exist for optional loads.
- **Accessibility**:
  - custom pull-to-refresh: needs keyboard alternative; confirm dialog likely ok.
- **Key issues**:
  - potential date normalization inconsistencies (`toISOString().split('T')[0]` used for itemDate).

### `Calendar.jsx` (`/calendar`)
- **Purpose clarity**: month grid + scheduled workouts + history detail modal.
- **Safeguards**:
  - deleting a workout uses confirm (good).
  - deleting a scheduled row by id has **no confirm** (might be okay but risky).
  - “Remove all for this date” is destructive and has **no confirm**.
- **Data + sources**:
  - scheduled workouts + workout history; dot indicator for scheduled.
  - uses `getTodayEST()` for “today”, but `isFutureDate()` uses `new Date().toISOString()` → mismatch risk.
- **Accessibility**:
  - modal is a click-overlay; no focus trap indicated.
- **Key issues**:
  - future-date logic should use same daily boundary as rest of app.

### `ActiveWorkout.jsx` (`/workout/active`)
- **Purpose clarity**: primary workout logging surface (templates, random, AI); includes rest timer + pause/resume.
- **Safeguards / undo**
  - beforeunload warning if there’s progress (good).
  - **Clear workout** has destructive confirm and deletes persisted session (good).
  - **Cancel** warns only if there’s logged progress; then **hard deletes** persisted session + local backups (good alignment with your “cancel should delete” requirement).
  - Resume flows:
    - if a paused workout exists (DB or local fallback), user is prompted to resume or discard (good).
    - if an older in-progress session exists, user is prompted resume vs start fresh (good).
- **Data integrity / sources**
  - Explicitly documents that workout logs are only created on **Finish**.
  - Uses a separate “active workout session” persistence for recovery/restore; deletes it on finish/cancel.
  - Wearable-derived calories/steps try to subtract metrics accumulated during paused periods (nice correctness detail).
- **Offline / intermittent**
  - Auto-saves periodically and on background; falls back to `localStorage` if DB save fails.
  - Paused workouts save to Supabase with localStorage fallback.
- **Accessibility**
  - Uses custom confirm modal pattern; likely fine, but modal focus trapping is not shown.
- **Key issues**
  - **Cardio time UX/data shape**: cardio sets store `time` as a string, but there’s no obvious minutes+seconds input structure; also `addSet()` introduces `{ duration: 0 }` (a different field) while the rest of the app uses `time`. This inconsistency risks “time logs don’t render / don’t save as expected.”

### `Fitness.jsx` (`/fitness`, `/workout`)
- **Purpose clarity**: 5-tab hub (Workout/Templates/History/Scheduled/Goals).
- **Safeguards**:
  - paused workout dismiss flows exist; deletion is attempted with warnings.
  - workout start modal is click-overlay; no focus trap indicated.
- **Data + sources**:
  - workout history, scheduled workouts, goals, metrics, paused workout, AI.
  - realtime subscription to `workouts` table: good for freshness but watch for perf.
- **Key issues**:
  - scheduled workout “today” uses `getTodayEST()` (good).

### `Nutrition.jsx` (`/nutrition`, `/ghost-mode`)
- **Purpose clarity**: tabs; “Search food” flow is strong.
- **Safeguards**:
  - modal supports ESC handling in search field (good).
- **Data + sources**:
  - goals drive targets; food library local; micros computed; AI insights.
- **Key issues**:
  - has `COMMON_FOODS` hardcoded list (may conflict with “local-only” expectation unless clearly positioned as quick-add only).

### `Health.jsx` (`/health`)
- **Purpose clarity**: today/history/log/goals with wearable sync.
- **Key issues**:
  - double `logError('Error loading health goals', error)` appears duplicated.
  - recoveryStreak uses `dt.toISOString().split('T')[0]` which is timezone-risk for date iteration.

### `Analytics.jsx` (`/analytics`)
- **Purpose clarity**: very broad; may overwhelm first-time users.
- **Key issues**:
  - heavy optional analytics; many silent catches (acceptable but should show “unavailable” state per card).
  - uses `toISOString().split('T')[0]` for startDate calculations (timezone boundary risk).

### `Goals.jsx` (`/goals`)
- **Safeguards**: goal create uses confirm (good).
- **Key issues**:
  - date math uses `toISOString().split('T')[0]` for sevenDaysAgo (timezone boundary risk).

### `Planner.jsx` (`/planner`)
- **Key issues**:
  - errors in initial load are silently swallowed; can mask real issues.

### `Profile.jsx` (`/profile`, `/account`)
- **Safeguards**: has multiple confirms; good validation for username/phone.
- **Key issues**:
  - stores profile picture as base64 inside profile/prefs → may bloat DB and leak large PII blobs; consider storage bucket.

### `Marketplace.jsx` (`/market`)
- **Key issues**:
  - coach names load is silent failure (ok), but “Coach” placeholder might reduce trust.

### `ProgramDetail.jsx` (`/market/:programId`)
- **Key issues**:
  - schedules by weekday uses `toISOString().slice(0,10)` which can schedule wrong day in non-UTC locales.

### `CoachStudio.jsx` (`/coach-studio`)
- **Key issues**:
  - “Enrollments” modal shows raw UUIDs; privacy + usability issues.

### `Library.jsx` (`/library`)
- **Key issues**:
  - still reads enrollment state from **localStorage**; now that enrollments are persisted, should switch to server-backed state for consistency across devices.

### Remaining pages not yet fully audited
- `ActiveWorkout.jsx`

---

## Consolidated prioritized issues (across all pages)

### P0 (stability / correctness / trust)
- **Unify day-boundary + date formatting**:
  - Remove `toISOString().split('T')[0]` / `toISOString().slice(0,10)` usage for user-facing “day” decisions and scheduling.
  - Use one helper consistently (currently `getTodayEST()` exists; consider adding a single `toDateKeyEST(date)` or `toDateKeyLocal(date)` helper for all pages).
- **Program scheduling timezone risk**:
  - `ProgramDetail.jsx` schedules using `toISOString().slice(0,10)` after local date arithmetic; can schedule the wrong date for some timezones.
- **Calendar future-date logic mismatch**:
  - `Calendar.jsx` uses EST “today” for display but UTC for `isFutureDate()`, which can flip button visibility near midnight.
- **Modal accessibility baseline**:
  - Add consistent ESC-to-close + focus trap for all modal overlays (CoachStudio, ProgramDetail, Fitness, Calendar, etc.).

### P1 (product quality)
- **Cardio logging consistency**:
  - `ActiveWorkout.jsx` stores cardio “time” as a string, but `addSet()` adds `{ duration: 0 }` which is a different shape.
  - Introduce a single canonical representation (e.g. minutes+seconds fields or totalSeconds) and normalize across save/render/export.
- **Enrollment UX + privacy**:
  - Coach Studio enrollments show raw UUIDs; should show display names and put UUID behind copy affordance; add “coach visibility” disclosure.
- **Library enrollment state drift**:
  - `Library.jsx` still uses localStorage for enrollment status; should prefer server-backed `coach_program_enrollments` to be cross-device correct.
- **Clickable divs without keyboard support**:
  - `DataCatalog.jsx` uses clickable `<div>` items → convert to `<button>` or add role/tabIndex/keypress handlers.

### P2 (maintainability / polish)
- **Reduce silent failures**:
  - Replace `.catch(() => {})` with a consistent “non-blocking but observable” pattern: log + one-time toast per category + “data unavailable” UI.
- **Remove unused imports + redundant pages**:
  - `Privacy.jsx` / `Terms.jsx` import `useNavigate` but don’t use it.
  - `Progress.jsx` may be redundant depending on BottomNav/IA.
- **Large-list performance**:
  - Consider virtualization for heavy history pages (Fitness History, Analytics lists).

## Concrete action plan

### Quick wins (today)
- Fix `Calendar.jsx` future-date logic to use the same date key system as “today”.
- Fix `ProgramDetail.jsx` date key generation to be timezone-safe.
- Add “Are you sure?” confirms to bulk-destructive actions (e.g. Calendar “Remove all for this date”).
- Convert `DataCatalog.jsx` clickable `<div>` rows to `<button>` for keyboard accessibility.

### Medium-term (1–3 days)
- Implement a shared `dateKey` utility and replace all ad-hoc date-string generation.
- Add a shared modal primitive with focus trap + ESC close + restore focus on close.
- Normalize cardio duration fields across UI + DB + export.
- Improve coach enrollment visibility: name-based display, drill-in, privacy disclosure.

### Long-term (1–2 weeks)
- Create a “data availability” framework: per-domain “freshness” + schema-missing notices + retry affordances.
- Add scalability improvements (virtualized lists, pagination for feed/history).

### `Invite.jsx` (`/invite/:identifier`)
- **Purpose clarity**: clear “Add Friend” flow.
- **Safeguards**:
  - prevents adding yourself (good).
  - send request has no confirm (acceptable), but should disable if already pending.
- **Error handling**: inline error states are clear; uses skeleton for loading.
- **Privacy**: displays profile picture + bio; relies on backend/RLS correctness.

### `Privacy.jsx` (`/privacy`) and `Terms.jsx` (`/terms`)
- **Purpose clarity**: static policy pages are clear.
- **Key issue**: both import `useNavigate()` but don’t use it (minor code hygiene).

### `Progress.jsx` (`/progress`)
- **Purpose**: simple hub to Analytics/Calendar/Planner.
- **Key issue**: very thin page; may feel redundant vs bottom nav (consider consolidation).

### `DataCatalog.jsx` (`/data-catalog`)
- **Purpose**: data dictionary/metric definitions; strong for transparency.
- **Accessibility**:
  - uses clickable `<div>` for search results + cards (needs `button` or keyboard handlers + role).
- **Key issue**:
  - imports `useAuth` and `useNavigate` but doesn’t use `user` (minor hygiene).

### `Wearables.jsx` (`/wearables`)
- **Purpose**: connect + sync + status; good explicit guidance.
- **Key issue (bug)**:
  - `handleConnectOura` references `ouraClientId` **before it is defined** (it’s declared later in the component). This will throw at runtime if that code path is hit.
- **UX**:
  - lots of inline warnings; good, but style uses hardcoded colors in JSX (design consistency).
- **Status**: fixed by moving `fitbitClientId` / `ouraClientId` declarations above handlers in `app/src/pages/Wearables.jsx`.

### `Auth.jsx` (`/auth`)
- **Trust**: explicit consent checkboxes + strong validation + clear config error screen (good).
- **Key issue**:
  - “GDPR Compliant / 256-bit encryption” are claims—ensure they’re actually true or soften language.

### `Log.jsx` (`/log`)
- **Purpose**: quick logging hub + outbox sync; clear.
- **Offline**: good visibility for “pending sync” and manual flush.


---

## Gym-goer / Bodybuilder lens (design + functionality)

North star: for a lifter, the app should feel like **a high-speed training log + progression engine**:
- ultra-fast set entry (minimal taps, smart defaults, keyboard-first)
- templates that match real training (RPE, warmups, top sets + backoffs, supersets, rest, notes)
- progression surfaced everywhere (PRs, volume, estimated 1RM, weekly sets per muscle)
- “what to do today” clarity (plan, readiness, last time performance)
- trustworthy data boundaries (today/date/timezone) and zero data loss

### Global UX upgrades (apply across most pages)
- **One-handed “primary action”**: every page should have one obvious primary CTA (Start / Log / Search / Sync / Save).
- **Power user input**:
  - numeric keypad by default for weight/reps
  - “tap-to-copy last set”, “+2.5 lb / +5 lb” chips, “same as last time”
  - long-press to edit, swipe to delete/reorder (mobile-first)
- **Progression layer**:
  - per-exercise “last time” and “best” shown inline
  - per-muscle weekly sets + intensity distribution
- **Design consistency**:
  - consistent modal behavior (ESC, focus trap), consistent segmented tabs, consistent empty states.

### `Home.jsx` (`/`)
- **What lifters want here**: “What am I training today?”, “What did I do last time?”, “Start workout” in 1 tap.
- **Current strengths**: scheduled workout surfacing + streak + feed.
- **Gaps**:
  - feed/social competes with “today’s workout” as the hero.
  - no “today’s focus” preview (muscles, exercises) and no “last time performance”.
- **Upgrade**:
  - make a **Today card** the first element: scheduled template name + last performance + predicted loads.
  - add a **Quick PRs** strip (last 7 days).

### `Fitness.jsx` (`/fitness`, `/workout`)
- **What lifters want**: templates, history search, PRs, muscle balance, and “start today’s session”.
- **Current strengths**: templates + history + scheduled + pause banner.
- **Gaps**:
  - no fast history search by exercise; no “PRs” tab.
  - “Workout start” modal is okay, but could be faster (one button for today).
- **Upgrade**:
  - add **History search** (exercise name → last sessions with that exercise).
  - add **PRs/Progression** surface (estimated 1RM, best volume, rep PRs).

### `ActiveWorkout.jsx` (`/workout/active`)
- **What lifters want**: fastest possible set logging + rest timer + supersets + progression cues.
- **Current strengths**:
  - rest timer, pause/resume, autosave, stacked exercises, cancel deletes session (correct).
- **Big gaps**:
  - no “last time” inline (previous weight/reps per set).
  - cardio duration input is not “minutes + seconds” and the data shape is inconsistent (`time` vs `duration`).
- **Upgrade**:
  - for each exercise show: **Last session**, **Suggested weight**, **PR badge**.
  - add **micro-interactions**: copy last set, +2.5/+5 chips, RPE selector, set completion checkbox.

### `Calendar.jsx` (`/calendar`)
- **What lifters want**: simple schedule + review; not a second “history” UI.
- **Current strengths**: scheduled workouts + ability to launch today.
- **Gaps**:
  - scheduling UX is generic (templates list) and doesn’t show “why/what focus”.
  - deletion is a little too easy (no confirm for multi-delete).
- **Upgrade**:
  - show scheduled day details (template + muscles) and a “Start” always when today.
  - add confirm for “Remove all”.

### `Planner.jsx` (`/planner`)
- **What lifters want**: real program design (split, volume targets, progression rules), not just generic “AI plan”.
- **Current strengths**: simple onboarding plan builder.
- **Gaps**:
  - lacks lifter language: “Push/Pull/Legs”, “Upper/Lower”, “Top set + backoffs”.
  - no weekly sets per muscle targets, no progression model selection.
- **Upgrade**:
  - add “split picker” + muscle volume targets.
  - add progression model (linear, double progression, RPE-based).

### `Progress.jsx` (`/progress`)
- **What lifters want**: one place for PRs, muscle balance, trends.
- **Current state**: navigation hub.
- **Upgrade**:
  - either remove it, or make it **the lifter dashboard**: PRs + weekly sets + bodyweight trend + adherence.

### `Analytics.jsx` (`/analytics`)
- **What lifters want**: actionable training analytics (volume by muscle, PRs, adherence, fatigue).
- **Current strengths**: lots of power, data catalog style transparency.
- **Gaps**:
  - too broad; can overwhelm.
  - charts need “so what?” interpretation + recommended next action.
- **Upgrade**:
  - create a **Lifter Overview**: weekly sets by muscle, top lifts trend, recovery trend, adherence.

### `Nutrition.jsx` (`/nutrition`, `/ghost-mode`)
- **What lifters want**: quick macro compliance, meal logging that doesn’t suck, and “hit protein” guidance.
- **Current strengths**: search UX is strong; categories/favorites/recents; page insights.
- **Gaps**:
  - need better “meal templates” (pre-built meals, shakes) and bulk-add favorites.
  - show “remaining macros” prominently, with “protein-first suggestions”.
- **Upgrade**:
  - add **meal presets** and **one-tap repeat yesterday**.
  - add **macro remaining bar** + “high-protein foods” quick list.

### `Health.jsx` (`/health`)
- **What lifters want**: recovery clarity (sleep, steps, readiness) and whether to push/hold today.
- **Current strengths**: wearable sync + readiness.
- **Gaps**:
  - needs a clear “training recommendation” (green/yellow/red) with actionable adjustments.
- **Upgrade**:
  - show “Today: Push / Maintain / Deload” with specific guidance (reduce volume by X%).

### `Goals.jsx` (`/goals`)
- **What lifters want**: goals tied to behavior (weekly sets, protein, steps) and auto-updated progress.
- **Current strengths**: confirmation flows, multi-category.
- **Gaps**:
  - goal types are not lifter-specific enough (e.g. “weekly sets per muscle”, “protein/day”, “bodyweight trend”).
- **Upgrade**:
  - add goal templates for lifters: weekly workouts, protein, steps, bodyweight range, sleep.

### `Log.jsx` (`/log`)
- **What lifters want**: fastest entry point into logging.
- **Current strengths**: perfect “quick actions” pattern + offline outbox visibility.
- **Upgrade**:
  - add “Start scheduled workout” as the first card when available.

### `Profile.jsx` (`/profile`, `/account`)
- **What lifters want**: privacy controls, exports, wearable management.
- **Current strengths**: robust settings + export.
- **Gaps**:
  - profile picture storage as base64 isn’t scalable.
- **Upgrade**:
  - switch to storage bucket and show privacy disclaimers for social.

### `Wearables.jsx` (`/wearables`)
- **What lifters want**: connect once, then “is it working?” and “how fresh is data?”
- **Current strengths**: clear status + manual sync.
- **Gaps**:
  - should show “last sync age” more explicitly and per-metric freshness.
- **Upgrade**:
  - add a small “freshness” panel: sleep/steps/readiness last updated + warnings if stale.

### `Marketplace.jsx` (`/market`) + `ProgramDetail.jsx` (`/market/:programId`) + `Library.jsx` (`/library`) + `CoachStudio.jsx` (`/coach-studio`)
- **For lifters**:
  - marketplace programs must feel like real training programs: split preview, weekly volume, sample day.
  - enrollment should clearly state what gets scheduled and what’s just “info”.
- **Current strengths**: program building is powerful; enrollment exists.
- **Gaps**:
  - ProgramDetail scheduling date logic is timezone-risk (trust issue).
  - Library enrollment display is local-only (cross-device confusion).
  - Coach enrollments should show meaningful stats, not UUIDs.
- **Upgrade**:
  - add “Program preview”: weekly split, volume targets, sample workouts.
  - add “coach can see X” disclosure and a real progress dashboard per enrollee.

### `Auth.jsx` (`/auth`) + `Invite.jsx` (`/invite/:identifier`) + `Privacy.jsx` + `Terms.jsx` + `DataCatalog.jsx`
- **For lifters**: these should be clean, fast, and confidence-inspiring.
- **Upgrade**:
  - keep Auth high-trust, but ensure any compliance/security claims are accurate.
  - DataCatalog is a differentiator: keep it, but make it keyboard accessible.


