#!/usr/bin/env node
/**
 * Apply a single .sql file to $DATABASE_URL inside a transaction.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/run-sql-migration.mjs <path-to-sql-file>
 *
 * Why this exists
 *   - Avoid requiring a local libpq/psql install just to run RDS migrations.
 *   - Reuse the backend's `pg` module so SSL handling matches production
 *     (`backend/src/database/pg.js`): strip `sslmode` from the URL, then
 *     pass `ssl: { rejectUnauthorized: false }` because the AWS RDS root
 *     CA chain isn't in Node's default trust store.
 *
 * What it does NOT do
 *   - No migration history table, no out-of-order detection, no rollback
 *     scripting. This is a thin runner for the existing idempotent
 *     `sql/migration_*.sql` files (each guards itself with IF NOT EXISTS
 *     or DO $$ BEGIN ... END $$ blocks). Treat as plumbing, not as a
 *     full migration framework.
 */

import { readFile, stat } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const require = createRequire(resolve(repoRoot, 'backend/package.json'))
const { Client } = require('pg')

const argPath = process.argv[2]
if (!argPath) {
  console.error('usage: node scripts/run-sql-migration.mjs <path-to-sql-file>')
  process.exit(2)
}

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is required (e.g. set -a && . ./.env.vercel-prod && set +a)')
  process.exit(1)
}

const sqlPath = isAbsolute(argPath) ? argPath : resolve(process.cwd(), argPath)
try {
  const s = await stat(sqlPath)
  if (!s.isFile()) throw new Error('not a file')
} catch (err) {
  console.error(`cannot read ${sqlPath}: ${err?.message ?? err}`)
  process.exit(1)
}

const sql = await readFile(sqlPath, 'utf8')

// Mirror backend/src/database/pg.js: strip sslmode and configure SSL ourselves.
const connectionString = url.replace(/[?&]sslmode=[^&]*/g, '')
const client = new Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
  statement_timeout: 60_000,
  query_timeout: 60_000,
})

const redactedUrl = url.replace(/:[^:@/]+@/, ':****@')
console.log(`[migrate] target: ${redactedUrl}`)
console.log(`[migrate] file:   ${sqlPath}`)

await client.connect()
try {
  await client.query('BEGIN')
  await client.query(sql)
  await client.query('COMMIT')
  console.log('[migrate] applied OK')
} catch (err) {
  await client.query('ROLLBACK').catch(() => {})
  console.error('[migrate] FAILED:', err?.message ?? err)
  process.exitCode = 1
} finally {
  await client.end().catch(() => {})
}
