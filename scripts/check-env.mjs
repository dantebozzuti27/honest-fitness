/**
 * Minimal env contract checker (non-interactive).
 *
 * Usage:
 *   node scripts/check-env.mjs
 */

import fs from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()

function readDotEnv(envPath) {
  try {
    const raw = fs.readFileSync(envPath, 'utf8')
    const lines = raw.split(/\r?\n/)
    const out = {}
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const idx = trimmed.indexOf('=')
      if (idx === -1) continue
      const k = trimmed.slice(0, idx).trim()
      const v = trimmed.slice(idx + 1).trim()
      if (k) out[k] = v
    }
    return out
  } catch {
    return null
  }
}

function hasNonEmpty(v) {
  return typeof v === 'string' ? v.trim().length > 0 : v != null
}

function checkGroup(name, requiredKeys, env) {
  const missing = requiredKeys.filter(k => !hasNonEmpty(env[k]))
  return { name, missing }
}

const appEnvPath = path.join(repoRoot, 'app', '.env')
const appEnvFromFile = readDotEnv(appEnvPath) || {}

// For local checks, prioritize process.env but allow `app/.env` for frontend vars.
const combined = { ...appEnvFromFile, ...process.env }

const checks = [
  checkGroup('Frontend (Vite)', ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'], combined),
  checkGroup('API/Backend (Server)', ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'], combined)
]

let ok = true
for (const c of checks) {
  if (c.missing.length > 0) {
    ok = false
    console.log(`✗ ${c.name}: missing ${c.missing.join(', ')}`)
  } else {
    console.log(`✓ ${c.name}: OK`)
  }
}

if (!ok) {
  console.log('\nSee docs/ENVIRONMENT.md for the full contract.')
  process.exit(1)
}


