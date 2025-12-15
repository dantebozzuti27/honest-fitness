import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { calculateStreakFromSupabase, getWorkoutsFromSupabase, getUserPreferences, getSocialFeedItems, getScheduledWorkoutsFromSupabase } from '../lib/supabaseDb'
import { getFitbitDaily, getMostRecentFitbitData } from '../lib/wearables'
import { getMealsFromSupabase, getNutritionRangeFromSupabase } from '../lib/nutritionDb'
import { getMetricsFromSupabase } from '../lib/supabaseDb'
import { getTodayEST, getYesterdayEST } from '../utils/dateUtils'
import { logError } from '../utils/logger'
import SideMenu from '../components/SideMenu'
import HomeButton from '../components/HomeButton'
import ShareCard from '../components/ShareCard'
import AddFriend from '../components/AddFriend'
import FriendRequests from '../components/FriendRequests'
import Spinner from '../components/Spinner'
import PredictiveInsights from '../components/PredictiveInsights'
import { getPendingFriendRequests } from '../lib/friendsDb'
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
  const [showFriendRequests, setShowFriendRequests] = useState(false)
  const [pendingRequestCount, setPendingRequestCount] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [pullDistance, setPullDistance] = useState(0)
  const [scheduledWorkouts, setScheduledWorkouts] = useState([])
  const feedContainerRef = useRef(null)
  const pullStartY = useRef(0)
  const isPulling = useRef(false)
  
  // Reload feed when filter changes
  useEffect(() => {
    if (user) {
      loadRecentLogs(user.id)
    }
  }, [feedFilter, user])

  const loadRecentLogs = async (userId, showRefreshIndicator = false, cursor = null) => {
    try {
      if (showRefreshIndicator) {
        setIsRefreshing(true)
      } else {
        setLoading(true)
      }
      
      const logs = []
      
      if (!userId) {
        setRecentLogs([])
        setLoading(false)
        setIsRefreshing(false)
        return
      }

      // OPTIMIZED: Get feed items with pagination support
      try {
        const feedItems = await getSocialFeedItems(userId, feedFilter, 20, cursor)
        
        if (feedItems && feedItems.length > 0) {
          feedItems.forEach((item) => {
            // Get user profile info
            const userProfile = item.user_profiles || null
            const authorName = userProfile?.display_name || userProfile?.username || 'User'
            const authorId = item.user_id
            const isOwnPost = authorId === userId
            
            // Use created_at timestamp if available
            const itemDate = item.created_at 
              ? new Date(item.created_at).toISOString().split('T')[0] 
              : (item.date || getTodayEST())
            
            // ShareCard expects data in format: { workout: {...} }, { nutrition: {...} }, or { health: {...} }
            // Ensure data is in correct format
            let cardData = item.data
            if (!cardData) {
              // Fallback: create empty data structure based on type
              if (item.type === 'nutrition') {
                cardData = { nutrition: {} }
              } else if (item.type === 'health') {
                cardData = { health: {} }
              } else {
                cardData = { workout: {} }
              }
            } else if (item.type === 'nutrition' && !cardData.nutrition) {
              // If data exists but not in correct format, wrap it
              cardData = { nutrition: cardData }
            } else if (item.type === 'health' && !cardData.health) {
              cardData = { health: cardData }
            } else if (item.type === 'workout' && !cardData.workout) {
              cardData = { workout: cardData }
            }
            
            const logEntry = {
              type: item.type || 'workout',
              date: itemDate,
              title: item.title || (item.type === 'nutrition' ? 'Daily Nutrition' : item.type === 'health' ? 'Health Metrics' : 'Workout'),
              subtitle: item.subtitle || '',
              data: cardData,
              shared: true,
              timestamp: item.created_at || new Date(itemDate + 'T12:00').toISOString(),
              authorId: authorId,
              authorName: authorName,
              authorProfile: userProfile,
              isOwnPost: isOwnPost
            }
            logs.push(logEntry)
          })
        }
      } catch (e) {
        logError('Error loading feed items', e)
      }
      
      // Sort by timestamp (newest first) - should already be sorted but ensure it
      logs.sort((a, b) => {
        const dateA = new Date(a.timestamp || a.date)
        const dateB = new Date(b.timestamp || b.date)
        return dateB - dateA
      })
      
      
      setRecentLogs(logs)
      setLoading(false)
      setIsRefreshing(false)
    } catch (error) {
      logError('Error in loadRecentLogs', error)
      setRecentLogs([])
      setLoading(false)
      setIsRefreshing(false)
    }
  }
  
  // Pull-to-refresh handlers (Twitter-style)
  const handleTouchStart = (e) => {
    const container = feedContainerRef.current
    if (!container) return
    
    const scrollTop = container.scrollTop
    
    // Only allow pull-to-refresh when at the top
    if (scrollTop <= 5) {
      pullStartY.current = e.touches[0].clientY
      isPulling.current = true
    }
  }
  
  const handleTouchMove = (e) => {
    if (!isPulling.current) return
    
    const currentY = e.touches[0].clientY
    const pullDistance = Math.max(0, currentY - pullStartY.current)
    
    // Limit pull distance and add resistance
    const maxPull = 120
    const resistance = 2.5
    const adjustedDistance = Math.min(pullDistance / resistance, maxPull)
    
    setPullDistance(adjustedDistance)
    
    // Prevent default scrolling when pulling down
    if (pullDistance > 10) {
      e.preventDefault()
    }
  }
  
  const handleTouchEnd = () => {
    if (!isPulling.current) return
    
    const threshold = 60 // Distance needed to trigger refresh
    
    if (pullDistance >= threshold && user) {
      // Haptic feedback on release
      if (navigator.vibrate) {
        navigator.vibrate([10, 20, 10]) // Success haptic pattern
      }
      // Trigger refresh
      loadRecentLogs(user.id, true)
    } else if (pullDistance > 10) {
      // Light haptic for insufficient pull
      if (navigator.vibrate) {
        navigator.vibrate(5)
      }
    }
    
    // Reset
    isPulling.current = false
    setPullDistance(0)
  }
  
  // Mouse drag support for desktop (optional)
  const handleMouseDown = (e) => {
    const container = feedContainerRef.current
    if (!container) return
    
    const scrollTop = container.scrollTop
    
    if (scrollTop <= 5) {
      pullStartY.current = e.clientY
      isPulling.current = true
    }
  }
  
  const handleMouseMove = (e) => {
    if (!isPulling.current) return
    
    const currentY = e.clientY
    const pullDistance = Math.max(0, currentY - pullStartY.current)
    const maxPull = 120
    const resistance = 2.5
    const adjustedDistance = Math.min(pullDistance / resistance, maxPull)
    
    setPullDistance(adjustedDistance)
  }
  
  const handleMouseUp = () => {
    if (!isPulling.current) return
    
    const threshold = 60
    
    if (pullDistance >= threshold && user) {
      loadRecentLogs(user.id, true)
    }
    
    isPulling.current = false
    setPullDistance(0)
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
              return getFitbitDaily(user.id, getYesterdayEST()).catch(() => null)
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
          
          // Load scheduled workouts
          if (mounted) {
            try {
              const scheduled = await getScheduledWorkoutsFromSupabase(user.id)
              const today = getTodayEST()
              const upcoming = (scheduled || []).filter(s => s.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5)
              if (mounted) {
                setScheduledWorkouts(upcoming)
              }
            } catch (e) {
              // Silently fail
            }
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
        loadPendingRequests()
      }
    }
    window.addEventListener('feedUpdated', handleFeedUpdate)
    
    // Load pending requests
    const loadPendingRequests = async () => {
      if (mounted && user) {
        try {
          const requests = await getPendingFriendRequests(user.id)
          if (mounted) {
            setPendingRequestCount(requests?.length || 0)
          }
        } catch (error) {
          // Silently fail
        }
      }
    }
    loadPendingRequests()
    
    return () => {
      mounted = false
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('feedUpdated', handleFeedUpdate)
    }
  }, [user, navigate, feedFilter]) // Add feedFilter to dependencies
  
  // Add event listeners for pull-to-refresh
  useEffect(() => {
    const container = feedContainerRef.current
    if (!container) return
    
    container.addEventListener('touchstart', handleTouchStart, { passive: false })
    container.addEventListener('touchmove', handleTouchMove, { passive: false })
    container.addEventListener('touchend', handleTouchEnd)
    container.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    
    return () => {
      container.removeEventListener('touchstart', handleTouchStart)
      container.removeEventListener('touchmove', handleTouchMove)
      container.removeEventListener('touchend', handleTouchEnd)
      container.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [handleTouchStart, handleTouchMove, handleTouchEnd, handleMouseDown, handleMouseMove, handleMouseUp])


  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading...</div>
      </div>
    )
  }

  const formatDate = (dateString) => {
    if (!dateString) return ''
    // Parse YYYY-MM-DD date string in local timezone (not UTC)
    const [year, month, day] = dateString.split('-').map(Number)
    const date = new Date(year, month - 1, day)
    
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    
    const compareDate = new Date(date)
    compareDate.setHours(0, 0, 0, 0)

    if (compareDate.getTime() === today.getTime()) {
      return 'Today'
    } else if (compareDate.getTime() === yesterday.getTime()) {
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

      <div className={styles.content} ref={feedContainerRef}>
        {/* Pull-to-refresh indicator */}
        {(pullDistance > 0 || isRefreshing) && (
          <div 
            className={styles.pullToRefresh}
            style={{ 
              transform: `translateY(${Math.max(0, pullDistance - 20)}px)`,
              opacity: Math.min(1, pullDistance / 60)
            }}
          >
            <div className={styles.pullToRefreshIcon}>
              {isRefreshing ? (
                <Spinner size="sm" color="primary" />
              ) : pullDistance >= 60 ? (
                <span style={{ 
                  fontSize: 'var(--icon-md)',
                  transform: 'rotate(180deg)',
                  display: 'inline-block',
                  transition: 'transform var(--transition-fast)'
                }}>↓</span>
              ) : (
                <span style={{ 
                  transform: `rotate(${pullDistance * 3}deg)`, 
                  display: 'inline-block',
                  fontSize: 'var(--icon-md)',
                  transition: 'transform var(--transition-fast)'
                }}>↓</span>
              )}
            </div>
            <span className={styles.pullToRefreshText}>
              {isRefreshing ? 'Refreshing...' : pullDistance >= 60 ? 'Release to refresh' : 'Pull to refresh'}
            </span>
          </div>
        )}
        
        {/* Predictive Insights */}
        {user && <PredictiveInsights />}
        
        {/* Upcoming Scheduled Workouts */}
        {scheduledWorkouts.length > 0 && (
          <div className={styles.scheduledWorkoutsSection}>
            <h2 className={styles.sectionTitle}>Upcoming Workouts</h2>
            <div className={styles.scheduledWorkoutsList}>
              {scheduledWorkouts.map((scheduled, idx) => {
                const date = new Date(scheduled.date + 'T12:00:00')
                const isToday = scheduled.date === getTodayEST()
                const isTomorrow = scheduled.date === new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]
                let dateLabel = ''
                if (isToday) {
                  dateLabel = 'Today'
                } else if (isTomorrow) {
                  dateLabel = 'Tomorrow'
                } else {
                  dateLabel = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
                }
                return (
                  <div key={idx} className={styles.scheduledWorkoutCard}>
                    <div className={styles.scheduledWorkoutDate}>{dateLabel}</div>
                    <div className={styles.scheduledWorkoutName}>
                      {scheduled.template_id === 'freestyle' ? 'Freestyle' : 'Workout'}
                    </div>
                    <button
                      className={styles.scheduledWorkoutAction}
                      onClick={() => navigate('/calendar')}
                    >
                      View Calendar
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}
        
        {/* Recent Activity Feed */}
        <div className={styles.feed}>
          <div className={styles.feedHeader}>
            <h2 className={styles.feedTitle}>Recent Activity</h2>
            <div className={styles.feedHeaderActions}>
              {pendingRequestCount > 0 && (
                <button 
                  className={styles.friendRequestsBtn}
                  onClick={() => setShowFriendRequests(true)}
                  aria-label="Friend Requests"
                >
                  <span className={styles.friendRequestsIcon}>👥</span>
                  {pendingRequestCount > 0 && (
                    <span className={styles.friendRequestsBadge}>{pendingRequestCount}</span>
                  )}
                </button>
              )}
              <button 
                className={styles.addFriendBtn}
                onClick={() => setShowAddFriend(true)}
                aria-label="Add Friend"
              >
                + Add Friend
              </button>
            </div>
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
                // Support all types: workout, nutrition, health
                if (log.data && (log.type === 'workout' || log.type === 'nutrition' || log.type === 'health')) {
                  return (
                    <div key={`${log.type}-${log.date}-${index}-${log.authorId || 'unknown'}`} className={styles.feedCardItem}>
                      {/* Show author header (Twitter-style) */}
                      <div className={styles.feedAuthor}>
                        {log.authorProfile?.profile_picture ? (
                          <img 
                            src={log.authorProfile.profile_picture} 
                            alt={log.authorName || 'You'}
                            className={styles.authorAvatar}
                          />
                        ) : (
                          <div className={styles.authorAvatarPlaceholder}>
                            {(log.authorName || 'You')[0].toUpperCase()}
                          </div>
                        )}
                        <div className={styles.authorInfo}>
                          <span className={styles.authorName}>
                            {log.isOwnPost ? 'You' : (log.authorName || 'User')}
                          </span>
                          <span className={styles.authorTimestamp}>
                            {formatDate(log.date)} · {log.timestamp ? new Date(log.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''}
                          </span>
                        </div>
                      </div>
                      {/* Show ShareCard for workout, nutrition, or health */}
                      <ShareCard 
                        type={log.type} 
                        data={log.data}
                      />
                    </div>
                  )
                }
                
                // Fallback for any unsupported items
                return null
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

      {showFriendRequests && (
        <FriendRequests 
          onClose={() => setShowFriendRequests(false)}
          onRequestHandled={() => {
            if (user) {
              loadRecentLogs(user.id)
              // Reload pending count
              getPendingFriendRequests(user.id).then(requests => {
                setPendingRequestCount(requests?.length || 0)
              })
            }
          }}
        />
      )}
    </div>
  )
}
