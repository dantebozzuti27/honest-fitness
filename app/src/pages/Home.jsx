import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { hasExercises } from '../db'
import { initializeData } from '../utils/initData'
import { useAuth } from '../context/AuthContext'
import { calculateStreakFromSupabase, getWorkoutsFromSupabase, getUserPreferences } from '../lib/supabaseDb'
import { getFitbitDaily, getMostRecentFitbitData } from '../lib/wearables'
import { getMealsFromSupabase, getNutritionRangeFromSupabase } from '../lib/nutritionDb'
import { getMetricsFromSupabase } from '../lib/supabaseDb'
import { getTodayEST } from '../utils/dateUtils'
import BottomNav from '../components/BottomNav'
import SideMenu from '../components/SideMenu'
import HomeButton from '../components/HomeButton'
import styles from './Home.module.css'

export default function Home() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [streak, setStreak] = useState(0)
  const [loading, setLoading] = useState(true)
  const [fitbitSteps, setFitbitSteps] = useState(null)
  const [recentLogs, setRecentLogs] = useState([])
  const [profilePicture, setProfilePicture] = useState(null)

  useEffect(() => {
    let mounted = true
    
    async function init() {
      // Initialize exercise data if not present (non-blocking)
      hasExercises().then(hasData => {
        if (!hasData && mounted) {
          initializeData().catch(() => {}) // Don't block on this
        }
      })
      
      // Get streak, Fitbit data, and recent logs if logged in
      if (user) {
        try {
          // Load profile picture once
          getUserPreferences(user.id).then(prefs => {
            if (mounted && prefs?.profile_picture) {
              setProfilePicture(prefs.profile_picture)
            }
          }).catch(() => {})
          
          // Load data in parallel
          const [currentStreak] = await Promise.all([
            calculateStreakFromSupabase(user.id)
          ])
          
          if (mounted) {
            setStreak(currentStreak)
          }
          
          // Load Fitbit steps (try today, then yesterday, then most recent) - non-blocking
          getTodayEST().then(today => {
            return getFitbitDaily(user.id, today).catch(() => null)
          }).then(fitbit => {
            if (!fitbit && mounted) {
              return import('../utils/dateUtils').then(({ getYesterdayEST }) => {
                return getFitbitDaily(user.id, getYesterdayEST()).catch(() => null)
              })
            }
            return fitbit
          }).then(fitbit => {
            if (!fitbit && mounted) {
              return getMostRecentFitbitData(user.id).catch(() => null)
            }
            return fitbit
          }).then(fitbit => {
            if (mounted && fitbit && fitbit.steps != null) {
              setFitbitSteps({
                steps: Number(fitbit.steps),
                date: fitbit.date
              })
            }
          }).catch(() => {})

          // Load recent logs for feed - await this so feed loads
          if (mounted) {
            await loadRecentLogs(user.id)
          }
        } catch (e) {
          // Silently fail - data will load on retry
        }
      }
      
      if (mounted) {
        setLoading(false)
      }
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
    
    // Refresh profile picture when visibility changes (only once)
    const handleVisibilityChange = async () => {
      if (!document.hidden && user && mounted) {
        try {
          const prefs = await getUserPreferences(user.id)
          if (mounted && prefs?.profile_picture) {
            setProfilePicture(prefs.profile_picture)
          }
        } catch (e) {
          // Silently fail
        }
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    
    return () => {
      mounted = false
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [user, navigate])

  const loadRecentLogs = async (userId) => {
    try {
      const logs = []
      const today = getTodayEST()
      const startDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

      // Fetch recent workouts
      try {
        const workouts = await getWorkoutsFromSupabase(userId)
        workouts.slice(0, 10).forEach(workout => {
          logs.push({
            type: 'workout',
            date: workout.date,
            title: workout.template_name || 'Freestyle Workout',
            // Duration is in seconds, format as MM:SS
            subtitle: `${Math.floor((workout.duration || 0) / 60)}:${String((workout.duration || 0) % 60).padStart(2, '0')}`,
            data: workout
          })
        })
      } catch (e) {
        // Silently fail
      }

      // Fetch recent meals
      try {
        const nutritionData = await getNutritionRangeFromSupabase(userId, startDate, today)
        nutritionData.forEach(day => {
          if (day.meals && day.meals.length > 0) {
            day.meals.forEach(meal => {
              logs.push({
                type: 'meal',
                date: day.date,
                title: meal.name,
                subtitle: `${meal.calories || 0} calories`,
                data: meal
              })
            })
          }
        })
      } catch (e) {
        // Silently fail
      }

      // Fetch recent health metrics
      try {
        const metrics = await getMetricsFromSupabase(userId, startDate, today)
        metrics.forEach(metric => {
          if (metric.steps || metric.weight || metric.hrv || metric.sleep_time) {
            const parts = []
            if (metric.steps) parts.push(`${metric.steps.toLocaleString()} steps`)
            if (metric.weight) parts.push(`${metric.weight}lbs`)
            if (metric.hrv) parts.push(`HRV: ${Math.round(metric.hrv)}ms`)
            if (metric.sleep_time) {
              const h = Math.floor(metric.sleep_time / 60)
              const m = Math.round(metric.sleep_time % 60)
              parts.push(`Sleep: ${h}:${m.toString().padStart(2, '0')}`)
            }
            if (parts.length > 0) {
              logs.push({
                type: 'health',
                date: metric.date,
                title: 'Health Metrics',
                subtitle: parts.join(' • '),
                data: metric
              })
            }
          }
        })
      } catch (e) {
        // Silently fail
      }

      // Sort by date (newest first) and limit to 20
      logs.sort((a, b) => new Date(b.date + 'T' + (b.data?.time || '12:00')) - new Date(a.date + 'T' + (a.data?.time || '12:00')))
      const sortedLogs = logs.slice(0, 20)
      setRecentLogs(sortedLogs)
      console.log('Loaded logs:', sortedLogs.length, sortedLogs)
    } catch (e) {
      console.error('Error loading recent logs:', e)
      // Silently fail
    }
  }

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading...</div>
      </div>
    )
  }

  const formatDate = (dateString) => {
    const date = new Date(dateString)
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    if (date.toDateString() === today.toDateString()) {
      return 'Today'
    } else if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday'
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    }
  }

  const getTypeLabel = (type) => {
    switch (type) {
      case 'workout': return 'Workout'
      case 'meal': return 'Meal'
      case 'health': return 'Health'
      default: return type
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <SideMenu />
        <div className={styles.logoContainer}>
          <h1 className={styles.logo}>ECHELON</h1>
        </div>
        <HomeButton />
      </div>

      <div className={styles.content}>
        {/* Recent Activity Feed */}
        <div className={styles.feed}>
          <h2 className={styles.feedTitle}>Recent Activity</h2>
          {recentLogs.length === 0 ? (
            <div className={styles.emptyFeed}>
              <p>No recent activity</p>
              <p className={styles.emptyFeedSubtext}>Start logging workouts, meals, or health metrics to see them here</p>
            </div>
          ) : (
            <div className={styles.feedList}>
              {recentLogs.map((log, index) => (
                <div key={index} className={styles.feedItem}>
                  <div className={styles.feedItemIcon}>
                    {profilePicture ? (
                      <img src={profilePicture} alt="Profile" />
                    ) : (
                      log.type === 'workout' ? 'W' : log.type === 'meal' ? 'M' : 'H'
                    )}
                  </div>
                  <div className={styles.feedItemContent}>
                    <div className={styles.feedItemHeader}>
                      <span className={styles.feedItemType}>{getTypeLabel(log.type)}</span>
                      <span className={styles.feedItemDate}>· {formatDate(log.date)}</span>
                    </div>
                    <div className={styles.feedItemTitle}>{log.title}</div>
                    {log.subtitle && (
                      <div className={styles.feedItemSubtitle}>{log.subtitle}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <BottomNav />
    </div>
  )
}
