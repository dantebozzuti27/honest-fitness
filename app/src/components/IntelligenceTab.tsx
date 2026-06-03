import React, { useState } from 'react'
import type { TrainingProfile } from '../lib/trainingAnalysis'
import type { AggregatedPattern } from '../lib/patternLearning'
import { fetchTrainingSummary, type TrainingSummary } from '../lib/insightsApi'
import Button from './Button'
import { logError } from '../utils/logger'
import s from '../styles/shared.module.css'

interface Props {
  trainingProfile: TrainingProfile | null
  profileLoading: boolean
  onAnalyze: () => void
}

const arrow = (d: string) => (d === 'up' ? '↑' : d === 'down' ? '↓' : '→')
const trendColor = (d: string, goodDir: 'up' | 'down') =>
  d === goodDir ? 'var(--success)' : d === (goodDir === 'up' ? 'down' : 'up') ? 'var(--danger)' : 'var(--text-secondary)'
const pctColor = (p: number) => (p >= 75 ? 'var(--success)' : p >= 50 ? '#e6a800' : p >= 25 ? 'var(--text-primary)' : '#ef4444')
const pctBg = (p: number) =>
  p >= 75 ? 'rgba(34,197,94,0.15)' : p >= 50 ? 'rgba(230,168,0,0.15)' : p >= 25 ? 'rgba(255,255,255,0.06)' : 'rgba(239,68,68,0.12)'
const pctFill = (p: number) =>
  p >= 75 ? 'rgba(34,197,94,0.3)' : p >= 50 ? 'rgba(230,168,0,0.3)' : p >= 25 ? 'rgba(255,255,255,0.1)' : 'rgba(239,68,68,0.2)'
const levelLabel = (p: number) => (p > 90 ? 'Elite' : p > 75 ? 'Advanced' : p > 50 ? 'Intermediate' : p >= 25 ? 'Novice' : 'Beginner')

function PctBarCell({ pct }: { pct: number }) {
  return (
    <span className={s.pctBar} style={{ backgroundColor: pctBg(pct), color: pctColor(pct) }}>
      <span className={s.pctBarFill} style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: pctFill(pct) }} />
      {pct}th
    </span>
  )
}

function swapStatus(effectiveSwapWeight: number, swapCount: number, acceptanceWeight: number) {
  const w = effectiveSwapWeight
  const recovering = acceptanceWeight > 0 && acceptanceWeight >= w * 0.6
  if (w >= 11.0) return { label: recovering ? 'Excluded · Recovering' : 'Excluded', className: recovering ? s.badgeWarning : s.badgeDanger }
  if (w >= 7.5) return { label: recovering ? 'Strong deprior · Recovering' : 'Strong deprior', className: s.badgeDanger }
  if (w >= 3.5) return { label: recovering ? 'Deprior · Recovering' : 'Deprior', className: s.badgeWarning }
  if (w >= 1.4) return { label: 'Slight penalty', className: s.badgeNeutral }
  if (acceptanceWeight > 0) return { label: 'Active · Boosted', className: s.badgeSuccess }
  return { label: 'Active', className: s.badgeNeutral }
}

const categoryLabel: Record<AggregatedPattern['category'], string> = {
  volume_mrv: 'Volume',
  swap_preference: 'Swaps',
  exercise_gap: 'Gaps',
  session_duration: 'Duration',
  recovery: 'Recovery',
  redundancy: 'Redundancy',
  other: 'Other',
}

type FoldId = 'ai' | 'percentiles' | 'trends' | 'profile' | 'flags'

export default function IntelligenceTab({ trainingProfile, profileLoading, onAnalyze }: Props) {
  const [open, setOpen] = useState<Set<FoldId>>(new Set())
  const [aiSummary, setAiSummary] = useState<TrainingSummary | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)

  const toggle = (id: FoldId) =>
    setOpen((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const runAiAnalysis = async () => {
    if (!trainingProfile || aiLoading) return
    setAiLoading(true)
    setAiError(null)
    try {
      setAiSummary(await fetchTrainingSummary(trainingProfile))
    } catch (err: unknown) {
      logError('AI training summary failed', err)
      setAiError(err instanceof Error ? err.message : 'Failed to generate AI analysis')
    } finally {
      setAiLoading(false)
    }
  }

  if (!trainingProfile && !profileLoading) {
    return (
      <div style={{ padding: 'var(--space-md)', textAlign: 'center' }}>
        <Button onClick={onAnalyze}>Analyze Training Data</Button>
      </div>
    )
  }

  if (profileLoading) return <div className={s.emptyText}>Computing intelligence...</div>
  if (!trainingProfile) return null

  const tp = trainingProfile
  const gp = tp.goalProgress
  const patterns = tp.learnedPatterns ?? []
  const verified = patterns.filter((p) => p.autoVerified)
  const enginePatterns = tp.llmPatternObservations?.length ?? 0
  const hasFitbit = (tp.connectedWearables ?? []).some((w) => /fitbit/i.test(w))
  const restPct =
    tp.restComplianceMedian != null ? Math.round(tp.restComplianceMedian * 100) : null
  const topSwaps = [...(tp.exerciseSwapHistory ?? [])]
    .sort((a, b) => b.effectiveSwapWeight - a.effectiveSwapWeight)
    .slice(0, 8)
  const volumeAlerts = tp.muscleVolumeStatuses.filter(
    (v) => v.status === 'above_mrv' || v.status === 'below_mev',
  )
  const topForecasts = (tp.progressionForecasts ?? []).slice(0, 5)
  const t = tp.rolling30DayTrends

  return (
    <div className={s.pageContent}>
      {gp && (
        <div className={s.card}>
          <div className={s.rowBetween}>
            <div>
              <h3 className={s.sectionTitle}>Goal: {gp.goalLabel}</h3>
              <p className={s.sectionSubtitle}>{gp.summary}</p>
            </div>
            <div className={s.scoreDisplay}>
              <span
                className={s.scoreValue}
                style={{ color: gp.overallScore >= 70 ? 'var(--success)' : gp.overallScore >= 45 ? '#e6a800' : '#ef4444' }}
              >
                {gp.overallScore}
              </span>
              <span className={s.scoreLabel}>Alignment</span>
            </div>
          </div>
          {gp.signals.length > 0 && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {gp.signals.slice(0, 4).map((sig, i) => (
                <div
                  key={i}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 8,
                    fontSize: 12,
                    borderLeft: `3px solid ${sig.trend === 'positive' ? 'var(--success)' : sig.trend === 'negative' ? '#ef4444' : 'var(--text-muted)'}`,
                    backgroundColor:
                      sig.trend === 'positive'
                        ? 'rgba(34,197,94,0.08)'
                        : sig.trend === 'negative'
                          ? 'rgba(239,68,68,0.08)'
                          : 'rgba(255,255,255,0.04)',
                  }}
                >
                  <strong>{sig.label}</strong> — {sig.value}
                  <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>{sig.detail}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className={s.card} style={{ marginTop: 12 }}>
        <h3 className={s.sectionTitle}>Data & behavior</h3>
        <p className={s.sectionSubtitle}>What the engine can learn from without forms</p>
        <div className={s.statsGrid} style={{ marginTop: 10 }}>
          <Stat label="Workouts" value={String(tp.totalWorkoutCount)} />
          <Stat label="Fitbit" value={hasFitbit ? 'Connected' : '—'} ok={hasFitbit} />
          <Stat
            label="Rest compliance"
            value={restPct != null ? `${restPct}%` : '—'}
            ok={restPct != null && restPct >= 75}
          />
          <Stat
            label="Engine patterns"
            value={`${enginePatterns} active`}
            hint={`${verified.length}/${patterns.length} verified`}
          />
        </div>
      </div>

      <div className={s.card} style={{ marginTop: 12 }}>
        <h3 className={s.sectionTitle}>Learned patterns</h3>
        <p className={s.sectionSubtitle}>
          Deduped observations; only verified patterns change your workouts.
        </p>
        {patterns.length === 0 ? (
          <p className={s.emptyText} style={{ marginTop: 8 }}>
            No patterns yet — they appear after plan reviews when behavior supports them.
          </p>
        ) : (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {patterns.map((p) => (
              <PatternCard key={p.patternKey} pattern={p} affectsEngine={p.autoVerified} />
            ))}
          </div>
        )}
      </div>

      <div className={s.card} style={{ marginTop: 12 }}>
        <h3 className={s.sectionTitle}>Engine snapshot</h3>
        <div className={s.statsGrid} style={{ marginTop: 8 }}>
          <Stat label="Frequency" value={`${tp.trainingFrequency} d/wk`} />
          <Stat label="Avg session" value={`${tp.avgSessionDuration} min`} />
          <Stat label="Consistency" value={`${Math.round(tp.consistencyScore * 100)}%`} />
          <Stat
            label="Deload"
            value={tp.deloadRecommendation.needed ? 'Suggested' : 'OK'}
            ok={!tp.deloadRecommendation.needed}
          />
        </div>
        {(tp.hrvIntensityModifier || tp.sleepVolumeModifier) && (
          <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            {tp.hrvIntensityModifier?.recommendation}
            {tp.hrvIntensityModifier && tp.sleepVolumeModifier ? ' · ' : ''}
            {tp.sleepVolumeModifier?.reason}
          </p>
        )}
        {volumeAlerts.length > 0 && (
          <>
            <div className={s.sectionLabel} style={{ marginTop: 12 }}>
              Volume alerts
            </div>
            <table className={s.dataTable}>
              <thead>
                <tr>
                  <th>Muscle</th>
                  <th>Sets/wk</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {volumeAlerts.slice(0, 8).map((v) => (
                  <tr key={v.muscleGroup}>
                    <td style={{ textTransform: 'capitalize' }}>{v.muscleGroup.replace(/_/g, ' ')}</td>
                    <td>
                      {v.weeklyDirectSets}/{v.mrv}
                    </td>
                    <td style={{ color: v.status === 'above_mrv' ? 'var(--danger)' : '#e6a800' }}>
                      {v.status.replace(/_/g, ' ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      {topSwaps.length > 0 && (
        <div className={s.card} style={{ marginTop: 12 }}>
          <h3 className={s.sectionTitle}>Swap penalties</h3>
          <p className={s.sectionSubtitle}>Highest-impact exercises the selector deprioritizes</p>
          <table className={s.dataTable} style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>Exercise</th>
                <th>Swaps</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {topSwaps.map((sw) => {
                const acc = (tp.exerciseAcceptances ?? []).find((a) => a.exerciseName === sw.exerciseName)
                const st = swapStatus(sw.effectiveSwapWeight, sw.swapCount, acc?.effectiveWeight ?? 0)
                return (
                  <tr key={sw.exerciseName}>
                    <td>{sw.exerciseName}</td>
                    <td>{sw.swapCount}</td>
                    <td>
                      <span className={st.className}>{st.label}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {topForecasts.length > 0 && (
        <div className={s.card} style={{ marginTop: 12 }}>
          <h3 className={s.sectionTitle}>Top forecasts</h3>
          <table className={s.dataTable} style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>Lift</th>
                <th>e1RM</th>
                <th>Next target</th>
              </tr>
            </thead>
            <tbody>
              {topForecasts.map((f) => (
                <tr key={f.exerciseName}>
                  <td>{f.exerciseName}</td>
                  <td>{f.currentE1RM} lbs</td>
                  <td style={{ fontWeight: 600 }}>{f.predictedTargetWeight} lbs</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Fold title="Strength & health percentiles" id="percentiles" open={open} onToggle={toggle}>
        {tp.strengthPercentiles.length > 0 && (
          <table className={s.dataTable}>
            <thead>
              <tr>
                <th>Lift</th>
                <th>e1RM</th>
                <th>%ile</th>
              </tr>
            </thead>
            <tbody>
              {tp.strengthPercentiles.map((sp) => {
                const pct = sp.ageAdjustedPercentile ?? sp.percentile
                return (
                  <tr key={sp.lift}>
                    <td style={{ textTransform: 'capitalize' }}>{sp.lift}</td>
                    <td>{sp.estimated1RM} lbs</td>
                    <td>
                      <PctBarCell pct={pct} /> {levelLabel(pct)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        {tp.healthPercentiles.length > 0 && (
          <table className={s.dataTable} style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Metric</th>
                <th>Avg</th>
                <th>%ile</th>
              </tr>
            </thead>
            <tbody>
              {tp.healthPercentiles.map((h) => (
                <tr key={h.metric}>
                  <td>{h.label}</td>
                  <td>
                    {h.value} {h.unit}
                  </td>
                  <td>
                    <PctBarCell pct={h.percentile} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Fold>

      <Fold title="30-day trends" id="trends" open={open} onToggle={toggle}>
        <table className={s.dataTable}>
          <thead>
            <tr>
              <th>Metric</th>
              <th>Now</th>
              <th>Trend</th>
            </tr>
          </thead>
          <tbody>
            <TrendCompact label="Strength index" mt={t.totalStrengthIndex} goodDir="up" />
            <TrendCompact label="Volume load" mt={t.totalVolumeLoad} unit="lbs" goodDir="up" />
            <TrendCompact label="Sleep" mt={t.sleep} unit="hrs" goodDir="up" />
            <TrendCompact label="HRV" mt={t.hrv} unit="ms" goodDir="up" />
            <TrendCompact label="Frequency" mt={t.trainingFrequency} unit="d/wk" goodDir="up" />
          </tbody>
        </table>
        {t.exerciseTrends.filter((e) => e.estimated1RM.dataPoints >= 2).length > 0 && (
          <table className={s.dataTable} style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Lift</th>
                <th>e1RM</th>
                <th>Trend</th>
              </tr>
            </thead>
            <tbody>
              {t.exerciseTrends
                .filter((e) => e.estimated1RM.dataPoints >= 2)
                .slice(0, 8)
                .map((et) => (
                  <tr key={et.exerciseName}>
                    <td>{et.exerciseName}</td>
                    <td>{et.estimated1RM.current?.toFixed(0) ?? '—'} lbs</td>
                    <td style={{ color: trendColor(et.estimated1RM.direction, 'up'), fontWeight: 600 }}>
                      {arrow(et.estimated1RM.direction)} {Math.abs(et.estimated1RM.slopePct).toFixed(1)}%
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </Fold>

      {tp.athleteProfile && tp.athleteProfile.items.length > 0 && (
        <Fold title="Athlete profile" id="profile" open={open} onToggle={toggle}>
          <p className={s.sectionSubtitle}>{tp.athleteProfile.summary}</p>
          {tp.athleteProfile.items.slice(0, 6).map((item, idx) => (
            <div key={idx} className={s.profileItemStrength} style={{ marginTop: 8 }}>
              <div className={s.profileItemTitle}>{item.area}</div>
              <div className={s.profileItemDetail}>{item.detail}</div>
            </div>
          ))}
        </Fold>
      )}

      <Fold title="Flags & plateaus" id="flags" open={open} onToggle={toggle}>
        {tp.deloadRecommendation.signals.map((sig, i) => (
          <p key={i} style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0' }}>
            {sig}
          </p>
        ))}
        {tp.plateauDetections.filter((p) => p.isPlateaued).length > 0 && (
          <table className={s.dataTable} style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>Exercise</th>
                <th>Sessions stuck</th>
              </tr>
            </thead>
            <tbody>
              {tp.plateauDetections
                .filter((p) => p.isPlateaued)
                .slice(0, 6)
                .map((p) => (
                  <tr key={p.exerciseName}>
                    <td>{p.exerciseName}</td>
                    <td>{p.sessionsSinceProgress}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
        {tp.imbalanceAlerts.slice(0, 3).map((a, i) => (
          <div key={i} className={s.profileItemWatch} style={{ marginTop: 8 }}>
            <div className={s.profileItemTitle}>{a.type.replace(/_/g, ' ')}</div>
            <div className={s.profileItemDetail}>{a.description}</div>
          </div>
        ))}
      </Fold>

      <Fold title="Optional AI narrative" id="ai" open={open} onToggle={toggle}>
        {!aiSummary && !aiLoading && !aiError && (
          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            <Button onClick={runAiAnalysis}>Generate analysis</Button>
          </div>
        )}
        {aiLoading && <p className={s.emptyText}>Analyzing...</p>}
        {aiError && (
          <>
            <p style={{ color: '#ef4444', fontSize: 13 }}>{aiError}</p>
            <Button variant="secondary" onClick={runAiAnalysis}>
              Retry
            </Button>
          </>
        )}
        {aiSummary && (
          <>
            <p style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--text-primary)' }}>{aiSummary.overallAssessment}</p>
            {aiSummary.keyFindings?.slice(0, 5).map((f, i) => (
              <div key={i} style={{ marginTop: 8, fontSize: 12 }}>
                <strong>{f.title}</strong> — {f.detail}
              </div>
            ))}
            <div style={{ textAlign: 'right', marginTop: 8 }}>
              <Button variant="secondary" onClick={runAiAnalysis} style={{ fontSize: 12, padding: '4px 12px' }}>
                Refresh
              </Button>
            </div>
          </>
        )}
      </Fold>
    </div>
  )
}

function Stat({ label, value, ok, hint }: { label: string; value: string; ok?: boolean; hint?: string }) {
  return (
    <div className={s.statCard}>
      <span className={s.statLabel}>{label}</span>
      <span className={s.statValue} style={ok === false ? { color: 'var(--text-muted)' } : ok ? { color: 'var(--success)' } : undefined}>
        {value}
      </span>
      {hint && <span className={s.statUnit}>{hint}</span>}
    </div>
  )
}

function PatternCard({ pattern: p, affectsEngine }: { pattern: AggregatedPattern; affectsEngine: boolean }) {
  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: 8,
        borderLeft: `3px solid ${affectsEngine ? 'var(--success)' : 'var(--text-muted)'}`,
        backgroundColor: affectsEngine ? 'rgba(34,197,94,0.06)' : 'rgba(255,255,255,0.04)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
          {categoryLabel[p.category]} · {p.occurrenceCount}× · {p.confidence}
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: affectsEngine ? 'var(--success)' : 'var(--text-muted)',
          }}
        >
          {affectsEngine ? 'In engine' : p.autoVerified ? 'Verified' : 'Observed'}
        </span>
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>{p.pattern}</div>
      {p.suggestion && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>{p.suggestion}</div>
      )}
      {p.evidence.length > 0 && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>{p.evidence.slice(0, 2).join(' · ')}</div>
      )}
    </div>
  )
}

function TrendCompact({
  label,
  mt,
  unit = '',
  goodDir,
}: {
  label: string
  mt: { current: number | null; direction: string; slopePct: number; dataPoints: number }
  unit?: string
  goodDir: 'up' | 'down'
}) {
  if (mt.dataPoints < 3) return null
  return (
    <tr>
      <td>{label}</td>
      <td>
        {mt.current != null ? `${unit === 'min' ? Math.round(mt.current) : mt.current.toFixed(1)} ${unit}`.trim() : '—'}
      </td>
      <td style={{ color: trendColor(mt.direction, goodDir), fontWeight: 600 }}>
        {arrow(mt.direction)} {Math.abs(mt.slopePct).toFixed(1)}%/wk
      </td>
    </tr>
  )
}

function Fold({
  title,
  id,
  open,
  onToggle,
  children,
}: {
  title: string
  id: FoldId
  open: Set<FoldId>
  onToggle: (id: FoldId) => void
  children: React.ReactNode
}) {
  const isOpen = open.has(id)
  return (
    <>
      <button
        type="button"
        onClick={() => onToggle(id)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          padding: '12px 4px',
          marginTop: 8,
          background: 'none',
          border: 'none',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          cursor: 'pointer',
        }}
      >
        <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{title}</span>
        <span style={{ color: 'var(--text-muted)', transform: isOpen ? 'rotate(90deg)' : 'none' }}>▸</span>
      </button>
      {isOpen && <div className={s.card} style={{ marginTop: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>{children}</div>}
    </>
  )
}
