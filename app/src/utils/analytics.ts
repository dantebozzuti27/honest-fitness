const STORAGE_KEY = 'hf_analytics_events'
const isDev = import.meta.env.DEV

export function trackEvent(event: string, data?: Record<string, any>) {
  const entry = {
    event,
    data: data || {},
    ts: new Date().toISOString()
  }

  if (isDev) {
    // eslint-disable-next-line no-console
    console.log('[analytics]', event, data || '')
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const events: any[] = raw ? JSON.parse(raw) : []
    events.push(entry)
    // Keep at most 500 events to bound storage usage
    if (events.length > 500) events.splice(0, events.length - 500)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events))
  } catch {
    // localStorage may be unavailable (private browsing, quota exceeded)
  }
}

export function getQueuedEvents(): any[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function clearQueuedEvents() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // noop
  }
}
