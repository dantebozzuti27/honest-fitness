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

