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
import FriendRequests from '../components/FriendRequests'
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
  
  // Reload feed when filter changes
  useEffect(() => {
    if (user) {
      console.log('[FEED DEBUG] Filter changed, reloading feed:', feedFilter)
      loadRecentLogs(user.id)
    }
  }, [feedFilter, user])

  const loadRecentLogs = async (userId) => {
    try {
      const logs = []
      
      if (!userId) {
        setRecentLogs([])
        setLoading(false)
        return
      }

      // SIMPLIFIED: Just get workouts from feed - that's all we need
      try {
        console.log('[FEED DEBUG] Loading feed with filter:', feedFilter, 'userId:', userId)
        const feedItems = await getSocialFeedItems(userId, feedFilter, 100)
        console.log('[FEED DEBUG] Received feedItems:', feedItems?.length || 0)
        
        if (feedItems && feedItems.length > 0) {
          console.log('[FEED DEBUG] Processing', feedItems.length, 'feed items')
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
            
            // ShareCard expects data in format: { workout: {...} }
            // item.data already has this structure from getSocialFeedItems
            const logEntry = {
              type: item.type || 'workout',
              date: itemDate,
              title: item.title || 'Workout',
              subtitle: item.subtitle || '',
              data: item.data || { workout: {} }, // Already in correct format: { workout: {...} }
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
      
      console.log('[FEED DEBUG] Final logs count:', logs.length)
      if (logs.length > 0) {
        console.log('[FEED DEBUG] Sample log entry:', logs[0])
      }
      
      setRecentLogs(logs)
      setLoading(false)
    } catch (error) {
      logError('Error in loadRecentLogs', error)
      setRecentLogs([])
      setLoading(false)
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
                // ALL items in feed are workouts displayed as ShareCards (Twitter-like)
                if (log.type === 'workout' && log.data) {
                  return (
                    <div key={`workout-${log.date}-${index}-${log.authorId || 'unknown'}`} className={styles.feedCardItem}>
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
                      {/* Show ShareCard for workout */}
                      <ShareCard 
                        type="workout" 
                        data={log.data}
                      />
                    </div>
                  )
                }
                
                // Fallback for any non-workout items (shouldn't happen, but just in case)
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
