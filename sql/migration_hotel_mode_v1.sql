-- Add Hotel Mode preference flag to user profile.
-- Default OFF so existing users preserve current behavior.

alter table if exists public.user_preferences
add column if not exists hotel_mode boolean not null default false;

comment on column public.user_preferences.hotel_mode is
'When true, workout generation is restricted to treadmill cardio plus bodyweight/dumbbell exercises (dumbbell loads capped at 50 lbs).';
