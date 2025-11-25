import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  getBodyPartStats,
  calculateStreakFromSupabase,
  getAllMetricsFromSupabase,
  getScheduledWorkoutsFromSupabase,
  getWorkoutFrequency,
  getExerciseStats,
  getWorkoutsFromSupabase,
  getDetailedBodyPartStats
} from '../lib/supabaseDb'
import { getAllTemplates } from '../db'
import BodyHeatmap from '../components/BodyHeatmap'
import styles from './Analytics.module.css'

const TABS = ['Body Parts', 'Metrics', 'Upcoming', 'Trends']
const DATE_FILTERS = [
  { label: '7 Days', days: 7 },
  { label: '30 Days', days: 30 },
  { label: '90 Days', days: 90 },
  { label: 'All Time', days: null }
]
const METRIC_TYPES = ['Sessions', 'Total Reps', 'Total Sets']

export default function Analytics() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState(0)
  const [loading, setLoading] = useState(true)
  const [dateFilter, setDateFilter] = useState(1) // 30 days default
  const [metricType, setMetricType] = useState(0) // Sessions default
  const [data, setData] = useState({
    bodyParts: {},
    bodyPartReps: {},
    bodyPartSets: {},
    detailedStats: {},
    streak: 0,
    metrics: [],
    scheduled: [],
    frequency: {},
    topExercises: [],
    totalWorkouts: 0,
    workouts: []
  })
  const [templates, setTemplates] = useState([])

  useEffect(() => {
    async function loadData() {
      if (!user) return
      setLoading(true)

      try {
        const [bodyParts, streak, metrics, scheduled, frequency, topExercises, workouts, tmpl, detailedStats] = await Promise.all([
          getBodyPartStats(user.id),
          calculateStreakFromSupabase(user.id),
          getAllMetricsFromSupabase(user.id),
          getScheduledWorkoutsFromSupabase(user.id),
          getWorkoutFrequency(user.id, 30),
          getExerciseStats(user.id),
          getWorkoutsFromSupabase(user.id),
          getAllTemplates(),
          getDetailedBodyPartStats(user.id)
        ])

        // Calculate reps and sets per body part
        const bodyPartReps = {}
        const bodyPartSets = {}
        workouts.forEach(w => {
          w.workout_exercises?.forEach(ex => {
            const bp = ex.body_part || 'Other'
            const sets = ex.workout_sets || []
            bodyPartSets[bp] = (bodyPartSets[bp] || 0) + sets.length
            sets.forEach(s => {
              if (s.reps) {
                bodyPartReps[bp] = (bodyPartReps[bp] || 0) + Number(s.reps)
              }
            })
          })
        })

        setData({
          bodyParts,
          bodyPartReps,
          bodyPartSets,
          detailedStats,
          streak,
          metrics,
          scheduled,
          frequency,
          topExercises,
          totalWorkouts: workouts.length,
          workouts
        })
        setTemplates(tmpl)
      } catch (err) {
        console.error('Error loading analytics:', err)
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [user])

  const getTemplateName = (templateId) => {
    if (templateId === 'freestyle') return 'Freestyle'
    const tmpl = templates.find(t => t.id === templateId)
    return tmpl?.name || 'Workout'
  }

  // Filter workouts by date
  const filteredData = useMemo(() => {
    const days = DATE_FILTERS[dateFilter].days
    if (!days) return data
    
    const cutoffDate = new Date(Date.now() - days * 86400000).toISOString().split('T')[0]
    const filteredWorkouts = data.workouts.filter(w => w.date >= cutoffDate)
    
    // Recalculate body part stats for filtered workouts
    const bodyParts = {}
    const bodyPartReps = {}
    const bodyPartSets = {}
    
    filteredWorkouts.forEach(w => {
      w.workout_exercises?.forEach(ex => {
        const bp = ex.body_part || 'Other'
        bodyParts[bp] = (bodyParts[bp] || 0) + 1
        const sets = ex.workout_sets || []
        bodyPartSets[bp] = (bodyPartSets[bp] || 0) + sets.length
        sets.forEach(s => {
          if (s.reps) {
            bodyPartReps[bp] = (bodyPartReps[bp] || 0) + Number(s.reps)
          }
        })
      })
    })
    
    return { ...data, bodyParts, bodyPartReps, bodyPartSets }
  }, [data, dateFilter])

  const getBodyPartData = () => {
    switch (metricType) {
      case 0: return filteredData.bodyParts // Sessions
      case 1: return filteredData.bodyPartReps // Total Reps
      case 2: return filteredData.bodyPartSets // Total Sets
      default: return filteredData.bodyParts
    }
  }

  const renderBodyParts = () => {
    const bodyPartData = getBodyPartData()
    
    return (
      <div className={styles.heatmapContainer}>
        {/* Date Filters */}
        <div className={styles.filterRow}>
          <span className={styles.filterLabel}>Time Period:</span>
          <div className={styles.filterButtons}>
            {DATE_FILTERS.map((f, i) => (
              <button
                key={f.label}
                className={`${styles.filterBtn} ${dateFilter === i ? styles.activeFilter : ''}`}
                onClick={() => setDateFilter(i)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Metric Type Filters */}
        <div className={styles.filterRow}>
          <span className={styles.filterLabel}>Show:</span>
          <div className={styles.filterButtons}>
            {METRIC_TYPES.map((m, i) => (
              <button
                key={m}
                className={`${styles.filterBtn} ${metricType === i ? styles.activeFilter : ''}`}
                onClick={() => setMetricType(i)}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <h3 className={styles.sectionTitle}>
          {METRIC_TYPES[metricType]} by Body Part
        </h3>
        
        {/* Body Heatmap */}
        <BodyHeatmap 
          data={bodyPartData} 
          metric={METRIC_TYPES[metricType]} 
          detailedStats={data.detailedStats}
        />
      </div>
    )
  }

  const renderMetrics = () => {
    const recentMetrics = data.metrics.slice(-14)
    
    return (
      <div className={styles.metricsContainer}>
        <div className={styles.streakCard}>
          <span className={styles.streakNumber}>{data.streak}</span>
          <span className={styles.streakLabel}>Day Streak</span>
        </div>

        <h3 className={styles.sectionTitle}>Recent Metrics</h3>
        
        {recentMetrics.length === 0 ? (
          <p className={styles.emptyText}>No metrics recorded yet</p>
        ) : (
          <div className={styles.metricsTable}>
            <div className={styles.metricsHeader}>
              <span>Date</span>
              <span>Weight</span>
              <span>Sleep</span>
              <span>Steps</span>
            </div>
            {recentMetrics.reverse().map(m => (
              <div key={m.date} className={styles.metricsRow}>
                <span>{new Date(m.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                <span>{m.weight ? `${m.weight} lbs` : '-'}</span>
                <span>{m.sleep_score || '-'}</span>
                <span>{m.steps?.toLocaleString() || '-'}</span>
              </div>
            ))}
          </div>
        )}

        {data.metrics.length > 1 && (
          <div className={styles.metricsSummary}>
            <h4>Weight Trend</h4>
            <div className={styles.miniChart}>
              {data.metrics.filter(m => m.weight).slice(-7).map((m, i) => {
                const weights = data.metrics.filter(x => x.weight).map(x => x.weight)
                const min = Math.min(...weights)
                const max = Math.max(...weights)
                const range = max - min || 1
                const height = ((m.weight - min) / range) * 60 + 20
                return (
                  <div 
                    key={i} 
                    className={styles.miniBar}
                    style={{ height: `${height}%` }}
                    title={`${m.weight} lbs`}
                  />
                )
              })}
            </div>
          </div>
        )}
      </div>
    )
  }

  const renderUpcoming = () => {
    return (
      <div className={styles.upcomingContainer}>
        <h3 className={styles.sectionTitle}>Scheduled Workouts</h3>
        
        {data.scheduled.length === 0 ? (
          <div className={styles.emptyState}>
            <p className={styles.emptyText}>No upcoming workouts scheduled</p>
            <button className={styles.scheduleBtn} onClick={() => navigate('/calendar')}>
              Schedule a Workout
            </button>
          </div>
        ) : (
          <div className={styles.upcomingList}>
            {data.scheduled.map(s => (
              <div key={s.id} className={styles.upcomingItem}>
                <div className={styles.upcomingDate}>
                  <span className={styles.upcomingDay}>
                    {new Date(s.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' })}
                  </span>
                  <span className={styles.upcomingDateNum}>
                    {new Date(s.date + 'T12:00:00').getDate()}
                  </span>
                </div>
                <span className={styles.upcomingName}>{getTemplateName(s.template_id)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  const renderTrends = () => {
    const last30Days = Object.keys(data.frequency).length
    const avgPerWeek = data.totalWorkouts > 0 
      ? ((last30Days / 30) * 7).toFixed(1) 
      : 0

    return (
      <div className={styles.trendsContainer}>
        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <span className={styles.statNumber}>{data.totalWorkouts}</span>
            <span className={styles.statLabel}>Total Workouts</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statNumber}>{last30Days}</span>
            <span className={styles.statLabel}>Last 30 Days</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statNumber}>{avgPerWeek}</span>
            <span className={styles.statLabel}>Avg/Week</span>
          </div>
        </div>

        <h3 className={styles.sectionTitle}>Top Exercises</h3>
        {data.topExercises.length === 0 ? (
          <p className={styles.emptyText}>Complete workouts to see your top exercises</p>
        ) : (
          <div className={styles.topExercises}>
            {data.topExercises.map(([name, count], i) => (
              <div key={name} className={styles.exerciseRow}>
                <span className={styles.exerciseRank}>{i + 1}</span>
                <span className={styles.exerciseName}>{name}</span>
                <span className={styles.exerciseCount}>{count}x</span>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate('/')}>
          ← Back
        </button>
        <h1 className={styles.title}>Analytics</h1>
      </header>

      <div className={styles.tabs}>
        {TABS.map((tab, i) => (
          <button
            key={tab}
            className={`${styles.tab} ${activeTab === i ? styles.activeTab : ''}`}
            onClick={() => setActiveTab(i)}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className={styles.content}>
        {loading ? (
          <div className={styles.loading}>Loading...</div>
        ) : (
          <>
            {activeTab === 0 && renderBodyParts()}
            {activeTab === 1 && renderMetrics()}
            {activeTab === 2 && renderUpcoming()}
            {activeTab === 3 && renderTrends()}
          </>
        )}
      </div>
    </div>
  )
}
