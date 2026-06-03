/**
 * Strength science layer: robust e1RM, prescription bias, volume anomalies.
 * Uses observational data only — no black-box model required for n≈100 sessions.
 */

const MAX_REPS_FOR_E1RM = 12;

export function epley1RMWithRir(weight, reps, rir = 1) {
  if (!weight || !reps) return 0;
  const cappedReps = Math.min(MAX_REPS_FOR_E1RM, Math.max(1, Math.round(reps)));
  const adjustedRir = rir == null ? 1 : Math.max(0, Math.min(4, rir));
  const effectiveReps = cappedReps + adjustedRir;
  if (effectiveReps === 1) return weight;
  return weight * (1 + effectiveReps / 30);
}

export function naiveEpley(weight, reps) {
  if (!weight || !reps) return 0;
  return reps === 1 ? weight : weight * (1 + reps / 30);
}

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

export function robustSessionBestE1rm(sets) {
  const est = [];
  for (const s of sets) {
    const w = Number(s.weight) || 0;
    const reps = Number(s.reps) || 0;
    if (w <= 0 || reps < 1 || reps > 20) continue;
    let rir = 1;
    if (s.actual_rir != null) rir = Number(s.actual_rir);
    else if (s.set_rpe != null) rir = Math.max(0, 10 - Number(s.set_rpe));
    est.push({ e1rm: epley1RMWithRir(w, reps, rir), weight: w, reps });
  }
  if (!est.length) return null;
  est.sort((a, b) => a.e1rm - b.e1rm);
  const top = est[est.length - 1];
  const second = est.length >= 2 ? est[est.length - 2] : null;
  if (second && top.e1rm > second.e1rm * 1.12) return second;
  return top;
}

/**
 * Per-exercise e1RM inflation: naive session max vs robust session best.
 */
export function analyzeE1rmInflation(workouts) {
  const byExercise = new Map();
  for (const w of workouts || []) {
    for (const ex of w.workout_exercises || []) {
      if (!ex.exercise_name) continue;
      const key = ex.exercise_name.trim().toLowerCase();
      if (!byExercise.has(key)) {
        byExercise.set(key, { name: ex.exercise_name, sessions: [] });
      }
      const sets = (ex.workout_sets || []).filter((s) => !s.is_warmup);
      if (!sets.length) continue;
      const robust = robustSessionBestE1rm(sets);
      let naiveMax = 0;
      for (const s of sets) {
        const e = naiveEpley(Number(s.weight), Number(s.reps));
        if (e > naiveMax) naiveMax = e;
      }
      if (robust) {
        byExercise.get(key).sessions.push({
          date: w.date,
          robust: robust.e1rm,
          naive: naiveMax,
        });
      }
    }
  }

  const inflated = [];
  for (const [, ex] of byExercise) {
    if (ex.sessions.length < 3) continue;
    const naivePeak = Math.max(...ex.sessions.map((s) => s.naive));
    const robustPeak = Math.max(...ex.sessions.map((s) => s.robust));
    if (robustPeak <= 0) continue;
    const inflationPct = ((naivePeak - robustPeak) / robustPeak) * 100;
    if (inflationPct >= 5) {
      inflated.push({
        exercise: ex.name,
        sessions: ex.sessions.length,
        naiveMaxE1rm: Math.round(naivePeak),
        robustMaxE1rm: Math.round(robustPeak),
        inflationPct: Math.round(inflationPct * 10) / 10,
      });
    }
  }
  inflated.sort((a, b) => b.inflationPct - a.inflationPct);
  return {
    exercisesAnalyzed: byExercise.size,
    inflatedExercises: inflated.slice(0, 15),
    maxInflation: inflated[0] || null,
    recommendation: inflated.length
      ? 'Use RIR-corrected session-best e1RM; cap vs rolling median for capacity updates.'
      : null,
  };
}

/**
 * Prescription execution bias from prescription_execution_events rows.
 */
export function analyzePrescriptionBias(executionEvents) {
  const rows = (executionEvents || []).filter(
    (e) => e.target_weight > 0 && e.actual_weight > 0 && e.target_reps > 0 && e.actual_reps > 0,
  );
  if (!rows.length) {
    return { count: 0, abstain: true, reason: 'Insufficient linked execution events' };
  }
  const weightBiasPct = rows.map(
    (e) => ((e.actual_weight - e.target_weight) / e.target_weight) * 100,
  );
  const repBias = rows.map((e) => e.actual_reps - e.target_reps);
  const acc = rows.map((e) => Number(e.execution_accuracy)).filter(Number.isFinite);

  const byExercise = new Map();
  for (const e of rows) {
    const k = (e.exercise_name || '').toLowerCase();
    if (!byExercise.has(k)) byExercise.set(k, []);
    byExercise.get(k).push(e);
  }

  const perExercise = [...byExercise.entries()]
    .map(([, arr]) => {
      const bias = arr.reduce((s, e) => s + (e.actual_weight - e.target_weight), 0) / arr.length;
      return {
        exercise: arr[0].exercise_name,
        sets: arr.length,
        meanWeightBiasLbs: Math.round(bias * 10) / 10,
      };
    })
    .filter((x) => x.sets >= 3)
    .sort((a, b) => Math.abs(b.meanWeightBiasLbs) - Math.abs(a.meanWeightBiasLbs))
    .slice(0, 10);

  return {
    count: rows.length,
    abstain: false,
    medianWeightBiasPct: Math.round(median(weightBiasPct) * 10) / 10,
    medianRepBias: median(repBias),
    medianExecutionAccuracy: median(acc),
    undershootRatePct: Math.round(
      (100 * weightBiasPct.filter((x) => x < -5).length) / weightBiasPct.length,
    ),
    overshootRatePct: Math.round(
      (100 * weightBiasPct.filter((x) => x > 5).length) / weightBiasPct.length,
    ),
    perExerciseCalibration: perExercise,
    recommendation:
      median(weightBiasPct) < -3
        ? 'Systematic undershoot — reduce conservative bias in prescriptionController.'
        : median(weightBiasPct) > 3
          ? 'Systematic overshoot — tighten load caps.'
          : 'Prescription load aligned with execution; refine per-exercise outliers.',
  };
}

/**
 * MAD-based volume anomaly on weekly tonnage series.
 */
export function detectVolumeAnomalies(workouts) {
  const weekTonnage = new Map();
  for (const w of workouts || []) {
    const dateVal = w.date;
    const raw = dateVal instanceof Date ? dateVal.toISOString() : String(dateVal);
    const d = new Date(`${raw.slice(0, 10)}T12:00:00`);
    if (Number.isNaN(d.getTime())) continue;
    const dow = d.getDay();
    const mon = new Date(d);
    mon.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
    const wk = mon.toISOString().slice(0, 10);
    let ton = 0;
    for (const ex of w.workout_exercises || []) {
      for (const s of ex.workout_sets || []) {
        const wt = Number(s.weight) || 0;
        const reps = Number(s.reps) || 0;
        if (wt > 0 && reps > 0) ton += wt * reps;
      }
    }
    weekTonnage.set(wk, (weekTonnage.get(wk) || 0) + ton);
  }
  const series = [...weekTonnage.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const values = series.map(([, v]) => v);
  if (values.length < 4) return { anomalies: [], weeklyTonnage: series.slice(-8) };

  const med = median(values);
  const m = mad(values, med);
  const anomalies = [];
  const latest = series[series.length - 1];
  if (m > 0 && latest) {
    const z = (latest[1] - med) / m;
    if (z > 2.5) {
      anomalies.push({
        type: 'volume',
        severity: 'warning',
        message: `Week ${latest[0]} tonnage ${Math.round(latest[1])} is ${Math.round(z * 10) / 10} MAD above median — deload risk`,
        data: { week: latest[0], tonnage: latest[1], median: med, mad: m },
      });
    } else if (z < -2) {
      anomalies.push({
        type: 'volume',
        severity: 'info',
        message: `Week ${latest[0]} tonnage unusually low vs your baseline`,
        data: { week: latest[0], tonnage: latest[1], median: med },
      });
    }
  }
  return { anomalies, weeklyTonnage: series.slice(-12), medianWeeklyTonnage: med };
}

/**
 * Detect bidirectional swap oscillation from swap log.
 */
export function detectSwapOscillation(swaps) {
  const edgeCount = new Map();
  for (const s of swaps || []) {
    const from = (s.exercise_name || '').toLowerCase().trim();
    const to = (s.replacement_exercise_name || '').toLowerCase().trim();
    if (!from || !to) continue;
    const key = `${from}→${to}`;
    edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
  }
  const oscillations = [];
  const seen = new Set();
  for (const [edge, count] of edgeCount) {
    const [a, b] = edge.split('→');
    const pairKey = [a, b].sort().join('|');
    if (seen.has(pairKey)) continue;
    const rev = edgeCount.get(`${b}→${a}`) || 0;
    if (rev > 0 && count + rev >= 4) {
      seen.add(pairKey);
      oscillations.push({ pair: `${a}↔${b}`, forward: count, reverse: rev, total: count + rev });
    }
  }
  oscillations.sort((a, b) => b.total - a.total);
  return {
    oscillationPairs: oscillations.slice(0, 10),
    recommendation: oscillations.length
      ? 'Apply cooldown on reverse swap edges; boost staple families user keeps removing.'
      : null,
  };
}
