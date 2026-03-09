import React, { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  getBodyPartStats,
  calculateStreakFromSupabase,
  getWorkoutFrequency,
  getExerciseStats,
  getWorkoutsFromSupabase,
  getDetailedBodyPartStats,
} from '../lib/db/workoutsDb'
import { getAllMetricsFromSupabase } from '../lib/db/metricsDb'
import { computeTrainingProfile, type TrainingProfile } from '../lib/trainingAnalysis'
import { getTodayEST, getLocalDate } from '../utils/dateUtils'
import { logError } from '../utils/logger'
import EmptyState from '../components/EmptyState'
import Skeleton from '../components/Skeleton'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'
import Button from '../components/Button'
import BackButton from '../components/BackButton'
import styles from './Analytics.module.css'

const TABS = ['Overview', 'Workouts', 'Metrics', 'Body Parts', 'Intelligence']

type AnalyticsData = {
  bodyParts: Record<string, number>
  bodyPartReps: Record<string, number>
  bodyPartSets: Record<string, number>
  detailedStats: Record<string, any>
  streak: number
  metrics: any[]
  frequency: Record<string, number>
  topExercises: Array<[string, number]>
  totalWorkouts: number
  workouts: any[]
}

const DATE_RANGES = ['Last 7 Days', 'Last 30 Days', 'Last 90 Days', 'This Year', 'All Time']

function getDateCutoff(range: string): string {
  const today = new Date(`${getTodayEST()}T12:00:00`)
  if (range === 'Last 7 Days') { const d = new Date(today); d.setDate(d.getDate() - 7); return getLocalDate(d) }
  if (range === 'Last 30 Days') { const d = new Date(today); d.setDate(d.getDate() - 30); return getLocalDate(d) }
  if (range === 'Last 90 Days') { const d = new Date(today); d.setDate(d.getDate() - 90); return getLocalDate(d) }
  if (range === 'This Year') return `${today.getFullYear()}-01-01`
  return ''
}

function fmt(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

const tableStyle: React.CSSProperties = {
  width: '100%', borderCollapse: 'collapse', fontSize: 13,
}
const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid var(--border-primary)',
  color: 'var(--text-secondary)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px',
}
const tdStyle: React.CSSProperties = {
  padding: '8px 10px', borderBottom: '1px solid var(--border-primary, rgba(255,255,255,0.06))',
  color: 'var(--text-primary)',
}
const tdRight: React.CSSProperties = { ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }
const thRight: React.CSSProperties = { ...thStyle, textAlign: 'right' }
const cardStyle: React.CSSProperties = {
  background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', padding: 16, overflow: 'auto',
}

export default function Analytics() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { toast, showToast, hideToast } = useToast()
  const [activeTab, setActiveTab] = useState(0)
  const [loading, setLoading] = useState(true)
  const [dateRange, setDateRange] = useState('Last 30 Days')
  const [expandedWorkout, setExpandedWorkout] = useState<string | null>(null)
  const [trainingProfile, setTrainingProfile] = useState<TrainingProfile | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [data, setData] = useState<AnalyticsData>({
    bodyParts: {}, bodyPartReps: {}, bodyPartSets: {}, detailedStats: {},
    streak: 0, metrics: [], frequency: {}, topExercises: [], totalWorkouts: 0, workouts: [],
  })

  useEffect(() => {
    async function loadData() {
      if (!user) return
      setLoading(true)
      try {
        const [bodyParts, streak, metrics, frequency, topExercises, workouts, detailedStats] = await Promise.all([
          getBodyPartStats(user.id),
          calculateStreakFromSupabase(user.id),
          getAllMetricsFromSupabase(user.id),
          getWorkoutFrequency(user.id, 365),
          getExerciseStats(user.id),
          getWorkoutsFromSupabase(user.id),
          getDetailedBodyPartStats(user.id),
        ])

        const bodyPartReps: Record<string, number> = {}
        const bodyPartSets: Record<string, number> = {}
        ;(workouts as any[]).forEach((w: any) => {
          w.workout_exercises?.forEach((ex: any) => {
            const validSets = (ex.workout_sets || []).filter((s: any) => s.weight || s.reps || s.time)
            if (validSets.length === 0) return
            const bp = ex.body_part || 'Other'
            bodyPartSets[bp] = (bodyPartSets[bp] || 0) + validSets.length
            validSets.forEach((s: any) => {
              if (s.reps) bodyPartReps[bp] = (bodyPartReps[bp] || 0) + Number(s.reps)
            })
          })
        })

        setData({
          bodyParts: bodyParts as Record<string, number>,
          bodyPartReps, bodyPartSets,
          detailedStats: detailedStats as Record<string, any>,
          streak: streak as number,
          metrics: (metrics || []) as any[],
          frequency: frequency as Record<string, number>,
          topExercises: topExercises as Array<[string, number]>,
          totalWorkouts: (workouts as any[]).length,
          workouts: workouts as any[],
        })
      } catch (e) {
        logError('Analytics load failed', e)
        showToast('Failed to load analytics data.', 'error')
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [user])

  const cutoff = getDateCutoff(dateRange)
  const rangedWorkouts = useMemo(() =>
    data.workouts.filter((w: any) => !cutoff || (w.date || '') >= cutoff).sort((a: any, b: any) => (b.date || '').localeCompare(a.date || '')),
    [data.workouts, cutoff]
  )
  const rangedMetrics = useMemo(() =>
    data.metrics.filter((m: any) => !cutoff || (m.date || '') >= cutoff).sort((a: any, b: any) => (b.date || '').localeCompare(a.date || '')),
    [data.metrics, cutoff]
  )

  function workoutVolume(w: any): number {
    let vol = 0
    ;(w.workout_exercises || []).forEach((ex: any) => {
      ;(ex.workout_sets || []).forEach((s: any) => {
        const weight = Number(s?.weight || 0)
        const reps = Number(s?.reps || 0)
        if (weight > 0 && reps > 0) vol += weight * reps
      })
    })
    return vol
  }

  const totalVolume = useMemo(() => rangedWorkouts.reduce((sum, w) => sum + workoutVolume(w), 0), [rangedWorkouts])
  const avgDuration = useMemo(() => {
    const withDur = rangedWorkouts.filter((w: any) => w.duration > 0)
    return withDur.length ? Math.round(withDur.reduce((s: number, w: any) => s + w.duration, 0) / withDur.length) : 0
  }, [rangedWorkouts])

  const rangedBodyParts = useMemo(() => {
    const parts: Record<string, { sets: number; reps: number; volume: number }> = {}
    rangedWorkouts.forEach((w: any) => {
      ;(w.workout_exercises || []).forEach((ex: any) => {
        const bp = ex.body_part || 'Other'
        if (!parts[bp]) parts[bp] = { sets: 0, reps: 0, volume: 0 }
        ;(ex.workout_sets || []).forEach((s: any) => {
          const weight = Number(s?.weight || 0)
          const reps = Number(s?.reps || 0)
          if (weight || reps || s?.time) parts[bp].sets++
          if (reps) parts[bp].reps += reps
          if (weight > 0 && reps > 0) parts[bp].volume += weight * reps
        })
      })
    })
    return Object.entries(parts).sort((a, b) => b[1].sets - a[1].sets)
  }, [rangedWorkouts])

  const DateRangePicker = () => (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
      {DATE_RANGES.map(r => (
        <button key={r} onClick={() => setDateRange(r)}
          style={{
            padding: '5px 10px', borderRadius: 6, border: 'none', fontSize: 12, cursor: 'pointer',
            background: dateRange === r ? 'var(--accent)' : 'var(--bg-tertiary, rgba(255,255,255,0.06))',
            color: dateRange === r ? '#fff' : 'var(--text-secondary)',
          }}>
          {r}
        </button>
      ))}
    </div>
  )

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <BackButton />
        <h1 className={styles.title}>Analytics</h1>
        <div style={{ width: 32 }} />
      </div>

      <div className={styles.tabs}>
        {TABS.map((tab, i) => (
          <Button unstyled key={tab} className={`${styles.tab} ${activeTab === i ? styles.activeTab : ''}`} onClick={() => setActiveTab(i)}>
            {tab}
          </Button>
        ))}
      </div>

      <div className={styles.content} style={{ paddingBottom: '100px' }}>
        {loading ? (
          <div style={{ padding: 'var(--space-md)', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Skeleton style={{ height: 80 }} />
            <Skeleton style={{ height: 200 }} />
          </div>
        ) : (
          <>
            {/* ============ OVERVIEW ============ */}
            {activeTab === 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 'var(--space-md)' }}>
                <DateRangePicker />

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {[
                    { label: 'Workouts', value: rangedWorkouts.length },
                    { label: 'Streak', value: `${data.streak}d` },
                    { label: 'Avg Duration', value: avgDuration ? fmtDuration(avgDuration) : '—' },
                    { label: 'Total Volume', value: totalVolume ? `${fmt(totalVolume)} lbs` : '—' },
                  ].map(s => (
                    <div key={s.label} style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', padding: 16, textAlign: 'center' }}>
                      <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)' }}>{s.value}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{s.label}</div>
                    </div>
                  ))}
                </div>

                {data.topExercises.length > 0 && (
                  <div style={cardStyle}>
                    <h3 style={{ margin: '0 0 12px', fontSize: 15, color: 'var(--text-primary)' }}>Top Exercises (All Time)</h3>
                    <table style={tableStyle}>
                      <thead><tr><th style={thStyle}>Exercise</th><th style={thRight}>Sessions</th></tr></thead>
                      <tbody>
                        {data.topExercises.slice(0, 15).map(([name, count]) => (
                          <tr key={name}><td style={tdStyle}>{name}</td><td style={tdRight}>{count}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {data.totalWorkouts === 0 && (
                  <EmptyState title="No workout data" message="Start logging workouts to see analytics." actionLabel="Start Workout" onAction={() => navigate('/workout')} />
                )}
              </div>
            )}

            {/* ============ WORKOUTS TABLE ============ */}
            {activeTab === 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 'var(--space-md)' }}>
                <DateRangePicker />

                {rangedWorkouts.length > 0 ? (
                  <div style={cardStyle}>
                    <table style={tableStyle}>
                      <thead>
                        <tr>
                          <th style={thStyle}>Date</th>
                          <th style={thStyle}>Template</th>
                          <th style={thRight}>Duration</th>
                          <th style={thRight}>Exercises</th>
                          <th style={thRight}>Volume</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rangedWorkouts.map((w: any, i: number) => {
                          const vol = workoutVolume(w)
                          const wKey = w.id || `w-${i}`
                          const isExpanded = expandedWorkout === wKey
                          const exercises: any[] = w.workout_exercises || []
                          return (
                            <React.Fragment key={wKey}>
                              <tr
                                onClick={() => setExpandedWorkout(isExpanded ? null : wKey)}
                                style={{ cursor: 'pointer' }}
                              >
                                <td style={tdStyle}>
                                  <span style={{ marginRight: 6, fontSize: 10, color: 'var(--text-secondary)' }}>{isExpanded ? '▼' : '▶'}</span>
                                  {w.date || '—'}
                                </td>
                                <td style={{ ...tdStyle, color: 'var(--text-secondary)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {w.template_name || 'Freestyle'}
                                </td>
                                <td style={tdRight}>{w.duration ? fmtDuration(w.duration) : '—'}</td>
                                <td style={tdRight}>{exercises.length}</td>
                                <td style={tdRight}>{vol > 0 ? fmt(vol) : '—'}</td>
                              </tr>
                              {isExpanded && exercises.length > 0 && (
                                <tr>
                                  <td colSpan={5} style={{ padding: 0, borderBottom: '1px solid var(--border-primary, rgba(255,255,255,0.06))' }}>
                                    <div style={{ padding: '8px 10px 12px', background: 'var(--bg-tertiary, rgba(255,255,255,0.03))' }}>
                                      <table style={{ ...tableStyle, fontSize: 12 }}>
                                        <thead>
                                          <tr>
                                            <th style={{ ...thStyle, fontSize: 10 }}>Exercise</th>
                                            <th style={{ ...thStyle, fontSize: 10 }}>Body Part</th>
                                            <th style={{ ...thRight, fontSize: 10 }}>Sets</th>
                                            <th style={{ ...thStyle, fontSize: 10 }}>Detail</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {exercises.map((ex: any, j: number) => {
                                            const sets: any[] = ex.workout_sets || []
                                            const setsStr = sets
                                              .filter((s: any) => s.weight || s.reps || s.time)
                                              .map((s: any) => {
                                                if (s.time) return `${s.time}s`
                                                if (s.weight && s.reps) return `${s.weight}×${s.reps}`
                                                if (s.reps) return `BW×${s.reps}`
                                                return `${s.weight}lb`
                                              })
                                              .join(', ')
                                            return (
                                              <tr key={j}>
                                                <td style={{ ...tdStyle, fontWeight: 500 }}>{ex.exercise_name || ex.name || '—'}</td>
                                                <td style={{ ...tdStyle, color: 'var(--text-secondary)' }}>{ex.body_part || '—'}</td>
                                                <td style={tdRight}>{sets.filter((s: any) => s.weight || s.reps || s.time).length}</td>
                                                <td style={{ ...tdStyle, color: 'var(--text-secondary)', fontSize: 11, fontFamily: 'var(--font-mono, monospace)' }}>
                                                  {setsStr || '—'}
                                                </td>
                                              </tr>
                                            )
                                          })}
                                        </tbody>
                                      </table>
                                      {w.notes && (
                                        <div style={{ marginTop: 8, padding: '6px 10px', fontSize: 12, color: 'var(--text-secondary)', background: 'var(--bg-secondary)', borderRadius: 6 }}>
                                          {w.notes}
                                        </div>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState title="No workouts" message="Log workouts to see your history." actionLabel="Start Workout" onAction={() => navigate('/workout')} />
                )}
              </div>
            )}

            {/* ============ METRICS TABLE ============ */}
            {activeTab === 2 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 'var(--space-md)' }}>
                <DateRangePicker />

                {rangedMetrics.length > 0 ? (
                  <div style={cardStyle}>
                    <table style={tableStyle}>
                      <thead>
                        <tr>
                          <th style={thStyle}>Date</th>
                          <th style={thRight}>Weight</th>
                          <th style={thRight}>Steps</th>
                          <th style={thRight}>Calories</th>
                          <th style={thRight}>Sleep</th>
                          <th style={thRight}>HR</th>
                          <th style={thRight}>HRV</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rangedMetrics.map((m: any, i: number) => (
                          <tr key={m.id || i}>
                            <td style={tdStyle}>{m.date || '—'}</td>
                            <td style={tdRight}>{m.weight ? `${m.weight}` : '—'}</td>
                            <td style={tdRight}>{m.steps ? fmt(Number(m.steps)) : '—'}</td>
                            <td style={tdRight}>{m.calories_burned ? fmt(Number(m.calories_burned)) : '—'}</td>
                            <td style={tdRight}>{m.sleep_duration ? `${(Number(m.sleep_duration) / 60).toFixed(1)}h` : '—'}</td>
                            <td style={tdRight}>{m.resting_heart_rate ? Math.round(Number(m.resting_heart_rate)) : '—'}</td>
                            <td style={tdRight}>{m.hrv ? Math.round(Number(m.hrv)) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState title="No metrics" message="Log weight or connect Fitbit to see health data." />
                )}
              </div>
            )}

            {/* ============ BODY PARTS TABLE ============ */}
            {activeTab === 3 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 'var(--space-md)' }}>
                <DateRangePicker />

                {rangedBodyParts.length > 0 ? (
                  <div style={cardStyle}>
                    <table style={tableStyle}>
                      <thead>
                        <tr>
                          <th style={thStyle}>Body Part</th>
                          <th style={thRight}>Sets</th>
                          <th style={thRight}>Reps</th>
                          <th style={thRight}>Volume (lbs)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rangedBodyParts.map(([part, stats]) => (
                          <tr key={part}>
                            <td style={tdStyle}>{part}</td>
                            <td style={tdRight}>{stats.sets}</td>
                            <td style={tdRight}>{fmt(stats.reps)}</td>
                            <td style={tdRight}>{stats.volume > 0 ? fmt(stats.volume) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ fontWeight: 600 }}>
                          <td style={tdStyle}>Total</td>
                          <td style={tdRight}>{rangedBodyParts.reduce((s, [, v]) => s + v.sets, 0)}</td>
                          <td style={tdRight}>{fmt(rangedBodyParts.reduce((s, [, v]) => s + v.reps, 0))}</td>
                          <td style={tdRight}>{fmt(rangedBodyParts.reduce((s, [, v]) => s + v.volume, 0))}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                ) : (
                  <EmptyState title="No data" message="Log workouts to see body part breakdown." actionLabel="Start Workout" onAction={() => navigate('/workout')} />
                )}
              </div>
            )}

            {/* ============ INTELLIGENCE TAB ============ */}
            {activeTab === 4 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 'var(--space-md)' }}>
                {!trainingProfile && !profileLoading && (
                  <Button onClick={async () => {
                    if (!user) return
                    setProfileLoading(true)
                    try {
                      const p = await computeTrainingProfile(user.id)
                      setTrainingProfile(p)
                    } catch (err) {
                      logError('Training profile error', err)
                      showToast('Failed to compute training profile', 'error')
                    }
                    setProfileLoading(false)
                  }}>
                    Analyze Training Data
                  </Button>
                )}
                {profileLoading && (
                  <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>
                    Computing intelligence data...
                  </div>
                )}
                {trainingProfile && (
                  <>
                    {/* 30-Day Trends */}
                    {(() => {
                      const t = trainingProfile.rolling30DayTrends
                      const arrow = (d: string) => d === 'up' ? '↑' : d === 'down' ? '↓' : '→'
                      const trendColor = (d: string, goodDir: 'up' | 'down') =>
                        d === goodDir ? 'var(--success)' : d === (goodDir === 'up' ? 'down' : 'up') ? 'var(--danger, #ef4444)' : 'var(--text-secondary)'
                      const renderTrendRow = (label: string, mt: typeof t.sleep, unit: string, goodDir: 'up' | 'down') => {
                        if (mt.dataPoints < 3) return null
                        return (
                          <tr key={label}>
                            <td style={tdStyle}>{label}</td>
                            <td style={tdRight}>{mt.current?.toFixed(1) ?? '—'} {unit}</td>
                            <td style={tdRight}>{mt.avg30d?.toFixed(1) ?? '—'}</td>
                            <td style={{ ...tdRight, color: trendColor(mt.direction, goodDir), fontWeight: 600 }}>
                              {arrow(mt.direction)} {Math.abs(mt.slopePct).toFixed(1)}%/wk
                            </td>
                          </tr>
                        )
                      }
                      return (
                        <>
                          {/* Overall Strength */}
                          <div style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', padding: 16 }}>
                            <h3 style={{ margin: '0 0 12px', fontSize: 16, color: 'var(--text-primary)' }}>Overall Progress (30 Days)</h3>
                            <table style={tableStyle}>
                              <thead>
                                <tr><th style={thStyle}>Metric</th><th style={thRight}>Current</th><th style={thRight}>30d Avg</th><th style={thRight}>Trend</th></tr>
                              </thead>
                              <tbody>
                                {renderTrendRow('Strength Index', t.totalStrengthIndex, 'lbs', 'up')}
                                {renderTrendRow('Big 3 Total', t.big3Total, 'lbs', 'up')}
                                {renderTrendRow('Relative Strength', t.relativeStrength, '', 'up')}
                                {renderTrendRow('Volume Load', t.totalVolumeLoad, 'lbs', 'up')}
                                {renderTrendRow('Body Weight', t.bodyWeight, 'lbs', t.bodyWeight.direction === 'up' ? 'up' : 'down')}
                                {renderTrendRow('Body Fat', t.bodyFat, '%', 'down')}
                                {renderTrendRow('Lean Mass', t.estimatedLeanMass, 'lbs', 'up')}
                              </tbody>
                            </table>
                          </div>

                          {/* Recovery Trends */}
                          <div style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', padding: 16 }}>
                            <h3 style={{ margin: '0 0 12px', fontSize: 16, color: 'var(--text-primary)' }}>Recovery Trends (30 Days)</h3>
                            <table style={tableStyle}>
                              <thead>
                                <tr><th style={thStyle}>Metric</th><th style={thRight}>Current</th><th style={thRight}>30d Avg</th><th style={thRight}>Trend</th></tr>
                              </thead>
                              <tbody>
                                {renderTrendRow('Sleep', t.sleep, 'hrs', 'up')}
                                {renderTrendRow('HRV', t.hrv, 'ms', 'up')}
                                {renderTrendRow('RHR', t.rhr, 'bpm', 'down')}
                                {renderTrendRow('Steps', t.steps, '', 'up')}
                              </tbody>
                            </table>
                          </div>

                          {/* Training Trends */}
                          <div style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', padding: 16 }}>
                            <h3 style={{ margin: '0 0 12px', fontSize: 16, color: 'var(--text-primary)' }}>Training Trends (30 Days)</h3>
                            <table style={tableStyle}>
                              <thead>
                                <tr><th style={thStyle}>Metric</th><th style={thRight}>Current</th><th style={thRight}>30d Avg</th><th style={thRight}>Trend</th></tr>
                              </thead>
                              <tbody>
                                {renderTrendRow('Frequency', t.trainingFrequency, 'days/wk', 'up')}
                                {renderTrendRow('Session Duration', t.avgSessionDuration, 'min', 'up')}
                                {renderTrendRow('Weekly Sets', t.totalWeeklyVolume, 'sets', 'up')}
                              </tbody>
                            </table>
                          </div>

                          {/* Per-Exercise Strength */}
                          {t.exerciseTrends.filter(e => e.estimated1RM.dataPoints >= 2).length > 0 && (
                            <div style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', padding: 16 }}>
                              <h3 style={{ margin: '0 0 12px', fontSize: 16, color: 'var(--text-primary)' }}>Lift Trends (30 Days)</h3>
                              <div style={{ overflowX: 'auto' }}>
                                <table style={tableStyle}>
                                  <thead>
                                    <tr><th style={thStyle}>Exercise</th><th style={thRight}>e1RM</th><th style={thRight}>Trend</th><th style={thRight}>Vol Load</th></tr>
                                  </thead>
                                  <tbody>
                                    {t.exerciseTrends.filter(e => e.estimated1RM.dataPoints >= 2).map(et => (
                                      <tr key={et.exerciseName}>
                                        <td style={tdStyle}>{et.exerciseName}</td>
                                        <td style={tdRight}>{et.estimated1RM.current?.toFixed(0) ?? '—'} lbs</td>
                                        <td style={{ ...tdRight, color: trendColor(et.estimated1RM.direction, 'up'), fontWeight: 600 }}>
                                          {arrow(et.estimated1RM.direction)} {Math.abs(et.estimated1RM.slopePct).toFixed(1)}%/wk
                                        </td>
                                        <td style={{ ...tdRight, color: trendColor(et.volumeLoad.direction, 'up') }}>
                                          {et.volumeLoad.dataPoints >= 2 ? `${arrow(et.volumeLoad.direction)} ${Math.abs(et.volumeLoad.slopePct).toFixed(1)}%` : '—'}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}

                          {/* Per-Muscle-Group Volume */}
                          {t.muscleGroupTrends.length > 0 && (
                            <div style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', padding: 16 }}>
                              <h3 style={{ margin: '0 0 12px', fontSize: 16, color: 'var(--text-primary)' }}>Muscle Volume Trends (30 Days)</h3>
                              <div style={{ overflowX: 'auto' }}>
                                <table style={tableStyle}>
                                  <thead>
                                    <tr><th style={thStyle}>Muscle Group</th><th style={thRight}>Avg Sets/Wk</th><th style={thRight}>Trend</th></tr>
                                  </thead>
                                  <tbody>
                                    {t.muscleGroupTrends.map(mg => (
                                      <tr key={mg.muscleGroup}>
                                        <td style={tdStyle}>{mg.muscleGroup.replace(/_/g, ' ')}</td>
                                        <td style={tdRight}>{mg.weeklySetsTrend.avg30d?.toFixed(1) ?? '—'}</td>
                                        <td style={{ ...tdRight, color: trendColor(mg.weeklySetsTrend.direction, 'up'), fontWeight: 600 }}>
                                          {arrow(mg.weeklySetsTrend.direction)} {Math.abs(mg.weeklySetsTrend.slopePct).toFixed(1)}%/wk
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </>
                      )
                    })()}

                    {/* Strength Percentiles */}
                    {trainingProfile.strengthPercentiles.length > 0 && (() => {
                      const sp = trainingProfile.strengthPercentiles
                      const bodyWeightClass = sp[0]?.bodyWeightClass ?? ''
                      const gender = trainingProfile.gender
                      const genderLabel = gender ? (gender.toUpperCase().startsWith('F') ? 'F' : 'M') : ''
                      const levelFromPercentile = (p: number) =>
                        p > 90 ? 'World Class' : p > 75 ? 'Elite' : p > 50 ? 'Advanced' : p >= 25 ? 'Intermediate' : 'Beginner'
                      const percentileColor = (p: number) =>
                        p > 75 ? 'var(--success)' : p > 50 ? '#e6a800' : 'var(--text-primary)'
                      const percentileBarBg = (p: number) =>
                        p > 75 ? 'rgba(34, 197, 94, 0.2)' : p > 50 ? 'rgba(230, 168, 0, 0.2)' : 'rgba(255,255,255,0.06)'
                      const percentileBarFill = (p: number) =>
                        p > 75 ? 'rgba(34, 197, 94, 0.4)' : p > 50 ? 'rgba(230, 168, 0, 0.4)' : 'rgba(255,255,255,0.12)'
                      return (
                        <div style={cardStyle}>
                          <h3 style={{ margin: '0 0 4px', fontSize: 16, color: 'var(--text-primary)' }}>Strength Percentiles</h3>
                          <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-secondary)' }}>
                            Your weight class: {bodyWeightClass}{genderLabel ? ` (${genderLabel})` : ''}
                          </p>
                          <table style={tableStyle}>
                            <thead>
                              <tr>
                                <th style={thStyle}>Lift</th>
                                <th style={thRight}>Your e1RM</th>
                                <th style={thRight}>Percentile</th>
                                <th style={thRight}>Level</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sp.map(s => (
                                <tr key={s.lift}>
                                  <td style={tdStyle}>{s.lift.charAt(0).toUpperCase() + s.lift.slice(1)}</td>
                                  <td style={tdRight}>{s.estimated1RM} lbs</td>
                                    <td style={tdRight}>
                                    <span style={{
                                      display: 'inline-block',
                                      position: 'relative',
                                      minWidth: 48,
                                      padding: '2px 6px',
                                      borderRadius: 4,
                                      backgroundColor: percentileBarBg(s.percentile),
                                      color: percentileColor(s.percentile),
                                      fontWeight: 600,
                                      zIndex: 1,
                                      overflow: 'hidden',
                                    }}>
                                      <span style={{
                                        position: 'absolute',
                                        left: 0,
                                        top: 0,
                                        bottom: 0,
                                        width: `${Math.min(s.percentile, 100)}%`,
                                        backgroundColor: percentileBarFill(s.percentile),
                                        borderRadius: 4,
                                        zIndex: -1,
                                      }} />
                                      {s.percentile}th
                                    </span>
                                  </td>
                                  <td style={tdRight}>{levelFromPercentile(s.percentile)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )
                    })()}

                    {/* Global Stats */}
                    <div style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', padding: 16 }}>
                      <h3 style={{ margin: '0 0 12px', fontSize: 16, color: 'var(--text-primary)' }}>Global Stats</h3>
                      <table style={tableStyle}>
                        <tbody>
                          <tr><td style={tdStyle}>Training Frequency</td><td style={tdRight}>{trainingProfile.trainingFrequency} days/week</td></tr>
                          <tr><td style={tdStyle}>Avg Session Duration</td><td style={tdRight}>{Math.round(trainingProfile.avgSessionDuration / 60)} min</td></tr>
                          <tr><td style={tdStyle}>Training Age</td><td style={tdRight}>{trainingProfile.trainingAgeDays} days</td></tr>
                          <tr><td style={tdStyle}>Consistency</td><td style={tdRight}>{Math.round(trainingProfile.consistencyScore * 100)}%</td></tr>
                          <tr><td style={tdStyle}>Weight Trend</td><td style={tdRight}>{trainingProfile.bodyWeightTrend.phase} ({trainingProfile.bodyWeightTrend.slope > 0 ? '+' : ''}{trainingProfile.bodyWeightTrend.slope} lbs/wk)</td></tr>
                        </tbody>
                      </table>
                    </div>

                    {/* Muscle Volume */}
                    <div style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', padding: 16 }}>
                      <h3 style={{ margin: '0 0 12px', fontSize: 16, color: 'var(--text-primary)' }}>Muscle Volume (Weekly Sets)</h3>
                      <div style={{ overflowX: 'auto' }}>
                        <table style={tableStyle}>
                          <thead>
                            <tr><th style={thStyle}>Muscle Group</th><th style={thRight}>Direct</th><th style={thRight}>Target</th><th style={thRight}>Status</th><th style={thRight}>Days Rest</th></tr>
                          </thead>
                          <tbody>
                            {trainingProfile.muscleVolumeStatuses.map(v => (
                              <tr key={v.muscleGroup}>
                                <td style={tdStyle}>{v.muscleGroup.replace(/_/g, ' ')}</td>
                                <td style={tdRight}>{v.weeklyDirectSets}</td>
                                <td style={tdRight}>{v.mavLow}-{v.mavHigh}</td>
                                <td style={{ ...tdRight, color: v.status === 'below_mev' ? 'var(--danger, #ef4444)' : v.status === 'in_mav' ? 'var(--success)' : 'var(--text-secondary)' }}>
                                  {v.status.replace(/_/g, ' ')}
                                </td>
                                <td style={tdRight}>{v.daysSinceLastTrained === Infinity ? '—' : v.daysSinceLastTrained}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Exercise Progression */}
                    {trainingProfile.exerciseProgressions.length > 0 && (
                      <div style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', padding: 16 }}>
                        <h3 style={{ margin: '0 0 12px', fontSize: 16, color: 'var(--text-primary)' }}>Exercise Progression</h3>
                        <div style={{ overflowX: 'auto' }}>
                          <table style={tableStyle}>
                            <thead>
                              <tr><th style={thStyle}>Exercise</th><th style={thRight}>Est 1RM</th><th style={thRight}>Status</th><th style={thRight}>Sessions</th></tr>
                            </thead>
                            <tbody>
                              {trainingProfile.exerciseProgressions.slice(0, 20).map(p => (
                                <tr key={p.exerciseName}>
                                  <td style={tdStyle}>{p.exerciseName}</td>
                                  <td style={tdRight}>{p.estimated1RM} lbs</td>
                                  <td style={{ ...tdRight, color: p.status === 'progressing' ? 'var(--success)' : p.status === 'regressing' ? 'var(--danger, #ef4444)' : 'var(--text-secondary)' }}>
                                    {p.status}
                                  </td>
                                  <td style={tdRight}>{p.sessionsTracked}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Recovery Correlations */}
                    <div style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', padding: 16 }}>
                      <h3 style={{ margin: '0 0 12px', fontSize: 16, color: 'var(--text-primary)' }}>Recovery Correlations</h3>
                      <table style={tableStyle}>
                        <thead>
                          <tr><th style={thStyle}>Variable</th><th style={thRight}>Sensitivity</th><th style={thRight}>Data Points</th><th style={thRight}>Confidence</th></tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td style={tdStyle}>Sleep → Upper Body</td>
                            <td style={tdRight}>{(trainingProfile.sleepCoefficients.upperBody * 100).toFixed(1)}%</td>
                            <td style={tdRight}>{trainingProfile.sleepCoefficients.dataPoints}</td>
                            <td style={tdRight}>{trainingProfile.sleepCoefficients.confidence}</td>
                          </tr>
                          <tr>
                            <td style={tdStyle}>Sleep → Lower Body</td>
                            <td style={tdRight}>{(trainingProfile.sleepCoefficients.lowerBody * 100).toFixed(1)}%</td>
                            <td style={tdRight}>{trainingProfile.sleepCoefficients.dataPoints}</td>
                            <td style={tdRight}>{trainingProfile.sleepCoefficients.confidence}</td>
                          </tr>
                          {trainingProfile.stepsPerformanceCorrelation && (
                            <tr>
                              <td style={tdStyle}>Steps → Leg Performance</td>
                              <td style={tdRight}>{(trainingProfile.stepsPerformanceCorrelation.coefficient * 100).toFixed(1)}%</td>
                              <td style={tdRight}>{trainingProfile.stepsPerformanceCorrelation.dataPoints}</td>
                              <td style={tdRight}>{trainingProfile.stepsPerformanceCorrelation.dataPoints >= 20 ? 'medium' : 'low'}</td>
                            </tr>
                          )}
                        </tbody>
                      </table>

                      {trainingProfile.timeOfDayEffects.length > 0 && (
                        <>
                          <h4 style={{ margin: '16px 0 8px', fontSize: 14, color: 'var(--text-secondary)' }}>Time of Day Effects</h4>
                          <table style={tableStyle}>
                            <thead><tr><th style={thStyle}>Time</th><th style={thRight}>Avg Delta</th><th style={thRight}>Data Points</th></tr></thead>
                            <tbody>
                              {trainingProfile.timeOfDayEffects.map(t => (
                                <tr key={t.bucket}>
                                  <td style={tdStyle}>{t.bucket}</td>
                                  <td style={{ ...tdRight, color: t.avgDelta < -0.02 ? 'var(--danger, #ef4444)' : t.avgDelta > 0.02 ? 'var(--success)' : 'var(--text-secondary)' }}>
                                    {t.avgDelta >= 0 ? '+' : ''}{(t.avgDelta * 100).toFixed(1)}%
                                  </td>
                                  <td style={tdRight}>{t.dataPoints}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </>
                      )}

                      {trainingProfile.consecutiveDaysEffects.length > 0 && (
                        <>
                          <h4 style={{ margin: '16px 0 8px', fontSize: 14, color: 'var(--text-secondary)' }}>Consecutive Day Impact</h4>
                          <table style={tableStyle}>
                            <thead><tr><th style={thStyle}>Day</th><th style={thRight}>Avg Delta</th><th style={thRight}>Data Points</th></tr></thead>
                            <tbody>
                              {trainingProfile.consecutiveDaysEffects.map(c => (
                                <tr key={c.dayIndex}>
                                  <td style={tdStyle}>Day {c.dayIndex}</td>
                                  <td style={{ ...tdRight, color: c.avgDelta < -0.02 ? 'var(--danger, #ef4444)' : 'var(--text-secondary)' }}>
                                    {c.avgDelta >= 0 ? '+' : ''}{(c.avgDelta * 100).toFixed(1)}%
                                  </td>
                                  <td style={tdRight}>{c.dataPoints}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </>
                      )}
                    </div>

                    {/* Imbalance Alerts */}
                    {trainingProfile.imbalanceAlerts.length > 0 && (
                      <div style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', padding: 16, borderLeft: '3px solid var(--danger, #ef4444)' }}>
                        <h3 style={{ margin: '0 0 12px', fontSize: 16, color: 'var(--text-primary)' }}>Imbalance Alerts</h3>
                        {trainingProfile.imbalanceAlerts.map((a, i) => (
                          <div key={i} style={{ marginBottom: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
                            <strong style={{ color: 'var(--text-primary)' }}>{a.type.replace(/_/g, ' ')}:</strong>{' '}
                            {a.description} (ratio: {a.ratio}, target: {a.targetRatio})
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Deload & Plateaus */}
                    <div style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', padding: 16 }}>
                      <h3 style={{ margin: '0 0 12px', fontSize: 16, color: 'var(--text-primary)' }}>Active Flags</h3>
                      <table style={tableStyle}>
                        <tbody>
                          <tr>
                            <td style={tdStyle}>Deload Needed</td>
                            <td style={{ ...tdRight, color: trainingProfile.deloadRecommendation.needed ? 'var(--danger, #ef4444)' : 'var(--success)', fontWeight: 600 }}>
                              {trainingProfile.deloadRecommendation.needed ? 'YES' : 'No'}
                            </td>
                          </tr>
                          {trainingProfile.deloadRecommendation.signals.map((s, i) => (
                            <tr key={i}><td style={tdStyle} colSpan={2}>{s}</td></tr>
                          ))}
                        </tbody>
                      </table>

                      {trainingProfile.plateauDetections.filter(p => p.isPlateaued).length > 0 && (
                        <>
                          <h4 style={{ margin: '16px 0 8px', fontSize: 14, color: 'var(--text-secondary)' }}>Plateaued Exercises</h4>
                          <table style={tableStyle}>
                            <thead><tr><th style={thStyle}>Exercise</th><th style={thRight}>Sessions</th><th style={thStyle}>Strategy</th></tr></thead>
                            <tbody>
                              {trainingProfile.plateauDetections.filter(p => p.isPlateaued).map(p => (
                                <tr key={p.exerciseName}>
                                  <td style={tdStyle}>{p.exerciseName}</td>
                                  <td style={tdRight}>{p.sessionsSinceProgress}</td>
                                  <td style={{ ...tdStyle, fontSize: 12 }}>{p.suggestedStrategy}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </>
                      )}
                    </div>

                    {/* Muscle Recovery */}
                    <div style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', padding: 16 }}>
                      <h3 style={{ margin: '0 0 12px', fontSize: 16, color: 'var(--text-primary)' }}>Muscle Recovery Status</h3>
                      <div style={{ overflowX: 'auto' }}>
                        <table style={tableStyle}>
                          <thead>
                            <tr><th style={thStyle}>Muscle</th><th style={thRight}>Recovery %</th><th style={thRight}>Hours Rest</th><th style={thRight}>Ready</th></tr>
                          </thead>
                          <tbody>
                            {trainingProfile.muscleRecovery.map(r => (
                              <tr key={r.muscleGroup}>
                                <td style={tdStyle}>{r.muscleGroup.replace(/_/g, ' ')}</td>
                                <td style={tdRight}>{r.recoveryPercent}%</td>
                                <td style={tdRight}>{r.hoursSinceLastTrained === Infinity ? '—' : r.hoursSinceLastTrained.toFixed(0)}h</td>
                                <td style={{ ...tdRight, color: r.readyToTrain ? 'var(--success)' : 'var(--danger, #ef4444)' }}>
                                  {r.readyToTrain ? 'Yes' : 'No'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {toast && <Toast message={toast.message} type={toast.type} duration={toast.duration} onClose={hideToast} />}
    </div>
  )
}
