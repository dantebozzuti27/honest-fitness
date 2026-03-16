-- ============================================================================
-- AUDIT INTEGRITY MIGRATION v1
-- Purpose:
-- 1) Atomic weekly-plan writes via RPC
-- 2) Idempotency keys + uniqueness for outcome/execution telemetry
-- 3) Ontology integrity constraints (UUID lineage, day-state machine)
-- 4) Exercise identity normalization guardrails (FK-first direction)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Idempotency columns + unique indexes
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'workout_outcomes' AND column_name = 'idempotency_key'
  ) THEN
    ALTER TABLE public.workout_outcomes
      ADD COLUMN idempotency_key TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'prescription_execution_events' AND column_name = 'idempotency_key'
  ) THEN
    ALTER TABLE public.prescription_execution_events
      ADD COLUMN idempotency_key TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'prescription_execution_events' AND column_name = 'event_id'
  ) THEN
    ALTER TABLE public.prescription_execution_events
      ADD COLUMN event_id UUID DEFAULT gen_random_uuid();
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_workout_outcomes_user_idempotency
  ON public.workout_outcomes(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_prescription_exec_user_idempotency
  ON public.prescription_execution_events(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ----------------------------------------------------------------------------
-- B) UUID lineage hardening for workouts.generated_workout_id
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_type TEXT;
BEGIN
  SELECT data_type
    INTO v_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'workouts'
    AND column_name = 'generated_workout_id';

  IF v_type IS NULL THEN
    -- Column does not exist yet in this deployment.
    RETURN;
  END IF;

  -- If UUID type is already used, enforce FK directly.
  IF v_type = 'uuid' THEN
    ALTER TABLE public.workouts
      DROP CONSTRAINT IF EXISTS workouts_generated_workout_id_fkey;
    ALTER TABLE public.workouts
      ADD CONSTRAINT workouts_generated_workout_id_fkey
      FOREIGN KEY (generated_workout_id) REFERENCES public.generated_workouts(id)
      ON DELETE SET NULL;
  ELSE
    -- For text columns, at least enforce UUID format if value is present.
    ALTER TABLE public.workouts
      DROP CONSTRAINT IF EXISTS workouts_generated_workout_id_uuid_format_chk;
    ALTER TABLE public.workouts
      ADD CONSTRAINT workouts_generated_workout_id_uuid_format_chk
      CHECK (
        generated_workout_id IS NULL
        OR generated_workout_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_workouts_generated_workout_id
  ON public.workouts(generated_workout_id);

-- ----------------------------------------------------------------------------
-- C) Weekly day-state invariants + transition trigger
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_weekly_plan_day_state_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Invariant: completed must have actual workout.
  IF NEW.day_status = 'completed' AND NEW.actual_workout_id IS NULL THEN
    RAISE EXCEPTION 'weekly_plan_days: completed state requires actual_workout_id';
  END IF;

  -- Invariant: planned/adapted should not carry actual workout.
  IF NEW.day_status IN ('planned', 'adapted') AND NEW.actual_workout_id IS NOT NULL THEN
    RAISE EXCEPTION 'weekly_plan_days: planned/adapted cannot have actual_workout_id';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Allowed transitions:
    -- planned  -> planned|adapted|completed|skipped
    -- adapted  -> adapted|completed|skipped
    -- skipped  -> skipped|planned
    -- completed-> completed
    IF OLD.day_status = 'planned' AND NEW.day_status NOT IN ('planned', 'adapted', 'completed', 'skipped') THEN
      RAISE EXCEPTION 'weekly_plan_days: invalid transition planned -> %', NEW.day_status;
    ELSIF OLD.day_status = 'adapted' AND NEW.day_status NOT IN ('adapted', 'completed', 'skipped') THEN
      RAISE EXCEPTION 'weekly_plan_days: invalid transition adapted -> %', NEW.day_status;
    ELSIF OLD.day_status = 'skipped' AND NEW.day_status NOT IN ('skipped', 'planned') THEN
      RAISE EXCEPTION 'weekly_plan_days: invalid transition skipped -> %', NEW.day_status;
    ELSIF OLD.day_status = 'completed' AND NEW.day_status <> 'completed' THEN
      RAISE EXCEPTION 'weekly_plan_days: completed is terminal';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_weekly_plan_day_state_transition ON public.weekly_plan_days;
CREATE TRIGGER trg_weekly_plan_day_state_transition
BEFORE INSERT OR UPDATE ON public.weekly_plan_days
FOR EACH ROW
EXECUTE FUNCTION public.enforce_weekly_plan_day_state_transition();

-- ----------------------------------------------------------------------------
-- D) Exercise identity guardrail (FK-first direction)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  -- At least one identity source must be present.
  ALTER TABLE public.workout_exercises
    DROP CONSTRAINT IF EXISTS workout_exercises_identity_source_chk;
  ALTER TABLE public.workout_exercises
    ADD CONSTRAINT workout_exercises_identity_source_chk
    CHECK (exercise_library_id IS NOT NULL OR exercise_name IS NOT NULL);
END $$;

CREATE INDEX IF NOT EXISTS idx_workout_exercises_library_id
  ON public.workout_exercises(exercise_library_id);

-- ----------------------------------------------------------------------------
-- E) Atomic weekly-plan upsert RPC
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_weekly_plan_atomic(
  p_user_id UUID,
  p_week_start_date DATE,
  p_feature_snapshot_id TEXT,
  p_days JSONB,
  p_diffs JSONB DEFAULT '[]'::jsonb
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
    feature_snapshot_id
  ) VALUES (
    p_user_id,
    p_week_start_date,
    'active',
    p_feature_snapshot_id
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
      COALESCE(x->'diff_summary', '{}'::jsonb)
    );
  END LOOP;

  IF v_prev_active_id IS NOT NULL THEN
    UPDATE public.weekly_plan_versions
      SET status = 'superseded'
    WHERE id = v_prev_active_id
      AND user_id = p_user_id
      AND status = 'active';
  END IF;

  RETURN v_new_plan_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_weekly_plan_atomic(UUID, DATE, TEXT, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_weekly_plan_atomic(UUID, DATE, TEXT, JSONB, JSONB) TO authenticated;

