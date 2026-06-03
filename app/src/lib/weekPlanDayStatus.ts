export type WeekPlanDayStatus = 'planned' | 'adapted' | 'completed' | 'skipped'

const ALLOWED: Record<WeekPlanDayStatus, WeekPlanDayStatus[]> = {
  planned: ['planned', 'adapted', 'completed', 'skipped'],
  adapted: ['adapted', 'completed', 'skipped'],
  completed: ['completed'],
  skipped: ['skipped', 'adapted', 'planned'],
}

export function isWeekPlanDayStatus(v: string | null | undefined): v is WeekPlanDayStatus {
  return v === 'planned' || v === 'adapted' || v === 'completed' || v === 'skipped'
}

export function canTransitionDayStatus(
  from: string | null | undefined,
  to: string | null | undefined,
): boolean {
  const f: WeekPlanDayStatus = isWeekPlanDayStatus(from) ? from : 'planned'
  const t: WeekPlanDayStatus = isWeekPlanDayStatus(to) ? to : 'planned'
  return ALLOWED[f].includes(t)
}

/** Throws when transition violates the plan day state machine. */
export function assertDayStatusTransition(
  from: string | null | undefined,
  to: string | null | undefined,
): void {
  if (canTransitionDayStatus(from, to)) return
  const f = isWeekPlanDayStatus(from) ? from : 'planned'
  const t = isWeekPlanDayStatus(to) ? to : 'planned'
  throw new Error(`Invalid plan day status transition: ${f} → ${t}`)
}

/** Normalize day row before RDS persist so DB trigger invariants hold. */
export function normalizeWeeklyPlanDayForPersist(day: {
  dayStatus?: string | null
  actualWorkoutId?: string | null
  actualWorkout?: { id?: string } | null
  isRestDay?: boolean
}): {
  dayStatus: WeekPlanDayStatus
  actualWorkoutId?: string | null
  actualWorkout?: { id?: string } | null
} {
  const status: WeekPlanDayStatus = isWeekPlanDayStatus(day.dayStatus)
    ? day.dayStatus
    : day.isRestDay
      ? 'planned'
      : 'planned'

  if (status === 'completed') {
    const workoutId = day.actualWorkoutId || day.actualWorkout?.id || null
    return {
      dayStatus: 'completed',
      actualWorkoutId: workoutId,
      actualWorkout: day.actualWorkout ?? null,
    }
  }

  return {
    dayStatus: status,
    actualWorkoutId: null,
    actualWorkout: null,
  }
}
