import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getIdToken } from '../lib/cognitoAuth'
import { apiUrl } from '../lib/urlConfig'
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

function normalizeAssessment(raw: any): Assessment | null {
  if (!raw) return null
  return {
    ...raw,
    scores: typeof raw.scores === 'string' ? safeJsonParse(raw.scores, {}) : (raw.scores || {}),
    measurements: typeof raw.measurements === 'string' ? safeJsonParse(raw.measurements, {}) : (raw.measurements || {}),
    reeves_ideals: typeof raw.reeves_ideals === 'string' ? safeJsonParse(raw.reeves_ideals, {}) : (raw.reeves_ideals || {}),
    proportional_deficits: typeof raw.proportional_deficits === 'string' ? safeJsonParse(raw.proportional_deficits, {}) : (raw.proportional_deficits || {}),
    weak_points: typeof raw.weak_points === 'string' ? safeJsonParse(raw.weak_points, []) : (raw.weak_points || []),
    strong_points: typeof raw.strong_points === 'string' ? safeJsonParse(raw.strong_points, []) : (raw.strong_points || []),
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
  const d = new Date(dateStr + 'T12:00:00')
  const now = new Date()
  return Math.round((now.getTime() - d.getTime()) / 86400000)
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

function computeEngineBoosts(deficits: Record<string, number>, scores: Record<string, number>): Array<{
  muscle: string; multiplier: number; reason: string; direction: 'boost' | 'dampen'
}> {
  const boosts: Array<{ muscle: string; multiplier: number; reason: string; direction: 'boost' | 'dampen' }> = []

  for (const [muscle, deficit] of Object.entries(deficits)) {
    if (deficit === 0) continue
    const mult = Math.max(0.6, Math.min(2.0, 1.0 - deficit * 3.0))
    if (Math.abs(mult - 1.0) < 0.05) continue
    const pct = Math.abs(deficit * 100).toFixed(0)
    const direction = deficit < 0 ? 'boost' : 'dampen'
    const reason = deficit < 0
      ? `${pct}% below proportional ideal`
      : `${pct}% above ideal — volume redistributed`
    boosts.push({ muscle, multiplier: mult, reason, direction })
  }

  for (const [muscle, score] of Object.entries(scores)) {
    if (deficits[muscle] !== undefined) continue
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

export default function ProportionsDashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [latest, setLatest] = useState<Assessment | null>(null)
  const [history, setHistory] = useState<Assessment[]>([])
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const [latestRes, historyRes] = await Promise.all([
        apiFetch('/api/physique/latest'),
        apiFetch('/api/physique/history?limit=30'),
      ])
      if (latestRes.ok) {
        const d = await latestRes.json()
        setLatest(normalizeAssessment(d.assessment))
      }
      if (historyRes.ok) {
        const d = await historyRes.json()
        const list = Array.isArray(d.assessments) ? d.assessments.map(normalizeAssessment).filter(Boolean) as Assessment[] : []
        setHistory(list)
      }
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => { loadData() }, [loadData])

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

  const adonisRatio = latest.shoulder_to_waist_ratio != null ? Number(latest.shoulder_to_waist_ratio) : null
  const adonisDelta = adonisRatio != null ? adonisRatio - PHI : null
  const assessmentDays = daysAgo(latest.date)
  const deficits = latest.proportional_deficits || {}
  const scores = latest.scores || {}
  const measurements = latest.measurements || {}
  const ideals = latest.reeves_ideals || {}
  const engineBoosts = computeEngineBoosts(deficits, scores)
  const hasMeasurements = Object.keys(measurements).some(k => REEVES_PARTS.includes(k as any) && measurements[k])

  // Build Adonis trend from history
  const adonisHistory = history
    .filter(h => h.shoulder_to_waist_ratio != null)
    .map(h => Number(h.shoulder_to_waist_ratio))
    .reverse()

  // Build score trends per muscle group (oldest → newest)
  const scoreTrends: Record<string, number[]> = {}
  const reversed = [...history].reverse()
  for (const h of reversed) {
    if (!h.scores) continue
    for (const [k, v] of Object.entries(h.scores)) {
      if (!scoreTrends[k]) scoreTrends[k] = []
      scoreTrends[k].push(Number(v))
    }
  }

  // Body fat trend
  const bfHistory = history
    .filter(h => h.estimated_body_fat_pct != null)
    .map(h => ({ date: h.date, bf: Number(h.estimated_body_fat_pct) }))
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
          {latest.scores?._apollo_score != null && (() => {
            const apolloScore = latest.scores._apollo_score!
            const apolloHistory = history
              .map(h => h.scores?._apollo_score)
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

            {latest.left_right_symmetry != null && (
              <div className={styles.symmetryCard}>
                <span className={styles.symmetryLabel}>Symmetry</span>
                <span className={styles.symmetryValue}>
                  {(Number(latest.left_right_symmetry) * 100).toFixed(0)}%
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
                  .filter(k => scores[k] !== undefined)
                  .sort((a, b) => (scores[a] ?? 10) - (scores[b] ?? 10))
                  .map(k => {
                    const score = scores[k]
                    const cls = scoreClass(score)
                    const trend = scoreTrends[k] || []
                    return (
                      <div key={k} className={styles.progressionItem}>
                        <span className={styles.progressionLabel}>{formatGroupName(k)}</span>
                        <div className={styles.progressionBarTrack}>
                          <div
                            className={`${styles.progressionBarFill} ${styles[cls]}`}
                            style={{ width: `${score * 10}%` }}
                          />
                        </div>
                        {trend.length > 1 && (
                          <div className={styles.scoreTrendRow}>
                            {trend.slice(-6).map((v, i, arr) => (
                              <div
                                key={i}
                                className={`${styles.scoreTrendBar} ${i === arr.length - 1 ? styles.latest : ''}`}
                                style={{ height: Math.max(4, v * 2.4) }}
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
                  .filter(p => ideals[p] != null)
                  .map(part => {
                    const actual = measurements[part]
                    const ideal = ideals[part]
                    const delta = actual && ideal ? ((actual - ideal) / ideal * 100) : null
                    return (
                      <div key={part} className={styles.reevesRow}>
                        <span className={styles.reevesBodyPart}>{part}</span>
                        <span className={styles.reevesActual}>
                          {actual ? Number(actual).toFixed(1) : '—'}
                        </span>
                        <span className={styles.reevesIdeal}>
                          {Number(ideal).toFixed(1)}
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
