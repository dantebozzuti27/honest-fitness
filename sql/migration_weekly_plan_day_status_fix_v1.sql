-- Allow skipped -> adapted (missed-day redistribution) in weekly plan day state machine.

CREATE OR REPLACE FUNCTION public.enforce_weekly_plan_day_state_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.day_status = 'completed' AND NEW.actual_workout_id IS NULL THEN
    RAISE EXCEPTION 'weekly_plan_days: completed state requires actual_workout_id';
  END IF;

  IF NEW.day_status IN ('planned', 'adapted') AND NEW.actual_workout_id IS NOT NULL THEN
    RAISE EXCEPTION 'weekly_plan_days: planned/adapted cannot have actual_workout_id';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.day_status = 'planned' AND NEW.day_status NOT IN ('planned', 'adapted', 'completed', 'skipped') THEN
      RAISE EXCEPTION 'weekly_plan_days: invalid transition planned -> %', NEW.day_status;
    ELSIF OLD.day_status = 'adapted' AND NEW.day_status NOT IN ('adapted', 'completed', 'skipped') THEN
      RAISE EXCEPTION 'weekly_plan_days: invalid transition adapted -> %', NEW.day_status;
    ELSIF OLD.day_status = 'skipped' AND NEW.day_status NOT IN ('skipped', 'planned', 'adapted') THEN
      RAISE EXCEPTION 'weekly_plan_days: invalid transition skipped -> %', NEW.day_status;
    ELSIF OLD.day_status = 'completed' AND NEW.day_status <> 'completed' THEN
      RAISE EXCEPTION 'weekly_plan_days: completed is terminal';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
