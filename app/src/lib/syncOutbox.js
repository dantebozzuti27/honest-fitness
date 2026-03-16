import { isUuidV4, uuidv4 } from '../utils/uuid.js'

const STORAGE_KEY = 'honest_outbox_v1'
const MAX_ITEMS = 200

function notifyOutboxUpdated() {
  try {
    window.dispatchEvent(new CustomEvent('outboxUpdated'))
  } catch {
    // no-op
  }
}

function loadOutbox() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function saveOutbox(items) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(-MAX_ITEMS)))
    notifyOutboxUpdated()
  } catch {
    // noop
  }
}

function normalizePayload(kind, payload = {}) {
  if (kind === 'workout' && payload.workout) {
    const workout = { ...payload.workout }
    if (!isUuidV4(workout.id)) workout.id = uuidv4()
    return { ...payload, workout }
  }

  if (kind === 'feed_item' && payload.feedItem) {
    const feedItem = { ...payload.feedItem }
    if (!isUuidV4(feedItem.id)) feedItem.id = uuidv4()
    return { ...payload, feedItem }
  }

  if (kind === 'meal' && payload.meal) {
    const meal = { ...payload.meal }
    if (typeof meal.id !== 'string' || meal.id.length === 0) meal.id = uuidv4()
    return { ...payload, meal }
  }

  return payload
}

function nextAttemptAtMs(tries) {
  const base = [5000, 15000, 45000, 135000, 600000, 1800000, 3600000]
  return base[Math.min(base.length - 1, Math.max(0, Number(tries) || 0))]
}

export function enqueueOutboxItem(item = {}) {
  if (!item?.userId || !item?.kind) return
  const normalized = {
    ...item,
    id: item.id || uuidv4(),
    userId: item.userId,
    kind: item.kind,
    payload: normalizePayload(item?.kind, item?.payload || {}),
    createdAt: Date.now(),
    tries: Number(item.tries) || 0,
    nextAttemptAt: item.nextAttemptAt || Date.now(),
    enqueuedAt: new Date().toISOString(),
  }
  const current = loadOutbox()
  current.push(normalized)
  saveOutbox(current)
}

export function migrateLegacyFailedWorkouts(userId) {
  if (!userId) return
  try {
    const prefix = `failedWorkout_${userId}_`
    const keys = Object.keys(localStorage).filter(k => k.startsWith(prefix))
    for (const k of keys) {
      const raw = localStorage.getItem(k)
      let workout = null
      try { workout = raw ? JSON.parse(raw) : null } catch { workout = null }
      if (workout) enqueueOutboxItem({ userId, kind: 'workout', payload: { workout } })
      localStorage.removeItem(k)
    }
  } catch {
    // noop
  }
}

export function getOutboxPendingCount(userId) {
  const items = loadOutbox()
  if (!userId) return items.length
  return items.filter(i => i && i.userId === userId).length
}

export async function flushOutbox(userId) {
  if (!userId) return { attempted: 0, succeeded: 0 }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { attempted: 0, succeeded: 0 }
  }
  const items = loadOutbox()
  if (items.length === 0) return { attempted: 0, succeeded: 0 }

  let attempted = 0
  let succeeded = 0
  const now = Date.now()
  const remaining = []

  for (const item of items) {
    if (!item || item.userId !== userId) {
      remaining.push(item)
      continue
    }
    if (item.nextAttemptAt && now < item.nextAttemptAt) {
      remaining.push(item)
      continue
    }

    attempted++
    try {
      if (item.kind === 'workout') {
        const workout = item.payload?.workout
        if (!workout) throw new Error('Missing workout payload')
        const mod = await import('./db/workoutsDb')
        await mod.saveWorkoutToSupabase(workout, userId)
      } else if (item.kind === 'metrics') {
        const date = item.payload?.date
        const metrics = item.payload?.metrics
        if (!date || !metrics) throw new Error('Missing metrics payload')
        const mod = await import('./db/metricsDb')
        await mod.saveMetricsToSupabase(userId, date, metrics, { allowOutbox: false })
      } else {
        remaining.push(item)
        continue
      }
      succeeded++
    } catch (e) {
      const tries = (item.tries || 0) + 1
      remaining.push({
        ...item,
        tries,
        lastError: e?.message || String(e),
        nextAttemptAt: Date.now() + nextAttemptAtMs(tries),
      })
    }
  }

  saveOutbox(remaining)
  return { attempted, succeeded }
}
