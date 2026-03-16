/**
 * Canonical temporal ordering helpers for ML engines.
 * Contract: time series must be chronological (oldest -> newest).
 */

function toMs(v) {
  if (!v) return 0
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : 0
}

export function sortChronological(rows = []) {
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) => {
    const dateCmp = toMs(a?.date) - toMs(b?.date)
    if (dateCmp !== 0) return dateCmp
    const createdCmp = toMs(a?.created_at) - toMs(b?.created_at)
    if (createdCmp !== 0) return createdCmp
    return String(a?.id || '').localeCompare(String(b?.id || ''))
  })
}

export function assertChronological(rows = [], label = 'timeseries') {
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1]
    const curr = rows[i]
    const prevDate = toMs(prev?.date)
    const currDate = toMs(curr?.date)
    const prevCreated = toMs(prev?.created_at)
    const currCreated = toMs(curr?.created_at)
    if (currDate < prevDate || (currDate === prevDate && currCreated < prevCreated)) {
      throw new Error(`${label} must be chronological (ascending by date/created_at)`)
    }
  }
}

