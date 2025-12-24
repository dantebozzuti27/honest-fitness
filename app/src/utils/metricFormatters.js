export function formatSteps(steps) {
  const n = Number(steps)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(n).toLocaleString()
}

// Accept minutes or hours. Heuristic:
// - if > 24, it's almost certainly minutes
// - else treat as hours (can be fractional)
export function formatSleep(raw) {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return null

  let minutes = 0
  if (n > 24) {
    minutes = Math.floor(n)
  } else {
    minutes = Math.round(n * 60)
  }

  minutes = Math.max(0, Math.min(1440, minutes))
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h <= 0) return `${m}m`
  if (m <= 0) return `${h}h`
  return `${h}h ${m}m`
}

export function formatWeightLbs(weight) {
  const raw = weight != null ? String(weight).trim() : ''
  if (raw.toUpperCase() === 'BW') return 'BW'
  const n = Number(weight)
  if (!Number.isFinite(n) || n <= 0) return null
  const rounded = Math.round(n * 10) / 10
  // Use "lb" (unit) instead of "lbs" to keep typography tight.
  return `${rounded} lb`
}


