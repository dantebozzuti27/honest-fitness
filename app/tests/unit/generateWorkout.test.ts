/**
 * End-to-end generation smoke suite — the first tests that actually drive
 * `generateWorkout()` rather than isolated sub-modules.
 *
 * Strategy: synthesize a realistic 6-week push/pull/legs history, run it
 * through the REAL `computeTrainingProfileFromData` to get an internally
 * consistent TrainingProfile, then call `generateWorkout` with a prefetched
 * preferences + library so the engine performs zero network/DB IO.
 *
 * Assertions deliberately target engine *guarantees* (structural validity,
 * determinism, constraint honoring) rather than specific exercise picks, so
 * the suite is a regression net without being brittle to scoring tweaks.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  generateWorkout,
  type UserPreferences,
  type GeneratedWorkout,
} from '../../src/lib/workoutEngine';
import {
  computeTrainingProfileFromData,
  type EnrichedExercise,
  type WorkoutRecord,
  type SetRecord,
  type ExerciseRecord,
  type PreFetchedTrainingData,
} from '../../src/lib/trainingAnalysis';

// ── Synthetic exercise library ──────────────────────────────────────────────
function lib(
  id: string,
  name: string,
  body_part: string,
  primary: string[],
  movement: string,
  type: 'compound' | 'isolation' | 'cardio',
  equipment: string[],
): EnrichedExercise {
  return {
    id,
    name,
    body_part,
    primary_muscles: primary,
    secondary_muscles: [],
    stabilizer_muscles: [],
    movement_pattern: movement as never,
    ml_exercise_type: type as never,
    force_type: (type === 'cardio' ? null : 'push') as never,
    difficulty: 'intermediate' as never,
    default_tempo: '2010',
    equipment,
  };
}

const LIBRARY: EnrichedExercise[] = [
  // Push
  lib('e_bench', 'Barbell Bench Press', 'chest', ['mid_chest'], 'horizontal_push', 'compound', ['barbell']),
  lib('e_incline', 'Incline Dumbbell Press', 'chest', ['mid_chest'], 'horizontal_push', 'compound', ['dumbbell']),
  lib('e_cablefly', 'Cable Fly', 'chest', ['mid_chest'], 'horizontal_push', 'isolation', ['cable']),
  lib('e_ohp', 'Overhead Press', 'shoulders', ['front_delts'], 'vertical_push', 'compound', ['barbell']),
  lib('e_lateral', 'Lateral Raise', 'shoulders', ['side_delts'], 'vertical_push', 'isolation', ['dumbbell']),
  lib('e_pushdown', 'Triceps Pushdown', 'arms', ['triceps'], 'extension', 'isolation', ['cable']),
  // Pull
  lib('e_pulldown', 'Lat Pulldown', 'back', ['back_lats'], 'vertical_pull', 'compound', ['cable']),
  lib('e_row', 'Barbell Row', 'back', ['back_lats'], 'horizontal_pull', 'compound', ['barbell']),
  lib('e_curl', 'Barbell Curl', 'arms', ['biceps'], 'curl', 'isolation', ['barbell']),
  lib('e_hammer', 'Hammer Curl', 'arms', ['biceps'], 'curl', 'isolation', ['dumbbell']),
  lib('e_facepull', 'Face Pull', 'shoulders', ['rear_delts'], 'horizontal_pull', 'isolation', ['cable']),
  // Legs
  lib('e_squat', 'Barbell Back Squat', 'legs', ['quadriceps'], 'squat', 'compound', ['barbell']),
  lib('e_legpress', 'Leg Press', 'legs', ['quadriceps'], 'squat', 'compound', ['machine']),
  lib('e_rdl', 'Romanian Deadlift', 'legs', ['hamstrings'], 'hinge', 'compound', ['barbell']),
  lib('e_legcurl', 'Seated Leg Curl', 'legs', ['hamstrings'], 'hinge', 'isolation', ['machine']),
  lib('e_calf', 'Standing Calf Raise', 'legs', ['calves'], 'extension', 'isolation', ['machine']),
  // Cardio
  lib('e_tread', 'Treadmill Run', 'cardio', ['cardio'], 'cardio', 'cardio', ['treadmill']),
];

function set(n: number, weight: number, reps: number, loggedAt: string): SetRecord {
  return {
    set_number: n,
    weight,
    reps,
    time: null,
    is_bodyweight: false,
    logged_at: loggedAt,
    tempo_eccentric_sec: null,
    tempo_pause_sec: null,
    tempo_concentric_sec: null,
    speed: null,
    incline: null,
    actual_rir: 2,
  };
}

function exRecord(name: string, bodyPart: string, libId: string, sets: SetRecord[]): ExerciseRecord {
  return { exercise_name: name, body_part: bodyPart, exercise_library_id: libId, workout_sets: sets };
}

const DAY_MS = 86_400_000;

/** Build 6 weeks of push/pull/legs, progressively heavier, ending ~3 days ago. */
function buildHistory(): WorkoutRecord[] {
  const workouts: WorkoutRecord[] = [];
  const base = Date.now() - 45 * DAY_MS;
  const tmpl = {
    push: [
      { n: 'Barbell Bench Press', bp: 'chest', id: 'e_bench', w: 185 },
      { n: 'Incline Dumbbell Press', bp: 'chest', id: 'e_incline', w: 70 },
      { n: 'Lateral Raise', bp: 'shoulders', id: 'e_lateral', w: 20 },
      { n: 'Triceps Pushdown', bp: 'arms', id: 'e_pushdown', w: 60 },
    ],
    pull: [
      { n: 'Lat Pulldown', bp: 'back', id: 'e_pulldown', w: 140 },
      { n: 'Barbell Row', bp: 'back', id: 'e_row', w: 155 },
      { n: 'Barbell Curl', bp: 'arms', id: 'e_curl', w: 65 },
      { n: 'Hammer Curl', bp: 'arms', id: 'e_hammer', w: 30 },
    ],
    legs: [
      { n: 'Barbell Back Squat', bp: 'legs', id: 'e_squat', w: 225 },
      { n: 'Leg Press', bp: 'legs', id: 'e_legpress', w: 360 },
      { n: 'Romanian Deadlift', bp: 'legs', id: 'e_rdl', w: 185 },
      { n: 'Standing Calf Raise', bp: 'legs', id: 'e_calf', w: 180 },
    ],
  };
  let wid = 0;
  for (let week = 0; week < 6; week++) {
    const days: Array<keyof typeof tmpl> = ['push', 'pull', 'legs'];
    days.forEach((day, di) => {
      const dayOffset = week * 7 + di * 2; // Mon/Wed/Fri-ish
      const ts = base + dayOffset * DAY_MS;
      const iso = new Date(ts).toISOString();
      const date = iso.slice(0, 10);
      const exercises = tmpl[day].map((e) => {
        const progressed = e.w + week * 5; // linear progression over weeks
        const sets = [
          set(1, progressed, 8, iso),
          set(2, progressed, 8, iso),
          set(3, progressed, 7, iso),
        ];
        return exRecord(e.n, e.bp, e.id, sets);
      });
      workouts.push({
        id: `w_${wid++}`,
        date,
        created_at: iso,
        duration: 60,
        template_name: day,
        perceived_effort: 7,
        session_rpe: 7,
        session_type: 'workout',
        workout_avg_hr: null,
        workout_peak_hr: null,
        workout_hr_zones: null,
        workout_calories_burned: null,
        generated_workout_id: null,
        workout_exercises: exercises,
      });
    });
  }
  return workouts;
}

function buildPreferences(overrides: Partial<UserPreferences> = {}): UserPreferences {
  return {
    training_goal: 'maintain',
    primary_goal: 'general_fitness',
    secondary_goal: null,
    session_duration_minutes: 60,
    equipment_access: 'full_gym',
    available_days_per_week: 4,
    injuries: [],
    exercises_to_avoid: [],
    performance_goals: [],
    preferred_split: 'push_pull_legs',
    date_of_birth: null,
    gender: 'male',
    height_feet: 5,
    height_inches: 10,
    job_activity_level: 'moderate',
    experience_level: 'intermediate',
    body_weight_lbs: 185,
    cardio_preference: null,
    cardio_frequency_per_week: null,
    cardio_duration_minutes: null,
    preferred_exercises: null,
    recovery_speed: 1.0,
    weight_goal_lbs: null,
    weight_goal_date: null,
    priority_muscles: [],
    weekday_deadlines: {},
    gym_profiles: [],
    active_gym_profile: null,
    age: 30,
    rest_days: [0],
    sport_focus: null,
    sport_season: null,
    hotel_mode: false,
    weekly_split_schedule: null,
    mesocycle_week: 2,
    mesocycle_start_date: null,
    monthly_focus_state: null,
    ...overrides,
  };
}

function buildProfile(prefs: UserPreferences): ReturnType<typeof computeTrainingProfileFromData> {
  const data: PreFetchedTrainingData = {
    preferences: prefs,
    workouts: buildHistory(),
    healthMetrics: [],
    exerciseLibrary: LIBRARY,
    modelFeedback: [],
    connectedAccounts: [],
    cardioCapabilities: [],
    exerciseSwaps: [],
    generatedWorkouts: [],
    workoutOutcomes: [],
    executionEvents: [],
    sessionFeatures: [],
  };
  return computeTrainingProfileFromData('user_test', data);
}

// Pick a deterministic future Monday for planning.
const PLANNING_DATE = (() => {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
})();

async function generate(
  prefs: UserPreferences,
  overrides: Record<string, unknown> = {},
): Promise<GeneratedWorkout> {
  const profile = buildProfile(prefs);
  return generateWorkout(
    profile,
    { planningDate: PLANNING_DATE, ...overrides } as never,
    { preferences: prefs, exerciseLibrary: LIBRARY },
  );
}

function assertStructurallyValid(w: GeneratedWorkout) {
  assert.ok(w, 'workout returned');
  assert.ok(Array.isArray(w.exercises), 'exercises is an array');
  assert.ok(w.exercises.length >= 1, 'at least one exercise prescribed');
  const names = new Set<string>();
  for (const ex of w.exercises) {
    assert.ok(ex.exerciseName && ex.exerciseName.length > 0, 'exercise has a name');
    assert.ok(!names.has(ex.exerciseName), `no duplicate exercise: ${ex.exerciseName}`);
    names.add(ex.exerciseName);
    assert.ok(ex.sets >= 1, `${ex.exerciseName}: sets >= 1`);
    if (!ex.isCardio) {
      assert.ok(ex.targetReps > 0, `${ex.exerciseName}: targetReps > 0`);
      assert.ok(ex.restSeconds > 0, `${ex.exerciseName}: restSeconds > 0`);
      assert.ok((ex.targetWeight ?? 0) >= 0, `${ex.exerciseName}: targetWeight non-negative`);
    }
  }
  assert.ok(w.estimatedDurationMinutes > 0, 'estimated duration positive');
}

test('generateWorkout: produces a structurally valid session from real history', async () => {
  const prefs = buildPreferences();
  const w = await generate(prefs);
  assertStructurallyValid(w);
  // A 60-minute full-gym session should program several exercises.
  assert.ok(w.exercises.length >= 3, `expected >=3 exercises, got ${w.exercises.length}`);
  // History established e1RM on the compounds → at least one loaded lift.
  assert.ok(
    w.exercises.some((e) => !e.isCardio && (e.targetWeight ?? 0) > 0),
    'at least one weighted exercise has a prescribed load',
  );
});

test('generateWorkout: respects the duration budget', async () => {
  const w = await generate(buildPreferences({ session_duration_minutes: 45 }));
  assertStructurallyValid(w);
  // Allow modest overage for warmups/rounding, but the engine must not blow
  // past the budget by a wide margin.
  assert.ok(
    w.estimatedDurationMinutes <= 45 * 1.6,
    `duration ${w.estimatedDurationMinutes} exceeds budget tolerance`,
  );
});

test('generateWorkout: never prescribes an avoided exercise', async () => {
  const prefs = buildPreferences({ exercises_to_avoid: ['Barbell Bench Press', 'Barbell Back Squat'] });
  // Anchor each split day across a week — none should surface the avoided lifts.
  for (const anchor of [['mid_chest'], ['quadriceps'], ['back_lats']]) {
    const w = await generate(prefs, { anchorMuscleGroups: anchor });
    assertStructurallyValid(w);
    const names = w.exercises.map((e) => e.exerciseName);
    assert.ok(!names.includes('Barbell Bench Press'), `avoided bench surfaced for ${anchor}`);
    assert.ok(!names.includes('Barbell Back Squat'), `avoided squat surfaced for ${anchor}`);
  }
});

test('generateWorkout: is deterministic for a fixed regeneration seed', async () => {
  const prefs = buildPreferences();
  const a = await generate(prefs, { regenerationSeed: 42, anchorMuscleGroups: ['mid_chest'] });
  const b = await generate(prefs, { regenerationSeed: 42, anchorMuscleGroups: ['mid_chest'] });
  assert.deepEqual(
    a.exercises.map((e) => e.exerciseName),
    b.exercises.map((e) => e.exerciseName),
    'same seed + inputs must yield the same exercise sequence',
  );
});

test('generateWorkout: goal override propagates to the prescribed session', async () => {
  const bulk = await generate(buildPreferences(), { goalOverride: 'bulk' });
  assertStructurallyValid(bulk);
  assert.equal(bulk.trainingGoal, 'bulk', 'goalOverride must drive the session training goal');

  const cut = await generate(buildPreferences(), { goalOverride: 'cut' });
  assert.equal(cut.trainingGoal, 'cut');
});

test('generateWorkout: a larger time budget programs at least as much work', async () => {
  const short = await generate(buildPreferences({ session_duration_minutes: 30 }));
  const long = await generate(buildPreferences({ session_duration_minutes: 75 }));
  assertStructurallyValid(short);
  assertStructurallyValid(long);
  const setsOf = (w: GeneratedWorkout) => w.exercises.reduce((s, e) => s + e.sets, 0);
  // More available time must never reduce total prescribed volume.
  assert.ok(
    setsOf(long) >= setsOf(short),
    `long session (${setsOf(long)} sets) should be >= short (${setsOf(short)} sets)`,
  );
});
