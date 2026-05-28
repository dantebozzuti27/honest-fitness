#!/usr/bin/env node
import { createRequire } from 'node:module'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(resolve(here, '../backend/package.json'))
const { Client } = require('pg')

const url = process.env.DATABASE_URL?.replace(/[?&]sslmode=[^&]*/g, '')
if (!url) {
  console.error('DATABASE_URL required')
  process.exit(1)
}

const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()

const cols = await client.query(`
  SELECT table_name, column_name
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND (
      (table_name = 'weekly_plan_versions' AND column_name IN ('plan_constraints', 'engine_input_snapshot'))
      OR (table_name = 'user_preferences' AND column_name IN ('phase_start_date', 'monthly_focus_state'))
      OR (table_name = 'workout_outcomes' AND column_name = 'idempotency_key')
      OR (table_name = 'workout_sets' AND column_name = 'is_unilateral')
    )
  ORDER BY table_name, column_name
`)
console.log('columns:', cols.rows)

const fns = await client.query(`
  SELECT p.oid::regprocedure AS sig
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.proname = 'save_weekly_plan_atomic' AND n.nspname = 'public'
`)
console.log('save_weekly_plan_atomic signatures:', fns.rows.map(r => r.sig))

for (const row of fns.rows) {
  const def = await client.query(
    `SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p WHERE p.oid = $1::regprocedure`,
    [row.sig],
  )
  const d = def.rows[0]?.def ?? ''
  console.log(`\n--- ${row.sig} ---`)
  console.log('has plan_constraints:', d.includes('plan_constraints'))
  console.log('has engine_input_snapshot:', d.includes('engine_input_snapshot'))
  console.log('has auth.uid:', d.includes('auth.uid'))
}

await client.end()
