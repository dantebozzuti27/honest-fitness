/**
 * LLM pattern_observation lifecycle: dedupe, behavioral verification, engine hints.
 * No user forms — patterns must match logged behavior to influence the engine.
 */

import type { TrainingProfile } from './trainingAnalysis';

export type PatternCategory =
  | 'volume_mrv'
  | 'swap_preference'
  | 'exercise_gap'
  | 'session_duration'
  | 'recovery'
  | 'redundancy'
  | 'other';

export interface RawPatternObservation {
  pattern?: string;
  suggestion?: string;
  confidence?: string;
}

export interface AggregatedPattern {
  patternKey: string;
  pattern: string;
  suggestion: string;
  confidence: 'high' | 'medium' | 'low';
  occurrenceCount: number;
  evidenceScore: number;
  autoVerified: boolean;
  evidence: string[];
  category: PatternCategory;
  lastSeen: string | null;
}

export interface PatternInsertRow {
  user_id: string;
  feedback_type: 'pattern_observation';
  feedback_data: RawPatternObservation & {
    pattern_key: string;
    category: PatternCategory;
    evidence_score: number;
    auto_verified: boolean;
    evidence: string[];
  };
  feedback_source: 'model_review';
  feedback_quality: 'trusted' | 'unverified';
  verified_by_user: boolean;
  workout_date: string;
}

const PATTERN_STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'to', 'for', 'of', 'in', 'on', 'with', 'at', 'by', 'from',
  'user', 'lifter', 'athlete', 'often', 'frequently', 'consistently', 'typically', 'generally',
  'usually', 'appears', 'seems', 'may', 'might', 'could', 'should', 'that', 'this', 'these',
  'trains', 'training', 'trained',
  'those', 'been', 'being', 'have', 'has', 'had', 'is', 'are', 'was', 'were',
]);

function normalizeSemanticPhrases(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/\b(above|over|exceeds?)\s+mrv\b/g, ' highvol ')
    .replace(/\bhigh\s+volume\b/g, ' highvol ')
    .replace(/\b(reduce|lower|decrease|cut)\b/g, ' reduce ')
    .replace(/\b(mesocycle|microcycle|block|phase|weeks?|months?|days?|several|many)\b/g, ' period ')
    .replace(/\b(sets?|volume)\b/g, ' vol ')
    .replace(/\b(next|upcoming|following)\b/g, ' next ');
}

function tokenFingerprint(text: string, maxLen: number): string {
  const tokens = normalizeSemanticPhrases(text)
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(user|lifter|athlete)\b/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !PATTERN_STOP_WORDS.has(w))
    .sort();
  return [...new Set(tokens)].join(' ').slice(0, maxLen);
}

/** Semantic key — merges paraphrased LLM pattern spam (category + muscles + intent bag). */
export function patternKey(pattern: string, suggestion: string = ''): string {
  const combined = `${pattern} ${suggestion}`.trim();
  const category = classifyPattern(combined);
  const muscles = muscleMentioned(combined).sort().join('+') || '_';
  const intent = tokenFingerprint(combined, 96);
  return `${category}::${muscles}::${intent}`;
}

function classifyPattern(text: string): PatternCategory {
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

function muscleMentioned(text: string): string[] {
  const t = text.toLowerCase();
  const tokens = [
    'triceps', 'biceps', 'chest', 'back', 'lats', 'back_lats', 'quadriceps', 'hamstrings',
    'glutes', 'calves', 'forearms', 'shoulders', 'delts', 'anterior deltoids', 'upper chest',
    'mid chest', 'core', 'abs',
  ];
  return tokens.filter((m) => t.includes(m.replace(/_/g, ' ')) || t.includes(m));
}

/**
 * Score 0–1: does this LLM pattern match observable profile data?
 */
export function verifyPatternAgainstProfile(
  obs: RawPatternObservation,
  profile: TrainingProfile,
): { evidenceScore: number; evidence: string[]; autoVerified: boolean } {
  const pattern = String(obs.pattern ?? '');
  const suggestion = String(obs.suggestion ?? '');
  const text = `${pattern} ${suggestion}`.toLowerCase();
  const evidence: string[] = [];
  let score = 0.15;

  const muscles = muscleMentioned(text);
  const volStatuses = profile.muscleVolumeStatuses ?? [];

  if (text.includes('mrv') || text.includes('above') || text.includes('exceed')) {
    for (const m of muscles) {
      const hit = volStatuses.find(
        (v) =>
          v.muscleGroup.includes(m.replace(/\s/g, '_')) ||
          v.muscleGroup.includes(m) ||
          text.includes(v.muscleGroup.replace(/_/g, ' ')),
      );
      if (hit?.status === 'above_mrv' || hit?.status === 'approaching_mrv') {
        score += 0.35;
        evidence.push(`${hit.muscleGroup} at ${hit.status} (${hit.weeklyDirectSets} sets/wk)`);
      }
    }
  }

  if (text.includes('triceps') || text.includes('biceps') || text.includes('arms')) {
    const armsFreq =
      (profile.muscleGroupFrequency as Record<string, number> | undefined)?.triceps ??
      (profile.muscleGroupFrequency as Record<string, number> | undefined)?.biceps;
    if (armsFreq != null && armsFreq >= 2) {
      score += 0.25;
      evidence.push(`High arm frequency in logs (${armsFreq} sessions/wk)`);
    }
  }

  if (text.includes('swap') || text.includes('replace')) {
    const swaps = profile.exerciseSwapHistory ?? [];
    if (swaps.length >= 3) {
      score += 0.3;
      evidence.push(`${swaps.length} logged swap events`);
    }
  }

  if (text.includes('unilateral') || text.includes('lunge') || text.includes('split squat')) {
    const prefs = profile.exercisePreferences ?? [];
    const hasUni = prefs.some((p) =>
      /lunge|split squat|single.?leg|bulgarian|step.?up/i.test(p.exerciseName ?? ''),
    );
    if (!hasUni && (profile.totalWorkoutCount ?? 0) >= 10) {
      score += 0.35;
      evidence.push('No unilateral leg exercises in preference history');
    } else if (hasUni) {
      score -= 0.2;
      evidence.push('Unilateral work present in history — pattern may be stale');
    }
  }

  if (text.includes('calf') || text.includes('calves')) {
    const calf = volStatuses.find((v) => v.muscleGroup === 'calves');
    if (calf && (calf.weeklyDirectSets < 4 || calf.status === 'below_mev')) {
      score += 0.3;
      evidence.push(`Calves ${calf.weeklyDirectSets} direct sets/wk (${calf.status})`);
    }
  }

  if (text.includes('duration') || text.includes('minutes')) {
    const avg = profile.avgSessionDuration;
    if (avg > 0) {
      if (text.includes('lower') && avg < 95) {
        score += 0.25;
        evidence.push(`Observed median session ${avg} min`);
      }
      if (text.includes('120') && avg < 100) {
        score += 0.2;
        evidence.push(`Budget vs actual gap (median ${avg} min)`);
      }
    }
  }

  if (text.includes('sleep') || text.includes('recovery')) {
    const debtH = profile.cumulativeSleepDebt?.sleepDebt7d;
    if (debtH != null && debtH > 2) {
      score += 0.25;
      evidence.push(`Cumulative sleep debt ${debtH}h`);
    }
  }

  const conf = String(obs.confidence ?? 'medium').toLowerCase();
  if (conf === 'high') score += 0.05;

  score = Math.max(0, Math.min(1, score));
  const autoVerified = score >= 0.55 && evidence.length >= 1;
  return {
    evidenceScore: Math.round(score * 1000) / 1000,
    evidence,
    autoVerified,
  };
}

/** Collapse thousands of duplicate LLM rows into a small trusted catalog. */
export function aggregatePatternObservations(
  rows: Array<{ feedback_data: RawPatternObservation; created_at?: string }>,
  profile: TrainingProfile,
  opts: { maxPatterns?: number; minOccurrences?: number } = {},
): AggregatedPattern[] {
  const maxPatterns = opts.maxPatterns ?? 12;
  const minOccurrences = opts.minOccurrences ?? 2;
  const byKey = new Map<string, AggregatedPattern & { _lastSeenRaw?: string }>();

  for (const row of rows) {
    const d = row.feedback_data;
    if (!d?.pattern || typeof d.pattern !== 'string') continue;
    const key = patternKey(d.pattern, d.suggestion ?? '');
    const existing = byKey.get(key);
    if (existing) {
      existing.occurrenceCount += 1;
      if (row.created_at && (!existing._lastSeenRaw || row.created_at > existing._lastSeenRaw)) {
        existing._lastSeenRaw = row.created_at;
        existing.lastSeen = row.created_at;
      }
      continue;
    }
    const v = verifyPatternAgainstProfile(d, profile);
    byKey.set(key, {
      patternKey: key,
      pattern: d.pattern,
      suggestion: String(d.suggestion ?? ''),
      confidence: (['high', 'medium', 'low'].includes(String(d.confidence)) ? d.confidence : 'medium') as AggregatedPattern['confidence'],
      occurrenceCount: 1,
      evidenceScore: v.evidenceScore,
      autoVerified: v.autoVerified,
      evidence: v.evidence,
      category: classifyPattern(`${d.pattern} ${d.suggestion}`),
      lastSeen: row.created_at ?? null,
      _lastSeenRaw: row.created_at,
    });
  }

  return [...byKey.values()]
    .filter((p) => p.occurrenceCount >= minOccurrences || p.autoVerified)
    .sort((a, b) => {
      const scoreA = a.evidenceScore * 2 + Math.log1p(a.occurrenceCount) + (a.autoVerified ? 1 : 0);
      const scoreB = b.evidenceScore * 2 + Math.log1p(b.occurrenceCount) + (b.autoVerified ? 1 : 0);
      return scoreB - scoreA;
    })
    .slice(0, maxPatterns)
    .map(({ _lastSeenRaw, ...rest }) => rest);
}

/** Patterns the engine may use (behaviorally verified only). */
export function patternsForEngine(aggregated: AggregatedPattern[]): Array<{
  pattern: string;
  suggestion: string;
  confidence: string;
}> {
  return aggregated
    .filter((p) => p.autoVerified && p.evidenceScore >= 0.5)
    .map((p) => ({
      pattern: p.pattern,
      suggestion: p.suggestion,
      confidence: p.confidence,
    }));
}

/** Dedupe before writing to model_feedback — stops 1k+ duplicate rows. */
export function preparePatternRowsForInsert(
  userId: string,
  workoutDate: string,
  observations: RawPatternObservation[],
  existingKeys: Set<string>,
  profile?: TrainingProfile | null,
): PatternInsertRow[] {
  const out: PatternInsertRow[] = [];
  for (const obs of observations) {
    if (!obs?.pattern) continue;
    const key = patternKey(obs.pattern, obs.suggestion ?? '');
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);

    const v = profile
      ? verifyPatternAgainstProfile(obs, profile)
      : { evidenceScore: 0.2, evidence: [] as string[], autoVerified: false };

    out.push({
      user_id: userId,
      feedback_type: 'pattern_observation',
      feedback_data: {
        ...obs,
        pattern_key: key,
        category: classifyPattern(`${obs.pattern} ${obs.suggestion}`),
        evidence_score: v.evidenceScore,
        auto_verified: v.autoVerified,
        evidence: v.evidence,
      },
      feedback_source: 'model_review',
      feedback_quality: v.autoVerified ? 'trusted' : 'unverified',
      verified_by_user: false,
      workout_date: workoutDate,
    });
  }
  return out;
}
