#!/usr/bin/env node
/**
 * One-time dedupe of model_feedback pattern_observation spam.
 * Keeps best row per (user_id, pattern_key); deletes duplicates.
 *
 * Usage: source .env.local && node scripts/cleanup-llm-patterns-rds.mjs [--dry-run]
 */
import pg from 'pg';

const dryRun = process.argv.includes('--dry-run');
const url = process.env.DATABASE_URL?.replace(/[?&]sslmode=[^&]*/g, '');
if (!url) {
  console.error('DATABASE_URL required');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: url,
  ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
});

function patternKey(pattern, suggestion = '') {
  const norm = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
  return `${norm(pattern)}::${norm(suggestion).slice(0, 80)}`;
}

async function main() {
  const before = await pool.query(
    `SELECT COUNT(*)::int n FROM model_feedback WHERE feedback_type = 'pattern_observation'`,
  );

  const rows = (
    await pool.query(
      `SELECT id, user_id, feedback_data, created_at, verified_by_user, feedback_quality
       FROM model_feedback WHERE feedback_type = 'pattern_observation'
       ORDER BY user_id, created_at DESC`,
    )
  ).rows;

  const keepByUserKey = new Map();
  for (const r of rows) {
    const d = r.feedback_data || {};
    const key = d.pattern_key || patternKey(d.pattern, d.suggestion);
    const composite = `${r.user_id}::${key}`;
    const existing = keepByUserKey.get(composite);
    if (!existing) {
      keepByUserKey.set(composite, r);
      continue;
    }
    const scoreNew = Number(d.evidence_score) || 0;
    const scoreOld = Number(existing.feedback_data?.evidence_score) || 0;
    if (scoreNew > scoreOld) keepByUserKey.set(composite, r);
  }

  const keepIds = new Set([...keepByUserKey.values()].map((r) => r.id));
  const deleteIds = rows.filter((r) => !keepIds.has(r.id)).map((r) => r.id);

  console.log(
    JSON.stringify(
      {
        dryRun,
        before: before.rows[0].n,
        after: keepIds.size,
        deleted: deleteIds.length,
        uniqueKeys: keepByUserKey.size,
      },
      null,
      2,
    ),
  );

  if (!dryRun && deleteIds.length) {
    const chunk = 500;
    for (let i = 0; i < deleteIds.length; i += chunk) {
      const slice = deleteIds.slice(i, i + chunk);
      await pool.query(`DELETE FROM model_feedback WHERE id = ANY($1::uuid[])`, [slice]);
    }
    await pool.query(
      `UPDATE model_feedback SET feedback_data = feedback_data || jsonb_build_object('pattern_key',
         COALESCE(feedback_data->>'pattern_key',
           lower(regexp_replace(COALESCE(feedback_data->>'pattern',''), '[^a-zA-Z0-9 ]', ' ', 'g'))))
       WHERE feedback_type = 'pattern_observation' AND feedback_data->>'pattern_key' IS NULL`,
    ).catch(() => {
      /* optional json patch if regex fails — client-side keys already on new rows */
    });
  }

  const after = await pool.query(
    `SELECT COUNT(*)::int n FROM model_feedback WHERE feedback_type = 'pattern_observation'`,
  );
  console.log('after_count', after.rows[0].n);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
