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
  /** Smith-machine plate increment (lbs); usually mirrors barbell */
  smithIncrement: number;
  /** Kettlebell increment (lbs); KB racks typically jump 5–9 lbs but we round to 5 for prescription stability */
  kettlebellIncrement: number;
  /**
   * Minimum legal weight for a standard Olympic barbell (empty bar = 45 lbs).
   * The engine MUST NOT prescribe a barbell weight below this — there is no
   * physical way to load less. Anything below this snaps up to the floor.
   */
  barbellMinWeight: number;
  /**
   * Minimum legal weight for a Smith machine (empty bar usually 25–45 lbs;
   * we use 25 as a conservative floor). Same physical rationale as barbell.
   */
  smithMinWeight: number;
  /**
   * Smallest dumbbell typically available in a commercial rack (5 lbs).
   * Some adjustable systems go lower but assuming a 5-lb floor matches the
   * majority of gym contexts the engine targets.
   */
  dumbbellMinWeight: number;
  /** Smallest kettlebell typically available (8 kg = ~17 lbs), floored to 10 lbs. */
  kettlebellMinWeight: number;
  /**
   * Smallest non-zero pin selection on a pin-loaded weight stack. Below this
   * the engine should treat the exercise as unloadable rather than prescribe
   * a sub-stack value.
   */
  machineMinWeight: number;
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
  /** Volume multiplier for elite/professional lifters */
  eliteVolumeMultiplier: number;
  /** Progression rate multiplier for beginners (faster gains) */
  beginnerProgressionRate: number;
  /** Progression rate for advanced lifters */
  advancedProgressionRate: number;
  /** Progression rate for elite lifters */
  eliteProgressionRate: number;

  // ── Defaults & Fallbacks ────────────────────────────────────────────
  defaultSessionDurationMinutes: number;
  defaultBodyWeightLbs: number;
  minTrainingAgeDays: number;
  maxCardioPctDefault: number;
  maxCardioPctFatLoss: number;
  maxCardioPerExerciseMinutes: number;
  /** Hard ceiling for walk / incline-walk treadmill prescriptions (mph). */
  maxWalkSpeedMph: number;
  /** Lower bound when inferring walk speed from history/comfort (mph). */
  minWalkInferredSpeedMph: number;
  /** Half-life (days) for exponential decay of swap-event weight in scoring. */
  swapDecayHalfLifeDays: number;

  // ── Deload Trigger Thresholds ───────────────────────────────────────
  deloadRegressingExerciseThreshold: number;
  deloadSignalCountThreshold: number;

  // ── Warmup Baselines ─────────────────────────────────────────────────
  warmupPrimaryOnly: boolean;
  barbellWarmupAnchors: number[];
  suppressRedundantLowerWarmups: boolean;

  // ── Rep Range Cycling ─────────────────────────────────────────────────
  heavyRepRange: [number, number];
  moderateRepRange: [number, number];
  metabolicRepRange: [number, number];

  // ── Rest by Intensity Tier ────────────────────────────────────────────
  heavyRestSeconds: number;
  moderateRestSeconds: number;
  metabolicRestSeconds: number;

  // ── Frequency Constraints ─────────────────────────────────────────────
  minWeeklyFrequencyPrimary: number;
  minWeeklyFrequencySecondary: number;

  // ── Mesocycle Phases ──────────────────────────────────────────────────
  mesocyclePhases: Record<string, { volumeMult: number; rirOffset: number }>;
  mesocycleRecoverySignalThreshold: number;

  // ── Weight Sanity Caps ─────────────────────────────────────────────────
  /** BW multiplier cap for isolation exercises */
  weightCapIsolationMult: number;
  /** BW multiplier cap for corrective/isolation-role exercises */
  weightCapCorrectiveMult: number;
  /** BW multiplier cap for machine/cable exercises */
  weightCapMachineMult: number;
  /** BW multiplier cap for dumbbell exercises (per hand) */
  weightCapDumbbellMult: number;
  /** BW multiplier cap for primary barbell lifts (squat, bench, deadlift) */
  weightCapPrimaryLiftMult: number;
  /** BW multiplier cap for other primary role exercises */
  weightCapPrimaryMult: number;
  /** BW multiplier cap fallback for all other exercises */
  weightCapDefaultMult: number;

  // ── Rep Range Table ────────────────────────────────────────────────────
  /** Full rep range table keyed by goal → role → {min, max, target} */
  repRangeTable: Record<string, Record<string, { min: number; max: number; target: number }>>;
  /** Hard cap on reps for primary compound exercises */
  maxCompoundRepsPrimary: number;
  /** Hard cap on reps for secondary compound exercises */
  maxCompoundRepsSecondary: number;

  // ── Sets Tiers ─────────────────────────────────────────────────────────
  /** Base set counts by exercise role (before goal/priority adjustments) */
  roleBaseSets: Record<string, number>;
  /** Extra sets added to primary/secondary roles during bulk phase */
  bulkSetsBonus: number;
  /** Minimum sets floor during cut phase */
  cutSetsFloor: number;
  /** Set multiplier during deload weeks (fraction of normal) */
  deloadSetMultiplier: number;
  /** Absolute minimum sets for any exercise */
  setsAbsoluteMin: number;
  /** Absolute maximum sets for any exercise */
  setsAbsoluteMax: number;

  // ── RIR Maps ──────────────────────────────────────────────────────────
  /** Deload RIR override (all roles) */
  deloadRir: number;
  /** RIR targets per role for advanced/elite lifters */
  advancedRirMap: Record<string, number>;
  /** RIR targets per role for beginner lifters */
  beginnerRirMap: Record<string, number>;
  /** RIR targets per role for intermediate lifters */
  intermediateRirMap: Record<string, number>;
  /** Goal-based RIR shift (e.g. cut adds +1 RIR for fatigue management) */
  goalRirShift: Record<string, number>;

  // ── Rest Calculation ──────────────────────────────────────────────────
  /** Per-primary-muscle demand score contribution (capped at 5) */
  restDemandPerPrimary: number;
  /** Cap for primary muscle demand contribution */
  restDemandPrimaryCap: number;
  /** Per-secondary-muscle demand score contribution (capped at 1.5) */
  restDemandPerSecondary: number;
  /** Cap for secondary muscle demand contribution */
  restDemandSecondaryCap: number;
  /** Demand score bonus for compound exercises */
  restDemandCompoundBonus: number;
  /** CNS demand scores by movement pattern */
  restPatternCns: Record<string, number>;
  /** Default CNS score when pattern is unknown */
  restPatternCnsDefault: number;
  /** Base rest floor (seconds) before demand scaling */
  restBaseFloor: number;
  /** Scaling factor applied to demand score for rest calculation */
  restDemandScale: number;
  /** Goal-based rest multipliers */
  restGoalMultiplier: Record<string, number>;
  /** Absolute minimum rest (seconds) */
  restAbsoluteMin: number;
  /** Absolute maximum rest (seconds) */
  restAbsoluteMax: number;

  // ── Transition Times ──────────────────────────────────────────────────
  /** Setup/transition time per exercise by role (seconds) */
  transitionTimeSec: Record<string, number>;

  // ── Impact Score Weights ──────────────────────────────────────────────
  /** Phase-specific weights for impact scoring (compound, mass, metabolic) */
  impactPhaseWeights: Record<string, { compound: number; mass: number; metabolic: number }>;
  /** V-taper muscle bonus in impact scoring */
  impactVTaperBonus: number;
  /** Corrective role impact multiplier */
  impactCorrectiveMultiplier: number;
  /** Primary role impact multiplier */
  impactPrimaryMultiplier: number;
  /** Isolation exercise type impact bonus */
  impactIsolationBonus: number;

  // ── Exercise Selection Scoring ────────────────────────────────────────
  /** Score for compound exercises */
  selectionCompoundScore: number;
  /** Score for exercises matching a performance goal */
  selectionPerformanceGoalScore: number;
  /** Score for weekly staple exercises */
  selectionStapleScore: number;
  /** Bonus for consistent staple exercises */
  selectionStapleConsistencyBonus: number;
  /** Score for recently used exercises (within 14 days) */
  selectionRecentUseScore: number;
  /** Penalty for exercises trained yesterday (recovery protection) */
  selectionYesterdayPenalty: number;
  /** Recency score multiplier for user preference bonus */
  selectionRecencyMultiplier: number;
  /** Penalty for stale exercises (6+ weeks consecutive use) */
  selectionStaleExercisePenalty: number;
  /** Penalty for exercises needing rotation (4+ weeks) */
  selectionRotationPenalty: number;
  /** Score for progressing exercises */
  selectionProgressingScore: number;
  /** Score for stalled exercises */
  selectionStalledScore: number;
  /** Penalty for regressing exercises */
  selectionRegressingPenalty: number;
  /** Penalty for ordering interference with previous exercise */
  selectionOrderingInterferencePenalty: number;
  /** Penalty for duplicate hinge pattern in session */
  selectionDuplicateHingePenalty: number;
  /** Bonus for knee-flexion hamstring work when hinge already selected */
  selectionKneeFlexionBonus: number;
  /** Penalty for exercises requiring unavailable heavy equipment */
  selectionHeavyEquipmentPenalty: number;
  /** Swap history penalty thresholds: { weight, count, penalty } tiers */
  selectionSwapPenaltyTiers: Array<{ minWeight: number; minCount: number; penalty: number }>;
  /** Near-ban swap score ceiling */
  selectionSwapNearBanCeiling: number;
  /** Movement pattern fatigue penalties by level */
  selectionPatternFatiguePenalties: Record<string, number>;
  /** Plateau swap/variation penalty */
  selectionPlateauSwapPenalty: number;
  /** Per-event positive reward when user completes a prescribed exercise without swapping it */
  selectionAcceptancePerEvent: number;
  /** Cap on cumulative acceptance bonus per exercise */
  selectionAcceptanceCap: number;

  // ── Fat-Loss PID Controller ───────────────────────────────────────────
  /** Target body weight loss rate per week (fraction of BW, e.g. 0.006 = 0.6%) */
  fatLossTargetSlopeFraction: number;
  /** Proportional gain (Kp) */
  fatLossPidKp: number;
  /** Integral gain (Ki) */
  fatLossPidKi: number;
  /** Derivative gain (Kd) */
  fatLossPidKd: number;
  /** Control signal clamp range [min, max] */
  fatLossControlClamp: [number, number];
  /** Adherence threshold below which control signal is dampened */
  fatLossAdherenceThreshold: number;
  /** Dampened control signal range when adherence is low */
  fatLossLowAdherenceClamp: [number, number];
  /** Weight trend confidence threshold for quality gate */
  fatLossConfidenceThreshold: number;
  /** Confidence floor scaling factor */
  fatLossConfidenceFloor: number;
  /** Nutrition coverage threshold for dampening */
  fatLossNutritionCoverageThreshold: number;
  /** Nutrition adherence threshold for dampening */
  fatLossNutritionAdherenceThreshold: number;
  /** Nutrition coverage dampening floor */
  fatLossNutritionCoverageFloor: number;
  /** Nutrition adherence low threshold (second tier) */
  fatLossNutritionAdherenceLowThreshold: number;
  /** Nutrition adherence dampening floor (second tier) */
  fatLossNutritionAdherenceLowFloor: number;
  /** Cardio duration sensitivity to control signal */
  fatLossCardioDurationSensitivity: number;
  /** Cardio duration clamp range [min, max] */
  fatLossCardioDurationClamp: [number, number];
  /** Cardio intensity sensitivity to control signal */
  fatLossCardioIntensitySensitivity: number;
  /** Cardio intensity clamp range [min, max] */
  fatLossCardioIntensityClamp: [number, number];
  /** Strength volume sensitivity to control signal */
  fatLossStrengthVolumeSensitivity: number;
  /** Strength volume clamp range [min, max] */
  fatLossStrengthVolumeClamp: [number, number];
  /** Rest seconds sensitivity to control signal */
  fatLossRestSecondsSensitivity: number;
  /** Rest seconds clamp range [min, max] */
  fatLossRestSecondsClamp: [number, number];
  /** Tier thresholds: [stalled, slow_loss, too_fast] */
  fatLossTierThresholds: { stalled: number; slowLoss: number; tooFast: number };

  // ── Cardio Prescription ───────────────────────────────────────────────
  /** Goal-based default cardio durations in seconds */
  cardioGoalDefaultDuration: Record<string, number>;
  /** Cut phase extended Zone 2 duration multiplier */
  cardioCutExtendedDurationMult: number;
  /** Cut phase Zone 3 duration multiplier */
  cardioCutTempoDurationMult: number;
  /** Cut phase Zone 3 speed multiplier */
  cardioCutTempoSpeedMult: number;
  /** Bulk phase max cardio duration (seconds) */
  cardioBulkMaxDuration: number;
  /** Maintain tempo Zone 3 duration multiplier */
  cardioMaintainTempoDurationMult: number;
  /** Maintain tempo speed multiplier */
  cardioMaintainTempoSpeedMult: number;
  /** Maintain intensity push speed multiplier */
  cardioMaintainIntensitySpeedMult: number;
  /** Maintain progressive duration multiplier */
  cardioMaintainProgressiveDurationMult: number;

  // ── Volume Split Constants ────────────────────────────────────────────
  /** Primary exercise stimulus share (fraction of remaining stimulus) */
  volumePrimaryShare: number;
  /** Subsequent exercise stimulus share (fraction of remaining stimulus) */
  volumeSubsequentShare: number;
  /** Minimum stimulus per subsequent exercise */
  volumeSubsequentFloor: number;
  /** Minimum effective set weight denominator */
  volumeEffectiveSetWeightFloor: number;
  /** Max total exercises by session duration tiers: {120+, 90+, 60+, default} */
  volumeMaxExerciseTiers: Record<string, number>;
  /** Max sets per exercise by session duration tiers */
  volumeMaxSetsPerExerciseTiers: Record<string, number>;

  // ── Progression Effort Gates ──────────────────────────────────────────
  /** Effort score below which progression is blocked (0x multiplier) */
  effortGateBlockThreshold: number;
  /** Effort score below which progression is halved (0.5x multiplier) */
  effortGateHalfThreshold: number;

  // ── Apollo Proportions ────────────────────────────────────────────────
  /** Ideal volume distribution proportions for aesthetic balance */
  apolloIdealProportions: Record<string, number>;

  // ── Muscle Group Priority Composite ───────────────────────────────────
  /** Freshness weight in priority composite score */
  priorityFreshnessWeight: number;
  /** Volume deficit weight in priority composite score */
  priorityVolumeDeficitWeight: number;
  /** Proportional deficit multiplier sensitivity */
  priorityDeficitSensitivity: number;
  /** Proportional deficit multiplier floor */
  priorityDeficitFloor: number;
  /** Proportional deficit multiplier ceiling */
  priorityDeficitCeiling: number;
  /** Visual score multiplier sensitivity (per point below 7) */
  priorityVisualScoreSensitivity: number;
  /** Visual score multiplier floor */
  priorityVisualFloor: number;
  /** Visual score multiplier ceiling */
  priorityVisualCeiling: number;
  /** Preferred group bias boost */
  priorityPreferredGroupBoost: number;
  /** Individual MRV safety margin (fraction, e.g. 0.95 = 95% of MRV) */
  priorityMrvSafetyFraction: number;

  // ── Time Budget Phase Thresholds ──────────────────────────────────────
  /** Phase 1: max rest compression fraction for overshoot */
  timeBudgetMaxRestCompression: number;
  /** Phase 1: rest compression sensitivity to overshoot ratio */
  timeBudgetRestCompressionSensitivity: number;

  // ── Bodyweight-Only Mode ───────────────────────────────────────────
  /** Penalty for exercises requiring any equipment in bodyweight-only mode */
  selectionBodyweightOnlyPenalty: number;

  // ── High-Capacity Push ─────────────────────────────────────────────
  /** Readiness threshold for aggressive high-capacity push */
  highCapAggressiveReadiness: number;
  /** Adherence threshold for aggressive high-capacity push */
  highCapAggressiveAdherence: number;
  /** Athlete score threshold for aggressive push */
  highCapAggressiveAthleteScore: number;
  /** Strength percentile threshold for aggressive push */
  highCapAggressiveStrengthPct: number;
  /** Volume multiplier for aggressive high-capacity push */
  highCapAggressiveVolumeMult: number;
  /** Progression multiplier for aggressive push */
  highCapAggressiveProgressionMult: number;
  /** Rest seconds multiplier for aggressive push */
  highCapAggressiveRestMult: number;
  /** RIR delta for aggressive push */
  highCapAggressiveRirDelta: number;
  /** Volume multiplier for moderate high-capacity push */
  highCapModerateVolumeMult: number;
  /** Progression multiplier for moderate push */
  highCapModerateProgressionMult: number;
  /** Rest seconds multiplier for moderate push */
  highCapModerateRestMult: number;
  /** RIR delta for moderate push */
  highCapModerateRirDelta: number;
  /** Capability gate: minimum athlete score to enable push */
  highCapAthleteScoreGate: number;
  /** Capability gate: minimum avg strength percentile */
  highCapStrengthPctGate: number;
  /** Readiness gate-off threshold */
  highCapReadinessGateOff: number;
  /** Adherence gate-off threshold */
  highCapAdherenceGateOff: number;

  // ── Regression Percentages ─────────────────────────────────────────
  /** Weight reduction for systemic regression (3+ lifts declining) */
  regressionSystemicMult: number;
  /** Weight reduction for severe single-lift regression */
  regressionSevereMult: number;
  /** Ego audit cap multiplier (reduces weight when form-ratio flags ego lifting) */
  egoAuditCapMult: number;
  /** Weight rescue floor when 1RM estimate produces value below 50% of last weight */
  weightRescueFloorMult: number;
  /** Maximum cumulative weight reduction from stacked modifiers (ego + sleep) */
  weightModifierFloorMult: number;

  // ── Rep×Load Safety Guard ───────────────────────────────────────────
  /**
   * Hard ceiling on prescribed weight as a fraction of the Epley-derived
   * maximum supportable load for `targetReps + RIR`. A prescribed weight
   * `w` for `n` reps at `RIR` is only safe if `w ≤ margin × 1RM / (1 + (n+RIR)/30)`.
   * Set conservatively because (a) e1RM has ±5–10% empirical error,
   * (b) users grind through bad sessions when prescriptions are too close
   * to absolute capacity, and (c) any pad here is preferable to a single
   * "11 reps of my 1RM" prescription slipping through.
   */
  repLoadSafetyMargin: number;
}

// Version stamps persisted with generated workouts for reproducibility.
//
// MODEL_CONFIG_VERSION: bump when the numeric tunings in DEFAULT_MODEL_CONFIG
// change in a way that would shift prescriptions (volume tiers, set caps,
// rep ranges, etc.). Bug fixes that don't move the numbers do not require a
// bump.
//
// WORKOUT_ENGINE_VERSION: bump on any code-path change in workoutEngine.ts
// or its helpers that could change which exercises get selected, dropped,
// re-ordered, or re-prescribed. Use semantic-ish dating: YYYY-MM-DD.N.
// When in doubt: bump. The downside of a spurious bump is zero; the
// downside of a missed bump is "we shipped a behaviour change but every
// saved plan still claims to be the old version."
export const MODEL_CONFIG_VERSION = '2026-04-27.1';
export const WORKOUT_ENGINE_VERSION = '2026-05-12.2';

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
  deloadVolumeMultiplier: 0.65,
  deloadWeightMultiplier: 0.85,
  deloadCardioDurationMultiplier: 0.80,
  deloadCardioIntensityMultiplier: 0.85,

  // Progressive overload
  repsAboveTargetForProgression: 1,
  regressionWeightMultiplier: 0.92,
  sleepCoefficientMinimum: 0.10,
  sleepDeltaThreshold: -0.10,
  barbellIncrement: 5,
  dumbbellIncrement: 5,
  machineIncrement: 5,
  isolationIncrement: 2.5,
  smithIncrement: 5,
  kettlebellIncrement: 5,
  barbellMinWeight: 45,
  smithMinWeight: 25,
  dumbbellMinWeight: 5,
  kettlebellMinWeight: 10,
  machineMinWeight: 5,
  maxProgressionPct: 0.10,

  // Exercise selection
  neverUsedPenalty: -3,
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
  // splitMatchBoost was 5.0 — high enough to dominate priority composite but
  // not high enough to guarantee split adherence when a non-split muscle had
  // major freshness + volume deficit signals. Bumped to 8.0 so split target
  // groups always rank above off-split candidates, even those carrying
  // heavy volume deficits (which can otherwise pull the engine off-script).
  splitMatchBoost: 8.0,
  dayPatternBoost: 0.20,
  priorityMuscleBoost: 0.30,
  // Lowered from 0.60 → 0.45: even a moderately-confident detected split
  // is better than no split. The previous threshold meant ~25% of users with
  // inconsistent histories never got split-aware programming.
  splitConfidenceThreshold: 0.45,

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
  eliteVolumeMultiplier: 1.30,
  beginnerProgressionRate: 1.5,
  advancedProgressionRate: 1.0,
  eliteProgressionRate: 0.85,

  // Defaults & fallbacks
  defaultSessionDurationMinutes: 65,
  defaultBodyWeightLbs: 160,
  minTrainingAgeDays: 3,
  maxCardioPctDefault: 0.30,
  maxCardioPctFatLoss: 0.40,
  maxCardioPerExerciseMinutes: 45,
  maxWalkSpeedMph: 3.5,
  minWalkInferredSpeedMph: 2.4,
  swapDecayHalfLifeDays: 21,

  // Deload triggers
  deloadRegressingExerciseThreshold: 5,
  deloadSignalCountThreshold: 3,

  // Warmup baselines
  warmupPrimaryOnly: true,
  barbellWarmupAnchors: [45, 95, 135, 185, 225, 275, 315, 365, 405, 455, 495],
  suppressRedundantLowerWarmups: true,

  // Rep range cycling
  heavyRepRange: [4, 6],
  moderateRepRange: [8, 12],
  metabolicRepRange: [12, 20],

  // Rest by intensity tier
  heavyRestSeconds: 210,
  moderateRestSeconds: 120,
  metabolicRestSeconds: 75,

  // Frequency constraints
  minWeeklyFrequencyPrimary: 2,
  minWeeklyFrequencySecondary: 1,

  // Mesocycle phases
  mesocyclePhases: {
    accumulation: { volumeMult: 0.90, rirOffset: 1 },
    loading:      { volumeMult: 1.00, rirOffset: 0 },
    overreach:    { volumeMult: 1.10, rirOffset: -1 },
    deload:       { volumeMult: 0.80, rirOffset: 2 },
  },
  mesocycleRecoverySignalThreshold: 3,

  // Weight sanity caps
  weightCapIsolationMult: 0.75,
  weightCapCorrectiveMult: 0.50,
  weightCapMachineMult: 2.5,
  weightCapDumbbellMult: 0.65,
  weightCapPrimaryLiftMult: 3.0,
  weightCapPrimaryMult: 2.0,
  weightCapDefaultMult: 1.5,

  // Rep range table
  repRangeTable: {
    bulk:     { primary: { min: 5, max: 8, target: 6 },  secondary: { min: 8, max: 12, target: 10 }, isolation: { min: 10, max: 15, target: 12 } },
    cut:      { primary: { min: 4, max: 6, target: 5 },  secondary: { min: 6, max: 10, target: 8 },  isolation: { min: 10, max: 12, target: 10 } },
    maintain: { primary: { min: 5, max: 8, target: 6 },  secondary: { min: 8, max: 12, target: 10 }, isolation: { min: 10, max: 15, target: 12 } },
  },
  maxCompoundRepsPrimary: 15,
  maxCompoundRepsSecondary: 18,

  // Sets tiers
  roleBaseSets: { primary: 4, secondary: 3, isolation: 2, corrective: 2, cardio: 1 },
  bulkSetsBonus: 1,
  cutSetsFloor: 2,
  deloadSetMultiplier: 0.8,
  setsAbsoluteMin: 2,
  setsAbsoluteMax: 8,

  // RIR maps
  deloadRir: 4,
  advancedRirMap: { primary: 1, secondary: 1, isolation: 0, corrective: 2, cardio: 0 },
  beginnerRirMap: { primary: 3, secondary: 2, isolation: 2, corrective: 3, cardio: 0 },
  intermediateRirMap: { primary: 2, secondary: 1, isolation: 1, corrective: 2, cardio: 0 },
  goalRirShift: { bulk: 0, cut: 1, maintain: 0 },

  // Rest calculation
  restDemandPerPrimary: 1.2,
  restDemandPrimaryCap: 5,
  restDemandPerSecondary: 0.3,
  restDemandSecondaryCap: 1.5,
  restDemandCompoundBonus: 2,
  restPatternCns: {
    squat: 2.0, deadlift: 2.0, hip_hinge: 1.8,
    horizontal_press: 1.3, vertical_press: 1.3, lunge: 1.2,
    horizontal_pull: 1.0, vertical_pull: 1.0,
    extension: 0.3, curl: 0.3, fly: 0.3, raise: 0.3, rotation: 0.3,
    horizontal_push: 1.3, vertical_push: 1.3,
  },
  restPatternCnsDefault: 0.5,
  restBaseFloor: 40,
  restDemandScale: 160,
  restGoalMultiplier: { bulk: 1.15, cut: 0.85, maintain: 1.0 },
  restAbsoluteMin: 30,
  restAbsoluteMax: 300,

  // Transition times
  transitionTimeSec: { primary: 120, secondary: 90, isolation: 60, corrective: 45, cardio: 60, strength: 90 },

  // Impact score weights
  impactPhaseWeights: {
    bulk:     { compound: 1.5, mass: 1.5, metabolic: 0.5 },
    cut:      { compound: 1.2, mass: 1.0, metabolic: 1.5 },
    maintain: { compound: 1.3, mass: 1.2, metabolic: 0.8 },
  },
  impactVTaperBonus: 2,
  impactCorrectiveMultiplier: 2.0,
  impactPrimaryMultiplier: 1.3,
  impactIsolationBonus: 1.5,

  // Exercise selection scoring
  selectionCompoundScore: 8,
  selectionPerformanceGoalScore: 6,
  selectionStapleScore: 5,
  selectionStapleConsistencyBonus: 4,
  selectionRecentUseScore: 2,
  selectionYesterdayPenalty: -12,
  selectionRecencyMultiplier: 1.35,
  selectionStaleExercisePenalty: -10,
  selectionRotationPenalty: -5,
  selectionProgressingScore: 3,
  selectionStalledScore: 1,
  selectionRegressingPenalty: -1,
  selectionOrderingInterferencePenalty: -2,
  selectionDuplicateHingePenalty: -6,
  selectionKneeFlexionBonus: 3,
  selectionHeavyEquipmentPenalty: -5,
  // Swap penalty tiers: gentler curve so a few rejections don't lock an
  // exercise out of the rotation. Near-ban only triggers at 15+ swaps OR
  // 11+ effective weight (decay-adjusted). Previously: 5 swaps → permanent
  // ban for ~9 weeks regardless of any positive signal. The new schedule:
  //   2 swaps → -4   (mild signal: we noticed)
  //   5 swaps → -10  (clear signal: deprioritize)
  //   10 swaps → -20 (strong signal: only if compound bonuses can't beat it)
  //   15 swaps → -30 + near-ban cap activates
  selectionSwapPenaltyTiers: [
    { minWeight: 11.0, minCount: 15, penalty: -30 },
    { minWeight: 7.5, minCount: 10, penalty: -20 },
    { minWeight: 3.5, minCount: 5, penalty: -10 },
    { minWeight: 1.4, minCount: 2, penalty: -4 },
  ],
  // Near-ban floor: an exercise hard-capped at this score regardless of
  // bonuses. Looser floor (-4 vs -10) so the next legitimate positive
  // signal (substitution affinity, "kept" reward) can still rescue it.
  selectionSwapNearBanCeiling: -4,
  selectionPatternFatiguePenalties: { high: -6, moderate: -2 },
  selectionPlateauSwapPenalty: -3,
  // Positive signal: exercise was prescribed AND completed without being
  // swapped out. Per-acceptance reward, decay-weighted on the same
  // half-life as swap penalties so the two signals balance over time.
  selectionAcceptancePerEvent: 1.5,
  selectionAcceptanceCap: 8,

  // Fat-loss PID controller
  fatLossTargetSlopeFraction: 0.006,
  fatLossPidKp: 0.35,
  fatLossPidKi: 0.08,
  fatLossPidKd: 0.16,
  fatLossControlClamp: [-0.45, 0.50],
  fatLossAdherenceThreshold: 0.60,
  fatLossLowAdherenceClamp: [-0.20, 0.20],
  fatLossConfidenceThreshold: 0.42,
  fatLossConfidenceFloor: 0.28,
  fatLossNutritionCoverageThreshold: 0.38,
  fatLossNutritionAdherenceThreshold: 0.55,
  fatLossNutritionCoverageFloor: 0.42,
  fatLossNutritionAdherenceLowThreshold: 0.48,
  fatLossNutritionAdherenceLowFloor: 0.52,
  fatLossCardioDurationSensitivity: 0.72,
  fatLossCardioDurationClamp: [0.80, 1.50],
  fatLossCardioIntensitySensitivity: 0.32,
  fatLossCardioIntensityClamp: [0.90, 1.20],
  fatLossStrengthVolumeSensitivity: 0.18,
  fatLossStrengthVolumeClamp: [0.90, 1.10],
  fatLossRestSecondsSensitivity: 0.18,
  fatLossRestSecondsClamp: [0.88, 1.10],
  fatLossTierThresholds: { stalled: 0.20, slowLoss: 0.06, tooFast: -0.16 },

  // Cardio prescription
  cardioGoalDefaultDuration: { bulk: 900, cut: 1500, maintain: 1200 },
  cardioCutExtendedDurationMult: 1.15,
  cardioCutTempoDurationMult: 0.75,
  cardioCutTempoSpeedMult: 1.10,
  cardioBulkMaxDuration: 1200,
  cardioMaintainTempoDurationMult: 0.80,
  cardioMaintainTempoSpeedMult: 1.08,
  cardioMaintainIntensitySpeedMult: 1.12,
  cardioMaintainProgressiveDurationMult: 1.10,

  // Volume split constants
  volumePrimaryShare: 0.62,
  volumeSubsequentShare: 0.5,
  volumeSubsequentFloor: 1.6,
  volumeEffectiveSetWeightFloor: 0.55,
  volumeMaxExerciseTiers: { '120': 14, '90': 12, '60': 10, default: 8 },
  volumeMaxSetsPerExerciseTiers: { '120': 6, '90': 5, '60': 4, default: 3 },

  // Progression effort gates
  // Effort gate thresholds (lowered after warmups were filtered out of
  // composite score). Previously 45/55 produced false positives — the
  // warmup ramps dragged avgIntensity below the floor on legitimately
  // intense sessions. With warmups now excluded, the typical session
  // composite is ~10 points higher; thresholds adjusted accordingly.
  // Block only on genuinely lazy training, half-credit between 50–65.
  effortGateBlockThreshold: 35,
  effortGateHalfThreshold: 50,

  // Apollo proportions
  apolloIdealProportions: {
    mid_chest: 0.09, upper_chest: 0.05, lower_chest: 0.03,
    back_lats: 0.10, back_upper: 0.06,
    upper_traps: 0.02, mid_traps: 0.005, lower_traps: 0.005,
    lateral_deltoid: 0.06, anterior_deltoid: 0.04, posterior_deltoid: 0.04,
    quadriceps: 0.10, hamstrings: 0.08, glutes: 0.06,
    biceps: 0.04, triceps: 0.05,
    calves: 0.03, core: 0.04, forearms: 0.02,
    erector_spinae: 0.02, rotator_cuff: 0.01,
  },

  // Muscle group priority composite
  priorityFreshnessWeight: 0.4,
  priorityVolumeDeficitWeight: 0.3,
  priorityDeficitSensitivity: 3.0,
  priorityDeficitFloor: 0.6,
  priorityDeficitCeiling: 2.0,
  priorityVisualScoreSensitivity: 2.0,
  priorityVisualFloor: 0.6,
  priorityVisualCeiling: 1.8,
  priorityPreferredGroupBoost: 0.42,
  priorityMrvSafetyFraction: 0.95,

  // Time budget phase thresholds
  timeBudgetMaxRestCompression: 0.30,
  timeBudgetRestCompressionSensitivity: 0.5,

  // Bodyweight-only mode
  selectionBodyweightOnlyPenalty: -8,

  // High-capacity push
  highCapAggressiveReadiness: 0.82,
  highCapAggressiveAdherence: 0.75,
  highCapAggressiveAthleteScore: 80,
  highCapAggressiveStrengthPct: 75,
  highCapAggressiveVolumeMult: 1.15,
  highCapAggressiveProgressionMult: 1.30,
  highCapAggressiveRestMult: 0.85,
  highCapAggressiveRirDelta: -2,
  highCapModerateVolumeMult: 1.08,
  highCapModerateProgressionMult: 1.15,
  highCapModerateRestMult: 0.92,
  highCapModerateRirDelta: -1,
  highCapAthleteScoreGate: 75,
  highCapStrengthPctGate: 70,
  highCapReadinessGateOff: 0.65,
  highCapAdherenceGateOff: 0.6,

  // Regression percentages
  // Less aggressive regression cuts. Previously a single bad week (3 lifts
  // declining slope) could shave 20% off all working weights, which is
  // harder to come back from than the regression itself. The new values
  // (0.90 / 0.92) trim 8–10% in genuinely systemic regressions and 8% on
  // single-lift severe cases — enough to deload the lift without nuking
  // the user's sense of progress (a major compliance killer).
  regressionSystemicMult: 0.90,
  regressionSevereMult: 0.92,
  egoAuditCapMult: 0.92,
  weightRescueFloorMult: 0.75,
  weightModifierFloorMult: 0.85,

  // Rep×Load safety guard
  repLoadSafetyMargin: 0.93,
};
