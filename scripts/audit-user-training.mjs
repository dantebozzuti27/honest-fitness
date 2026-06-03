#!/usr/bin/env node
/**
 * Deep audit of a user's workouts, plans, prefs, and engine telemetry.
 * Usage: DATABASE_URL=... node scripts/audit-user-training.mjs "dante bozzuti"
 */
import pg from 'pg';

const search = (process.argv[2] || 'dante bozzuti').toLowerCase();
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

function median(nums) {
  const a = nums.filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function pct(n, d) {
  if (!d) return 0;
  return Math.round((n / d) * 1000) / 10;
}

function parseJson(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

function normName(s) {
  return String(s || '').trim().toLowerCase();
}

async function findUser() {
  const rows = await q(
    `SELECT id, email, created_at FROM users
     WHERE lower(email) LIKE $1 OR lower(email) LIKE $2
     ORDER BY created_at ASC`,
    [`%${search.replace(/\s+/g, '%')}%`, `%${search.split(/\s+/).pop()}%`],
  );
  if (!rows.length) {
    const byEmail = await q(
      `SELECT id, email, created_at FROM users WHERE lower(email) LIKE $1`,
      [`%dante%`],
    );
    return byEmail;
  }
  return rows;
}

async function auditUser(userId, email) {
  const prefs = (await q(`SELECT * FROM user_preferences WHERE user_id = $1`, [userId]))[0] || null;

  const workouts = await q(
    `SELECT w.*,
      (SELECT COUNT(*)::int FROM workout_exercises we WHERE we.workout_id = w.id) AS exercise_count,
      (SELECT COUNT(*)::int FROM workout_sets ws
         JOIN workout_exercises we ON ws.workout_exercise_id = we.id
         WHERE we.workout_id = w.id) AS set_count
     FROM workouts w WHERE w.user_id = $1 ORDER BY w.date ASC`,
    [userId],
  );

  const exercises = await q(
    `SELECT we.*, w.date AS workout_date
     FROM workout_exercises we
     JOIN workouts w ON w.id = we.workout_id
     WHERE w.user_id = $1 ORDER BY w.date ASC, we.exercise_order ASC`,
    [userId],
  );

  const sets = await q(
    `SELECT ws.*, we.exercise_name, we.body_part, w.date AS workout_date
     FROM workout_sets ws
     JOIN workout_exercises we ON ws.workout_exercise_id = we.id
     JOIN workouts w ON w.id = we.workout_id
     WHERE w.user_id = $1 ORDER BY w.date ASC, ws.set_number ASC`,
    [userId],
  );

  const planVersions = await q(
    `SELECT * FROM weekly_plan_versions WHERE user_id = $1 ORDER BY week_start_date DESC, created_at DESC`,
    [userId],
  );

  const planDays = await q(
    `SELECT d.*, v.status AS version_status, v.week_start_date
     FROM weekly_plan_days d
     JOIN weekly_plan_versions v ON v.id = d.weekly_plan_id
     WHERE d.user_id = $1 ORDER BY d.plan_date ASC`,
    [userId],
  );

  const outcomes = await q(
    `SELECT * FROM workout_outcomes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200`,
    [userId],
  );

  const swaps = await q(
    `SELECT * FROM exercise_swaps WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200`,
    [userId],
  );

  const genWorkouts = await q(
    `SELECT * FROM generated_workouts WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
    [userId],
  );

  const execEvents = await q(
    `SELECT * FROM prescription_execution_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT 500`,
    [userId],
  );

  const health = await q(
    `SELECT date, weight, sleep_score, steps, resting_heart_rate, hrv, strain
     FROM health_metrics WHERE user_id = $1 ORDER BY date ASC`,
    [userId],
  );

  const feedback = await q(
    `SELECT feedback_type, feedback_source, created_at, feedback_data
     FROM model_feedback WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [userId],
  );

  const paused = await q(
    `SELECT * FROM paused_workouts WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 20`,
    [userId],
  );

  // --- Workout stats ---
  const dates = workouts.map((w) => w.date);
  const firstDate = dates[0] || null;
  const lastDate = dates[dates.length - 1] || null;
  const durations = workouts.map((w) => Number(w.duration)).filter((n) => n > 0);
  const withHr = workouts.filter((w) => w.workout_avg_hr != null).length;

  const exerciseFreq = new Map();
  for (const ex of exercises) {
    const k = normName(ex.exercise_name);
    if (!k) continue;
    const cur = exerciseFreq.get(k) || { name: ex.exercise_name, count: 0, dates: new Set() };
    cur.count += 1;
    cur.dates.add(ex.workout_date);
    exerciseFreq.set(k, cur);
  }
  const topExercises = [...exerciseFreq.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 25)
    .map((e) => ({ name: e.name, sessions: e.dates.size, appearances: e.count }));

  const muscleFreq = new Map();
  for (const ex of exercises) {
    const bp = normName(ex.body_part);
    if (bp) muscleFreq.set(bp, (muscleFreq.get(bp) || 0) + 1);
  }

  // Prescription vs actual (sets with weight+reps)
  let prescribedSets = 0;
  let completedSets = 0;
  let weightDeviations = [];
  let repDeviations = [];
  for (const s of sets) {
    if (s.weight != null && s.reps != null) {
      completedSets += 1;
      // no target in sets table — use outcomes if linked
    }
  }

  // Plan vs actual alignment
  let planDaysTotal = 0;
  let planDaysCompleted = 0;
  let planDaysWithActual = 0;
  let planMismatchMuscle = 0;
  let planStaleActive = 0;
  const planQuality = [];
  for (const d of planDays) {
    planDaysTotal += 1;
    if (d.day_status === 'completed') planDaysCompleted += 1;
    if (d.actual_workout_id) planDaysWithActual += 1;
    const planned = parseJson(d.planned_workout);
    const plannedGroups = Array.isArray(planned?.muscleGroupsFocused)
      ? planned.muscleGroupsFocused.map(normName)
      : Array.isArray(d.muscle_groups)
        ? d.muscle_groups.map(normName)
        : [];
    if (d.actual_workout_id && plannedGroups.length) {
      const actualEx = exercises.filter((e) => {
        const w = workouts.find((x) => x.id === d.actual_workout_id);
        return w && e.workout_id === d.actual_workout_id;
      });
      const actualGroups = new Set(actualEx.map((e) => normName(e.body_part)).filter(Boolean));
      const overlap = plannedGroups.filter((g) => actualGroups.has(g)).length;
      if (overlap < Math.min(2, plannedGroups.length)) planMismatchMuscle += 1;
    }
    if (planned?.planQuality) planQuality.push(planned.planQuality);
  }

  const activePlans = planVersions.filter((v) => v.status === 'active');
  if (activePlans.length > 1) planStaleActive = activePlans.length - 1;

  const monthlyFocus = parseJson(prefs?.monthly_focus_state);
  const constraintsSamples = planVersions
    .slice(0, 8)
    .map((v) => parseJson(v.plan_constraints))
    .filter(Boolean);

  const outcomeCompliance = outcomes
    .map((o) => parseJson(o.outcome_data))
    .filter(Boolean);
  const complianceRates = outcomeCompliance
    .map((o) => Number(o?.complianceRate ?? o?.compliance_rate))
    .filter((n) => Number.isFinite(n));

  const swapReasons = new Map();
  for (const s of swaps) {
    const r = s.reason || s.swap_reason || 'unknown';
    swapReasons.set(r, (swapReasons.get(r) || 0) + 1);
  }

  const insights = buildInsights({
    email,
    prefs,
    workouts,
    exercises,
    sets,
    planVersions,
    planDays,
    outcomes,
    swaps,
    genWorkouts,
    execEvents,
    health,
    feedback,
    paused,
    stats: {
      firstDate,
      lastDate,
      workoutCount: workouts.length,
      medianDuration: median(durations),
      withHrPct: pct(withHr, workouts.length),
      topExercises,
      muscleFreq: Object.fromEntries([...muscleFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)),
      planDaysTotal,
      planDaysCompleted,
      planDaysWithActual,
      planMismatchMuscle,
      planStaleActive,
      activePlans: activePlans.length,
      monthlyFocus,
      complianceMedian: median(complianceRates),
      swapReasons: Object.fromEntries(swapReasons),
      constraintsSamples,
      planQualityCount: planQuality.length,
    },
  });

  return {
    user: { id: userId, email },
    summary: {
      workoutCount: workouts.length,
      dateRange: [firstDate, lastDate],
      planVersionCount: planVersions.length,
      planDayCount: planDays.length,
      healthMetricDays: health.length,
    },
    preferences: prefs
      ? {
          training_goal: prefs.training_goal,
          preferred_split: prefs.preferred_split,
          experience_level: prefs.experience_level,
          session_duration_minutes: prefs.session_duration_minutes,
          rest_days: prefs.rest_days,
          priority_muscles: prefs.priority_muscles,
          monthly_focus_state: monthlyFocus,
          weekly_split_schedule: prefs.weekly_split_schedule,
          injuries: prefs.injuries,
          hotel_mode: prefs.hotel_mode,
          body_weight_lbs: prefs.body_weight_lbs,
          updated_at: prefs.updated_at,
        }
      : null,
    workouts: {
      count: workouts.length,
      medianDurationMin: median(durations),
      recent: workouts.slice(-8).map((w) => ({
        date: w.date,
        template: w.template_name,
        exercises: w.exercise_count,
        sets: w.set_count,
        duration: w.duration,
      })),
    },
    plans: {
      versions: planVersions.slice(0, 12).map((v) => ({
        id: v.id,
        week_start: v.week_start_date,
        status: v.status,
        feature_snapshot_id: v.feature_snapshot_id,
        has_constraints: Boolean(v.plan_constraints),
        has_engine_snapshot: Boolean(v.engine_input_snapshot),
        created_at: v.created_at,
      })),
      dayStatusBreakdown: countBy(planDays, 'day_status'),
      recentDays: planDays.slice(-14).map((d) => ({
        date: d.plan_date,
        status: d.day_status,
        rest: d.is_rest_day,
        focus: d.focus,
        muscle_groups: d.muscle_groups,
        est_min: d.estimated_minutes,
        planned_exercises: parseJson(d.planned_workout)?.exercises?.length ?? null,
        has_actual: Boolean(d.actual_workout_id),
      })),
    },
    telemetry: {
      outcomes: outcomes.length,
      swaps: swaps.length,
      generated_workouts: genWorkouts.length,
      execution_events: execEvents.length,
      model_feedback: feedback.length,
    },
    topExercises,
    insights,
  };
}

function countBy(arr, key) {
  const m = {};
  for (const x of arr) {
    const k = x[key] ?? 'null';
    m[k] = (m[k] || 0) + 1;
  }
  return m;
}

function buildInsights(ctx) {
  const { prefs, workouts, planDays, planVersions, swaps, outcomes, stats, health, exercises } = ctx;
  const insights = [];

  const add = (id, category, finding, engineAction) => {
    insights.push({ id, category, finding, engineAction });
  };

  if (!workouts.length) {
    add(1, 'data', 'No logged workouts in database.', 'Cold-start path: default templates + onboarding volume ramp.');
    return insights;
  }

  const daysBetween = stats.firstDate && stats.lastDate
    ? Math.round((new Date(stats.lastDate) - new Date(stats.firstDate)) / 86400000)
    : 0;
  const freqPerWeek = daysBetween > 0 ? (workouts.length / (daysBetween / 7)) : workouts.length;

  add(1, 'adherence', `${workouts.length} sessions from ${stats.firstDate} to ${stats.lastDate} (~${freqPerWeek.toFixed(1)}/week).`, 'Calibrate mesocycle volume targets to observed frequency, not stated available_days.');

  if (stats.medianDuration && prefs?.session_duration_minutes) {
    const gap = stats.medianDuration - Number(prefs.session_duration_minutes);
    add(2, 'time_budget', `Median actual duration ${stats.medianDuration} min vs prefs ${prefs.session_duration_minutes} min (Δ${gap > 0 ? '+' : ''}${gap}).`, gap > 5 ? 'Raise time-budget trim threshold or reduce default exercise count.' : 'Session cap may be over-trimming — user finishes under budget.');
  }

  if (stats.planDaysTotal) {
    const completionPct = pct(stats.planDaysCompleted, stats.planDaysTotal);
    add(3, 'planning', `${completionPct}% of plan days marked completed (${stats.planDaysCompleted}/${stats.planDaysTotal}).`, 'Weight plan-adherence signal in readiness / deload triggers.');
  }

  if (stats.planMismatchMuscle > 0) {
    add(4, 'plan_vs_actual', `${stats.planMismatchMuscle} days where actual muscle groups poorly matched planned focus.`, 'Post-session reconcile: update muscleGroupsFocused from logged sets for next-week priors.');
  }

  if (stats.planStaleActive > 0) {
    add(5, 'infra', `${stats.planStaleActive} extra active weekly_plan_versions detected.`, 'Enforce single-active invariant at DB (partially addressed by save_weekly_plan_atomic).');
  }

  const mf = stats.monthlyFocus;
  if (mf?.fitness_muscles?.length || mf?.fitness_muscle) {
    const muscles = mf.fitness_muscles || (mf.fitness_muscle ? [mf.fitness_muscle] : []);
    add(6, 'monthly_focus', `Monthly focus muscles: ${muscles.join(', ')} (month ${mf.month}).`, 'Verify layered focus volume appears in plan days off split — audit isUndroppable rate.');
  }

  if (stats.topExercises?.length) {
    const top = stats.topExercises[0];
    const concentration = top.sessions / workouts.length;
    if (concentration > 0.35) {
      add(7, 'diversity', `Top exercise "${top.name}" in ${pct(top.sessions, workouts.length)}% of sessions.`, 'Strengthen family-diversity bonus / recurrence blocks for over-used families.');
    }
  }

  if (stats.complianceMedian != null) {
    add(8, 'execution', `Median outcome compliance ~${Math.round(stats.complianceMedian * 100)}%.`, 'Tie prescriptionController weightBias to compliance buckets per muscle.');
  }

  if (Object.keys(stats.swapReasons).length) {
    add(9, 'swaps', `Swap reasons: ${JSON.stringify(stats.swapReasons)}.`, 'Feed swap reason codes into surgicalSwap affinities and avoid-list decay.');
  }

  if (prefs?.injuries && Array.isArray(parseJson(prefs.injuries)) && parseJson(prefs.injuries).length) {
    add(10, 'safety', `Active injury prefs: ${JSON.stringify(parseJson(prefs.injuries).slice(0, 3))}.`, 'Hard-block family keys overlapping injured regions in stepSelectExercises.');
  }

  if (prefs?.hotel_mode) {
    add(11, 'context', 'Hotel mode enabled in preferences.', 'Ensure dumbbell caps and exercise pool filters are applied on plan regen, not only live workout.');
  }

  const restDays = parseJson(prefs?.rest_days);
  if (Array.isArray(restDays) && restDays.length) {
    add(12, 'split', `Rest days DOW: ${restDays.join(',')}.`, 'Cross-check weekly plan rest-day alignment with weekly_split_schedule to prevent focus layering on rest.');
  }

  if (stats.withHrPct < 30 && workouts.length > 10) {
    add(13, 'wearables', `Only ${stats.withHrPct}% of workouts have HR telemetry.`, 'Degrade cardio modality inference when HR missing; don\'t assume zone compliance.');
  }

  const weights = health.map((h) => Number(h.weight)).filter((n) => n > 0);
  if (weights.length >= 5) {
    const trend = weights[weights.length - 1] - weights[0];
    add(14, 'bodycomp', `Weight trend ${weights[0]}→${weights[weights.length - 1]} lbs (${trend > 0 ? '+' : ''}${trend.toFixed(1)}).`, 'Sync caloricPhaseScale with health_metrics slope, not only prefs.training_goal.');
  }

  const genCount = ctx.genWorkouts?.length ?? 0;
  if (genCount < workouts.length * 0.5) {
    add(15, 'lineage', `Only ${genCount} generated_workouts rows vs ${workouts.length} workouts.`, 'Require generated_workout_id on save for prescription-vs-actual learning closure.');
  }

  const versionsNoConstraints = planVersions.filter((v) => !v.plan_constraints).length;
  if (versionsNoConstraints > 0) {
    add(16, 'staleness', `${versionsNoConstraints} plan versions missing plan_constraints hash.`, 'Backfill constraints on read; force regen when ontology/engine version bumps.');
  }

  const cardioEx = exercises.filter((e) => normName(e.exercise_type) === 'cardio' || normName(e.body_part) === 'cardio');
  if (cardioEx.length < workouts.length * 0.3 && prefs?.training_goal === 'fat_loss') {
    add(17, 'cardio_policy', `Cardio logged in ${pct(cardioEx.length, workouts.length)}% of sessions under fat_loss goal.`, 'Elevate weeklyCardioContext.requiredDays on cut — invariant already exists, ensure planner obeys.');
  }

  if (stats.planQualityCount > 0) {
    add(18, 'quality', `Plan quality metadata present on ${stats.planQualityCount} days.`, 'Surface avgCoherenceScore / recurrenceBlockEvents to user when plan regen skips stale check.');
  }

  const feedbackCount = ctx.feedback?.length ?? 0;
  if (feedbackCount === 0 && workouts.length > 15) {
    add(19, 'learning', 'No model_feedback pattern observations despite substantial history.', 'Prompt LLM pattern mining batch job or derive rules from swap/outcome tables.');
  }

  const pausedCount = ctx.paused?.length ?? 0;
  if (pausedCount > 0) {
    add(20, 'ux', `${pausedCount} paused workout records.`, 'Resume flow should pass planningDate + week plan overrides to avoid regen drift.');
  }

  const topMuscle = Object.entries(stats.muscleFreq || {})[0];
  if (topMuscle) {
    add(21, 'volume', `Most-logged body_part bucket: ${topMuscle[0]} (${topMuscle[1]} exercise rows).`, 'Align volumeGuidelines weekly targets with actual logging taxonomy (body_part vs canonical group).');
  }

  if (prefs?.priority_muscles?.length) {
    add(22, 'priority', `Priority muscles: ${JSON.stringify(prefs.priority_muscles)}.`, 'Detect overlap with monthly focus — dedupe boosts to avoid double-counting priority.');
  }

  const schedule = parseJson(prefs?.weekly_split_schedule);
  if (!schedule && prefs?.preferred_split) {
    add(23, 'schedule', `preferred_split=${prefs.preferred_split} but no weekly_split_schedule JSON.`, 'Infer schedule from history or force schedule editor completion before weekly plan.');
  }

  const execN = ctx.execEvents?.length ?? 0;
  if (execN > 50) {
    add(24, 'telemetry', `${execN} prescription_execution_events available.`, 'Train accept/reject model for exercise ordering from execution partials.');
  } else if (workouts.length > 20) {
    add(24, 'telemetry', 'Sparse prescription_execution_events vs workout count.', 'Instrument set-level accept/reject in ActiveWorkout for engine closed-loop.');
  }

  add(25, 'ontology', 'Exercise names in logs should map to family keys for swap learning.', 'Audit top-10 user exercises for canonicalizeExerciseName parity (per prior ontology work).');

  return insights.slice(0, 25);
}

async function main() {
  const users = await findUser();
  if (!users.length) {
    console.error(JSON.stringify({ error: 'No user found', search }, null, 2));
    process.exit(1);
  }

  const reports = [];
  for (const u of users) {
    reports.push(await auditUser(u.id, u.email));
  }

  console.log(JSON.stringify({ search, userCount: users.length, reports }, null, 2));
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
