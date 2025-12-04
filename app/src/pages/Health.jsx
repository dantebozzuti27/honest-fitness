import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getWorkoutsFromSupabase, getAllMetricsFromSupabase, saveMetricsToSupabase } from '../lib/supabaseDb'
import { getActiveGoalsFromSupabase } from '../lib/goalsDb'
import { getReadinessScore } from '../lib/readiness'
import { getAllConnectedAccounts, getFitbitDaily, syncFitbitData, mergeWearableDataToMetrics } from '../lib/wearables'
import { getTodayEST } from '../utils/dateUtils'
import { logError } from '../utils/logger'
// All charts are now BarChart only
import BarChart from '../components/BarChart'
import styles from './Health.module.css'

export default function Health() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [readiness, setReadiness] = useState(null)
  const [workouts, setWorkouts] = useState([])
  const [wearables, setWearables] = useState([])
  const [nutrition, setNutrition] = useState(null)
  const [fitbitData, setFitbitData] = useState(null)
  const [metrics, setMetrics] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedPeriod, setSelectedPeriod] = useState('week') // week, month, 90days
  const [editingMetric, setEditingMetric] = useState(null)
  const [healthGoals, setHealthGoals] = useState([])
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState(null)

  useEffect(() => {
    if (user) {
      loadAllData()
    }
  }, [user, selectedPeriod])

  const loadAllData = async () => {
    if (!user) return
    
    setLoading(true)
    try {
      // Load readiness score
      const readinessData = await getReadinessScore(user.id)
      setReadiness(readinessData)

      // Load workouts
      const allWorkouts = await getWorkoutsFromSupabase(user.id)
      const filteredWorkouts = filterByPeriod(allWorkouts)
      setWorkouts(filteredWorkouts)

      // Load wearables
      const connected = await getAllConnectedAccounts(user.id)
      setWearables(connected || [])
      
      // Load health goals
      const goals = await getActiveGoalsFromSupabase(user.id, 'health')
      setHealthGoals(goals)
      
      // Load Fitbit data (try today, then yesterday, then most recent)
      const fitbitAccount = connected?.find(a => a.provider === 'fitbit')
      if (fitbitAccount) {
        try {
          const today = getTodayEST()
          let fitbit = await getFitbitDaily(user.id, today)
          if (!fitbit) {
            // Try yesterday
            const { getYesterdayEST } = await import('../utils/dateUtils')
            const yesterday = getYesterdayEST()
            fitbit = await getFitbitDaily(user.id, yesterday)
          }
          // If still no data, get most recent
          if (!fitbit) {
            const { getMostRecentFitbitData } = await import('../lib/wearables')
            fitbit = await getMostRecentFitbitData(user.id)
          }
          if (fitbit) {
            setFitbitData(fitbit)
          } else {
            // Set to null so we can show the "no data" message
            setFitbitData(null)
                    }
                  } catch (fitbitError) {
                    logError('Error loading Fitbit data', fitbitError)
                  }
                }

                // Load nutrition data from Supabase
                try {
                  const { getMealsFromSupabase } = await import('../lib/nutritionDb')
                  const today = getTodayEST()
                  const nutritionData = await getMealsFromSupabase(user.id, today)
                  if (nutritionData) {
                    setNutrition({
                      calories: nutritionData.calories || 0,
                      macros: nutritionData.macros || { protein: 0, carbs: 0, fat: 0 },
                      water: nutritionData.water || 0
                    })
                  }
                } catch (error) {
                  logError('Error loading nutrition data', error)
                  // Fallback to localStorage
        const nutritionData = localStorage.getItem(`ghostMode_${user.id}`)
        if (nutritionData) {
          const parsed = JSON.parse(nutritionData)
          const todayData = parsed.historyData?.[getTodayEST()]
          if (todayData) {
            setNutrition({
              calories: todayData.calories || 0,
              macros: todayData.macros || { protein: 0, carbs: 0, fat: 0 },
              water: todayData.water || 0
            })
          }
        }
      }
      
      // Load metrics (only once)
      const allMetrics = await getAllMetricsFromSupabase(user.id)
      setMetrics(allMetrics || [])
    } catch (error) {
      // Silently fail - data will load on retry
    } finally {
      setLoading(false)
    }
  }

  const handleSyncFitbit = async () => {
    if (!user) return
    
    setSyncing(true)
    setSyncError(null)
    
    try {
      const today = getTodayEST()
      const result = await syncFitbitData(user.id, today)
      
      // Also sync yesterday to ensure we have recent data
      try {
        const { getYesterdayEST } = await import('../utils/dateUtils')
        const yesterday = getYesterdayEST()
        await syncFitbitData(user.id, yesterday)
      } catch (e) {
        // Yesterday sync is optional, continue
      }
      
      // Merge into daily_metrics
      await mergeWearableDataToMetrics(user.id, today)
      
      // Reload data to show updated Fitbit data
      await loadAllData()
      
      // Show success message briefly
      setTimeout(() => {
        setSyncError(null)
      }, 3000)
    } catch (error) {
      console.error('Fitbit sync error:', error)
      setSyncError(error.message || 'Failed to sync Fitbit data. Please try again or reconnect your account.')
    } finally {
      setSyncing(false)
    }
  }

  const filterByPeriod = (data) => {
    const now = new Date()
    const cutoff = new Date()
    
    switch (selectedPeriod) {
      case 'week':
        cutoff.setDate(now.getDate() - 7)
        break
      case 'month':
        cutoff.setMonth(now.getMonth() - 1)
        break
      case '90days':
        cutoff.setDate(now.getDate() - 90)
        break
      default:
        return data
    }
    
    return data.filter(item => {
      const itemDate = new Date(item.date || item.timestamp)
      return itemDate >= cutoff
    })
  }

  // Calculate health metrics (focused on health/wearable data only)
  const healthMetrics = useMemo(() => {
    const health = {
      hasWearables: wearables.length > 0,
      hasFitbitData: fitbitData !== null,
      avgHRV: 0,
      avgSleep: 0,
      avgRestingHR: 0
    }

    // Calculate averages from metrics
    if (metrics.length > 0) {
      const hrvValues = metrics.filter(m => m.hrv).map(m => Number(m.hrv))
      const sleepValues = metrics.filter(m => m.sleep_score).map(m => Number(m.sleep_score))
      const hrValues = metrics.filter(m => m.resting_heart_rate).map(m => Number(m.resting_heart_rate))
      
      if (hrvValues.length > 0) {
        health.avgHRV = Math.round(hrvValues.reduce((a, b) => a + b, 0) / hrvValues.length)
      }
      if (sleepValues.length > 0) {
        health.avgSleep = Math.round(sleepValues.reduce((a, b) => a + b, 0) / sleepValues.length)
      }
      if (hrValues.length > 0) {
        health.avgRestingHR = Math.round(hrValues.reduce((a, b) => a + b, 0) / hrValues.length)
      }
    }

    return health
  }, [wearables, fitbitData, metrics])

  // Weekly trends
  const weeklyTrends = useMemo(() => {
    const dates = []
    const readinessScores = []
    const calories = []
    const workouts = []

    for (let i = 6; i >= 0; i--) {
      const date = new Date()
      date.setDate(date.getDate() - i)
      const dateStr = date.toISOString().split('T')[0]
      dates.push(dateStr)

      // Get readiness for this date (would need to fetch from DB)
      readinessScores.push(0) // Placeholder
      calories.push(0) // Placeholder
      workouts.push(0) // Placeholder
    }

    return { dates, readinessScores, calories, workouts }
  }, [])

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading health data...</div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate('/')}>
          ← Back
        </button>
        <h1 className={styles.title}>Health Overview</h1>
        <div className={styles.periodSelector}>
          <select
            className={styles.periodSelect}
            value={selectedPeriod}
            onChange={(e) => setSelectedPeriod(e.target.value)}
          >
            <option value="week">Last 7 Days</option>
            <option value="month">Last 30 Days</option>
            <option value="90days">Last 90 Days</option>
          </select>
        </div>
      </div>

      <div className={styles.content}>
        {/* Readiness Score Card - Top Priority */}
        {readiness && (
          <div className={`${styles.readinessCard} ${styles[`readiness${readiness.zone}`]}`}>
            <div className={styles.readinessHeader}>
              <h2>Honest Readiness</h2>
              <span className={styles.readinessZone}>{readiness.zone.toUpperCase()}</span>
            </div>
            <div className={styles.readinessScore}>
              <span className={styles.readinessNumber}>{readiness.score}</span>
              <span className={styles.readinessLabel}>/ 100</span>
            </div>
            <div className={styles.readinessComponents}>
              <div className={styles.component}>
                <span className={styles.componentLabel}>Load</span>
                <span className={styles.componentValue}>
                  {readiness.ac_ratio !== undefined ? readiness.ac_ratio : 
                   readiness.components?.acRatio !== undefined ? readiness.components.acRatio : 'N/A'}
                </span>
              </div>
              <div className={styles.component}>
                <span className={styles.componentLabel}>HRV</span>
                <span className={styles.componentValue}>
                  {readiness.hrv_score !== undefined ? readiness.hrv_score : 
                   readiness.components?.hrvScore !== undefined ? readiness.components.hrvScore : 'N/A'}
                </span>
              </div>
              <div className={styles.component}>
                <span className={styles.componentLabel}>Sleep</span>
                <span className={styles.componentValue}>
                  {readiness.sleep_score !== undefined ? readiness.sleep_score : 
                   readiness.components?.sleepScore !== undefined ? readiness.components.sleepScore : 'N/A'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Fitbit Stats - Show at top */}
        {fitbitData ? (
          <div className={styles.fitbitCard}>
            <h3>Fitbit Data {fitbitData.date && fitbitData.date !== getTodayEST() ? `(${fitbitData.date})` : ''}</h3>
            <div className={styles.fitbitStatsGrid}>
              {fitbitData.steps != null && (
                <div className={styles.fitbitStatItem}>
                  <span className={styles.fitbitStatLabel}>Steps</span>
                  <span className={styles.fitbitStatValue}>{Number(fitbitData.steps).toLocaleString()}</span>
                </div>
              )}
              {fitbitData.calories != null && (
                <div className={styles.fitbitStatItem}>
                  <span className={styles.fitbitStatLabel}>Calories</span>
                  <span className={styles.fitbitStatValue}>{Number(fitbitData.calories).toLocaleString()}</span>
                </div>
              )}
              {fitbitData.active_calories != null && (
                <div className={styles.fitbitStatItem}>
                  <span className={styles.fitbitStatLabel}>Active Calories</span>
                  <span className={styles.fitbitStatValue}>{Number(fitbitData.active_calories).toLocaleString()}</span>
                </div>
              )}
              {fitbitData.sleep_duration != null && (
                <div className={styles.fitbitStatItem}>
                  <span className={styles.fitbitStatLabel}>Sleep</span>
                  <span className={styles.fitbitStatValue}>
                    {Math.floor(Number(fitbitData.sleep_duration) / 60)}h {Math.round(Number(fitbitData.sleep_duration) % 60)}m
                  </span>
                </div>
              )}
              {fitbitData.sleep_efficiency != null && (
                <div className={styles.fitbitStatItem}>
                  <span className={styles.fitbitStatLabel}>Sleep Efficiency</span>
                  <span className={styles.fitbitStatValue}>{Math.round(Number(fitbitData.sleep_efficiency))}%</span>
                </div>
              )}
              {fitbitData.hrv != null && (
                <div className={styles.fitbitStatItem}>
                  <span className={styles.fitbitStatLabel}>HRV</span>
                  <span className={styles.fitbitStatValue}>{Math.round(Number(fitbitData.hrv))} ms</span>
                </div>
              )}
              {fitbitData.resting_heart_rate != null && (
                <div className={styles.fitbitStatItem}>
                  <span className={styles.fitbitStatLabel}>Resting HR</span>
                  <span className={styles.fitbitStatValue}>{Math.round(Number(fitbitData.resting_heart_rate))} bpm</span>
                </div>
              )}
              {fitbitData.distance != null && (
                <div className={styles.fitbitStatItem}>
                  <span className={styles.fitbitStatLabel}>Distance</span>
                  <span className={styles.fitbitStatValue}>{Number(fitbitData.distance).toFixed(2)} km</span>
                </div>
              )}
              {fitbitData.floors != null && (
                <div className={styles.fitbitStatItem}>
                  <span className={styles.fitbitStatLabel}>Floors</span>
                  <span className={styles.fitbitStatValue}>{Number(fitbitData.floors)}</span>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className={styles.fitbitCard}>
            <h3>Fitbit Data</h3>
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)' }}>
              <p>No Fitbit data available. Connect your Fitbit and sync data to see your health metrics here.</p>
              <button
                className={styles.actionBtn}
                onClick={() => navigate('/wearables')}
                style={{ marginTop: '12px' }}
              >
                Connect Fitbit
              </button>
            </div>
          </div>
        )}

        {/* Sync Button - Show if Fitbit is connected */}
        {wearables.some(w => w.provider === 'fitbit') && (
          <div className={styles.fitbitCard}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h3 style={{ margin: 0 }}>Sync Fitbit Data</h3>
              <button
                className={styles.actionBtn}
                onClick={handleSyncFitbit}
                disabled={syncing}
                style={{ minWidth: '120px' }}
              >
                {syncing ? 'Syncing...' : 'Sync Now'}
              </button>
            </div>
            {syncError && (
              <div style={{ 
                padding: '12px', 
                marginTop: '12px', 
                backgroundColor: 'var(--bg-tertiary)', 
                borderRadius: '8px',
                color: 'var(--error)',
                fontSize: '14px'
              }}>
                {syncError}
              </div>
            )}
          </div>
        )}

        {/* Manual Logging Section */}
        <div className={styles.metricsCard}>
          <h3>Manual Logging</h3>
          <p className={styles.sectionNote}>Log metrics for any date (previous day recommended)</p>
          <div className={styles.manualLoggingGrid}>
            <button
              className={styles.actionBtn}
              onClick={() => {
                const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]
                setEditingMetric({
                  date: yesterday,
                  steps: null,
                  sleep_hours: null,
                  sleep_score: null,
                  hrv: null,
                  calories: null,
                  weight: null
                })
              }}
            >
              Log Previous Day
            </button>
          </div>
        </div>

        {/* Goals Section - Show actual goals */}
        {healthGoals.length > 0 && (
          <div className={styles.metricsCard}>
            <div className={styles.sectionHeader}>
              <h3>Health Goals</h3>
              <button
                className={styles.linkBtn}
                onClick={() => navigate('/goals')}
              >
                View All →
              </button>
            </div>
            <div className={styles.goalsList}>
              {healthGoals.slice(0, 3).map(goal => {
                const progress = goal.target_value > 0 
                  ? Math.min(100, (goal.current_value / goal.target_value) * 100) 
                  : 0
                return (
                  <div key={goal.id} className={styles.goalCard}>
                    <div className={styles.goalHeader}>
                      <span className={styles.goalName}>
                        {goal.custom_name || goal.type}
                      </span>
                      <span className={styles.goalProgress}>{Math.round(progress)}%</span>
                    </div>
                    <div className={styles.goalBar}>
                      <div className={styles.goalBarFill} style={{ width: `${progress}%` }} />
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

        {/* Metrics History */}
        <div className={styles.metricsCard}>
          <h3>Edit Past Metrics</h3>
          {metrics.length === 0 ? (
            <p className={styles.emptyText}>No metrics recorded yet</p>
          ) : (
            <div className={styles.metricsList}>
              {metrics.slice(-14).reverse().map(metric => (
                <button
                  key={metric.date}
                  className={styles.metricItem}
                  onClick={() => setEditingMetric({ ...metric })}
                >
                  <div className={styles.metricDate}>
                    {new Date(metric.date + 'T12:00:00').toLocaleDateString('en-US', { 
                      month: 'short', 
                      day: 'numeric',
                      year: metric.date !== getTodayEST() ? 'numeric' : undefined
                    })}
                  </div>
                  <div className={styles.metricValues}>
                    {metric.weight && <span>Weight: {metric.weight} lbs</span>}
                    {metric.steps && <span>Steps: {metric.steps.toLocaleString()}</span>}
                    {metric.hrv && <span>HRV: {metric.hrv} ms</span>}
                    {metric.calories && <span>Calories: {metric.calories.toLocaleString()}</span>}
                    {!metric.weight && !metric.steps && !metric.hrv && !metric.calories && (
                      <span className={styles.noData}>No data</span>
                    )}
                  </div>
                  <span className={styles.editIcon}>✎</span>
                </button>
              ))}
            </div>
          )}
        </div>


        {/* Quick Actions */}
        <div className={styles.actionsCard}>
          <h3>Quick Actions</h3>
          <div className={styles.actionsGrid}>
            <button
              className={styles.actionBtn}
              onClick={() => navigate('/fitness')}
            >
              Log Workout
            </button>
            <button
              className={styles.actionBtn}
              onClick={() => navigate('/nutrition')}
            >
              Log Meal
            </button>
            {!healthMetrics.hasWearables && (
              <button
                className={styles.actionBtn}
                onClick={() => navigate('/wearables')}
              >
                Connect Fitbit
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Edit Metric Modal */}
      {editingMetric && (
        <div className={styles.overlay} onClick={() => setEditingMetric(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>Edit Metric - {new Date(editingMetric.date + 'T12:00:00').toLocaleDateString()}</h2>
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
                  step="0.1"
                  value={editingMetric.weight || ''}
                  onChange={(e) => setEditingMetric({ ...editingMetric, weight: parseFloat(e.target.value) || null })}
                  placeholder="Enter weight"
                />
              </div>
              <div className={styles.formGroup}>
                <label>Steps</label>
                <input
                  type="number"
                  value={editingMetric.steps || ''}
                  onChange={(e) => setEditingMetric({ ...editingMetric, steps: parseInt(e.target.value) || null })}
                  placeholder="Enter steps"
                />
              </div>
              <div className={styles.formGroup}>
                <label>HRV (ms)</label>
                <input
                  type="number"
                  value={editingMetric.hrv || ''}
                  onChange={(e) => setEditingMetric({ ...editingMetric, hrv: parseInt(e.target.value) || null })}
                  placeholder="Enter HRV"
                />
              </div>
              <div className={styles.formGroup}>
                <label>Calories</label>
                <input
                  type="number"
                  value={editingMetric.calories || ''}
                  onChange={(e) => setEditingMetric({ ...editingMetric, calories: parseInt(e.target.value) || null })}
                  placeholder="Enter calories"
                />
              </div>
              <div className={styles.formGroup}>
                <label>Sleep Time</label>
                <input
                  type="text"
                  value={editingMetric.sleep_time || ''}
                  onChange={(e) => setEditingMetric({ ...editingMetric, sleep_time: e.target.value })}
                  placeholder="e.g., 7h 30m"
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
                  placeholder="0-100"
                />
              </div>
              <div className={styles.formActions}>
                <button 
                  className={styles.saveBtn} 
                  onClick={async () => {
                    if (!user) return
                    
                    // Validate inputs
                    const errors = []
                    if (editingMetric.weight !== null && editingMetric.weight !== undefined && editingMetric.weight !== '') {
                      const weightValidation = validateWeight(editingMetric.weight)
                      if (!weightValidation.valid) errors.push(`Weight: ${weightValidation.error}`)
                    }
                    if (editingMetric.steps !== null && editingMetric.steps !== undefined && editingMetric.steps !== '') {
                      const stepsValidation = validateSteps(editingMetric.steps)
                      if (!stepsValidation.valid) errors.push(`Steps: ${stepsValidation.error}`)
                    }
                    if (editingMetric.hrv !== null && editingMetric.hrv !== undefined && editingMetric.hrv !== '') {
                      const hrvValidation = validateHRV(editingMetric.hrv)
                      if (!hrvValidation.valid) errors.push(`HRV: ${hrvValidation.error}`)
                    }
                    if (editingMetric.calories !== null && editingMetric.calories !== undefined && editingMetric.calories !== '') {
                      const caloriesValidation = validateCalories(editingMetric.calories)
                      if (!caloriesValidation.valid) errors.push(`Calories: ${caloriesValidation.error}`)
                    }
                    if (editingMetric.sleep_score !== null && editingMetric.sleep_score !== undefined && editingMetric.sleep_score !== '') {
                      const sleepValidation = validateSleepScore(editingMetric.sleep_score)
                      if (!sleepValidation.valid) errors.push(`Sleep Score: ${sleepValidation.error}`)
                    }
                    
                    if (errors.length > 0) {
                      alert(errors.join('\n'))
                      return
                    }
                    
                    try {
                      await saveMetricsToSupabase(user.id, editingMetric.date, {
                        weight: editingMetric.weight,
                        steps: editingMetric.steps,
                        hrv: editingMetric.hrv,
                        caloriesBurned: editingMetric.calories,
                        sleepTime: editingMetric.sleep_time,
                        sleepScore: editingMetric.sleep_score
                      })
                      await loadAllData()
                      setEditingMetric(null)
                      alert('Metric updated successfully')
                    } catch (e) {
                      alert('Failed to update metric. Please try again.')
                    }
                  }}
                >
                  Save
                </button>
                <button 
                  className={styles.cancelBtn} 
                  onClick={() => setEditingMetric(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

