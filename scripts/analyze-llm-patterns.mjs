#!/usr/bin/env node
/**
 * Deep audit of LLM pattern_observation spam, dedupe potential, and behavioral verification.
 * Usage: source .env.local && node scripts/analyze-llm-patterns.mjs [email_fragment]
 */
import pg from 'pg';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const search = (process.argv[2] || 'dante').toLowerCase();
const url = process.env.DATABASE_URL?.replace(/[?&]sslmode=[^&]*/g, '');
if (!url) {
  console.error('DATABASE_URL required');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: url,
  ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
});

function normKey(pattern, suggestion = '') {
  const n = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
  return `${n(pattern)}::${n(suggestion).slice(0, 80)}`;
}

async function main() {
  const user = (
    await pool.query(
      `SELECT id, email FROM users WHERE lower(email) LIKE $1 LIMIT 1`,
      [`%${search}%`],
    )
  ).rows[0];
  if (!user) {
    console.error('user not found');
    process.exit(1);
  }

  const rows = (
    await pool.query(
      `SELECT feedback_data, feedback_quality, verified_by_user, created_at
       FROM model_feedback
       WHERE user_id = $1 AND feedback_type = 'pattern_observation'
       ORDER BY created_at DESC`,
      [user.id],
    )
  ).rows;

  const artifacts = (
    await pool.query(
      `SELECT COUNT(*)::int n,
              COUNT(*) FILTER (WHERE verdict != 'pass')::int non_pass
       FROM llm_validation_artifacts WHERE user_id = $1`,
      [user.id],
    )
  ).rows[0];

  const byKey = new Map();
  const categories = { volume_mrv: 0, swap: 0, gap: 0, duration: 0, recovery: 0, other: 0 };
  for (const r of rows) {
    const p = r.feedback_data?.pattern ?? '';
    const s = r.feedback_data?.suggestion ?? '';
    const key = normKey(p, s);
    if (!byKey.has(key)) {
      byKey.set(key, {
        pattern: p,
        suggestion: s,
        count: 0,
        confidence: r.feedback_data?.confidence,
        first: r.created_at,
        last: r.created_at,
      });
    }
    const e = byKey.get(key);
    e.count += 1;
    if (r.created_at < e.first) e.first = r.created_at;
    if (r.created_at > e.last) e.last = r.created_at;
    const t = `${p} ${s}`.toLowerCase();
    if (t.includes('mrv') || t.includes('volume')) categories.volume_mrv++;
    else if (t.includes('swap')) categories.swap++;
    else if (t.includes('unilateral') || t.includes('never') || t.includes('not included'))
      categories.gap++;
    else if (t.includes('duration') || t.includes('minute')) categories.duration++;
    else if (t.includes('sleep') || t.includes('recovery')) categories.recovery++;
    else categories.other++;
  }

  const unique = [...byKey.values()].sort((a, b) => b.count - a.count);
  const dedupeRatio = rows.length ? unique.length / rows.length : 0;

  const report = {
    user: { email: user.email, id: user.id },
    totals: {
      rawRows: rows.length,
      uniquePatterns: unique.length,
      dedupeRatio: Math.round(dedupeRatio * 1000) / 1000,
      wasteRows: rows.length - unique.length,
      llmValidationArtifacts: artifacts.n,
      nonPassValidations: artifacts.non_pass,
    },
    categoryMentions: categories,
    topDuplicates: unique.slice(0, 20).map((u) => ({
      count: u.count,
      confidence: u.confidence,
      pattern: u.pattern,
      suggestion: u.suggestion?.slice(0, 120),
      spanDays: Math.round((new Date(u.last) - new Date(u.first)) / 86400000),
    })),
    diagnosis: [
      'Each /api/insights/validate-workout call inserts up to 3 patterns with no dedupe.',
      'Regen storms (many validations/minute) multiply identical rows.',
      'Engine previously used regex on llmPatternObservations; now gated to verified only.',
      'Fix: pattern_key dedupe on insert + aggregate + behavioral auto-verify before engine hints.',
    ],
    recommendations: [
      'Persist only novel pattern_key per 7-day window.',
      'Feed engine top ≤8 auto-verified aggregated patterns, not raw rows.',
      'Tighten LLM prompt: empty patterns when nothing new vs profile.',
      'Debounce validation to 1× per generated_workout_id per day.',
    ],
  };

  const out = join(__dirname, '..', 'reports', `llm-patterns-${user.id.slice(0, 8)}.json`);
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
