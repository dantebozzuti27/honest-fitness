import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { calculateStreakFromSupabase, getWorkoutsFromSupabase } from '../lib/db/workoutsDb'
import { getUserPreferences } from '../lib/db/userPreferencesDb'
import { getSocialFeedItems, deleteFeedItemFromSupabase } from '../lib/db/feedDb'
import { getScheduledWorkoutsFromSupabase } from '../lib/db/scheduledWorkoutsDb'
import { getFitbitDaily, getMostRecentFitbitData } from '../lib/wearables'
import { getMealsFromSupabase, getNutritionRangeFromSupabase } from '../lib/nutritionDb'
import { getMetricsFromSupabase } from '../lib/db/metricsDb'
import { getTodayEST, getYesterdayEST } from '../utils/dateUtils'
import { logError } from '../utils/logger'
import SideMenu from '../components/SideMenu'
import HomeButton from '../components/HomeButton'
import ShareCard from '../components/ShareCard'
import AddFriend from '../components/AddFriend'
import FriendRequests from '../components/FriendRequests'
import Spinner from '../components/Spinner'
import { getPendingFriendRequests } from '../lib/friendsDb'
import { getReadinessScore } from '../lib/readiness'
import { PeopleIcon } from '../components/Icons'
import Skeleton from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import Button from '../components/Button'
import { useHaptic } from '../hooks/useHaptic'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'
import ConfirmDialog from '../components/ConfirmDialog'
import styles from './Home.module.css'

export default function Home() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const haptic = useHaptic()
  const { toast, showToast, hideToast } = useToast()
  const [streak, setStreak] = useState(0)
  const [loading, setLoading] = useState(true)
  const [fitbitSteps, setFitbitSteps] = useState(null)
  const [recentLogs, setRecentLogs] = useState([])
  const [profilePicture, setProfilePicture] = useState(null)
  const [feedFilter, setFeedFilter] = useState('all') // 'all', 'me', 'friends'
  const [showAddFriend, setShowAddFriend] = useState(false)
  const [addFriendPrefill, setAddFriendPrefill] = useState('')
  const [showFriendRequests, setShowFriendRequests] = useState(false)
  const [pendingRequestCount, setPendingRequestCount] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [pullDistance, setPullDistance] = useState(0)
  const [scheduledWorkouts, setScheduledWorkouts] = useState([])
  const [readiness, setReadiness] = useState(null) // { score, zone, date, ... } or null
  const [resumeSession, setResumeSession] = useState(null) // { sessionType: 'workout'|'recovery', timestamp, hasExercises }
  const [privateModeUntil, setPrivateModeUntil] = useState(null) // timestamp ms; when set, redact timestamps/notes in feed
  const feedContainerRef = useRef(null)
  const pullStartY = useRef(0)
  const isPulling = useRef(false)
  const shownErrorsRef = useRef({ feed: false, init: false, scheduled: false, pending: false })
  const confirmResolverRef = useRef(null)
  const [confirmDialog, setConfirmDialog] = useState({
    open: false,
    title: 'Confirm',
    message: '',
    confirmText: 'Confirm',
    cancelText: 'Cancel',
    isDestructive: false
  })

  const confirmAsync = ({ title, message, confirmText = 'Confirm', cancelText = 'Cancel', isDestructive = false }) => {
    return new Promise((resolve) => {
      confirmResolverRef.current = resolve
      setConfirmDialog({
        open: true,
        title,
        message,
        confirmText,
        cancelText,
        isDestructive
      })
    })
  }

  const resolveConfirm = (result) => {
    setConfirmDialog(prev => ({ ...prev, open: false }))
    const resolve = confirmResolverRef.current
    confirmResolverRef.current = null
    if (resolve) resolve(result)
  }
  
  // Reload feed when filter changes
  useEffect(() => {
    if (user) {
      loadRecentLogs(user.id)
    }
  }, [feedFilter, user])

  // Deep-link: allow Command Palette (or other surfaces) to open Add Friend directly
  useEffect(() => {
    const state = location?.state
    if (state?.openAddFriend) {
      setAddFriendPrefill(typeof state.addFriendQuery === 'string' ? state.addFriendQuery : '')
      setShowAddFriend(true)
      // Clear state so refresh/back doesn't reopen
      navigate(location.pathname, { replace: true, state: {} })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location?.state])

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
              id: item.id,
              source: 'feed_item',
              type: item.type || 'workout',
              date: itemDate,
              title: item.title || (item.type === 'nutrition' ? 'Daily Nutrition' : item.type === 'health' ? 'Health Metrics' : 'Workout'),
              subtitle: item.subtitle || '',
              data: cardData,
              shared: true,
              visibility: item.visibility || 'public',
              timestamp: item.created_at || new Date(itemDate + 'T12:00').toISOString(),
              authorId: authorId,
              authorName: authorName,
              authorProfile: userProfile,
              isOwnPost: isOwnPost
            }
            // Safety rail: never show someone else's private posts, even if a backend policy misconfiguration leaks them.
            if (logEntry.visibility === 'private' && !isOwnPost) {
              return
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
      if (!shownErrorsRef.current.feed && showToast && typeof showToast === 'function') {
        shownErrorsRef.current.feed = true
        showToast('Failed to load your feed. Pull to refresh to retry.', 'error')
      }
      setRecentLogs([])
      setLoading(false)
      setIsRefreshing(false)
    }
  }

  const handleDeletePost = async (log) => {
    if (!user?.id) return
    if (!log?.id || log.source !== 'feed_item' || !log.isOwnPost) return

    const ok = await confirmAsync({
      title: 'Delete post?',
      message: 'This will remove the post from your feed.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      isDestructive: true
    })
    if (!ok) return

    try {
      await deleteFeedItemFromSupabase(log.id, user.id)
      showToast('Post deleted.', 'success')
      await loadRecentLogs(user.id, false)
    } catch (e) {
      logError('Failed to delete feed post', e)
      showToast('Failed to delete post. Please try again.', 'error')
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
      haptic?.success?.()
      // Trigger refresh
      loadRecentLogs(user.id, true)
    } else if (pullDistance > 10) {
      haptic?.light?.()
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
          ;(async () => {
            try {
              const today = getTodayEST()
              let fitbit = await getFitbitDaily(user.id, today).catch(() => null)
              if (!fitbit && mounted) {
                fitbit = await getFitbitDaily(user.id, getYesterdayEST()).catch(() => null)
              }
              if (!fitbit && mounted) {
                fitbit = await getMostRecentFitbitData(user.id).catch(() => null)
              }
              if (mounted && fitbit && fitbit.steps != null) {
                setFitbitSteps({
                  steps: Number(fitbit.steps),
                  date: fitbit.date
                })
              }
            } catch {
              // non-blocking
            }
          })()

          // Load recent logs for feed - await this so feed loads
          if (mounted) {
            await loadRecentLogs(user.id)
          }

          // Load readiness snapshot (non-blocking)
          getReadinessScore(user.id).then(r => {
            if (mounted) setReadiness(r || null)
          }).catch(() => {})
          
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
              logError('Error loading scheduled workouts', e)
              if (!shownErrorsRef.current.scheduled && showToast && typeof showToast === 'function') {
                shownErrorsRef.current.scheduled = true
                showToast('Failed to load scheduled workouts.', 'error')
              }
            }
          }
        } catch (e) {
          logError('Home init failed', e)
          if (!shownErrorsRef.current.init && showToast && typeof showToast === 'function') {
            shownErrorsRef.current.init = true
            showToast('Failed to load Home data. Pull to refresh to retry.', 'error')
          }
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
          logError('Error refreshing profile picture', e)
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

    // Listen for schedule changes (Program enroll/reschedule, Calendar actions)
    const handleScheduledWorkoutsUpdate = async () => {
      if (!mounted || !user?.id) return
      try {
        const scheduled = await getScheduledWorkoutsFromSupabase(user.id)
        const today = getTodayEST()
        const upcoming = (scheduled || []).filter(s => s.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5)
        if (mounted) setScheduledWorkouts(upcoming)
      } catch (e) {
        logError('Error refreshing scheduled workouts', e)
      }
    }
    window.addEventListener('scheduledWorkoutsUpdated', handleScheduledWorkoutsUpdate)
    
    // Load pending requests
    const loadPendingRequests = async () => {
      if (mounted && user) {
        try {
          const requests = await getPendingFriendRequests(user.id)
          if (mounted) {
            setPendingRequestCount(requests?.length || 0)
          }
        } catch (error) {
          logError('Error loading pending friend requests', error)
          if (!shownErrorsRef.current.pending && showToast && typeof showToast === 'function') {
            shownErrorsRef.current.pending = true
            // Keep this lightweight; it’s not a critical failure.
            showToast('Some social data failed to load.', 'info')
          }
        }
      }
    }
    loadPendingRequests()
    
    return () => {
      mounted = false
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('feedUpdated', handleFeedUpdate)
      window.removeEventListener('scheduledWorkoutsUpdated', handleScheduledWorkoutsUpdate)
    }
  }, [user, navigate, feedFilter]) // Add feedFilter to dependencies

  // Detect resumable in-progress session (IndexedDB active session has localStorage backup too)
  useEffect(() => {
    if (!user) {
      setResumeSession(null)
      return
    }
    try {
      const raw = localStorage.getItem(`activeWorkout_${user.id}`)
      if (!raw) {
        setResumeSession(null)
        return
      }
      const parsed = JSON.parse(raw)
      const ageMs = parsed?.timestamp ? (Date.now() - Number(parsed.timestamp)) : Infinity
      // Treat as resumable if within 24h and has exercises
      const hasExercises = Array.isArray(parsed?.exercises) && parsed.exercises.length > 0
      if (!hasExercises || ageMs > 24 * 60 * 60 * 1000) {
        setResumeSession(null)
        return
      }
      const st = (parsed.sessionType || 'workout').toString().toLowerCase() === 'recovery' ? 'recovery' : 'workout'
      setResumeSession({
        sessionType: st,
        timestamp: parsed.timestamp,
        hasExercises
      })
    } catch {
      setResumeSession(null)
    }
  }, [user])

  // Private mode (temporary): keep it local-only for now (safety rail, immediate value)
  useEffect(() => {
    if (!user) return
    try {
      const raw = localStorage.getItem(`privateModeUntil_${user.id}`)
      if (!raw) return
      const ts = Number(raw)
      if (!Number.isFinite(ts)) return
      setPrivateModeUntil(ts)
    } catch {}
  }, [user])

  const isPrivateModeOn = privateModeUntil != null && Date.now() < privateModeUntil

  const togglePrivateMode = () => {
    if (!user) return
    const next = isPrivateModeOn ? null : (Date.now() + 24 * 60 * 60 * 1000)
    setPrivateModeUntil(next)
    try {
      if (next == null) {
        localStorage.removeItem(`privateModeUntil_${user.id}`)
      } else {
        localStorage.setItem(`privateModeUntil_${user.id}`, String(next))
      }
    } catch {}
  }
  
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
        {toast && <Toast message={toast.message} type={toast.type} onClose={hideToast} />}
        <ConfirmDialog
          isOpen={confirmDialog.open}
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmText={confirmDialog.confirmText}
          cancelText={confirmDialog.cancelText}
          isDestructive={confirmDialog.isDestructive}
          onClose={() => resolveConfirm(false)}
          onConfirm={() => resolveConfirm(true)}
        />
        <div className={styles.loading} style={{ width: '100%' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Skeleton style={{ width: '45%', height: 16 }} />
            <Skeleton style={{ width: '100%', height: 120 }} />
            <Skeleton style={{ width: '100%', height: 120 }} />
            <Skeleton style={{ width: '60%', height: 14 }} />
          </div>
        </div>
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
      {toast && <Toast message={toast.message} type={toast.type} onClose={hideToast} />}
      <ConfirmDialog
        isOpen={confirmDialog.open}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmText={confirmDialog.confirmText}
        cancelText={confirmDialog.cancelText}
        isDestructive={confirmDialog.isDestructive}
        onClose={() => resolveConfirm(false)}
        onConfirm={() => resolveConfirm(true)}
      />
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

        {/* Today Hero */}
        <div className={styles.todayHero}>
          <div className={styles.primaryCtaCard}>
            <div className={styles.primaryCtaTop}>
              <div className={styles.primaryCtaTitle}>Today</div>
              <div className={styles.primaryCtaMeta}>
                {streak > 0 ? (
                  <span className={styles.primaryCtaMetaItem}>{streak} day streak</span>
                ) : (
                  <span className={styles.primaryCtaMetaItem}>Start your streak</span>
                )}
                {fitbitSteps?.steps != null && (
                  <span className={styles.primaryCtaMetaItem}>{fitbitSteps.steps.toLocaleString()} steps</span>
                )}
                <Button
                  unstyled
                  type="button"
                  className={`${styles.privateModeChip} ${isPrivateModeOn ? styles.privateModeChipOn : ''}`}
                  onClick={togglePrivateMode}
                  title={isPrivateModeOn ? 'Private mode is ON (local only). Tap to turn off.' : 'Turn on Private mode for 24h (local only).'}
                >
                  {isPrivateModeOn ? 'Private: ON' : 'Private: Off'}
                </Button>
              </div>
            </div>
            <Button
              unstyled
              className={styles.primaryCtaButton}
              onClick={() => {
                if (resumeSession?.hasExercises) {
                  navigate('/workout/active', { state: { resumePaused: true, sessionType: resumeSession.sessionType } })
                } else {
                  navigate('/workout/active')
                }
              }}
            >
              {resumeSession?.hasExercises
                ? (resumeSession.sessionType === 'recovery' ? 'Resume Recovery' : 'Resume Workout')
                : 'Start Session'}
            </Button>
            <div className={styles.primaryCtaSubActions}>
              <Button
                unstyled
                className={styles.secondaryCtaButton}
                onClick={() => navigate('/workout/active', { state: { sessionType: 'workout' } })}
              >
                Start workout
              </Button>
              <Button
                unstyled
                className={styles.secondaryCtaButton}
                onClick={() => navigate('/workout/active', { state: { sessionType: 'recovery' } })}
              >
                Start recovery
              </Button>
            </div>
          </div>

          <div className={styles.todayRow}>
            <div className={styles.readinessCard}>
              <div className={styles.cardLabel}>Readiness</div>
              {readiness?.score != null ? (
                <div className={styles.readinessValueRow}>
                  <div className={styles.readinessScore}>{readiness.score}</div>
                  <div className={`${styles.readinessZone} ${styles[`zone_${readiness.zone || 'yellow'}`]}`}>
                    {(readiness.zone || 'yellow').toString().toUpperCase()}
                  </div>
                </div>
              ) : (
                <div className={styles.readinessEmpty}>Connect a wearable or log health metrics</div>
              )}
              <Button unstyled className={styles.readinessLink} onClick={() => navigate('/health')}>
                View details
              </Button>
            </div>

            <div className={styles.planCard}>
              <div className={styles.cardLabel}>Plan</div>
              {(() => {
                const today = getTodayEST()
                const todaysList = (scheduledWorkouts || []).filter(s => s?.date === today)
                const todays = todaysList[0] || null
                const next = (scheduledWorkouts || [])[0] || null
                const labelFor = (s) => (s?.template_id === 'freestyle' ? 'Freestyle' : 'Workout')

                if (todays) {
                  return (
                    <>
                      <div className={styles.planLine}>
                        Today: <span className={styles.planStrong}>{todaysList.length > 1 ? `${todaysList.length} workouts` : labelFor(todays)}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
                        <Button
                          unstyled
                          className={styles.readinessLink}
                          onClick={() => {
                            if (todays.template_id === 'freestyle') {
                              navigate('/workout/active')
                              return
                            }
                            if (!todays.template_id) {
                              navigate('/calendar')
                              return
                            }
                            navigate('/workout/active', { state: { templateId: todays.template_id, scheduledDate: todays.date } })
                          }}
                        >
                          Start
                        </Button>
                        <button className={styles.readinessLink} onClick={() => navigate('/calendar')}>
                          Open calendar
                        </button>
                      </div>
                    </>
                  )
                }

                if (next) {
                  return (
                    <>
                      <div className={styles.planLine}>
                        Next: <span className={styles.planStrong}>{labelFor(next)}</span>
                        <span className={styles.planMuted}> · {formatDate(next?.date)}</span>
                      </div>
                      <button className={styles.readinessLink} onClick={() => navigate('/calendar')}>
                        Open calendar
                      </button>
                    </>
                  )
                }

                return (
                  <>
                    <div className={styles.planLine}>
                      No workout scheduled <span className={styles.planMuted}>· add one in Calendar</span>
                    </div>
                    <button className={styles.readinessLink} onClick={() => navigate('/calendar')}>
                      Open calendar
                    </button>
                  </>
                )
              })()}
            </div>
          </div>
        </div>
        
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
                    <Button
                      unstyled
                      className={styles.scheduledWorkoutAction}
                      onClick={() => {
                        if (isToday) {
                          if (scheduled.template_id === 'freestyle') {
                            navigate('/workout/active')
                            return
                          }
                          if (!scheduled.template_id) {
                            navigate('/calendar')
                            return
                          }
                          navigate('/workout/active', { state: { templateId: scheduled.template_id, scheduledDate: scheduled.date } })
                          return
                        }
                        navigate('/calendar')
                      }}
                    >
                      {isToday ? 'Start' : 'View Calendar'}
                    </Button>
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
                  <span className={styles.friendRequestsIcon}><PeopleIcon size={18} /></span>
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
                {[0, 1, 2].map((i) => (
                  <div key={i} className={styles.feedCardItem}>
                    <div className={styles.feedAuthor}>
                      <Skeleton style={{ width: 40, height: 40, borderRadius: 999 }} />
                      <div style={{ flex: 1 }}>
                        <Skeleton style={{ width: '40%', height: 12, marginBottom: 8 }} />
                        <Skeleton style={{ width: '25%', height: 10 }} />
                      </div>
                    </div>
                    <Skeleton style={{ width: '100%', height: 120, marginTop: 10 }} />
                  </div>
                ))}
              </div>
            </div>
          ) : recentLogs.length === 0 ? (
            <div className={styles.emptyFeed}>
              <EmptyState
                title="No recent activity"
                message="Start logging sessions, meals, or metrics — then share to your feed when you want."
                actionLabel="Log something"
                onAction={() => navigate('/log')}
              />
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
                          {formatDate(log.date)}
                          {!isPrivateModeOn && log.timestamp ? ` · ${new Date(log.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}
                          </span>
                        </div>
                        {log.isOwnPost && log.source === 'feed_item' && (
                          <Button
                            unstyled
                            className={styles.feedActionBtn}
                            onClick={() => handleDeletePost(log)}
                            title="Delete post"
                          >
                            Delete
                          </Button>
                        )}
                      </div>
                      {/* Show ShareCard for workout, nutrition, or health */}
                      <ShareCard 
                        type={log.type} 
                      data={{
                        ...(log.data || {}),
                        // Redaction: hide notes while private mode is ON
                        workout: log.type === 'workout'
                          ? { ...(log.data?.workout || {}), notes: isPrivateModeOn ? '' : (log.data?.workout?.notes || '') }
                          : log.data?.workout,
                        nutrition: log.type === 'nutrition'
                          ? { ...(log.data?.nutrition || {}) }
                          : log.data?.nutrition,
                        health: log.type === 'health'
                          ? { ...(log.data?.health || {}) }
                          : log.data?.health
                      }}
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
          initialSearchTerm={addFriendPrefill}
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
