import express from 'express'
import { query } from '../database/pg.js'

export const metricsSaveRouter = express.Router()

function toNumber(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function toInteger(v) {
  const n = toNumber(v)
  return n == null ? null : Math.round(n)
}

function buildHealthMetricsRow(userId, date, metrics, sourceProvider = 'manual') {
  const row = {
    user_id: userId,
    date,
    sleep_score: toNumber(metrics.sleepScore ?? metrics.sleep_score),
    sleep_duration: toNumber(metrics.sleepTime ?? metrics.sleep_duration),
    hrv: toNumber(metrics.hrv),
    steps: toInteger(metrics.steps),
    weight: toNumber(metrics.weight),
    calories_burned: toNumber(metrics.caloriesBurned ?? metrics.calories_burned),
    resting_heart_rate: toNumber(metrics.restingHeartRate ?? metrics.resting_heart_rate),
    body_temp: toNumber(metrics.bodyTemp ?? metrics.body_temp),
    body_fat_percentage: toNumber(metrics.bodyFatPercentage ?? metrics.body_fat_percentage),
    breathing_rate: toNumber(metrics.breathingRate ?? metrics.breathing_rate),
    spo2: toNumber(metrics.spo2),
    strain: toNumber(metrics.strain),
    source_provider: metrics.sourceProvider || metrics.source_provider || sourceProvider,
    updated_at: new Date().toISOString(),
  }

  for (const key of Object.keys(row)) {
    if (row[key] === null || row[key] === undefined) delete row[key]
  }
  return row
}

const FITBIT_FIELDS = [
  'sleep_score',
  'sleep_duration',
  'hrv',
  'resting_heart_rate',
  'steps',
  'calories_burned',
  'max_heart_rate',
]

metricsSaveRouter.post('/', async (req, res) => {
  try {
    const userId = req.userId
    if (!userId) return res.status(401).json({ data: null, error: { message: 'Not authenticated' } })

    const { date, metrics, sourceProvider } = req.body || {}
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
      return res.status(400).json({ data: null, error: { message: 'Invalid date (YYYY-MM-DD required)' } })
    }
    if (!metrics || typeof metrics !== 'object') {
      return res.status(400).json({ data: null, error: { message: 'Missing metrics object' } })
    }

    const row = buildHealthMetricsRow(userId, date, metrics, sourceProvider)
    const hasData = Object.keys(row).some((k) => !['user_id', 'date', 'updated_at', 'source_provider'].includes(k))
    if (!hasData) {
      return res.status(400).json({ data: null, error: { message: 'Cannot save metrics with no data' } })
    }

    const existing = await query(
      'SELECT * FROM health_metrics WHERE user_id = $1 AND date = $2 LIMIT 1',
      [userId, date],
    )
    const prev = existing.rows[0]
    if (prev?.source_provider === 'fitbit') {
      for (const field of FITBIT_FIELDS) {
        if (!(field in row) && prev[field] != null) row[field] = prev[field]
      }
    }

    const cols = Object.keys(row)
    const vals = cols.map((c) => row[c])
    const placeholders = cols.map((_, i) => `$${i + 1}`)
    const updates = cols
      .filter((c) => c !== 'user_id' && c !== 'date')
      .map((c) => `"${c}" = EXCLUDED."${c}"`)
      .join(', ')

    const upsert = await query(
      `INSERT INTO health_metrics (${cols.map((c) => `"${c}"`).join(', ')})
       VALUES (${placeholders.join(', ')})
       ON CONFLICT (user_id, date) DO UPDATE SET ${updates}
       RETURNING *`,
      vals,
    )

    return res.json({ data: upsert.rows[0] || null, error: null })
  } catch (err) {
    console.error('[metrics-save] Error:', err.message)
    return res.status(500).json({ data: null, error: { message: err.message } })
  }
})
