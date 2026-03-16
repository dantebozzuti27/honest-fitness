import { isUuidV4, uuidv4 } from '../utils/uuid.js'

const STORAGE_KEY = 'honest_outbox_v1'

function loadOutbox() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveOutbox(items) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
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

export function enqueueOutboxItem(item) {
  const normalized = {
    ...item,
    payload: normalizePayload(item?.kind, item?.payload || {}),
    enqueuedAt: new Date().toISOString()
  }
  const current = loadOutbox()
  current.push(normalized)
  saveOutbox(current)
}
