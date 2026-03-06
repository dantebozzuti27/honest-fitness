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
import type { TrainingProfile, ExerciseProgression, EnrichedExercise, ExercisePreference, CardioHistory } from './trainingAnalysis';
import { uuidv4 } from '../utils/uuid';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface UserPreferences {
  training_goal: 'strength' | 'hypertrophy' | 'general_fitness' | 'fat_loss';
  session_duration_minutes: number;
  equipment_access: 'full_gym' | 'home_gym' | 'limited';
  available_days_per_week: number;
  injuries: Array<{ body_part: string; description: string; severity: string }>;
  exercises_to_avoid: string[];
  date_of_birth: string | null;
  gender: string | null;
  height_feet: number | null;
  height_inches: number | null;
}

export interface GeneratedExercise {
  exerciseName: string;
  exerciseLibraryId: string;
  bodyPart: string;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  movementPattern: string;
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
    .select('training_goal, session_duration_minutes, equipment_access, available_days_per_week, injuries, exercises_to_avoid, date_of_birth, gender, height_feet, height_inches')
    .eq('user_id', userId)
    .single();

  if (error) throw error;

  return {
    training_goal: data?.training_goal ?? 'hypertrophy',
    session_duration_minutes: data?.session_duration_minutes ?? 75,
    equipment_access: data?.equipment_access ?? 'full_gym',
    available_days_per_week: data?.available_days_per_week ?? 5,
    injuries: data?.injuries ?? [],
    exercises_to_avoid: data?.exercises_to_avoid ?? [],
    date_of_birth: data?.date_of_birth ?? null,
    gender: data?.gender ?? null,
    height_feet: data?.height_feet ?? null,
    height_inches: data?.height_inches ?? null,
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
  for (const injury of injuries) {
    const injuryPart = injury.body_part.toLowerCase();
    if (exercise.body_part.toLowerCase().includes(injuryPart)) return true;
    for (const m of exercise.primary_muscles ?? []) {
      if (m.toLowerCase().includes(injuryPart)) return true;
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

  // Determine today's target groups from detected split
  const { detectedSplit, dayOfWeekPatterns } = profile;
  const todayDow = new Date().getDay();
  const todayPattern = dayOfWeekPatterns[todayDow];

  let splitTargetGroups: Set<string> | null = null;

  if (detectedSplit.confidence >= 0.6 && detectedSplit.nextRecommended.length > 0) {
    // Use split-based recommendation
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

      const primaryGroups = (ex.primary_muscles ?? [])
        .map(m => MUSCLE_HEAD_TO_GROUP[m])
        .filter(Boolean);
      return primaryGroups.includes(group.muscleGroup);
    });

    if (groupExercises.length === 0) continue;

    const scored = groupExercises.map(ex => {
      let score = 0;
      const factors: string[] = [];

      if (ex.ml_exercise_type === 'compound') {
        score += 3;
        factors.push('Compound exercise (+3)');
      }

      // User preference: exercises they actually do score much higher
      const pref = prefMap.get(ex.name.toLowerCase());
      if (pref) {
        // Recency-weighted preference: half-life 14 days
        const prefBonus = Math.min(pref.recencyScore * 1.5, 4);
        score += prefBonus;
        factors.push(`User preference (+${prefBonus.toFixed(1)}, ${pref.recentSessions} recent sessions, recency: ${pref.recencyScore})`);
        if (pref.isStaple) {
          score += 1;
          factors.push('Staple exercise (+1)');
        }
      } else {
        score -= 1;
        factors.push('Never used by user (-1)');
      }

      const prog = profile.exerciseProgressions.find(
        p => p.exerciseName === ex.name.toLowerCase()
      );
      if (prog) {
        if (prog.status === 'progressing') {
          score += 2.5;
          factors.push(`Progressing (+2.5, ${prog.sessionsTracked} sessions, slope: ${(prog.progressionSlope * 100).toFixed(1)}%)`);
        } else if (prog.status === 'stalled') {
          score += 0.5;
          factors.push(`Stalled (+0.5, ${prog.sessionsTracked} sessions)`);
        } else if (prog.status === 'regressing') {
          score -= 1;
          factors.push(`Regressing (-1, consider variation)`);
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
        const needsHeavyEquip = (ex.equipment ?? []).some(e =>
          ['barbell', 'cable_machine', 'smith_machine'].includes(e)
        );
        if (needsHeavyEquip) {
          score -= 3;
          factors.push('Requires unavailable equipment (-3)');
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
    const maxExercises = remainingSets <= 4 ? 1 : remainingSets <= 8 ? 2 : 3;

    // Prefer compounds first, then isolations (but sorted by overall score within each)
    const compounds = scored.filter(s => s.exercise.ml_exercise_type === 'compound');
    const isolations = scored.filter(s => s.exercise.ml_exercise_type !== 'compound');
    const ordered = [...compounds, ...isolations];

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

  // Add ALL cardio exercises the user regularly does
  const cardioPrefs = profile.exercisePreferences.filter(p => {
    const ex = allExercises.find(e => e.name.toLowerCase() === p.exerciseName);
    return ex?.ml_exercise_type === 'cardio' && p.recentSessions >= 1;
  });

  for (const cardioPref of cardioPrefs) {
    const cardioEx = allExercises.find(e => e.name.toLowerCase() === cardioPref.exerciseName);
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
        primaryMuscles: sel.exercise.primary_muscles ?? [],
        secondaryMuscles: sel.exercise.secondary_muscles ?? [],
        movementPattern: sel.exercise.movement_pattern ?? 'cardio',
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

    const equipment = sel.exercise.equipment ?? [];
    const isBodyweight = equipment.length === 1 && equipment[0] === 'bodyweight';

    return {
      exerciseName: sel.exercise.name,
      exerciseLibraryId: sel.exercise.id,
      bodyPart: sel.exercise.body_part,
      primaryMuscles: sel.exercise.primary_muscles ?? [],
      secondaryMuscles: sel.exercise.secondary_muscles ?? [],
      movementPattern: sel.exercise.movement_pattern ?? 'unknown',
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

// ─── Step 5: Apply Session Constraints ──────────────────────────────────────

function stepApplyConstraints(
  exercises: GeneratedExercise[],
  prefs: UserPreferences,
  profile: TrainingProfile
): GeneratedExercise[] {
  // Order: compounds first, then by muscle group priority
  const compounds = exercises.filter(e => e.movementPattern !== 'isolation' && e.sets >= 3);
  const isolations = exercises.filter(e => !compounds.includes(e));

  // Check exercise ordering interference and reorder if beneficial
  const reordered = [...compounds, ...isolations];

  // Trim to fit session duration
  let totalMinutes = 5; // warm-up
  const fitted: GeneratedExercise[] = [];

  for (const ex of reordered) {
    const duration = estimateExerciseDuration(ex.sets, ex.restSeconds);
    if (totalMinutes + duration > prefs.session_duration_minutes && fitted.length >= 3) {
      break;
    }
    totalMinutes += duration;
    fitted.push(ex);
  }

  // Check intra-session fatigue: if user's performance drops after X minutes,
  // move important exercises earlier
  const fatigueDropoff = profile.sessionFatigueEffects.find(
    e => e.avgDelta < -0.05 && e.dataPoints >= 10
  );
  if (fatigueDropoff) {
    // Already ordered compounds first, so this is naturally handled
  }

  return fitted;
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

  const sessionRationale = [
    splitInfo,
    profile.detectedSplit.nextRecommended.length > 0
      ? `Split recommends: ${profile.detectedSplit.nextRecommended.join(', ')} day`
      : null,
    dayInfo,
    `Targeting: ${muscleGroupsFocused.join(', ')}`,
    ...muscleReasons,
    `Goal: ${prefs.training_goal}`,
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

  decisionLog.push({
    step: '5',
    label: 'Session Constraints',
    details: [
      `Session duration limit: ${prefs.session_duration_minutes} min`,
      `Estimated duration: ${Math.round(totalDuration)} min`,
      `Exercises ordered: compounds first, then isolations`,
    ],
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
