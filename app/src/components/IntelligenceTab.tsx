import React, { useState } from 'react'
import type { TrainingProfile } from '../lib/trainingAnalysis'
import Button from './Button'
import s from '../styles/shared.module.css'

interface Props {
  trainingProfile: TrainingProfile | null
  profileLoading: boolean
  onAnalyze: () => void
}

const arrow = (d: string) => d === 'up' ? '↑' : d === 'down' ? '↓' : '→'
const trendColor = (d: string, goodDir: 'up' | 'down') =>
  d === goodDir ? 'var(--success)' : d === (goodDir === 'up' ? 'down' : 'up') ? 'var(--danger)' : 'var(--text-secondary)'
const pctColor = (p: number) => p >= 75 ? 'var(--success)' : p >= 50 ? '#e6a800' : p >= 25 ? 'var(--text-primary)' : '#ef4444'
const pctBg = (p: number) => p >= 75 ? 'rgba(34,197,94,0.15)' : p >= 50 ? 'rgba(230,168,0,0.15)' : p >= 25 ? 'rgba(255,255,255,0.06)' : 'rgba(239,68,68,0.12)'
const pctFill = (p: number) => p >= 75 ? 'rgba(34,197,94,0.3)' : p >= 50 ? 'rgba(230,168,0,0.3)' : p >= 25 ? 'rgba(255,255,255,0.1)' : 'rgba(239,68,68,0.2)'
const levelLabel = (p: number) => p > 90 ? 'Elite' : p > 75 ? 'Advanced' : p > 50 ? 'Intermediate' : p >= 25 ? 'Novice' : 'Beginner'
const interpLabel = (i: string) => {
  switch (i) { case 'excellent': return 'Excellent'; case 'good': return 'Good'; case 'average': return 'Average'; case 'below_average': return 'Below Avg'; case 'poor': return 'Low'; default: return i }
}

function PctBarCell({ pct }: { pct: number }) {
  return (
    <span className={s.pctBar} style={{ backgroundColor: pctBg(pct), color: pctColor(pct) }}>
      <span className={s.pctBarFill} style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: pctFill(pct) }} />
      {pct}th
    </span>
  )
}

function TrendRow({ label, mt, unit, goodDir }: { label: string; mt: { current: number | null; avg30d: number | null; direction: string; slopePct: number; dataPoints: number }; unit: string; goodDir: 'up' | 'down' }) {
  if (mt.dataPoints < 3) return null
  return (
    <tr>
      <td>{label}</td>
      <td>{mt.current != null ? `${unit === 'min' ? Math.round(mt.current) : mt.current.toFixed(1)} ${unit}` : '—'}</td>
      <td>{mt.avg30d != null ? `${mt.avg30d.toFixed(1)} ${unit}` : '—'}</td>
      <td style={{ color: trendColor(mt.direction, goodDir), fontWeight: 600 }}>
        {arrow(mt.direction)} {Math.abs(mt.slopePct).toFixed(1)}%/wk
      </td>
    </tr>
  )
}

type SectionId = 'trends' | 'percentiles' | 'profile' | 'training' | 'recovery' | 'flags' | 'ml' | 'forecasts' | 'fatigue'

export default function IntelligenceTab({ trainingProfile, profileLoading, onAnalyze }: Props) {
  const [expanded, setExpanded] = useState<Set<SectionId>>(new Set(['trends', 'percentiles', 'profile']))

  const toggle = (id: SectionId) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  if (!trainingProfile && !profileLoading) {
    return (
      <div style={{ padding: 'var(--space-md)', textAlign: 'center' }}>
        <Button onClick={onAnalyze}>Analyze Training Data</Button>
      </div>
    )
  }

  if (profileLoading) {
    return <div className={s.emptyText}>Computing intelligence data...</div>
  }

  if (!trainingProfile) return null

  const tp = trainingProfile
  const t = tp.rolling30DayTrends

  return (
    <div className={s.pageContent}>
      {/* ── Athlete Profile (Hero) ─────────────────────────────── */}
      {tp.athleteProfile && tp.athleteProfile.items.length > 0 && (
        <div className={s.card}>
          <div className={s.rowBetween}>
            <div>
              <h3 className={s.sectionTitle}>Athlete Profile</h3>
              <p className={s.sectionSubtitle}>{tp.athleteProfile.summary}</p>
            </div>
            <div className={s.scoreDisplay}>
              <span className={s.scoreValue} style={{ color: tp.athleteProfile.overallScore >= 70 ? 'var(--success)' : tp.athleteProfile.overallScore >= 45 ? '#e6a800' : '#ef4444' }}>
                {tp.athleteProfile.overallScore}
              </span>
              <span className={s.scoreLabel}>Score</span>
            </div>
          </div>
          {(['strength', 'weakness', 'opportunity', 'watch'] as const).map(cat => {
            const items = tp.athleteProfile.items.filter(i => i.category === cat)
            if (items.length === 0) return null
            const config = {
              strength: { label: 'Strengths', cls: s.profileItemStrength },
              weakness: { label: 'Focus Areas', cls: s.profileItemWeakness },
              opportunity: { label: 'Opportunities', cls: s.profileItemOpportunity },
              watch: { label: 'Watch', cls: s.profileItemWatch },
            }[cat]
            return (
              <div key={cat} style={{ marginTop: 12 }}>
                <div className={s.sectionLabel}>{config.label} ({items.length})</div>
                {items.map((item, idx) => (
                  <div key={idx} className={config.cls}>
                    <div className={s.profileItemTitle}>{item.area}</div>
                    <div className={s.profileItemDetail}>{item.detail}</div>
                    <div className={s.profileItemData}>{item.dataPoints}</div>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Percentiles ────────────────────────────────────────── */}
      <SectionHeader title="Percentile Rankings" id="percentiles" expanded={expanded} onToggle={toggle} />
      {expanded.has('percentiles') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {tp.strengthPercentiles.length > 0 && (
            <div className={s.card}>
              <h3 className={s.sectionTitle}>Strength Percentiles</h3>
              <p className={s.sectionSubtitle}>
                Weight class: {tp.strengthPercentiles[0]?.bodyWeightClass}
                {tp.gender ? ` (${tp.gender.toUpperCase().startsWith('F') ? 'F' : 'M'})` : ''}
              </p>
              {tp.strengthPercentiles.some(sp => sp.ageAdjustedPercentile != null && sp.ageAdjustedPercentile !== sp.percentile) && (
                <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 8px' }}>Age-adjusted shown in parentheses</p>
              )}
              <table className={s.dataTable}>
                <thead>
                  <tr><th>Lift</th><th>e1RM</th><th>Percentile</th><th>Level</th></tr>
                </thead>
                <tbody>
                  {tp.strengthPercentiles.map(sp => {
                    const hasAdj = sp.ageAdjustedPercentile != null && sp.ageAdjustedPercentile !== sp.percentile
                    const displayPct = sp.ageAdjustedPercentile ?? sp.percentile
                    return (
                      <tr key={sp.lift}>
                        <td style={{ textTransform: 'capitalize' }}>{sp.lift}</td>
                        <td>{sp.estimated1RM} lbs</td>
                        <td><PctBarCell pct={displayPct} />{hasAdj ? <span style={{ fontSize: 10, opacity: 0.6 }}> ({sp.percentile})</span> : null}</td>
                        <td>{levelLabel(displayPct)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {tp.healthPercentiles.length > 0 && (
            <div className={s.card}>
              <h3 className={s.sectionTitle}>Health Percentiles</h3>
              <p className={s.sectionSubtitle}>30-day averages vs. population (age {tp.healthPercentiles[0]?.ageGroup})</p>
              <table className={s.dataTable}>
                <thead>
                  <tr><th>Metric</th><th>Your Avg</th><th>Percentile</th><th>Rating</th></tr>
                </thead>
                <tbody>
                  {tp.healthPercentiles.map(h => (
                    <tr key={h.metric}>
                      <td>{h.label}</td>
                      <td>{h.value} {h.unit}</td>
                      <td><PctBarCell pct={h.percentile} /></td>
                      <td>{interpLabel(h.interpretation)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── 30-Day Trends ──────────────────────────────────────── */}
      <SectionHeader title="30-Day Trends" id="trends" expanded={expanded} onToggle={toggle} />
      {expanded.has('trends') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Overall Progress */}
          <div className={s.card}>
            <h3 className={s.sectionTitle}>Overall Progress</h3>
            <table className={s.dataTable}>
              <thead><tr><th>Metric</th><th>Current</th><th>30d Avg</th><th>Trend</th></tr></thead>
              <tbody>
                <TrendRow label="Strength Index" mt={t.totalStrengthIndex} unit="" goodDir="up" />
                <TrendRow label="Top Lifts Total" mt={t.big3Total} unit="lbs" goodDir="up" />
                <TrendRow label="Relative Strength" mt={t.relativeStrength} unit="" goodDir="up" />
                <TrendRow label="Volume Load" mt={t.totalVolumeLoad} unit="lbs" goodDir="up" />
              </tbody>
            </table>
          </div>

          {/* Recovery */}
          <div className={s.card}>
            <h3 className={s.sectionTitle}>Recovery Trends</h3>
            <table className={s.dataTable}>
              <thead><tr><th>Metric</th><th>Current</th><th>30d Avg</th><th>Trend</th></tr></thead>
              <tbody>
                <TrendRow label="Sleep" mt={t.sleep} unit="hrs" goodDir="up" />
                <TrendRow label="HRV" mt={t.hrv} unit="ms" goodDir="up" />
                <TrendRow label="RHR" mt={t.rhr} unit="bpm" goodDir="down" />
                <TrendRow label="Steps" mt={t.steps} unit="" goodDir="up" />
              </tbody>
            </table>
          </div>

          {/* Training */}
          <div className={s.card}>
            <h3 className={s.sectionTitle}>Training Trends</h3>
            <table className={s.dataTable}>
              <thead><tr><th>Metric</th><th>Current</th><th>30d Avg</th><th>Trend</th></tr></thead>
              <tbody>
                <TrendRow label="Frequency" mt={t.trainingFrequency} unit="days/wk" goodDir="up" />
                <TrendRow label="Session Duration" mt={t.avgSessionDuration} unit="min" goodDir="up" />
                <TrendRow label="Weekly Sets" mt={t.totalWeeklyVolume} unit="sets" goodDir="up" />
              </tbody>
            </table>
          </div>

          {/* Lift Trends */}
          {t.exerciseTrends.filter(e => e.estimated1RM.dataPoints >= 2).length > 0 && (
            <div className={s.card}>
              <h3 className={s.sectionTitle}>Lift Trends</h3>
              <table className={s.dataTable}>
                <thead><tr><th>Exercise</th><th>e1RM</th><th>Trend</th><th>Vol Load</th></tr></thead>
                <tbody>
                  {t.exerciseTrends.filter(e => e.estimated1RM.dataPoints >= 2).map(et => (
                    <tr key={et.exerciseName}>
                      <td>{et.exerciseName}</td>
                      <td>{et.estimated1RM.current?.toFixed(0) ?? '—'} lbs</td>
                      <td style={{ color: trendColor(et.estimated1RM.direction, 'up'), fontWeight: 600 }}>
                        {arrow(et.estimated1RM.direction)} {Math.abs(et.estimated1RM.slopePct).toFixed(1)}%
                      </td>
                      <td style={{ color: trendColor(et.volumeLoad.direction, 'up') }}>
                        {arrow(et.volumeLoad.direction)} {Math.abs(et.volumeLoad.slopePct).toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Muscle Volume Trends */}
          {t.muscleGroupTrends.filter(m => m.weeklySetsTrend.dataPoints >= 2).length > 0 && (
            <div className={s.card}>
              <h3 className={s.sectionTitle}>Muscle Volume Trends</h3>
              <table className={s.dataTable}>
                <thead><tr><th>Muscle</th><th>Sets/wk</th><th>Trend</th></tr></thead>
                <tbody>
                  {t.muscleGroupTrends.filter(m => m.weeklySetsTrend.dataPoints >= 2).map(mg => (
                    <tr key={mg.muscleGroup}>
                      <td style={{ textTransform: 'capitalize' }}>{mg.muscleGroup.replace(/_/g, ' ')}</td>
                      <td>{mg.weeklySetsTrend.current?.toFixed(0) ?? '—'}</td>
                      <td style={{ color: trendColor(mg.weeklySetsTrend.direction, 'up'), fontWeight: 600 }}>
                        {arrow(mg.weeklySetsTrend.direction)} {Math.abs(mg.weeklySetsTrend.slopePct).toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Training Details ───────────────────────────────────── */}
      <SectionHeader title="Training Details" id="training" expanded={expanded} onToggle={toggle} />
      {expanded.has('training') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Global Stats */}
          <div className={s.card}>
            <h3 className={s.sectionTitle}>Global Stats</h3>
            <table className={s.dataTable}>
              <tbody>
                <tr><td>Training Frequency</td><td>{tp.trainingFrequency} days/week</td></tr>
                <tr><td>Avg Session Duration</td><td>{Math.round(tp.avgSessionDuration / 60)} min</td></tr>
                <tr><td>Training Age</td><td>{tp.trainingAgeDays} days</td></tr>
                <tr><td>Consistency</td><td>{Math.round(tp.consistencyScore * 100)}%</td></tr>
                <tr><td>Weight Trend</td><td>{tp.bodyWeightTrend.phase} ({tp.bodyWeightTrend.slope > 0 ? '+' : ''}{tp.bodyWeightTrend.slope} lbs/wk)</td></tr>
              </tbody>
            </table>
          </div>

          {/* Muscle Volume */}
          <div className={s.card}>
            <h3 className={s.sectionTitle}>Muscle Volume (Weekly Sets)</h3>
            <table className={s.dataTable}>
              <thead><tr><th>Muscle</th><th>Sets</th><th>Status</th><th>vs MRV</th></tr></thead>
              <tbody>
                {tp.muscleVolumeStatuses.map(v => (
                  <tr key={v.muscleGroup}>
                    <td style={{ textTransform: 'capitalize' }}>{v.muscleGroup.replace(/_/g, ' ')}</td>
                    <td>{v.weeklyDirectSets}</td>
                    <td style={{ color: v.status === 'above_mrv' ? 'var(--danger)' : v.status === 'in_mav' ? 'var(--success)' : v.status === 'below_mev' ? '#e6a800' : 'var(--text-secondary)' }}>
                      {v.status.replace(/_/g, ' ')}
                    </td>
                    <td>{v.weeklyDirectSets}/{v.mrv}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Exercise Progression */}
          {tp.exerciseProgressions.length > 0 && (
            <div className={s.card}>
              <h3 className={s.sectionTitle}>Exercise Progression</h3>
              <table className={s.dataTable}>
                <thead><tr><th>Exercise</th><th>e1RM</th><th>Status</th></tr></thead>
                <tbody>
                  {tp.exerciseProgressions.slice(0, 20).map(p => (
                    <tr key={p.exerciseName}>
                      <td>{p.exerciseName}</td>
                      <td>{p.estimated1RM.toFixed(0)} lbs</td>
                      <td style={{ color: p.status === 'progressing' ? 'var(--success)' : p.status === 'regressing' ? 'var(--danger)' : 'var(--text-secondary)' }}>
                        {p.status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Age Adjustments */}
          {tp.healthPercentiles.length > 0 && (
            <div className={s.card}>
              <h3 className={s.sectionTitle}>Age-Based Model Adjustments</h3>
              <p className={s.sectionSubtitle}>How your age affects the engine</p>
              <table className={s.dataTable}>
                <thead><tr><th>Factor</th><th>Adjustment</th></tr></thead>
                <tbody>
                  <tr><td>Health Percentiles</td><td>Compared vs. age group {tp.healthPercentiles[0]?.ageGroup || '—'}</td></tr>
                  {tp.strengthPercentiles.some(sp => sp.ageAdjustedPercentile != null && sp.ageAdjustedPercentile !== sp.percentile) && (
                    <tr><td>Strength Percentiles</td><td>Age-adjusted rankings active</td></tr>
                  )}
                  <tr><td>Recovery Speed</td><td>Auto-scaled by age</td></tr>
                  <tr><td>Volume / Progression</td><td>Auto-scaled by age</td></tr>
                  <tr><td>Cardio HR Zones</td><td>Age-derived max HR</td></tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Recovery & Correlations ────────────────────────────── */}
      <SectionHeader title="Recovery & Correlations" id="recovery" expanded={expanded} onToggle={toggle} />
      {expanded.has('recovery') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Recovery Correlations */}
          <div className={s.card}>
            <h3 className={s.sectionTitle}>Sleep-Performance Correlation</h3>
            <table className={s.dataTable}>
              <thead><tr><th>Region</th><th>Coefficient</th><th>Confidence</th></tr></thead>
              <tbody>
                <tr>
                  <td>Upper Body</td>
                  <td style={{ color: tp.sleepCoefficients.upperBody > 0 ? 'var(--success)' : 'var(--danger)' }}>
                    {tp.sleepCoefficients.upperBody > 0 ? '+' : ''}{(tp.sleepCoefficients.upperBody * 100).toFixed(0)}%
                  </td>
                  <td>{tp.sleepCoefficients.confidence} ({tp.sleepCoefficients.dataPoints} pts)</td>
                </tr>
                <tr>
                  <td>Lower Body</td>
                  <td style={{ color: tp.sleepCoefficients.lowerBody > 0 ? 'var(--success)' : 'var(--danger)' }}>
                    {tp.sleepCoefficients.lowerBody > 0 ? '+' : ''}{(tp.sleepCoefficients.lowerBody * 100).toFixed(0)}%
                  </td>
                  <td>{tp.sleepCoefficients.confidence} ({tp.sleepCoefficients.dataPoints} pts)</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Time of Day */}
          {tp.timeOfDayEffects.filter(e => e.dataPoints >= 3).length > 0 && (
            <div className={s.card}>
              <h3 className={s.sectionTitle}>Time of Day Effects</h3>
              <table className={s.dataTable}>
                <thead><tr><th>Window</th><th>Perf. Delta</th><th>Sessions</th></tr></thead>
                <tbody>
                  {tp.timeOfDayEffects.filter(e => e.dataPoints >= 3).map(e => (
                    <tr key={e.bucket}>
                      <td>{e.bucket}</td>
                      <td style={{ color: e.avgDelta >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                        {e.avgDelta >= 0 ? '+' : ''}{(e.avgDelta * 100).toFixed(1)}%
                      </td>
                      <td>{e.dataPoints}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Consecutive Days */}
          {tp.consecutiveDaysEffects.filter(e => e.dataPoints >= 3).length > 0 && (
            <div className={s.card}>
              <h3 className={s.sectionTitle}>Consecutive Day Effects</h3>
              <table className={s.dataTable}>
                <thead><tr><th>Days in a Row</th><th>Perf. Delta</th><th>Sessions</th></tr></thead>
                <tbody>
                  {tp.consecutiveDaysEffects.filter(e => e.dataPoints >= 3).map(e => (
                    <tr key={e.dayIndex}>
                      <td>Day {e.dayIndex}</td>
                      <td style={{ color: e.avgDelta >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                        {e.avgDelta >= 0 ? '+' : ''}{(e.avgDelta * 100).toFixed(1)}%
                      </td>
                      <td>{e.dataPoints}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Imbalance Alerts */}
          {tp.imbalanceAlerts.length > 0 && (
            <div className={s.card}>
              <h3 className={s.sectionTitle}>Imbalance Alerts</h3>
              {tp.imbalanceAlerts.map((a, i) => (
                <div key={i} className={s.profileItemWatch}>
                  <div className={s.profileItemTitle}>{a.type.replace(/_/g, ' ')}</div>
                  <div className={s.profileItemDetail}>{a.description}</div>
                  <div className={s.profileItemData}>Ratio: {a.ratio}:1 (target: {a.targetRatio}:1)</div>
                </div>
              ))}
            </div>
          )}

          {/* Muscle Recovery Status */}
          <div className={s.card}>
            <h3 className={s.sectionTitle}>Muscle Recovery Status</h3>
            <table className={s.dataTable}>
              <thead><tr><th>Muscle</th><th>Recovery</th><th>Hours</th><th>Ready</th></tr></thead>
              <tbody>
                {tp.muscleRecovery.map(r => (
                  <tr key={r.muscleGroup}>
                    <td style={{ textTransform: 'capitalize' }}>{r.muscleGroup.replace(/_/g, ' ')}</td>
                    <td>{r.recoveryPercent}%</td>
                    <td>{r.hoursSinceLastTrained === Infinity ? '—' : r.hoursSinceLastTrained.toFixed(0)}h</td>
                    <td style={{ color: r.readyToTrain ? 'var(--success)' : 'var(--danger)' }}>
                      {r.readyToTrain ? 'Yes' : 'No'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Flags & Alerts ─────────────────────────────────────── */}
      <SectionHeader title="Flags & Alerts" id="flags" expanded={expanded} onToggle={toggle} />
      {expanded.has('flags') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className={s.card}>
            <table className={s.dataTable}>
              <tbody>
                <tr>
                  <td>Deload Recommended</td>
                  <td style={{ color: tp.deloadRecommendation.needed ? 'var(--danger)' : 'var(--success)', fontWeight: 600 }}>
                    {tp.deloadRecommendation.needed ? 'YES' : 'No'}
                  </td>
                </tr>
                {tp.deloadRecommendation.signals.map((sig, i) => (
                  <tr key={i}><td colSpan={2} style={{ fontSize: 12, color: 'var(--text-muted)' }}>{sig}</td></tr>
                ))}
              </tbody>
            </table>

            {tp.plateauDetections.filter(p => p.isPlateaued).length > 0 && (
              <>
                <div className={s.divider} />
                <div className={s.sectionLabel}>Plateaued Exercises</div>
                <table className={s.dataTable}>
                  <thead><tr><th>Exercise</th><th>Sessions</th><th>Strategy</th></tr></thead>
                  <tbody>
                    {tp.plateauDetections.filter(p => p.isPlateaued).map(p => (
                      <tr key={p.exerciseName}>
                        <td>{p.exerciseName}</td>
                        <td>{p.sessionsSinceProgress}</td>
                        <td style={{ fontSize: 12 }}>{p.suggestedStrategy}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── ML Intelligence Dashboard ─────────────────────────── */}
      <SectionHeader title="ML Intelligence" id="ml" expanded={expanded} onToggle={toggle} />
      {expanded.has('ml') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* HRV Intensity Gate */}
          {tp.hrvIntensityModifier && (
            <div className={s.cardCompact}>
              <div className={s.sectionLabel}>HRV Intensity Gate</div>
              <div className={s.statsGrid}>
                <div className={s.statCard}>
                  <span className={s.statLabel}>Today's HRV</span>
                  <span className={s.statValue}>{tp.hrvIntensityModifier.todayHrv != null ? Math.round(tp.hrvIntensityModifier.todayHrv) : '—'}</span>
                  <span className={s.statUnit}>ms</span>
                </div>
                <div className={s.statCard}>
                  <span className={s.statLabel}>7d Average</span>
                  <span className={s.statValue}>{tp.hrvIntensityModifier.rolling7dHrv != null ? Math.round(tp.hrvIntensityModifier.rolling7dHrv) : '—'}</span>
                  <span className={s.statUnit}>ms</span>
                </div>
                <div className={s.statCard}>
                  <span className={s.statLabel}>Z-Score</span>
                  <span className={s.statValue} style={{ color: tp.hrvIntensityModifier.zScore < -1 ? 'var(--danger)' : tp.hrvIntensityModifier.zScore > 0.5 ? 'var(--success)' : 'var(--text-primary)' }}>
                    {tp.hrvIntensityModifier.zScore.toFixed(2)}
                  </span>
                </div>
                <div className={s.statCard}>
                  <span className={s.statLabel}>Intensity</span>
                  <span className={s.statValue}>×{tp.hrvIntensityModifier.intensityMultiplier.toFixed(2)}</span>
                </div>
              </div>
              <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>{tp.hrvIntensityModifier.recommendation}</p>
            </div>
          )}

          {/* Sleep Volume Modifier */}
          {tp.sleepVolumeModifier && (
            <div className={s.cardCompact}>
              <div className={s.sectionLabel}>Sleep → Training Adjustment</div>
              <div className={s.statsGrid}>
                <div className={s.statCard}>
                  <span className={s.statLabel}>Last Night</span>
                  <span className={s.statValue}>{tp.sleepVolumeModifier.lastNightSleepHours != null ? tp.sleepVolumeModifier.lastNightSleepHours.toFixed(1) : '—'}</span>
                  <span className={s.statUnit}>hrs</span>
                </div>
                <div className={s.statCard}>
                  <span className={s.statLabel}>Quality</span>
                  <span className={s.statValue} style={{ fontSize: 16, color: tp.sleepVolumeModifier.lastNightSleepQuality === 'poor' ? 'var(--danger)' : tp.sleepVolumeModifier.lastNightSleepQuality === 'excellent' ? 'var(--success)' : 'var(--text-primary)' }}>
                    {tp.sleepVolumeModifier.lastNightSleepQuality ?? '—'}
                  </span>
                </div>
                <div className={s.statCard}>
                  <span className={s.statLabel}>Volume</span>
                  <span className={s.statValue}>×{tp.sleepVolumeModifier.volumeMultiplier.toFixed(2)}</span>
                </div>
                <div className={s.statCard}>
                  <span className={s.statLabel}>Rest</span>
                  <span className={s.statValue}>×{tp.sleepVolumeModifier.restTimeMultiplier.toFixed(2)}</span>
                </div>
              </div>
              <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>{tp.sleepVolumeModifier.reason}</p>
            </div>
          )}

          {/* Compliance */}
          {tp.prescribedVsActual && tp.prescribedVsActual.exercisesCompleted + tp.prescribedVsActual.exercisesSkipped > 0 && (
            <div className={s.cardCompact}>
              <div className={s.sectionLabel}>Workout Compliance</div>
              <div className={s.statsGrid}>
                <div className={s.statCard}>
                  <span className={s.statLabel}>Compliance</span>
                  <span className={s.statValue} style={{ color: tp.prescribedVsActual.complianceRate >= 0.8 ? 'var(--success)' : tp.prescribedVsActual.complianceRate >= 0.6 ? '#e6a800' : 'var(--danger)' }}>
                    {Math.round(tp.prescribedVsActual.complianceRate * 100)}%
                  </span>
                </div>
                <div className={s.statCard}>
                  <span className={s.statLabel}>Completed</span>
                  <span className={s.statValue}>{tp.prescribedVsActual.exercisesCompleted}</span>
                </div>
                <div className={s.statCard}>
                  <span className={s.statLabel}>Skipped</span>
                  <span className={s.statValue}>{tp.prescribedVsActual.exercisesSkipped}</span>
                </div>
                <div className={s.statCard}>
                  <span className={s.statLabel}>Weight Dev</span>
                  <span className={s.statValue}>{tp.prescribedVsActual.avgWeightDeviation > 0 ? '+' : ''}{tp.prescribedVsActual.avgWeightDeviation.toFixed(1)}%</span>
                </div>
              </div>
            </div>
          )}

          {/* RPE Calibration */}
          {tp.rpeCalibrationFactor != null && tp.workoutIntensityScores && tp.workoutIntensityScores.length > 0 && (
            <div className={s.cardCompact}>
              <div className={s.sectionLabel}>RPE Calibration (HR vs Self-Report)</div>
              <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--text-muted)' }}>
                {tp.rpeCalibrationFactor > 5 ? 'You tend to overestimate effort vs heart rate data' :
                 tp.rpeCalibrationFactor < -5 ? 'You tend to underestimate effort vs heart rate data' :
                 'Your RPE is well-calibrated with heart rate data'}
                {' '}(avg offset: {tp.rpeCalibrationFactor > 0 ? '+' : ''}{Math.round(tp.rpeCalibrationFactor)} points)
              </p>
              <table className={s.dataTable}>
                <thead><tr><th>Date</th><th>Avg HR</th><th>HR Intensity</th><th>RPE</th><th>Offset</th></tr></thead>
                <tbody>
                  {tp.workoutIntensityScores.slice(0, 8).map(w => (
                    <tr key={w.workoutId}>
                      <td>{w.date}</td>
                      <td>{w.avgHr ?? '—'}</td>
                      <td>{Math.round(w.hrBasedIntensity)}</td>
                      <td>{w.subjectiveRpe != null ? Math.round(w.subjectiveRpe) : '—'}</td>
                      <td style={{ color: Math.abs(w.rpeCalibration) > 10 ? 'var(--danger)' : 'var(--text-secondary)' }}>
                        {w.rpeCalibration > 0 ? '+' : ''}{Math.round(w.rpeCalibration)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Exercise Swap Learning */}
          {tp.exerciseSwapHistory && tp.exerciseSwapHistory.length > 0 && (
            <div className={s.cardCompact}>
              <div className={s.sectionLabel}>Exercise Swap History</div>
              <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--text-muted)' }}>Exercises you've swapped out. ≥3 swaps = effectively excluded from prescriptions.</p>
              <table className={s.dataTable}>
                <thead><tr><th>Exercise</th><th>Swaps</th><th>Status</th></tr></thead>
                <tbody>
                  {tp.exerciseSwapHistory.map(sw => (
                    <tr key={sw.exerciseName}>
                      <td>{sw.exerciseName}</td>
                      <td>{sw.swapCount}</td>
                      <td>
                        <span className={sw.swapCount >= 3 ? s.badgeDanger : sw.swapCount >= 1 ? s.badgeWarning : s.badgeNeutral}>
                          {sw.swapCount >= 3 ? 'Excluded' : sw.swapCount >= 1 ? 'Deprioritized' : 'Active'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Progression Forecasts ─────────────────────────── */}
      {tp.progressionForecasts && tp.progressionForecasts.length > 0 && (
        <>
          <SectionHeader title="Progression Forecasts" id="forecasts" expanded={expanded} onToggle={toggle} />
          {expanded.has('forecasts') && (
            <div className={s.cardCompact}>
              <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--text-muted)' }}>
                Predicted next-session targets based on your progression trend (linear regression on e1RM history).
              </p>
              <table className={s.dataTable}>
                <thead><tr><th>Exercise</th><th>Current e1RM</th><th>Predicted</th><th>Target Weight</th><th>Confidence</th><th>Next Milestone</th></tr></thead>
                <tbody>
                  {tp.progressionForecasts.map(f => (
                    <tr key={f.exerciseName}>
                      <td>{f.exerciseName}</td>
                      <td>{f.currentE1RM} lbs</td>
                      <td style={{ color: f.predictedNextE1RM > f.currentE1RM ? 'var(--success)' : 'var(--text-secondary)' }}>
                        {f.predictedNextE1RM} lbs
                      </td>
                      <td style={{ fontWeight: 600 }}>{f.predictedTargetWeight} lbs</td>
                      <td>
                        <span className={s.pctBar} style={{ backgroundColor: f.confidence >= 0.7 ? 'rgba(34,197,94,0.15)' : f.confidence >= 0.5 ? 'rgba(230,168,0,0.15)' : 'rgba(255,255,255,0.06)' }}>
                          <span className={s.pctBarFill} style={{ width: `${f.confidence * 100}%`, backgroundColor: f.confidence >= 0.7 ? 'rgba(34,197,94,0.3)' : 'rgba(230,168,0,0.3)' }} />
                          R²={f.confidence.toFixed(2)}
                        </span>
                      </td>
                      <td>{f.sessionsUntilMilestone != null ? `~${f.sessionsUntilMilestone} sessions` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── Movement Pattern Fatigue ─────────────────────────── */}
      {tp.movementPatternFatigue && tp.movementPatternFatigue.length > 0 && (
        <>
          <SectionHeader title="Movement Pattern Fatigue" id="fatigue" expanded={expanded} onToggle={toggle} />
          {expanded.has('fatigue') && (
            <div className={s.cardCompact}>
              <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--text-muted)' }}>
                Systemic fatigue tracked by movement pattern, not just individual muscles.
              </p>
              <div className={s.statsGrid}>
                {tp.movementPatternFatigue.map(mp => {
                  const fColor = mp.fatigueLevel === 'high' ? 'var(--danger)' : mp.fatigueLevel === 'moderate' ? '#e6a800' : 'var(--success)'
                  const fLabel = mp.fatigueLevel === 'high' ? 'HIGH' : mp.fatigueLevel === 'moderate' ? 'MOD' : 'FRESH'
                  return (
                    <div key={mp.pattern} className={s.statCard}>
                      <span className={s.statLabel}>{mp.pattern.replace(/_/g, ' ')}</span>
                      <span className={s.statValue} style={{ color: fColor, fontSize: 14 }}>{fLabel}</span>
                      <span className={s.statUnit}>
                        {mp.hoursSinceLastTrained != null ? `${Math.round(mp.hoursSinceLastTrained)}h ago` : 'No data'}
                        {mp.weeklySessionCount > 0 ? ` · ${mp.weeklySessionCount}/wk` : ''}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function SectionHeader({ title, id, expanded, onToggle }: { title: string; id: SectionId; expanded: Set<SectionId>; onToggle: (id: SectionId) => void }) {
  const isOpen = expanded.has(id)
  return (
    <button
      onClick={() => onToggle(id)}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        width: '100%', padding: '10px 4px',
        background: 'none', border: 'none', cursor: 'pointer',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <span style={{ fontSize: 'var(--text-base)', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: 'var(--letter-tight)' }}>
        {title}
      </span>
      <span style={{ fontSize: 12, color: 'var(--text-muted)', transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
        ▸
      </span>
    </button>
  )
}
