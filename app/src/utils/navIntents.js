export function getDefaultMealType(date = new Date()) {
  const h = date.getHours()
  if (h < 11) return 'Breakfast'
  if (h < 15) return 'Lunch'
  if (h < 21) return 'Dinner'
  return 'Snack'
}

export function openMealLog(navigate, opts = {}) {
  const mealType = opts.mealType || getDefaultMealType()
  navigate('/nutrition', { state: { openMealModal: true, mealType } })
}

export function openHealthLog(navigate) {
  navigate('/health', { state: { openLogModal: true } })
}

export function openNutrition(navigate, opts = {}) {
  navigate('/nutrition', { state: opts.state || {} })
}

export function openGoals(navigate, opts = {}) {
  navigate('/goals', { state: opts.state || {} })
}

export function startWorkout(navigate, opts = {}) {
  const mode = opts.mode || 'picker'
  if (mode === 'resume') {
    navigate('/workout/active')
    return
  }
  if (mode === 'picker') {
    navigate('/workout/active', { state: { sessionType: opts.sessionType || 'workout', openPicker: true } })
    return
  }
  if (mode === 'template') {
    const state = {
      sessionType: opts.sessionType || 'workout',
      ...(opts.templateId ? { templateId: opts.templateId } : {}),
      ...(opts.scheduledDate ? { scheduledDate: opts.scheduledDate } : {})
    }
    navigate('/workout/active', { state })
    return
  }
  navigate('/workout/active', { state: { sessionType: opts.sessionType || 'workout' } })
}
