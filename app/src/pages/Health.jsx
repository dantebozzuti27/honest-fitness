import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getWorkoutsFromSupabase, getAllMetricsFromSupabase, saveMetricsToSupabase } from '../lib/supabaseDb'
import { toInteger, toNumber } from '../utils/numberUtils'
import { getActiveGoalsFromSupabase } from '../lib/goalsDb'
import { getReadinessScore } from '../lib/readiness'
import { getAllConnectedAccounts, getFitbitDaily, syncFitbitData, mergeWearableDataToMetrics } from '../lib/wearables'
import { supabase } from '../lib/supabase'
import { getTodayEST } from '../utils/dateUtils'
import { logError, logDebug } from '../utils/logger'
// All charts are now BarChart only
import BarChart from '../components/BarChart'
import Toast from '../components/Toast'
import { useToast } from '../hooks/useToast'
import ShareModal from '../components/ShareModal'
import BottomNav from '../components/BottomNav'
import ProfileButton from '../components/ProfileButton'
import styles from './Health.module.css'

const TABS = ['Today', 'History', 'Log', 'Goals']

export default function Health() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState('Today')
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
  const [showLogModal, setShowLogModal] = useState(false)
  const [showShareModal, setShowShareModal] = useState(false)
  const { toast, showToast, hideToast } = useToast()

  const loadHealthGoals = async () => {
    if (!user) return
    try {
      const goals = await getActiveGoalsFromSupabase(user.id, 'health')
      setHealthGoals(goals)
    } catch (error) {
      // Silently fail
    }
  }

  useEffect(() => {
    if (user) {
      loadAllData()
    }
  }, [user, selectedPeriod])

  // Refresh goals when page becomes visible or when navigating back from Goals page
  useEffect(() => {
    if (!user) return
    loadHealthGoals()
  }, [user, location.key])

  useEffect(() => {
    if (!user) return
    
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        loadHealthGoals()
      }
    }
    
    document.addEventListener('visibilitychange', handleVisibilityChange)
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [user])

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
      await loadHealthGoals()
      
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
      
      // Load metrics and merge with Fitbit data
      const allMetrics = await getAllMetricsFromSupabase(user.id)
      
      // If Fitbit is connected, load all Fitbit data and merge/create metrics
      if (fitbitAccount) {
        try {
          const { getFitbitDaily } = await import('../lib/wearables')
          const { supabase } = await import('../lib/supabase')
          
          // Get all Fitbit data for the selected period
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
              cutoff.setDate(now.getDate() - 7)
          }
          
          // Get all Fitbit data for the period
          const { data: fitbitDataList, error: fitbitError } = await (await import('../lib/supabase')).supabase
            .from('fitbit_daily')
            .select('*')
            .eq('user_id', user.id)
            .gte('date', cutoff.toISOString().split('T')[0])
            .order('date', { ascending: false })
          
          if (!fitbitError && fitbitDataList) {
            // Create a map of metrics by date
            const metricsMap = new Map()
            if (allMetrics) {
              allMetrics.forEach(m => metricsMap.set(m.date, m))
            }
            
            // Merge Fitbit data into metrics or create new entries
            const mergedMetrics = []
            const processedDates = new Set()
            
            // First, process existing metrics and merge with Fitbit data
            if (allMetrics) {
              for (const metric of allMetrics) {
                const fitbitData = fitbitDataList.find(f => f.date === metric.date)
                if (fitbitData) {
                  mergedMetrics.push({
                    ...metric,
                    steps: fitbitData.steps ?? metric.steps,
                    hrv: fitbitData.hrv ?? metric.hrv,
                    calories_burned: fitbitData.calories || fitbitData.active_calories || metric.calories_burned || metric.calories || null,
                    sleep_time: fitbitData.sleep_duration ?? metric.sleep_time,
                    sleep_score: fitbitData.sleep_efficiency ? Math.round(fitbitData.sleep_efficiency) : (metric.sleep_score ?? null),
                    resting_heart_rate: fitbitData.resting_heart_rate ?? metric.resting_heart_rate
                  })
                } else {
                  mergedMetrics.push(metric)
                }
                processedDates.add(metric.date)
              }
            }
            
            // Then, add Fitbit-only dates as new metric entries
            for (const fitbitData of fitbitDataList) {
              if (!processedDates.has(fitbitData.date)) {
                mergedMetrics.push({
                  user_id: user.id,
                  date: fitbitData.date,
                  steps: fitbitData.steps ?? null,
                  hrv: fitbitData.hrv ?? null,
                  calories_burned: fitbitData.calories || fitbitData.active_calories || null,
                  sleep_time: fitbitData.sleep_duration ?? null,
                  sleep_score: fitbitData.sleep_efficiency ? Math.round(fitbitData.sleep_efficiency) : null,
                  resting_heart_rate: fitbitData.resting_heart_rate ?? null,
                  weight: null,
                  body_temp: null
                })
              }
            }
            
            // Sort by date descending (newest first)
            mergedMetrics.sort((a, b) => {
              const dateA = new Date(a.date)
              const dateB = new Date(b.date)
              return dateB - dateA
            })
            setMetrics(mergedMetrics)
          } else {
            // If Fitbit query fails, just use regular metrics
            setMetrics(allMetrics || [])
          }
        } catch (fitbitError) {
          // If Fitbit merge fails, just use regular metrics
          logError('Error merging Fitbit data into metrics', fitbitError)
          setMetrics(allMetrics || [])
        }
      } else {
        setMetrics(allMetrics || [])
      }
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
      
      showToast('Fitbit data synced successfully!', 'success')
    } catch (error) {
      logError('Fitbit sync error', error)
      // Don't show error toast for sync errors - they're expected if account isn't connected
      // Only show if it's a critical error
      const errorMsg = error.message || 'Failed to sync Fitbit data. Please try again or reconnect your account.'
      if (!errorMsg.includes('not connected') && !errorMsg.includes('not found')) {
        showToast(errorMsg, 'error')
      }
      setSyncError(errorMsg)
      showToast(errorMsg, 'error')
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
          Back
        </button>
        <h1>Health</h1>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {activeTab === 'Today' && (
            <button 
              className={styles.plusBtn}
              onClick={() => {
                const newMetric = {
                  date: getTodayEST(),
                  steps: null,
                  sleep_time: null,
                  sleep_score: null,
                  hrv: null,
                  calories: null,
                  weight: null,
                  resting_heart_rate: null,
                  body_temp: null
                }
                setEditingMetric(newMetric)
                setShowLogModal(true)
              }}
              aria-label="Log health metrics"
            >
              <span className={styles.plusIcon}>+</span>
            </button>
          )}
          <ProfileButton />
        </div>
      </div>

      <div className={styles.tabs}>
        {TABS.map(tab => (
          <button
            key={tab}
            className={`${styles.tab} ${activeTab === tab ? styles.activeTab : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className={styles.content}>
        {activeTab === 'Today' && (() => {
          const todayMetric = metrics.find(m => m.date === getTodayEST()) || {
            date: getTodayEST(),
            steps: null,
            sleep_time: null,
            sleep_score: null,
            hrv: null,
            calories: null,
            weight: null,
            resting_heart_rate: null,
            body_temp: null
          }
          
          return (
            <div className={styles.dashboardContainer}>
              {/* Share Button */}
              {todayMetric && (todayMetric.steps || todayMetric.hrv || todayMetric.sleep_time || todayMetric.calories_burned || todayMetric.weight) && (
                <button
                  className={styles.shareBtn}
                  onClick={() => setShowShareModal(true)}
                >
                  📤 Share Health Summary
                </button>
              )}
              
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

              {/* Dashboard Grid - Individual Metric Cards */}
              <div className={styles.dashboardGrid}>
                {/* Steps Card */}
                <div 
                  className={styles.dashboardCard}
                  onClick={() => {
                    setEditingMetric({ ...todayMetric })
                    setShowLogModal(true)
                  }}
                >
                  <div className={styles.dashboardStat}>
                    <span className={styles.dashboardStatLabel}>Steps</span>
                    <span className={styles.dashboardStatValue}>
                      {fitbitData?.steps != null 
                        ? Number(fitbitData.steps).toLocaleString()
                        : todayMetric?.steps != null
                        ? Number(todayMetric.steps).toLocaleString()
                        : '-'}
                    </span>
                  </div>
                  <button className={styles.dashboardLogBtn} onClick={(e) => { e.stopPropagation(); setEditingMetric({ ...todayMetric }); setShowLogModal(true); }}>Log</button>
                </div>

                {/* Calories Card */}
                <div 
                  className={styles.dashboardCard}
                  onClick={() => {
                    setEditingMetric({ ...todayMetric })
                    setShowLogModal(true)
                  }}
                >
                  <div className={styles.dashboardStat}>
                    <span className={styles.dashboardStatLabel}>Calories</span>
                    <span className={styles.dashboardStatValue}>
                      {fitbitData?.calories != null 
                        ? Number(fitbitData.calories).toLocaleString()
                        : todayMetric?.calories_burned != null
                        ? Number(todayMetric.calories_burned).toLocaleString()
                        : '-'}
                    </span>
                  </div>
                  <button className={styles.dashboardLogBtn} onClick={(e) => { e.stopPropagation(); setEditingMetric({ ...todayMetric }); setShowLogModal(true); }}>Log</button>
                </div>

                {/* HRV Card */}
                <div 
                  className={styles.dashboardCard}
                  onClick={() => {
                    setEditingMetric({ ...todayMetric })
                    setShowLogModal(true)
                  }}
                >
                  <div className={styles.dashboardStat}>
                    <span className={styles.dashboardStatLabel}>HRV</span>
                    <span className={styles.dashboardStatValue}>
                      {fitbitData?.hrv != null 
                        ? `${Math.round(Number(fitbitData.hrv))} ms`
                        : todayMetric?.hrv != null
                        ? `${Math.round(Number(todayMetric.hrv))} ms`
                        : '-'}
                    </span>
                  </div>
                  <button className={styles.dashboardLogBtn} onClick={(e) => { e.stopPropagation(); setEditingMetric({ ...todayMetric }); setShowLogModal(true); }}>Log</button>
                </div>

                {/* Sleep Card */}
                <div 
                  className={styles.dashboardCard}
                  onClick={() => {
                    setEditingMetric({ ...todayMetric })
                    setShowLogModal(true)
                  }}
                >
                  <div className={styles.dashboardStat}>
                    <span className={styles.dashboardStatLabel}>Sleep</span>
                    <span className={styles.dashboardStatValue}>
                      {(() => {
                        const sleepMinutes = fitbitData?.sleep_duration != null 
                          ? Number(fitbitData.sleep_duration)
                          : todayMetric?.sleep_time != null
                          ? Number(todayMetric.sleep_time)
                          : null
                        
                        if (sleepMinutes == null) return '-'
                        
                        const hours = Math.floor(sleepMinutes / 60)
                        const minutes = Math.round(sleepMinutes % 60)
                        return `${hours}:${minutes.toString().padStart(2, '0')}`
                      })()}
                    </span>
                  </div>
                  <button className={styles.dashboardLogBtn} onClick={(e) => { e.stopPropagation(); setEditingMetric({ ...todayMetric }); setShowLogModal(true); }}>Log</button>
                </div>

                {/* Weight Card */}
                <div 
                  className={styles.dashboardCard}
                  onClick={() => {
                    setEditingMetric({ ...todayMetric })
                    setShowLogModal(true)
                  }}
                >
                  <div className={styles.dashboardStat}>
                    <span className={styles.dashboardStatLabel}>Weight</span>
                    <span className={styles.dashboardStatValue}>
                      {todayMetric?.weight != null 
                        ? `${todayMetric.weight} lbs`
                        : '-'}
                    </span>
                  </div>
                  <button className={styles.dashboardLogBtn} onClick={(e) => { e.stopPropagation(); setEditingMetric({ ...todayMetric }); setShowLogModal(true); }}>Log</button>
                </div>

                {/* Resting HR Card */}
                <div 
                  className={styles.dashboardCard}
                  onClick={() => {
                    setEditingMetric({ ...todayMetric })
                    setShowLogModal(true)
                  }}
                >
                  <div className={styles.dashboardStat}>
                    <span className={styles.dashboardStatLabel}>Resting HR</span>
                    <span className={styles.dashboardStatValue}>
                      {fitbitData?.resting_heart_rate != null 
                        ? `${Math.round(Number(fitbitData.resting_heart_rate))} bpm`
                        : todayMetric?.resting_heart_rate != null
                        ? `${Math.round(Number(todayMetric.resting_heart_rate))} bpm`
                        : '-'}
                    </span>
                  </div>
                  <button className={styles.dashboardLogBtn} onClick={(e) => { e.stopPropagation(); setEditingMetric({ ...todayMetric }); setShowLogModal(true); }}>Log</button>
                </div>
              </div>

              {/* Sync Button - Show if Fitbit is connected */}
              {wearables.some(w => w.provider === 'fitbit') && (
                <div className={styles.syncCard}>
                  <div className={styles.syncHeader}>
                    <h3>Fitbit Sync</h3>
                    <button
                      className={styles.actionBtn}
                      onClick={handleSyncFitbit}
                      disabled={syncing}
                    >
                      {syncing ? 'Syncing...' : 'Sync Now'}
                    </button>
                  </div>
                  {syncError && (
                    <div className={styles.syncError}>
                      {syncError}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })()}

        {activeTab === 'History' && (
          <div>
            <div className={styles.metricsCard}>
              <div className={styles.sectionHeader}>
                <h3>Health Metrics History</h3>
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
              {metrics.length === 0 ? (
                <div className={styles.emptyState}>
                  <p className={styles.emptyText}>No metrics recorded yet</p>
                  <button
                    className={styles.actionBtn}
                    onClick={() => {
                      const newMetric = {
                        date: getTodayEST(),
                        steps: null,
                        sleep_time: null,
                        sleep_score: null,
                        hrv: null,
                        calories: null,
                        weight: null,
                        resting_heart_rate: null,
                        body_temp: null
                      }
                      setEditingMetric(newMetric)
                      setShowLogModal(true)
                    }}
                    style={{ marginTop: '12px' }}
                  >
                    Log Metrics
                  </button>
                </div>
              ) : (
                <div className={styles.historyTable}>
                  <div className={styles.historyTableHeader}>
                    <div className={styles.historyTableCol}>Date</div>
                    <div className={styles.historyTableCol}>Weight</div>
                    <div className={styles.historyTableCol}>Steps</div>
                    <div className={styles.historyTableCol}>HRV</div>
                    <div className={styles.historyTableCol}>Calories</div>
                    <div className={styles.historyTableCol}>Sleep</div>
                    <div className={styles.historyTableCol}>Actions</div>
                  </div>
                  <div className={styles.historyTableBody}>
                    {metrics
                      .slice(0, 14)
                      .map(metric => {
                        // Check if metric has any data (Fitbit or manual)
                        const hasData = metric.steps || metric.hrv || metric.calories_burned || metric.calories || metric.sleep_score || metric.weight
                        return (
                          <div
                            key={metric.date}
                            className={styles.historyTableRow}
                            onClick={() => {
                              setEditingMetric({ ...metric })
                              setShowLogModal(true)
                            }}
                          >
                            <div className={styles.historyTableCol}>
                              {new Date(metric.date + 'T12:00:00').toLocaleDateString('en-US', { 
                                month: 'short', 
                                day: 'numeric',
                                year: metric.date !== getTodayEST() ? 'numeric' : undefined
                              })}
                            </div>
                            <div className={styles.historyTableCol}>
                              {metric.weight ? `${metric.weight} lbs` : '-'}
                            </div>
                            <div className={styles.historyTableCol}>
                              {metric.steps ? metric.steps.toLocaleString() : '-'}
                            </div>
                            <div className={styles.historyTableCol}>
                              {metric.hrv ? `${metric.hrv} ms` : '-'}
                            </div>
                            <div className={styles.historyTableCol}>
                              {metric.calories_burned || metric.calories ? (metric.calories_burned || metric.calories).toLocaleString() : '-'}
                            </div>
                            <div className={styles.historyTableCol}>
                              {(() => {
                                const sleepMinutes = metric.sleep_time != null ? Number(metric.sleep_time) : null
                                if (sleepMinutes == null) return '-'
                                const hours = Math.floor(sleepMinutes / 60)
                                const minutes = Math.round(sleepMinutes % 60)
                                return `${hours}:${minutes.toString().padStart(2, '0')}`
                              })()}
                            </div>
                            {!hasData && (
                              <div className={styles.manualLogHint}>
                                Tap to log
                              </div>
                            )}
                            <div className={styles.historyTableCol}>
                              <button
                                className={styles.deleteBtn}
                                onClick={async (e) => {
                                  e.stopPropagation()
                                  if (confirm(`Delete all health metrics for ${metric.date}?`)) {
                                    try {
                                      const { supabase } = await import('../lib/supabase')
                                      await supabase
                                        .from('daily_metrics')
                                        .delete()
                                        .eq('user_id', user.id)
                                        .eq('date', metric.date)
                                      await loadAllData()
                                      showToast('Health metrics deleted', 'success')
                                    } catch (error) {
                                      logError('Error deleting health metrics', error)
                                      showToast('Failed to delete health metrics', 'error')
                                    }
                                  }
                                }}
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        )
                      })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'Log' && (
          <div>
            <div className={styles.metricsCard}>
              <div className={styles.sectionHeader}>
                <h3>Manual Logging</h3>
                <button
                  className={styles.actionBtn}
                  onClick={() => {
                    const newMetric = {
                      date: getTodayEST(),
                      steps: null,
                      sleep_time: null,
                      sleep_score: null,
                      hrv: null,
                      calories: null,
                      weight: null,
                      resting_heart_rate: null,
                      body_temp: null
                    }
                    setEditingMetric(newMetric)
                    setShowLogModal(true)
                  }}
                >
                  Log Health Metrics
                </button>
              </div>
              <p className={styles.sectionNote}>Log all health metrics for any date</p>
            </div>
          </div>
        )}

        {activeTab === 'Goals' && (
          <div>
            {healthGoals.length > 0 ? (
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
                  {healthGoals.map(goal => {
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
            ) : (
              <div className={styles.metricsCard}>
                <p className={styles.emptyText}>No health goals set yet</p>
                <button
                  className={styles.actionBtn}
                  onClick={() => navigate('/goals')}
                  style={{ marginTop: '12px' }}
                >
                  Create Goal
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Log/Edit Metric Modal */}
      {(editingMetric || showLogModal) && createPortal(
        <>
          <div className={styles.overlay} onClick={() => {
            setEditingMetric(null)
            setShowLogModal(false)
          }}>
            <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>{editingMetric?.date ? `Log Health Metrics - ${new Date(editingMetric.date + 'T12:00:00').toLocaleDateString()}` : 'Log Health Metrics'}</h2>
              <button onClick={() => {
                setEditingMetric(null)
                setShowLogModal(false)
              }}>✕</button>
            </div>
            <div className={styles.editForm}>
              <div className={styles.formGroup}>
                <label>Date *</label>
                <input
                  type="date"
                  value={(editingMetric && editingMetric.date) || (showLogModal ? getTodayEST() : getTodayEST())}
                  onChange={(e) => {
                    const currentMetric = editingMetric || {}
                    setEditingMetric({ ...currentMetric, date: e.target.value })
                  }}
                  max={getTodayEST()}
                />
              </div>
              <div className={styles.formGroup}>
                <label>Weight (lbs)</label>
                <input
                  type="number"
                  step="0.1"
                  value={(editingMetric && editingMetric.weight) || ''}
                  onChange={(e) => {
                    const currentMetric = editingMetric || {}
                    setEditingMetric({ ...currentMetric, weight: parseFloat(e.target.value) || null })
                  }}
                  placeholder="Enter weight"
                />
              </div>
              <div className={styles.formGroup}>
                <label>Steps</label>
                <input
                  type="number"
                  step="1"
                  value={(editingMetric && editingMetric.steps) || ''}
                  onChange={(e) => {
                    const currentMetric = editingMetric || {}
                    const val = e.target.value
                    setEditingMetric({ ...currentMetric, steps: val === '' ? null : Math.round(Number(val)) })
                  }}
                  placeholder="Enter steps"
                />
              </div>
              <div className={styles.formGroup}>
                <label>HRV (ms)</label>
                <input
                  type="number"
                  value={(editingMetric && editingMetric.hrv) || ''}
                  onChange={(e) => {
                    const currentMetric = editingMetric || {}
                    setEditingMetric({ ...currentMetric, hrv: parseInt(e.target.value) || null })
                  }}
                  placeholder="Enter HRV"
                />
              </div>
              <div className={styles.formGroup}>
                <label>Calories</label>
                <input
                  type="number"
                  value={(editingMetric && editingMetric.calories) || ''}
                  onChange={(e) => {
                    const currentMetric = editingMetric || {}
                    setEditingMetric({ ...currentMetric, calories: parseInt(e.target.value) || null })
                  }}
                  placeholder="Enter calories"
                />
              </div>
              <div className={styles.formGroup}>
                <label>Sleep Time</label>
                <input
                  type="text"
                  value={(editingMetric && editingMetric.sleep_time) || ''}
                  onChange={(e) => {
                    const currentMetric = editingMetric || {}
                    setEditingMetric({ ...currentMetric, sleep_time: e.target.value })
                  }}
                  placeholder="e.g., 7h 30m"
                />
              </div>
              <div className={styles.formGroup}>
                <label>Sleep Score</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={(editingMetric && editingMetric.sleep_score) || ''}
                  onChange={(e) => {
                    const currentMetric = editingMetric || {}
                    setEditingMetric({ ...currentMetric, sleep_score: parseInt(e.target.value) || null })
                  }}
                  placeholder="0-100"
                />
              </div>
              <div className={styles.formGroup}>
                <label>Resting Heart Rate (bpm)</label>
                <input
                  type="number"
                  value={(editingMetric && editingMetric.resting_heart_rate) || ''}
                  onChange={(e) => {
                    const currentMetric = editingMetric || {}
                    setEditingMetric({ ...currentMetric, resting_heart_rate: parseInt(e.target.value) || null })
                  }}
                  placeholder="Enter resting heart rate"
                />
              </div>
              <div className={styles.formGroup}>
                <label>Body Temperature (°F)</label>
                <input
                  type="number"
                  step="0.1"
                  value={(editingMetric && editingMetric.body_temp) || ''}
                  onChange={(e) => {
                    const currentMetric = editingMetric || {}
                    setEditingMetric({ ...currentMetric, body_temp: parseFloat(e.target.value) || null })
                  }}
                  placeholder="Enter body temperature"
                />
              </div>
              <div className={styles.formActions}>
                <button 
                  className={styles.saveBtn} 
                  onClick={async () => {
                    if (!user) return
                    const metricToSave = editingMetric || { date: getTodayEST() }
                    if (!metricToSave.date) {
                      showToast('Please select a date', 'error')
                      return
                    }
                    
                      // Validate inputs
                      const errors = []
                      const { validateWeight, validateSteps, validateHRV, validateCalories, validateSleepScore, validateRestingHeartRate, validateBodyTemperature } = await import('../utils/validation')
                      
                      if (metricToSave.weight !== null && metricToSave.weight !== undefined && metricToSave.weight !== '') {
                        const weightValidation = validateWeight(metricToSave.weight)
                        if (!weightValidation.valid) errors.push(`Weight: ${weightValidation.error}`)
                      }
                      if (metricToSave.steps !== null && metricToSave.steps !== undefined && metricToSave.steps !== '') {
                        const stepsValidation = validateSteps(metricToSave.steps)
                        if (!stepsValidation.valid) errors.push(`Steps: ${stepsValidation.error}`)
                      }
                      if (metricToSave.hrv !== null && metricToSave.hrv !== undefined && metricToSave.hrv !== '') {
                        const hrvValidation = validateHRV(metricToSave.hrv)
                        if (!hrvValidation.valid) errors.push(`HRV: ${hrvValidation.error}`)
                      }
                      if (metricToSave.calories !== null && metricToSave.calories !== undefined && metricToSave.calories !== '') {
                        const caloriesValidation = validateCalories(metricToSave.calories)
                        if (!caloriesValidation.valid) errors.push(`Calories: ${caloriesValidation.error}`)
                      }
                      if (metricToSave.sleep_score !== null && metricToSave.sleep_score !== undefined && metricToSave.sleep_score !== '') {
                        const sleepValidation = validateSleepScore(metricToSave.sleep_score)
                        if (!sleepValidation.valid) errors.push(`Sleep Score: ${sleepValidation.error}`)
                      }
                      if (metricToSave.resting_heart_rate !== null && metricToSave.resting_heart_rate !== undefined && metricToSave.resting_heart_rate !== '') {
                        const restingHeartRateValidation = validateRestingHeartRate(metricToSave.resting_heart_rate)
                        if (!restingHeartRateValidation.valid) errors.push(`Resting Heart Rate: ${restingHeartRateValidation.error}`)
                      }
                      if (metricToSave.body_temp !== null && metricToSave.body_temp !== undefined && metricToSave.body_temp !== '') {
                        const bodyTemperatureValidation = validateBodyTemperature(metricToSave.body_temp)
                        if (!bodyTemperatureValidation.valid) errors.push(`Body Temperature: ${bodyTemperatureValidation.error}`)
                      }
                      
                      if (errors.length > 0) {
                        showToast(errors.join(', '), 'error')
                        return
                      }
                      
                      try {
                        logDebug('Saving health metrics', metricToSave)
                        // Use utility functions to ensure proper type conversion
                        const result = await saveMetricsToSupabase(user.id, metricToSave.date, {
                          weight: toNumber(metricToSave.weight),
                          steps: toInteger(metricToSave.steps), // INTEGER - must be whole number
                          hrv: toNumber(metricToSave.hrv),
                          caloriesBurned: toNumber(metricToSave.calories),
                          sleepTime: toNumber(metricToSave.sleep_time),
                          sleepScore: toNumber(metricToSave.sleep_score),
                          restingHeartRate: toNumber(metricToSave.resting_heart_rate),
                          bodyTemp: toNumber(metricToSave.body_temp)
                        })
                        logDebug('Health metrics save result', result)
                        await loadAllData()
                        setEditingMetric(null)
                        setShowLogModal(false)
                        showToast('Health metrics saved successfully!', 'success')
                      } catch (e) {
                        logError('Error saving metrics', { error: e, message: e.message, stack: e.stack })
                        showToast(`Failed to save metrics: ${e.message || 'Unknown error'}. Please check console.`, 'error')
                      }
                  }}
                >
                  Save
                </button>
                <button 
                  className={styles.cancelBtn} 
                  onClick={() => {
                    setEditingMetric(null)
                    setShowLogModal(false)
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
        </>,
        document.body
      )}

      {/* Toast Notification */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          duration={toast.duration}
          onClose={hideToast}
        />
      )}

      {showShareModal && (() => {
        const todayMetric = metrics.find(m => m.date === getTodayEST()) || {
          date: getTodayEST(),
          steps: null,
          hrv: null,
          sleep_time: null,
          calories_burned: null,
          weight: null,
          resting_heart_rate: null
        }
        return (
          <ShareModal
            type="health"
            data={{ health: todayMetric }}
            onClose={() => setShowShareModal(false)}
          />
        )
      })()}

      <BottomNav />
    </div>
  )
}

