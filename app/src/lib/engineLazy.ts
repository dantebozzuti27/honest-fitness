// Lazy access to the workout-generation engine.
//
// `workoutEngine.ts` (~190 kB minified) is the single largest runtime
// dependency on the TodayWorkout route, but it is only needed when the user
// actively generates/regenerates a workout or materializes a weekly plan — not
// when viewing an already-saved plan. Routing every runtime call through this
// module's dynamic `import()` keeps the engine out of the initial route chunk
// (it becomes its own on-demand chunk), which is the difference between
// "split" and actually "deferred": a static import would force the bundler to
// load both chunks before first paint regardless of how they are grouped.
//
// The promise is memoized so the engine module is fetched/evaluated at most
// once per session. Wrappers are typed via `Parameters<>`/`ReturnType<>`
// against the real module so they stay in lockstep with the engine's exported
// signatures with zero duplication; if a signature changes, these fail to
// typecheck.

type Engine = typeof import('./workoutEngine')

let enginePromise: Promise<Engine> | null = null

/** Memoized loader for the generation engine. Safe to call repeatedly. */
export const loadEngine = (): Promise<Engine> =>
  (enginePromise ??= import('./workoutEngine'))

export const generateWorkout = (
  ...args: Parameters<Engine['generateWorkout']>
): ReturnType<Engine['generateWorkout']> =>
  loadEngine().then((m) => m.generateWorkout(...args)) as ReturnType<Engine['generateWorkout']>

export const generateWeeklyPlan = (
  ...args: Parameters<Engine['generateWeeklyPlan']>
): ReturnType<Engine['generateWeeklyPlan']> =>
  loadEngine().then((m) => m.generateWeeklyPlan(...args)) as ReturnType<Engine['generateWeeklyPlan']>

export const recomputeWeeklyPlanWithDiff = (
  ...args: Parameters<Engine['recomputeWeeklyPlanWithDiff']>
): ReturnType<Engine['recomputeWeeklyPlanWithDiff']> =>
  loadEngine().then((m) => m.recomputeWeeklyPlanWithDiff(...args)) as ReturnType<Engine['recomputeWeeklyPlanWithDiff']>

export const rematerializeStaleWeeklyPlanDays = (
  ...args: Parameters<Engine['rematerializeStaleWeeklyPlanDays']>
): ReturnType<Engine['rematerializeStaleWeeklyPlanDays']> =>
  loadEngine().then((m) => m.rematerializeStaleWeeklyPlanDays(...args)) as ReturnType<Engine['rematerializeStaleWeeklyPlanDays']>

export const performSurgicalExerciseSwap = (
  ...args: Parameters<Engine['performSurgicalExerciseSwap']>
): ReturnType<Engine['performSurgicalExerciseSwap']> =>
  loadEngine().then((m) => m.performSurgicalExerciseSwap(...args)) as ReturnType<Engine['performSurgicalExerciseSwap']>

export const addExerciseToWorkout = (
  ...args: Parameters<Engine['addExerciseToWorkout']>
): ReturnType<Engine['addExerciseToWorkout']> =>
  loadEngine().then((m) => m.addExerciseToWorkout(...args)) as ReturnType<Engine['addExerciseToWorkout']>

export const saveGeneratedWorkout = (
  ...args: Parameters<Engine['saveGeneratedWorkout']>
): Promise<Awaited<ReturnType<Engine['saveGeneratedWorkout']>>> =>
  loadEngine().then((m) => m.saveGeneratedWorkout(...args))

/**
 * NOTE: the underlying `parseRawPreferences` is synchronous, but routing it
 * through the lazy loader makes this wrapper async. Callers must `await` it.
 */
export const parseRawPreferences = (
  ...args: Parameters<Engine['parseRawPreferences']>
): Promise<ReturnType<Engine['parseRawPreferences']>> =>
  loadEngine().then((m) => m.parseRawPreferences(...args))
