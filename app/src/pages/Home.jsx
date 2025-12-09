import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { calculateStreakFromSupabase, getWorkoutsFromSupabase, getUserPreferences, getSocialFeedItems } from '../lib/supabaseDb'
import { getFitbitDaily, getMostRecentFitbitData } from '../lib/wearables'
import { getMealsFromSupabase, getNutritionRangeFromSupabase } from '../lib/nutritionDb'
import { getMetricsFromSupabase } from '../lib/supabaseDb'
import { getTodayEST } from '../utils/dateUtils'
import { logError } from '../utils/logger'
import SideMenu from '../components/SideMenu'
import HomeButton from '../components/HomeButton'
import ShareCard from '../components/ShareCard'
import AddFriend from '../components/AddFriend'
import styles from './Home.module.css'

export default function Home() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [streak, setStreak] = useState(0)
  const [loading, setLoading] = useState(true)
  const [fitbitSteps, setFitbitSteps] = useState(null)
  const [recentLogs, setRecentLogs] = useState([])
  const [profilePicture, setProfilePicture] = useState(null)
  const [feedFilter, setFeedFilter] = useState('all') // 'all', 'me', 'friends'
  const [showAddFriend, setShowAddFriend] = useState(false)

  const loadRecentLogs = async (userId) => {
    try {
      const logs = []
      const today = getTodayEST()
      const startDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

      // Load shared feed items from database (social feed with friends)
      try {
        let sharedItems = []
        
        // Try database first (social feed)
        if (userId) {
          try {
            sharedItems = await getSocialFeedItems(userId, feedFilter, 50)
          } catch (dbError) {
            // If database fails, fallback to localStorage
            // Silently ignore PGRST205 errors (table doesn't exist)
            if (dbError.code !== 'PGRST205' && !dbError.message?.includes('Could not find the table')) {
              logError('Error loading feed from database, using localStorage', dbError)
            }
            sharedItems = JSON.parse(localStorage.getItem('sharedToFeed') || '[]')
          }
        } else {
          // Not logged in, use localStorage
          sharedItems = JSON.parse(localStorage.getItem('sharedToFeed') || '[]')
        }
        
        if (sharedItems && sharedItems.length > 0) {
          sharedItems.forEach((item) => {
            // Use created_at timestamp if available, otherwise use date
            const itemDate = item.created_at 
              ? new Date(item.created_at).toISOString().split('T')[0] 
              : (item.timestamp ? new Date(item.timestamp).toISOString().split('T')[0] : (item.date || today))
            
            // Get user profile info if available
            const userProfile = item.user_profiles || null
            const authorName = userProfile?.display_name || userProfile?.username || 'User'
            const authorId = item.user_id
            const isOwnPost = authorId === userId
            
            // Ensure workout data has correct structure for ShareCard
            let workoutData = item.data || {}
            
            // If data is a string (JSONB from database), parse it
            if (typeof workoutData === 'string') {
              try {
                workoutData = JSON.parse(workoutData)
              } catch (e) {
                logError('Error parsing feed item data', e)
                workoutData = {}
              }
            }
            
            if (item.type === 'workout' && workoutData) {
              // If workout has workout_exercises (from Supabase), transform it
              if (workoutData.workout_exercises && !workoutData.exercises) {
                workoutData = {
                  ...workoutData,
                  exercises: (workoutData.workout_exercises || []).map(ex => ({
                    id: ex.id,
                    name: ex.exercise_name || ex.name,
                    category: ex.category,
                    bodyPart: ex.body_part || ex.bodyPart,
                    equipment: ex.equipment,
                    stacked: ex.stacked || false,
                    stackGroup: ex.stack_group || ex.stackGroup || null,
                    sets: (ex.workout_sets || ex.sets || []).map(set => ({
                      weight: set.weight,
                      reps: set.reps,
                      time: set.time,
                      speed: set.speed,
                      incline: set.incline
                    }))
                  }))
                }
              }
              // Ensure exercises array exists (for workouts)
              if (!workoutData.exercises) {
                workoutData.exercises = []
              }
            } else if (item.type !== 'workout') {
              // For non-workout items, use data as-is
              workoutData = item.data || {}
            }
            
            const logEntry = {
              type: item.type || 'workout',
              date: itemDate,
              title: item.title || 'Shared Item',
              subtitle: item.subtitle || '',
              data: workoutData, // This is already the workout/nutrition/health object
              shared: true,
              timestamp: item.created_at || item.timestamp || new Date(itemDate + 'T12:00').toISOString(),
              authorId: authorId,
              authorName: authorName,
              authorProfile: userProfile,
              isOwnPost: isOwnPost
            }
            // Add shared item to logs
            logs.push(logEntry)
          })
        }
      } catch (e) {
        logError('Error loading shared items', e)
      }

      // Fetch recent workouts (non-shared, for regular feed items)
      try {
        const workouts = await getWorkoutsFromSupabase(userId)
        if (workouts && workouts.length > 0) {
          workouts.slice(0, 10).forEach(workout => {
            // Only add if not already in shared items (avoid duplicates)
            const isShared = logs.some(log => 
              log.type === 'workout' && 
              log.date === workout.date && 
              log.shared
            )
            
            if (!isShared) {
              // Transform workout data to match ShareCard format
              const transformedWorkout = {
                ...workout,
                id: workout.id,
                date: workout.date,
                duration: workout.duration || 0,
                templateName: workout.template_name || 'Freestyle Workout',
                exercises: (workout.workout_exercises || []).map(ex => ({
                  id: ex.id,
                  name: ex.exercise_name,
                  category: ex.category,
                  bodyPart: ex.body_part,
                  equipment: ex.equipment,
                  stacked: ex.stacked || false,
                  stackGroup: ex.stack_group || null,
                  sets: (ex.workout_sets || []).map(set => ({
                    weight: set.weight,
                    reps: set.reps,
                    time: set.time,
                    speed: set.speed,
                    incline: set.incline
                  }))
                }))
              }
              
              logs.push({
                type: 'workout',
                date: workout.date,
                title: workout.template_name || 'Freestyle Workout',
                subtitle: `${Math.floor((workout.duration || 0) / 60)}:${String((workout.duration || 0) % 60).padStart(2, '0')}`,
                data: transformedWorkout,
                shared: false,
                timestamp: workout.created_at ? new Date(workout.created_at).toISOString() : new Date(workout.date + 'T12:00').toISOString()
              })
            }
          })
        }
      } catch (e) {
        logError('Error loading workouts for feed', e)
      }

      // Fetch recent meals
      try {
        const nutritionData = await getNutritionRangeFromSupabase(userId, startDate, today)
        if (nutritionData && nutritionData.length > 0) {
          nutritionData.forEach(day => {
            if (day.meals && day.meals.length > 0) {
              day.meals.forEach(meal => {
                logs.push({
                  type: 'meal',
                  date: day.date,
                  title: meal.name || 'Meal',
                  subtitle: `${meal.calories || 0} calories`,
                  data: meal,
                  shared: false,
                  timestamp: meal.created_at ? new Date(meal.created_at).toISOString() : new Date(day.date + 'T12:00').toISOString()
                })
              })
            }
          })
        }
      } catch (e) {
        logError('Error loading meals for feed', e)
      }

      // Fetch recent health metrics
      try {
        const metrics = await getMetricsFromSupabase(userId, startDate, today)
        if (metrics && metrics.length > 0) {
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
                  data: metric,
                  shared: false,
                  timestamp: metric.created_at ? new Date(metric.created_at).toISOString() : new Date(metric.date + 'T12:00').toISOString()
                })
              }
            }
          })
        }
      } catch (e) {
        logError('Error loading health metrics for feed', e)
      }

      // Sort by timestamp/date (newest first) and limit to 20
      logs.sort((a, b) => {
        const dateA = a.timestamp ? new Date(a.timestamp) : new Date(a.date + 'T' + (a.data?.time || '12:00'))
        const dateB = b.timestamp ? new Date(b.timestamp) : new Date(b.date + 'T' + (b.data?.time || '12:00'))
        return dateB - dateA
      })
      const sortedLogs = logs.slice(0, 20)
      setRecentLogs(sortedLogs)
      
    } catch (e) {
      logError('Error loading recent logs', e)
      setRecentLogs([])
    }
  }

  useEffect(() => {
    let mounted = true
    
    async function init() {
      // No seed data initialization needed
      
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
    
    // Listen for feed updates
    const handleFeedUpdate = () => {
      if (mounted && user) {
        loadRecentLogs(user.id)
      }
    }
    window.addEventListener('feedUpdated', handleFeedUpdate)
    
    return () => {
      mounted = false
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('feedUpdated', handleFeedUpdate)
    }
  }, [user, navigate, feedFilter]) // Add feedFilter to dependencies


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
          <div className={styles.feedHeader}>
            <h2 className={styles.feedTitle}>Recent Activity</h2>
            <button 
              className={styles.addFriendBtn}
              onClick={() => setShowAddFriend(true)}
              aria-label="Add Friend"
            >
              + Add Friend
            </button>
          </div>
          
          {/* Feed Filters */}
          <div className={styles.feedFilters}>
            <button
              className={`${styles.filterBtn} ${feedFilter === 'all' ? styles.active : ''}`}
              onClick={() => setFeedFilter('all')}
            >
              All
            </button>
            <button
              className={`${styles.filterBtn} ${feedFilter === 'me' ? styles.active : ''}`}
              onClick={() => setFeedFilter('me')}
            >
              Me
            </button>
            <button
              className={`${styles.filterBtn} ${feedFilter === 'friends' ? styles.active : ''}`}
              onClick={() => setFeedFilter('friends')}
            >
              Friends
            </button>
          </div>
          {loading ? (
            <div className={styles.emptyFeed}>
              <p>Loading...</p>
            </div>
          ) : recentLogs.length === 0 ? (
            <div className={styles.emptyFeed}>
              <p>No recent activity</p>
              <p className={styles.emptyFeedSubtext}>Start logging workouts, meals, or health metrics to see them here</p>
              <p className={styles.emptyFeedSubtext} style={{fontSize: '12px', marginTop: '8px'}}>Or share items to your feed using the share button</p>
            </div>
          ) : (
            <div className={styles.feedList}>
              {recentLogs.map((log, index) => {
                // Show ShareCard for shared workouts, nutrition, and health items
                if (log.shared && (log.type === 'workout' || log.type === 'nutrition' || log.type === 'health')) {
                  // Ensure data exists and has the correct structure
                  if (!log.data) {
                    return null
                  }
                  
                  return (
                    <div key={`${log.type}-${log.date}-${index}-shared`} className={styles.feedCardItem}>
                      {!log.isOwnPost && log.authorName && (
                        <div className={styles.feedAuthor}>
                          {log.authorProfile?.profile_picture ? (
                            <img 
                              src={log.authorProfile.profile_picture} 
                              alt={log.authorName}
                              className={styles.authorAvatar}
                            />
                          ) : (
                            <div className={styles.authorAvatarPlaceholder}>
                              {log.authorName[0].toUpperCase()}
                            </div>
                          )}
                          <span className={styles.authorName}>{log.authorName}</span>
                        </div>
                      )}
                      <ShareCard 
                        type={log.type} 
                        data={
                          log.type === 'workout' 
                            ? { workout: log.data }
                            : log.type === 'nutrition'
                            ? { nutrition: log.data }
                            : { health: log.data }
                        } 
                      />
                    </div>
                  )
                }
                
                // Show regular feed item for non-shared items
                return (
                  <div key={`${log.type}-${log.date}-${index}-${log.shared ? 'shared' : ''}`} className={styles.feedItem}>
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
                        {log.shared && <span className={styles.feedItemShared}>· Shared</span>}
                      </div>
                      <div className={styles.feedItemTitle}>{log.title}</div>
                      {log.subtitle && (
                        <div className={styles.feedItemSubtitle}>{log.subtitle}</div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {showAddFriend && (
        <AddFriend 
          onClose={() => setShowAddFriend(false)}
          onFriendAdded={() => {
            setShowAddFriend(false)
            if (user) {
              loadRecentLogs(user.id)
            }
          }}
        />
      )}
    </div>
  )
}
