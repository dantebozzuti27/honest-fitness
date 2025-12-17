export const LAST_QUICK_ACTION_KEY = 'hf_last_quick_action_v1'

export function setLastQuickAction(action) {
  try {
    if (!action || typeof action !== 'object') return
    localStorage.setItem(LAST_QUICK_ACTION_KEY, JSON.stringify({ ...action, ts: Date.now() }))
  } catch {
    // ignore
  }
}

export function getLastQuickAction() {
  try {
    return JSON.parse(localStorage.getItem(LAST_QUICK_ACTION_KEY) || 'null')
  } catch {
    return null
  }
}


