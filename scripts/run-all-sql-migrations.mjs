#!/usr/bin/env node
/**
 * Apply all sql/migration_*.sql files in README order against $DATABASE_URL.
 *
 * Supabase-origin migrations that reference auth.users / RLS have RDS-safe
 * companion files (*_rds*.sql) run immediately after the primary file when
 * the primary fails with an auth-related error.
 *
 * Usage:
 *   set -a && . ./.env.vercel-prod && set +a
 *   node scripts/run-all-sql-migrations.mjs
 */

import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const runner = resolve(here, 'run-sql-migration.mjs')

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required (source .env.vercel-prod first)')
  process.exit(2)
}

/** Primary migrations in dependency order. */
const MIGRATIONS = [
  'sql/migration_phase_start_date.sql',
  'sql/migration_apollo_phase.sql',
  'sql/migration_meal_logs.sql',
  'sql/migration_hotel_mode_v1.sql',
  'sql/migration_weekly_split_schedule_v1.sql',
  'sql/migration_taxonomy_mesocycle_v1.sql',
  'sql/migration_workout_exercises_missing_cols.sql',
  'sql/migration_body_assessments_and_rom.sql',
  'sql/migration_swap_learning_and_signals_v1.sql',
  'sql/migration_exercise_library_dedupe_v1.sql',
  'sql/migration_data_quality_v1.sql',
  'sql/migration_audit_integrity_v1.sql',
  ['sql/migration_ml_v2.sql', 'sql/migration_ml_v2_rds_columns.sql'],
  ['sql/migration_model_integration_v3.sql', 'sql/migration_model_integration_v3_rds.sql'],
  ['sql/migration_ontology_v4_data_capture.sql', 'sql/migration_ontology_v4_rds.sql'],
  'sql/migration_monthly_focus_v1.sql',
  'sql/migration_biceps_variety_v1.sql',
  'sql/migration_biceps_variety_enrich_v1.sql',
  'sql/migration_engine_input_snapshot_v1.sql',
  'sql/migration_plan_constraints_v1.sql',
  'sql/migration_rds_auth_compat_v1.sql',
  'sql/migration_weekly_plan_active_invariant_v1.sql',
  'sql/migration_weekly_plan_day_status_fix_v1.sql',
]

function runFile(relPath) {
  const abs = resolve(root, relPath)
  const r = spawnSync(process.execPath, [runner, abs], {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim()
  return { ok: r.status === 0, out, status: r.status ?? 1 }
}

function isAuthRelated(output) {
  const s = output.toLowerCase()
  return s.includes('auth') || s.includes('authenticated') || s.includes('schema "auth"')
}

let failed = 0
const results = []

for (const entry of MIGRATIONS) {
  const files = Array.isArray(entry) ? entry : [entry]
  let applied = false
  let lastOut = ''

  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    console.log(`\n========== ${f} ==========`)
    const { ok, out } = runFile(f)
    lastOut = out
    console.log(out)
    if (ok) {
      console.log(`OK: ${f}`)
      results.push({ file: f, status: 'ok' })
      applied = true
      break
    }
    if (i === 0 && files.length > 1 && isAuthRelated(out)) {
      console.log(`WARN: ${f} failed auth/RLS — trying RDS companion next`)
      continue
    }
    console.error(`FAIL: ${f}`)
    results.push({ file: f, status: 'fail', detail: out.slice(-300) })
    failed += 1
    break
  }

  if (!applied && files.length === 1) {
    // already counted
  } else if (!applied && files.length > 1) {
    failed += 1
    results.push({ file: files.join(' → '), status: 'fail', detail: lastOut.slice(-300) })
  }
}

console.log('\n========== SUMMARY ==========')
for (const r of results) {
  console.log(`${r.status.toUpperCase().padEnd(4)} ${r.file}`)
}
console.log(`\n${results.length - failed}/${results.length} succeeded; ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
