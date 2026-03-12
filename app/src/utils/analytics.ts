const STORAGE_KEY = 'hf_analytics_events'
const isDev = import.meta.env.DEV
let isFlushingModelOutcomes = false

async function getAccessToken(): Promise<string | null> {
  try {
    const mod = await import('../lib/supabase')
    const client = mod.requireSupabase()
    const { data } = await client.auth.getSession()
    return data?.session?.access_token ?? null
  } catch {
    return null
  }
}

function isModelOutcomeEvent(entry: any): boolean {
  return typeof entry?.event === 'string' && entry.event.startsWith('model_outcome_')
}

export async function flushModelOutcomeEvents(): Promise<void> {
  if (isFlushingModelOutcomes) return
  isFlushingModelOutcomes = true
  try {
    const queued = getQueuedEvents()
    const modelOutcomeEvents = queued.filter(isModelOutcomeEvent)
    if (modelOutcomeEvents.length === 0) return

    const token = await getAccessToken()
    if (!token) return

    const payload = modelOutcomeEvents.map((e: any) => ({
      event: e.event,
      ts: e.ts,
      data: e.data || {}
    }))

    const res = await fetch('/api/input/model-outcome-events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ events: payload })
    })

    if (!res.ok) return

    const remaining = queued.filter((e: any) => !isModelOutcomeEvent(e))
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(remaining))
    } catch {
      // noop
    }
  } finally {
    isFlushingModelOutcomes = false
  }
}

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

  if (event.startsWith('model_outcome_')) {
    void flushModelOutcomeEvents()
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
