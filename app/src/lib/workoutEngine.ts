/**
 * Workout Generation Engine — Evidence-Based Rules Engine
 *
 * 6-step deterministic workout generator that takes a TrainingProfile
 * (from trainingAnalysis.ts) and user preferences to produce a complete
 * workout prescription with rationale.
 *
 * Steps:
 *   1. Recovery check + global adjustments
 *   2. Select body parts / muscle groups for today
 *   3. Select exercises per muscle group
 *   4. Prescribe sets, reps, weight, tempo
 *   5. Apply session constraints (duration, ordering)
 *   6. Generate per-exercise rationale
 */

import { requireSupabase } from './supabase';
import { VOLUME_GUIDELINES, MUSCLE_HEAD_TO_GROUP, getGuidelineForGroup } from './volumeGuidelines';
import type { TrainingProfile, ExerciseProgression, EnrichedExercise, ExercisePreference, CardioHistory, ExerciseOrderProfile } from './trainingAnalysis';
import { uuidv4 } from '../utils/uuid';
import { getExerciseMapping } from './exerciseMuscleMap';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PerformanceGoal {
  exercise: string;
  targetWeight: string;
  targetReps: string;
}

export interface UserPreferences {
  training_goal: 'strength' | 'hypertrophy' | 'general_fitness' | 'fat_loss';
  session_duration_minutes: number;
  equipment_access: 'full_gym' | 'home_gym' | 'limited';
  available_days_per_week: number;
  injuries: Array<{ body_part: string; description: string; severity: string }>;
  exercises_to_avoid: string[];
  performance_goals: PerformanceGoal[];
  preferred_split: string | null;
  date_of_birth: string | null;
  gender: string | null;
  height_feet: number | null;
  height_inches: number | null;
  job_activity_level: string | null;
  experience_level: string | null;
  body_weight_lbs: number | null;
  cardio_preference: string | null;
  cardio_frequency_per_week: number | null;
  cardio_duration_minutes: number | null;
  preferred_exercises: string[] | null;
  recovery_speed: number | null;
  weight_goal_lbs: number | null;
  weight_goal_date: string | null;
}

export interface GeneratedExercise {
  exerciseName: string;
  exerciseLibraryId: string;
  bodyPart: string;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  movementPattern: string;
  targetMuscleGroup: string;
  sets: number;
  targetReps: number;
  targetWeight: number | null;
  isBodyweight: boolean;
  tempo: string;
  restSeconds: number;
  rationale: string;
  adjustments: string[];
  isDeload: boolean;
  isCardio: boolean;
  cardioDurationSeconds: number | null;
  cardioSpeed: number | null;
  cardioIncline: number | null;
  cardioSpeedLabel: string | null;
}

export interface DecisionLogEntry {
  step: string;
  label: string;
  details: string[];
}

export interface MuscleGroupDecision {
  muscleGroup: string;
  priority: number;
  reason: string;
  targetSets: number;
  recoveryPercent: number | null;
  weeklyVolume: number | null;
  volumeTarget: string | null;
}

export interface ExerciseDecision {
  exerciseName: string;
  muscleGroup: string;
  score: number;
  factors: string[];
}

export interface GeneratedWorkout {
  id: string;
  date: string;
  trainingGoal: string;
  estimatedDurationMinutes: number;
  muscleGroupsFocused: string[];
  exercises: GeneratedExercise[];
  sessionRationale: string;
  recoveryStatus: string;
  adjustmentsSummary: string[];
  deloadActive: boolean;
  decisionLog: DecisionLogEntry[];
  muscleGroupDecisions: MuscleGroupDecision[];
  exerciseDecisions: ExerciseDecision[];
}

// ─── Data Fetching ──────────────────────────────────────────────────────────

async function fetchUserPreferences(userId: string): Promise<UserPreferences> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('user_preferences')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error && error.code !== 'PGRST116') throw error;

  const rawInjuries = data?.injuries;
  const rawAvoid = data?.exercises_to_avoid;
  const rawGoals = data?.performance_goals;
  const rawPrefExercises = data?.preferred_exercises;

  return {
    training_goal: data?.training_goal ?? 'hypertrophy',
    session_duration_minutes: data?.session_duration_minutes ?? 75,
    equipment_access: data?.equipment_access ?? 'full_gym',
    available_days_per_week: data?.available_days_per_week ?? 5,
    injuries: Array.isArray(rawInjuries) ? rawInjuries : [],
    exercises_to_avoid: Array.isArray(rawAvoid) ? rawAvoid : [],
    performance_goals: Array.isArray(rawGoals) ? rawGoals : [],
    preferred_split: data?.preferred_split ?? null,
    date_of_birth: data?.date_of_birth ?? null,
    gender: data?.gender ?? null,
    height_feet: data?.height_feet ?? null,
    height_inches: data?.height_inches ?? null,
    job_activity_level: data?.job_activity_level ?? null,
    experience_level: data?.experience_level ?? null,
    body_weight_lbs: data?.body_weight_lbs != null ? Number(data.body_weight_lbs) : null,
    cardio_preference: data?.cardio_preference ?? null,
    cardio_frequency_per_week: data?.cardio_frequency_per_week != null ? Number(data.cardio_frequency_per_week) : null,
    cardio_duration_minutes: data?.cardio_duration_minutes != null ? Number(data.cardio_duration_minutes) : null,
    preferred_exercises: Array.isArray(rawPrefExercises) ? rawPrefExercises : null,
    recovery_speed: data?.recovery_speed != null ? Number(data.recovery_speed) : null,
    weight_goal_lbs: data?.weight_goal_lbs != null ? Number(data.weight_goal_lbs) : null,
    weight_goal_date: data?.weight_goal_date ?? null,
  };
}

async function fetchAllExercises(): Promise<EnrichedExercise[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('exercise_library')
    .select('id, name, body_part, primary_muscles, secondary_muscles, stabilizer_muscles, movement_pattern, ml_exercise_type, force_type, difficulty, default_tempo, equipment')
    .eq('is_custom', false);

  if (error) throw error;
  return (data ?? []) as EnrichedExercise[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateId(): string {
  return uuidv4();
}

function getRepRange(goal: string): { min: number; max: number; target: number } {
  switch (goal) {
    case 'strength': return { min: 3, max: 6, target: 5 };
    case 'hypertrophy': return { min: 8, max: 12, target: 10 };
    case 'fat_loss': return { min: 10, max: 15, target: 12 };
    default: return { min: 6, max: 10, target: 8 };
  }
}

function getRestSeconds(exerciseType: string | null, goal: string): number {
  if (exerciseType === 'compound') {
    return goal === 'strength' ? 180 : goal === 'hypertrophy' ? 120 : 90;
  }
  return goal === 'strength' ? 120 : 60;
}

function getTempo(defaultTempo: string | null, goal: string, exerciseType: string | null): string {
  if (defaultTempo) return defaultTempo;
  if (goal === 'hypertrophy') return exerciseType === 'compound' ? '2-1-1' : '3-1-2';
  if (goal === 'strength') return '1-1-1';
  return '2-1-1';
}

function isInjuryConflict(exercise: EnrichedExercise, injuries: UserPreferences['injuries']): boolean {
  if (!Array.isArray(injuries)) return false;
  for (const injury of injuries) {
    const injuryPart = injury?.body_part?.toLowerCase?.();
    if (!injuryPart) continue;
    if (exercise.body_part?.toLowerCase().includes(injuryPart)) return true;
    const muscles = Array.isArray(exercise.primary_muscles) ? exercise.primary_muscles : [];
    for (const m of muscles) {
      if (m?.toLowerCase().includes(injuryPart)) return true;
    }
  }
  return false;
}

function estimateExerciseDuration(sets: number, restSeconds: number): number {
  const setTime = 45;
  return (sets * setTime + (sets - 1) * restSeconds) / 60;
}

// ─── Step 1: Recovery Check ─────────────────────────────────────────────────

interface RecoveryAdjustment {
  volumeMultiplier: number;
  adjustmentReasons: string[];
  isDeload: boolean;
}

function stepRecoveryCheck(profile: TrainingProfile): RecoveryAdjustment {
  const reasons: string[] = [];
  let volumeMultiplier = 1.0;

  if (profile.deloadRecommendation.needed) {
    return {
      volumeMultiplier: profile.deloadRecommendation.suggestedVolumeMultiplier,
      adjustmentReasons: ['Deload recommended: ' + profile.deloadRecommendation.signals.join('; ')],
      isDeload: true,
    };
  }

  const { sleepCoefficients, recoveryContext } = profile;

  if (recoveryContext.sleepDurationLastNight != null && recoveryContext.sleepBaseline30d != null) {
    const sleepRatio = recoveryContext.sleepDurationLastNight / recoveryContext.sleepBaseline30d;
    if (sleepRatio < 0.8) {
      const reduction = Math.round((1 - sleepRatio) * 30);
      volumeMultiplier *= 1 - reduction / 100;
      reasons.push(`Sleep ${Math.round((1 - sleepRatio) * 100)}% below baseline → volume reduced ${reduction}%`);
    }
  }

  if (recoveryContext.hrvLastNight != null && recoveryContext.hrvBaseline30d != null) {
    const hrvRatio = recoveryContext.hrvLastNight / recoveryContext.hrvBaseline30d;
    if (hrvRatio < 0.85) {
      volumeMultiplier *= 0.85;
      reasons.push(`HRV ${Math.round((1 - hrvRatio) * 100)}% below baseline → volume reduced 15%`);
    }
  }

  if (recoveryContext.rhrLastNight != null && recoveryContext.rhrBaseline30d != null) {
    const rhrRatio = recoveryContext.rhrLastNight / recoveryContext.rhrBaseline30d;
    if (rhrRatio > 1.1) {
      volumeMultiplier *= 0.9;
      reasons.push(`RHR ${Math.round((rhrRatio - 1) * 100)}% above baseline → volume reduced 10%`);
    }
  }

  // Apply time-of-day adjustment info (not volume reduction, just awareness)
  const currentHour = new Date().getHours();
  const bucket = currentHour < 10 ? 'morning' : currentHour < 14 ? 'midday'
    : currentHour < 17 ? 'afternoon' : 'evening';
  const todEffect = profile.timeOfDayEffects.find(e => e.bucket === bucket);
  if (todEffect && todEffect.avgDelta < -0.05 && todEffect.dataPoints >= 10) {
    reasons.push(`Training during ${bucket}: historically ${Math.round(Math.abs(todEffect.avgDelta) * 100)}% lower performance`);
  }

  // Consecutive days check
  const recentWorkoutDates = profile.muscleVolumeStatuses.length > 0
    ? profile.muscleRecovery.filter(m => m.hoursSinceLastTrained < 30).length
    : 0;

  const consEffect = profile.consecutiveDaysEffects.find(e => e.dayIndex >= 4 && e.avgDelta < -0.05);
  if (consEffect && consEffect.dataPoints >= 5) {
    reasons.push(`Consecutive training day ${consEffect.dayIndex}: historically ${Math.round(Math.abs(consEffect.avgDelta) * 100)}% lower performance`);
  }

  // Body weight trend adjustment
  if (profile.bodyWeightTrend.phase === 'cutting') {
    reasons.push('Cutting phase detected: progression expectations reduced');
  }

  return { volumeMultiplier: Math.max(0.5, volumeMultiplier), adjustmentReasons: reasons, isDeload: false };
}

// ─── Step 2: Select Muscle Groups (Split-Aware) ─────────────────────────────

interface MuscleGroupSelection {
  muscleGroup: string;
  priority: number;
  reason: string;
  targetSets: number;
  recoveryPercent: number | null;
  weeklyVolume: number | null;
  volumeTarget: string | null;
}

const SPLIT_MUSCLE_MAPPING: Record<string, string[]> = {
  push: ['chest', 'anterior_deltoid', 'lateral_deltoid', 'triceps'],
  pull: ['back_lats', 'back_upper', 'biceps', 'posterior_deltoid', 'forearms'],
  legs: ['quadriceps', 'hamstrings', 'glutes', 'calves'],
  upper: ['chest', 'back_lats', 'back_upper', 'anterior_deltoid', 'lateral_deltoid', 'posterior_deltoid', 'biceps', 'triceps'],
  lower: ['quadriceps', 'hamstrings', 'glutes', 'calves'],
  full: ['chest', 'back_lats', 'quadriceps', 'anterior_deltoid', 'biceps', 'triceps', 'hamstrings', 'glutes'],
};

function stepSelectMuscleGroups(
  profile: TrainingProfile,
  prefs: UserPreferences,
  recoveryAdj: RecoveryAdjustment
): { selected: MuscleGroupSelection[]; skipped: Array<{ muscleGroup: string; reason: string }> } {
  const candidates: MuscleGroupSelection[] = [];
  const skipped: Array<{ muscleGroup: string; reason: string }> = [];

  // Determine today's target groups from detected split or user preference
  const { detectedSplit, dayOfWeekPatterns } = profile;
  const todayDow = new Date().getDay();
  const todayPattern = dayOfWeekPatterns[todayDow];

  let splitTargetGroups: Set<string> | null = null;

  // User's preferred split overrides auto-detection
  if (prefs.preferred_split && SPLIT_MUSCLE_MAPPING[prefs.preferred_split]) {
    // Use preferred split pattern with the detected rotation to pick today's focus
    if (detectedSplit.nextRecommended.length > 0) {
      splitTargetGroups = new Set<string>();
      for (const rec of detectedSplit.nextRecommended) {
        const groups = SPLIT_MUSCLE_MAPPING[rec];
        if (groups) groups.forEach(g => splitTargetGroups!.add(g));
      }
    }
  } else if (detectedSplit.confidence >= 0.6 && detectedSplit.nextRecommended.length > 0) {
    splitTargetGroups = new Set<string>();
    for (const rec of detectedSplit.nextRecommended) {
      const groups = SPLIT_MUSCLE_MAPPING[rec];
      if (groups) groups.forEach(g => splitTargetGroups!.add(g));
    }
  } else if (todayPattern && !todayPattern.isRestDay && todayPattern.muscleGroupsTypical.length > 0) {
    // Fall back to day-of-week pattern
    splitTargetGroups = new Set(todayPattern.muscleGroupsTypical);
  }

  for (const vol of profile.muscleVolumeStatuses) {
    const guideline = getGuidelineForGroup(vol.muscleGroup);
    if (!guideline) continue;

    const recovery = profile.muscleRecovery.find(r => r.muscleGroup === vol.muscleGroup);
    if (recovery && !recovery.readyToTrain) {
      skipped.push({ muscleGroup: vol.muscleGroup, reason: `Still recovering (${recovery.recoveryPercent}% recovered)` });
      continue;
    }

    const hasInjury = prefs.injuries.some(inj =>
      vol.muscleGroup.toLowerCase().includes(inj.body_part.toLowerCase())
    );
    if (hasInjury) {
      skipped.push({ muscleGroup: vol.muscleGroup, reason: 'Injury conflict' });
      continue;
    }

    const freshnessDays = vol.daysSinceLastTrained === Infinity ? 7 : vol.daysSinceLastTrained;
    const freshnessScore = Math.min(freshnessDays / (guideline.recoveryHours / 24), 2);

    const weeklyTarget = (guideline.mavLow + guideline.mavHigh) / 2;
    const individualMrv = profile.individualMrvEstimates[vol.muscleGroup];
    const effectiveTarget = individualMrv ? Math.min(weeklyTarget, individualMrv * 0.85) : weeklyTarget;
    const volumeDeficit = Math.max(0, effectiveTarget - vol.weeklyDirectSets);

    // Base priority: freshness + volume deficit
    let priority = freshnessScore * 0.4 + (volumeDeficit / Math.max(effectiveTarget, 1)) * 0.3;

    // Split bonus: if this group is in today's recommended split, strong boost
    if (splitTargetGroups?.has(vol.muscleGroup)) {
      priority += 0.5;
    }

    // Day-of-week pattern bonus: if user typically trains this group today
    if (todayPattern?.muscleGroupsTypical.includes(vol.muscleGroup)) {
      priority += 0.2;
    }

    const setsNeeded = Math.ceil(
      Math.min(Math.max(volumeDeficit, 3), 10) * recoveryAdj.volumeMultiplier
    );

    const splitLabel = splitTargetGroups?.has(vol.muscleGroup) ? ' [split match]' : '';
    const dayLabel = todayPattern?.muscleGroupsTypical.includes(vol.muscleGroup) ? ' [day pattern]' : '';

    if (setsNeeded > 0 || freshnessDays >= 5 || splitTargetGroups?.has(vol.muscleGroup)) {
      const reason = splitTargetGroups?.has(vol.muscleGroup)
        ? `Split: ${detectedSplit.nextRecommended.join('/')} day${dayLabel} — ${vol.weeklyDirectSets}/${effectiveTarget.toFixed(0)} weekly sets`
        : freshnessDays >= 5
          ? `Not trained in ${freshnessDays} days${splitLabel}`
          : `${volumeDeficit.toFixed(0)} sets below target (${vol.weeklyDirectSets}/${effectiveTarget.toFixed(0)})${splitLabel}${dayLabel}`;

      candidates.push({
        muscleGroup: vol.muscleGroup,
        priority,
        reason,
        targetSets: Math.max(2, setsNeeded),
        recoveryPercent: recovery?.recoveryPercent ?? null,
        weeklyVolume: vol.weeklyDirectSets,
        volumeTarget: `${guideline.mavLow}-${guideline.mavHigh}`,
      });
    }
  }

  candidates.sort((a, b) => b.priority - a.priority);

  const maxGroups = prefs.session_duration_minutes <= 45 ? 2
    : prefs.session_duration_minutes <= 75 ? 3
    : 4;

  return { selected: candidates.slice(0, maxGroups), skipped };
}

// ─── Step 3: Select Exercises (Preference-Aware + Cardio) ───────────────────

interface ExerciseSelection {
  exercise: EnrichedExercise;
  muscleGroup: string;
  sets: number;
  reason: string;
  isCardio?: boolean;
}

function stepSelectExercises(
  muscleGroups: MuscleGroupSelection[],
  allExercises: EnrichedExercise[],
  profile: TrainingProfile,
  prefs: UserPreferences
): { selections: ExerciseSelection[]; decisions: ExerciseDecision[] } {
  const selections: ExerciseSelection[] = [];
  const decisions: ExerciseDecision[] = [];
  const avoidSet = new Set(prefs.exercises_to_avoid.map(e => e.toLowerCase()));

  // Build performance goal lookup — exercises with goals get priority
  const goalMap = new Map<string, PerformanceGoal>();
  for (const g of prefs.performance_goals) {
    if (g.exercise) goalMap.set(g.exercise.toLowerCase(), g);
  }

  // Build preference lookup for fast access
  const prefMap = new Map<string, ExercisePreference>();
  for (const p of profile.exercisePreferences) {
    prefMap.set(p.exerciseName, p);
  }

  const strengthExercises = allExercises.filter(ex =>
    ex.ml_exercise_type !== 'cardio' && ex.ml_exercise_type !== 'recovery'
  );

  const usedExercises = new Set<string>();

  for (const group of muscleGroups) {
    const groupExercises = strengthExercises.filter(ex => {
      if (avoidSet.has(ex.name.toLowerCase())) return false;
      if (usedExercises.has(ex.name.toLowerCase())) return false;
      if (isInjuryConflict(ex, prefs.injuries)) return false;

      const primaryGroups = (Array.isArray(ex.primary_muscles) ? ex.primary_muscles : [])
        .map(m => MUSCLE_HEAD_TO_GROUP[m])
        .filter(Boolean);
      return primaryGroups.includes(group.muscleGroup);
    });

    if (groupExercises.length === 0) continue;

    const scored = groupExercises.map(ex => {
      let score = 0;
      const factors: string[] = [];

      if (ex.ml_exercise_type === 'compound') {
        score += 2;
        factors.push('Compound (+2)');
      }

      // Performance goal boost — if user has a specific target for this exercise
      const goal = goalMap.get(ex.name.toLowerCase());
      if (goal) {
        score += 6;
        factors.push(`Performance goal: ${goal.targetWeight} lbs × ${goal.targetReps} reps (+6)`);
      }

      // User preference is the DOMINANT signal — exercises they actually do
      const pref = prefMap.get(ex.name.toLowerCase());
      if (pref) {
        // No cap — higher recency = higher score, proportional to usage
        const prefBonus = pref.recencyScore * 2.5;
        score += prefBonus;
        factors.push(`Your exercise (+${prefBonus.toFixed(1)}, ${pref.recentSessions} recent/${pref.totalSessions} total, recency: ${pref.recencyScore})`);
        if (pref.isStaple) {
          score += 4;
          factors.push('Staple — you do this consistently (+4)');
        }
        if (pref.lastUsedDaysAgo <= 14) {
          score += 2;
          factors.push(`Used ${pref.lastUsedDaysAgo}d ago (+2)`);
        }
      } else {
        // Strong penalty — exercises you've never done should almost never be recommended
        score -= 8;
        factors.push('Never used in your training history (-8)');
      }

      const prog = profile.exerciseProgressions.find(
        p => p.exerciseName === ex.name.toLowerCase()
      );
      if (prog) {
        if (prog.status === 'progressing') {
          score += 3;
          factors.push(`Progressing (+3, ${prog.sessionsTracked} sessions, slope: ${(prog.progressionSlope * 100).toFixed(1)}%)`);
        } else if (prog.status === 'stalled') {
          score += 1;
          factors.push(`Stalled (+1, ${prog.sessionsTracked} sessions — try higher reps or variation)`);
        } else if (prog.status === 'regressing') {
          score -= 1;
          factors.push(`Regressing (-1, consider swapping or reducing volume)`);
        }
      }

      // Ordering interference
      if (selections.length > 0) {
        const lastSelected = selections[selections.length - 1].exercise.name.toLowerCase();
        const interference = profile.exerciseOrderingEffects.find(
          e => e.precedingExercise === lastSelected && e.affectedExercise === ex.name.toLowerCase()
        );
        if (interference && interference.interference < -0.05) {
          score -= 2;
          factors.push(`Ordering interference with ${lastSelected} (-2)`);
        }
      }

      if (prefs.equipment_access === 'limited') {
        const needsHeavyEquip = (Array.isArray(ex.equipment) ? ex.equipment : []).some(e =>
          ['barbell', 'cable_machine', 'smith_machine'].includes(e)
        );
        if (needsHeavyEquip) {
          score -= 5;
          factors.push('Requires unavailable equipment (-5)');
        }
      }

      return { exercise: ex, score, factors };
    });

    scored.sort((a, b) => b.score - a.score);

    for (const item of scored.slice(0, 5)) {
      decisions.push({
        exerciseName: item.exercise.name,
        muscleGroup: group.muscleGroup,
        score: Math.round(item.score * 10) / 10,
        factors: item.factors,
      });
    }

    let remainingSets = group.targetSets;

    // Determine max exercises from user's actual patterns for this group
    const userExercisesForGroup = scored.filter(s => {
      const p = prefMap.get(s.exercise.name.toLowerCase());
      return p && p.recentSessions >= 1;
    }).length;
    const defaultMax = remainingSets <= 4 ? 1 : remainingSets <= 8 ? 2 : 3;
    const maxExercises = userExercisesForGroup > 0
      ? Math.min(userExercisesForGroup, 4)
      : defaultMax;

    // Sort by overall score — user preferences already dominate
    const ordered = [...scored].sort((a, b) => b.score - a.score);

    let exerciseCount = 0;
    for (const item of ordered) {
      if (exerciseCount >= maxExercises || remainingSets <= 0) break;

      const setsForThis = exerciseCount === 0
        ? Math.min(Math.ceil(remainingSets * 0.6), 5)
        : Math.min(remainingSets, 4);

      selections.push({
        exercise: item.exercise,
        muscleGroup: group.muscleGroup,
        sets: Math.max(2, setsForThis),
        reason: exerciseCount === 0
          ? `Primary ${group.muscleGroup} exercise (score: ${item.score.toFixed(1)})`
          : `Additional ${group.muscleGroup} volume (score: ${item.score.toFixed(1)})`,
      });

      usedExercises.add(item.exercise.name.toLowerCase());
      remainingSets -= setsForThis;
      exerciseCount++;
    }
  }

  // Add ALL cardio exercises the user regularly does — detect from multiple sources
  const isCardioExercise = (exerciseName: string): boolean => {
    const key = exerciseName.toLowerCase();
    // Source 1: exercise library tag
    const libEx = allExercises.find(e => e.name.toLowerCase() === key);
    if (libEx?.ml_exercise_type === 'cardio') return true;
    // Source 2: local muscle map
    const mapping = getExerciseMapping(exerciseName);
    if (mapping?.exercise_type === 'cardio') return true;
    // Source 3: appears in computed cardio history
    if (profile.cardioHistory.some(c => c.exerciseName === key)) return true;
    return false;
  };

  const cardioPrefs = profile.exercisePreferences.filter(p =>
    isCardioExercise(p.exerciseName) && p.recentSessions >= 1
  );

  for (const cardioPref of cardioPrefs) {
    let cardioEx = allExercises.find(e => e.name.toLowerCase() === cardioPref.exerciseName);
    // If not in library, synthesize from muscle map so we still include it
    if (!cardioEx) {
      const mapping = getExerciseMapping(cardioPref.exerciseName);
      if (mapping) {
        cardioEx = {
          id: `synth-${cardioPref.exerciseName}`,
          name: cardioPref.exerciseName,
          body_part: 'cardio',
          primary_muscles: mapping.primary_muscles ?? [],
          secondary_muscles: mapping.secondary_muscles ?? [],
          stabilizer_muscles: mapping.stabilizer_muscles ?? [],
          movement_pattern: mapping.movement_pattern,
          ml_exercise_type: 'cardio',
          force_type: mapping.force_type,
          difficulty: mapping.difficulty,
          default_tempo: mapping.default_tempo ?? null,
          equipment: null,
        } as EnrichedExercise;
      }
    }
    if (!cardioEx || avoidSet.has(cardioEx.name.toLowerCase())) continue;

    const cardioHist = profile.cardioHistory.find(c => c.exerciseName === cardioPref.exerciseName);
    const durationInfo = cardioHist
      ? `avg ${Math.round(cardioHist.avgDurationSeconds / 60)} min${cardioHist.avgSpeed != null ? `, intensity: ${cardioHist.avgSpeed}` : ''}`
      : '';

    selections.push({
      exercise: cardioEx,
      muscleGroup: 'cardio',
      sets: 1,
      reason: `Cardio — ${cardioPref.recentSessions} recent sessions${durationInfo ? `, ${durationInfo}` : ''}`,
      isCardio: true,
    });
    decisions.push({
      exerciseName: cardioEx.name,
      muscleGroup: 'cardio',
      score: cardioPref.recencyScore,
      factors: [
        `User does this ${cardioPref.recentSessions}x in last 4 weeks`,
        `Total: ${cardioPref.totalSessions} sessions`,
        cardioHist ? `Avg duration: ${Math.round(cardioHist.avgDurationSeconds / 60)} min` : 'No duration data',
        cardioHist?.avgSpeed != null ? `Avg intensity: ${cardioHist.avgSpeed}` : '',
        `Recency score: ${cardioPref.recencyScore}`,
      ].filter(Boolean),
    });
  }

  return { selections, decisions };
}

// ─── Step 4: Prescribe Sets/Reps/Weight/Tempo ───────────────────────────────

function stepPrescribe(
  selections: ExerciseSelection[],
  profile: TrainingProfile,
  prefs: UserPreferences,
  recoveryAdj: RecoveryAdjustment
): GeneratedExercise[] {
  const repRange = getRepRange(prefs.training_goal);

  return selections.map(sel => {
    // Handle cardio with real duration/intensity from history
    if (sel.isCardio || sel.exercise.ml_exercise_type === 'cardio') {
      const cardio = profile.cardioHistory.find(c => c.exerciseName === sel.exercise.name.toLowerCase());
      const pref = profile.exercisePreferences.find(p => p.exerciseName === sel.exercise.name.toLowerCase());

      let duration = cardio?.lastDurationSeconds ?? cardio?.avgDurationSeconds ?? 1800;
      let speed = cardio?.lastSpeed ?? cardio?.avgSpeed ?? null;
      let incline = cardio?.lastIncline ?? cardio?.avgIncline ?? null;
      const adjustments: string[] = [];

      if (recoveryAdj.isDeload) {
        duration = Math.round(duration * 0.8);
        adjustments.push('Deload: duration reduced 20%');
        if (speed != null) {
          speed = Math.round(speed * 0.85 * 10) / 10;
          adjustments.push('Deload: intensity reduced 15%');
        }
      } else if (cardio && cardio.trendDuration === 'increasing') {
        adjustments.push(`Duration trending up — maintaining at ${Math.round(duration / 60)} min`);
      } else if (cardio && cardio.trendIntensity === 'increasing') {
        adjustments.push(`Intensity trending up — good progressive overload`);
      }

      // Determine the right label for speed/intensity
      const exName = sel.exercise.name.toLowerCase();
      let speedLabel: string | null = null;
      if (exName.includes('stairmaster') || exName.includes('stair master')) speedLabel = 'Level';
      else if (exName.includes('bike') || exName.includes('cycle')) speedLabel = 'Resistance';
      else if (exName.includes('row')) speedLabel = 'Watts';
      else if (exName.includes('treadmill') || exName.includes('walk') || exName.includes('run')) speedLabel = 'Speed (mph)';
      else if (speed != null) speedLabel = 'Intensity';

      const rationale = cardio
        ? `Based on your last ${cardio.totalSessions} sessions (${cardio.recentSessions} recent). Avg: ${Math.round(cardio.avgDurationSeconds / 60)} min${cardio.avgSpeed != null ? `, ${speedLabel ?? 'intensity'}: ${cardio.avgSpeed}` : ''}`
        : `Cardio — you do this ${pref?.recentSessions ?? 0}x per month`;

      return {
        exerciseName: sel.exercise.name,
        exerciseLibraryId: sel.exercise.id,
        bodyPart: sel.exercise.body_part,
        primaryMuscles: Array.isArray(sel.exercise.primary_muscles) ? sel.exercise.primary_muscles : [],
        secondaryMuscles: Array.isArray(sel.exercise.secondary_muscles) ? sel.exercise.secondary_muscles : [],
        movementPattern: sel.exercise.movement_pattern ?? 'cardio',
        targetMuscleGroup: sel.muscleGroup,
        sets: 1,
        targetReps: 0,
        targetWeight: null,
        isBodyweight: false,
        tempo: '0-0-0',
        restSeconds: 0,
        rationale,
        adjustments,
        isDeload: recoveryAdj.isDeload,
        isCardio: true,
        cardioDurationSeconds: duration,
        cardioSpeed: speed,
        cardioIncline: incline,
        cardioSpeedLabel: speedLabel,
      };
    }

    const prog = profile.exerciseProgressions.find(
      p => p.exerciseName === sel.exercise.name.toLowerCase()
    );

    let targetWeight: number | null = null;
    const adjustments: string[] = [];

    if (prog) {
      targetWeight = prog.lastWeight;

      if (recoveryAdj.isDeload) {
        targetWeight = Math.round(targetWeight * 0.9);
        adjustments.push('Deload: weight at 90%');
      } else if (prog.status === 'progressing') {
        const isLower = ['quadriceps', 'hamstrings', 'glutes'].includes(sel.muscleGroup);
        const increment = isLower ? 10 : 5;
        targetWeight = targetWeight + increment;
        adjustments.push(`Progressive overload: +${increment} lbs (was ${prog.lastWeight})`);
      } else if (prog.status === 'stalled') {
        adjustments.push(`Stalled at ${targetWeight} lbs: try higher reps this session`);
      } else if (prog.status === 'regressing') {
        targetWeight = Math.round(targetWeight * 0.9);
        adjustments.push(`Regressing: reduced to ${targetWeight} lbs (90% of ${prog.lastWeight})`);
      }

      // Sleep-performance learned adjustment
      if (profile.sleepCoefficients.confidence !== 'low' && profile.recoveryContext.sleepDurationLastNight != null && profile.recoveryContext.sleepBaseline30d != null) {
        const sleepDelta = (profile.recoveryContext.sleepDurationLastNight - profile.recoveryContext.sleepBaseline30d) / profile.recoveryContext.sleepBaseline30d;
        if (sleepDelta < -0.1) {
          const isLower = ['quadriceps', 'hamstrings', 'glutes'].includes(sel.muscleGroup);
          const coeff = isLower ? profile.sleepCoefficients.lowerBody : profile.sleepCoefficients.upperBody;
          if (Math.abs(coeff) > 0.1) {
            const weightAdj = Math.round(coeff * sleepDelta * (targetWeight ?? 100));
            if (weightAdj < -2) {
              targetWeight = (targetWeight ?? 0) + weightAdj;
              adjustments.push(`Sleep-performance: ${weightAdj} lbs (learned from your data)`);
            }
          }
        }
      }

      if (profile.bodyWeightTrend.phase === 'cutting' && prog.status !== 'regressing') {
        adjustments.push('Cutting phase: maintaining weight is success');
      }
    }

    // Plateau strategy
    const plateau = profile.plateauDetections.find(
      p => p.exerciseName === sel.exercise.name.toLowerCase() && p.isPlateaued
    );
    if (plateau?.suggestedStrategy) {
      adjustments.push(`Plateau: ${plateau.suggestedStrategy}`);
    }

    const tempo = getTempo(sel.exercise.default_tempo, prefs.training_goal, sel.exercise.ml_exercise_type);
    const restSeconds = getRestSeconds(sel.exercise.ml_exercise_type, prefs.training_goal);
    const sets = recoveryAdj.isDeload ? Math.max(2, Math.ceil(sel.sets * 0.5)) : sel.sets;

    const equipment = Array.isArray(sel.exercise.equipment) ? sel.exercise.equipment : [];
    const isBodyweight = equipment.length === 1 && equipment[0] === 'bodyweight';

    return {
      exerciseName: sel.exercise.name,
      exerciseLibraryId: sel.exercise.id,
      bodyPart: sel.exercise.body_part,
      primaryMuscles: Array.isArray(sel.exercise.primary_muscles) ? sel.exercise.primary_muscles : [],
      secondaryMuscles: Array.isArray(sel.exercise.secondary_muscles) ? sel.exercise.secondary_muscles : [],
      movementPattern: sel.exercise.movement_pattern ?? 'unknown',
      targetMuscleGroup: sel.muscleGroup,
      sets,
      targetReps: repRange.target,
      targetWeight: isBodyweight ? null : (targetWeight ? Math.round(targetWeight) : null),
      isBodyweight,
      tempo,
      restSeconds,
      rationale: sel.reason,
      adjustments,
      isDeload: recoveryAdj.isDeload,
      isCardio: false,
      cardioDurationSeconds: null,
      cardioSpeed: null,
      cardioIncline: null,
      cardioSpeedLabel: null,
    };
  });
}

// ─── Step 5: Apply Session Constraints (Intelligent Ordering) ───────────────

const CNS_DEMAND_KEYWORDS: [RegExp, number][] = [
  [/\bdeadlift\b/i, 0],
  [/\bsquat\b/i, 0],
  [/\bfront squat\b/i, 0],
  [/\bpower clean\b/i, 0],
  [/\bclean and press\b/i, 0],
  [/\bsnatch\b/i, 0],
  [/\bbench press\b/i, 1],
  [/\boverhead press\b/i, 1],
  [/\bmilitary press\b/i, 1],
  [/\bbarbell row\b/i, 1],
  [/\bromanian deadlift\b/i, 1],
  [/\bhip thrust\b/i, 1],
  [/\bpendlay row\b/i, 1],
  [/\bt-bar row\b/i, 1],
  [/\bincline.*press\b/i, 2],
  [/\bdumbbell.*press\b/i, 2],
  [/\bdb.*press\b/i, 2],
  [/\blunge\b/i, 2],
  [/\bbulgarian\b/i, 2],
  [/\bpull-?up\b/i, 2],
  [/\bchin-?up\b/i, 2],
  [/\bdip\b/i, 2],
  [/\brow\b/i, 2],
];

function getCnsDemandTier(ex: GeneratedExercise): number {
  const name = ex.exerciseName.toLowerCase();
  for (const [pattern, tier] of CNS_DEMAND_KEYWORDS) {
    if (pattern.test(name)) return tier;
  }
  if (ex.movementPattern === 'compound') return 2;
  if (name.includes('machine') || name.includes('cable') || name.includes('smith')) return 3;
  if (ex.movementPattern === 'isolation') return 4;
  return 3;
}

function stepApplyConstraints(
  exercises: GeneratedExercise[],
  prefs: UserPreferences,
  profile: TrainingProfile
): GeneratedExercise[] {
  const cardio = exercises.filter(e => e.isCardio);
  const strength = exercises.filter(e => !e.isCardio);

  const orderProfiles = profile.exerciseOrderProfiles ?? [];
  const positionMap = new Map<string, ExerciseOrderProfile>();
  for (const op of orderProfiles) {
    positionMap.set(op.exerciseName, op);
  }

  // Determine muscle group ordering from step 2 priority
  // Groups were already sorted by priority. Preserve that order for coherence.
  const groupOrder: string[] = [];
  for (const ex of strength) {
    if (!groupOrder.includes(ex.targetMuscleGroup)) {
      groupOrder.push(ex.targetMuscleGroup);
    }
  }

  // Build ordered output: group exercises by targetMuscleGroup, then sort within
  const ordered: GeneratedExercise[] = [];

  for (const group of groupOrder) {
    const groupExercises = strength.filter(e => e.targetMuscleGroup === group);

    const scored = groupExercises.map(ex => {
      const hist = positionMap.get(ex.exerciseName.toLowerCase());
      const cnsTier = getCnsDemandTier(ex);

      let withinGroupScore: number;
      if (hist && hist.sessions >= 3) {
        // User has established ordering preferences — respect them
        withinGroupScore = hist.avgNormalizedPosition * 50 + cnsTier * 10;
      } else {
        // No user data — CNS demand is the primary signal
        withinGroupScore = cnsTier * 20;
      }

      return { exercise: ex, withinGroupScore, cnsTier };
    });

    scored.sort((a, b) => a.withinGroupScore - b.withinGroupScore);
    ordered.push(...scored.map(s => s.exercise));
  }

  // Apply interference avoidance: check if any adjacent pair has known negative interference
  for (let i = 0; i < ordered.length - 1; i++) {
    const current = ordered[i].exerciseName.toLowerCase();
    const next = ordered[i + 1].exerciseName.toLowerCase();
    const interference = profile.exerciseOrderingEffects.find(
      e => e.precedingExercise === current && e.affectedExercise === next && e.interference < -0.08
    );
    if (interference && i + 2 < ordered.length) {
      // Swap next with the one after it to avoid interference
      [ordered[i + 1], ordered[i + 2]] = [ordered[i + 2], ordered[i + 1]];
    }
  }

  // Reserve time for cardio before fitting strength exercises
  const cardioMinutes = cardio.reduce(
    (sum, ex) => sum + (ex.cardioDurationSeconds ?? 1800) / 60, 0
  );
  const strengthBudget = Math.max(
    prefs.session_duration_minutes - cardioMinutes - 5, // 5 min warm-up
    30 // absolute minimum for strength
  );

  // Trim strength exercises to fit within the strength budget
  let strengthMinutes = 0;
  const fittedStrength: GeneratedExercise[] = [];
  for (const ex of ordered) {
    const duration = estimateExerciseDuration(ex.sets, ex.restSeconds);
    if (strengthMinutes + duration > strengthBudget && fittedStrength.length >= 3) {
      break;
    }
    strengthMinutes += duration;
    fittedStrength.push(ex);
  }

  // Cardio is always included — it's part of the user's training
  return [...fittedStrength, ...cardio];
}

// ─── Step 6: Generate Rationale ─────────────────────────────────────────────

function stepGenerateRationale(
  exercises: GeneratedExercise[],
  muscleGroups: MuscleGroupSelection[],
  recoveryAdj: RecoveryAdjustment,
  profile: TrainingProfile,
  prefs: UserPreferences,
  skippedGroups: Array<{ muscleGroup: string; reason: string }>,
  exerciseDecisions: ExerciseDecision[]
): GeneratedWorkout {
  const muscleGroupsFocused = muscleGroups.map(g => g.muscleGroup);
  const muscleReasons = muscleGroups.map(g => `${g.muscleGroup}: ${g.reason}`);

  const totalDuration = exercises.reduce(
    (sum, ex) => sum + estimateExerciseDuration(ex.sets, ex.restSeconds), 5
  );

  let recoveryStatus = 'Good';
  if (recoveryAdj.isDeload) {
    recoveryStatus = 'Deload recommended';
  } else if (recoveryAdj.volumeMultiplier < 0.85) {
    recoveryStatus = 'Reduced capacity';
  }

  const splitInfo = profile.detectedSplit.confidence >= 0.5
    ? `Detected split: ${profile.detectedSplit.type.replace(/_/g, ' ')} (${Math.round(profile.detectedSplit.confidence * 100)}% confidence)`
    : 'No clear split detected — using volume-based selection';

  const todayDow = new Date().getDay();
  const todayPattern = profile.dayOfWeekPatterns[todayDow];
  const dayInfo = todayPattern && !todayPattern.isRestDay
    ? `Typical ${todayPattern.dayName}: ${todayPattern.muscleGroupsTypical.slice(0, 4).join(', ')} (${Math.round(todayPattern.frequency * 100)}% of weeks)`
    : null;

  const goalInfo = prefs.performance_goals.length > 0
    ? `Performance goals: ${prefs.performance_goals.map(g => `${g.exercise} ${g.targetWeight}×${g.targetReps}`).join(', ')}`
    : null;

  const sessionRationale = [
    splitInfo,
    prefs.preferred_split ? `Preferred split: ${prefs.preferred_split.replace(/_/g, ' ')}` : null,
    profile.detectedSplit.nextRecommended.length > 0
      ? `Split recommends: ${profile.detectedSplit.nextRecommended.join(', ')} day`
      : null,
    dayInfo,
    `Targeting: ${muscleGroupsFocused.join(', ')}`,
    ...muscleReasons,
    `Goal: ${prefs.training_goal}`,
    goalInfo,
    `Recovery status: ${recoveryStatus}`,
    profile.bodyWeightTrend.phase !== 'maintaining'
      ? `Weight trend: ${profile.bodyWeightTrend.phase} (${profile.bodyWeightTrend.slope > 0 ? '+' : ''}${profile.bodyWeightTrend.slope} lbs/week)`
      : null,
  ].filter(Boolean).join('\n');

  // Build decision log
  const decisionLog: DecisionLogEntry[] = [];

  decisionLog.push({
    step: '1',
    label: 'Recovery Check',
    details: recoveryAdj.isDeload
      ? [`DELOAD TRIGGERED: ${recoveryAdj.adjustmentReasons.join('; ')}`]
      : recoveryAdj.adjustmentReasons.length > 0
        ? [`Volume multiplier: ${(recoveryAdj.volumeMultiplier * 100).toFixed(0)}%`, ...recoveryAdj.adjustmentReasons]
        : ['All recovery signals normal — no adjustments needed'],
  });

  decisionLog.push({
    step: '2',
    label: 'Split Detection & Muscle Group Selection',
    details: [
      splitInfo,
      ...(profile.detectedSplit.evidence ?? []),
      dayInfo ?? `${todayPattern?.dayName ?? 'Today'}: typical rest day`,
      `Selected ${muscleGroups.length} groups from ${muscleGroups.length + skippedGroups.length} candidates`,
      ...muscleGroups.map(g => `✓ ${g.muscleGroup}: ${g.reason} (priority: ${g.priority.toFixed(2)}, ${g.targetSets} sets)`),
      ...skippedGroups.map(g => `✗ ${g.muscleGroup}: ${g.reason}`),
    ].filter((d): d is string => d != null),
  });

  decisionLog.push({
    step: '3',
    label: 'Exercise Selection',
    details: exercises.map(ex => `${ex.exerciseName}: ${ex.rationale}`),
  });

  decisionLog.push({
    step: '4',
    label: 'Prescription',
    details: exercises.map(ex => {
      const parts = [`${ex.exerciseName}: ${ex.sets}×${ex.targetReps}`];
      if (ex.targetWeight) parts[0] += ` @ ${ex.targetWeight} lbs`;
      parts[0] += ` (tempo: ${ex.tempo}, rest: ${ex.restSeconds}s)`;
      if (ex.adjustments.length > 0) parts.push(`  Adjustments: ${ex.adjustments.join('; ')}`);
      return parts.join('\n');
    }),
  });

  const groupOrder: string[] = [];
  for (const ex of exercises) {
    if (!groupOrder.includes(ex.targetMuscleGroup)) groupOrder.push(ex.targetMuscleGroup);
  }

  const orderingDetails: string[] = [
    `Session duration limit: ${prefs.session_duration_minutes} min`,
    `Estimated duration: ${Math.round(totalDuration)} min`,
    `Muscle group order: ${groupOrder.join(' → ')}`,
  ];
  for (const ex of exercises) {
    const hist = (profile.exerciseOrderProfiles ?? []).find(
      p => p.exerciseName === ex.exerciseName.toLowerCase()
    );
    if (hist && hist.sessions >= 3) {
      orderingDetails.push(`${ex.exerciseName}: historical position ${hist.positionCategory} (avg ${hist.avgNormalizedPosition}, ${hist.sessions} sessions)`);
    } else {
      orderingDetails.push(`${ex.exerciseName}: CNS-based ordering (no historical data)`);
    }
  }

  decisionLog.push({
    step: '5',
    label: 'Exercise Ordering',
    details: orderingDetails,
  });

  // Step 6: Evidence basis — surface the science driving decisions
  const scienceDetails: string[] = [];
  for (const g of muscleGroups) {
    const guideline = getGuidelineForGroup(g.muscleGroup);
    if (guideline) {
      scienceDetails.push(
        `${g.muscleGroup}: MEV=${guideline.mev}, MAV=${guideline.mavLow}-${guideline.mavHigh}, MRV=${guideline.mrv} sets/wk, recovery=${guideline.recoveryHours}h`
      );
      const indMrv = profile.individualMrvEstimates[g.muscleGroup];
      if (indMrv) {
        scienceDetails.push(`  → Your individual MRV estimate: ${indMrv} sets/wk (learned from your data, overrides population defaults)`);
      }
    }
  }
  scienceDetails.push('');
  scienceDetails.push('Research basis:');
  scienceDetails.push('Volume targets: Schoenfeld et al. (2017) J Sports Sci, Krieger (2010) J Strength Cond Res');
  scienceDetails.push('Recovery windows: Damas et al. (2019), Schoenfeld, Ogborn & Krieger (2016)');
  scienceDetails.push('Progressive overload: Helms, Morgan & Valdez — Muscle & Strength Pyramids (2nd ed.)');
  scienceDetails.push('Volume landmarks: Nuckols (2017) Stronger By Science, Ralston et al. (2017) Sports Med');
  if (profile.sleepCoefficients.confidence !== 'low') {
    scienceDetails.push(`Sleep-performance coefficient: upper body ${profile.sleepCoefficients.upperBody.toFixed(3)}, lower body ${profile.sleepCoefficients.lowerBody.toFixed(3)} (learned from ${profile.sleepCoefficients.dataPoints} data points)`);
  }

  decisionLog.push({
    step: '6',
    label: 'Evidence Basis',
    details: scienceDetails,
  });

  const muscleGroupDecisions: MuscleGroupDecision[] = muscleGroups.map(g => ({
    muscleGroup: g.muscleGroup,
    priority: Math.round(g.priority * 100) / 100,
    reason: g.reason,
    targetSets: g.targetSets,
    recoveryPercent: g.recoveryPercent,
    weeklyVolume: g.weeklyVolume,
    volumeTarget: g.volumeTarget,
  }));

  return {
    id: generateId(),
    date: new Date().toISOString().split('T')[0],
    trainingGoal: prefs.training_goal,
    estimatedDurationMinutes: Math.round(totalDuration),
    muscleGroupsFocused,
    exercises,
    sessionRationale,
    recoveryStatus,
    adjustmentsSummary: recoveryAdj.adjustmentReasons,
    deloadActive: recoveryAdj.isDeload,
    decisionLog,
    muscleGroupDecisions,
    exerciseDecisions,
  };
}

// ─── Main Entry Point ───────────────────────────────────────────────────────

export async function generateWorkout(
  profile: TrainingProfile,
  goalOverride?: string
): Promise<GeneratedWorkout> {
  const [prefs, allExercises] = await Promise.all([
    fetchUserPreferences(profile.userId),
    fetchAllExercises(),
  ]);

  if (goalOverride) {
    (prefs as any).training_goal = goalOverride;
  }

  // Step 1: Recovery check
  const recoveryAdj = stepRecoveryCheck(profile);

  // Step 2: Select muscle groups
  const { selected: muscleGroups, skipped: skippedGroups } = stepSelectMuscleGroups(profile, prefs, recoveryAdj);

  // Step 3: Select exercises
  const { selections: exerciseSelections, decisions: exerciseDecisions } = stepSelectExercises(muscleGroups, allExercises, profile, prefs);

  // Step 4: Prescribe sets/reps/weight/tempo
  const prescribed = stepPrescribe(exerciseSelections, profile, prefs, recoveryAdj);

  // Step 5: Apply session constraints
  const constrained = stepApplyConstraints(prescribed, prefs, profile);

  // Step 6: Generate rationale + decision log
  const workout = stepGenerateRationale(constrained, muscleGroups, recoveryAdj, profile, prefs, skippedGroups, exerciseDecisions);

  return workout;
}

/**
 * Saves a generated workout to the database for future comparison with actuals.
 */
export async function saveGeneratedWorkout(
  userId: string,
  workout: GeneratedWorkout
): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase
    .from('generated_workouts')
    .insert({
      id: workout.id,
      user_id: userId,
      date: workout.date,
      training_goal: workout.trainingGoal,
      session_duration_minutes: workout.estimatedDurationMinutes,
      recovery_status: {
        status: workout.recoveryStatus,
        deload: workout.deloadActive,
        adjustments: workout.adjustmentsSummary,
      },
      exercises: workout.exercises,
      rationale: workout.sessionRationale,
      adjustments: workout.adjustmentsSummary,
    });

  if (error) throw error;
}
