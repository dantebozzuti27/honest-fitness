-- Week plan constraints — persisted alongside weekly_plan_versions so stale
-- materialized days can rematerialize on read when engine version or prefs drift.

ALTER TABLE public.weekly_plan_versions
  ADD COLUMN IF NOT EXISTS plan_constraints JSONB;

COMMENT ON COLUMN public.weekly_plan_versions.plan_constraints IS
  'WeekPlanConstraintsV1 snapshot. See app/src/lib/weekPlanConstraints.ts.';

CREATE OR REPLACE FUNCTION public.save_weekly_plan_atomic(
  p_user_id UUID,
  p_week_start_date DATE,
  p_feature_snapshot_id TEXT,
  p_days JSONB,
  p_diffs JSONB DEFAULT '[]'::jsonb,
  p_engine_input_snapshot JSONB DEFAULT NULL,
  p_plan_constraints JSONB DEFAULT NULL
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
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'auth') THEN
    IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
      RAISE EXCEPTION 'Unauthorized weekly plan write';
    END IF;
  END IF;

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
    engine_input_snapshot,
    plan_constraints
  ) VALUES (
    p_user_id,
    p_week_start_date,
    'active',
    p_feature_snapshot_id,
    p_engine_input_snapshot,
    p_plan_constraints
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
