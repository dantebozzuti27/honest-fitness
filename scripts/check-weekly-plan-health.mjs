#!/usr/bin/env node
/**
 * Detect and optionally repair duplicate active weekly_plan_versions per user/week.
 *
 * Usage:
 *   source .env.local && node scripts/check-weekly-plan-health.mjs
 *   source .env.local && node scripts/check-weekly-plan-health.mjs --repair
 */
import pg from 'pg'

const repair = process.argv.includes('--repair')
const url = process.env.DATABASE_URL?.replace(/[?&]sslmode=[^&]*/g, '')
if (!url) {
  console.error('DATABASE_URL required')
  process.exit(1)
}

const pool = new pg.Pool({
  connectionString: url,
  ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
})

async function main() {
  const dupes = (
    await pool.query(
      `SELECT user_id, week_start_date, COUNT(*)::int AS active_count,
              array_agg(id ORDER BY created_at DESC) AS version_ids
       FROM weekly_plan_versions
       WHERE status = 'active'
       GROUP BY user_id, week_start_date
       HAVING COUNT(*) > 1`,
    )
  ).rows

  const orphaned = (
    await pool.query(
      `SELECT d.id, d.weekly_plan_id, d.user_id, d.plan_date
       FROM weekly_plan_days d
       LEFT JOIN weekly_plan_versions v ON v.id = d.weekly_plan_id
       WHERE v.id IS NULL
       LIMIT 50`,
    )
  ).rows

  const report = {
    duplicateActiveWeeks: dupes.length,
    duplicates: dupes.map((r) => ({
      user_id: r.user_id,
      week_start_date: r.week_start_date,
      active_count: r.active_count,
      version_ids: r.version_ids,
    })),
    orphanedPlanDays: orphaned.length,
    repaired: 0,
  }

  if (repair && dupes.length) {
    for (const row of dupes) {
      const ids = row.version_ids || []
      const keep = ids[0]
      const drop = ids.slice(1)
      if (!keep || drop.length === 0) continue
      await pool.query(
        `UPDATE weekly_plan_versions
         SET status = 'superseded'
         WHERE id = ANY($1::uuid[]) AND user_id = $2 AND status = 'active'`,
        [drop, row.user_id],
      )
      report.repaired += drop.length
    }
  }

  console.log(JSON.stringify(report, null, 2))
  await pool.end()
  process.exit(dupes.length > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(2)
})
