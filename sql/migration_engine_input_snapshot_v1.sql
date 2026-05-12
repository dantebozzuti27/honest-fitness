-- ─────────────────────────────────────────────────────────────────────────
-- Engine input snapshot — Phase A of audit item #3.
--
-- Adds an `engine_input_snapshot JSONB` column to weekly_plan_versions so
-- the inputs that produced each plan are persisted alongside the outputs.
-- This is the artefact that lets us answer "what did the engine see?"
-- without re-running the engine (which we can't, because the user's
-- recovery/volume state has moved on by the time anyone investigates).
--
-- Schema is documented in app/src/lib/engineInputSnapshot.ts. The column
-- is JSONB with no shape constraint at the DB layer — schema versioning
-- is enforced in application code via the `version` field, which is
-- currently 1.
--
-- Idempotent: safe to run repeatedly. The JSONB default of NULL means
-- pre-existing rows have no snapshot (nothing to backfill — historical
-- plan inputs are unrecoverable).
--
-- Migration runner: scripts/run-sql-migration.mjs
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.weekly_plan_versions
  ADD COLUMN IF NOT EXISTS engine_input_snapshot JSONB;

COMMENT ON COLUMN public.weekly_plan_versions.engine_input_snapshot IS
  'Phase A engine input snapshot (audit #3). See app/src/lib/engineInputSnapshot.ts for schema. version=1.';

-- Update the atomic save RPC to accept and persist the snapshot. We keep
-- backward compatibility by defaulting the new parameter to NULL — older
-- callers (and the legacy fallback path in supabaseDb.ts) keep working.
CREATE OR REPLACE FUNCTION public.save_weekly_plan_atomic(
  p_user_id UUID,
  p_week_start_date DATE,
  p_feature_snapshot_id TEXT,
  p_days JSONB,
  p_diffs JSONB DEFAULT '[]'::jsonb,
  p_engine_input_snapshot JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev_active_id UUID;
  v_new_plan_id UUID;
  d JSONB;
  x JSONB;
BEGIN
  -- Enforce caller-user lineage.
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Unauthorized weekly plan write';
  END IF;

  -- Lock previous active row to avoid dual-active races.
  SELECT id
    INTO v_prev_active_id
  FROM public.weekly_plan_versions
  WHERE user_id = p_user_id
    AND week_start_date = p_week_start_date
    AND status = 'active'
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  INSERT INTO public.weekly_plan_versions (
    user_id,
    week_start_date,
    status,
    feature_snapshot_id,
    engine_input_snapshot
  ) VALUES (
    p_user_id,
    p_week_start_date,
    'active',
    p_feature_snapshot_id,
    p_engine_input_snapshot
  )
  RETURNING id INTO v_new_plan_id;

  FOR d IN SELECT * FROM jsonb_array_elements(COALESCE(p_days, '[]'::jsonb))
  LOOP
    INSERT INTO public.weekly_plan_days (
      weekly_plan_id,
      user_id,
      plan_date,
      day_of_week,
      is_rest_day,
      focus,
      muscle_groups,
      planned_workout,
      estimated_minutes,
      confidence,
      llm_verdict,
      llm_corrections,
      day_status,
      actual_workout_id,
      actual_workout,
      last_reconciled_at
    ) VALUES (
      v_new_plan_id,
      p_user_id,
      (d->>'plan_date')::date,
      COALESCE((d->>'day_of_week')::integer, 0),
      COALESCE((d->>'is_rest_day')::boolean, false),
      NULLIF(d->>'focus', ''),
      COALESCE(d->'muscle_groups', '[]'::jsonb),
      d->'planned_workout',
      NULLIF(d->>'estimated_minutes', '')::integer,
      COALESCE(NULLIF(d->>'confidence', '')::numeric, 0.5),
      NULLIF(d->>'llm_verdict', ''),
      d->'llm_corrections',
      COALESCE(NULLIF(d->>'day_status', ''), 'planned'),
      NULLIF(d->>'actual_workout_id', '')::uuid,
      d->'actual_workout',
      NULLIF(d->>'last_reconciled_at', '')::timestamptz
    );
  END LOOP;

  FOR x IN SELECT * FROM jsonb_array_elements(COALESCE(p_diffs, '[]'::jsonb))
  LOOP
    INSERT INTO public.weekly_plan_diffs (
      weekly_plan_id,
      user_id,
      plan_date,
      reason_codes,
      before_workout,
      after_workout,
      diff_summary
    ) VALUES (
      v_new_plan_id,
      p_user_id,
      (x->>'plan_date')::date,
      COALESCE(x->'reason_codes', '[]'::jsonb),
      x->'before_workout',
      x->'after_workout',
      x->'diff_summary'
    );
  END LOOP;

  IF v_prev_active_id IS NOT NULL THEN
    UPDATE public.weekly_plan_versions
    SET status = 'superseded'
    WHERE id = v_prev_active_id
      AND user_id = p_user_id;
  END IF;

  RETURN v_new_plan_id;
END;
$$;
