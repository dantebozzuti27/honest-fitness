import { useState, useEffect, useCallback, Component, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getIdToken } from '../lib/cognitoAuth'
import { apiUrl } from '../lib/urlConfig'
import { logError } from '../utils/logger'
import SafeAreaScaffold from '../components/ui/SafeAreaScaffold'
import styles from './ProportionsDashboard.module.css'

interface Assessment {
  id: string
  date: string
  scores: Record<string, number> & {
    _apollo_score?: number
    _score_components?: Record<string, number>
    _muscle_maturity?: number | null
    _v_taper_score?: number | null
    _photos_used?: number
  }
  shoulder_to_waist_ratio: number | null
  left_right_symmetry: number | null
  estimated_body_fat_pct: number | null
  measurements: Record<string, number>
  reeves_ideals: Record<string, number>
  weak_points: string[]
  strong_points: string[]
  proportional_deficits: Record<string, number>
  analysis_notes: string | null
  photos_used: number
  source: string
}

async function apiFetch(path: string): Promise<Response> {
  const token = await getIdToken().catch(() => '')
  return fetch(apiUrl(path), {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
}

function safeJsonParse<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

/**
 * Returns a finite number if `v` can be coerced to one, otherwise null.
 * Handles the production reality that:
 *   - Postgres NUMERIC columns deserialise as strings via the `pg` driver.
 *   - JSONB values may be stored as either numbers or numeric strings depending
 *     on how the producer encoded them.
 *   - Old/migrated rows may contain `null`, `"NaN"`, empty strings, or floats
 *     dressed up as currencies.
 *
 * Anything that isn't a finite number ends up as `null` so callers can
 * branch on `value != null` without invoking `.toFixed` on a string.
 */
function numOrNull(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const trimmed = v.trim()
    if (trimmed === '' || trimmed.toLowerCase() === 'nan') return null
    const n = Number(trimmed)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function fmt(v: unknown, digits: number, fallback = '—'): string {
  const n = numOrNull(v)
  return n == null ? fallback : n.toFixed(digits)
}

/**
 * Bulletproofs an assessment row coming back from the API. Every field that
 * the renderer treats as a number is coerced to either a finite number or
 * null, and every JSONB collection is normalised to its expected shape with
 * non-numeric / malformed entries dropped.
 *
 * This is the single chokepoint that prevents:
 *   - `.toFixed` is not a function (numeric strings sneaking past)
 *   - `.map` is not a function (weak_points stored as objects)
 *   - `.length` of undefined (history rows missing JSONB defaults)
 *
 * NOTE: We intentionally never throw out of here. Returning a partially
 * populated object is always safer than letting a malformed row propagate
 * into render and trip the global ErrorBoundary.
 */
function normalizeAssessment(raw: any): Assessment | null {
  if (!raw || typeof raw !== 'object') return null
  try {
    const parseObject = (v: unknown): Record<string, any> => {
      if (typeof v === 'string') return safeJsonParse<Record<string, any>>(v, {})
      if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, any>
      return {}
    }
    const parseArray = (v: unknown): any[] => {
      if (typeof v === 'string') {
        const parsed = safeJsonParse<unknown>(v, [])
        return Array.isArray(parsed) ? parsed : []
      }
      return Array.isArray(v) ? v : []
    }

    const rawScores = parseObject(raw.scores)
    const scores: Record<string, number> & {
      _apollo_score?: number
      _score_components?: Record<string, number>
      _muscle_maturity?: number | null
      _v_taper_score?: number | null
      _photos_used?: number
    } = {}
    for (const [k, v] of Object.entries(rawScores)) {
      if (k === '_score_components') {
        const sub = parseObject(v)
        const subOut: Record<string, number> = {}
        for (const [sk, sv] of Object.entries(sub)) {
          const n = numOrNull(sv)
          if (n != null) subOut[sk] = n
        }
        ;(scores as any)._score_components = subOut
        continue
      }
      const n = numOrNull(v)
      if (n != null) (scores as any)[k] = n
    }

    const numericRecord = (v: unknown): Record<string, number> => {
      const obj = parseObject(v)
      const out: Record<string, number> = {}
      for (const [k, val] of Object.entries(obj)) {
        const n = numOrNull(val)
        if (n != null) out[k] = n
      }
      return out
    }

    const stringArray = (v: unknown): string[] =>
      parseArray(v).filter((x): x is string => typeof x === 'string' && x.length > 0)

    return {
      id: typeof raw.id === 'string' ? raw.id : String(raw.id ?? ''),
      date: typeof raw.date === 'string' ? raw.date : String(raw.date ?? ''),
      scores,
      shoulder_to_waist_ratio: numOrNull(raw.shoulder_to_waist_ratio),
      left_right_symmetry: numOrNull(raw.left_right_symmetry),
      estimated_body_fat_pct: numOrNull(raw.estimated_body_fat_pct),
      measurements: numericRecord(raw.measurements),
      reeves_ideals: numericRecord(raw.reeves_ideals),
      weak_points: stringArray(raw.weak_points),
      strong_points: stringArray(raw.strong_points),
      proportional_deficits: numericRecord(raw.proportional_deficits),
      analysis_notes: typeof raw.analysis_notes === 'string' ? raw.analysis_notes : null,
      photos_used: numOrNull(raw.photos_used) ?? 0,
      source: typeof raw.source === 'string' ? raw.source : 'photo_ai',
    }
  } catch (err) {
    logError('ProportionsDashboard.normalizeAssessment failed', err)
    return null
  }
}

function formatGroupName(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function scoreClass(score: number): string {
  if (score <= 4) return 'low'
  if (score <= 6) return 'mid'
  return 'high'
}

function daysAgo(dateStr: string): number {
  if (!dateStr || typeof dateStr !== 'string') return 0
  const d = new Date(dateStr + 'T12:00:00')
  const t = d.getTime()
  if (!Number.isFinite(t)) return 0
  return Math.max(0, Math.round((Date.now() - t) / 86400000))
}

const PHI = 1.618

const REEVES_PARTS = ['chest', 'waist', 'shoulder', 'arm', 'forearm', 'thigh', 'calf'] as const

const SCORE_DISPLAY = [
  'mid_chest', 'upper_chest', 'back_lats', 'back_upper',
  'lateral_deltoid', 'anterior_deltoid', 'posterior_deltoid',
  'quadriceps', 'hamstrings', 'glutes',
  'biceps', 'triceps', 'calves',
  'core', 'forearms', 'upper_traps', 'erector_spinae',
]

function computeEngineBoosts(
  deficits: Record<string, number>,
  scores: Record<string, number>
): Array<{ muscle: string; multiplier: number; reason: string; direction: 'boost' | 'dampen' }> {
  const boosts: Array<{ muscle: string; multiplier: number; reason: string; direction: 'boost' | 'dampen' }> = []

  for (const [muscle, rawDeficit] of Object.entries(deficits)) {
    const deficit = numOrNull(rawDeficit)
    if (deficit == null || deficit === 0) continue
    const mult = Math.max(0.6, Math.min(2.0, 1.0 - deficit * 3.0))
    if (Math.abs(mult - 1.0) < 0.05) continue
    const pct = Math.abs(deficit * 100).toFixed(0)
    const direction = deficit < 0 ? 'boost' : 'dampen'
    const reason = deficit < 0
      ? `${pct}% below proportional ideal`
      : `${pct}% above ideal — volume redistributed`
    boosts.push({ muscle, multiplier: mult, reason, direction })
  }

  for (const [muscle, rawScore] of Object.entries(scores)) {
    if (muscle.startsWith('_')) continue
    if (deficits[muscle] !== undefined) continue
    const score = numOrNull(rawScore)
    if (score == null) continue
    const visualDeficit = (7 - score) / 10
    if (Math.abs(visualDeficit) <= 0.05) continue
    const mult = Math.max(0.6, Math.min(2.0, 1.0 + visualDeficit * 2.5))
    if (Math.abs(mult - 1.0) < 0.05) continue
    const direction = score < 7 ? 'boost' : 'dampen'
    const reason = `Visual score ${score.toFixed(1)}/10`
    boosts.push({ muscle, multiplier: mult, reason, direction })
  }

  boosts.sort((a, b) => {
    if (a.direction === 'boost' && b.direction !== 'boost') return -1
    if (a.direction !== 'boost' && b.direction === 'boost') return 1
    return Math.abs(b.multiplier - 1) - Math.abs(a.multiplier - 1)
  })

  return boosts
}

function ProportionsDashboardInner() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [latest, setLatest] = useState<Assessment | null>(null)
  const [history, setHistory] = useState<Assessment[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    if (!user) return
    setLoading(true)
    setLoadError(null)
    try {
      const [latestRes, historyRes] = await Promise.all([
        apiFetch('/api/physique/latest'),
        apiFetch('/api/physique/history?limit=30'),
      ])
      // 4xx/5xx no longer dropped silently — surface them so the empty-state
      // path can distinguish "no assessments yet" from "API broken".
      if (!latestRes.ok && latestRes.status !== 404) {
        throw new Error(`physique/latest ${latestRes.status}`)
      }
      if (!historyRes.ok && historyRes.status !== 404) {
        throw new Error(`physique/history ${historyRes.status}`)
      }
      if (latestRes.ok) {
        const d = await latestRes.json().catch(() => ({}))
        setLatest(normalizeAssessment(d?.assessment))
      }
      if (historyRes.ok) {
        const d = await historyRes.json().catch(() => ({}))
        const list = Array.isArray(d?.assessments)
          ? (d.assessments.map(normalizeAssessment).filter(Boolean) as Assessment[])
          : []
        setHistory(list)
      }
    } catch (err) {
      logError('ProportionsDashboard.loadData failed', err)
      setLoadError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => { loadData() }, [loadData])

  if (loadError) {
    return (
      <SafeAreaScaffold>
        <div className={styles.container}>
          <div className={styles.header}>
            <button className={styles.backBtn} onClick={() => navigate(-1)}>Back</button>
            <h1>Proportions</h1>
            <div style={{ width: 40 }} />
          </div>
          <div className={styles.content}>
            <div className={styles.emptyState}>
              <h3>Couldn't load proportions</h3>
              <p>{loadError}</p>
              <button className={styles.actionBtnPrimary} onClick={loadData}>Try again</button>
            </div>
          </div>
        </div>
      </SafeAreaScaffold>
    )
  }

  if (loading) {
    return (
      <SafeAreaScaffold>
        <div className={styles.container}>
          <div className={styles.header}>
            <button className={styles.backBtn} onClick={() => navigate(-1)}>Back</button>
            <h1>Proportions</h1>
            <div style={{ width: 40 }} />
          </div>
          <div className={styles.loading}><span className={styles.spinner} /> Loading...</div>
        </div>
      </SafeAreaScaffold>
    )
  }

  if (!latest) {
    return (
      <SafeAreaScaffold>
        <div className={styles.container}>
          <div className={styles.header}>
            <button className={styles.backBtn} onClick={() => navigate(-1)}>Back</button>
            <h1>Proportions</h1>
            <div style={{ width: 40 }} />
          </div>
          <div className={styles.content}>
            <div className={styles.emptyState}>
              <h3>No Physique Data Yet</h3>
              <p>
                Upload photos or enter tape measurements to see your proportional profile,
                Adonis Index, Reeves ideal targets, and what the engine is prioritizing.
              </p>
              <button className={styles.actionBtnPrimary} onClick={() => navigate('/physique')}>
                Start Check-In
              </button>
            </div>
          </div>
        </div>
      </SafeAreaScaffold>
    )
  }

  // After normalizeAssessment, every numeric field is already either a finite
  // number or null. We re-coerce here only as belt-and-suspenders for the
  // `loading=false, latest=non-null, but malformed` path.
  const adonisRatio = numOrNull(latest.shoulder_to_waist_ratio)
  const adonisDelta = adonisRatio != null ? adonisRatio - PHI : null
  const assessmentDays = daysAgo(latest.date)
  const deficits = latest.proportional_deficits || {}
  const scores = latest.scores || {}
  const measurements = latest.measurements || {}
  const ideals = latest.reeves_ideals || {}
  const engineBoosts = computeEngineBoosts(deficits, scores)
  const hasMeasurements = Object.keys(measurements).some(k =>
    REEVES_PARTS.includes(k as any) && numOrNull(measurements[k]) != null
  )

  const adonisHistory = history
    .map(h => numOrNull(h.shoulder_to_waist_ratio))
    .filter((v): v is number => v != null)
    .reverse()

  const scoreTrends: Record<string, number[]> = {}
  const reversed = [...history].reverse()
  for (const h of reversed) {
    if (!h.scores) continue
    for (const [k, v] of Object.entries(h.scores)) {
      if (k.startsWith('_')) continue
      const n = numOrNull(v)
      if (n == null) continue
      if (!scoreTrends[k]) scoreTrends[k] = []
      scoreTrends[k].push(n)
    }
  }

  const bfHistory = history
    .map(h => ({ date: h.date, bf: numOrNull(h.estimated_body_fat_pct) }))
    .filter((h): h is { date: string; bf: number } => h.bf != null)
  const latestBf = bfHistory.length > 0 ? bfHistory[0].bf : null
  const prevBf = bfHistory.length > 1 ? bfHistory[1].bf : null
  const bfDelta = latestBf != null && prevBf != null ? latestBf - prevBf : null

  return (
    <SafeAreaScaffold>
      <div className={styles.container}>
        <div className={styles.header}>
          <button className={styles.backBtn} onClick={() => navigate(-1)}>Back</button>
          <h1>Proportions</h1>
          <div style={{ width: 40 }} />
        </div>

        <div className={styles.content}>
          {/* Apollo Score Hero */}
          {numOrNull(latest.scores?._apollo_score) != null && (() => {
            const apolloScore = numOrNull(latest.scores?._apollo_score)!
            const apolloHistory = history
              .map(h => numOrNull(h.scores?._apollo_score))
              .filter((v): v is number => v != null)
              .reverse()
            const prevScore = apolloHistory.length > 1 ? apolloHistory[apolloHistory.length - 2] : null
            const delta = prevScore != null ? apolloScore - prevScore : null
            const grade = apolloScore >= 80 ? 'Elite' : apolloScore >= 65 ? 'Advanced' : apolloScore >= 50 ? 'Intermediate' : apolloScore >= 35 ? 'Developing' : 'Foundation'
            const targetScore = 85
            return (
              <div style={{
                background: 'linear-gradient(135deg, rgba(139,92,246,0.14), rgba(59,130,246,0.08))',
                border: '1px solid rgba(139,92,246,0.25)',
                borderRadius: 16, padding: 20, textAlign: 'center', marginBottom: 4,
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'rgba(139,92,246,0.8)' }}>
                  Apollo Score
                </div>
                <div style={{ fontSize: 52, fontWeight: 900, color: 'var(--text-primary)', lineHeight: 1, marginTop: 4 }}>
                  {apolloScore.toFixed(1)}
                </div>
                <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 4 }}>
                  {grade}
                  {delta != null && (
                    <span style={{ color: delta >= 0 ? '#22c55e' : '#ef4444', fontWeight: 700, marginLeft: 8 }}>
                      {delta >= 0 ? '+' : ''}{delta.toFixed(1)}
                    </span>
                  )}
                </div>
                <div style={{ height: 6, borderRadius: 3, background: 'var(--border)', marginTop: 12 }}>
                  <div style={{
                    height: '100%', borderRadius: 3, width: `${Math.min(100, (apolloScore / targetScore) * 100)}%`,
                    background: 'linear-gradient(90deg, #8b5cf6, #3b82f6)',
                  }} />
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 6 }}>
                  {apolloScore >= targetScore ? 'Elite level achieved' : `${(targetScore - apolloScore).toFixed(1)} points to Elite (${targetScore})`}
                </div>
                {apolloHistory.length > 1 && (
                  <div style={{ display: 'flex', justifyContent: 'center', gap: 3, marginTop: 10 }}>
                    {apolloHistory.slice(-12).map((v, i, arr) => {
                      const min = Math.min(...arr)
                      const max = Math.max(...arr)
                      const range = max - min || 5
                      const h = Math.max(6, Math.round(((v - min) / range) * 28))
                      return (
                        <div key={i} style={{
                          width: 5, height: h, borderRadius: 3,
                          background: i === arr.length - 1 ? '#8b5cf6' : 'rgba(139,92,246,0.3)',
                        }} />
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })()}

          {/* Adonis Index Hero */}
          <div className={styles.adonisHero}>
            {adonisRatio != null ? (
              <>
                <div className={styles.adonisValue}>{adonisRatio.toFixed(2)}</div>
                <div className={styles.adonisSubtitle}>Target: {PHI} (Golden Ratio)</div>
                <div className={styles.adonisLabel}>Adonis Index</div>
                {adonisDelta != null && (
                  <div className={`${styles.adonisDelta} ${
                    Math.abs(adonisDelta) < 0.03 ? styles.neutral
                    : adonisDelta > 0 ? styles.positive
                    : styles.negative
                  }`}>
                    {adonisDelta > 0 ? '+' : ''}{adonisDelta.toFixed(3)} from target
                  </div>
                )}
                {adonisHistory.length > 1 && (
                  <div className={styles.trendRow}>
                    {adonisHistory.map((v, i) => {
                      const min = Math.min(...adonisHistory)
                      const max = Math.max(...adonisHistory)
                      const range = max - min || 0.1
                      const h = Math.max(8, Math.round(((v - min) / range) * 32))
                      return (
                        <div
                          key={i}
                          className={styles.trendBar}
                          style={{
                            height: h,
                            opacity: i === adonisHistory.length - 1 ? 1 : 0.3 + (i / adonisHistory.length) * 0.4,
                          }}
                        />
                      )
                    })}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className={styles.adonisValue}>—</div>
                <div className={styles.adonisSubtitle}>Upload photos to calculate</div>
                <div className={styles.adonisLabel}>Adonis Index</div>
              </>
            )}

            {numOrNull(latest.left_right_symmetry) != null && (
              <div className={styles.symmetryCard}>
                <span className={styles.symmetryLabel}>Symmetry</span>
                <span className={styles.symmetryValue}>
                  {fmt(numOrNull(latest.left_right_symmetry)! * 100, 0)}%
                </span>
              </div>
            )}

            {latestBf != null && (
              <div className={styles.symmetryCard} style={{ marginTop: 6 }}>
                <span className={styles.symmetryLabel}>Body Fat</span>
                <span className={styles.symmetryValue}>
                  {latestBf.toFixed(1)}%
                  {bfDelta != null && (
                    <span className={`${styles.bfTrend} ${bfDelta <= 0 ? styles.down : styles.up}`}>
                      {bfDelta > 0 ? '+' : ''}{bfDelta.toFixed(1)}
                    </span>
                  )}
                </span>
              </div>
            )}

            <div className={styles.assessmentAge}>
              {assessmentDays === 0 ? 'Updated today' : `${assessmentDays} day${assessmentDays !== 1 ? 's' : ''} ago`}
            </div>
          </div>

          {/* Engine Volume Adjustments */}
          {engineBoosts.length > 0 && (
            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>
                Engine Adjustments
                <span className={styles.sectionSubtitle}>Active volume modifiers</span>
              </h3>
              <div className={styles.boostGrid}>
                {engineBoosts.map((b, i) => (
                  <div key={i} className={styles.boostCard}>
                    <div
                      className={`${styles.boostBar} ${b.direction === 'boost' ? styles.boost : styles.dampen}`}
                      style={{ height: Math.max(24, Math.abs(b.multiplier - 1) * 120) }}
                    />
                    <div className={styles.boostInfo}>
                      <div className={styles.boostMuscle}>{formatGroupName(b.muscle)}</div>
                      <div className={styles.boostReason}>{b.reason}</div>
                    </div>
                    <div className={`${styles.boostMultiplier} ${b.direction === 'boost' ? styles.up : styles.down}`}>
                      {b.multiplier.toFixed(2)}x
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Muscle Development Scores with Trend */}
          {Object.keys(scores).length > 0 && (
            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>
                Muscle Development
                <span className={styles.sectionSubtitle}>Score / 10</span>
              </h3>
              <div className={styles.progressionList}>
                {SCORE_DISPLAY
                  .map(k => ({ k, score: numOrNull(scores[k]) }))
                  .filter((x): x is { k: string; score: number } => x.score != null)
                  .sort((a, b) => a.score - b.score)
                  .map(({ k, score }) => {
                    const cls = scoreClass(score)
                    const trend = scoreTrends[k] || []
                    return (
                      <div key={k} className={styles.progressionItem}>
                        <span className={styles.progressionLabel}>{formatGroupName(k)}</span>
                        <div className={styles.progressionBarTrack}>
                          <div
                            className={`${styles.progressionBarFill} ${styles[cls]}`}
                            style={{ width: `${Math.max(0, Math.min(100, score * 10))}%` }}
                          />
                        </div>
                        {trend.length > 1 && (
                          <div className={styles.scoreTrendRow}>
                            {trend.slice(-6).map((v, i, arr) => (
                              <div
                                key={i}
                                className={`${styles.scoreTrendBar} ${i === arr.length - 1 ? styles.latest : ''}`}
                                style={{ height: Math.max(4, Math.min(24, v * 2.4)) }}
                              />
                            ))}
                          </div>
                        )}
                        <span className={`${styles.progressionScore} ${styles[cls]}`}>
                          {score.toFixed(1)}
                        </span>
                      </div>
                    )
                  })}
              </div>
            </div>
          )}

          {/* Reeves Proportional Targets */}
          {hasMeasurements && Object.keys(ideals).length > 0 && (
            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>
                Reeves Proportions
                <span className={styles.sectionSubtitle}>Ideal vs Actual (inches)</span>
              </h3>
              <div className={styles.reevesTable}>
                <div className={styles.reevesRowHeader}>
                  <span>Body Part</span>
                  <span style={{ textAlign: 'center' }}>Actual</span>
                  <span style={{ textAlign: 'center' }}>Ideal</span>
                  <span style={{ textAlign: 'right', paddingRight: 4 }}>Delta</span>
                </div>
                {REEVES_PARTS
                  .map(part => ({
                    part,
                    actual: numOrNull(measurements[part]),
                    ideal: numOrNull(ideals[part]),
                  }))
                  .filter(x => x.ideal != null)
                  .map(({ part, actual, ideal }) => {
                    const delta = actual != null && ideal != null && ideal !== 0
                      ? ((actual - ideal) / ideal) * 100
                      : null
                    return (
                      <div key={part} className={styles.reevesRow}>
                        <span className={styles.reevesBodyPart}>{part}</span>
                        <span className={styles.reevesActual}>
                          {fmt(actual, 1)}
                        </span>
                        <span className={styles.reevesIdeal}>
                          {fmt(ideal, 1)}
                        </span>
                        <span className={`${styles.reevesDeficit} ${
                          delta == null ? styles.onTarget
                          : delta < -2 ? styles.behind
                          : delta > 2 ? styles.ahead
                          : styles.onTarget
                        }`}>
                          {delta != null
                            ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)}%`
                            : '—'}
                        </span>
                      </div>
                    )
                  })}
              </div>
            </div>
          )}

          {/* Weak & Strong Points */}
          {(latest.weak_points?.length > 0 || latest.strong_points?.length > 0) && (
            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>Priority Areas</h3>
              {latest.weak_points?.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 6, fontWeight: 600 }}>
                    NEEDS WORK
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {latest.weak_points.map((p, i) => (
                      <span key={i} style={{
                        background: 'rgba(239, 68, 68, 0.12)',
                        color: '#ef4444',
                        fontSize: 12,
                        fontWeight: 600,
                        padding: '4px 10px',
                        borderRadius: 20,
                      }}>{formatGroupName(p)}</span>
                    ))}
                  </div>
                </div>
              )}
              {latest.strong_points?.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 6, fontWeight: 600 }}>
                    STRONG
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {latest.strong_points.map((p, i) => (
                      <span key={i} style={{
                        background: 'rgba(34, 197, 94, 0.12)',
                        color: '#22c55e',
                        fontSize: 12,
                        fontWeight: 600,
                        padding: '4px 10px',
                        borderRadius: 20,
                      }}>{formatGroupName(p)}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className={styles.actionRow}>
            <button className={styles.actionBtnPrimary} onClick={() => navigate('/physique')}>
              New Check-In
            </button>
            <button className={styles.actionBtn} onClick={() => navigate('/physique')}>
              Measurements
            </button>
          </div>
        </div>
      </div>
    </SafeAreaScaffold>
  )
}

/**
 * Page-scoped error boundary so a render-time crash inside the dashboard
 * doesn't bubble up to the global ErrorBoundary (which shows a generic
 * "Something went wrong"). Instead the user gets a Proportions-specific
 * error state with a working Back button and a Retry that remounts the
 * inner component — useful when the underlying issue was transient (e.g.
 * a malformed JSONB row that's since been repaired).
 *
 * We also forward the captured error to the central logger so we have a
 * trace if a malformed row sneaks past `normalizeAssessment`.
 */
class ProportionsErrorBoundary extends Component<
  { fallback: (err: Error, retry: () => void) => ReactNode; children: ReactNode },
  { error: Error | null; key: number }
> {
  state = { error: null as Error | null, key: 0 }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error, info: any) {
    logError('ProportionsDashboard render error', { message: error.message, stack: error.stack, info })
  }
  retry = () => this.setState((s) => ({ error: null, key: s.key + 1 }))
  render() {
    if (this.state.error) return this.props.fallback(this.state.error, this.retry)
    return <div key={this.state.key}>{this.props.children}</div>
  }
}

export default function ProportionsDashboard() {
  return (
    <ProportionsErrorBoundary
      fallback={(err, retry) => (
        <SafeAreaScaffold>
          <div className={styles.container}>
            <div className={styles.header}>
              <button
                className={styles.backBtn}
                onClick={() => { try { window.history.back() } catch { /* noop */ } }}
              >
                Back
              </button>
              <h1>Proportions</h1>
              <div style={{ width: 40 }} />
            </div>
            <div className={styles.content}>
              <div className={styles.emptyState}>
                <h3>Something broke loading your proportions</h3>
                <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-tertiary)' }}>
                  {err.message || 'Unknown error'}
                </p>
                <button className={styles.actionBtnPrimary} onClick={retry}>Try again</button>
              </div>
            </div>
          </div>
        </SafeAreaScaffold>
      )}
    >
      <ProportionsDashboardInner />
    </ProportionsErrorBoundary>
  )
}
