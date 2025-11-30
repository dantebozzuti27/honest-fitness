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
  getDetailedBodyPartStats,
  deleteWorkoutFromSupabase,
  updateWorkoutInSupabase,
  saveMetricsToSupabase
} from '../lib/supabaseDb'
import { getAllTemplates } from '../db'
import BodyHeatmap from '../components/BodyHeatmap'
import LineChart from '../components/LineChart'
import BarChart from '../components/BarChart'
import styles from './Analytics.module.css'

const TABS = ['Scan', 'History', 'Metrics', 'Upcoming', 'Trends']
const DATE_FILTERS = [
  { label: 'This Week', type: 'week' },
  { label: 'This Month', type: 'month' },
  { label: 'Last 90 Days', type: 'days', days: 90 },
  { label: 'This Year', type: 'year' },
  { label: 'All Time', type: 'all' }
]
const METRIC_TYPES = ['Sessions', 'Total Reps', 'Total Sets']

export default function Analytics() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState(0)
  const [loading, setLoading] = useState(true)
  const [dateFilter, setDateFilter] = useState(1) // This Month default
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
  const [selectedWorkout, setSelectedWorkout] = useState(null)
  const [selectedBodyPart, setSelectedBodyPart] = useState(null)
  const [editingWorkout, setEditingWorkout] = useState(null)
  const [editingMetric, setEditingMetric] = useState(null)

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

    // Refresh on visibility change (when user comes back to tab)
    const handleVisibilityChange = () => {
      if (!document.hidden && user) {
        refreshData()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [user])

  const getTemplateName = (templateId) => {
    if (templateId === 'freestyle') return 'Freestyle'
    const tmpl = templates.find(t => t.id === templateId)
    return tmpl?.name || 'Workout'
  }

  const refreshData = async () => {
    if (!user) return
    setLoading(true)
    try {
      const [bodyParts, streak, metrics, scheduled, frequency, topExercises, workouts, detailedStats] = await Promise.all([
        getBodyPartStats(user.id),
        calculateStreakFromSupabase(user.id),
        getAllMetricsFromSupabase(user.id),
        getScheduledWorkoutsFromSupabase(user.id),
        getWorkoutFrequency(user.id, 30),
        getExerciseStats(user.id),
        getWorkoutsFromSupabase(user.id),
        getDetailedBodyPartStats(user.id)
      ])

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
    } catch (err) {
      console.error('Error refreshing data:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteWorkout = async (workoutId) => {
    if (!confirm('Are you sure you want to delete this workout?')) return
    try {
      await deleteWorkoutFromSupabase(workoutId)
      await refreshData()
      setSelectedWorkout(null)
    } catch (e) {
      console.error('Error deleting workout:', e)
      alert('Failed to delete workout')
    }
  }

  const handleEditWorkout = () => {
    setEditingWorkout(selectedWorkout)
  }

  const handleSaveWorkout = async () => {
    if (!editingWorkout || !user) return
    try {
      const workout = {
        date: editingWorkout.date,
        duration: editingWorkout.duration,
        templateName: editingWorkout.template_name || null,
        perceivedEffort: editingWorkout.perceived_effort || null,
        moodAfter: editingWorkout.mood_after || null,
        notes: editingWorkout.notes || null,
        dayOfWeek: editingWorkout.day_of_week ?? null,
        exercises: editingWorkout.workout_exercises.map(ex => ({
          name: ex.exercise_name,
          category: ex.category,
          bodyPart: ex.body_part,
          equipment: ex.equipment || '',
          sets: (ex.workout_sets || []).map(s => ({
            weight: s.weight,
            reps: s.reps,
            time: s.time,
            speed: s.speed,
            incline: s.incline
          }))
        }))
      }
      await updateWorkoutInSupabase(editingWorkout.id, workout, user.id)
      await refreshData()
      setEditingWorkout(null)
      setSelectedWorkout(null)
    } catch (e) {
      console.error('Error updating workout:', e)
      alert('Failed to update workout')
    }
  }

  const handleEditMetric = (metric) => {
    setEditingMetric({ ...metric })
  }

  const handleSaveMetric = async () => {
    if (!editingMetric || !user) return
    try {
      await saveMetricsToSupabase(user.id, editingMetric.date, {
        sleepScore: editingMetric.sleep_score,
        sleepTime: editingMetric.sleep_time,
        hrv: editingMetric.hrv,
        steps: editingMetric.steps,
        caloriesBurned: editingMetric.calories,
        weight: editingMetric.weight
      })
      await refreshData()
      setEditingMetric(null)
    } catch (e) {
      console.error('Error updating metric:', e)
      alert('Failed to update metric')
    }
  }

  const getBodyPartExercises = (bodyPart) => {
    // Group all exercises by exercise name
    const exerciseMap = {}
    
    data.workouts.forEach(w => {
      w.workout_exercises?.forEach(ex => {
        if (ex.body_part === bodyPart) {
          if (!exerciseMap[ex.exercise_name]) {
            exerciseMap[ex.exercise_name] = []
          }
          exerciseMap[ex.exercise_name].push({
            date: w.date,
            sets: ex.workout_sets || []
          })
        }
      })
    })
    
    // Convert to array and sort by most recent
    return Object.entries(exerciseMap)
      .map(([name, sessions]) => ({
        name,
        sessions: sessions.sort((a, b) => new Date(b.date) - new Date(a.date))
      }))
      .sort((a, b) => b.sessions.length - a.sessions.length) // Sort by frequency
  }

  // Filter workouts by date
  const filteredData = useMemo(() => {
    const filter = DATE_FILTERS[dateFilter]
    let cutoffDate = null
    
    if (filter.type === 'all') {
      // No filter
    } else if (filter.type === 'week') {
      // This week (Monday to Sunday)
      const today = new Date()
      const dayOfWeek = today.getDay()
      const monday = new Date(today)
      monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1))
      monday.setHours(0, 0, 0, 0)
      cutoffDate = monday.toISOString().split('T')[0]
    } else if (filter.type === 'month') {
      // This month
      const today = new Date()
      const firstDay = new Date(today.getFullYear(), today.getMonth(), 1)
      cutoffDate = firstDay.toISOString().split('T')[0]
    } else if (filter.type === 'year') {
      // This year
      const today = new Date()
      const firstDay = new Date(today.getFullYear(), 0, 1)
      cutoffDate = firstDay.toISOString().split('T')[0]
    } else if (filter.type === 'days' && filter.days) {
      // Last N days
      cutoffDate = new Date(Date.now() - filter.days * 86400000).toISOString().split('T')[0]
    }
    
    const filteredWorkouts = cutoffDate 
      ? data.workouts.filter(w => w.date >= cutoffDate)
      : data.workouts
    
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
          onDrillDown={(bp) => setSelectedBodyPart(bp)}
        />
      </div>
    )
  }

  const weeklyWorkoutData = useMemo(() => {
    const sortedWorkouts = [...data.workouts].sort((a, b) => new Date(a.date) - new Date(b.date))
    const weeks = {}
    sortedWorkouts.forEach(w => {
      const date = new Date(w.date + 'T12:00:00')
      const weekStart = new Date(date)
      weekStart.setDate(date.getDate() - date.getDay())
      const weekKey = weekStart.toISOString().split('T')[0]
      weeks[weekKey] = (weeks[weekKey] || 0) + 1
    })
    return weeks
  }, [data.workouts])

  const renderHistory = () => {
    const sortedWorkouts = [...data.workouts].sort((a, b) => new Date(a.date) - new Date(b.date))
    
    // Duration over time
    const durationData = sortedWorkouts.slice(-14).map(w => w.duration || 0)
    const durationLabels = sortedWorkouts.slice(-14).map(w => {
      const d = new Date(w.date + 'T12:00:00')
      return `${d.getMonth() + 1}/${d.getDate()}`
    })
    
    return (
      <div className={styles.historyContainer}>
        <h3 className={styles.sectionTitle}>Workout History</h3>
        
        {sortedWorkouts.length === 0 ? (
          <p className={styles.emptyText}>No workouts recorded yet</p>
        ) : (
          <>
            <div className={styles.chartSection}>
              <h4 className={styles.chartTitle}>Workouts Per Week</h4>
              <BarChart data={weeklyWorkoutData} height={180} />
            </div>
            
            <div className={styles.chartSection}>
              <h4 className={styles.chartTitle}>Workout Duration (Last 14 Days)</h4>
              <LineChart 
                data={durationData} 
                labels={durationLabels}
                height={200}
                color="#ff2d2d"
              />
            </div>
            
            <div className={styles.historyList}>
              {sortedWorkouts.slice().reverse().map(w => (
                <button 
                  key={w.id} 
                  className={styles.historyItem}
                  onClick={() => setSelectedWorkout(w)}
                >
                  <div className={styles.historyDate}>
                    <span className={styles.historyDay}>
                      {new Date(w.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' })}
                    </span>
                    <span className={styles.historyDateNum}>
                      {new Date(w.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                  <div className={styles.historyInfo}>
                    <span className={styles.historyExercises}>
                      {w.workout_exercises?.length || 0} exercises
                    </span>
                    <span className={styles.historyDuration}>
                      {Math.floor((w.duration || 0) / 60)}:{String((w.duration || 0) % 60).padStart(2, '0')}
                    </span>
                  </div>
                  <span className={styles.historyArrow}>→</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    )
  }

  const renderMetrics = () => {
    const recentMetrics = data.metrics.slice(-30).reverse()
    
    // Prepare chart data
    const weightData = recentMetrics.filter(m => m.weight).map(m => m.weight)
    const weightLabels = recentMetrics.filter(m => m.weight).map(m => {
      const d = new Date(m.date + 'T12:00:00')
      return `${d.getMonth() + 1}/${d.getDate()}`
    })
    
    const sleepData = recentMetrics.filter(m => m.sleep_score).map(m => m.sleep_score)
    const sleepLabels = recentMetrics.filter(m => m.sleep_score).map(m => {
      const d = new Date(m.date + 'T12:00:00')
      return `${d.getMonth() + 1}/${d.getDate()}`
    })
    
    const stepsData = recentMetrics.filter(m => m.steps).map(m => m.steps)
    const stepsLabels = recentMetrics.filter(m => m.steps).map(m => {
      const d = new Date(m.date + 'T12:00:00')
      return `${d.getMonth() + 1}/${d.getDate()}`
    })
    
    return (
      <div className={styles.metricsContainer}>
        <div className={styles.streakCard}>
          <span className={styles.streakNumber}>{data.streak}</span>
          <span className={styles.streakLabel}>Day Streak</span>
        </div>

        <h3 className={styles.sectionTitle}>Metrics Trends</h3>
        
        {recentMetrics.length === 0 ? (
          <p className={styles.emptyText}>No metrics recorded yet</p>
        ) : (
          <>
            {weightData.length > 0 && (
              <div className={styles.chartSection}>
                <h4 className={styles.chartTitle}>Weight (lbs)</h4>
                <LineChart 
                  data={weightData} 
                  labels={weightLabels}
                  height={200}
                  color="#4CAF50"
                />
              </div>
            )}
            
            {sleepData.length > 0 && (
              <div className={styles.chartSection}>
                <h4 className={styles.chartTitle}>Sleep Score</h4>
                <LineChart 
                  data={sleepData} 
                  labels={sleepLabels}
                  height={200}
                  color="#2196F3"
                />
              </div>
            )}
            
            {stepsData.length > 0 && (
              <div className={styles.chartSection}>
                <h4 className={styles.chartTitle}>Steps</h4>
                <LineChart 
                  data={stepsData} 
                  labels={stepsLabels}
                  height={200}
                  color="#FF9800"
                />
              </div>
            )}
            
            <h3 className={styles.sectionTitle}>Recent Metrics</h3>
            <div className={styles.metricsTable}>
              <div className={styles.metricsHeader}>
                <span>Date</span>
                <span>Weight</span>
                <span>Sleep</span>
                <span>Steps</span>
                <span></span>
              </div>
              {recentMetrics.slice(0, 14).map(m => (
                <div key={m.date} className={styles.metricsRow}>
                  <span>{new Date(m.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                  <span>{m.weight ? `${m.weight} lbs` : '-'}</span>
                  <span>{m.sleep_time ? `${m.sleep_time}h` : (m.sleep_score ? `${m.sleep_score}` : '-')}</span>
                  <span>{m.steps?.toLocaleString() || '-'}</span>
                  <button 
                    className={styles.editMetricBtn}
                    onClick={() => handleEditMetric(m)}
                  >
                    Edit
                  </button>
                </div>
              ))}
            </div>
          </>
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

        {Object.keys(frequencyChartData).length > 0 && (
          <div className={styles.chartSection}>
            <h4 className={styles.chartTitle}>Workout Frequency (Last 30 Days)</h4>
            <BarChart data={frequencyChartData} height={200} color="#ff2d2d" />
          </div>
        )}
        
        {Object.keys(volumeChartData).length > 0 && (
          <div className={styles.chartSection}>
            <h4 className={styles.chartTitle}>Training Volume (Sets Per Week)</h4>
            <BarChart data={volumeChartData} height={200} color="#9C27B0" />
          </div>
        )}

        {Object.keys(topExercisesChartData).length > 0 && (
          <div className={styles.chartSection}>
            <h4 className={styles.chartTitle}>Top Exercises</h4>
            <BarChart data={topExercisesChartData} height={200} color="#FF9800" />
          </div>
        )}

        <h3 className={styles.sectionTitle}>Top Exercises List</h3>
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
            {activeTab === 1 && renderHistory()}
            {activeTab === 2 && renderMetrics()}
            {activeTab === 3 && renderUpcoming()}
            {activeTab === 4 && renderTrends()}
          </>
        )}
      </div>

      {/* Workout Detail Modal */}
      {selectedWorkout && (
        <div className={styles.overlay} onClick={() => setSelectedWorkout(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>{new Date(selectedWorkout.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
              <button onClick={() => setSelectedWorkout(null)}>✕</button>
            </div>
            <div className={styles.workoutDetail}>
              <div className={styles.workoutMeta}>
                <span className={styles.workoutDuration}>
                  {Math.floor((selectedWorkout.duration || 0) / 60)}:{String((selectedWorkout.duration || 0) % 60).padStart(2, '0')}
                </span>
                {selectedWorkout.perceived_effort && (
                  <span className={styles.workoutRpe}>RPE: {selectedWorkout.perceived_effort}</span>
                )}
              </div>
              <div className={styles.exerciseList}>
                {(selectedWorkout.workout_exercises || []).map((ex, idx) => (
                  <div key={idx} className={styles.exerciseItem}>
                    <div className={styles.exerciseHeader}>
                      <span className={styles.exerciseName}>{ex.exercise_name}</span>
                      <span className={styles.exerciseBodyPart}>{ex.body_part}</span>
                    </div>
                    <div className={styles.exerciseSets}>
                      {(ex.workout_sets || []).map((s, i) => (
                        <span key={i} className={styles.setChip}>
                          {s.weight ? `${s.reps}×${s.weight} lbs` : (s.time ? `${s.time}` : '-')}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {selectedWorkout.notes && (
                <div className={styles.workoutNotes}>
                  <strong>Notes:</strong> {selectedWorkout.notes}
                </div>
              )}
              <div className={styles.workoutActions}>
                <button 
                  className={styles.editBtn} 
                  onClick={handleEditWorkout}
                >
                  Edit Workout
                </button>
                <button 
                  className={styles.deleteBtn} 
                  onClick={() => handleDeleteWorkout(selectedWorkout.id)}
                >
                  Delete Workout
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Workout Modal */}
      {editingWorkout && (
        <div className={styles.overlay} onClick={() => setEditingWorkout(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>Edit Workout</h2>
              <button onClick={() => setEditingWorkout(null)}>✕</button>
            </div>
            <div className={styles.editForm}>
              <div className={styles.formGroup}>
                <label>Date</label>
                <input
                  type="date"
                  value={editingWorkout.date}
                  onChange={(e) => setEditingWorkout({ ...editingWorkout, date: e.target.value })}
                />
              </div>
              <div className={styles.formGroup}>
                <label>Duration (seconds)</label>
                <input
                  type="number"
                  value={editingWorkout.duration || 0}
                  onChange={(e) => setEditingWorkout({ ...editingWorkout, duration: parseInt(e.target.value) || 0 })}
                />
              </div>
              <div className={styles.formGroup}>
                <label>RPE</label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={editingWorkout.perceived_effort || ''}
                  onChange={(e) => setEditingWorkout({ ...editingWorkout, perceived_effort: parseInt(e.target.value) || null })}
                />
              </div>
              <div className={styles.formGroup}>
                <label>Notes</label>
                <textarea
                  value={editingWorkout.notes || ''}
                  onChange={(e) => setEditingWorkout({ ...editingWorkout, notes: e.target.value })}
                  rows={3}
                />
              </div>
              <div className={styles.formActions}>
                <button className={styles.saveBtn} onClick={handleSaveWorkout}>
                  Save
                </button>
                <button className={styles.cancelBtn} onClick={() => setEditingWorkout(null)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Metric Modal */}
      {editingMetric && (
        <div className={styles.overlay} onClick={() => setEditingMetric(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>Edit Metric</h2>
              <button onClick={() => setEditingMetric(null)}>✕</button>
            </div>
            <div className={styles.editForm}>
              <div className={styles.formGroup}>
                <label>Date</label>
                <input
                  type="date"
                  value={editingMetric.date}
                  onChange={(e) => setEditingMetric({ ...editingMetric, date: e.target.value })}
                />
              </div>
              <div className={styles.formGroup}>
                <label>Weight (lbs)</label>
                <input
                  type="number"
                  value={editingMetric.weight || ''}
                  onChange={(e) => setEditingMetric({ ...editingMetric, weight: parseFloat(e.target.value) || null })}
                />
              </div>
              <div className={styles.formGroup}>
                <label>Sleep Time (hours)</label>
                <input
                  type="text"
                  value={editingMetric.sleep_time || ''}
                  onChange={(e) => setEditingMetric({ ...editingMetric, sleep_time: e.target.value })}
                  placeholder="7h 30m"
                />
              </div>
              <div className={styles.formGroup}>
                <label>Sleep Score</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={editingMetric.sleep_score || ''}
                  onChange={(e) => setEditingMetric({ ...editingMetric, sleep_score: parseInt(e.target.value) || null })}
                />
              </div>
              <div className={styles.formGroup}>
                <label>HRV (ms)</label>
                <input
                  type="number"
                  value={editingMetric.hrv || ''}
                  onChange={(e) => setEditingMetric({ ...editingMetric, hrv: parseInt(e.target.value) || null })}
                />
              </div>
              <div className={styles.formGroup}>
                <label>Steps</label>
                <input
                  type="number"
                  value={editingMetric.steps || ''}
                  onChange={(e) => setEditingMetric({ ...editingMetric, steps: parseInt(e.target.value) || null })}
                />
              </div>
              <div className={styles.formGroup}>
                <label>Calories</label>
                <input
                  type="number"
                  value={editingMetric.calories || ''}
                  onChange={(e) => setEditingMetric({ ...editingMetric, calories: parseInt(e.target.value) || null })}
                />
              </div>
              <div className={styles.formActions}>
                <button className={styles.saveBtn} onClick={handleSaveMetric}>
                  Save
                </button>
                <button className={styles.cancelBtn} onClick={() => setEditingMetric(null)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Body Part Drilldown Modal */}
      {selectedBodyPart && (
        <div className={styles.overlay} onClick={() => setSelectedBodyPart(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>{selectedBodyPart} History</h2>
              <button onClick={() => setSelectedBodyPart(null)}>✕</button>
            </div>
            <div className={styles.bodyPartDetail}>
              {getBodyPartExercises(selectedBodyPart).length === 0 ? (
                <p className={styles.emptyText}>No workouts for {selectedBodyPart}</p>
              ) : (
                <div className={styles.bodyPartList}>
                  {getBodyPartExercises(selectedBodyPart).map(exercise => (
                    <div key={exercise.name} className={styles.exerciseGroup}>
                      <div className={styles.exerciseGroupHeader}>
                        <span className={styles.exerciseGroupName}>{exercise.name}</span>
                        <span className={styles.exerciseGroupCount}>{exercise.sessions.length}x</span>
                      </div>
                      <div className={styles.exerciseSessions}>
                        {exercise.sessions.slice(0, 5).map((session, i) => (
                          <div key={i} className={styles.exerciseSession}>
                            <span className={styles.sessionDate}>
                              {new Date(session.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </span>
                            <div className={styles.sessionSets}>
                              {session.sets.map((s, j) => (
                                <span key={j} className={styles.setChip}>
                                  {s.weight ? `${s.reps}×${s.weight} lbs` : (s.time ? `${s.time}` : '-')}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                        {exercise.sessions.length > 5 && (
                          <span className={styles.moreSessions}>+{exercise.sessions.length - 5} more sessions</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
