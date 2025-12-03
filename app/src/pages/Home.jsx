import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { hasExercises } from '../db'
import { initializeData } from '../utils/initData'
import { useAuth } from '../context/AuthContext'
import { calculateStreakFromSupabase } from '../lib/supabaseDb'
import { getFitbitDaily, getMostRecentFitbitData } from '../lib/wearables'
import { getTodayEST } from '../utils/dateUtils'
import styles from './Home.module.css'

export default function Home() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [streak, setStreak] = useState(0)
  const [loading, setLoading] = useState(true)
  const [fitbitSteps, setFitbitSteps] = useState(null)
  const [showQuickMenu, setShowQuickMenu] = useState(false)

  useEffect(() => {
    async function init() {
      // Initialize exercise data if not present
      const hasData = await hasExercises()
      if (!hasData) {
        await initializeData()
      }
      
      // Get streak and Fitbit data if logged in
      if (user) {
        try {
          const currentStreak = await calculateStreakFromSupabase(user.id)
          setStreak(currentStreak)
          
          // Load Fitbit steps (try today, then yesterday, then most recent)
          try {
            const today = getTodayEST()
            let fitbit = await getFitbitDaily(user.id, today)
            if (!fitbit) {
              const { getYesterdayEST } = await import('../utils/dateUtils')
              const yesterday = getYesterdayEST()
              fitbit = await getFitbitDaily(user.id, yesterday)
            }
            if (!fitbit) {
              fitbit = await getMostRecentFitbitData(user.id)
            }
            if (fitbit && fitbit.steps != null) {
              setFitbitSteps({
                steps: Number(fitbit.steps),
                date: fitbit.date
              })
            }
          } catch (fitbitError) {
            // Silently fail - Fitbit data is optional
          }
        } catch (e) {
          // Silently fail - data will load on retry
        }
      }
      setLoading(false)
    }
    init()
    
    // Check for Fitbit callback redirects
    const params = new URLSearchParams(window.location.search)
    const fitbitConnected = params.get('fitbit_connected')
    const fitbitError = params.get('fitbit_error')
    
    if (fitbitConnected) {
      navigate('/wearables?fitbit_connected=true', { replace: true })
    } else if (fitbitError) {
      navigate(`/wearables?fitbit_error=${fitbitError}`, { replace: true })
    }
  }, [user, navigate])

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading...</div>
      </div>
    )
  }

  const navItems = [
    { id: 'fitness', label: 'Fitness', path: '/workout' },
    { id: 'nutrition', label: 'Nutrition', path: '/ghost-mode' },
    { id: 'health', label: 'Health', path: '/health' },
    { id: 'analytics', label: 'Analytics', path: '/analytics' },
    { id: 'schedule', label: 'Schedule', path: '/calendar' },
    { id: 'account', label: 'Account', path: '/account' }
  ]

  const quickActions = [
    { id: 'workout', label: 'Start Workout', path: '/workout' },
    { id: 'meal', label: 'Log Meal', path: '/ghost-mode' },
    { id: 'metrics', label: 'Log Metrics', path: '/workout' }
  ]

  const handleQuickAction = (path) => {
    setShowQuickMenu(false)
    navigate(path)
  }

  return (
    <div className={styles.container}>
      {/* Quick Action Button */}
      <button 
        className={styles.quickActionBtn}
        onClick={() => setShowQuickMenu(!showQuickMenu)}
        aria-label="Quick actions"
      >
        <span className={styles.plusIcon}>+</span>
      </button>

      {/* Quick Action Menu */}
      {showQuickMenu && (
        <>
          <div 
            className={styles.menuOverlay}
            onClick={() => setShowQuickMenu(false)}
          />
          <div className={styles.quickMenu}>
            {quickActions.map(action => (
              <button
                key={action.id}
                className={styles.quickMenuItem}
                onClick={() => handleQuickAction(action.path)}
              >
                <span className={styles.quickMenuLabel}>{action.label}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <div className={styles.content}>
        {/* Fitbit Steps at Top */}
        {fitbitSteps && (
          <div className={styles.stepsCard}>
            <div className={styles.stepsHeader}>
              <span className={styles.stepsLabel}>Today's Steps</span>
              {fitbitSteps.date && fitbitSteps.date !== getTodayEST() && (
                <span className={styles.stepsDate}>{fitbitSteps.date}</span>
              )}
            </div>
            <div className={styles.stepsValue}>
              {fitbitSteps.steps.toLocaleString()}
            </div>
            {!fitbitSteps.date || fitbitSteps.date === getTodayEST() ? (
              <div className={styles.stepsSubtext}>Keep moving!</div>
            ) : (
              <div className={styles.stepsSubtext}>Last recorded</div>
            )}
          </div>
        )}

        {/* Streak Card */}
        {streak > 0 && (
          <div className={styles.streakCard}>
            <div className={styles.streakRow}>
              <span className={styles.streakNumber}>{streak}</span>
            </div>
            <span className={styles.streakLabel}>day streak</span>
          </div>
        )}

        {/* Navigation Grid */}
        <div className={styles.navGrid}>
          {navItems.map(item => (
            <button
              key={item.id}
              className={styles.navItem}
              onClick={() => navigate(item.path)}
            >
              <div className={styles.navLabel}>{item.label}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
