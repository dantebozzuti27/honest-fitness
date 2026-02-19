import { useState, useEffect, useMemo } from 'react'
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
import { getTodayEST, getLocalDate } from '../utils/dateUtils'
import { logError } from '../utils/logger'
import EmptyState from '../components/EmptyState'
import Skeleton from '../components/Skeleton'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'
import Button from '../components/Button'
import BackButton from '../components/BackButton'
import styles from './Analytics.module.css'

const TABS = ['Overview', 'Workouts', 'Metrics', 'Body Parts']

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
                          return (
                            <tr key={w.id || i}>
                              <td style={tdStyle}>{w.date || '—'}</td>
                              <td style={{ ...tdStyle, color: 'var(--text-secondary)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {w.template_name || 'Freestyle'}
                              </td>
                              <td style={tdRight}>{w.duration ? fmtDuration(w.duration) : '—'}</td>
                              <td style={tdRight}>{w.workout_exercises?.length || 0}</td>
                              <td style={tdRight}>{vol > 0 ? fmt(vol) : '—'}</td>
                            </tr>
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
          </>
        )}
      </div>

      {toast && <Toast message={toast.message} type={toast.type} duration={toast.duration} onClose={hideToast} />}
    </div>
  )
}
