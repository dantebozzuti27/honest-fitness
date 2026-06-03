/**
 * Session-level telemetry from logged sets: rest, tonnage, density, aesthetic signals.
 * Fed into workout_outcomes notes + training_session_features on save.
 */

export interface SetTelemetryInput {
  weight?: number | string | null;
  reps?: number | string | null;
  time_seconds?: number | string | null;
  is_warmup?: boolean;
  logged_at?: string | null;
  rest_seconds_before?: number | null;
  prescribed_rest_seconds?: number | null;
  rest_seconds_actual?: number | null;
  set_rpe?: number | null;
  actual_rir?: number | null;
}

export interface ExerciseTelemetryInput {
  name: string;
  bodyPart?: string | null;
  category?: string | null;
  sets: SetTelemetryInput[];
  _prescription?: { restSeconds?: number; targetRir?: number };
}

export interface SessionTelemetryResult {
  featureVersion: string;
  setCount: number;
  workingSetCount: number;
  tonnage: number;
  totalRestSeconds: number;
  totalPrescribedRestSeconds: number;
  restComplianceRatio: number | null;
  medianRestSeconds: number | null;
  medianRestVsPrescribed: number | null;
  setsWithRestLogged: number;
  avgSetRpe: number | null;
  avgRir: number | null;
  sessionDensity: number | null;
  aestheticScore: number | null;
  goalSignals: {
    cutPhase: boolean;
    restRushed: boolean;
    restOverextended: boolean;
    volumeAdequate: boolean;
  };
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function median(a: number[]): number | null {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function buildSessionTelemetry(
  exercises: ExerciseTelemetryInput[],
  sessionDurationMinutes: number | null,
  trainingGoal: string | null = null,
): SessionTelemetryResult {
  let tonnage = 0;
  let workingSets = 0;
  let setCount = 0;
  const rests: number[] = [];
  const prescribedRests: number[] = [];
  const restRatios: number[] = [];
  const rpes: number[] = [];
  const rirs: number[] = [];

  for (const ex of exercises) {
    for (const s of ex.sets || []) {
      setCount += 1;
      if (s.is_warmup) continue;
      const w = num(s.weight);
      const r = num(s.reps);
      if (w && w > 0 && r && r > 0) {
        workingSets += 1;
        tonnage += w * r;
      }
      const actual = num(s.rest_seconds_actual) ?? num(s.rest_seconds_before);
      const prescribed = num(s.prescribed_rest_seconds) ?? num(ex._prescription?.restSeconds);
      if (actual != null && actual > 0) {
        rests.push(actual);
        if (prescribed != null && prescribed > 0) {
          prescribedRests.push(prescribed);
          restRatios.push(actual / prescribed);
        }
      }
      const rpe = num(s.set_rpe);
      if (rpe != null) rpes.push(rpe);
      const rir = num(s.actual_rir);
      if (rir != null) rirs.push(rir);
    }
  }

  const totalRestSeconds = rests.reduce((a, b) => a + b, 0);
  const totalPrescribedRestSeconds = prescribedRests.reduce((a, b) => a + b, 0);
  const medRest = median(rests);
  const medRatio = median(restRatios);
  const durationSec = sessionDurationMinutes != null ? sessionDurationMinutes * 60 : null;
  const workSeconds =
    durationSec != null && durationSec > totalRestSeconds
      ? durationSec - totalRestSeconds
      : null;
  const density =
    durationSec != null && durationSec > 0 ? tonnage / durationSec : null;

  const isCut = String(trainingGoal || '').toLowerCase().includes('cut') ||
    String(trainingGoal || '').toLowerCase().includes('fat');
  const restRushed = medRatio != null && medRatio < 0.75;
  const restOverextended = medRatio != null && medRatio > 1.35;
  const volumeAdequate = tonnage >= 40000;

  /** Behavioral physique signal — no manual RPE required. */
  let aestheticScore: number | null = null;
  if (workingSets >= 8) {
    let score = 0.45;
    if (volumeAdequate) score += 0.2;
    if (medRatio != null && medRatio >= 0.85 && medRatio <= 1.15) score += 0.25;
    if (density != null && density >= 45 && density <= 95) score += 0.1;
    if (isCut && tonnage > 25000 && tonnage < 100000) score += 0.05;
    aestheticScore = Math.min(1, Math.round(score * 1000) / 1000);
  }

  return {
    featureVersion: '2026-06-03.1',
    setCount,
    workingSetCount: workingSets,
    tonnage: Math.round(tonnage),
    totalRestSeconds: Math.round(totalRestSeconds),
    totalPrescribedRestSeconds: Math.round(totalPrescribedRestSeconds),
    restComplianceRatio:
      totalPrescribedRestSeconds > 0
        ? Math.round((totalRestSeconds / totalPrescribedRestSeconds) * 1000) / 1000
        : null,
    medianRestSeconds: medRest != null ? Math.round(medRest) : null,
    medianRestVsPrescribed: medRatio != null ? Math.round(medRatio * 1000) / 1000 : null,
    setsWithRestLogged: rests.length,
    avgSetRpe: rpes.length ? Math.round((rpes.reduce((a, b) => a + b, 0) / rpes.length) * 10) / 10 : null,
    avgRir: rirs.length ? Math.round((rirs.reduce((a, b) => a + b, 0) / rirs.length) * 10) / 10 : null,
    sessionDensity: density != null ? Math.round(density * 10) / 10 : null,
    aestheticScore,
    goalSignals: {
      cutPhase: isCut,
      restRushed,
      restOverextended,
      volumeAdequate,
    },
  };
}
