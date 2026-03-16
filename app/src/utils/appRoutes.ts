export const ROUTES = {
  home: '/',
  today: '/today',
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

