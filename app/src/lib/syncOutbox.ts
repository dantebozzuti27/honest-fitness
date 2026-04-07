import { logDebug, logError, logWarn } from '../utils/logger.js'
import { isUuidV4, uuidv4 } from '../utils/uuid.js'

const OUTBOX_KEY = 'honest_outbox_v1'
const MAX_ITEMS = 200

function notifyOutboxUpdated() {
  try {
    window.dispatchEvent(new CustomEvent('outboxUpdated'))
  } catch {
    // no-op (e.g., SSR / non-browser env)
  }
}

function safeParse(json: any, fallback: any) {
  try {
    return JSON.parse(json)
  } catch {
    return fallback
  }
}

function loadOutbox() {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY)
    const arr = safeParse(raw || '[]', [])
    return Array.isArray(arr) ? arr : []
  } catch (e: any) {
    logWarn('Outbox load failed', { message: e?.message })
    return []
  }
}

function saveOutbox(items: any[]) {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(items.slice(-MAX_ITEMS)))
    notifyOutboxUpdated()
  } catch (e) {
    logError('Outbox save failed', e)
  }
}

function nextAttemptAtMs(tries: number) {
  // Exponential backoff: 5s, 15s, 45s, 2m15s, 10m, 30m, 1h (cap)
  const base = [5000, 15000, 45000, 135000, 600000, 1800000, 3600000]
  return base[Math.min(base.length - 1, Math.max(0, tries))]
}

export function enqueueOutboxItem({ userId, kind, payload }: { userId: string; kind: string; payload: any }): string | null {
  if (!userId || !kind) return null
  const now = Date.now()

  const normalizedPayload = (() => {
    try {
      if (kind === 'workout') {
        const w = payload?.workout && typeof payload.workout === 'object' ? payload.workout : null
        if (!w) return payload
        const id = isUuidV4(w.id) ? w.id : uuidv4()
        return { ...payload, workout: { ...w, id } }
      }
      return payload
    } catch {
      return payload
    }
  })()

  const itemId = uuidv4()
  const item = {
    id: itemId,
    userId,
    kind,
    payload: normalizedPayload ?? null,
    createdAt: now,
    tries: 0,
    nextAttemptAt: now
  }

  const current = loadOutbox()
  const updated = [...current, item].slice(-MAX_ITEMS)
  saveOutbox(updated)
  logDebug('Outbox enqueued', { kind, userId, itemId })
  return itemId
}

export function removeOutboxItem(itemId: string) {
  if (!itemId) return
  const current = loadOutbox()
  const updated = current.filter((i: any) => i?.id !== itemId)
  if (updated.length < current.length) {
    saveOutbox(updated)
    logDebug('Outbox item removed', { itemId })
  }
}

export function migrateLegacyFailedWorkouts(userId: string) {
  if (!userId) return
  try {
    const prefix = `failedWorkout_${userId}_`
    const keys = Object.keys(localStorage).filter(k => k.startsWith(prefix))
    if (keys.length === 0) return

    for (const k of keys) {
      const raw = localStorage.getItem(k)
      const workout = raw ? safeParse(raw, null) : null
      if (workout) {
        enqueueOutboxItem({ userId, kind: 'workout', payload: { workout } })
      }
      localStorage.removeItem(k)
    }

    logDebug('Migrated legacy failed workouts into outbox', { count: keys.length })
  } catch (e: any) {
    logWarn('Failed migrating legacy workouts', { message: e?.message })
  }
}

export function getOutboxPendingCount(userId: string) {
  const items = loadOutbox()
  if (!userId) return items.length
  return items.filter(i => i && i.userId === userId).length
}

export async function flushOutbox(userId: string) {
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
        const { saveWorkoutToSupabase } = await import('./db/workoutsDb')
        await saveWorkoutToSupabase(workout, userId)
      } else if (item.kind === 'metrics') {
        const date = item.payload?.date
        const metrics = item.payload?.metrics
        if (!date || !metrics) throw new Error('Missing metrics payload')
        const { saveMetricsToSupabase } = await import('./db/metricsDb')
        await saveMetricsToSupabase(userId, date, metrics, { allowOutbox: false })
      } else {
        // Unknown kinds are preserved; prevents data loss when upgrading formats.
        remaining.push(item)
        continue
      }

      succeeded++
      logDebug('Outbox item flushed', { kind: item.kind })
    } catch (e: any) {
      const tries = (item.tries || 0) + 1
      const backoff = nextAttemptAtMs(tries)
      remaining.push({
        ...item,
        tries,
        lastError: e?.message || String(e),
        nextAttemptAt: Date.now() + backoff
      })
      logWarn('Outbox flush failed (will retry)', { kind: item.kind, tries, message: e?.message })
    }
  }

  saveOutbox(remaining)
  return { attempted, succeeded }
}


