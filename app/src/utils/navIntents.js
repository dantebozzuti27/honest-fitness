/**
 * Canonical navigation intents
 * Centralizes "how to open X" so all entry points behave consistently.
 *
 * Notes:
 * - We keep compatibility with existing `location.state` consumers (ActiveWorkout/Nutrition/Health).
 * - Prefer adding new intents here rather than sprinkling new navigate(...) patterns across pages.
 */

export function getDefaultMealType(now = new Date()) {
  const hour = now.getHours()
  if (hour < 11) return 'Breakfast'
  if (hour < 15) return 'Lunch'
  if (hour < 21) return 'Dinner'
  return 'Snacks'
}

export function openLogHub(navigate) {
  navigate('/log')
}

export function openCalendar(navigate) {
  navigate('/calendar')
}

export function openNutrition(navigate, { openMealModal = false, mealType } = {}) {
  navigate('/nutrition', { state: { ...(openMealModal ? { openMealModal: true } : {}), ...(mealType ? { mealType } : {}) } })
}

export function openMealLog(navigate, { mealType } = {}) {
  const mt = mealType || getDefaultMealType()
  navigate('/nutrition', { state: { openMealModal: true, mealType: mt } })
}

export function openHealth(navigate, { openLogModal = false } = {}) {
  navigate('/health', { state: { ...(openLogModal ? { openLogModal: true } : {}) } })
}

export function openHealthLog(navigate) {
  navigate('/health', { state: { openLogModal: true } })
}

/**
 * startWorkout
 *
 * mode:
 * - resume: open existing session (no state needed; ActiveWorkout will load active session)
 * - picker: open exercise/recovery picker immediately (reduces clicks)
 * - template: start from templateId (optionally scheduledDate)
 * - ai: start from aiWorkout object
 * - random: start from random workout flow
 * - quick_add_exercise: start and auto-add a given exercise name
 */
export function startWorkout(
  navigate,
  {
    mode = 'picker',
    sessionType = 'workout', // 'workout' | 'recovery'
    templateId = null,
    scheduledDate = null,
    aiWorkout = null,
    randomWorkout = null,
    resumePaused = false,
    quickAddExerciseName = null
  } = {}
) {
  const st = sessionType === 'recovery' ? 'recovery' : 'workout'

  if (mode === 'resume') {
    navigate('/workout/active')
    return
  }

  if (mode === 'template' && templateId) {
    navigate('/workout/active', { state: { sessionType: st, templateId, ...(scheduledDate ? { scheduledDate } : {}) } })
    return
  }

  if (mode === 'ai' && aiWorkout) {
    navigate('/workout/active', { state: { sessionType: st, aiWorkout } })
    return
  }

  if (mode === 'random') {
    navigate('/workout/active', { state: { sessionType: st, ...(randomWorkout != null ? { randomWorkout } : { randomWorkout: true }) } })
    return
  }

  if (mode === 'quick_add_exercise' && quickAddExerciseName) {
    navigate('/workout/active', { state: { sessionType: st, quickAddExerciseName } })
    return
  }

  // mode: picker (default). This is the lowest click-debt path.
  navigate('/workout/active', { state: { sessionType: st, ...(resumePaused ? { resumePaused: true } : {}), openPicker: true } })
}


