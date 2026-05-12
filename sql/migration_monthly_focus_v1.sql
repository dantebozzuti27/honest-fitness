-- Monthly fitness + life focus (profile) — JSON state on user_preferences
-- Safe re-run: add column only if missing

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_preferences'
      AND column_name = 'monthly_focus_state'
  ) THEN
    ALTER TABLE public.user_preferences
      ADD COLUMN monthly_focus_state JSONB DEFAULT NULL;
  END IF;
END $$;
