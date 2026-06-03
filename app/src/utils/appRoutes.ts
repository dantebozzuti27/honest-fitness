export const ROUTES = {
  home: '/',
  today: '/today',
  weekAhead: '/week-ahead',
  workoutRoot: '/workout',
  activeWorkout: '/workout/active',
  analytics: '/analytics',
  profile: '/profile',
  model: '/model',
  ontology: '/ontology',
} as const

export function openTodayWorkout(navigate: (path: string, opts?: any) => void) {
  navigate(ROUTES.today)
}

/** Canonical launcher → ActiveWorkout exercise picker. */
export function openWorkoutPicker(
  navigate: (path: string, opts?: { state?: Record<string, unknown> }) => void,
  opts?: { resumePaused?: boolean; sessionType?: string },
) {
  navigate(ROUTES.activeWorkout, {
    state: {
      openPicker: true,
      mode: 'picker',
      sessionType: opts?.sessionType ?? 'workout',
      ...(opts?.resumePaused ? { resumePaused: true } : {}),
    },
  })
}

