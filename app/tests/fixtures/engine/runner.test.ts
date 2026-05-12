/**
 * Engine fixture runner — invariant-pipeline regression suite.
 *
 * Reads every `cases/*.json` file in this directory, materialises the
 * workout + context described, runs `runInvariantPipeline` against the
 * full `DEFAULT_WORKOUT_INVARIANTS`, and asserts the behavioural
 * expectations in the fixture.
 *
 * ──────────────────────────────────────────────────────────────────────
 * Fixture JSON schema (see ./README.md for usage notes)
 * ──────────────────────────────────────────────────────────────────────
 *
 * {
 *   "name": "human-readable test name (becomes the test() title)",
 *   "target": "invariantPipeline",       // currently the only target
 *
 *   "exercises": [                        // synthetic GeneratedExercise[]
 *     {
 *       "exerciseName": "Lat Pulldown",
 *       "targetMuscleGroup": "back_lats",
 *       "exerciseRole": "primary",        // primary | secondary | isolation | corrective | cardio
 *       "sets": 3,
 *       "isCardio": false,                // optional, defaults to false
 *       "isUndroppable": false,           // optional, defaults to undefined
 *       "undroppableReason": "monthly_focus"  // optional, only meaningful when isUndroppable=true
 *     }
 *   ],
 *
 *   "context": {
 *     "dayTheme": {                       // optional — when omitted, theme invariant is a no-op
 *       "primary": "back_lats",
 *       "allowedAccessories": ["biceps", "back_upper"],
 *       "source": "schedule"              // schedule | rotation | inferred
 *     },
 *     "userAuthoredScheduleGroups": [     // optional — when omitted, hard-schedule invariant is a no-op
 *       "back_lats", "biceps", "back_upper"
 *     ],
 *     "monthlyFocusMuscle": "biceps"      // optional
 *   },
 *
 *   "expectations": {
 *     "passed": true,                      // optional — assert passed flag
 *     "remainingExerciseNames": [          // optional — exact set after auto-fixes
 *       "Lat Pulldown", "Bicep Curl"
 *     ],
 *     "mustInclude": ["Bicep Curl"],       // optional — names that must be present
 *     "mustExclude": ["Romanian Deadlift"],// optional — names that must be absent
 *     "violationCountAtLeast": 0,          // optional — assert >= this many remaining violations
 *     "noteContains": ["Schedule guard"]   // optional — substring matches in pipeline notes
 *   }
 * }
 *
 * Defaults applied to exercises when fields are missing: see makeExercise()
 * below. The defaults are chosen so a minimal fixture is just
 * `{ exerciseName, targetMuscleGroup }`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  runInvariantPipeline,
  DEFAULT_WORKOUT_INVARIANTS,
  type WorkoutInvariantContext,
  type DayTheme,
} from '../../../src/lib/workoutInvariants';
import { DEFAULT_MODEL_CONFIG } from '../../../src/lib/modelConfig';
import type {
  GeneratedExercise,
  GeneratedWorkout,
} from '../../../src/lib/workoutEngine';
import type { TrainingProfile } from '../../../src/lib/trainingAnalysis';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CASES_DIR = join(__dirname, 'cases');

interface FixtureExercise {
  exerciseName: string;
  targetMuscleGroup: string;
  exerciseRole?: string;
  sets?: number;
  isCardio?: boolean;
  isUndroppable?: boolean;
  undroppableReason?: 'monthly_focus';
  // Optional pass-through for fields a future fixture might need; we
  // spread these onto the synthetic exercise so growing the schema is
  // cheap.
  [extra: string]: unknown;
}

interface FixtureContext {
  dayTheme?: {
    primary: string;
    allowedAccessories: string[];
    source: 'schedule' | 'rotation' | 'inferred';
  };
  userAuthoredScheduleGroups?: string[];
  monthlyFocusMuscle?: string;
}

interface FixtureExpectations {
  passed?: boolean;
  remainingExerciseNames?: string[];
  mustInclude?: string[];
  mustExclude?: string[];
  violationCountAtLeast?: number;
  noteContains?: string[];
}

interface Fixture {
  name: string;
  target: 'invariantPipeline';
  exercises: FixtureExercise[];
  context: FixtureContext;
  expectations: FixtureExpectations;
}

function makeExercise(spec: FixtureExercise): GeneratedExercise {
  return {
    exerciseName: spec.exerciseName,
    exerciseLibraryId: `lib_${spec.exerciseName.replace(/\s+/g, '_')}`,
    bodyPart: 'unknown',
    primaryMuscles: [spec.targetMuscleGroup],
    secondaryMuscles: [],
    movementPattern: 'unknown',
    targetMuscleGroup: spec.targetMuscleGroup as never,
    exerciseRole: (spec.exerciseRole ?? 'primary') as never,
    sets: spec.sets ?? 3,
    targetReps: 8,
    targetRepRange: { min: 6, max: 10 },
    targetWeight: 100,
    targetRir: 2,
    rirLabel: '2 RIR',
    isBodyweight: false,
    tempo: '2010',
    restSeconds: 90,
    rationale: 'fixture',
    adjustments: [],
    isDeload: false,
    isCardio: spec.isCardio ?? false,
    cardioDurationSeconds: null,
    cardioSpeed: null,
    cardioIncline: null,
    cardioSpeedLabel: null,
    targetHrZone: null,
    targetHrBpmRange: null,
    warmupSets: null,
    supersetGroupId: null,
    supersetType: null,
    rirRange: [1, 3],
    impactScore: 50,
    estimatedMinutes: 10,
    isUndroppable: spec.isUndroppable,
    undroppableReason: spec.undroppableReason,
    ...spec,
  } as unknown as GeneratedExercise;
}

function makeWorkout(exercises: GeneratedExercise[]): GeneratedWorkout {
  return {
    id: 'fixture',
    date: '2026-05-12',
    trainingGoal: 'maintain',
    estimatedDurationMinutes: 60,
    muscleGroupsFocused: [],
    exercises,
    sessionRationale: '',
    recoveryStatus: 'fresh',
    adjustmentsSummary: [],
    deloadActive: false,
    decisionLog: [],
    muscleGroupDecisions: [],
    exerciseDecisions: [],
  } as GeneratedWorkout;
}

function makeProfile(): TrainingProfile {
  // Minimal stub: invariants only read a tiny subset of TrainingProfile,
  // and fixtures that need richer profile data should add fields via the
  // FixtureContext escape hatch (or extend this builder).
  return {
    exerciseProgressions: [],
    exercisePreferences: [],
    bodyWeightTrend: { phase: 'maintain' as never },
    muscleGroupFrequency: {},
    muscleVolumeStatuses: [],
    imbalanceAlerts: [],
  } as unknown as TrainingProfile;
}

function makeCtx(fixtureCtx: FixtureContext): WorkoutInvariantContext {
  let dayTheme: DayTheme | null = null;
  if (fixtureCtx.dayTheme) {
    dayTheme = {
      primary: fixtureCtx.dayTheme.primary as never,
      allowedAccessories: fixtureCtx.dayTheme.allowedAccessories as never[],
      source: fixtureCtx.dayTheme.source,
    };
  }
  return {
    profile: makeProfile(),
    preferences: {} as never,
    cfg: DEFAULT_MODEL_CONFIG,
    bodyAssessment: null,
    dayTheme,
    weeklyCardio: null,
    monthlyFocusMuscle: fixtureCtx.monthlyFocusMuscle ?? null,
    userAuthoredScheduleGroups: fixtureCtx.userAuthoredScheduleGroups
      ? new Set(fixtureCtx.userAuthoredScheduleGroups)
      : null,
  };
}

function loadFixtures(): Array<{ path: string; fixture: Fixture }> {
  let entries: string[];
  try {
    entries = readdirSync(CASES_DIR);
  } catch {
    return []; // No cases dir yet — runner is a no-op until someone adds fixtures.
  }
  return entries
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const path = join(CASES_DIR, f);
      const raw = readFileSync(path, 'utf8');
      const fixture = JSON.parse(raw) as Fixture;
      return { path, fixture };
    });
}

const fixtures = loadFixtures();

if (fixtures.length === 0) {
  // Prove the runner itself is wired correctly even when there are no
  // fixtures yet. Without this, `node --test` reports "0 tests" which
  // is indistinguishable from "no test file loaded".
  test('engine fixture runner is wired (no fixtures yet)', () => {
    assert.equal(fixtures.length, 0);
  });
}

for (const { path, fixture } of fixtures) {
  test(`engine-fixture: ${fixture.name}`, () => {
    if (fixture.target !== 'invariantPipeline') {
      throw new Error(`unsupported target "${fixture.target}" in ${path}`);
    }
    const exercises = fixture.exercises.map(makeExercise);
    const workout = makeWorkout(exercises);
    const ctx = makeCtx(fixture.context);

    const result = runInvariantPipeline(workout, ctx, DEFAULT_WORKOUT_INVARIANTS);

    const exp = fixture.expectations;
    if (exp.passed !== undefined) {
      assert.equal(result.passed, exp.passed, `${path}: passed`);
    }
    const remainingNames = result.workout.exercises.map(e => e.exerciseName);
    if (exp.remainingExerciseNames) {
      assert.deepEqual(
        [...remainingNames].sort(),
        [...exp.remainingExerciseNames].sort(),
        `${path}: remainingExerciseNames`,
      );
    }
    if (exp.mustInclude) {
      for (const name of exp.mustInclude) {
        assert.ok(
          remainingNames.includes(name),
          `${path}: mustInclude "${name}" missing from ${JSON.stringify(remainingNames)}`,
        );
      }
    }
    if (exp.mustExclude) {
      for (const name of exp.mustExclude) {
        assert.ok(
          !remainingNames.includes(name),
          `${path}: mustExclude "${name}" still present in ${JSON.stringify(remainingNames)}`,
        );
      }
    }
    if (exp.violationCountAtLeast !== undefined) {
      assert.ok(
        result.violations.length >= exp.violationCountAtLeast,
        `${path}: expected >= ${exp.violationCountAtLeast} violations, got ${result.violations.length}`,
      );
    }
    if (exp.noteContains) {
      const joined = result.notes.join('\n');
      for (const needle of exp.noteContains) {
        assert.ok(
          joined.includes(needle),
          `${path}: noteContains "${needle}" missing from ${JSON.stringify(result.notes)}`,
        );
      }
    }
  });
}
