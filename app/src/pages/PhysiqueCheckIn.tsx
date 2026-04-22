import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getIdToken } from '../lib/cognitoAuth'
import { apiUrl } from '../lib/urlConfig'
import SafeAreaScaffold from '../components/ui/SafeAreaScaffold'
import styles from './PhysiqueCheckIn.module.css'

interface ScoreComponents {
  muscle_development: number
  adonis_index: number
  symmetry: number
  body_composition: number
  proportional_balance: number
}

interface Assessment {
  id: string
  date: string
  scores: Record<string, number> & {
    _apollo_score?: number
    _score_components?: ScoreComponents
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

async function apiFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  const token = await getIdToken().catch(() => '')
  return fetch(apiUrl(path), {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  })
}

const BONE_FIELDS = ['wrist', 'ankle', 'neck', 'knee'] as const
const MUSCLE_FIELDS = ['chest', 'waist', 'shoulder', 'arm', 'forearm', 'thigh', 'calf'] as const

const SCORE_DISPLAY_ORDER = [
  'mid_chest', 'upper_chest', 'back_lats', 'back_upper',
  'lateral_deltoid', 'anterior_deltoid', 'posterior_deltoid',
  'quadriceps', 'hamstrings', 'glutes',
  'biceps', 'triceps', 'calves',
  'core', 'forearms', 'upper_traps', 'erector_spinae',
]

function formatGroupName(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function scoreClass(score: number): string {
  if (score <= 4) return styles.low
  if (score <= 6) return styles.mid
  return styles.high
}

async function resizeImage(file: File, maxDim = 1024, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const scale = Math.min(maxDim / img.width, maxDim / img.height, 1)
        const w = Math.round(img.width * scale)
        const h = Math.round(img.height * scale)
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) return reject(new Error('Canvas not supported'))
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', quality))
      }
      img.onerror = reject
      img.src = reader.result as string
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

type PhotoSlot = 'front' | 'back' | 'side' | 'flex'

const PHOTO_SLOTS: { key: PhotoSlot; label: string; required: boolean }[] = [
  { key: 'front', label: 'Front Relaxed', required: true },
  { key: 'back', label: 'Back Relaxed', required: true },
  { key: 'side', label: 'Side Profile', required: false },
  { key: 'flex', label: 'Flex / Posed', required: false },
]

export default function PhysiqueCheckIn() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const inputRefs = useRef<Record<PhotoSlot, HTMLInputElement | null>>({
    front: null, back: null, side: null, flex: null,
  })

  const [photos, setPhotos] = useState<Record<PhotoSlot, string | null>>({
    front: null, back: null, side: null, flex: null,
  })
  const [analyzing, setAnalyzing] = useState(false)
  const [latest, setLatest] = useState<Assessment | null>(null)
  const [history, setHistory] = useState<Assessment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showMeasurements, setShowMeasurements] = useState(false)
  const [measurements, setMeasurements] = useState<Record<string, string>>({})
  const [savingMeasurements, setSavingMeasurements] = useState(false)

  const loadData = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const [latestRes, historyRes] = await Promise.all([
        apiFetch('/api/physique/latest'),
        apiFetch('/api/physique/history?limit=20'),
      ])
      if (latestRes.ok) {
        const d = await latestRes.json()
        setLatest(d.assessment)
        if (d.assessment?.measurements) {
          const m: Record<string, string> = {}
          for (const [k, v] of Object.entries(d.assessment.measurements)) {
            if (v != null) m[k] = String(v)
          }
          setMeasurements(m)
        }
      }
      if (historyRes.ok) {
        const d = await historyRes.json()
        setHistory(d.assessments || [])
      }
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => { loadData() }, [loadData])

  const handlePhoto = async (file: File, slot: PhotoSlot) => {
    try {
      const resized = await resizeImage(file)
      setPhotos(prev => ({ ...prev, [slot]: resized }))
    } catch {
      setError('Failed to process image')
    }
  }

  const filledPhotos = PHOTO_SLOTS.filter(s => photos[s.key] != null)
  const hasAnyPhoto = filledPhotos.length > 0

  const handleAnalyze = async () => {
    if (!user || !hasAnyPhoto) return
    setAnalyzing(true)
    setError(null)
    try {
      const images: string[] = []
      const labels: string[] = []
      for (const slot of PHOTO_SLOTS) {
        if (photos[slot.key]) {
          images.push(photos[slot.key]!)
          labels.push(slot.label)
        }
      }
      const res = await apiFetch('/api/physique/analyze', {
        method: 'POST',
        body: JSON.stringify({ images, labels }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Analysis failed')
      }
      const d = await res.json()
      setLatest(d.assessment)
      setPhotos({ front: null, back: null, side: null, flex: null })
      await loadData()
    } catch (e: any) {
      setError(e.message || 'Analysis failed')
    } finally {
      setAnalyzing(false)
    }
  }

  const handleSaveMeasurements = async () => {
    if (!user) return
    setSavingMeasurements(true)
    setError(null)
    try {
      const clean: Record<string, number> = {}
      for (const [k, v] of Object.entries(measurements)) {
        const n = parseFloat(v)
        if (!isNaN(n) && n > 0) clean[k] = n
      }
      const res = await apiFetch('/api/physique/measurements', {
        method: 'POST',
        body: JSON.stringify({ measurements: clean }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Save failed')
      }
      const d = await res.json()
      setLatest(d.assessment)
      await loadData()
    } catch (e: any) {
      setError(e.message || 'Save failed')
    } finally {
      setSavingMeasurements(false)
    }
  }

  const reevesIdeals = latest?.reeves_ideals || {}

  return (
    <SafeAreaScaffold>
      <div className={styles.container}>
        <div className={styles.header}>
          <button className={styles.backBtn} onClick={() => navigate(-1)}>Back</button>
          <h1>Physique Check-In</h1>
          <button className={styles.backBtn} onClick={() => navigate('/proportions')}>Dashboard</button>
        </div>

        <div className={styles.content}>
          {/* Privacy notice */}
          <div className={styles.privacyNotice}>
            <span className={styles.privacyIcon}>&#128274;</span>
            <span className={styles.privacyText}>
              Photos are processed and immediately discarded. Only numerical scores are stored.
              No image is ever saved to any server or database.
            </span>
          </div>

          {/* Photo Capture — 4 slots */}
          <div className={styles.captureSection}>
            <h3 className={styles.sectionTitle}>Photo Analysis</h3>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 12, lineHeight: 1.5 }}>
              Front + Back required. Side and flex are optional but improve accuracy.
              {filledPhotos.length > 0 && (
                <span style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>
                  {' '}{filledPhotos.length}/4 photos selected
                </span>
              )}
            </div>
            <div className={styles.photoGrid}>
              {PHOTO_SLOTS.map(slot => (
                <div
                  key={slot.key}
                  className={`${styles.photoSlot} ${photos[slot.key] ? styles.filled : ''}`}
                  onClick={() => inputRefs.current[slot.key]?.click()}
                >
                  {photos[slot.key] ? (
                    <img src={photos[slot.key]!} alt={slot.label} className={styles.photoPreview} />
                  ) : (
                    <>
                      <span className={styles.photoSlotIcon}>&#128247;</span>
                      <span className={styles.photoSlotLabel}>
                        {slot.label}
                        {!slot.required && <span style={{ fontSize: 10, opacity: 0.6 }}> (opt)</span>}
                      </span>
                    </>
                  )}
                  <input
                    ref={el => { inputRefs.current[slot.key] = el }}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={e => {
                      const f = e.target.files?.[0]
                      if (f) handlePhoto(f, slot.key)
                      e.target.value = ''
                    }}
                  />
                </div>
              ))}
            </div>
            <button
              className={styles.analyzeBtn}
              disabled={analyzing || !hasAnyPhoto}
              onClick={handleAnalyze}
            >
              {analyzing ? (
                <><span className={styles.spinner} /> Analyzing {filledPhotos.length} photo{filledPhotos.length !== 1 ? 's' : ''}...</>
              ) : (
                `Analyze Physique (${filledPhotos.length} photo${filledPhotos.length !== 1 ? 's' : ''})`
              )}
            </button>
          </div>

          {error && (
            <div style={{ color: '#ef4444', fontSize: 13, padding: '0 4px' }}>{error}</div>
          )}

          {loading && !latest && (
            <div className={styles.loading}>
              <span className={styles.spinner} /> Loading...
            </div>
          )}

          {/* Results */}
          {latest && (() => {
            const apolloScore = latest.scores?._apollo_score ?? null
            const components = latest.scores?._score_components ?? null
            const maturity = latest.scores?._muscle_maturity ?? null
            const vTaper = latest.scores?._v_taper_score ?? null
            const photosUsed = latest.scores?._photos_used ?? latest.photos_used ?? 0

            const scoreHistory = history
              .map(h => h.scores?._apollo_score)
              .filter((v): v is number => v != null)
              .reverse()

            const prevScore = scoreHistory.length > 1 ? scoreHistory[scoreHistory.length - 2] : null
            const scoreDelta = apolloScore != null && prevScore != null ? apolloScore - prevScore : null

            const scoreGrade = apolloScore != null
              ? apolloScore >= 80 ? 'Elite'
                : apolloScore >= 65 ? 'Advanced'
                : apolloScore >= 50 ? 'Intermediate'
                : apolloScore >= 35 ? 'Developing'
                : 'Foundation'
              : null

            const targetScore = 85
            const distanceToTarget = apolloScore != null ? targetScore - apolloScore : null

            let projectedWeeks: number | null = null
            if (scoreHistory.length >= 2 && apolloScore != null && distanceToTarget != null && distanceToTarget > 0) {
              const oldest = scoreHistory[0]
              const weeksOfData = Math.max(1, scoreHistory.length * 2)
              const ratePerWeek = (apolloScore - oldest) / weeksOfData
              if (ratePerWeek > 0) {
                projectedWeeks = Math.round(distanceToTarget / ratePerWeek)
              }
            }

            return (
            <div className={styles.resultsSection}>
              <h3 className={styles.sectionTitle}>
                Latest Assessment
                <span className={styles.subLabel}> — {latest.date?.slice(0, 10)}</span>
              </h3>

              {/* Apollo Score Hero */}
              {apolloScore != null && (
                <div style={{
                  background: 'linear-gradient(135deg, rgba(139,92,246,0.12), rgba(59,130,246,0.08))',
                  border: '1px solid rgba(139,92,246,0.25)',
                  borderRadius: 14, padding: 20, textAlign: 'center', marginBottom: 16,
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'rgba(139,92,246,0.8)', marginBottom: 6 }}>
                    Apollo Score
                  </div>
                  <div style={{ fontSize: 48, fontWeight: 900, color: 'var(--text-primary)', lineHeight: 1 }}>
                    {apolloScore.toFixed(1)}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
                    {scoreGrade}
                    {scoreDelta != null && (
                      <span style={{ color: scoreDelta >= 0 ? '#22c55e' : '#ef4444', fontWeight: 700, marginLeft: 8 }}>
                        {scoreDelta >= 0 ? '+' : ''}{scoreDelta.toFixed(1)} from last
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
                    {photosUsed} photo{photosUsed !== 1 ? 's' : ''} analyzed
                    {photosUsed < 4 && ' — add more angles for higher accuracy'}
                  </div>

                  {/* Component breakdown */}
                  {components && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 14, textAlign: 'left' }}>
                      {[
                        { label: 'Muscle', val: components.muscle_development, weight: 40 },
                        { label: 'Adonis', val: components.adonis_index, weight: 20 },
                        { label: 'Symmetry', val: components.symmetry, weight: 10 },
                        { label: 'Body Comp', val: components.body_composition, weight: 15 },
                        { label: 'Balance', val: components.proportional_balance, weight: 15 },
                      ].map(c => (
                        <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{c.label} ({c.weight}%)</div>
                            <div style={{ height: 4, borderRadius: 2, background: 'var(--border)', marginTop: 2 }}>
                              <div style={{
                                height: '100%', borderRadius: 2, width: `${c.val * 100}%`,
                                background: c.val >= 0.7 ? '#22c55e' : c.val >= 0.4 ? '#f59e0b' : '#ef4444',
                              }} />
                            </div>
                          </div>
                          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', minWidth: 32, textAlign: 'right' }}>
                            {(c.val * 100).toFixed(0)}%
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Goal potential */}
                  {distanceToTarget != null && distanceToTarget > 0 && (
                    <div style={{
                      marginTop: 14, padding: '10px 12px', borderRadius: 10,
                      background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)',
                      textAlign: 'left',
                    }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 4 }}>
                        Goal: {targetScore} (Elite)
                      </div>
                      <div style={{ height: 6, borderRadius: 3, background: 'var(--border)' }}>
                        <div style={{
                          height: '100%', borderRadius: 3, width: `${(apolloScore / targetScore) * 100}%`,
                          background: 'linear-gradient(90deg, #8b5cf6, #3b82f6)',
                        }} />
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>
                        {distanceToTarget.toFixed(1)} points to Elite
                        {projectedWeeks != null && (
                          <span style={{ color: 'var(--text-tertiary)' }}>
                            {' '}· ~{projectedWeeks} weeks at current rate
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Score trend */}
                  {scoreHistory.length > 1 && (
                    <div style={{ display: 'flex', justifyContent: 'center', gap: 3, marginTop: 12 }}>
                      {scoreHistory.slice(-10).map((v, i, arr) => {
                        const min = Math.min(...arr)
                        const max = Math.max(...arr)
                        const range = max - min || 5
                        const h = Math.max(6, Math.round(((v - min) / range) * 28))
                        return (
                          <div key={i} style={{
                            width: 6, height: h, borderRadius: 3,
                            background: i === arr.length - 1 ? '#8b5cf6' : 'rgba(139,92,246,0.3)',
                          }} />
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Maturity & V-Taper */}
              {(maturity != null || vTaper != null) && (
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  {maturity != null && (
                    <div style={{ flex: 1, background: 'var(--bg-tertiary)', borderRadius: 10, padding: '10px 12px', textAlign: 'center' }}>
                      <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)' }}>{Number(maturity).toFixed(1)}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Muscle Maturity</div>
                    </div>
                  )}
                  {vTaper != null && (
                    <div style={{ flex: 1, background: 'var(--bg-tertiary)', borderRadius: 10, padding: '10px 12px', textAlign: 'center' }}>
                      <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)' }}>{Number(vTaper).toFixed(1)}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>V-Taper Score</div>
                    </div>
                  )}
                </div>
              )}

              {/* Adonis Index */}
              {latest.shoulder_to_waist_ratio != null && (
                <div className={styles.adonisCard}>
                  <div className={styles.adonisRatio}>
                    {Number(latest.shoulder_to_waist_ratio).toFixed(2)}
                  </div>
                  <div className={styles.adonisTarget}>Target: 1.618 (Golden Ratio)</div>
                  <div className={styles.adonisLabel}>Adonis Index</div>
                </div>
              )}

              {/* Body fat & symmetry */}
              {latest.estimated_body_fat_pct != null && (
                <div className={styles.bodyFatRow}>
                  <span className={styles.bodyFatLabel}>Estimated Body Fat</span>
                  <span className={styles.bodyFatValue}>
                    {Number(latest.estimated_body_fat_pct).toFixed(1)}%
                  </span>
                </div>
              )}
              {latest.left_right_symmetry != null && (
                <div className={styles.symmetryRow}>
                  <span className={styles.symmetryLabel}>Left/Right Symmetry</span>
                  <span className={styles.symmetryValue}>
                    {(Number(latest.left_right_symmetry) * 100).toFixed(0)}%
                  </span>
                </div>
              )}

              {/* Muscle group scores */}
              {Object.keys(latest.scores || {}).length > 0 && (
                <>
                  <h3 className={styles.sectionTitle} style={{ marginTop: 16 }}>
                    Muscle Development Scores
                  </h3>
                  <div className={styles.scoreGrid}>
                    {SCORE_DISPLAY_ORDER
                      .filter(k => latest.scores[k] !== undefined)
                      .map(k => (
                        <div key={k} className={styles.scoreCard}>
                          <span className={styles.scoreLabel}>{formatGroupName(k)}</span>
                          <span className={`${styles.scoreValue} ${scoreClass(latest.scores[k])}`}>
                            {Number(latest.scores[k]).toFixed(1)}
                          </span>
                        </div>
                      ))}
                  </div>
                </>
              )}

              {/* Weak & strong points */}
              {(latest.weak_points?.length > 0 || latest.strong_points?.length > 0) && (
                <div style={{ marginTop: 8 }}>
                  {latest.weak_points?.length > 0 && (
                    <div>
                      <span className={styles.scoreLabel}>Weak Points</span>
                      <div className={styles.pointsList}>
                        {latest.weak_points.map((p, i) => (
                          <span key={i} className={styles.weakTag}>{formatGroupName(p)}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {latest.strong_points?.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <span className={styles.scoreLabel}>Strong Points</span>
                      <div className={styles.pointsList}>
                        {latest.strong_points.map((p, i) => (
                          <span key={i} className={styles.strongTag}>{formatGroupName(p)}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Analysis notes */}
              {latest.analysis_notes && (
                <div className={styles.notes}>{latest.analysis_notes}</div>
              )}
            </div>
            )
          })()}

          {/* Manual Measurements */}
          <div className={styles.measurementSection}>
            <div
              className={styles.measurementToggle}
              onClick={() => setShowMeasurements(!showMeasurements)}
            >
              <span>Tape Measurements (Reeves System)</span>
              <span className={`${styles.toggleArrow} ${showMeasurements ? styles.open : ''}`}>
                &#9660;
              </span>
            </div>

            {showMeasurements && (
              <>
                <h4 style={{ fontSize: 13, color: 'var(--text-tertiary)', margin: '12px 0 8px', fontWeight: 600 }}>
                  Bone Measurements (enter once)
                </h4>
                <div className={styles.measurementGrid}>
                  {BONE_FIELDS.map(field => (
                    <div key={field} className={styles.measurementField}>
                      <label>{field} (in)</label>
                      <input
                        type="number"
                        step="0.25"
                        inputMode="decimal"
                        value={measurements[field] || ''}
                        onChange={e => setMeasurements(m => ({ ...m, [field]: e.target.value }))}
                        placeholder="—"
                      />
                    </div>
                  ))}
                </div>

                <h4 style={{ fontSize: 13, color: 'var(--text-tertiary)', margin: '16px 0 8px', fontWeight: 600 }}>
                  Muscle Measurements
                </h4>
                <div className={styles.measurementGrid}>
                  {MUSCLE_FIELDS.map(field => {
                    const ideal = reevesIdeals[field]
                    const actual = parseFloat(measurements[field] || '')
                    const delta = ideal && !isNaN(actual)
                      ? ((actual - ideal) / ideal * 100).toFixed(1)
                      : null
                    return (
                      <div key={field} className={styles.measurementField}>
                        <label>
                          {field} (in)
                          {ideal && (
                            <span className={styles.idealTag}> ideal: {Number(ideal).toFixed(1)}</span>
                          )}
                        </label>
                        <input
                          type="number"
                          step="0.25"
                          inputMode="decimal"
                          value={measurements[field] || ''}
                          onChange={e => setMeasurements(m => ({ ...m, [field]: e.target.value }))}
                          placeholder="—"
                        />
                        {delta && (
                          <span className={`${styles.idealTag} ${Number(delta) < 0 ? styles.deficit : styles.surplus}`}>
                            {Number(delta) > 0 ? '+' : ''}{delta}% vs ideal
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>

                <button
                  className={styles.saveMeasurementsBtn}
                  disabled={savingMeasurements}
                  onClick={handleSaveMeasurements}
                >
                  {savingMeasurements ? 'Saving...' : 'Save Measurements'}
                </button>
              </>
            )}
          </div>

          {/* History */}
          {history.length > 0 && (
            <div className={styles.historySection}>
              <h3 className={styles.sectionTitle}>History</h3>
              {history.map(h => {
                const hScore = h.scores?._apollo_score
                return (
                  <div key={h.id} className={styles.historyItem}>
                    <div>
                      <div className={styles.historyDate}>{h.date?.slice(0, 10)}</div>
                      <div className={styles.historySource}>
                        {h.source?.replace('_', ' ')}
                        {h.photos_used > 0 && ` · ${h.photos_used} photo${h.photos_used !== 1 ? 's' : ''}`}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      {hScore != null && (
                        <div style={{ fontSize: 16, fontWeight: 800, color: '#8b5cf6' }}>
                          {Number(hScore).toFixed(1)}
                        </div>
                      )}
                      {h.shoulder_to_waist_ratio != null && (
                        <div className={styles.historyRatio}>
                          {Number(h.shoulder_to_waist_ratio).toFixed(2)}
                        </div>
                      )}
                      {h.estimated_body_fat_pct != null && (
                        <div className={styles.historyBf}>
                          {Number(h.estimated_body_fat_pct).toFixed(1)}% BF
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </SafeAreaScaffold>
  )
}
