## CANONICAL SQL FILES (SUPABASE)

### What to run
- **Migrations (core schema + policies)**: `app/supabase_run_all.sql`
- **Seed foods**: `app/supabase_seed_food_library_expanded.sql`
- **Seed exercises**: `app/supabase_seed_exercise_library_reset_and_rebuild.sql`

### How to run in Supabase
In Supabase Dashboard → **SQL Editor**:
- Paste and run **`supabase_run_all.sql`** (idempotent; safe to re-run)
- Then (optional) paste and run the seed files

### Marketplace tables (Coach Programs)
These are included inside `supabase_run_all.sql`:
- `coach_profiles`
- `coach_programs`
- `coach_program_purchases`

Tip: search inside `supabase_run_all.sql` for **“MIGRATION: Coach Marketplace”**.
