-- One-shot maintenance: supersede every currently-active weekly_plan_versions row.
--
-- Why:
--   The monthly-focus engine guarantee (commit 8b75633) only takes effect
--   when the cached weekly plan is regenerated. The TodayWorkout/WeekAhead
--   loader prefers an existing active plan unless `isWeeklyPlanStale`
--   returns true, and that heuristic doesn't (and shouldn't) know about
--   `monthly_focus_state`. Profile now invalidates on save going forward,
--   but plans that were generated *before* the fix landed remain active
--   and stale.
--
-- Effect:
--   Every active row → status='superseded'. Next visit to TodayWorkout /
--   WeekAhead regenerates the plan via `generateWeeklyPlan`, which now
--   honors the monthly fitness focus.
--
-- Safety:
--   - Idempotent: re-running supersedes any new active rows; rows already
--     superseded are unaffected.
--   - Non-destructive: rows are kept, just marked superseded. Day-level
--     plan data lives in `weekly_plan_days` and is not touched.
--   - Worst case: every user sees a brief "generating..." state on their
--     next TodayWorkout load; no data is lost.
UPDATE public.weekly_plan_versions
SET status = 'superseded'
WHERE status = 'active';
