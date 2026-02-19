import { useState, useEffect, useMemo, useRef } from 'react'
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
import { getAllTemplates } from '../db/lazyDb'
import { getTodayEST, getYesterdayEST, getLocalDate } from '../utils/dateUtils'
import { logError } from '../utils/logger'
import BarChart from '../components/BarChart'
import LineChart from '../components/LineChart'
import ChartCard from '../components/ChartCard'
import UnifiedChart from '../components/UnifiedChart'
import EmptyState from '../components/EmptyState'
import Skeleton from '../components/Skeleton'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'
import Button from '../components/Button'
import BackButton from '../components/BackButton'
import styles from './Analytics.module.css'

const TABS = ['Overview', 'History', 'Metrics', 'Trends']

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

export default function Analytics() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { toast, showToast, hideToast } = useToast()
  const [activeTab, setActiveTab] = useState(0)
  const [loading, setLoading] = useState(true)
  const [historyCategory, setHistoryCategory] = useState('Frequency')
  const [historyDateRange, setHistoryDateRange] = useState('This Month')
  const [metricsCategory, setMetricsCategory] = useState('Weight')
  const [metricsDateRange, setMetricsDateRange] = useState('Last 30 Days')
  const [trendsCategory, setTrendsCategory] = useState('Frequency')
  const [trendsDateRange, setTrendsDateRange] = useState('Last 30 Days')
  const [data, setData] = useState<AnalyticsData>({
    bodyParts: {},
    bodyPartReps: {},
    bodyPartSets: {},
    detailedStats: {},
    streak: 0,
    metrics: [],
    frequency: {},
    topExercises: [],
    totalWorkouts: 0,
    workouts: [],
  })
  const [templates, setTemplates] = useState<any[]>([])

  useEffect(() => {
    async function loadData() {
      if (!user) return
      setLoading(true)

      try {
        const [bodyParts, streak, metrics, frequency, topExercises, workouts, tmpl, detailedStats] = await Promise.all([
          getBodyPartStats(user.id),
          calculateStreakFromSupabase(user.id),
          getAllMetricsFromSupabase(user.id),
          getWorkoutFrequency(user.id, 30),
          getExerciseStats(user.id),
          getWorkoutsFromSupabase(user.id),
          getAllTemplates(),
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
          bodyPartReps,
          bodyPartSets,
          detailedStats: detailedStats as Record<string, any>,
          streak: streak as number,
          metrics: (metrics || []) as any[],
          frequency: frequency as Record<string, number>,
          topExercises: topExercises as Array<[string, number]>,
          totalWorkouts: (workouts as any[]).length,
          workouts: workouts as any[],
        })
        setTemplates(tmpl as any[])
      } catch (e) {
        logError('Analytics load failed', e)
        showToast('Failed to load analytics data.', 'error')
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [user])

  // ============ DERIVED DATA ============

  const filteredWorkouts = useMemo(() => {
    const getDateRange = (range: string) => {
      const today = new Date(`${getTodayEST()}T12:00:00`)
      if (range === 'This Week') {
        const d = new Date(today); d.setDate(d.getDate() - d.getDay())
        return getLocalDate(d)
      }
      if (range === 'This Month') {
        return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`
      }
      if (range === 'Last 30 Days') {
        const d = new Date(today); d.setDate(d.getDate() - 30)
        return getLocalDate(d)
      }
      if (range === 'Last 90 Days') {
        const d = new Date(today); d.setDate(d.getDate() - 90)
        return getLocalDate(d)
      }
      if (range === 'This Year') {
        return `${today.getFullYear()}-01-01`
      }
      return ''
    }
    return (range: string) => {
      const cutoff = getDateRange(range)
      return data.workouts.filter((w: any) => !cutoff || (w.date || '') >= cutoff)
    }
  }, [data.workouts])

  const bodyPartChartData = useMemo(() => {
    return Object.entries(data.bodyParts)
      .filter(([, v]) => (v as number) > 0)
      .sort((a, b) => (b[1] as number) - (a[1] as number))
      .map(([name, count]) => ({ label: name, value: count as number }))
  }, [data.bodyParts])

  const frequencyChartData = useMemo(() => {
    const workouts = filteredWorkouts(historyDateRange)
    const byDate = new Map<string, number>()
    workouts.forEach((w: any) => {
      const d = w.date || ''
      byDate.set(d, (byDate.get(d) || 0) + 1)
    })
    return Array.from(byDate.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, count]) => ({ label: date, value: count }))
  }, [filteredWorkouts, historyDateRange])

  const durationChartData = useMemo(() => {
    const workouts = filteredWorkouts(historyDateRange)
    return workouts
      .filter((w: any) => w.duration)
      .sort((a: any, b: any) => (a.date || '').localeCompare(b.date || ''))
      .map((w: any) => ({ label: w.date, value: Math.round((w.duration || 0) / 60) }))
  }, [filteredWorkouts, historyDateRange])

  const volumeChartData = useMemo(() => {
    const workouts = filteredWorkouts(trendsDateRange)
    const byDate = new Map<string, number>()
    workouts.forEach((w: any) => {
      const d = w.date || ''
      let vol = 0
      ;(w.workout_exercises || []).forEach((ex: any) => {
        ;(ex.workout_sets || []).forEach((s: any) => {
          const weight = Number(s?.weight || 0)
          const reps = Number(s?.reps || 0)
          if (weight > 0 && reps > 0) vol += weight * reps
        })
      })
      if (vol > 0) byDate.set(d, (byDate.get(d) || 0) + vol)
    })
    return Array.from(byDate.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, vol]) => ({ label: date, value: Math.round(vol) }))
  }, [filteredWorkouts, trendsDateRange])

  const weightChartData = useMemo(() => {
    return data.metrics
      .filter((m: any) => m?.weight != null && Number(m.weight) > 0)
      .sort((a: any, b: any) => (a.date || '').localeCompare(b.date || ''))
      .map((m: any) => ({ label: m.date, value: Number(m.weight) }))
  }, [data.metrics])

  const stepsChartData = useMemo(() => {
    return data.metrics
      .filter((m: any) => m?.steps != null && Number(m.steps) > 0)
      .sort((a: any, b: any) => (a.date || '').localeCompare(b.date || ''))
      .map((m: any) => ({ label: m.date, value: Number(m.steps) }))
  }, [data.metrics])

  const sleepChartData = useMemo(() => {
    return data.metrics
      .filter((m: any) => m?.sleep_duration != null && Number(m.sleep_duration) > 0)
      .sort((a: any, b: any) => (a.date || '').localeCompare(b.date || ''))
      .map((m: any) => ({ label: m.date, value: Number((Number(m.sleep_duration) / 60).toFixed(1)) }))
  }, [data.metrics])

  // ============ RENDER ============

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
            <Skeleton style={{ height: 100 }} />
            <Skeleton style={{ height: 200 }} />
            <Skeleton style={{ height: 200 }} />
          </div>
        ) : (
          <>
            {/* ============ OVERVIEW ============ */}
            {activeTab === 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 'var(--space-md)' }}>
                {/* Stats Row */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  <div className={styles.statCard || ''} style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', padding: 16, textAlign: 'center' }}>
                    <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)' }}>{data.totalWorkouts}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Total Workouts</div>
                  </div>
                  <div style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', padding: 16, textAlign: 'center' }}>
                    <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--accent)' }}>{data.streak}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Day Streak</div>
                  </div>
                  <div style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', padding: 16, textAlign: 'center' }}>
                    <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)' }}>{data.topExercises.length}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Exercises</div>
                  </div>
                </div>

                {/* Body Part Distribution */}
                {bodyPartChartData.length > 0 && (
                  <ChartCard title="Body Part Distribution" categories={[]} onCategoryChange={() => {}}>
                    <BarChart data={bodyPartChartData} height={220} />
                  </ChartCard>
                )}

                {/* Top Exercises */}
                {data.topExercises.length > 0 && (
                  <div style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', padding: 16 }}>
                    <h3 style={{ margin: '0 0 12px', fontSize: 16, color: 'var(--text-primary)' }}>Top Exercises</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {data.topExercises.slice(0, 10).map(([name, count]: [string, number]) => (
                        <div key={name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ color: 'var(--text-primary)', fontSize: 14 }}>{name}</span>
                          <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{count} sessions</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {data.totalWorkouts === 0 && (
                  <EmptyState title="No workout data" message="Start logging workouts to see analytics." actionLabel="Start Workout" onAction={() => navigate('/workout')} />
                )}
              </div>
            )}

            {/* ============ HISTORY CHARTS ============ */}
            {activeTab === 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 'var(--space-md)' }}>
                <ChartCard
                  title="Workout History"
                  categories={['Frequency', 'Duration']}
                  selectedCategory={historyCategory}
                  onCategoryChange={setHistoryCategory}
                  dateRanges={['This Week', 'This Month', 'Last 90 Days', 'This Year']}
                  selectedDateRange={historyDateRange}
                  onDateRangeChange={setHistoryDateRange}
                >
                  {historyCategory === 'Frequency' ? (
                    frequencyChartData.length > 0 ? (
                      <BarChart data={frequencyChartData} height={260} />
                    ) : (
                      <EmptyState title="No data" message="Log workouts to see frequency." />
                    )
                  ) : (
                    durationChartData.length > 0 ? (
                      <BarChart data={durationChartData} height={260} />
                    ) : (
                      <EmptyState title="No data" message="Log workouts to see duration." />
                    )
                  )}
                </ChartCard>
              </div>
            )}

            {/* ============ METRICS (Weight, Steps, Sleep from Fitbit) ============ */}
            {activeTab === 2 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 'var(--space-md)' }}>
                <ChartCard
                  title="Health Metrics"
                  categories={['Weight', 'Steps', 'Sleep']}
                  selectedCategory={metricsCategory}
                  onCategoryChange={setMetricsCategory}
                  dateRanges={['Last 30 Days', 'Last 90 Days', 'This Year', 'All Time']}
                  selectedDateRange={metricsDateRange}
                  onDateRangeChange={setMetricsDateRange}
                >
                  {metricsCategory === 'Weight' ? (
                    weightChartData.length > 0 ? (
                      <LineChart data={weightChartData} height={260} />
                    ) : (
                      <EmptyState title="No weight data" message="Log your weight on the home page to see trends." />
                    )
                  ) : metricsCategory === 'Steps' ? (
                    stepsChartData.length > 0 ? (
                      <BarChart data={stepsChartData} height={260} />
                    ) : (
                      <EmptyState title="No steps data" message="Connect Fitbit to see step data." />
                    )
                  ) : (
                    sleepChartData.length > 0 ? (
                      <BarChart data={sleepChartData} height={260} />
                    ) : (
                      <EmptyState title="No sleep data" message="Connect Fitbit to see sleep data." />
                    )
                  )}
                </ChartCard>
              </div>
            )}

            {/* ============ TRENDS ============ */}
            {activeTab === 3 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 'var(--space-md)' }}>
                <ChartCard
                  title="Training Trends"
                  categories={['Volume', 'Frequency']}
                  selectedCategory={trendsCategory}
                  onCategoryChange={setTrendsCategory}
                  dateRanges={['Last 30 Days', 'Last 90 Days', 'This Year', 'All Time']}
                  selectedDateRange={trendsDateRange}
                  onDateRangeChange={setTrendsDateRange}
                >
                  {trendsCategory === 'Volume' ? (
                    volumeChartData.length > 0 ? (
                      <BarChart data={volumeChartData} height={260} />
                    ) : (
                      <EmptyState title="No volume data" message="Log strength workouts to see volume trends." />
                    )
                  ) : (
                    frequencyChartData.length > 0 ? (
                      <LineChart data={frequencyChartData} height={260} />
                    ) : (
                      <EmptyState title="No frequency data" message="Log workouts to see trends." />
                    )
                  )}
                </ChartCard>

                {/* Body Part Breakdown */}
                {Object.keys(data.bodyPartSets).length > 0 && (
                  <div style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', padding: 16 }}>
                    <h3 style={{ margin: '0 0 12px', fontSize: 16, color: 'var(--text-primary)' }}>Sets by Body Part (All Time)</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {Object.entries(data.bodyPartSets)
                        .sort((a, b) => b[1] - a[1])
                        .map(([part, sets]) => (
                          <div key={part} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ color: 'var(--text-primary)', fontSize: 14 }}>{part}</span>
                            <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{sets} sets &middot; {data.bodyPartReps[part] || 0} reps</span>
                          </div>
                        ))}
                    </div>
                  </div>
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
