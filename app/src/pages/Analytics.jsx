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
import { getReadinessScore } from '../lib/readiness'
import { getAllConnectedAccounts, getFitbitDaily, getMostRecentFitbitData } from '../lib/wearables'
import { getMealsFromSupabase, getNutritionRangeFromSupabase } from '../lib/nutritionDb'
import { getActiveGoalsFromSupabase } from '../lib/goalsDb'
import { getTodayEST } from '../utils/dateUtils'
import BodyHeatmap from '../components/BodyHeatmap'
// All charts are now BarChart only
import BarChart from '../components/BarChart'
import { getInsights } from '../lib/backend'
import { logError, logWarn } from '../utils/logger'
import styles from './Analytics.module.css'

const TABS = ['Overview', 'Scan', 'History', 'Metrics', 'Trends']
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
  const [historyChartType, setHistoryChartType] = useState('frequency') // 'frequency' or 'duration'
  const [metricsChartType, setMetricsChartType] = useState('weight') // 'weight', 'sleep', 'steps'
  const [trendsChartType, setTrendsChartType] = useState('frequency') // 'frequency', 'volume', 'exercises'
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
    workouts: [],
    readiness: null,
    fitbitData: null,
    nutrition: null,
    nutritionHistory: [],
    goals: []
  })
  const [templates, setTemplates] = useState([])
  const [selectedWorkout, setSelectedWorkout] = useState(null)
  const [selectedBodyPart, setSelectedBodyPart] = useState(null)
  const [editingWorkout, setEditingWorkout] = useState(null)
  const [editingMetric, setEditingMetric] = useState(null)
  const [mlInsights, setMlInsights] = useState(null)
  const [mlLoading, setMlLoading] = useState(false)

  useEffect(() => {
    async function loadData() {
      if (!user) return
      setLoading(true)

      try {
        const [bodyParts, streak, metrics, scheduled, frequency, topExercises, workouts, tmpl, detailedStats, readiness, connected, today, goals] = await Promise.all([
          getBodyPartStats(user.id),
          calculateStreakFromSupabase(user.id),
          getAllMetricsFromSupabase(user.id),
          getScheduledWorkoutsFromSupabase(user.id),
          getWorkoutFrequency(user.id, 30),
          getExerciseStats(user.id),
          getWorkoutsFromSupabase(user.id),
          getAllTemplates(),
          getDetailedBodyPartStats(user.id),
          getReadinessScore(user.id),
          getAllConnectedAccounts(user.id),
          Promise.resolve(getTodayEST()),
          getActiveGoalsFromSupabase(user.id)
        ])
        
        // Load Fitbit data
        let fitbitData = null
        const fitbitAccount = connected?.find(a => a.provider === 'fitbit')
        if (fitbitAccount) {
          try {
            fitbitData = await getFitbitDaily(user.id, today)
            if (!fitbitData) {
              const { getYesterdayEST } = await import('../utils/dateUtils')
              fitbitData = await getFitbitDaily(user.id, getYesterdayEST())
            }
            if (!fitbitData) {
              fitbitData = await getMostRecentFitbitData(user.id)
            }
          } catch (e) {
            // Fitbit data is optional
          }
        }
        
        // Load nutrition data
        let nutrition = null
        let nutritionHistory = []
        try {
          nutrition = await getMealsFromSupabase(user.id, today)
          const startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
          nutritionHistory = await getNutritionRangeFromSupabase(user.id, startDate, today)
        } catch (e) {
          // Nutrition data is optional
        }
        
        // Load ML insights in background
        loadMLInsights()

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
          workouts,
          readiness,
          fitbitData,
          nutrition,
          nutritionHistory,
          goals: goals || []
        })
        setTemplates(tmpl)
      } catch (err) {
        logError('Error loading analytics', err)
      } finally {
        setLoading(false)
      }
    }
    
    async function loadMLInsights() {
      if (!user) return
      setMlLoading(true)
      try {
        // Try to get ML insights from backend
        const insights = await getInsights(user.id)
        setMlInsights(insights)
      } catch (error) {
        // Backend might not be available, continue without ML insights
        logWarn('ML insights unavailable', error)
      } finally {
        setMlLoading(false)
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
      logError('Error refreshing data', err)
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
      logError('Error deleting workout', e)
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
      logError('Error updating workout', e)
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
        sleepScore: editingMetric.sleep_score != null ? Number(editingMetric.sleep_score) : null,
        sleepTime: editingMetric.sleep_time != null ? Number(editingMetric.sleep_time) : null,
        hrv: editingMetric.hrv != null ? Number(editingMetric.hrv) : null,
        steps: editingMetric.steps != null ? Math.round(Number(editingMetric.steps)) : null, // INTEGER - must be whole number
        caloriesBurned: editingMetric.calories != null ? Number(editingMetric.calories) : null,
        weight: editingMetric.weight != null ? Number(editingMetric.weight) : null
      })
      await refreshData()
      setEditingMetric(null)
    } catch (e) {
      logError('Error updating metric', e)
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

  const renderOverview = () => {
    return (
      <div className={styles.overviewContainer}>
        {/* ML Insights at Top */}
        {(mlInsights || mlLoading) && (
          <div className={styles.mlInsightsCard}>
            <h3 className={styles.mlInsightsTitle}>AI Health Insights</h3>
            {mlLoading ? (
              <p className={styles.mlLoadingText}>Analyzing your complete health picture...</p>
            ) : mlInsights?.insights && Array.isArray(mlInsights.insights) ? (
              <ul className={styles.mlInsightsList}>
                {mlInsights.insights.slice(0, 5).map((insight, i) => (
                  <li key={i} className={styles.mlInsightItem}>
                    {insight.message || insight.text || insight}
                  </li>
                ))}
              </ul>
            ) : mlInsights ? (
              <p className={styles.mlInsightText}>
                {typeof mlInsights === 'string' ? mlInsights : mlInsights.message || 'AI analysis available'}
              </p>
            ) : null}
          </div>
        )}

        {/* Readiness Score */}
        {data.readiness && (
          <div className={`${styles.readinessCard} ${styles[`readiness${data.readiness.zone}`]}`}>
            <div className={styles.readinessHeader}>
              <h2>Honest Readiness</h2>
              <span className={styles.readinessZone}>{data.readiness.zone.toUpperCase()}</span>
            </div>
            <div className={styles.readinessScore}>
              <span className={styles.readinessNumber}>{data.readiness.score}</span>
              <span className={styles.readinessLabel}>/ 100</span>
            </div>
          </div>
        )}

        {/* Combined Stats Grid */}
        <div className={styles.combinedStatsGrid}>
          <div className={styles.statCard}>
            <div className={styles.statValue}>{data.totalWorkouts}</div>
            <div className={styles.statLabel}>Workouts</div>
          </div>
          {data.nutrition && (
            <div className={styles.statCard}>
              <div className={styles.statValue}>{data.nutrition.calories || 0}</div>
              <div className={styles.statLabel}>Calories Today</div>
            </div>
          )}
          {data.fitbitData?.steps != null && (
            <div className={styles.statCard}>
              <div className={styles.statValue}>{Number(data.fitbitData.steps).toLocaleString()}</div>
              <div className={styles.statLabel}>Steps</div>
            </div>
          )}
          {data.fitbitData?.hrv != null && (
            <div className={styles.statCard}>
              <div className={styles.statValue}>{Math.round(Number(data.fitbitData.hrv))}</div>
              <div className={styles.statLabel}>HRV (ms)</div>
            </div>
          )}
          {data.fitbitData?.sleep_efficiency != null && (
            <div className={styles.statCard}>
              <div className={styles.statValue}>{Math.round(Number(data.fitbitData.sleep_efficiency))}%</div>
              <div className={styles.statLabel}>Sleep Quality</div>
            </div>
          )}
          {data.streak > 0 && (
            <div className={styles.statCard}>
              <div className={styles.statValue}>{data.streak}</div>
              <div className={styles.statLabel}>Day Streak</div>
            </div>
          )}
        </div>

        {/* Nutrition Summary */}
        {data.nutrition && data.nutrition.calories > 0 && (
          <div className={styles.nutritionCard}>
            <h3>Today's Nutrition</h3>
            <div className={styles.nutritionStats}>
              <div className={styles.nutritionItem}>
                <span className={styles.nutritionLabel}>Calories</span>
                <span className={styles.nutritionValue}>{data.nutrition.calories}</span>
              </div>
              {data.nutrition.macros && (
                <>
                  <div className={styles.nutritionItem}>
                    <span className={styles.nutritionLabel}>Protein</span>
                    <span className={styles.nutritionValue}>{Math.round(data.nutrition.macros.protein || 0)}g</span>
                  </div>
                  <div className={styles.nutritionItem}>
                    <span className={styles.nutritionLabel}>Carbs</span>
                    <span className={styles.nutritionValue}>{Math.round(data.nutrition.macros.carbs || 0)}g</span>
                  </div>
                  <div className={styles.nutritionItem}>
                    <span className={styles.nutritionLabel}>Fat</span>
                    <span className={styles.nutritionValue}>{Math.round(data.nutrition.macros.fat || 0)}g</span>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Goals Summary */}
        {data.goals && data.goals.length > 0 && (
          <div className={styles.goalsCard}>
            <div className={styles.goalsHeader}>
              <h3>Goals Progress</h3>
              <button
                className={styles.linkBtn}
                onClick={() => navigate('/goals')}
              >
                View All →
              </button>
            </div>
            <div className={styles.goalsList}>
              {data.goals.slice(0, 5).map(goal => {
                const progress = goal.target_value > 0 
                  ? Math.min(100, (goal.current_value / goal.target_value) * 100) 
                  : 0
                return (
                  <div key={goal.id} className={styles.goalItem}>
                    <div className={styles.goalInfo}>
                      <span className={styles.goalName}>
                        {goal.custom_name || goal.type}
                      </span>
                      <span className={styles.goalProgress}>
                        {Math.round(progress)}%
                      </span>
                    </div>
                    <div className={styles.goalBar}>
                      <div
                        className={styles.goalBarFill}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <div className={styles.goalValues}>
                      {goal.current_value} / {goal.target_value} {goal.unit}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Fitbit Summary */}
        {data.fitbitData && (
          <div className={styles.fitbitSummaryCard}>
            <h3>Health Metrics</h3>
            <div className={styles.fitbitSummaryGrid}>
              {data.fitbitData.steps != null && (
                <div className={styles.fitbitSummaryItem}>
                  <span className={styles.fitbitSummaryLabel}>Steps</span>
                  <span className={styles.fitbitSummaryValue}>{Number(data.fitbitData.steps).toLocaleString()}</span>
                </div>
              )}
              {data.fitbitData.calories != null && (
                <div className={styles.fitbitSummaryItem}>
                  <span className={styles.fitbitSummaryLabel}>Calories</span>
                  <span className={styles.fitbitSummaryValue}>{Number(data.fitbitData.calories).toLocaleString()}</span>
                </div>
              )}
              {data.fitbitData.hrv != null && (
                <div className={styles.fitbitSummaryItem}>
                  <span className={styles.fitbitSummaryLabel}>HRV</span>
                  <span className={styles.fitbitSummaryValue}>{Math.round(Number(data.fitbitData.hrv))} ms</span>
                </div>
              )}
              {data.fitbitData.resting_heart_rate != null && (
                <div className={styles.fitbitSummaryItem}>
                  <span className={styles.fitbitSummaryLabel}>Resting HR</span>
                  <span className={styles.fitbitSummaryValue}>{Math.round(Number(data.fitbitData.resting_heart_rate))} bpm</span>
                </div>
              )}
              {data.fitbitData.sleep_duration != null && (
                <div className={styles.fitbitSummaryItem}>
                  <span className={styles.fitbitSummaryLabel}>Sleep</span>
                  <span className={styles.fitbitSummaryValue}>
                    {Math.floor(Number(data.fitbitData.sleep_duration) / 60)}h {Math.round(Number(data.fitbitData.sleep_duration) % 60)}m
                  </span>
                </div>
              )}
              {data.fitbitData.sleep_efficiency != null && (
                <div className={styles.fitbitSummaryItem}>
                  <span className={styles.fitbitSummaryLabel}>Sleep Efficiency</span>
                  <span className={styles.fitbitSummaryValue}>{Math.round(Number(data.fitbitData.sleep_efficiency))}%</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Weekly Trends Chart */}
        {data.nutritionHistory && data.nutritionHistory.length > 0 && (() => {
          const weeklyData = data.nutritionHistory.slice(-7)
          const chartData = Object.fromEntries(
            weeklyData.map(item => {
              const date = new Date(item.date + 'T12:00:00')
              const label = `${date.getMonth() + 1}/${date.getDate()}`
              return [label, Number(item.calories) || 0]
            })
          )
          const chartLabels = weeklyData.map(item => {
            const date = new Date(item.date + 'T12:00:00')
            return `${date.getMonth() + 1}/${date.getDate()}`
          })
          
          return (
            <div className={styles.trendsCard}>
              <h3>Weekly Nutrition Trend</h3>
              <BarChart 
                data={chartData}
                labels={chartLabels}
                height={150}
                color="var(--text-primary)"
              />
            </div>
          )
        })()}
      </div>
    )
  }

  const renderBodyParts = () => {
    const bodyPartData = getBodyPartData()
    
    return (
      <div className={styles.heatmapContainer}>
        {/* ML Insights Section */}
        {(mlInsights || mlLoading) && (
          <div className={styles.mlInsightsCard}>
            <h3 className={styles.mlInsightsTitle}>AI Insights</h3>
            {mlLoading ? (
              <p className={styles.mlLoadingText}>Analyzing your data...</p>
            ) : mlInsights?.insights && Array.isArray(mlInsights.insights) ? (
              <ul className={styles.mlInsightsList}>
                {mlInsights.insights.slice(0, 5).map((insight, i) => (
                  <li key={i} className={styles.mlInsightItem}>
                    {insight.message || insight.text || insight}
                  </li>
                ))}
              </ul>
            ) : mlInsights ? (
              <p className={styles.mlInsightText}>
                {typeof mlInsights === 'string' ? mlInsights : mlInsights.message || 'AI analysis available'}
              </p>
            ) : null}
          </div>
        )}
        
        {/* Date Filters */}
        <div className={styles.chartTypeSelector}>
          {DATE_FILTERS.map((f, i) => (
            <button
              key={f.label}
              className={`${styles.chartTypeBtn} ${dateFilter === i ? styles.activeChartType : ''}`}
              onClick={() => setDateFilter(i)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Metric Type Filters */}
        <div className={styles.chartTypeSelector}>
          {METRIC_TYPES.map((m, i) => (
            <button
              key={m}
              className={`${styles.chartTypeBtn} ${metricType === i ? styles.activeChartType : ''}`}
              onClick={() => setMetricType(i)}
            >
              {m}
            </button>
          ))}
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

  const frequencyChartData = useMemo(() => {
    const sorted = Object.entries(data.frequency).sort((a, b) => a[0].localeCompare(b[0]))
    return Object.fromEntries(sorted.slice(-30))
  }, [data.frequency])
  
  const topExercisesChartData = useMemo(() => {
    return Object.fromEntries(data.topExercises.slice(0, 10))
  }, [data.topExercises])
  
  const volumeChartData = useMemo(() => {
    const weeks = {}
    data.workouts.forEach(w => {
      const date = new Date(w.date + 'T12:00:00')
      const weekStart = new Date(date)
      weekStart.setDate(date.getDate() - date.getDay())
      const weekKey = weekStart.toISOString().split('T')[0]
      const totalSets = w.workout_exercises?.reduce((sum, ex) => sum + (ex.workout_sets?.length || 0), 0) || 0
      weeks[weekKey] = (weeks[weekKey] || 0) + totalSets
    })
    return weeks
  }, [data.workouts])

  const renderHistory = () => {
    const sortedWorkouts = [...data.workouts].sort((a, b) => new Date(a.date) - new Date(b.date))
    
    // Duration over time
    const last14Workouts = sortedWorkouts.slice(-14)
    const durationData = last14Workouts.map(w => w.duration || 0)
    const durationLabels = last14Workouts.map(w => {
      const d = new Date(w.date + 'T12:00:00')
      return `${d.getMonth() + 1}/${d.getDate()}`
    })
    const durationDates = last14Workouts.map(w => w.date)
    const durationDateData = Object.fromEntries(last14Workouts.map(w => [w.date, w]))
    
    return (
      <div className={styles.historyContainer}>
        <h3 className={styles.sectionTitle}>Workout History</h3>
        
        {sortedWorkouts.length === 0 ? (
          <p className={styles.emptyText}>No workouts recorded yet</p>
        ) : (
          <>
            <div className={styles.chartTypeSelector}>
              <button
                className={`${styles.chartTypeBtn} ${historyChartType === 'frequency' ? styles.activeChartType : ''}`}
                onClick={() => setHistoryChartType('frequency')}
              >
                Frequency
              </button>
              <button
                className={`${styles.chartTypeBtn} ${historyChartType === 'duration' ? styles.activeChartType : ''}`}
                onClick={() => setHistoryChartType('duration')}
              >
                Duration
              </button>
            </div>
            
            <div className={styles.chartSection}>
              {historyChartType === 'frequency' && (
                <>
                  <h4 className={styles.chartTitle}>Workouts Per Week</h4>
                  <BarChart 
                    data={weeklyWorkoutData} 
                    labels={Object.keys(weeklyWorkoutData).map(k => {
                      const d = new Date(k + 'T12:00:00')
                      return `${d.getMonth() + 1}/${d.getDate()}`
                    })}
                    dates={Object.keys(weeklyWorkoutData)}
                    dateData={weeklyWorkoutData}
                    height={150}
                    color="#ff2d2d"
                    xAxisLabel="Week"
                    yAxisLabel="Workouts"
                  />
                </>
              )}
              {historyChartType === 'duration' && durationData.length > 0 && (
                <>
                  <h4 className={styles.chartTitle}>Workout Duration (Last 14 Days)</h4>
                  <BarChart 
                    data={Object.fromEntries(durationData.map((d, i) => [durationLabels[i], d]))} 
                    dates={durationDates}
                    dateData={durationDateData}
                    height={150} 
                    color="#ff2d2d"
                    xAxisLabel="Date"
                    yAxisLabel="Duration (min)"
                  />
                </>
              )}
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
    const weightMetrics = recentMetrics.filter(m => m.weight)
    const weightData = weightMetrics.map(m => m.weight)
    const weightLabels = weightMetrics.map(m => {
      const d = new Date(m.date + 'T12:00:00')
      return `${d.getMonth() + 1}/${d.getDate()}`
    })
    const weightDates = weightMetrics.map(m => m.date)
    const weightDateData = Object.fromEntries(weightMetrics.map(m => [m.date, m]))
    
    const sleepMetrics = recentMetrics.filter(m => m.sleep_score)
    const sleepData = sleepMetrics.map(m => m.sleep_score)
    const sleepLabels = sleepMetrics.map(m => {
      const d = new Date(m.date + 'T12:00:00')
      return `${d.getMonth() + 1}/${d.getDate()}`
    })
    const sleepDates = sleepMetrics.map(m => m.date)
    const sleepDateData = Object.fromEntries(sleepMetrics.map(m => [m.date, m]))
    
    const stepsMetrics = recentMetrics.filter(m => m.steps)
    const stepsData = stepsMetrics.map(m => m.steps)
    const stepsLabels = stepsMetrics.map(m => {
      const d = new Date(m.date + 'T12:00:00')
      return `${d.getMonth() + 1}/${d.getDate()}`
    })
    const stepsDates = stepsMetrics.map(m => m.date)
    const stepsDateData = Object.fromEntries(stepsMetrics.map(m => [m.date, m]))
    
    const hrvMetrics = recentMetrics.filter(m => m.hrv)
    const hrvData = hrvMetrics.map(m => m.hrv)
    const hrvLabels = hrvMetrics.map(m => {
      const d = new Date(m.date + 'T12:00:00')
      return `${d.getMonth() + 1}/${d.getDate()}`
    })
    const hrvDates = hrvMetrics.map(m => m.date)
    const hrvDateData = Object.fromEntries(hrvMetrics.map(m => [m.date, m]))
    
    const caloriesMetrics = recentMetrics.filter(m => m.calories)
    const caloriesData = caloriesMetrics.map(m => m.calories)
    const caloriesLabels = caloriesMetrics.map(m => {
      const d = new Date(m.date + 'T12:00:00')
      return `${d.getMonth() + 1}/${d.getDate()}`
    })
    const caloriesDates = caloriesMetrics.map(m => m.date)
    const caloriesDateData = Object.fromEntries(caloriesMetrics.map(m => [m.date, m]))
    
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
            <div className={styles.chartTypeSelector}>
              <button
                className={`${styles.chartTypeBtn} ${metricsChartType === 'weight' ? styles.activeChartType : ''}`}
                onClick={() => setMetricsChartType('weight')}
                disabled={weightData.length === 0}
              >
                Weight
              </button>
              <button
                className={`${styles.chartTypeBtn} ${metricsChartType === 'sleep' ? styles.activeChartType : ''}`}
                onClick={() => setMetricsChartType('sleep')}
                disabled={sleepData.length === 0}
              >
                Sleep
              </button>
              <button
                className={`${styles.chartTypeBtn} ${metricsChartType === 'steps' ? styles.activeChartType : ''}`}
                onClick={() => setMetricsChartType('steps')}
                disabled={stepsData.length === 0}
              >
                Steps
              </button>
              <button
                className={`${styles.chartTypeBtn} ${metricsChartType === 'hrv' ? styles.activeChartType : ''}`}
                onClick={() => setMetricsChartType('hrv')}
                disabled={hrvData.length === 0}
              >
                HRV
              </button>
              <button
                className={`${styles.chartTypeBtn} ${metricsChartType === 'calories' ? styles.activeChartType : ''}`}
                onClick={() => setMetricsChartType('calories')}
                disabled={caloriesData.length === 0}
              >
                Calories
              </button>
            </div>
            
            <div className={styles.chartSection}>
              {metricsChartType === 'weight' && weightData.length > 0 && (
                <>
                  <h4 className={styles.chartTitle}>Weight (lbs)</h4>
                  <BarChart 
                    data={Object.fromEntries(weightData.map((d, i) => [weightLabels[i], d]))} 
                    dates={weightDates}
                    dateData={weightDateData}
                    height={150} 
                    color="#ff2d2d"
                    xAxisLabel="Date"
                    yAxisLabel="Weight (lbs)"
                  />
                </>
              )}
              {metricsChartType === 'sleep' && sleepData.length > 0 && (
                <>
                  <h4 className={styles.chartTitle}>Sleep Score</h4>
                  <BarChart 
                    data={Object.fromEntries(sleepData.map((d, i) => [sleepLabels[i], d]))} 
                    dates={sleepDates}
                    dateData={sleepDateData}
                    height={150} 
                    color="#ff2d2d"
                    xAxisLabel="Date"
                    yAxisLabel="Score"
                  />
                </>
              )}
              {metricsChartType === 'steps' && stepsData.length > 0 && (
                <>
                  <h4 className={styles.chartTitle}>Steps</h4>
                  <BarChart 
                    data={Object.fromEntries(stepsData.map((d, i) => [stepsLabels[i], d]))} 
                    dates={stepsDates}
                    dateData={stepsDateData}
                    height={150} 
                    color="#ff2d2d"
                    xAxisLabel="Date"
                    yAxisLabel="Steps"
                  />
                </>
              )}
              {metricsChartType === 'hrv' && hrvData.length > 0 && (
                <>
                  <h4 className={styles.chartTitle}>HRV (ms)</h4>
                  <BarChart 
                    data={Object.fromEntries(hrvData.map((d, i) => [hrvLabels[i], d]))} 
                    dates={hrvDates}
                    dateData={hrvDateData}
                    height={150} 
                    color="#ff2d2d"
                    xAxisLabel="Date"
                    yAxisLabel="HRV (ms)"
                  />
                </>
              )}
              {metricsChartType === 'calories' && caloriesData.length > 0 && (
                <>
                  <h4 className={styles.chartTitle}>Calories</h4>
                  <BarChart 
                    data={Object.fromEntries(caloriesData.map((d, i) => [caloriesLabels[i], d]))}
                    dates={caloriesDates}
                    dateData={caloriesDateData} 
                    height={150} 
                    color="#ff2d2d"
                    xAxisLabel="Date"
                    yAxisLabel="Calories"
                  />
                </>
              )}
            </div>
            
            <h3 className={styles.sectionTitle}>Recent Metrics</h3>
            <div className={styles.metricsTable}>
              <div className={styles.metricsHeader}>
                <span>Date</span>
                <span>Weight</span>
                <span>Sleep</span>
                <span>Steps</span>
                <span>HRV</span>
                <span>Calories</span>
                <span></span>
              </div>
              {recentMetrics.slice(0, 14).map(m => (
                <div key={m.date} className={styles.metricsRow}>
                  <span>{new Date(m.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                  <span>{m.weight ? `${m.weight} lbs` : '-'}</span>
                  <span>{m.sleep_time ? `${m.sleep_time}h` : (m.sleep_score ? `${m.sleep_score}` : '-')}</span>
                  <span>{m.steps?.toLocaleString() || '-'}</span>
                  <span>{m.hrv ? `${m.hrv} ms` : '-'}</span>
                  <span>{m.calories?.toLocaleString() || '-'}</span>
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
    // Calculate real analytics from actual workout data
    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    
    const last30Days = data.workouts.filter(w => {
      const workoutDate = new Date(w.date + 'T12:00:00')
      return workoutDate >= thirtyDaysAgo
    }).length
    
    const avgPerWeek = last30Days > 0 ? Math.round((last30Days / 30) * 7 * 10) / 10 : 0
    
    // Calculate total volume (sets) in last 30 days
    const totalVolume = data.workouts
      .filter(w => {
        const workoutDate = new Date(w.date + 'T12:00:00')
        return workoutDate >= thirtyDaysAgo
      })
      .reduce((sum, w) => {
        return sum + (w.workout_exercises?.reduce((exSum, ex) => {
          return exSum + (ex.workout_sets?.length || 0)
        }, 0) || 0)
      }, 0)
    
    // Calculate average workout duration in last 30 days
    const recentWorkouts = data.workouts.filter(w => {
      const workoutDate = new Date(w.date + 'T12:00:00')
      return workoutDate >= thirtyDaysAgo && w.duration
    })
    const avgDuration = recentWorkouts.length > 0
      ? Math.round(recentWorkouts.reduce((sum, w) => sum + (w.duration || 0), 0) / recentWorkouts.length)
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
          {totalVolume > 0 && (
            <div className={styles.statCard}>
              <span className={styles.statNumber}>{totalVolume}</span>
              <span className={styles.statLabel}>Total Sets (30d)</span>
            </div>
          )}
          {avgDuration > 0 && (
            <div className={styles.statCard}>
              <span className={styles.statNumber}>{Math.floor(avgDuration / 60)}:{String(avgDuration % 60).padStart(2, '0')}</span>
              <span className={styles.statLabel}>Avg Duration</span>
            </div>
          )}
        </div>

        <div className={styles.chartTypeSelector}>
          <button
            className={`${styles.chartTypeBtn} ${trendsChartType === 'frequency' ? styles.activeChartType : ''}`}
            onClick={() => setTrendsChartType('frequency')}
            disabled={Object.keys(frequencyChartData).length === 0}
          >
            Frequency
          </button>
          <button
            className={`${styles.chartTypeBtn} ${trendsChartType === 'volume' ? styles.activeChartType : ''}`}
            onClick={() => setTrendsChartType('volume')}
            disabled={Object.keys(volumeChartData).length === 0}
          >
            Volume
          </button>
          <button
            className={`${styles.chartTypeBtn} ${trendsChartType === 'exercises' ? styles.activeChartType : ''}`}
            onClick={() => setTrendsChartType('exercises')}
            disabled={Object.keys(topExercisesChartData).length === 0}
          >
            Exercises
          </button>
        </div>
        
        <div className={styles.chartSection}>
          {trendsChartType === 'frequency' && Object.keys(frequencyChartData).length > 0 && (
            <>
              <h4 className={styles.chartTitle}>Workout Frequency (Last 30 Days)</h4>
              <BarChart 
                data={frequencyChartData} 
                labels={Object.keys(frequencyChartData).map(k => {
                  const d = new Date(k + 'T12:00:00')
                  return `${d.getMonth() + 1}/${d.getDate()}`
                })}
                dates={Object.keys(frequencyChartData)}
                dateData={frequencyChartData}
                height={150} 
                color="#ff2d2d"
                xAxisLabel="Date"
                yAxisLabel="Workouts"
              />
            </>
          )}
          {trendsChartType === 'volume' && Object.keys(volumeChartData).length > 0 && (
            <>
              <h4 className={styles.chartTitle}>Training Volume (Sets Per Week)</h4>
              <BarChart 
                data={volumeChartData} 
                labels={Object.keys(volumeChartData).map(k => {
                  const d = new Date(k + 'T12:00:00')
                  return `${d.getMonth() + 1}/${d.getDate()}`
                })}
                dates={Object.keys(volumeChartData)}
                dateData={volumeChartData}
                height={150} 
                color="#ff2d2d"
                xAxisLabel="Week"
                yAxisLabel="Sets"
              />
            </>
          )}
          {trendsChartType === 'exercises' && Object.keys(topExercisesChartData).length > 0 && (
            <>
              <h4 className={styles.chartTitle}>Top Exercises</h4>
              <BarChart 
                data={topExercisesChartData} 
                labels={Object.keys(topExercisesChartData)}
                height={150} 
                color="#ff2d2d"
                xAxisLabel="Exercise"
                yAxisLabel="Count"
              />
            </>
          )}
        </div>

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
            {activeTab === 0 && renderOverview()}
            {activeTab === 1 && renderBodyParts()}
            {activeTab === 2 && renderHistory()}
            {activeTab === 3 && renderMetrics()}
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
