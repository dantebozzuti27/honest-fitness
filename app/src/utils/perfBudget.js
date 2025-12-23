import { logWarn } from './logger'

// Lightweight, pragmatic performance budgets (ms).
// These are intentionally conservative defaults for real devices on cellular.
export const PERF_BUDGET_MS = {
  startup: 2500,
  home: 1200,
  workout_active: 1400,
  nutrition: 1200,
  health: 1200,
  log: 900
}

export function routeKeyFromPath(pathname = '') {
  const p = (pathname || '').toString()
  if (p === '/') return 'home'
  if (p === '/workout/active') return 'workout_active'
  if (p.startsWith('/nutrition')) return 'nutrition'
  if (p.startsWith('/health')) return 'health'
  if (p.startsWith('/log')) return 'log'
  return (p.startsWith('/') ? p.slice(1) : p) || 'unknown'
}

export function budgetForRouteKey(routeKey) {
  return PERF_BUDGET_MS[routeKey] ?? null
}

export async function reportPerfBudget({ kind, ms, budgetMs, meta = {} }) {
  if (!Number.isFinite(ms) || !Number.isFinite(budgetMs)) return
  if (ms <= budgetMs) return

  // Dev-visible signal
  logWarn('Perf budget exceeded', { kind, ms: Math.round(ms), budget_ms: Math.round(budgetMs), ...meta })

  // Best-effort telemetry (gated by VITE_ENABLE_TELEMETRY)
  try {
    const mod = await import('../lib/eventTracking')
    const { trackEvent } = mod || {}
    if (typeof trackEvent === 'function') {
      trackEvent('perf_budget_exceeded', {
        category: 'performance',
        action: 'budget_exceeded',
        label: kind,
        properties: { ms: Math.round(ms), budget_ms: Math.round(budgetMs), ...meta }
      })
    }
  } catch {
    // ignore
  }
}


