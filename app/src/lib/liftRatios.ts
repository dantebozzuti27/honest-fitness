/**
 * Lift ratio data and weight estimation for exercises the user has never performed.
 *
 * Estimates weights by:
 * 1. Checking if a known "anchor" lift (bench press, squat, or deadlift) exists
 *    in the user's data
 * 2. Applying research-based ratios to derive the unknown exercise's weight
 * 3. Falling back to P90 strength standards from strengthStandards.json
 *
 * Ratios compiled from:
 * - Symmetric Strength (symmetricstrength.com) — relative strength ratios
 * - ExRx.net — exercise standards & strength norms
 * - Eric Helms, "The Muscle & Strength Pyramids" — inter-lift proportions
 */

import strengthStandards from './strengthStandards.json';

/* ─────────────────────────── Types ─────────────────────────── */

export interface LiftRatio {
  anchor: 'bench' | 'squat' | 'deadlift';
  ratio: number;
  /** True for dumbbell movements where the ratio is per hand */
  isPerHand: boolean;
  source: string;
}

interface PercentileData {
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
}

interface WeightClassEntry {
  n: number;
  squat: PercentileData;
  bench: PercentileData;
  deadlift: PercentileData;
}

type StrengthStandardsData = Record<string, Record<string, WeightClassEntry>>;

const standards = strengthStandards as unknown as StrengthStandardsData;

/* ─────────────────────── Ratio Helpers ─────────────────────── */

const SOURCE = 'Symmetric Strength, ExRx.net, Helms';

function benchRatio(ratio: number, isPerHand = false): LiftRatio {
  return { anchor: 'bench', ratio, isPerHand, source: SOURCE };
}

function squatRatio(ratio: number, isPerHand = false): LiftRatio {
  return { anchor: 'squat', ratio, isPerHand, source: SOURCE };
}

function deadliftRatio(ratio: number, isPerHand = false): LiftRatio {
  return { anchor: 'deadlift', ratio, isPerHand, source: SOURCE };
}

/* ─────────────────────── Lift Ratios ──────────────────────── */

/**
 * Research-based lift ratios keyed by lowercase exercise name.
 * Multiple name variants map to the same ratio data so lookup is forgiving.
 *
 * Ratio semantics:
 * - `ratio` is multiplied by the anchor's known weight to estimate the target lift.
 * - When `isPerHand` is true the ratio yields the *per-hand* dumbbell weight.
 * - "Weighted" bodyweight movements (dips, pull-ups) express added load as a
 *   fraction of the anchor — bodyweight is NOT included in the result.
 */
export const LIFT_RATIOS: Record<string, LiftRatio> = {
  // ═══ From Bench Press ═══════════════════════════════════════
  'incline barbell press':            benchRatio(0.80),
  'incline bench press':              benchRatio(0.80),
  'incline barbell bench press':      benchRatio(0.80),
  'decline barbell press':            benchRatio(1.07),
  'decline bench press':              benchRatio(1.07),
  'decline barbell bench press':      benchRatio(1.07),
  'dumbbell bench press':             benchRatio(0.42, true),
  'dumbbell flat bench press':        benchRatio(0.42, true),
  'flat dumbbell press':              benchRatio(0.42, true),
  'incline dumbbell press':           benchRatio(0.37, true),
  'incline dumbbell bench press':     benchRatio(0.37, true),
  'close-grip bench press':           benchRatio(0.87),
  'close grip bench press':           benchRatio(0.87),
  'overhead press':                   benchRatio(0.65),
  'military press':                   benchRatio(0.65),
  'barbell overhead press':           benchRatio(0.65),
  'standing overhead press':          benchRatio(0.65),
  'ohp':                              benchRatio(0.65),
  'dumbbell overhead press':          benchRatio(0.32, true),
  'seated dumbbell press':            benchRatio(0.32, true),
  'dumbbell shoulder press':          benchRatio(0.32, true),
  'skull crushers':                   benchRatio(0.30),
  'skull crusher':                    benchRatio(0.30),
  'lying tricep extension':           benchRatio(0.30),
  'tricep pushdown':                  benchRatio(0.35),
  'cable pushdown':                   benchRatio(0.35),
  'rope pushdown':                    benchRatio(0.35),
  'lateral raise':                    benchRatio(0.10, true),
  'dumbbell lateral raise':           benchRatio(0.10, true),
  'side lateral raise':               benchRatio(0.10, true),
  'chest fly':                        benchRatio(0.27, true),
  'dumbbell fly':                     benchRatio(0.27, true),
  'dumbbell chest fly':               benchRatio(0.27, true),
  'dumbbell flye':                    benchRatio(0.27, true),
  'cable crossover':                  benchRatio(0.22, true),
  'cable fly':                        benchRatio(0.22, true),
  'dips':                             benchRatio(0.20),
  'weighted dips':                    benchRatio(0.20),
  'chest dips':                       benchRatio(0.20),
  'tricep dips':                      benchRatio(0.20),

  // ═══ From Squat (Barbell Back Squat) ════════════════════════
  'front squat':                      squatRatio(0.82),
  'barbell front squat':              squatRatio(0.82),
  'leg press':                        squatRatio(1.75),
  'bulgarian split squat':            squatRatio(0.55, true),
  'lunges':                           squatRatio(0.45, true),
  'lunge':                            squatRatio(0.45, true),
  'walking lunges':                   squatRatio(0.45, true),
  'walking lunge':                    squatRatio(0.45, true),
  'dumbbell lunges':                  squatRatio(0.45, true),
  'leg extension':                    squatRatio(0.35),
  'leg extensions':                   squatRatio(0.35),
  'leg curl':                         squatRatio(0.30),
  'lying leg curl':                   squatRatio(0.30),
  'seated leg curl':                  squatRatio(0.30),
  'hamstring curl':                   squatRatio(0.30),
  'hip thrust':                       squatRatio(1.10),
  'barbell hip thrust':               squatRatio(1.10),
  'standing calf raise':              squatRatio(0.90),
  'calf raise':                       squatRatio(0.90),
  'seated calf raise':                squatRatio(0.70),
  'goblet squat':                     squatRatio(0.35),
  'hack squat':                       squatRatio(0.80),
  'machine hack squat':               squatRatio(0.80),
  'glute ham raise':                  squatRatio(0.0),
  'glute-ham raise':                  squatRatio(0.0),
  'ghr':                              squatRatio(0.0),
  'nordic curl':                      squatRatio(0.0),
  'nordic hamstring curl':            squatRatio(0.0),
  'reverse hyper':                    squatRatio(0.25),
  'reverse hyperextension':           squatRatio(0.25),
  'back extension':                   squatRatio(0.20),
  'hyperextension':                   squatRatio(0.20),
  'sissy squat':                      squatRatio(0.0),
  'pistol squat':                     squatRatio(0.0),
  'leg press machine':                squatRatio(1.75),
  'single leg press':                 squatRatio(0.90),
  'belt squat':                       squatRatio(0.75),
  'pendulum squat':                   squatRatio(0.70),
  'smith machine squat':              squatRatio(0.85),
  'adductor machine':                 squatRatio(0.30),
  'abductor machine':                 squatRatio(0.25),
  'hip adduction':                    squatRatio(0.30),
  'hip abduction':                    squatRatio(0.25),
  'glute kickback':                   squatRatio(0.15),
  'cable glute kickback':             squatRatio(0.15),
  'donkey calf raise':                squatRatio(0.60),

  // ═══ From Deadlift (Conventional Deadlift) ══════════════════
  'romanian deadlift':                deadliftRatio(0.70),
  'barbell romanian deadlift':        deadliftRatio(0.70),
  'rdl':                              deadliftRatio(0.70),
  'barbell row':                      deadliftRatio(0.55),
  'bent over row':                    deadliftRatio(0.55),
  'bent-over row':                    deadliftRatio(0.55),
  'bent over barbell row':            deadliftRatio(0.55),
  'lat pulldown':                     deadliftRatio(0.45),
  'cable lat pulldown':               deadliftRatio(0.45),
  'wide grip lat pulldown':           deadliftRatio(0.45),
  'dumbbell row':                     deadliftRatio(0.27, true),
  'single arm dumbbell row':          deadliftRatio(0.27, true),
  'one arm dumbbell row':             deadliftRatio(0.27, true),
  'cable row':                        deadliftRatio(0.50),
  'seated cable row':                 deadliftRatio(0.50),
  'seated row':                       deadliftRatio(0.50),
  't-bar row':                        deadliftRatio(0.55),
  't bar row':                        deadliftRatio(0.55),
  'pull-ups':                         deadliftRatio(0.12),
  'pull ups':                         deadliftRatio(0.12),
  'pullups':                          deadliftRatio(0.12),
  'weighted pull-ups':                deadliftRatio(0.12),
  'weighted pull ups':                deadliftRatio(0.12),
  'chin-ups':                         deadliftRatio(0.12),
  'chin ups':                         deadliftRatio(0.12),
  'pendlay row':                      deadliftRatio(0.50),
  'good morning':                     deadliftRatio(0.45),
  'good mornings':                    deadliftRatio(0.45),
  'barbell good morning':             deadliftRatio(0.45),
  'barbell shrug':                    deadliftRatio(0.65),
  'barbell shrugs':                   deadliftRatio(0.65),
  'shrugs':                           deadliftRatio(0.65),
  'shrug':                            deadliftRatio(0.65),
  'dumbbell shrug':                   deadliftRatio(0.30, true),
  'dumbbell shrugs':                  deadliftRatio(0.30, true),
  'face pull':                        deadliftRatio(0.20),
  'face pulls':                       deadliftRatio(0.20),
  'cable face pull':                  deadliftRatio(0.20),
  'straight arm pulldown':            deadliftRatio(0.25),
  'straight-arm pulldown':            deadliftRatio(0.25),
  'dumbbell pullover':                deadliftRatio(0.25, true),
  'pullover':                         deadliftRatio(0.25),
  'dumbbell curl':                    deadliftRatio(0.15, true),
  'barbell curl':                     deadliftRatio(0.30),
  'ez bar curl':                      deadliftRatio(0.28),
  'preacher curl':                    deadliftRatio(0.25),
  'hammer curl':                      deadliftRatio(0.15, true),
  'hammer curls':                     deadliftRatio(0.15, true),
  'concentration curl':               deadliftRatio(0.12, true),
  'cable curl':                       deadliftRatio(0.25),
  'cable bicep curl':                 deadliftRatio(0.25),
  'reverse curl':                     deadliftRatio(0.18),
  'wrist curl':                       deadliftRatio(0.12),
  'reverse wrist curl':               deadliftRatio(0.08),
  'rear delt fly':                    benchRatio(0.10, true),
  'reverse fly':                      benchRatio(0.10, true),
  'rear delt raise':                  benchRatio(0.10, true),
  'cable lateral raise':              benchRatio(0.08),
  'front raise':                      benchRatio(0.10, true),
  'dumbbell front raise':             benchRatio(0.10, true),
  'cable tricep extension':           benchRatio(0.30),
  'overhead tricep extension':        benchRatio(0.25),
  'tricep kickback':                  benchRatio(0.10, true),
  'machine chest press':              benchRatio(0.75),
  'machine shoulder press':           benchRatio(0.55),
  'smith machine bench press':        benchRatio(0.90),
  'chest press':                      benchRatio(0.75),
  'pec deck':                         benchRatio(0.35),
  'machine fly':                      benchRatio(0.35),
  'pec fly':                          benchRatio(0.35),
};

/* ────────────────── Big-3 Identification ──────────────────── */

/**
 * Canonical names for the three anchor lifts so we can recognise when the
 * requested exercise IS one of them (no ratio needed — return the known
 * weight or P90 directly).
 */
const BIG_THREE_ALIASES: Record<string, 'bench' | 'squat' | 'deadlift'> = {
  'bench press':              'bench',
  'barbell bench press':      'bench',
  'flat bench press':         'bench',
  'flat barbell bench press': 'bench',
  'squat':                    'squat',
  'back squat':               'squat',
  'barbell back squat':       'squat',
  'barbell squat':            'squat',
  'deadlift':                 'deadlift',
  'conventional deadlift':    'deadlift',
  'barbell deadlift':         'deadlift',
};

/* ─────────── Keyword → Anchor (muscle-group fallback) ─────── */

const LEG_KEYWORDS = [
  'squat', 'leg', 'lunge', 'calf', 'quad', 'glute',
  'hip thrust', 'step-up', 'step up', 'split squat',
];
const PULL_KEYWORDS = [
  'row', 'pull', 'lat ', 'deadlift', 'shrug',
  'good morning', 'chin', 'bicep', 'curl',
];
const PUSH_KEYWORDS = [
  'press', 'chest', 'tricep', 'pec', 'fly',
  'dip', 'pushdown', 'crossover', 'shoulder',
];

/**
 * Best-effort anchor guess from exercise name keywords.
 * Checked in order: legs → pull → push so that compound names like
 * "leg press" resolve to squat (legs) rather than bench (push).
 */
function guessAnchor(name: string): 'bench' | 'squat' | 'deadlift' | null {
  for (const kw of LEG_KEYWORDS) if (name.includes(kw)) return 'squat';
  for (const kw of PULL_KEYWORDS) if (name.includes(kw)) return 'deadlift';
  for (const kw of PUSH_KEYWORDS) if (name.includes(kw)) return 'bench';
  return null;
}

/* ──────────────── Gender Key Normalization ─────────────────── */

function normalizeGender(gender: string): string | null {
  const g = gender.toLowerCase().trim();
  if (g === 'm' || g === 'male' || g === 'man') return 'M';
  if (g === 'f' || g === 'female' || g === 'woman') return 'F';
  return null;
}

/* ──────────────────── Internal Helpers ─────────────────────── */

/**
 * Look up a ratio from {@link LIFT_RATIOS}.
 * Tries an exact key match first, then checks whether the normalised exercise
 * name *contains* any known key (longest keys are checked implicitly via
 * insertion order, but any hit is returned immediately).
 */
function findRatio(name: string): LiftRatio | null {
  if (LIFT_RATIOS[name]) return LIFT_RATIOS[name];

  for (const key of Object.keys(LIFT_RATIOS)) {
    if (name.includes(key)) return LIFT_RATIOS[key];
  }

  return null;
}

/**
 * Retrieve the P90 value for a given anchor lift from strength standards.
 */
function getP90FromStandards(
  anchor: 'bench' | 'squat' | 'deadlift',
  bodyWeightLbs: number | null,
  gender: string | null,
): number | null {
  if (bodyWeightLbs === null || gender === null) return null;
  const entry = findClosestWeightClass(bodyWeightLbs, gender);
  if (!entry) return null;
  return entry[anchor]?.p90 ?? null;
}

/* ──────────────────── Exported Functions ───────────────────── */

/**
 * Find the strength-standard entry for the weight class closest to the
 * given body weight.
 *
 * @param bodyWeightLbs - Body weight in pounds
 * @param gender - Gender string: "M", "male", "F", "female", etc.
 * @returns The weight-class entry with P25–P95 percentiles for bench / squat /
 *          deadlift, or `null` if gender is unrecognised or no data exists.
 */
export function findClosestWeightClass(
  bodyWeightLbs: number,
  gender: string,
): WeightClassEntry | null {
  const genderKey = normalizeGender(gender);
  if (!genderKey) return null;

  const classes = standards[genderKey];
  if (!classes) return null;

  const weights = Object.keys(classes)
    .map(Number)
    .filter((n) => !isNaN(n))
    .sort((a, b) => a - b);
  if (weights.length === 0) return null;

  let closest = weights[0];
  let minDiff = Math.abs(bodyWeightLbs - closest);

  for (const w of weights) {
    const diff = Math.abs(bodyWeightLbs - w);
    if (diff < minDiff) {
      minDiff = diff;
      closest = w;
    }
  }

  return classes[String(closest)] ?? null;
}

/**
 * Estimate a working weight (in lbs) for an exercise the user has never
 * performed.
 *
 * Resolution order:
 * 1. If the exercise **is** one of the big-3 lifts, return the user's known
 *    weight or the P90 strength standard for their weight class.
 * 2. If a ratio exists in {@link LIFT_RATIOS}, multiply the known anchor
 *    weight (or P90 anchor fallback) by the ratio.
 * 3. If the exercise name contains keywords mapping it to a muscle group,
 *    return the P90 of the corresponding big-3 lift as a rough ceiling.
 * 4. Return `null` rather than guessing wildly.
 *
 * @param exerciseName - Display name of the exercise (case-insensitive)
 * @param knownLifts   - User's known weights for the three anchor lifts
 * @param bodyWeightLbs - User's body weight in lbs (used for standard lookup)
 * @param gender        - "M" / "male" / "F" / "female" (used for standard lookup)
 * @returns Estimated weight in lbs (rounded to nearest integer), or `null`
 */
export function estimateWeight(
  exerciseName: string,
  knownLifts: { bench: number | null; squat: number | null; deadlift: number | null },
  bodyWeightLbs: number | null,
  gender: string | null,
): number | null {
  const name = exerciseName.toLowerCase().trim();

  // 1. Direct big-3 match — no ratio needed
  const directAnchor = BIG_THREE_ALIASES[name];
  if (directAnchor) {
    const known = knownLifts[directAnchor];
    if (known !== null) return Math.round(known);
    return getP90FromStandards(directAnchor, bodyWeightLbs, gender);
  }

  // 2. Ratio-based estimation
  const ratio = findRatio(name);
  if (ratio) {
    const anchorWeight = knownLifts[ratio.anchor];
    if (anchorWeight !== null) {
      return Math.round(anchorWeight * ratio.ratio);
    }
    const p90Anchor = getP90FromStandards(ratio.anchor, bodyWeightLbs, gender);
    if (p90Anchor !== null) {
      return Math.round(p90Anchor * ratio.ratio);
    }
    return null;
  }

  // 3. Keyword-based muscle-group fallback — apply a conservative fraction of
  // the anchor P90. Never return the full compound P90 for an unknown accessory.
  const guessedAnchor = guessAnchor(name);
  if (guessedAnchor) {
    const p90 = getP90FromStandards(guessedAnchor, bodyWeightLbs, gender);
    if (p90 !== null) {
      // Unknown exercises get 30% of the anchor P90 — safe for most accessories/machines.
      // This is deliberately conservative: first real session overrides this estimate.
      return Math.round(p90 * 0.30);
    }
  }

  return null;
}
