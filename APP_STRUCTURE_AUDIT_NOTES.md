# App structure + UX audit notes (working doc)

## Current IA (information architecture)
- **Primary nav** (`BottomNav`): Today (`/`), Log (QuickActions sheet), Progress (`/progress`), Profile (`/profile`)
- **Key flows**:
  - **Workout**: Home “Fitness” CTA → `/workout/active` (resume/template/picker)
  - **Meal log**: Home “Log meal” → `/nutrition` (modal-first)
  - **Metrics**: Home “Metrics” → `/health`

## Structure shortcomings (code/architecture)
- **Monolith pages**:
  - `app/src/pages/ActiveWorkout.jsx` is very large (logic + UI + storage + timers + modals).
  - `app/src/pages/Home.jsx` mixes orchestration, data fetch, feature flags, and layout.
  - These increase regression risk and make design changes brittle.
- **Redundant layers**:
  - Multiple “DB-ish” access layers exist (`db/`, `lib/db/`, feature DB helpers), which duplicates logic and causes inconsistency.
- **UI primitives not centralized**:
  - Multiple sheet/modal patterns and multiple card/pill patterns without a single layout primitive.
  - Global button/tap-target rules sometimes fight component-specific layout.
- **Mixed styling strategy**:
  - CSS modules + global defaults + “layout-critical fallback” inline styles → inconsistent UI guarantees across pages.

## Design shortcomings (iPhone-specific)
- **Too many controls competing in the same row** on tight widths (flex-wrap + min-width interactions).
- **Inconsistent hierarchy patterns** (some pages are “primary value + subline”, others dense/row-based).
- **Safe-area + bottom overlays handled per-page**, not by a shared layout primitive → overlap risks.

## Click-debt / redundancy themes
- Multiple entry points reach the same destination with slightly different state/query params.
- Similar actions are implemented in multiple places (Home CTAs, QuickActions, deep-link query params), often duplicating “default behavior” logic.

## Redundant navigation paths (concrete)

### `/workout/active` (ActiveWorkout) has many entry points
- **Home**: hero CTA, Train quick card, scheduled workout cards (multiple variants of `state`)
- **BottomNav**: long-press “Log” → last quick action → `/workout/active` (resume) or `/workout/active` with `{ sessionType, openPicker }`
- **QuickActionsModal**: Continue workout, Start workout (open picker), Start recovery (open picker)
- **Fitness**: start from templates, resume paused, random workout, AI workout, “repeat yesterday”, etc.
- **Health**: “Start recovery” CTA, training recommendation CTA, “Start workout” CTA
- **Planner**: sends `{ aiWorkout }`
- **Calendar**: scheduled workout CTA, sometimes with `{ templateId, scheduledDate }`, sometimes no state
- **Log page (`/log`)**: start workout/recovery buttons
- **CommandPalette**: multiple commands for workout/recovery/search (picker) + template/exercise deep link

**Issue**: each entry point manually constructs `location.state` slightly differently (resumePaused, openPicker, templateId, scheduledDate, aiWorkout, quickAddExerciseName, etc.). That creates inconsistent behavior and bugs (“dead buttons”, wrong default mode, broken flows after refactors).

### `/log` is redundant with the BottomNav “Log” affordance
- BottomNav “Log” opens **QuickActionsModal** (the “real” fast path)
- QuickActionsModal has “More logging” → `/log`
- `/log` page repeats the same “start workout / start recovery / log meal / log metrics” actions plus sync tools

**Issue**: two different “log hubs” exist (sheet + page). Users learn different mental models; engineering duplicates the same set of intents.

### Legacy/alias routes create multiple ways to reach the same page
- `/workout` → Fitness page (same as `/fitness`)
- `/account` → Profile page (same as `/profile`)
- `/ghost-mode` → Nutrition page (same as `/nutrition`)

**Issue**: extra routes increase cognitive surface area and make analytics + deep links harder to reason about.

## Recommendation: canonical “intent” API (single source of truth)
Instead of each button deciding navigation + state, define a small set of canonical intents (e.g.):
- `openMealLog({ mealType?, quick: true })`
- `startWorkout({ mode: 'resume'|'picker'|'template'|'ai'|'random', sessionType: 'workout'|'recovery', templateId?, scheduledDate?, aiWorkout?, quickAddExerciseName? })`
- `openHealthLog()`
- `openCalendar()`
- `openLogHub()` (or remove `/log` and keep sheet-only)

Then every surface calls the same helper, so behavior stays consistent and click-debt drops naturally.

## Proposed direction (high leverage)
- Create shared layout primitives:
  - **`ui/Sheet`** (single bottom-sheet component used everywhere)
  - **`ui/SafeAreaScroll` / `ui/TopBar`** (consistent safe-area + header + bottom inset rules)
- Consolidate navigation semantics:
  - One canonical way to open common “modes” (e.g., `/workout/active` with explicit `state` contract).
  - Reduce duplicate CTAs to call shared helpers.


