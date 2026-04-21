import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getIdToken } from '../lib/cognitoAuth'
import { apiUrl } from '../lib/urlConfig'
import SafeAreaScaffold from '../components/ui/SafeAreaScaffold'
import styles from './PhysiqueCheckIn.module.css'

interface Assessment {
  id: string
  date: string
  scores: Record<string, number>
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

export default function PhysiqueCheckIn() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const frontInputRef = useRef<HTMLInputElement>(null)
  const backInputRef = useRef<HTMLInputElement>(null)

  const [frontPhoto, setFrontPhoto] = useState<string | null>(null)
  const [backPhoto, setBackPhoto] = useState<string | null>(null)
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

  const handlePhoto = async (file: File, slot: 'front' | 'back') => {
    try {
      const resized = await resizeImage(file)
      if (slot === 'front') setFrontPhoto(resized)
      else setBackPhoto(resized)
    } catch {
      setError('Failed to process image')
    }
  }

  const handleAnalyze = async () => {
    if (!user || (!frontPhoto && !backPhoto)) return
    setAnalyzing(true)
    setError(null)
    try {
      const images = [frontPhoto, backPhoto].filter(Boolean) as string[]
      const res = await apiFetch('/api/physique/analyze', {
        method: 'POST',
        body: JSON.stringify({ images }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Analysis failed')
      }
      const d = await res.json()
      setLatest(d.assessment)
      setFrontPhoto(null)
      setBackPhoto(null)
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
          <div style={{ width: 40 }} />
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

          {/* Photo Capture */}
          <div className={styles.captureSection}>
            <h3 className={styles.sectionTitle}>Photo Analysis</h3>
            <div className={styles.photoGrid}>
              <div
                className={`${styles.photoSlot} ${frontPhoto ? styles.filled : ''}`}
                onClick={() => frontInputRef.current?.click()}
              >
                {frontPhoto ? (
                  <img src={frontPhoto} alt="Front" className={styles.photoPreview} />
                ) : (
                  <>
                    <span className={styles.photoSlotIcon}>&#128247;</span>
                    <span className={styles.photoSlotLabel}>Front Relaxed</span>
                  </>
                )}
                <input
                  ref={frontInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  style={{ display: 'none' }}
                  onChange={e => {
                    const f = e.target.files?.[0]
                    if (f) handlePhoto(f, 'front')
                    e.target.value = ''
                  }}
                />
              </div>
              <div
                className={`${styles.photoSlot} ${backPhoto ? styles.filled : ''}`}
                onClick={() => backInputRef.current?.click()}
              >
                {backPhoto ? (
                  <img src={backPhoto} alt="Back" className={styles.photoPreview} />
                ) : (
                  <>
                    <span className={styles.photoSlotIcon}>&#128247;</span>
                    <span className={styles.photoSlotLabel}>Back Relaxed</span>
                  </>
                )}
                <input
                  ref={backInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  style={{ display: 'none' }}
                  onChange={e => {
                    const f = e.target.files?.[0]
                    if (f) handlePhoto(f, 'back')
                    e.target.value = ''
                  }}
                />
              </div>
            </div>
            <button
              className={styles.analyzeBtn}
              disabled={analyzing || (!frontPhoto && !backPhoto)}
              onClick={handleAnalyze}
            >
              {analyzing ? (
                <><span className={styles.spinner} /> Analyzing...</>
              ) : (
                'Analyze Physique'
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
          {latest && (
            <div className={styles.resultsSection}>
              <h3 className={styles.sectionTitle}>
                Latest Assessment
                <span className={styles.subLabel}> — {latest.date?.slice(0, 10)}</span>
              </h3>

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
          )}

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
              {history.map(h => (
                <div key={h.id} className={styles.historyItem}>
                  <div>
                    <div className={styles.historyDate}>{h.date?.slice(0, 10)}</div>
                    <div className={styles.historySource}>{h.source?.replace('_', ' ')}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
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
              ))}
            </div>
          )}
        </div>
      </div>
    </SafeAreaScaffold>
  )
}
