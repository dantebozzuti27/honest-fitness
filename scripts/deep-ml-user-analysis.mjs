#!/usr/bin/env node
/**
 * Deep data-science audit: e1RM forensics, volume dynamics, prescription error,
 * swap Markov graph, plan adherence, health-performance coupling.
 *
 * Usage: source .env.local && node scripts/deep-ml-user-analysis.mjs [email_fragment]
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

async function q(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows;
}

// --- Stats primitives ---
function median(a) {
  const s = a.filter(Number.isFinite).sort((x, y) => x - y);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function mad(a, med = median(a)) {
  if (med == null) return null;
  const dev = a.map((x) => Math.abs(x - med)).filter(Number.isFinite);
  return median(dev) * 1.4826;
}
function pct(n, d) {
  return d ? Math.round((1000 * n) / d) / 10 : 0;
}
function epley(w, reps, rir = 1) {
  if (!w || !reps) return 0;
  const eff = Math.min(12, Math.max(1, Math.round(reps))) + Math.max(0, Math.min(4, rir ?? 1));
  return eff === 1 ? w : w * (1 + eff / 30);
}
function naiveEpley(w, reps) {
  if (!w || !reps) return 0;
  return reps === 1 ? w : w * (1 + reps / 30);
}
function robustSessionBest(sets) {
  const est = sets
    .filter((s) => s.weight > 0 && s.reps >= 1 && s.reps <= 20)
    .map((s) => ({
      e1rm: epley(s.weight, s.reps, s.rir),
      weight: s.weight,
      reps: s.reps,
    }));
  if (!est.length) return null;
  est.sort((a, b) => a.e1rm - b.e1rm);
  const top = est[est.length - 1];
  const second = est.length >= 2 ? est[est.length - 2] : null;
  if (second && top.e1rm > second.e1rm * 1.12) return second;
  return top;
}
function naiveSessionMax(sets) {
  let best = 0;
  for (const s of sets) {
    const e = naiveEpley(s.weight, s.reps);
    if (e > best) best = e;
  }
  return best || null;
}
function pearson(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 5) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const vx = xs[i] - mx;
    const vy = ys[i] - my;
    num += vx * vy;
    dx += vx * vx;
    dy += vy * vy;
  }
  const den = Math.sqrt(dx * dy);
  return den ? num / den : null;
}
function olsSlope(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den ? num / den : null;
}
function jaccard(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter || 1);
}

/** Map logged body_part + plan tokens to comparable coarse buckets for Jaccard. */
const COARSE_BUCKETS = {
  chest: 'push', mid_chest: 'push', upper_chest: 'push', lower_chest: 'push',
  shoulders: 'push', front_delts: 'push', side_delts: 'push', rear_delts: 'pull',
  triceps: 'arms', biceps: 'arms', arms: 'arms', forearms: 'arms',
  back: 'pull', back_lats: 'pull', lats: 'pull', rhomboids: 'pull', traps: 'pull',
  legs: 'legs', quadriceps: 'legs', hamstrings: 'legs', glutes: 'legs',
  calves: 'legs', abductors: 'legs', adductors: 'legs', hip_flexors: 'legs',
  core: 'core', abs: 'core', obliques: 'core',
  cardio: 'cardio', recovery: 'recovery',
};
function canonMuscle(bp) {
  const k = String(bp || '').trim().toLowerCase();
  return COARSE_BUCKETS[k] || k || 'unknown';
}
function weekKeyFromDate(dateVal) {
  const raw = dateVal instanceof Date ? dateVal.toISOString() : String(dateVal);
  const d = new Date(`${raw.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const dow = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
  return monday.toISOString().slice(0, 10);
}

async function findUser() {
  const rows = await q(
    `SELECT id, email, created_at FROM users
     WHERE lower(email) LIKE $1 ORDER BY created_at ASC LIMIT 5`,
    [`%${search}%`],
  );
  return rows[0] || null;
}

async function analyzeRestTelemetry(userId) {
  const rows = await q(
    `SELECT ws.rest_seconds_before, ws.prescribed_rest_seconds, ws.rest_seconds_actual,
            ws.set_rpe, ws.actual_rir, w.date
     FROM workout_sets ws
     JOIN workout_exercises we ON we.id = ws.workout_exercise_id
     JOIN workouts w ON w.id = we.workout_id
     WHERE w.user_id = $1
     ORDER BY w.date DESC
     LIMIT 2000`,
    [userId],
  );
  const actuals = [];
  const ratios = [];
  let withPrescribed = 0;
  let withAnyRest = 0;
  for (const r of rows) {
    const a = Number(r.rest_seconds_actual ?? r.rest_seconds_before);
    const p = Number(r.prescribed_rest_seconds);
    if (a > 0) {
      withAnyRest += 1;
      actuals.push(a);
    }
    if (a > 0 && p > 0) {
      withPrescribed += 1;
      ratios.push(a / p);
    }
  }
  const feat = await q(
    `SELECT features, workout_date FROM training_session_features
     WHERE user_id = $1 ORDER BY workout_date DESC LIMIT 8`,
    [userId],
  ).catch(() => []);
  return {
    setsSampled: rows.length,
    setsWithRestLogged: withAnyRest,
    setsWithPrescribedAndActual: withPrescribed,
    coveragePct: pct(withAnyRest, rows.length),
    medianRestSeconds: median(actuals),
    medianRestVsPrescribed: median(ratios),
    recentSessionFeatures: (feat || []).map((f) => ({
      date: f.workout_date,
      ...f.features,
    })),
  };
}

async function loadUserData(userId) {
  const [prefs] = await q(`SELECT * FROM user_preferences WHERE user_id = $1`, [userId]);
  const workouts = await q(
    `SELECT id, date, duration, template_name, generated_workout_id, workout_avg_hr, workout_peak_hr
     FROM workouts WHERE user_id = $1 ORDER BY date ASC`,
    [userId],
  );
  const sets = await q(
    `SELECT ws.weight, ws.reps, ws.set_rpe, ws.actual_rir, ws.is_warmup,
            we.exercise_name, we.body_part, we.exercise_type,
            w.date AS workout_date, w.id AS workout_id
     FROM workout_sets ws
     JOIN workout_exercises we ON we.id = ws.workout_exercise_id
     JOIN workouts w ON w.id = we.workout_id
     WHERE w.user_id = $1 AND (ws.is_warmup IS NOT TRUE OR ws.is_warmup IS NULL)
     ORDER BY w.date ASC, we.exercise_order, ws.set_number`,
    [userId],
  );
  const exec = await q(
    `SELECT exercise_name, set_number, target_weight, actual_weight, target_reps, actual_reps,
            target_rir, actual_rir, execution_accuracy, workout_date
     FROM prescription_execution_events WHERE user_id = $1 ORDER BY workout_date ASC`,
    [userId],
  );
  const swaps = await q(
    `SELECT exercise_name, replacement_exercise_name, swap_context, created_at
     FROM exercise_swaps WHERE user_id = $1 ORDER BY created_at ASC`,
    [userId],
  );
  const planDays = await q(
    `SELECT d.plan_date, d.day_status, d.focus, d.muscle_groups, d.planned_workout, d.actual_workout_id,
            d.is_rest_day, d.estimated_minutes, v.status
     FROM weekly_plan_days d
     JOIN weekly_plan_versions v ON v.id = d.weekly_plan_id
     WHERE d.user_id = $1 ORDER BY d.plan_date ASC`,
    [userId],
  );
  const health = await q(
    `SELECT date, weight, sleep_score, steps, resting_heart_rate, hrv, strain
     FROM health_metrics WHERE user_id = $1 ORDER BY date ASC`,
    [userId],
  );
  const feedback = await q(
    `SELECT feedback_type, feedback_data, created_at,
            feedback_data->>'verified_by_user' AS verified,
            feedback_data->>'quality' AS quality
     FROM model_feedback WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
  const gen = await q(
    `SELECT id, date, exercises, created_at FROM generated_workouts WHERE user_id = $1 ORDER BY date ASC`,
    [userId],
  );
  const outcomes = await q(
    `SELECT workout_date, session_outcome_score, generated_workout_id FROM workout_outcomes WHERE user_id = $1`,
    [userId],
  );
  return { prefs, workouts, sets, exec, swaps, planDays, health, feedback, gen, outcomes };
}

function analyzeE1rmForensics(sets) {
  const byEx = new Map();
  for (const s of sets) {
    if (!s.exercise_name || s.exercise_type === 'cardio') continue;
    const k = s.exercise_name.trim().toLowerCase();
    if (!byEx.has(k)) byEx.set(k, { name: s.exercise_name, sessions: new Map() });
    const ex = byEx.get(k);
    const date = s.workout_date;
    if (!ex.sessions.has(date)) ex.sessions.set(date, []);
    const rir = s.actual_rir != null ? Number(s.actual_rir) : s.set_rpe != null ? Math.max(0, 10 - Number(s.set_rpe)) : 1;
    ex.sessions.get(date).push({ weight: Number(s.weight) || 0, reps: Number(s.reps) || 0, rir });
  }

  const exerciseReports = [];
  for (const [, ex] of byEx) {
    const sessionDates = [...ex.sessions.keys()].sort();
    if (sessionDates.length < 3) continue;
    const naivePeaks = [];
    const robustPeaks = [];
    const workingWeights = [];
    for (const d of sessionDates) {
      const sessSets = ex.sessions.get(d);
      const rb = robustSessionBest(sessSets);
      const nv = naiveSessionMax(sessSets);
      if (rb) robustPeaks.push({ date: d, e1rm: rb.e1rm, weight: rb.weight, reps: rb.reps });
      if (nv) naivePeaks.push({ date: d, e1rm: nv });
      const ww = sessSets.map((x) => x.weight).filter((w) => w > 0);
      if (ww.length) workingWeights.push({ date: d, maxWorking: Math.max(...ww) });
    }
    if (robustPeaks.length < 3) continue;

    const naiveSeries = naivePeaks.map((p) => p.e1rm);
    const robustSeries = robustPeaks.map((p) => p.e1rm);
    const naiveMax = Math.max(...naiveSeries);
    const robustMax = Math.max(...robustSeries);
    const inflationPct = naiveMax > 0 ? pct(naiveMax - robustMax, robustMax) : 0;

    const med = median(robustSeries);
    const m = mad(robustSeries, med);
    const outliers = robustPeaks.filter((p) => m > 0 && Math.abs(p.e1rm - med) > 2.5 * m);

    const slopeRobust = olsSlope(
      robustPeaks.map((_, i) => i),
      robustSeries,
    );
    const slopeNaive = olsSlope(
      naivePeaks.map((_, i) => i),
      naiveSeries,
    );

    let spikeSessions = [];
    for (const d of sessionDates) {
      const sessSets = ex.sessions.get(d);
      const rb = robustSessionBest(sessSets);
      const nv = naiveSessionMax(sessSets);
      if (rb && nv && nv > rb.e1rm * 1.08) {
        spikeSessions.push({
          date: d,
          naiveE1rm: Math.round(nv),
          robustE1rm: Math.round(rb.e1rm),
          bestSet: `${rb.weight}×${rb.reps}`,
        });
      }
    }

    exerciseReports.push({
      exercise: ex.name,
      sessions: sessionDates.length,
      naiveMaxE1rm: Math.round(naiveMax),
      robustMaxE1rm: Math.round(robustMax),
      engineInflationPct: inflationPct,
      robustMedian: Math.round(med),
      mad: Math.round(m || 0),
      outlierSessions: outliers.length,
      slopePerSessionRobust: slopeRobust != null ? Math.round(slopeRobust * 10) / 10 : null,
      slopePerSessionNaive: slopeNaive != null ? Math.round(slopeNaive * 10) / 10 : null,
      spikeSessions: spikeSessions.slice(0, 5),
    });
  }

  exerciseReports.sort((a, b) => b.engineInflationPct - a.engineInflationPct);
  return {
    topInflated: exerciseReports.filter((e) => e.engineInflationPct >= 5).slice(0, 15),
    topProgressing: exerciseReports
      .filter((e) => e.slopePerSessionRobust > 0.5)
      .sort((a, b) => b.slopePerSessionRobust - a.slopePerSessionRobust)
      .slice(0, 10),
    plateaued: exerciseReports
      .filter((e) => Math.abs(e.slopePerSessionRobust) < 0.3 && e.sessions >= 8)
      .slice(0, 10),
    totalExercisesAnalyzed: exerciseReports.length,
  };
}

function analyzeWeeklyVolume(sets, workouts) {
  const weekTonnage = new Map();
  const weekMuscle = new Map();
  for (const s of sets) {
    const w = Number(s.weight) || 0;
    const r = Number(s.reps) || 0;
    if (w <= 0 || r <= 0) continue;
    const ton = w * r;
    const wk = weekKeyFromDate(s.workout_date);
    if (!wk) continue;
    weekTonnage.set(wk, (weekTonnage.get(wk) || 0) + ton);
    const mg = canonMuscle(s.body_part);
    if (!weekMuscle.has(wk)) weekMuscle.set(wk, new Map());
    const wm = weekMuscle.get(wk);
    wm.set(mg, (wm.get(mg) || 0) + ton);
  }
  const weeks = [...weekTonnage.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const tonValues = weeks.map(([, t]) => t);
  const cv = tonValues.length
    ? Math.round((Math.sqrt(variance(tonValues)) / (mean(tonValues) || 1)) * 1000) / 10
    : null;

  const muscleTotals = new Map();
  for (const [, wm] of weekMuscle) {
    for (const [m, t] of wm) muscleTotals.set(m, (muscleTotals.get(m) || 0) + t);
  }
  const muscleRank = [...muscleTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);

  return {
    weeks: weeks.length,
    tonnageCvPct: cv,
    weeklyTonnage: weeks.slice(-12).map(([week, tonnage]) => ({ week, tonnage: Math.round(tonnage) })),
    muscleTonnageRank: muscleRank.map(([muscle, tonnage]) => ({
      muscle,
      tonnage: Math.round(tonnage),
      pctOfTotal: pct(tonnage, [...muscleTotals.values()].reduce((a, b) => a + b, 0)),
    })),
    medianWeeklyTonnage: Math.round(median(tonValues) || 0),
  };
}
function mean(a) {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}
function variance(a) {
  const m = mean(a);
  return a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length || 1);
}

function analyzePrescriptionError(exec) {
  const rows = exec.filter(
    (e) => e.target_weight > 0 && e.actual_weight > 0 && e.target_reps > 0 && e.actual_reps > 0,
  );
  if (!rows.length) return { count: 0 };
  const weightPctErr = rows.map((e) => ((e.actual_weight - e.target_weight) / e.target_weight) * 100);
  const repErr = rows.map((e) => e.actual_reps - e.target_reps);
  const acc = rows.map((e) => Number(e.execution_accuracy)).filter(Number.isFinite);

  const byEx = new Map();
  for (const e of rows) {
    const k = (e.exercise_name || '').toLowerCase();
    if (!byEx.has(k)) byEx.set(k, []);
    byEx.get(k).push(e);
  }
  const worstExercises = [...byEx.entries()]
    .map(([k, arr]) => {
      const maeW = mean(arr.map((e) => Math.abs(e.actual_weight - e.target_weight)));
      const maeR = mean(arr.map((e) => Math.abs(e.actual_reps - e.target_reps)));
      return {
        exercise: arr[0].exercise_name,
        sets: arr.length,
        maeWeightLbs: Math.round(maeW * 10) / 10,
        maeReps: Math.round(maeR * 10) / 10,
        biasWeightPct: Math.round(mean(arr.map((e) => ((e.actual_weight - e.target_weight) / e.target_weight) * 100)) * 10) / 10,
      };
    })
    .filter((x) => x.sets >= 5)
    .sort((a, b) => b.maeWeightLbs - a.maeWeightLbs)
    .slice(0, 12);

  return {
    count: rows.length,
    maeWeightLbs: Math.round(mean(weightPctErr.map((_, i) => Math.abs(rows[i].actual_weight - rows[i].target_weight))) * 10) / 10,
    medianWeightBiasPct: Math.round(median(weightPctErr) * 10) / 10,
    maeReps: Math.round(mean(repErr.map(Math.abs)) * 10) / 10,
    medianExecutionAccuracy: Math.round((median(acc) || 0) * 1000) / 10,
    systematicUndershoot: pct(weightPctErr.filter((x) => x < -5).length, weightPctErr.length),
    systematicOvershoot: pct(weightPctErr.filter((x) => x > 5).length, weightPctErr.length),
    worstExercises,
  };
}

function analyzeSwapGraph(swaps) {
  const transitions = new Map();
  const contextCounts = {};
  for (const s of swaps) {
    const ctx = s.swap_context || 'unknown';
    contextCounts[ctx] = (contextCounts[ctx] || 0) + 1;
    const from = (s.exercise_name || '').toLowerCase();
    const to = (s.replacement_exercise_name || '').toLowerCase();
    if (!from || !to) continue;
    const key = `${from}→${to}`;
    transitions.set(key, (transitions.get(key) || 0) + 1);
  }
  const topTransitions = [...transitions.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([edge, count]) => ({ edge, count }));

  const reversePairs = [];
  for (const [edge, c] of transitions) {
    const [a, b] = edge.split('→');
    const rev = `${b}→${a}`;
    if (transitions.has(rev)) reversePairs.push({ pair: `${a}↔${b}`, forward: c, reverse: transitions.get(rev) });
  }
  reversePairs.sort((a, b) => b.forward + b.reverse - (a.forward + a.reverse));

  return {
    total: swaps.length,
    byContext: contextCounts,
    topTransitions,
    oscillationPairs: reversePairs.slice(0, 8),
  };
}

function analyzePlanAdherence(planDays, sets, workouts) {
  const scored = [];
  for (const d of planDays) {
    if (d.is_rest_day) continue;
    const planned = typeof d.planned_workout === 'object' ? d.planned_workout : null;
    const plannedGroups = (
      planned?.muscleGroupsFocused ||
      (Array.isArray(d.muscle_groups) ? d.muscle_groups : [])
    ).map(canonMuscle);
    if (!d.actual_workout_id || !plannedGroups.length) continue;
    const actualSets = sets.filter((s) => s.workout_id === d.actual_workout_id);
    const actualGroups = [...new Set(actualSets.map((s) => canonMuscle(s.body_part)).filter(Boolean))];
    scored.push({
      date: d.plan_date,
      jaccard: Math.round(jaccard(plannedGroups, actualGroups) * 1000) / 1000,
      focus: d.focus,
      status: d.day_status,
    });
  }
  const jaccards = scored.map((s) => s.jaccard);
  return {
    daysWithActual: scored.length,
    medianJaccard: median(jaccards),
    lowAdherenceDays: scored.filter((s) => s.jaccard < 0.35).slice(0, 8),
    highAdherenceDays: scored.filter((s) => s.jaccard >= 0.6).length,
  };
}

function analyzeHealthPerformance(health, workouts, sets) {
  const weekVol = new Map();
  for (const s of sets) {
    const w = Number(s.weight) || 0;
    const r = Number(s.reps) || 0;
    if (w <= 0 || !r) continue;
    const wk = weekKeyFromDate(s.workout_date);
    if (!wk) continue;
    weekVol.set(wk, (weekVol.get(wk) || 0) + w * r);
  }
  const healthByWeek = new Map();
  for (const h of health) {
    const wk = weekKeyFromDate(h.date);
    if (!wk) continue;
    if (!healthByWeek.has(wk)) healthByWeek.set(wk, { sleep: [], hrv: [], rhr: [], weight: [], steps: [] });
    const bucket = healthByWeek.get(wk);
    if (h.sleep_score != null) bucket.sleep.push(Number(h.sleep_score));
    if (h.hrv != null) bucket.hrv.push(Number(h.hrv));
    if (h.resting_heart_rate != null) bucket.rhr.push(Number(h.resting_heart_rate));
    if (h.weight != null) bucket.weight.push(Number(h.weight));
    if (h.steps != null) bucket.steps.push(Number(h.steps));
  }
  const aligned = [];
  for (const [wk, vol] of weekVol) {
    const h = healthByWeek.get(wk);
    if (!h) continue;
    aligned.push({
      week: wk,
      tonnage: vol,
      sleep: median(h.sleep),
      hrv: median(h.hrv),
      rhr: median(h.rhr),
      weight: median(h.weight),
    });
  }
  aligned.sort((a, b) => a.week.localeCompare(b.week));
  const vols = aligned.map((a) => a.tonnage);
  const sleeps = aligned.map((a) => a.sleep).filter(Number.isFinite);
  const hrvs = aligned.map((a) => a.hrv).filter(Number.isFinite);
  const rhrs = aligned.map((a) => a.rhr).filter(Number.isFinite);

  const weights = health.map((h) => Number(h.weight)).filter((n) => n > 0);
  const weightSlope = weights.length >= 5 ? olsSlope(weights.map((_, i) => i), weights) : null;

  return {
    alignedWeeks: aligned.length,
    corrTonnageSleep: pearson(vols, sleeps),
    corrTonnageHrv: pearson(vols, hrvs),
    corrTonnageRhr: pearson(vols, rhrs),
    weightSlopeLbsPerDay: weightSlope != null ? Math.round(weightSlope * 1000) / 1000 : null,
    recentAligned: aligned.slice(-8),
  };
}

function analyzeFeedback(feedback) {
  const patterns = feedback.filter((f) => f.feedback_type === 'pattern_observation');
  const verified = patterns.filter((p) => p.verified === 'true' || p.quality === 'verified' || p.quality === 'trusted');
  const categories = {};
  for (const p of patterns) {
    let data = p.feedback_data;
    if (typeof data === 'string') try { data = JSON.parse(data); } catch { data = {}; }
    const cat = data?.category || data?.pattern_type || 'uncategorized';
    categories[cat] = (categories[cat] || 0) + 1;
  }
  return {
    totalFeedback: feedback.length,
    patternObservations: patterns.length,
    verifiedPatterns: verified.length,
    verificationRatePct: pct(verified.length, patterns.length),
    categoryBreakdown: categories,
  };
}

function analyzeLineage(workouts, gen, outcomes) {
  const linked = workouts.filter((w) => w.generated_workout_id).length;
  const genDates = new Set(gen.map((g) => g.date?.slice?.(0, 10) || g.date));
  return {
    workouts: workouts.length,
    withGeneratedId: linked,
    linkagePct: pct(linked, workouts.length),
    generatedWorkoutRows: gen.length,
    outcomeRows: outcomes.length,
    genDateCoveragePct: pct(
      workouts.filter((w) => genDates.has(String(w.date).slice(0, 10))).length,
      workouts.length,
    ),
  };
}

function buildMlRecommendations(report) {
  const recs = [];
  const inf = report.e1rmForensics?.topInflated || [];
  if (inf.length) {
    recs.push({
      priority: 'P0',
      area: 'capacity_model',
      finding: `${inf.length} exercises show ≥5% naive-vs-robust e1RM inflation; worst: ${inf[0].exercise} (+${inf[0].engineInflationPct}%).`,
      action: 'Ship robust e1rm everywhere; per-exercise Bayesian shrinkage toward family prior for n<8 sessions.',
    });
  }
  if (report.prescriptionError?.count > 50) {
    const bias = report.prescriptionError.medianWeightBiasPct;
    recs.push({
      priority: 'P0',
      area: 'prescription_calibration',
      finding: `${report.prescriptionError.count} execution events; median weight bias ${bias}%; undershoot ${report.prescriptionError.systematicUndershoot}%.`,
      action: 'Fit per-exercise bias correction layer on execution_accuracy; propagate to liftCapacity offsets.',
    });
  }
  if (report.swapGraph?.oscillationPairs?.length) {
    recs.push({
      priority: 'P1',
      area: 'swap_policy',
      finding: `${report.swapGraph.oscillationPairs.length} bidirectional swap pairs (e.g. ${report.swapGraph.oscillationPairs[0]?.pair}).`,
      action: 'Hard penalize reverse edges in affinity graph; require 14-day cooldown on A→B after B→A.',
    });
  }
  if (report.planAdherence?.medianJaccard != null && report.planAdherence.medianJaccard < 0.45) {
    recs.push({
      priority: 'P1',
      area: 'plan_reconcile',
      finding: `Median plan-vs-actual muscle Jaccard ${report.planAdherence.medianJaccard}; ${report.planAdherence.lowAdherenceDays?.length} severe mismatches.`,
      action: 'Post-session EM update of weekly priors; regen only when Jaccard<0.3 for 2+ consecutive sessions.',
    });
  }
  if (report.feedback?.verificationRatePct < 10 && report.feedback?.patternObservations > 100) {
    recs.push({
      priority: 'P1',
      area: 'llm_feedback',
      finding: `${report.feedback.patternObservations} pattern observations, ${report.feedback.verificationRatePct}% verified.`,
      action: 'Do not inject unverified patterns into engine; active-learning UI for top-5 high-confidence candidates.',
    });
  }
  if (report.lineage?.linkagePct < 60) {
    recs.push({
      priority: 'P1',
      area: 'data_lineage',
      finding: `Only ${report.lineage.linkagePct}% workouts carry generated_workout_id.`,
      action: 'Block save path without lineage; train compliance model only on linked rows.',
    });
  }
  if (report.volume?.tonnageCvPct > 35) {
    recs.push({
      priority: 'P2',
      area: 'volume_periodization',
      finding: `Weekly tonnage CV ${report.volume.tonnageCvPct}% — high week-to-week volatility.`,
      action: 'Cap week-over-week tonnage delta at 15% unless deload flag; align with cut-phase goal.',
    });
  }
  recs.push({
    priority: 'P2',
    area: 'ml_platform',
    finding: 'Current backend ML uses threshold heuristics only; RDS has rich execution + swap + health joins.',
    action: 'Add batch feature store job: weekly user feature vector → intervention_episodes / replay_results.',
  });
  return recs;
}

async function platformStats() {
  const [users, wk, exec, fb, sw] = await Promise.all([
    q(`SELECT COUNT(*)::int AS n FROM users`),
    q(`SELECT COUNT(*)::int AS n, COUNT(DISTINCT user_id)::int AS users FROM workouts`),
    q(`SELECT COUNT(*)::int AS n FROM prescription_execution_events`),
    q(`SELECT COUNT(*)::int AS n FROM model_feedback WHERE feedback_type='pattern_observation'`),
    q(`SELECT COUNT(*)::int AS n FROM exercise_swaps`),
  ]);
  return {
    users: users[0].n,
    workouts: wk[0].n,
    workoutUsers: wk[0].users,
    executionEvents: exec[0].n,
    patternFeedback: fb[0].n,
    swaps: sw[0].n,
  };
}

async function main() {
  const user = await findUser();
  if (!user) {
    console.error('User not found');
    process.exit(1);
  }
  const data = await loadUserData(user.id);
  const platform = await platformStats();
  const restTelemetry = await analyzeRestTelemetry(user.id);

  const report = {
    generatedAt: new Date().toISOString(),
    user: { id: user.id, email: user.email },
    platform,
    profile: {
      training_goal: data.prefs?.training_goal,
      experience: data.prefs?.experience_level,
      session_budget_min: data.prefs?.session_duration_minutes,
      priority_muscles: data.prefs?.priority_muscles,
      rest_days: data.prefs?.rest_days,
      split: data.prefs?.preferred_split,
    },
    e1rmForensics: analyzeE1rmForensics(data.sets),
    volume: analyzeWeeklyVolume(data.sets, data.workouts),
    prescriptionError: analyzePrescriptionError(data.exec),
    swapGraph: analyzeSwapGraph(data.swaps),
    planAdherence: analyzePlanAdherence(data.planDays, data.sets, data.workouts),
    healthPerformance: analyzeHealthPerformance(data.health, data.workouts, data.sets),
    feedback: analyzeFeedback(data.feedback),
    lineage: analyzeLineage(data.workouts, data.gen, data.outcomes),
    restTelemetry,
    sessionDuration: {
      medianMin: median(data.workouts.map((w) => Number(w.duration)).filter((n) => n > 0)),
      budgetMin: data.prefs?.session_duration_minutes,
      hrCoveragePct: pct(
        data.workouts.filter((w) => w.workout_avg_hr != null).length,
        data.workouts.length,
      ),
    },
    mlRecommendations: [],
  };
  report.mlRecommendations = buildMlRecommendations(report);

  const outPath = join(__dirname, '..', 'reports', `deep-ml-${user.id.slice(0, 8)}.json`);
  try {
    writeFileSync(outPath, JSON.stringify(report, null, 2));
    report._writtenTo = outPath;
  } catch {
    report._writtenTo = null;
  }

  console.log(JSON.stringify(report, null, 2));
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
