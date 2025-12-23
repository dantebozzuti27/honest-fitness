/**
 * Static RLS sanity check for `app/supabase_run_all.sql`.
 *
 * This does NOT connect to the database.
 * It simply ensures that tables created in the SQL file also have an
 * `ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;` statement somewhere.
 *
 * Usage:
 *   node scripts/check-rls-sql.mjs
 */

import fs from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()
const sqlPath = path.join(repoRoot, 'app', 'supabase_run_all.sql')

const rawSql = fs.readFileSync(sqlPath, 'utf8')

// Strip SQL comments so regexes don't match commented-out text.
const sql = rawSql
  .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
  .replace(/--.*$/gm, '') // line comments

const created = new Set()
const createRe = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([a-zA-Z0-9_]+)/gi
let m
while ((m = createRe.exec(sql))) {
  created.add(m[1])
}

// Some tables may be intentionally without RLS (system/reference tables).
// Keep this allowlist small and explicit.
const ALLOW_NO_RLS = new Set([
  // Example: 'some_lookup_table'
])

const missing = []
for (const table of created) {
  if (ALLOW_NO_RLS.has(table)) continue
  const rlsRe = new RegExp(`ALTER\\s+TABLE\\s+${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i')
  if (!rlsRe.test(sql)) missing.push(table)
}

if (missing.length > 0) {
  console.error('RLS static check failed. Tables created without explicit RLS enablement:')
  for (const t of missing.sort()) console.error(`- ${t}`)
  console.error('\nFix: add `ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;` and policies in app/supabase_run_all.sql')
  process.exit(1)
}

console.log(`✓ RLS static check passed (${created.size} CREATE TABLE statements checked)`)


