/**
 * Shared synthetic-data harness for engine-level tests.
 *
 * Synthesizes a realistic 6-week push/pull/legs history and runs it through the
 * REAL `computeTrainingProfileFromData` so downstream tests operate on an
 * internally consistent TrainingProfile with zero network/DB IO. Kept in one
 * place so the generation suite and the lazy-wiring suite cannot drift apart.
 */
import {
  computeTrainingProfileFromData,
  type EnrichedExercise,
  type WorkoutRecord,
  type SetRecord,
  type ExerciseRecord,
  type PreFetchedTrainingData,
} from '../../src/lib/trainingAnalysis';
import type { UserPreferences } from '../../src/lib/workoutEngine';

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

export const LIBRARY: EnrichedExercise[] = [
  lib('e_bench', 'Barbell Bench Press', 'chest', ['mid_chest'], 'horizontal_push', 'compound', ['barbell']),
  lib('e_incline', 'Incline Dumbbell Press', 'chest', ['mid_chest'], 'horizontal_push', 'compound', ['dumbbell']),
  lib('e_cablefly', 'Cable Fly', 'chest', ['mid_chest'], 'horizontal_push', 'isolation', ['cable']),
  lib('e_ohp', 'Overhead Press', 'shoulders', ['front_delts'], 'vertical_push', 'compound', ['barbell']),
  lib('e_lateral', 'Lateral Raise', 'shoulders', ['side_delts'], 'vertical_push', 'isolation', ['dumbbell']),
  lib('e_pushdown', 'Triceps Pushdown', 'arms', ['triceps'], 'extension', 'isolation', ['cable']),
  lib('e_pulldown', 'Lat Pulldown', 'back', ['back_lats'], 'vertical_pull', 'compound', ['cable']),
  lib('e_row', 'Barbell Row', 'back', ['back_lats'], 'horizontal_pull', 'compound', ['barbell']),
  lib('e_curl', 'Barbell Curl', 'arms', ['biceps'], 'curl', 'isolation', ['barbell']),
  lib('e_hammer', 'Hammer Curl', 'arms', ['biceps'], 'curl', 'isolation', ['dumbbell']),
  lib('e_facepull', 'Face Pull', 'shoulders', ['rear_delts'], 'horizontal_pull', 'isolation', ['cable']),
  lib('e_squat', 'Barbell Back Squat', 'legs', ['quadriceps'], 'squat', 'compound', ['barbell']),
  lib('e_legpress', 'Leg Press', 'legs', ['quadriceps'], 'squat', 'compound', ['machine']),
  lib('e_rdl', 'Romanian Deadlift', 'legs', ['hamstrings'], 'hinge', 'compound', ['barbell']),
  lib('e_legcurl', 'Seated Leg Curl', 'legs', ['hamstrings'], 'hinge', 'isolation', ['machine']),
  lib('e_calf', 'Standing Calf Raise', 'legs', ['calves'], 'extension', 'isolation', ['machine']),
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
export function buildHistory(): WorkoutRecord[] {
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
      const dayOffset = week * 7 + di * 2;
      const ts = base + dayOffset * DAY_MS;
      const iso = new Date(ts).toISOString();
      const date = iso.slice(0, 10);
      const exercises = tmpl[day].map((e) => {
        const progressed = e.w + week * 5;
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

export function buildPreferences(overrides: Partial<UserPreferences> = {}): UserPreferences {
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
  } as UserPreferences;
}

export function buildProfile(prefs: UserPreferences): ReturnType<typeof computeTrainingProfileFromData> {
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

/** A deterministic future Monday for planning. */
export const PLANNING_DATE = (() => {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
})();
