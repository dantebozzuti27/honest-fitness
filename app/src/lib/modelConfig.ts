/**
 * Central configuration for all workout engine thresholds and sensitivities.
 *
 * Every decision boundary in the engine reads from this config instead of
 * using hardcoded literals. Defaults are evidence-based starting points;
 * individual values can be overridden per-user and will eventually be
 * learned from data.
 */

export interface ModelConfig {
  // ── Recovery Thresholds ──────────────────────────────────────────────
  /** Sleep ratio below which volume is reduced (fraction of 30d baseline) */
  sleepReductionThreshold: number;
  /** Max volume reduction from poor sleep (0-1, where 0.3 = max 30% cut) */
  sleepMaxReduction: number;
  /** HRV ratio below which volume is reduced */
  hrvReductionThreshold: number;
  /** Volume multiplier when HRV is below threshold */
  hrvVolumeMultiplier: number;
  /** RHR ratio above which volume is reduced */
  rhrElevationThreshold: number;
  /** Volume multiplier when RHR is elevated */
  rhrVolumeMultiplier: number;
  /** Recovery % at which a muscle is "ready to train" */
  muscleReadyThreshold: number;
  /** Minimum volume multiplier floor (never reduce below this) */
  volumeMultiplierFloor: number;
  /** Sleep debt recovery modifier weight (how much cumulative debt affects capacity) */
  sleepDebtWeight: number;

  // ── Deload ───────────────────────────────────────────────────────────
  /** Deload volume multiplier (fraction of normal) */
  deloadVolumeMultiplier: number;
  /** Deload weight multiplier (fraction of working weight) */
  deloadWeightMultiplier: number;
  /** Deload cardio duration multiplier */
  deloadCardioDurationMultiplier: number;
  /** Deload cardio intensity multiplier */
  deloadCardioIntensityMultiplier: number;

  // ── Progressive Overload ─────────────────────────────────────────────
  /** Reps above target that triggers a weight increase */
  repsAboveTargetForProgression: number;
  /** Weight reduction on regression (fraction, e.g. 0.92 = drop to 92%) */
  regressionWeightMultiplier: number;
  /** Sleep-performance coefficient threshold (learned coeff must exceed this to apply) */
  sleepCoefficientMinimum: number;
  /** Sleep delta threshold below which sleep-performance adjustment kicks in */
  sleepDeltaThreshold: number;
  /** Barbell compound increment (lbs) */
  barbellIncrement: number;
  /** Dumbbell increment (lbs per hand) */
  dumbbellIncrement: number;
  /** Machine/cable increment (lbs) */
  machineIncrement: number;
  /** Isolation exercise increment (lbs) — smaller to avoid big % jumps on light weights */
  isolationIncrement: number;
  /** Maximum % jump allowed per session (caps absolute increment) */
  maxProgressionPct: number;

  // ── Exercise Selection ───────────────────────────────────────────────
  /** Score penalty for exercises never used */
  neverUsedPenalty: number;
  /** Push:pull ratio threshold for auto-corrective insertion */
  pushPullCorrectionThreshold: number;
  /** Corrective sets to insert when push:pull is imbalanced */
  correctiveSetsCount: number;
  /** Minimum data points for time-of-day effect to influence decisions */
  timeOfDayMinDataPoints: number;
  /** Performance delta threshold for time-of-day warning */
  timeOfDayDeltaThreshold: number;
  /** Minimum data points for consecutive days effect */
  consecutiveDaysMinDataPoints: number;

  // ── Exercise Rotation ────────────────────────────────────────────────
  /** Score penalty for exercises flagged for rotation */
  rotationPenalty: number;
  /** Whether to enforce rotation suggestions in exercise selection */
  enforceRotation: boolean;

  // ── Cardio-Strength Interference ─────────────────────────────────────
  /** MRV reduction per weekly hour of high-impact cardio (%) */
  highImpactCardioInterferencePct: number;
  /** MRV reduction per weekly hour of low-impact cardio (%) */
  lowImpactCardioInterferencePct: number;
  /** Maximum interference cap (%) */
  maxCardioInterferencePct: number;

  // ── Session Fatigue ──────────────────────────────────────────────────
  /** If session fatigue effect at a given time bucket exceeds this, cap session length */
  sessionFatigueThreshold: number;
  /** Minimum data points for session fatigue to be actionable */
  sessionFatigueMinDataPoints: number;

  // ── Steps/NEAT ───────────────────────────────────────────────────────
  /** Steps correlation coefficient below which it affects volume */
  stepsCorrelationThreshold: number;
  /** Volume reduction when high-step day + strong negative correlation */
  stepsVolumeReduction: number;
  /** Minimum data points for steps correlation to be actionable */
  stepsMinDataPoints: number;

  // ── Time Budget ──────────────────────────────────────────────────────
  /** Minimum exercises to keep even under time pressure */
  minExercisesUnderTimePressure: number;
  /** Minimum strength budget minutes (absolute floor) */
  minStrengthBudgetMinutes: number;

  // ── Muscle Group Selection ───────────────────────────────────────────
  /** Split match priority boost */
  splitMatchBoost: number;
  /** Day-of-week pattern priority boost */
  dayPatternBoost: number;
  /** Priority muscle boost */
  priorityMuscleBoost: number;
  /** Split detection confidence threshold */
  splitConfidenceThreshold: number;

  // ── 30-Day Trend Sensitivities ─────────────────────────────────────────
  /** Sleep trending down: slope% threshold to trigger proactive volume cut */
  sleepTrendDownThreshold: number;
  /** Volume reduction when sleep is trending down (before single-night crash) */
  sleepTrendVolumeReduction: number;
  /** HRV trending down: slope% threshold for proactive adjustment */
  hrvTrendDownThreshold: number;
  /** Volume reduction when HRV trend is declining */
  hrvTrendVolumeReduction: number;
  /** RHR trending up: slope% threshold */
  rhrTrendUpThreshold: number;
  /** Volume reduction when RHR trend is rising */
  rhrTrendVolumeReduction: number;
  /** Training frequency trending up: slope% threshold for overreach warning */
  frequencyTrendUpThreshold: number;
  /** Per-session volume reduction when frequency is spiking */
  frequencyTrendVolumeReduction: number;
  /** Minimum data points for trends to be actionable */
  trendMinDataPoints: number;

  // ── Experience Level Scaling ─────────────────────────────────────────
  /** Volume multiplier for beginners (fewer sets, focus on form) */
  beginnerVolumeMultiplier: number;
  /** Volume multiplier for intermediate lifters */
  intermediateVolumeMultiplier: number;
  /** Volume multiplier for advanced lifters (can tolerate more) */
  advancedVolumeMultiplier: number;
  /** Progression rate multiplier for beginners (faster gains) */
  beginnerProgressionRate: number;
  /** Progression rate for advanced (slower, smaller increments) */
  advancedProgressionRate: number;

  // ── Defaults & Fallbacks ────────────────────────────────────────────
  defaultSessionDurationMinutes: number;
  defaultBodyWeightLbs: number;
  minTrainingAgeDays: number;
  maxCardioPctDefault: number;
  maxCardioPctFatLoss: number;
  maxCardioPerExerciseMinutes: number;

  // ── Deload Trigger Thresholds ───────────────────────────────────────
  deloadRegressingExerciseThreshold: number;
  deloadSignalCountThreshold: number;

  // ── Warmup Baselines ─────────────────────────────────────────────────
  warmupPrimaryOnly: boolean;
  barbellWarmupAnchors: number[];
  suppressRedundantLowerWarmups: boolean;
}

// Version stamps persisted with generated workouts for reproducibility.
export const MODEL_CONFIG_VERSION = '2026-03-12.1';
export const WORKOUT_ENGINE_VERSION = '2026-03-12.1';

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  // Recovery
  sleepReductionThreshold: 0.80,
  sleepMaxReduction: 0.30,
  hrvReductionThreshold: 0.85,
  hrvVolumeMultiplier: 0.85,
  rhrElevationThreshold: 1.10,
  rhrVolumeMultiplier: 0.90,
  muscleReadyThreshold: 0.85,
  volumeMultiplierFloor: 0.50,
  sleepDebtWeight: 0.05,

  // Deload
  deloadVolumeMultiplier: 0.50,
  deloadWeightMultiplier: 0.85,
  deloadCardioDurationMultiplier: 0.80,
  deloadCardioIntensityMultiplier: 0.85,

  // Progressive overload
  repsAboveTargetForProgression: 2,
  regressionWeightMultiplier: 0.92,
  sleepCoefficientMinimum: 0.10,
  sleepDeltaThreshold: -0.10,
  barbellIncrement: 5,
  dumbbellIncrement: 5,
  machineIncrement: 5,
  isolationIncrement: 2.5,
  maxProgressionPct: 0.10,

  // Exercise selection
  neverUsedPenalty: -8,
  pushPullCorrectionThreshold: 1.50,
  correctiveSetsCount: 2,
  timeOfDayMinDataPoints: 10,
  timeOfDayDeltaThreshold: -0.05,
  consecutiveDaysMinDataPoints: 5,

  // Exercise rotation
  rotationPenalty: -3,
  enforceRotation: true,

  // Cardio interference
  highImpactCardioInterferencePct: 5,
  lowImpactCardioInterferencePct: 2,
  maxCardioInterferencePct: 25,

  // Session fatigue
  sessionFatigueThreshold: -0.08,
  sessionFatigueMinDataPoints: 8,

  // Steps/NEAT
  stepsCorrelationThreshold: -0.15,
  stepsVolumeReduction: 0.05,
  stepsMinDataPoints: 15,

  // Time budget
  minExercisesUnderTimePressure: 3,
  minStrengthBudgetMinutes: 30,

  // Muscle group selection
  splitMatchBoost: 0.50,
  dayPatternBoost: 0.20,
  priorityMuscleBoost: 0.30,
  splitConfidenceThreshold: 0.60,

  // 30-day trend sensitivities
  sleepTrendDownThreshold: -3,       // sleep declining > 3% per week
  sleepTrendVolumeReduction: 0.05,   // 5% proactive volume cut
  hrvTrendDownThreshold: -5,         // HRV declining > 5% per week
  hrvTrendVolumeReduction: 0.05,
  rhrTrendUpThreshold: 3,            // RHR rising > 3% per week
  rhrTrendVolumeReduction: 0.05,
  frequencyTrendUpThreshold: 15,     // frequency up > 15% per week
  frequencyTrendVolumeReduction: 0.05,
  trendMinDataPoints: 7,

  // Experience level scaling
  beginnerVolumeMultiplier: 0.80,
  intermediateVolumeMultiplier: 1.0,
  advancedVolumeMultiplier: 1.15,
  beginnerProgressionRate: 1.5,
  advancedProgressionRate: 0.7,

  // Defaults & fallbacks
  defaultSessionDurationMinutes: 120,
  defaultBodyWeightLbs: 160,
  minTrainingAgeDays: 3,
  maxCardioPctDefault: 0.30,
  maxCardioPctFatLoss: 0.40,
  maxCardioPerExerciseMinutes: 45,

  // Deload triggers
  deloadRegressingExerciseThreshold: 5,
  deloadSignalCountThreshold: 3,

  // Warmup baselines
  warmupPrimaryOnly: true,
  barbellWarmupAnchors: [45, 95, 135, 185, 225, 275, 315, 365, 405, 455, 495],
  suppressRedundantLowerWarmups: true,
};
