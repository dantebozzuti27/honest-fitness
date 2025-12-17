import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getWorkoutsFromSupabase } from '../lib/db/workoutsDb'
import { getAllMetricsFromSupabase, saveMetricsToSupabase } from '../lib/db/metricsDb'
import { toInteger, toNumber } from '../utils/numberUtils'
// Dynamic import for code-splitting
import { getReadinessScore } from '../lib/readiness'
import { getAllConnectedAccounts, getFitbitDaily, syncFitbitData, syncOuraData, mergeWearableDataToMetrics } from '../lib/wearables'
import { supabase } from '../lib/supabase'
import { getLocalDate, getTodayEST, getYesterdayEST, formatDateShort, formatDateMMDDYYYY } from '../utils/dateUtils'
import { formatGoalName } from '../utils/formatUtils'
import { logError, logDebug, logWarn } from '../utils/logger'

// Ensure logDebug is always available (fallback for build issues)
const safeLogDebug = logDebug || (() => {})
// All charts are now BarChart only
import BarChart from '../components/BarChart'
import Toast from '../components/Toast'
import { useToast } from '../hooks/useToast'
import ConfirmDialog from '../components/ConfirmDialog'
import ShareModal from '../components/ShareModal'
import SideMenu from '../components/SideMenu'
import HomeButton from '../components/HomeButton'
import HistoryCard from '../components/HistoryCard'
import EmptyState from '../components/EmptyState'
import Skeleton from '../components/Skeleton'
import Button from '../components/Button'
import InputField from '../components/InputField'
import SelectField from '../components/SelectField'
import InsightsCard from '../components/InsightsCard'
import { usePageInsights } from '../hooks/usePageInsights'
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
  const [metrics, setMetrics] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedPeriod, setSelectedPeriod] = useState('week') // week, month, 90days
  const [editingMetric, setEditingMetric] = useState(null)
  const [editingMetricType, setEditingMetricType] = useState(null)
  const [healthGoals, setHealthGoals] = useState([])
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState(null)
  const [showLogModal, setShowLogModal] = useState(false)
  const [showShareModal, setShowShareModal] = useState(false)
  const [selectedMetricForShare, setSelectedMetricForShare] = useState(null)
  const { toast, showToast, hideToast } = useToast()
  const [confirmState, setConfirmState] = useState({ open: false, title: '', message: '', action: null, payload: null })
  const shownLoadErrorRef = useRef(false)

  // Page-specific AI insights (health-focused)
  const { loading: insightsLoading, data: pageInsights } = usePageInsights(
    'Health',
    {
      activeTab,
      selectedPeriod,
      workoutsCount: Array.isArray(workouts) ? workouts.length : 0,
      metricsCount: Array.isArray(metrics) ? metrics.length : 0,
      readinessScore: readiness?.score ?? null,
      readinessZone: readiness?.zone ?? null
    },
    Boolean(user)
  )

  const recoveryStreak = useMemo(() => {
    // Recovery session: session_type === 'recovery' OR all exercises are category Recovery
    const dates = new Set()
    ;(workouts || []).forEach(w => {
      if (!w?.date) return
      const sessionType = (w.session_type || '').toString().toLowerCase()
      if (sessionType === 'recovery') {
        dates.add(w.date)
        return
      }
      const exs = w.workout_exercises || []
      if (Array.isArray(exs) && exs.length > 0) {
        const allRecovery = exs.every(ex => (ex?.category || '').toString().toLowerCase() === 'recovery')
        if (allRecovery) dates.add(w.date)
      }
    })

    if (dates.size === 0) return 0
    const sorted = Array.from(dates).sort((a, b) => new Date(b) - new Date(a))
    const today = getTodayEST()
    const yesterday = getYesterdayEST()
    if (sorted[0] !== today && sorted[0] !== yesterday) return 0

    let streak = 0
    let cursor = sorted[0] === today ? today : yesterday
    const has = (d) => dates.has(d)
    while (has(cursor)) {
      streak += 1
      const dt = new Date(cursor + 'T12:00:00')
      dt.setDate(dt.getDate() - 1)
      cursor = getLocalDate(dt)
    }
    return streak
  }, [workouts])

  const loadHealthGoals = async () => {
    if (!user) return
    try {
      // First, update goal progress based on current data
      const { updateCategoryGoals } = await import('../lib/goalsDb')
      const result = await updateCategoryGoals(user.id, 'health')
      if (result.errors && result.errors.length > 0) {
        logWarn('Goal update errors', { errors: result.errors })
        logError('Some goals failed to update', result.errors)
      }
      
      // Then load the updated goals
      const { getActiveGoalsFromSupabase } = await import('../lib/goalsDb')
      const goals = await getActiveGoalsFromSupabase(user.id, 'health')
      setHealthGoals(goals)
    } catch (error) {
      logError('Error loading health goals', error)
      logError('Error loading health goals', error)
    }
  }

  useEffect(() => {
    if (user) {
      loadAllData()
    }
    
    // Check if log modal should open from quick log
    if (location.state?.openLogModal) {
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
      // Clear the state to prevent reopening on re-render
      navigate(location.pathname, { replace: true, state: {} })
    }
  }, [user, selectedPeriod, location.state])

  // Refresh goals when page becomes visible or when navigating back from Goals page
  useEffect(() => {
    if (!user) return
    loadHealthGoals()
  }, [user, location.key])
  
  // Reload goals when Goals tab is active
  useEffect(() => {
    if (user && activeTab === 'Goals') {
      loadHealthGoals()
    }
  }, [user, activeTab])

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
      // Load readiness score (gracefully handle errors)
      try {
        const readinessData = await getReadinessScore(user.id)
        setReadiness(readinessData)
      } catch (error) {
        // Silently fail - readiness is optional
        logError('Error loading readiness score', error)
        setReadiness(null)
      }

      // Load workouts
      const allWorkouts = await getWorkoutsFromSupabase(user.id)
      const filteredWorkouts = filterByPeriod(allWorkouts)
      setWorkouts(filteredWorkouts)

      // Load wearables
      const connected = await getAllConnectedAccounts(user.id)
      setWearables(connected || [])
      
      // Load health goals
      await loadHealthGoals()
      
      // Check for connected accounts (for display purposes and provider-specific UI)
      const fitbitAccount = connected?.find(a => a.provider === 'fitbit')
      const ouraAccount = connected?.find(a => a.provider === 'oura')
      const connectedProvider = ouraAccount ? 'oura' : (fitbitAccount ? 'fitbit' : null)
      
      // Auto-sync wearable data if accounts are connected (silently in background)
      const todayDate = getTodayEST()
      
      // Sync wearable data and reload metrics after sync completes
      const syncPromises = []
      if (fitbitAccount) {
        syncPromises.push(
          syncFitbitData(user.id, todayDate).catch(err => {
            // Silently fail - user can manually sync if needed
            logError('Auto-sync Fitbit failed', err)
          })
        )
      }
      
      if (ouraAccount) {
        syncPromises.push(
          syncOuraData(user.id, todayDate).catch(err => {
            // Silently fail - user can manually sync if needed
            logError('Auto-sync Oura failed', err)
          })
        )
      }
      
      // After all syncs complete, reload metrics to show updated data
      if (syncPromises.length > 0) {
        Promise.all(syncPromises).then(() => {
          // Reload metrics after sync completes
          getAllMetricsFromSupabase(user.id).then(updatedMetrics => {
            const transformedMetrics = (updatedMetrics || []).map(metric => ({
              ...metric,
              sleep_time: metric.sleep_duration ?? metric.sleep_time ?? null,
              calories: metric.calories_burned ?? metric.calories ?? null,
              calories_burned: metric.calories_burned ?? metric.calories ?? null,
              steps: metric.steps ?? null,
              hrv: metric.hrv ?? null,
              sleep_score: metric.sleep_score ?? null,
              weight: metric.weight ?? null,
              resting_heart_rate: metric.resting_heart_rate ?? null,
              body_temp: metric.body_temp ?? null
            }))
            
            transformedMetrics.sort((a, b) => {
              const dateA = new Date(a.date)
              const dateB = new Date(b.date)
              return dateB - dateA
            })
            
            setMetrics(transformedMetrics)
          }).catch(err => {
            logError('Error reloading metrics after sync', err)
          })
        })
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
      
      // Load metrics from health_metrics table (includes Fitbit, Oura, and manual data)
      const allMetrics = await getAllMetricsFromSupabase(user.id)
      
      safeLogDebug('Loaded metrics from database', { count: allMetrics?.length || 0 })
      
      // Transform health_metrics data to match UI expectations
      // health_metrics uses: sleep_duration, calories_burned
      // UI expects: sleep_time, calories
      const transformedMetrics = (allMetrics || []).map(metric => {
        // Fix sleep duration: if it's from Oura and suspiciously small (< 60 minutes), 
        // it might be incorrectly stored as seconds or a very small value
        // Check if sleep_duration is < 60 and source is Oura - might need correction
        let sleepTime = metric.sleep_duration ?? metric.sleep_time ?? null
        if (sleepTime != null && metric.source_provider === 'oura') {
          const sleepValue = Number(sleepTime)
          // If value is < 60 minutes and we have sleep stages that add up to more,
          // the total sleep duration might be wrong
          // But we can't fix it here without more context, so we'll trust the backend
          // Just ensure it's a number
          sleepTime = sleepValue
        }
        
        return {
          ...metric,
          // Map database fields to UI fields
          sleep_time: sleepTime,
          calories: metric.calories_burned ?? metric.calories ?? null,
          calories_burned: metric.calories_burned ?? metric.calories ?? null,
          // Ensure all expected fields exist
          steps: metric.steps ?? null,
          hrv: metric.hrv ?? null,
          sleep_score: metric.sleep_score ?? null,
          weight: metric.weight ?? null,
          resting_heart_rate: metric.resting_heart_rate ?? null,
          body_temp: metric.body_temp ?? null
        }
      })
      
      safeLogDebug('Transformed metrics', { count: transformedMetrics.length })
      const today = getTodayEST()
      const todayMetric = transformedMetrics.find(m => m.date === today)
      safeLogDebug('Today metric', todayMetric)
      
      // Sort by date descending (newest first)
      transformedMetrics.sort((a, b) => {
        const dateA = new Date(a.date)
        const dateB = new Date(b.date)
        return dateB - dateA
      })
      
      setMetrics(transformedMetrics)
    } catch (error) {
      logError('Health loadAllData failed', error)
      if (!shownLoadErrorRef.current && showToast && typeof showToast === 'function') {
        shownLoadErrorRef.current = true
        showToast('Failed to load Health data. Please refresh and try again.', 'error')
      }
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
        const yesterday = getYesterdayEST()
        await syncFitbitData(user.id, yesterday)
      } catch (e) {
        // Yesterday sync is optional, continue
      }
      
      // Merge into daily_metrics
      await mergeWearableDataToMetrics(user.id, today)
      
      // Reload data to show updated Fitbit data
      await loadAllData()
      
      if (showToast && typeof showToast === 'function') {
        showToast('Fitbit data synced successfully!', 'success')
      }
    } catch (error) {
      logError('Fitbit sync error', error)
      // Don't show error toast for sync errors - they're expected if account isn't connected
      // Only show if it's a critical error
      const errorMsg = error.message || 'Failed to sync Fitbit data. Please try again or reconnect your account.'
      if (showToast && typeof showToast === 'function') {
        if (!errorMsg.includes('not connected') && !errorMsg.includes('not found')) {
          showToast(errorMsg, 'error')
        }
      }
      setSyncError(errorMsg)
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
      hasFitbitData: wearables.some(w => w.provider === 'fitbit'),
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
  }, [wearables, metrics])

  // Weekly trends
  const weeklyTrends = useMemo(() => {
    const dates = []
    const readinessScores = []
    const calories = []
    const workouts = []

    for (let i = 6; i >= 0; i--) {
      const date = new Date()
      date.setDate(date.getDate() - i)
      const dateStr = getLocalDate(date)
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
        <div className={styles.loading} style={{ width: '100%' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Skeleton style={{ width: '45%', height: 16 }} />
            <Skeleton style={{ width: '100%', height: 120 }} />
            <Skeleton style={{ width: '100%', height: 120 }} />
            <Skeleton style={{ width: '70%', height: 16 }} />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <SideMenu />
        <h1>Health</h1>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <HomeButton />
          {activeTab === 'Today' && (
            <Button
              unstyled
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
                setEditingMetricType(null) // Show all fields
                setShowLogModal(true)
              }}
              aria-label="Log health metrics"
            >
              <span className={styles.plusIcon}>+</span>
            </Button>
          )}
        </div>
      </div>

      <div className={styles.tabs}>
        {TABS.map(tab => (
          <Button
            unstyled
            key={tab}
            className={`${styles.tab} ${activeTab === tab ? styles.activeTab : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </Button>
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
            body_temp: null,
            source_data: null,
            source_provider: null
          }
          
          // Determine which provider's data to show
          const fitbitAccount = wearables.find(w => w.provider === 'fitbit')
          const ouraAccount = wearables.find(w => w.provider === 'oura')
          const connectedProvider = ouraAccount ? 'oura' : (fitbitAccount ? 'fitbit' : null)
          
          // Extract provider-specific metrics from source_data
          const sourceData = todayMetric?.source_data || {}
          const isOura = connectedProvider === 'oura' && todayMetric?.source_provider === 'oura'
          const isFitbit = connectedProvider === 'fitbit' && todayMetric?.source_provider === 'fitbit'
          
          // Oura-specific metrics
          const ouraReadinessScore = isOura ? (sourceData.readiness_score || null) : null
          const ouraActivityScore = isOura ? (sourceData.activity_score || null) : null
          const ouraRecoveryIndex = isOura ? (sourceData.recovery_index || null) : null
          const ouraSleepEfficiency = isOura ? (sourceData.sleep_efficiency || null) : null
          const ouraSleepLatency = isOura ? (sourceData.sleep_latency || null) : null
          const ouraReadinessContributors = isOura ? (sourceData.readiness_contributors || {}) : {}
          const ouraSleepContributors = isOura ? (sourceData.sleep_contributors || {}) : {}
          
          // Fitbit-specific metrics
          const fitbitActiveCalories = isFitbit ? (sourceData.active_calories || null) : null
          const fitbitDistance = isFitbit ? (sourceData.distance || null) : null
          const fitbitFloors = isFitbit ? (sourceData.floors || null) : null
          const fitbitSleepEfficiency = isFitbit ? (sourceData.sleep_efficiency || null) : null
          const fitbitAvgHeartRate = isFitbit ? (sourceData.average_heart_rate || null) : null
          const fitbitSedentaryMinutes = isFitbit ? (sourceData.sedentary_minutes || null) : null
          const fitbitLightlyActiveMinutes = isFitbit ? (sourceData.lightly_active_minutes || null) : null
          const fitbitFairlyActiveMinutes = isFitbit ? (sourceData.fairly_active_minutes || null) : null
          const fitbitVeryActiveMinutes = isFitbit ? (sourceData.very_active_minutes || null) : null
          
          return (
            <div className={styles.dashboardContainer}>
              {pageInsights?.insights?.length > 0 && (
                <InsightsCard
                  title={pageInsights.title || 'Health Insights'}
                  insights={(pageInsights.insights || []).map(i => ({
                    message: i?.message || '',
                    icon: null
                  }))}
                  type="info"
                  expandable
                />
              )}
              {/* Recovery quick-start (first-class) */}
              <div className={styles.dashboardGrid}>
                <div
                  className={styles.dashboardCard}
                  onClick={() => navigate('/workout/active', { state: { sessionType: 'recovery' } })}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      navigate('/workout/active', { state: { sessionType: 'recovery' } })
                    }
                  }}
                >
                  <div className={styles.dashboardStat}>
                    <div className={styles.dashboardStatLabel}>Recovery</div>
                    <div className={styles.dashboardStatValue}>
                      {recoveryStreak > 0 ? `${recoveryStreak} day streak` : 'Start today'}
                    </div>
                  </div>
                  <Button unstyled className={styles.dashboardLogBtn} onClick={(e) => { e.stopPropagation(); navigate('/workout/active', { state: { sessionType: 'recovery' } }) }}>
                    Start
                  </Button>
                </div>
                <div
                  className={styles.dashboardCard}
                  onClick={() => navigate('/workout/active', { state: { sessionType: 'workout' } })}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      navigate('/workout/active', { state: { sessionType: 'workout' } })
                    }
                  }}
                >
                  <div className={styles.dashboardStat}>
                    <div className={styles.dashboardStatLabel}>Train</div>
                    <div className={styles.dashboardStatValue}>Log a session</div>
                  </div>
                  <Button unstyled className={styles.dashboardLogBtn} onClick={(e) => { e.stopPropagation(); navigate('/workout/active', { state: { sessionType: 'workout' } }) }}>
                    Start
                  </Button>
                </div>
              </div>

              {/* Share Button */}
              {todayMetric && (todayMetric.steps || todayMetric.hrv || todayMetric.sleep_time || todayMetric.calories_burned || todayMetric.weight) && (
                <Button
                  unstyled
                  className={styles.shareBtn}
                  onClick={() => setShowShareModal(true)}
                >
                  Share Health Summary
                </Button>
              )}
              
              {/* Oura Readiness Score Card - Show if Oura is connected */}
              {isOura && ouraReadinessScore != null && (
                <div className={`${styles.readinessCard} ${styles[`readiness${ouraReadinessScore >= 85 ? 'optimal' : ouraReadinessScore >= 70 ? 'good' : ouraReadinessScore >= 55 ? 'attention' : 'low'}`]}`}>
                  <div className={styles.readinessHeader}>
                    <h2>Readiness Score</h2>
                    <span className={styles.readinessZone}>
                      {ouraReadinessScore >= 85 ? 'OPTIMAL' : ouraReadinessScore >= 70 ? 'GOOD' : ouraReadinessScore >= 55 ? 'PAY ATTENTION' : 'LOW'}
                    </span>
                  </div>
                  <div className={styles.readinessScore}>
                    <span className={styles.readinessNumber}>{Math.round(ouraReadinessScore)}</span>
                    <span className={styles.readinessLabel}>/ 100</span>
                  </div>
                  <div className={styles.readinessComponents}>
                    {ouraReadinessContributors.activity_balance != null && (
                      <div className={styles.component}>
                        <span className={styles.componentLabel}>Activity</span>
                        <span className={styles.componentValue}>{Math.round(ouraReadinessContributors.activity_balance)}</span>
                      </div>
                    )}
                    {ouraReadinessContributors.hrv_balance != null && (
                      <div className={styles.component}>
                        <span className={styles.componentLabel}>HRV</span>
                        <span className={styles.componentValue}>{Math.round(ouraReadinessContributors.hrv_balance)}</span>
                      </div>
                    )}
                    {ouraReadinessContributors.sleep_balance != null && (
                      <div className={styles.component}>
                        <span className={styles.componentLabel}>Sleep</span>
                        <span className={styles.componentValue}>{Math.round(ouraReadinessContributors.sleep_balance)}</span>
                      </div>
                    )}
                    {ouraRecoveryIndex != null && (
                      <div className={styles.component}>
                        <span className={styles.componentLabel}>Recovery</span>
                        <span className={styles.componentValue}>{Math.round(ouraRecoveryIndex)}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
              
              {/* Honest Readiness Score Card - Show if no Oura or as fallback */}
              {(!isOura || !ouraReadinessScore) && readiness && (
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
                {/* Steps Card - Clickable to edit just steps */}
                <div 
                  className={styles.dashboardCard}
                  onClick={() => {
                    const stepsMetric = { 
                      ...todayMetric,
                      weight: null,
                      hrv: null,
                      calories_burned: null,
                      sleep_time: null,
                      sleep_score: null,
                      resting_heart_rate: null,
                      body_temp: null
                    }
                    setEditingMetric(stepsMetric)
                    setShowLogModal(true)
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <div className={styles.dashboardStat}>
                    <span className={styles.dashboardStatLabel}>Steps</span>
                    <span className={styles.dashboardStatValue}>
                      {todayMetric?.steps != null
                        ? Number(todayMetric.steps).toLocaleString()
                        : '-'}
                    </span>
                  </div>
                  <Button
                    unstyled
                    className={styles.dashboardLogBtn} 
                    onClick={(e) => { 
                      e.stopPropagation()
                      setEditingMetric({ ...todayMetric, date: todayMetric.date || getTodayEST() })
                      setEditingMetricType('steps')
                      setShowLogModal(true)
                    }}
                  >
                    {todayMetric?.steps != null ? 'Edit' : 'Log'}
                  </Button>
                </div>

                {/* Calories Card - Clickable to edit just calories */}
                <div 
                  className={styles.dashboardCard}
                  onClick={() => {
                    const caloriesMetric = { 
                      ...todayMetric,
                      weight: null,
                      steps: null,
                      hrv: null,
                      sleep_time: null,
                      sleep_score: null,
                      resting_heart_rate: null,
                      body_temp: null
                    }
                    setEditingMetric(caloriesMetric)
                    setShowLogModal(true)
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <div className={styles.dashboardStat}>
                    <span className={styles.dashboardStatLabel}>Calories</span>
                    <span className={styles.dashboardStatValue}>
                      {todayMetric?.calories_burned != null || todayMetric?.calories != null
                        ? Number(todayMetric.calories_burned || todayMetric.calories).toLocaleString()
                        : '-'}
                    </span>
                  </div>
                  <Button
                    unstyled
                    className={styles.dashboardLogBtn} 
                    onClick={(e) => { 
                      e.stopPropagation()
                      setEditingMetric({ ...todayMetric, date: todayMetric.date || getTodayEST() })
                      setEditingMetricType('calories')
                      setShowLogModal(true)
                    }}
                  >
                    {todayMetric?.calories_burned != null ? 'Edit' : 'Log'}
                  </Button>
                </div>

                {/* HRV Card - Clickable to edit just HRV */}
                <div 
                  className={styles.dashboardCard}
                  onClick={() => {
                    const hrvMetric = { 
                      ...todayMetric,
                      weight: null,
                      steps: null,
                      calories_burned: null,
                      sleep_time: null,
                      sleep_score: null,
                      resting_heart_rate: null,
                      body_temp: null
                    }
                    setEditingMetric(hrvMetric)
                    setShowLogModal(true)
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <div className={styles.dashboardStat}>
                    <span className={styles.dashboardStatLabel}>HRV</span>
                    <span className={styles.dashboardStatValue}>
                      {todayMetric?.hrv != null
                        ? `${Math.round(Number(todayMetric.hrv))} ms`
                        : '-'}
                    </span>
                  </div>
                  <Button
                    unstyled
                    className={styles.dashboardLogBtn} 
                    onClick={(e) => { 
                      e.stopPropagation()
                      setEditingMetric({ ...todayMetric, date: todayMetric.date || getTodayEST() })
                      setEditingMetricType('hrv')
                      setShowLogModal(true)
                    }}
                  >
                    {todayMetric?.hrv != null ? 'Edit' : 'Log'}
                  </Button>
                </div>

                {/* Sleep Duration Card - Clickable to edit just sleep duration */}
                <div 
                  className={styles.dashboardCard}
                  onClick={() => {
                    const sleepMetric = { 
                      ...todayMetric,
                      weight: null,
                      steps: null,
                      hrv: null,
                      calories_burned: null,
                      sleep_score: null,
                      resting_heart_rate: null,
                      body_temp: null
                    }
                    setEditingMetric(sleepMetric)
                    setEditingMetricType('sleep')
                    setShowLogModal(true)
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <div className={styles.dashboardStat}>
                    <span className={styles.dashboardStatLabel}>Sleep Duration</span>
                    <span className={styles.dashboardStatValue}>
                      {(() => {
                        let sleepMinutes = todayMetric?.sleep_time != null
                          ? Number(todayMetric.sleep_time)
                          : null
                        
                        if (sleepMinutes == null) return '-'
                        
                        // Log for debugging
                        if (todayMetric?.source_provider === 'oura' && sleepMinutes < 60) {
                          logWarn('Oura sleep duration seems low', { minutes: sleepMinutes })
                        }
                        
                        // Safety check: ensure valid range
                        if (sleepMinutes < 0) sleepMinutes = 0
                        if (sleepMinutes > 1440) {
                          logWarn('Sleep duration seems too high, capping', { minutes: sleepMinutes })
                          sleepMinutes = 1440
                        }
                        
                        const hours = Math.floor(sleepMinutes / 60)
                        const minutes = Math.round(sleepMinutes % 60)
                        return `${hours}:${minutes.toString().padStart(2, '0')}`
                      })()}
                    </span>
                  </div>
                  <Button
                    unstyled
                    className={styles.dashboardLogBtn}
                    onClick={(e) => { 
                      e.stopPropagation()
                      setEditingMetric({ ...todayMetric, date: todayMetric.date || getTodayEST() })
                      setEditingMetricType('sleep')
                      setShowLogModal(true)
                    }}
                  >
                    {todayMetric?.sleep_time != null ? 'Edit' : 'Log'}
                  </Button>
                </div>

                {/* Sleep Score Card - Clickable to edit just sleep score */}
                {todayMetric?.sleep_score != null && (
                  <div 
                    className={styles.dashboardCard}
                    onClick={() => {
                      setEditingMetric({ ...todayMetric, date: todayMetric.date || getTodayEST() })
                      setEditingMetricType('sleep_score')
                      setShowLogModal(true)
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className={styles.dashboardStat}>
                      <span className={styles.dashboardStatLabel}>Sleep Score</span>
                      <span className={styles.dashboardStatValue}>
                        {todayMetric?.sleep_score != null
                          ? `${Math.round(Number(todayMetric.sleep_score))}/100`
                          : '-'}
                      </span>
                    </div>
                    <Button
                      unstyled
                      className={styles.dashboardLogBtn}
                      onClick={(e) => { 
                        e.stopPropagation()
                        setEditingMetric({ ...todayMetric, date: todayMetric.date || getTodayEST() })
                        setEditingMetricType('sleep_score')
                        setShowLogModal(true)
                      }}
                    >
                      Edit
                    </Button>
                  </div>
                )}

                {/* Weight Card - Clickable to edit just weight */}
                <div 
                  className={styles.dashboardCard}
                  onClick={() => {
                    setEditingMetric({ ...todayMetric, date: todayMetric.date || getTodayEST() })
                    setEditingMetricType('weight')
                    setShowLogModal(true)
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <div className={styles.dashboardStat}>
                    <span className={styles.dashboardStatLabel}>Weight</span>
                    <span className={styles.dashboardStatValue}>
                      {todayMetric?.weight != null 
                        ? `${todayMetric.weight} lbs`
                        : '-'}
                    </span>
                  </div>
                  <Button
                    unstyled
                    className={styles.dashboardLogBtn}
                    onClick={(e) => { 
                      e.stopPropagation()
                      setEditingMetric({ ...todayMetric, date: todayMetric.date || getTodayEST() })
                      setEditingMetricType('weight')
                      setShowLogModal(true)
                    }}
                  >
                    {todayMetric?.weight != null ? 'Edit' : 'Log'}
                  </Button>
                </div>

                {/* Resting HR Card - Clickable to edit just resting HR */}
                <div 
                  className={styles.dashboardCard}
                  onClick={() => {
                    setEditingMetric({ ...todayMetric, date: todayMetric.date || getTodayEST() })
                    setEditingMetricType('resting_heart_rate')
                    setShowLogModal(true)
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <div className={styles.dashboardStat}>
                    <span className={styles.dashboardStatLabel}>Resting HR</span>
                    <span className={styles.dashboardStatValue}>
                      {todayMetric?.resting_heart_rate != null
                        ? `${Math.round(Number(todayMetric.resting_heart_rate))} bpm`
                        : '-'}
                    </span>
                  </div>
                  <Button
                    unstyled
                    className={styles.dashboardLogBtn}
                    onClick={(e) => { 
                      e.stopPropagation()
                      setEditingMetric({ ...todayMetric, date: todayMetric.date || getTodayEST() })
                      setEditingMetricType('resting_heart_rate')
                      setShowLogModal(true)
                    }}
                  >
                    {todayMetric?.resting_heart_rate != null ? 'Edit' : 'Log'}
                  </Button>
                </div>
              </div>

              {/* Oura-Specific Metrics Section */}
              {isOura && (
                <div className={styles.providerSection}>
                  <h3 className={styles.providerSectionTitle}>Oura Metrics</h3>
                  <div className={styles.dashboardGrid}>
                    {/* Activity Balance */}
                    {ouraReadinessContributors.activity_balance != null && (
                      <div className={styles.dashboardCard}>
                        <div className={styles.dashboardStat}>
                          <span className={styles.dashboardStatLabel}>Activity Balance</span>
                          <span className={styles.dashboardStatValue}>
                            {Math.round(ouraReadinessContributors.activity_balance)}
                          </span>
                        </div>
                      </div>
                    )}
                    
                    {/* Recovery Index */}
                    {ouraRecoveryIndex != null && (
                      <div className={styles.dashboardCard}>
                        <div className={styles.dashboardStat}>
                          <span className={styles.dashboardStatLabel}>Recovery Index</span>
                          <span className={styles.dashboardStatValue}>
                            {Math.round(ouraRecoveryIndex)}
                          </span>
                        </div>
                      </div>
                    )}
                    
                    {/* Sleep Efficiency */}
                    {ouraSleepEfficiency != null && (
                      <div className={styles.dashboardCard}>
                        <div className={styles.dashboardStat}>
                          <span className={styles.dashboardStatLabel}>Sleep Efficiency</span>
                          <span className={styles.dashboardStatValue}>
                            {Math.round(ouraSleepEfficiency)}%
                          </span>
                        </div>
                      </div>
                    )}
                    
                    {/* Sleep Latency */}
                    {ouraSleepLatency != null && (
                      <div className={styles.dashboardCard}>
                        <div className={styles.dashboardStat}>
                          <span className={styles.dashboardStatLabel}>Sleep Latency</span>
                          <span className={styles.dashboardStatValue}>
                            {Math.round(ouraSleepLatency)} min
                          </span>
                        </div>
                      </div>
                    )}
                    
                    {/* Deep Sleep */}
                    {todayMetric?.deep_sleep != null && (
                      <div className={styles.dashboardCard}>
                        <div className={styles.dashboardStat}>
                          <span className={styles.dashboardStatLabel}>Deep Sleep</span>
                          <span className={styles.dashboardStatValue}>
                            {(() => {
                              const minutes = Math.round(Number(todayMetric.deep_sleep))
                              const hours = Math.floor(minutes / 60)
                              const mins = minutes % 60
                              return `${hours}:${mins.toString().padStart(2, '0')}`
                            })()}
                          </span>
                        </div>
                      </div>
                    )}
                    
                    {/* REM Sleep */}
                    {todayMetric?.rem_sleep != null && (
                      <div className={styles.dashboardCard}>
                        <div className={styles.dashboardStat}>
                          <span className={styles.dashboardStatLabel}>REM Sleep</span>
                          <span className={styles.dashboardStatValue}>
                            {(() => {
                              const minutes = Math.round(Number(todayMetric.rem_sleep))
                              const hours = Math.floor(minutes / 60)
                              const mins = minutes % 60
                              return `${hours}:${mins.toString().padStart(2, '0')}`
                            })()}
                          </span>
                        </div>
                      </div>
                    )}
                    
                    {/* Light Sleep */}
                    {todayMetric?.light_sleep != null && (
                      <div className={styles.dashboardCard}>
                        <div className={styles.dashboardStat}>
                          <span className={styles.dashboardStatLabel}>Light Sleep</span>
                          <span className={styles.dashboardStatValue}>
                            {(() => {
                              const minutes = Math.round(Number(todayMetric.light_sleep))
                              const hours = Math.floor(minutes / 60)
                              const mins = minutes % 60
                              return `${hours}:${mins.toString().padStart(2, '0')}`
                            })()}
                          </span>
                        </div>
                      </div>
                    )}
                    
                    {/* Sleep Regularity */}
                    {ouraReadinessContributors.sleep_regularity != null && (
                      <div className={styles.dashboardCard}>
                        <div className={styles.dashboardStat}>
                          <span className={styles.dashboardStatLabel}>Sleep Regularity</span>
                          <span className={styles.dashboardStatValue}>
                            {Math.round(ouraReadinessContributors.sleep_regularity)}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Fitbit-Specific Metrics Section */}
              {isFitbit && (
                <div className={styles.providerSection}>
                  <h3 className={styles.providerSectionTitle}>Fitbit Metrics</h3>
                  <div className={styles.dashboardGrid}>
                    {/* Active Calories */}
                    {fitbitActiveCalories != null && (
                      <div className={styles.dashboardCard}>
                        <div className={styles.dashboardStat}>
                          <span className={styles.dashboardStatLabel}>Active Calories</span>
                          <span className={styles.dashboardStatValue}>
                            {Math.round(fitbitActiveCalories).toLocaleString()}
                          </span>
                        </div>
                      </div>
                    )}
                    
                    {/* Distance */}
                    {fitbitDistance != null && (
                      <div className={styles.dashboardCard}>
                        <div className={styles.dashboardStat}>
                          <span className={styles.dashboardStatLabel}>Distance</span>
                          <span className={styles.dashboardStatValue}>
                            {Number(fitbitDistance).toFixed(2)} mi
                          </span>
                        </div>
                      </div>
                    )}
                    
                    {/* Floors */}
                    {fitbitFloors != null && (
                      <div className={styles.dashboardCard}>
                        <div className={styles.dashboardStat}>
                          <span className={styles.dashboardStatLabel}>Floors</span>
                          <span className={styles.dashboardStatValue}>
                            {Math.round(fitbitFloors)}
                          </span>
                        </div>
                      </div>
                    )}
                    
                    {/* Sleep Efficiency */}
                    {fitbitSleepEfficiency != null && (
                      <div className={styles.dashboardCard}>
                        <div className={styles.dashboardStat}>
                          <span className={styles.dashboardStatLabel}>Sleep Efficiency</span>
                          <span className={styles.dashboardStatValue}>
                            {Math.round(fitbitSleepEfficiency)}%
                          </span>
                        </div>
                      </div>
                    )}
                    
                    {/* Average Heart Rate */}
                    {fitbitAvgHeartRate != null && (
                      <div className={styles.dashboardCard}>
                        <div className={styles.dashboardStat}>
                          <span className={styles.dashboardStatLabel}>Avg Heart Rate</span>
                          <span className={styles.dashboardStatValue}>
                            {Math.round(fitbitAvgHeartRate)} bpm
                          </span>
                        </div>
                      </div>
                    )}
                    
                    {/* Very Active Minutes */}
                    {fitbitVeryActiveMinutes != null && (
                      <div className={styles.dashboardCard}>
                        <div className={styles.dashboardStat}>
                          <span className={styles.dashboardStatLabel}>Very Active</span>
                          <span className={styles.dashboardStatValue}>
                            {Math.round(fitbitVeryActiveMinutes)} min
                          </span>
                        </div>
                      </div>
                    )}
                    
                    {/* Fairly Active Minutes */}
                    {fitbitFairlyActiveMinutes != null && (
                      <div className={styles.dashboardCard}>
                        <div className={styles.dashboardStat}>
                          <span className={styles.dashboardStatLabel}>Fairly Active</span>
                          <span className={styles.dashboardStatValue}>
                            {Math.round(fitbitFairlyActiveMinutes)} min
                          </span>
                        </div>
                      </div>
                    )}
                    
                    {/* Lightly Active Minutes */}
                    {fitbitLightlyActiveMinutes != null && (
                      <div className={styles.dashboardCard}>
                        <div className={styles.dashboardStat}>
                          <span className={styles.dashboardStatLabel}>Lightly Active</span>
                          <span className={styles.dashboardStatValue}>
                            {Math.round(fitbitLightlyActiveMinutes)} min
                          </span>
                        </div>
                      </div>
                    )}
                    
                    {/* Sedentary Minutes */}
                    {fitbitSedentaryMinutes != null && (
                      <div className={styles.dashboardCard}>
                        <div className={styles.dashboardStat}>
                          <span className={styles.dashboardStatLabel}>Sedentary</span>
                          <span className={styles.dashboardStatValue}>
                            {Math.round(fitbitSedentaryMinutes)} min
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Sync Button - Show if Fitbit is connected */}
              {wearables.some(w => w.provider === 'fitbit') && (
                <div className={styles.syncCard}>
                  <div className={styles.syncHeader}>
                    <h3>Fitbit Sync</h3>
                    <Button
                      unstyled
                      className={styles.actionBtn}
                      onClick={() => {
                        if (handleSyncFitbit && typeof handleSyncFitbit === 'function') {
                          handleSyncFitbit()
                        }
                      }}
                      disabled={syncing}
                    >
                      {syncing ? 'Syncing...' : 'Sync Now'}
                    </Button>
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
                <SelectField
                  className={styles.periodSelect}
                  value={selectedPeriod}
                  onChange={(e) => setSelectedPeriod(e.target.value)}
                  options={[
                    { value: 'week', label: 'Last 7 Days' },
                    { value: 'month', label: 'Last 30 Days' },
                    { value: '90days', label: 'Last 90 Days' }
                  ]}
                />
              </div>
              {metrics.length === 0 ? (
                <EmptyState
                  title="No metrics recorded yet"
                  message="Log your first metrics to see history and trends here."
                  actionLabel="Log metrics"
                  onAction={() => {
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
                    setEditingMetricType(null) // Show all fields
                    setShowLogModal(true)
                  }}
                />
              ) : (
                <div className={styles.historyCards}>
                  {metrics
                    .slice(0, 14)
                    .map((metric, index) => {
                      const previousMetric = metrics[index + 1]
                      return (
                        <HistoryCard
                          key={metric.date}
                          type="health"
                          date={metric.date}
                          data={metric}
                          previousData={previousMetric}
                          index={index}
                          onView={() => {
                            setEditingMetric({ ...metric })
                            setEditingMetricType(null)
                            setShowLogModal(true)
                          }}
                          onEdit={() => {
                            setEditingMetric({ ...metric })
                            setEditingMetricType(null)
                            setShowLogModal(true)
                          }}
                          onShare={() => {
                            setSelectedMetricForShare(metric)
                            setShowShareModal(true)
                          }}
                          onDelete={async () => {
                            setConfirmState({
                              open: true,
                              title: 'Delete health metrics?',
                              message: `Delete all health metrics for ${metric.date}?`,
                              action: 'delete_metrics',
                              payload: { date: metric.date }
                            })
                          }}
                        />
                      )
                    })}
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
              </div>
              <p className={styles.sectionNote}>Select a category to log</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', marginTop: '16px' }}>
                <Button
                  unstyled
                  className={styles.actionBtn}
                  onClick={() => {
                    setEditingMetricType('weight')
                    setEditingMetric({ date: getTodayEST(), weight: null })
                    setShowLogModal(true)
                  }}
                  style={{ padding: '16px', textAlign: 'center' }}
                >
                  Weight
                </Button>
                <Button
                  unstyled
                  className={styles.actionBtn}
                  onClick={() => {
                    setEditingMetricType('steps')
                    setEditingMetric({ date: getTodayEST(), steps: null })
                    setShowLogModal(true)
                  }}
                  style={{ padding: '16px', textAlign: 'center' }}
                >
                  Steps
                </Button>
                <Button
                  unstyled
                  className={styles.actionBtn}
                  onClick={() => {
                    setEditingMetricType('sleep')
                    setEditingMetric({ date: getTodayEST(), sleep_time: null })
                    setShowLogModal(true)
                  }}
                  style={{ padding: '16px', textAlign: 'center' }}
                >
                  Sleep
                </Button>
                <Button
                  unstyled
                  className={styles.actionBtn}
                  onClick={() => {
                    setEditingMetricType('calories')
                    setEditingMetric({ date: getTodayEST(), calories_burned: null, calories: null })
                    setShowLogModal(true)
                  }}
                  style={{ padding: '16px', textAlign: 'center' }}
                >
                  Calories Burned
                </Button>
                <Button
                  unstyled
                  className={styles.actionBtn}
                  onClick={() => {
                    setEditingMetricType('hrv')
                    setEditingMetric({ date: getTodayEST(), hrv: null })
                    setShowLogModal(true)
                  }}
                  style={{ padding: '16px', textAlign: 'center' }}
                >
                  HRV
                </Button>
                <Button
                  unstyled
                  className={styles.actionBtn}
                  onClick={() => {
                    setEditingMetricType('resting_heart_rate')
                    setEditingMetric({ date: getTodayEST(), resting_heart_rate: null })
                    setShowLogModal(true)
                  }}
                  style={{ padding: '16px', textAlign: 'center' }}
                >
                  Heart Rate
                </Button>
                <Button
                  unstyled
                  className={styles.actionBtn}
                  onClick={() => {
                    setEditingMetricType('body_temp')
                    setEditingMetric({ date: getTodayEST(), body_temp: null })
                    setShowLogModal(true)
                  }}
                  style={{ padding: '16px', textAlign: 'center' }}
                >
                  Body Temp
                </Button>
                <Button
                  unstyled
                  className={styles.actionBtn}
                  onClick={() => {
                    setEditingMetricType('sleep_score')
                    setEditingMetric({ date: getTodayEST(), sleep_score: null })
                    setShowLogModal(true)
                  }}
                  style={{ padding: '16px', textAlign: 'center' }}
                >
                  Sleep Score
                </Button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'Goals' && (
          <div>
            {healthGoals.length > 0 ? (
              <div className={styles.metricsCard}>
                <div className={styles.sectionHeader}>
                  <h3>Health Goals</h3>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <Button
                      unstyled
                      className={styles.linkBtn}
                      onClick={async () => {
                        if (user) {
                          try {
                            const { updateCategoryGoals } = await import('../lib/goalsDb')
                            await updateCategoryGoals(user.id, 'health')
                            await loadHealthGoals()
                            if (showToast && typeof showToast === 'function') {
                              showToast('Goals refreshed', 'success')
                            }
                          } catch (error) {
                            logError('Error refreshing goals', error)
                            if (showToast && typeof showToast === 'function') {
                              showToast('Error refreshing goals. Make sure SQL migrations are run.', 'error')
                            }
                          }
                        }
                      }}
                    >
                      Refresh
                    </Button>
                    <Button
                      unstyled
                      className={styles.linkBtn}
                      onClick={() => navigate('/goals')}
                    >
                      View All →
                    </Button>
                  </div>
                </div>
                <div className={styles.goalsList}>
                  {healthGoals.map(goal => {
                    const currentValue = goal.current_value || 0
                    const targetValue = goal.target_value || 0
                    const progress = targetValue > 0 
                      ? Math.min(100, (currentValue / targetValue) * 100) 
                      : 0
                    return (
                      <div key={goal.id} className={styles.goalCard}>
                        <div className={styles.goalHeader}>
                          <span className={styles.goalName}>
                            {formatGoalName(goal)}
                          </span>
                          <span className={styles.goalProgress}>{Math.round(progress)}%</span>
                        </div>
                        <div className={styles.goalBar}>
                          <div className={styles.goalBarFill} style={{ width: `${progress}%` }} />
                        </div>
                        <div className={styles.goalValues}>
                          {currentValue.toFixed(1)} / {targetValue} {goal.unit || ''}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : (
              <div className={styles.metricsCard}>
                <EmptyState
                  title="No health goals yet"
                  message="Create your first goal to start tracking progress over time."
                  actionLabel="Create goal"
                  onAction={() => navigate('/goals')}
                />
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
            setEditingMetricType(null)
            setShowLogModal(false)
          }}>
            <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>
                {editingMetricType 
                  ? `Log ${editingMetricType === 'weight' ? 'Weight' : editingMetricType === 'steps' ? 'Steps' : editingMetricType === 'sleep' ? 'Sleep' : editingMetricType === 'calories' ? 'Calories Burned' : editingMetricType === 'hrv' ? 'HRV' : editingMetricType === 'resting_heart_rate' ? 'Heart Rate' : editingMetricType === 'body_temp' ? 'Body Temperature' : editingMetricType === 'sleep_score' ? 'Sleep Score' : editingMetricType}${editingMetric?.date ? ` - ${new Date(editingMetric.date + 'T12:00:00').toLocaleDateString()}` : ''}`
                  : editingMetric?.date ? `Log Health Metrics - ${new Date(editingMetric.date + 'T12:00:00').toLocaleDateString()}` : 'Log Health Metrics'}
              </h2>
              <Button
                unstyled
                onClick={() => {
                  setEditingMetric(null)
                  setEditingMetricType(null)
                  setShowLogModal(false)
                }}
              >
                ✕
              </Button>
            </div>
            <div className={styles.editForm}>
              <InputField
                label="Date"
                type="date"
                required
                value={(editingMetric && editingMetric.date) || (showLogModal ? getTodayEST() : getTodayEST())}
                onChange={(e) => {
                  const currentMetric = editingMetric || {}
                  setEditingMetric({ ...currentMetric, date: e.target.value })
                }}
                max={getTodayEST()}
              />
              {/* Only show the field being edited, or all fields if editingMetricType is null */}
              {(!editingMetricType || editingMetricType === 'weight') && (
                <InputField
                  label="Weight (lbs)"
                  type="number"
                  step="0.1"
                  value={(editingMetric && editingMetric.weight) || ''}
                  onChange={(e) => {
                    const currentMetric = editingMetric || {}
                    setEditingMetric({ ...currentMetric, weight: parseFloat(e.target.value) || null })
                  }}
                  placeholder="Enter weight"
                />
              )}
              {(!editingMetricType || editingMetricType === 'steps') && (
                <InputField
                  label="Steps"
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
              )}
              {(!editingMetricType || editingMetricType === 'hrv') && (
                <InputField
                  label="HRV (ms)"
                  type="number"
                  value={(editingMetric && editingMetric.hrv) || ''}
                  onChange={(e) => {
                    const currentMetric = editingMetric || {}
                    setEditingMetric({ ...currentMetric, hrv: parseInt(e.target.value) || null })
                  }}
                  placeholder="Enter HRV"
                />
              )}
              {(!editingMetricType || editingMetricType === 'calories') && (
                <InputField
                  label="Calories Burned"
                  type="number"
                  value={(editingMetric && (editingMetric.calories_burned || editingMetric.calories)) || ''}
                  onChange={(e) => {
                    const currentMetric = editingMetric || {}
                    const val = parseInt(e.target.value) || null
                    setEditingMetric({ ...currentMetric, calories_burned: val, calories: val })
                  }}
                  placeholder="Enter calories burned"
                />
              )}
              {(!editingMetricType || editingMetricType === 'sleep') && (
                <InputField
                  label="Sleep Duration (minutes)"
                  type="number"
                  value={(editingMetric && editingMetric.sleep_time) || ''}
                  onChange={(e) => {
                    const currentMetric = editingMetric || {}
                    setEditingMetric({ ...currentMetric, sleep_time: e.target.value })
                  }}
                  placeholder="Enter minutes (e.g., 480 for 8 hours)"
                />
              )}
              {(!editingMetricType || editingMetricType === 'sleep_score') && (
                <InputField
                  label="Sleep Score (0-100)"
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
              )}
              {(!editingMetricType || editingMetricType === 'resting_heart_rate') && (
                <InputField
                  label="Resting Heart Rate (bpm)"
                  type="number"
                  value={(editingMetric && editingMetric.resting_heart_rate) || ''}
                  onChange={(e) => {
                    const currentMetric = editingMetric || {}
                    setEditingMetric({ ...currentMetric, resting_heart_rate: parseInt(e.target.value) || null })
                  }}
                  placeholder="Enter resting heart rate"
                />
              )}
              {(!editingMetricType || editingMetricType === 'body_temp') && (
                <InputField
                  label="Body Temperature (°F)"
                  type="number"
                  step="0.1"
                  value={(editingMetric && editingMetric.body_temp) || ''}
                  onChange={(e) => {
                    const currentMetric = editingMetric || {}
                    setEditingMetric({ ...currentMetric, body_temp: parseFloat(e.target.value) || null })
                  }}
                  placeholder="Enter body temperature"
                />
              )}
              <div className={styles.formActions}>
                <Button
                  unstyled
                  className={styles.saveBtn}
                  onClick={() => {
                    (async () => {
                      if (!user) return
                      if (!showToast || typeof showToast !== 'function') {
                        // showToast should always be provided by hook; keep silent if not
                        return
                      }
                      const metricToSave = editingMetric || { date: getTodayEST() }
                      if (!metricToSave.date) {
                        if (showToast && typeof showToast === 'function') {
                          showToast('Please select a date', 'error')
                        }
                        return
                      }
                      
                      // Validate inputs
                      const errors = []
                      try {
                        const validationModule = await import('../utils/validation')
                        const { 
                          validateWeight, 
                          validateSteps, 
                          validateHRV, 
                          validateCalories, 
                          validateSleepScore, 
                          validateRestingHeartRate, 
                          validateBodyTemperature 
                        } = validationModule || {}
                        
                        if (metricToSave.weight !== null && metricToSave.weight !== undefined && metricToSave.weight !== '') {
                          if (validateWeight && typeof validateWeight === 'function') {
                            const weightValidation = validateWeight(metricToSave.weight)
                            if (!weightValidation.valid) errors.push(`Weight: ${weightValidation.error}`)
                          }
                        }
                        if (metricToSave.steps !== null && metricToSave.steps !== undefined && metricToSave.steps !== '') {
                          if (validateSteps && typeof validateSteps === 'function') {
                            const stepsValidation = validateSteps(metricToSave.steps)
                            if (!stepsValidation.valid) errors.push(`Steps: ${stepsValidation.error}`)
                          }
                        }
                        if (metricToSave.hrv !== null && metricToSave.hrv !== undefined && metricToSave.hrv !== '') {
                          if (validateHRV && typeof validateHRV === 'function') {
                            const hrvValidation = validateHRV(metricToSave.hrv)
                            if (!hrvValidation.valid) errors.push(`HRV: ${hrvValidation.error}`)
                          }
                        }
                        if (metricToSave.calories !== null && metricToSave.calories !== undefined && metricToSave.calories !== '') {
                          if (validateCalories && typeof validateCalories === 'function') {
                            const caloriesValidation = validateCalories(metricToSave.calories)
                            if (!caloriesValidation.valid) errors.push(`Calories: ${caloriesValidation.error}`)
                          }
                        }
                        if (metricToSave.sleep_score !== null && metricToSave.sleep_score !== undefined && metricToSave.sleep_score !== '') {
                          if (validateSleepScore && typeof validateSleepScore === 'function') {
                            const sleepValidation = validateSleepScore(metricToSave.sleep_score)
                            if (!sleepValidation.valid) errors.push(`Sleep Score: ${sleepValidation.error}`)
                          }
                        }
                        if (metricToSave.resting_heart_rate !== null && metricToSave.resting_heart_rate !== undefined && metricToSave.resting_heart_rate !== '') {
                          if (validateRestingHeartRate && typeof validateRestingHeartRate === 'function') {
                            const restingHeartRateValidation = validateRestingHeartRate(metricToSave.resting_heart_rate)
                            if (!restingHeartRateValidation.valid) errors.push(`Resting Heart Rate: ${restingHeartRateValidation.error}`)
                          }
                        }
                        if (metricToSave.body_temp !== null && metricToSave.body_temp !== undefined && metricToSave.body_temp !== '') {
                          if (validateBodyTemperature && typeof validateBodyTemperature === 'function') {
                            const bodyTemperatureValidation = validateBodyTemperature(metricToSave.body_temp)
                            if (!bodyTemperatureValidation.valid) errors.push(`Body Temperature: ${bodyTemperatureValidation.error}`)
                          }
                        }
                      } catch (validationError) {
                        logError('Error loading validation functions', validationError)
                        // Continue without validation if import fails
                      }
                      
                      if (errors.length > 0) {
                        if (showToast && typeof showToast === 'function') {
                          showToast(errors.join(', '), 'error')
                        }
                        return
                      }
                      
                      try {
                        safeLogDebug('Saving health metrics', metricToSave)
                        // Use utility functions to ensure proper type conversion
                        const result = await saveMetricsToSupabase(user.id, metricToSave.date, {
                          weight: toNumber(metricToSave.weight),
                          steps: toInteger(metricToSave.steps), // INTEGER - must be whole number
                          hrv: toNumber(metricToSave.hrv),
                          caloriesBurned: toNumber(metricToSave.calories_burned || metricToSave.calories),
                          sleepTime: toNumber(metricToSave.sleep_time),
                          sleepScore: toNumber(metricToSave.sleep_score),
                          restingHeartRate: toNumber(metricToSave.resting_heart_rate),
                          bodyTemp: toNumber(metricToSave.body_temp)
                        })
                        safeLogDebug('Health metrics save result', result)
                        await loadAllData()
                        setEditingMetric(null)
                        setEditingMetricType(null)
                        setShowLogModal(false)
                        if (showToast && typeof showToast === 'function') {
                          showToast(result?.queued ? 'Saved locally — will sync when online.' : 'Health metrics saved successfully!', result?.queued ? 'info' : 'success', result?.queued ? 5000 : undefined)
                        }
                      } catch (e) {
                        // Only log unexpected errors (not table/column missing errors)
                        const isExpectedError = e.code === 'PGRST205' || 
                                                e.code === '42P01' ||
                                                e.code === '42703' ||
                                                e.message?.includes('Could not find the table') ||
                                                e.message?.includes('column') ||
                                                e.message?.includes('does not exist')
                        
                        if (!isExpectedError) {
                          // Better error logging
                          const errorDetails = {
                            message: e.message || 'Unknown error',
                            code: e.code,
                            details: e.details,
                            hint: e.hint,
                            stack: e.stack
                          }
                          logError('Error saving metrics', errorDetails)
                          logError('Health share error', e)
                          if (showToast && typeof showToast === 'function') {
                            const errorMessage = e.message || e.details || e.hint || 'Unknown error occurred'
                            showToast(`Failed to save metrics: ${errorMessage}. Please check console.`, 'error')
                          }
                        } else {
                          // For expected errors (table/column missing), show a less alarming message
                          if (showToast && typeof showToast === 'function') {
                            showToast('Metrics saved locally. Database sync will be available soon.', 'info')
                          }
                        }
                      }
                    })()
                  }}
                >
                  Save
                </Button>
                <Button
                  unstyled
                  className={styles.cancelBtn}
                  onClick={() => {
                    setEditingMetric(null)
                    setEditingMetricType(null)
                    setShowLogModal(false)
                  }}
                >
                  Cancel
                </Button>
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

      <ConfirmDialog
        isOpen={confirmState.open}
        title={confirmState.title}
        message={confirmState.message}
        confirmText={confirmState.action?.startsWith('delete') ? 'Delete' : 'Confirm'}
        cancelText="Cancel"
        isDestructive={confirmState.action?.startsWith('delete')}
        onClose={() => setConfirmState({ open: false, title: '', message: '', action: null, payload: null })}
        onConfirm={async () => {
          const action = confirmState.action
          const payload = confirmState.payload
          try {
            if (!user) return
            if (action === 'delete_metrics') {
              const date = payload?.date
              if (!date) return
              const { supabase } = await import('../lib/supabase')
              await supabase
                .from('daily_metrics')
                .delete()
                .eq('user_id', user.id)
                .eq('date', date)
              await loadAllData()
              showToast('Health metrics deleted', 'success')
            }
          } catch (error) {
            logError('Error deleting health metrics', error)
            showToast('Failed to delete health metrics', 'error')
          } finally {
            setConfirmState({ open: false, title: '', message: '', action: null, payload: null })
          }
        }}
      />

      {showShareModal && (() => {
        // Use selected metric from history, or fallback to today's metric
        const metricToShare = selectedMetricForShare || metrics.find(m => m.date === getTodayEST()) || {
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
            data={{ health: metricToShare }}
            onClose={() => {
              setShowShareModal(false)
              setSelectedMetricForShare(null)
            }}
          />
        )
      })()}

    </div>
  )
}

