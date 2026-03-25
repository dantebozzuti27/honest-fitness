import type { WeeklyPlan, WeeklyPlanDay } from './workoutEngine'

export type DayStatusLabel = 'completed' | 'rest' | 'adapted' | 'planned'

export type WeekGlanceCard = {
  day: WeeklyPlanDay
  selected: boolean
  status: DayStatusLabel
  shownMinutes: number
  focusTags: string[]
  anchorNames: string[]
  isUserRestOverride: boolean
}

export function estimateDisplayedMinutesForDay(day: WeeklyPlanDay | null | undefined): number {
  if (!day || day.isRestDay) return 0
  const pw = day.plannedWorkout
  if (!pw) return Number(day.estimatedMinutes) || 0
  if (Number.isFinite(pw.estimatedDurationMinutes) && Number(pw.estimatedDurationMinutes) > 0) {
    return Math.round(Number(pw.estimatedDurationMinutes))
  }
  if (Number.isFinite(day.estimatedMinutes) && Number(day.estimatedMinutes) > 0) {
    return Math.round(Number(day.estimatedMinutes))
  }
  const fromExerciseMinutes = Array.isArray(pw.exercises)
    ? Math.round(pw.exercises.reduce((sum: number, ex: any) => sum + (Number(ex?.estimatedMinutes) || 0), 0))
    : 0
  if (fromExerciseMinutes > 0) return fromExerciseMinutes
  const roughFromPrescription = Array.isArray(pw.exercises)
    ? Math.round(pw.exercises.reduce((sum: number, ex: any) => {
        if (ex?.isCardio) return sum + Math.max(5, Math.round((Number(ex.cardioDurationSeconds) || 0) / 60)) + 2
        const sets = Math.max(1, Number(ex?.sets) || 0)
        const warmups = Array.isArray(ex?.warmupSets) ? ex.warmupSets.length : 0
        const totalSets = sets + warmups
        const repSeconds = ex?.exerciseRole === 'primary' ? 45 : ex?.exerciseRole === 'secondary' ? 38 : 32
        const workMinutes = (totalSets * repSeconds) / 60
        const restMinutes = (Math.max(0, sets - 1) * Math.max(30, Number(ex?.restSeconds) || 60)) / 60
        const warmupMinutes = warmups * 0.5
        return sum + Math.max(3, Math.round(workMinutes + restMinutes + warmupMinutes))
      }, 0))
    : 0
  return roughFromPrescription > 0 ? roughFromPrescription : 0
}

export function getDayStatus(day: WeeklyPlanDay): DayStatusLabel {
  if (day.dayStatus === 'completed' || day.actualWorkoutId) return 'completed'
  if (day.isRestDay) return 'rest'
  if (day.dayStatus === 'adapted') return 'adapted'
  return 'planned'
}

export function summarizeDayAnchors(day: WeeklyPlanDay): string[] {
  const exercises = Array.isArray(day?.plannedWorkout?.exercises) ? day.plannedWorkout.exercises : []
  const staples = exercises
    .filter((ex: any) =>
      Array.isArray(ex?.adjustments) &&
      ex.adjustments.some((adj: string) => /staple/i.test(String(adj)))
    )
    .map((ex: any) => String(ex.exerciseName || '').trim())
  const compounds = exercises
    .filter((ex: any) => String(ex?.exerciseRole || '').toLowerCase() === 'primary')
    .map((ex: any) => String(ex.exerciseName || '').trim())
  const merged = [...staples, ...compounds].filter(Boolean)
  return [...new Set(merged)].slice(0, 3)
}

export function summarizeDayFocusTags(day: WeeklyPlanDay): string[] {
  const groups = Array.isArray(day?.muscleGroups) ? day.muscleGroups : []
  return groups
    .map((g: string) => g.replace(/_/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 2)
}

export function getSelectedPlanDay(plan: WeeklyPlan | null, selectedPlanDate: string): WeeklyPlanDay | null {
  if (!plan || !Array.isArray(plan.days) || plan.days.length === 0) return null
  return plan.days.find(d => d.planDate === selectedPlanDate) || plan.days[0]
}

export function buildWeekGlanceCards(
  plan: WeeklyPlan | null,
  restDays: number[],
  selectedPlanDate: string
): WeekGlanceCard[] {
  if (!plan || !Array.isArray(plan.days)) return []
  return plan.days.map((day) => {
    const isUserRestOverride = restDays.includes(day.dayOfWeek)
    return {
      day,
      selected: day.planDate === selectedPlanDate,
      status: getDayStatus(day),
      shownMinutes: estimateDisplayedMinutesForDay(day),
      focusTags: summarizeDayFocusTags(day),
      anchorNames: summarizeDayAnchors(day),
      isUserRestOverride,
    }
  })
}
