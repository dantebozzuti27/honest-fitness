#!/usr/bin/env node
/**
 * Re-key model_feedback pattern_observation rows with semantic pattern keys,
 * then delete duplicates (keeps highest evidence_score per user+key).
 *
 * Usage: source .env.local && node scripts/rekey-semantic-patterns-rds.mjs [--dry-run]
 */
import pg from 'pg';

const dryRun = process.argv.includes('--dry-run');
const url = process.env.DATABASE_URL?.replace(/[?&]sslmode=[^&]*/g, '');
if (!url) {
  console.error('DATABASE_URL required');
  process.exit(1);
}

const PATTERN_STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'to', 'for', 'of', 'in', 'on', 'with', 'at', 'by', 'from',
  'user', 'lifter', 'athlete', 'often', 'frequently', 'consistently', 'typically', 'generally',
  'usually', 'appears', 'seems', 'may', 'might', 'could', 'should', 'that', 'this', 'these',
  'trains', 'training', 'trained',
  'those', 'been', 'being', 'have', 'has', 'had', 'is', 'are', 'was', 'were',
]);

function classifyPattern(text) {
  const t = text.toLowerCase();
  if (t.includes('mrv') || t.includes('volume') || t.includes('sets')) return 'volume_mrv';
  if (t.includes('swap') || t.includes('replace') || t.includes('substitut')) return 'swap_preference';
  if (t.includes('unilateral') || t.includes('never') || t.includes('not included') || t.includes('missing'))
    return 'exercise_gap';
  if (t.includes('duration') || t.includes('minutes') || t.includes('budget') || t.includes('time'))
    return 'session_duration';
  if (t.includes('sleep') || t.includes('recovery') || t.includes('hrv') || t.includes('rest'))
    return 'recovery';
  if (t.includes('same muscle') || t.includes('multiple exercises') || t.includes('redundant'))
    return 'redundancy';
  return 'other';
}

function muscleMentioned(text) {
  const t = text.toLowerCase();
  const tokens = [
    'triceps', 'biceps', 'chest', 'back', 'lats', 'quadriceps', 'hamstrings',
    'glutes', 'calves', 'forearms', 'shoulders', 'delts', 'core', 'abs',
  ];
  return tokens.filter((m) => t.includes(m)).sort();
}

function normalizeSemanticPhrases(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\b(above|over|exceeds?)\s+mrv\b/g, ' highvol ')
    .replace(/\bhigh\s+volume\b/g, ' highvol ')
    .replace(/\b(reduce|lower|decrease|cut)\b/g, ' reduce ')
    .replace(/\b(mesocycle|microcycle|block|phase|weeks?|months?|days?|several|many)\b/g, ' period ')
    .replace(/\b(sets?|volume)\b/g, ' vol ')
    .replace(/\b(next|upcoming|following)\b/g, ' next ');
}

function tokenFingerprint(text, maxLen) {
  const tokens = normalizeSemanticPhrases(text)
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(user|lifter|athlete)\b/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !PATTERN_STOP_WORDS.has(w))
    .sort();
  return [...new Set(tokens)].join(' ').slice(0, maxLen);
}

function semanticPatternKey(pattern, suggestion = '') {
  const combined = `${pattern} ${suggestion}`.trim();
  const category = classifyPattern(combined);
  const muscles = muscleMentioned(combined).join('+') || '_';
  const intent = tokenFingerprint(combined, 96);
  return `${category}::${muscles}::${intent}`;
}

const pool = new pg.Pool({
  connectionString: url,
  ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
});

async function main() {
  const before = await pool.query(
    `SELECT COUNT(*)::int n FROM model_feedback WHERE feedback_type = 'pattern_observation'`,
  );

  const rows = (
    await pool.query(
      `SELECT id, user_id, feedback_data, created_at
       FROM model_feedback WHERE feedback_type = 'pattern_observation'
       ORDER BY user_id, created_at DESC`,
    )
  ).rows;

  const keepByUserKey = new Map();
  const updates = [];

  for (const r of rows) {
    const d = r.feedback_data || {};
    if (!d.pattern) continue;
    const newKey = semanticPatternKey(d.pattern, d.suggestion ?? '');
    const composite = `${r.user_id}::${newKey}`;
    const existing = keepByUserKey.get(composite);
    const score = Number(d.evidence_score) || 0;

    if (!existing) {
      keepByUserKey.set(composite, { row: r, newKey, score });
      if (d.pattern_key !== newKey) {
        updates.push({ id: r.id, newKey, data: { ...d, pattern_key: newKey } });
      }
      continue;
    }

    if (score > existing.score) {
      keepByUserKey.set(composite, { row: r, newKey, score });
      if (d.pattern_key !== newKey) {
        updates.push({ id: r.id, newKey, data: { ...d, pattern_key: newKey } });
      }
    }
  }

  const keepIds = new Set([...keepByUserKey.values()].map((v) => v.row.id));
  const deleteIds = rows.filter((r) => !keepIds.has(r.id)).map((r) => r.id);

  console.log(
    JSON.stringify(
      {
        dryRun,
        before: before.rows[0].n,
        uniqueSemanticKeys: keepByUserKey.size,
        rekeyUpdates: updates.length,
        deleted: deleteIds.length,
        after: keepIds.size,
      },
      null,
      2,
    ),
  );

  if (dryRun) {
    await pool.end();
    return;
  }

  for (const u of updates) {
    await pool.query(`UPDATE model_feedback SET feedback_data = $2::jsonb WHERE id = $1`, [
      u.id,
      JSON.stringify(u.data),
    ]);
  }

  if (deleteIds.length) {
    const chunk = 500;
    for (let i = 0; i < deleteIds.length; i += chunk) {
      const slice = deleteIds.slice(i, i + chunk);
      await pool.query(`DELETE FROM model_feedback WHERE id = ANY($1::uuid[])`, [slice]);
    }
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
