#!/usr/bin/env node
/**
 * Data migration: Supabase → RDS
 *
 * 1. Drops all FK constraints
 * 2. Reads every table from Supabase PostgREST, adds missing columns, inserts
 * 3. Re-creates FK constraints
 *
 * Usage:
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 \
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... DATABASE_URL=... \
 *   node scripts/migrate-data.js
 */

import pg from 'pg'
const { Pool } = pg

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const DATABASE_URL = process.env.DATABASE_URL

if (!SUPABASE_URL || !SERVICE_KEY || !DATABASE_URL) {
  console.error('Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL')
  process.exit(1)
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
})

const TABLES = [
  'exercise_library',
  'user_preferences',
  'user_profiles',
  'workouts',
  'workout_exercises',
  'workout_sets',
  'workout_outcomes',
  'workout_templates',
  'workout_template_exercises',
  'health_metrics',
  'fitbit_daily',
  'connected_accounts',
  'exercise_enrichments',
  'exercise_swap_log',
  'training_signals',
  'weekly_plan_versions',
  'weekly_plan_days',
  'weekly_plan_diffs',
  'feature_snapshots',
  'model_feedback',
  'model_config',
  'decision_provenance_events',
  'intervention_episodes',
  'intervention_episode_outcomes',
  'replay_scenarios',
  'replay_results',
  'coach_programs',
  'coach_program_enrollments',
  'workout_sharing',
  'friendships',
  'llm_validation_artifacts',
  'achievement_definitions',
  'achievement_progress',
  'user_streaks',
  'paused_workouts',
]

async function fetchFromSupabase(table, offset = 0, limit = 1000) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=*&offset=${offset}&limit=${limit}`
  const res = await fetch(url, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Prefer: 'count=exact',
    },
  })
  if (!res.ok) {
    const text = await res.text()
    if (res.status === 404) return { data: [], totalCount: 0, notFound: true }
    throw new Error(`Supabase fetch ${table} failed: ${res.status} ${text}`)
  }
  const totalCount = parseInt(res.headers.get('content-range')?.split('/')[1] || '0', 10)
  const data = await res.json()
  return { data, totalCount, notFound: false }
}

async function fetchAll(table) {
  const rows = []
  let offset = 0
  const batchSize = 1000
  const first = await fetchFromSupabase(table, 0, batchSize)
  if (first.notFound) return { rows: [], notFound: true }
  rows.push(...first.data)
  offset += first.data.length
  while (first.data.length === batchSize && offset < first.totalCount) {
    const next = await fetchFromSupabase(table, offset, batchSize)
    rows.push(...next.data)
    offset += next.data.length
    if (next.data.length < batchSize) break
  }
  return { rows, notFound: false }
}

async function getRdsColumns(table) {
  const result = await pool.query(
    `SELECT column_name, data_type, udt_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  )
  const map = {}
  for (const r of result.rows) {
    map[r.column_name] = { data_type: r.data_type, udt_name: r.udt_name }
  }
  return map
}

function inferPgType(value) {
  if (value === null || value === undefined) return 'TEXT'
  if (typeof value === 'boolean') return 'BOOLEAN'
  if (typeof value === 'number') return Number.isInteger(value) ? 'INTEGER' : 'DOUBLE PRECISION'
  if (typeof value === 'object') return 'JSONB'
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return 'TIMESTAMPTZ'
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'DATE'
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return 'UUID'
  }
  return 'TEXT'
}

async function addMissingColumns(table, rows, existingCols) {
  if (rows.length === 0) return existingCols
  const sourceCols = Object.keys(rows[0])
  const missing = sourceCols.filter((c) => !existingCols[c])
  if (missing.length === 0) return existingCols
  for (const col of missing) {
    const sampleValue = rows.find((r) => r[col] != null)?.[col]
    const pgType = inferPgType(sampleValue)
    try {
      await pool.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${col}" ${pgType}`)
      existingCols[col] = { data_type: pgType.toLowerCase(), udt_name: pgType.toLowerCase() }
      console.log(`    + column ${col} (${pgType})`)
    } catch (err) {
      console.error(`    Failed to add ${col}: ${err.message}`)
    }
  }
  return existingCols
}

function convertValue(val, colMeta) {
  if (val === null || val === undefined) return null

  const isArrayCol = colMeta && colMeta.data_type === 'ARRAY'

  if (isArrayCol && Array.isArray(val)) {
    return `{${val.map((v) => `"${String(v).replace(/"/g, '\\"')}"`).join(',')}}`
  }

  if (typeof val === 'object') {
    return JSON.stringify(val)
  }

  return val
}

async function dropForeignKeys() {
  const result = await pool.query(`
    SELECT conname, conrelid::regclass::text AS table_name,
           pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE contype = 'f' AND connamespace = 'public'::regnamespace
  `)
  const fks = result.rows
  console.log(`  Found ${fks.length} FK constraints to drop`)
  for (const fk of fks) {
    try {
      await pool.query(`ALTER TABLE ${fk.table_name} DROP CONSTRAINT IF EXISTS "${fk.conname}"`)
    } catch {}
  }
  return fks
}

async function restoreForeignKeys(fks) {
  let restored = 0
  for (const fk of fks) {
    try {
      await pool.query(`ALTER TABLE ${fk.table_name} ADD CONSTRAINT "${fk.conname}" ${fk.def}`)
      restored++
    } catch (err) {
      console.error(`  Failed to restore FK ${fk.conname}: ${err.message.substring(0, 100)}`)
    }
  }
  console.log(`  Restored ${restored}/${fks.length} FK constraints`)
}

async function insertRows(table, rows, colMeta) {
  if (rows.length === 0) return 0

  const allSourceCols = Object.keys(rows[0])
  const columns = allSourceCols.filter((c) => colMeta[c])
  let inserted = 0

  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50)
    const values = []
    const placeholders = []

    for (let j = 0; j < batch.length; j++) {
      const row = batch[j]
      const rowPlaceholders = []
      for (let k = 0; k < columns.length; k++) {
        const idx = j * columns.length + k + 1
        values.push(convertValue(row[columns[k]], colMeta[columns[k]]))
        rowPlaceholders.push(`$${idx}`)
      }
      placeholders.push(`(${rowPlaceholders.join(', ')})`)
    }

    const colList = columns.map((c) => `"${c}"`).join(', ')
    const sql = `INSERT INTO "${table}" (${colList}) VALUES ${placeholders.join(', ')} ON CONFLICT DO NOTHING`

    try {
      const result = await pool.query(sql, values)
      inserted += result.rowCount
    } catch (err) {
      for (const row of batch) {
        try {
          const singleValues = columns.map((c) => convertValue(row[c], colMeta[c]))
          const singlePlaceholders = columns.map((_, idx) => `$${idx + 1}`)
          const r = await pool.query(
            `INSERT INTO "${table}" (${colList}) VALUES (${singlePlaceholders.join(', ')}) ON CONFLICT DO NOTHING`,
            singleValues
          )
          inserted += r.rowCount
        } catch (e2) {
          if (!e2.message.includes('ON CONFLICT')) {
            console.error(`  Skip 1 row in ${table}: ${e2.message.substring(0, 80)}`)
          }
        }
      }
    }
  }
  return inserted
}

async function migrateUsersFromAuth() {
  console.log('\n--- Migrating auth.users → RDS users ---')
  const url = `${SUPABASE_URL}/auth/v1/admin/users?per_page=1000`
  const res = await fetch(url, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  })
  if (!res.ok) { console.error(`  Failed: ${res.status}`); return }
  const body = await res.json()
  const authUsers = body.users || body || []
  let ok = 0
  for (const u of authUsers) {
    try {
      await pool.query(
        `INSERT INTO users (id, email, created_at) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET email = $2`,
        [u.id, u.email, u.created_at]
      )
      ok++
    } catch (err) {
      console.error(`  User ${u.id}: ${err.message}`)
    }
  }
  console.log(`  ${ok}/${authUsers.length} users migrated`)
}

async function main() {
  console.log('=== Supabase → RDS Data Migration ===\n')

  console.log('Step 1: Drop FK constraints...')
  const fks = await dropForeignKeys()

  console.log('\nStep 2: Truncate + migrate data...')
  for (const t of [...TABLES].reverse()) {
    try { await pool.query(`TRUNCATE TABLE "${t}" CASCADE`) } catch {}
  }
  try { await pool.query('TRUNCATE TABLE users CASCADE') } catch {}

  await migrateUsersFromAuth()

  const results = {}
  for (const table of TABLES) {
    process.stdout.write(`\n  ${table}... `)
    try {
      const { rows, notFound } = await fetchAll(table)
      if (notFound) {
        console.log('(not in Supabase)')
        results[table] = { source: 0, inserted: 0, note: 'not in supabase' }
        continue
      }
      if (rows.length === 0) {
        console.log('0 rows')
        results[table] = { source: 0, inserted: 0 }
        continue
      }
      process.stdout.write(`${rows.length} rows → `)

      let colMeta = await getRdsColumns(table)
      colMeta = await addMissingColumns(table, rows, colMeta)

      const inserted = await insertRows(table, rows, colMeta)
      console.log(`${inserted} inserted`)
      results[table] = { source: rows.length, inserted }
    } catch (err) {
      console.error(`FAILED: ${err.message.substring(0, 100)}`)
      results[table] = { source: 0, inserted: 0, error: err.message }
    }
  }

  console.log('\n\nStep 3: Restore FK constraints...')
  await restoreForeignKeys(fks)

  console.log('\n=== Summary ===')
  let totalS = 0, totalI = 0
  for (const [t, r] of Object.entries(results)) {
    totalS += r.source; totalI += r.inserted
    const s = r.error ? `ERROR` : r.note ? r.note : `${r.source} → ${r.inserted}`
    console.log(`  ${t.padEnd(35)} ${s}`)
  }
  console.log(`\n  TOTAL: ${totalS} → ${totalI}`)

  await pool.end()
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1) })
