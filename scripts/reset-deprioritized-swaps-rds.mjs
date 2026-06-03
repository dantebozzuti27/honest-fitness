#!/usr/bin/env node
/**
 * One-time reset: remove exercise_swaps history for deprioritized exercises
 * (effective decay-weighted mass >= 3.5, matching engine "Deprioritized" tier).
 *
 * Usage (from repo root):
 *   source .env.local
 *   npx tsx scripts/reset-deprioritized-swaps-rds.mjs --dry-run
 *   npx tsx scripts/reset-deprioritized-swaps-rds.mjs
 *
 * Flags:
 *   --dry-run     Report only, no deletes
 *   --all-swaps   Delete entire exercise_swaps table (full amnesty)
 */
import pg from 'pg';
import { exerciseFamilyKey } from '../app/src/lib/exerciseOntology.ts';

const dryRun = process.argv.includes('--dry-run');
const wipeAll = process.argv.includes('--all-swaps');
const MIN_WEIGHT = Number(process.env.SWAP_RESET_MIN_WEIGHT || '3.5');
const HALF_LIFE_DAYS = 21;

const url = process.env.DATABASE_URL?.replace(/[?&]sslmode=[^&]*/g, '');
if (!url) {
  console.error('DATABASE_URL required');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: url,
  ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
});

function decayForRow(row) {
  const ts = row.created_at || `${String(row.swap_date || '').slice(0, 10)}T12:00:00`;
  const t = new Date(ts).getTime();
  if (!Number.isFinite(t)) return 1;
  const days = Math.max(0, (Date.now() - t) / 86_400_000);
  return Math.exp((-Math.LN2 * days) / HALF_LIFE_DAYS);
}

function tierLabel(weight, count) {
  if (weight >= 11 || count >= 15) return 'excluded';
  if (weight >= 7.5 || count >= 10) return 'strongly_deprioritized';
  if (weight >= 3.5 || count >= 5) return 'deprioritized';
  if (weight >= 1.4 || count >= 2) return 'slight_penalty';
  return 'active';
}

async function main() {
  const before = await pool.query(`SELECT COUNT(*)::int AS n FROM exercise_swaps`);
  const rows = (
    await pool.query(
      `SELECT id, user_id, exercise_name, swap_date, created_at, replacement_exercise_name
       FROM exercise_swaps ORDER BY user_id, created_at`,
    )
  ).rows;

  if (wipeAll) {
    console.log(
      JSON.stringify(
        {
          mode: 'all-swaps',
          dryRun,
          rowsBefore: before.rows[0].n,
          rowsToDelete: before.rows[0].n,
        },
        null,
        2,
      ),
    );
    if (!dryRun && before.rows[0].n > 0) {
      await pool.query(`DELETE FROM exercise_swaps`);
    }
    const after = await pool.query(`SELECT COUNT(*)::int AS n FROM exercise_swaps`);
    console.log('after_count', after.rows[0].n);
    await pool.end();
    return;
  }

  /** userId -> familyKey -> { weight, count, rowIds, names } */
  const byUserFamily = new Map();

  for (const row of rows) {
    const family = exerciseFamilyKey(String(row.exercise_name || ''));
    if (!family) continue;
    const composite = `${row.user_id}::${family}`;
    const entry = byUserFamily.get(composite) ?? {
      userId: row.user_id,
      family,
      weight: 0,
      count: 0,
      rowIds: [],
      names: new Set(),
    };
    entry.weight += decayForRow(row);
    entry.count += 1;
    entry.rowIds.push(row.id);
    entry.names.add(row.exercise_name);
    byUserFamily.set(composite, entry);
  }

  const deprioritized = [...byUserFamily.values()]
    .map((e) => ({
      ...e,
      effectiveSwapWeight: Math.round(e.weight * 100) / 100,
      tier: tierLabel(e.weight, e.count),
      exerciseNames: [...e.names].sort(),
    }))
    .filter((e) => e.effectiveSwapWeight >= MIN_WEIGHT || e.count >= 5)
    .sort((a, b) => b.effectiveSwapWeight - a.effectiveSwapWeight);

  const deleteIds = deprioritized.flatMap((e) => e.rowIds);

  console.log(
    JSON.stringify(
      {
        dryRun,
        minEffectiveWeight: MIN_WEIGHT,
        halfLifeDays: HALF_LIFE_DAYS,
        rowsBefore: before.rows[0].n,
        deprioritizedFamilies: deprioritized.length,
        rowsToDelete: deleteIds.length,
        byTier: deprioritized.reduce((acc, e) => {
          acc[e.tier] = (acc[e.tier] ?? 0) + 1;
          return acc;
        }, {}),
        exercises: deprioritized.map((e) => ({
          userId: e.userId,
          family: e.family,
          tier: e.tier,
          effectiveSwapWeight: e.effectiveSwapWeight,
          swapCount: e.count,
          names: e.exerciseNames,
        })),
      },
      null,
      2,
    ),
  );

  if (!dryRun && deleteIds.length) {
    const chunk = 500;
    for (let i = 0; i < deleteIds.length; i += chunk) {
      await pool.query(`DELETE FROM exercise_swaps WHERE id = ANY($1::uuid[])`, [deleteIds.slice(i, i + chunk)]);
    }
  }

  const after = await pool.query(`SELECT COUNT(*)::int AS n FROM exercise_swaps`);
  console.log('after_count', after.rows[0].n);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
