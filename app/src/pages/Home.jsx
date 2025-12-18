import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { calculateStreakFromSupabase, getRecentWorkoutsFromSupabase } from '../lib/db/workoutsDb'
import { getUserPreferences } from '../lib/db/userPreferencesDb'
import { getSocialFeedItems, deleteFeedItemFromSupabase } from '../lib/db/feedDb'
import { getScheduledWorkoutsFromSupabase } from '../lib/db/scheduledWorkoutsDb'
import { getFitbitDaily, getMostRecentFitbitData } from '../lib/wearables'
import { getMealsFromSupabase, getNutritionRangeFromSupabase } from '../lib/nutritionDb'
import { getMetricsFromSupabase } from '../lib/db/metricsDb'
import { getLocalDate, getTodayEST, getYesterdayEST } from '../utils/dateUtils'
import { logError } from '../utils/logger'
import { getAllTemplates } from '../db/lazyDb'
import SideMenu from '../components/SideMenu'
import HomeButton from '../components/HomeButton'
import ShareCard from '../components/ShareCard'
import AddFriend from '../components/AddFriend'
import FriendRequests from '../components/FriendRequests'
import { getPendingFriendRequests } from '../lib/friendsDb'
import { PeopleIcon } from '../components/Icons'
import Skeleton from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import Button from '../components/Button'
import { formatSleep, formatSteps, formatWeightLbs } from '../utils/metricFormatters'
import { useHaptic } from '../hooks/useHaptic'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'
import ConfirmDialog from '../components/ConfirmDialog'
import { nonBlocking } from '../utils/nonBlocking'
import { getOutboxPendingCount, flushOutbox } from '../lib/syncOutbox'
import { openCalendar, openHealth, openMealLog, openNutrition, openLogHub, startWorkout } from '../utils/navIntents'
import styles from './Home.module.css'

// Social is intentionally hidden for now (feature to ship later).
// Enable explicitly via VITE_ENABLE_SOCIAL=true.
const SOCIAL_ENABLED = import.meta.env.VITE_ENABLE_SOCIAL === 'true'

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
  const [feedCursor, setFeedCursor] = useState(null)
  const [feedHasMore, setFeedHasMore] = useState(false)
  const [feedLoadingMore, setFeedLoadingMore] = useState(false)
  const [showAddFriend, setShowAddFriend] = useState(false)
  const [addFriendPrefill, setAddFriendPrefill] = useState('')
  const [showFriendRequests, setShowFriendRequests] = useState(false)
  const [pendingRequestCount, setPendingRequestCount] = useState(0)
  const [scheduledWorkouts, setScheduledWorkouts] = useState([])
  const [templateNameById, setTemplateNameById] = useState({})
  const [resumeSession, setResumeSession] = useState(null) // { sessionType: 'workout'|'recovery', timestamp, hasExercises }
  const [privateModeUntil, setPrivateModeUntil] = useState(null) // timestamp ms; when set, redact timestamps/notes in feed
  const [lastWorkoutSummary, setLastWorkoutSummary] = useState(null) // { date, label } or null
  const [todayWorkoutSummary, setTodayWorkoutSummary] = useState(null) // { date, label, templateId } or null
  const [todayNutrition, setTodayNutrition] = useState(null) // { calories, macros, water } or null
  const [todayHealthMetrics, setTodayHealthMetrics] = useState(null) // health_metrics row or null
  const [pendingSyncCount, setPendingSyncCount] = useState(0)
  const [syncBusy, setSyncBusy] = useState(false)
  const [feedExpanded, setFeedExpanded] = useState(false)
  const feedContainerRef = useRef(null)
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

  // Trust-grade sync status: show pending outbox items and allow manual flush.
  useEffect(() => {
    if (!user?.id) {
      setPendingSyncCount(0)
      return
    }
    const refresh = () => setPendingSyncCount(getOutboxPendingCount(user.id))
    refresh()
    window.addEventListener('outboxUpdated', refresh)
    window.addEventListener('online', refresh)
    return () => {
      window.removeEventListener('outboxUpdated', refresh)
      window.removeEventListener('online', refresh)
    }
  }, [user?.id])

  const resolveConfirm = (result) => {
    setConfirmDialog(prev => ({ ...prev, open: false }))
    const resolve = confirmResolverRef.current
    confirmResolverRef.current = null
    if (resolve) resolve(result)
  }

  const loadTodayStats = useCallback(async (userId, { nonBlockingMode = false } = {}) => {
    if (!userId) return
    const today = getTodayEST()
    try {
      const [nutrition, metricsRows] = await Promise.all([
        getMealsFromSupabase(userId, today).catch(() => null),
        getMetricsFromSupabase(userId, today, today).catch(() => [])
      ])

      const row = Array.isArray(metricsRows) ? (metricsRows[0] || null) : null
      setTodayNutrition(nutrition || null)
      setTodayHealthMetrics(row || null)
    } catch (e) {
      logError('Home: loadTodayStats failed', e)
      if (!nonBlockingMode) {
        showToast?.('Failed to load today stats.', 'info')
      }
      setTodayNutrition(null)
      setTodayHealthMetrics(null)
    }
  }, [showToast])
  
  // Reload feed when filter changes
  useEffect(() => {
    if (SOCIAL_ENABLED && user) {
      loadRecentLogs(user.id)
    }
  }, [feedFilter, user])

  // Deep-link: allow Command Palette (or other surfaces) to open Add Friend directly
  useEffect(() => {
    const state = location?.state
    if (SOCIAL_ENABLED && state?.openAddFriend) {
      setAddFriendPrefill(typeof state.addFriendQuery === 'string' ? state.addFriendQuery : '')
      setShowAddFriend(true)
      // Clear state so refresh/back doesn't reopen
      navigate(location.pathname, { replace: true, state: {} })
      return
    }

    // If social is disabled, still clear any social-intent state so nothing "leaks" hidden features.
    if (!SOCIAL_ENABLED && (state?.openAddFriend || state?.openFriendRequests)) {
      navigate(location.pathname, { replace: true, state: {} })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location?.state])

  const loadRecentLogs = async (userId, cursor = null, { append = false } = {}) => {
    try {
      setLoading(true)
      
      const logs = []
      let nextCursor = null
      let hasMore = false
      
      if (!userId) {
        setRecentLogs([])
        setFeedCursor(null)
        setFeedHasMore(false)
        setLoading(false)
        return
      }

      // OPTIMIZED: Get feed items with pagination support
      try {
        const feedItems = await getSocialFeedItems(userId, feedFilter, 20, cursor)
        const raw = Array.isArray(feedItems) ? feedItems : []
        // Cursor is the last item's created_at (if available).
        nextCursor = raw.length > 0 ? (raw[raw.length - 1]?.created_at || null) : null
        hasMore = raw.length >= 20 && Boolean(nextCursor)
        
        if (raw.length > 0) {
          raw.forEach((item) => {
            // Get user profile info
            const userProfile = item.user_profiles || null
            const authorName = userProfile?.display_name || userProfile?.username || 'User'
            const authorId = item.user_id
            const isOwnPost = authorId === userId
            
            // Use created_at timestamp if available
            const itemDate = item.created_at
              ? getLocalDate(new Date(item.created_at))
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
      
      
      if (append) {
        setRecentLogs(prev => {
          const merged = new Map()
          for (const it of Array.isArray(prev) ? prev : []) {
            if (it?.id) merged.set(it.id, it)
          }
          for (const it of logs) {
            if (it?.id) merged.set(it.id, it)
          }
          return Array.from(merged.values()).sort((a, b) => {
            const dateA = new Date(a.timestamp || a.date)
            const dateB = new Date(b.timestamp || b.date)
            return dateB - dateA
          })
        })
      } else {
        setRecentLogs(logs)
      }
      setFeedCursor(nextCursor)
      setFeedHasMore(hasMore)
      setLoading(false)
    } catch (error) {
      logError('Error in loadRecentLogs', error)
      if (!shownErrorsRef.current.feed && showToast && typeof showToast === 'function') {
        shownErrorsRef.current.feed = true
        showToast('Failed to load your feed. Please try again.', 'error')
      }
      setRecentLogs([])
      setFeedCursor(null)
      setFeedHasMore(false)
      setLoading(false)
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
      await loadRecentLogs(user.id)
    } catch (e) {
      logError('Failed to delete feed post', e)
      showToast('Failed to delete post. Please try again.', 'error')
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
          nonBlocking(
            getUserPreferences(user.id).then(prefs => {
              if (mounted && prefs?.profile_picture) {
                setProfilePicture(prefs.profile_picture)
              }
            }),
            { key: 'prefs', shownRef: shownErrorsRef, showToast, message: 'Some profile data failed to load.', level: 'info' }
          )
          
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
            if (SOCIAL_ENABLED) {
              await loadRecentLogs(user.id)
            }
          }

          // Load today's health + nutrition snapshot (non-blocking, small queries).
          nonBlocking(
            loadTodayStats(user.id, { nonBlockingMode: true }),
            { key: 'today_stats', shownRef: shownErrorsRef, showToast, message: 'Some today stats are unavailable.', level: 'info' }
          )

          // Load template names (local IndexedDB) - non-blocking but improves trust/clarity for scheduling.
          nonBlocking(
            getAllTemplates().then((rows) => {
              if (!mounted) return
              const map = {}
              for (const t of Array.isArray(rows) ? rows : []) {
                if (t?.id) map[String(t.id)] = String(t.name || '').trim()
              }
              setTemplateNameById(map)
            }),
            { key: 'templates', shownRef: shownErrorsRef, showToast, message: 'Some template names could not be loaded.', level: 'info' }
          )

          // Load last workout summary (small recent window only) - non-blocking.
          getRecentWorkoutsFromSupabase(user.id, 20)
            .then((rows) => {
              if (!mounted) return
              const list = Array.isArray(rows) ? rows : []
              const w = list[0] || null
              if (!w?.date) {
                setLastWorkoutSummary(null)
                setTodayWorkoutSummary(null)
                return
              }
              const mins = Math.floor((Number(w.duration || 0) || 0) / 60)
              const secs = (Number(w.duration || 0) || 0) % 60
              const duration = (w.duration != null) ? `${mins}:${String(secs).padStart(2, '0')}` : ''
              setLastWorkoutSummary({
                date: String(w.date),
                label: duration ? `${duration}` : 'Logged'
              })

              // If there is a workout logged today, surface it prominently.
              const today = getTodayEST()
              const todayW = list.find(x => String(x?.date || '') === today) || null
              if (todayW?.date) {
                const tmins = Math.floor((Number(todayW.duration || 0) || 0) / 60)
                const tsecs = (Number(todayW.duration || 0) || 0) % 60
                const tduration = (todayW.duration != null) ? `${tmins}:${String(tsecs).padStart(2, '0')}` : ''
                setTodayWorkoutSummary({
                  date: String(todayW.date),
                  label: tduration ? `${tduration}` : 'Logged',
                  templateId: todayW.template_id || null
                })
              } else {
                setTodayWorkoutSummary(null)
              }
            })
            .catch(() => {})
          
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
            showToast('Failed to load Home data. Please try again.', 'error')
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
    
    // Listen for feed updates (only when social is enabled)
    const handleFeedUpdate = () => {
      if (!SOCIAL_ENABLED) return
      if (mounted && user) {
        loadRecentLogs(user.id)
        loadPendingRequests()
      }
    }
    if (SOCIAL_ENABLED) {
      window.addEventListener('feedUpdated', handleFeedUpdate)
    }

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
      if (!SOCIAL_ENABLED) return
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
    if (SOCIAL_ENABLED) loadPendingRequests()
    
    return () => {
      mounted = false
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (SOCIAL_ENABLED) window.removeEventListener('feedUpdated', handleFeedUpdate)
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

  const getTemplateLabel = (templateId) => {
    if (!templateId) return 'Workout'
    if (templateId === 'freestyle') return 'Freestyle'
    const name = templateNameById?.[String(templateId)]
    return name || 'Workout'
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
          <h1 className={styles.logo}>Today</h1>
        </div>
        <HomeButton />
      </div>

      <div className={styles.content} ref={feedContainerRef}>
        {/* Redesigned Today Dashboard */}
        <div className={styles.dashboard}>
          <div
            className={styles.heroCard}
            style={{
              // Layout-critical fallback (prevents “jumbled” UI if styles ever fail to load)
              display: 'flex',
              flexDirection: 'column',
              gap: 12
            }}
          >
            <div className={styles.heroTop} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className={styles.heroTitle}>Your day</div>
              <div className={styles.heroKicker}>
                {streak > 0 ? `${streak} day streak` : 'Start your streak'}
                {fitbitSteps?.steps != null ? ` · ${Number(fitbitSteps.steps).toLocaleString()} steps` : ''}
              </div>
            </div>

            <button
              type="button"
              className={styles.heroPrimary}
              style={{
                // Layout-critical fallback
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: 6,
                width: '100%',
                textAlign: 'left'
              }}
              onClick={() => {
                try {
                  if (resumeSession?.hasExercises) {
                    startWorkout(navigate, { mode: 'picker', sessionType: resumeSession.sessionType, resumePaused: true })
                    return
                  }

                  const today = getTodayEST()
                  const todaysList = (scheduledWorkouts || []).filter(s => s?.date === today)
                  const first = todaysList.find(s => s?.template_id && s.template_id !== 'freestyle') || todaysList[0] || null

                  // Keep this consistent with the working "Train" quick action contract.
                  if (first?.template_id === 'freestyle') {
                    startWorkout(navigate, { mode: 'picker', sessionType: 'workout' })
                    return
                  }
                  if (first?.template_id) {
                    startWorkout(navigate, { mode: 'template', sessionType: 'workout', templateId: first.template_id, scheduledDate: first.date })
                    return
                  }

                  startWorkout(navigate, { mode: 'picker', sessionType: 'workout' })
                } catch (e) {
                  // Last-ditch fallback: never let the primary CTA feel dead.
                  startWorkout(navigate, { mode: 'picker', sessionType: 'workout' })
                }
              }}
            >
              <div className={styles.heroPrimaryLabel}>Fitness</div>
              <div className={styles.heroPrimaryValue}>
                {resumeSession?.hasExercises
                  ? (resumeSession.sessionType === 'recovery' ? 'Resume recovery' : 'Resume workout')
                  : (() => {
                      const today = getTodayEST()
                      const todaysList = (scheduledWorkouts || []).filter(s => s?.date === today)
                      const first = todaysList.find(s => s?.template_id && s.template_id !== 'freestyle') || todaysList[0] || null
                      return first ? getTemplateLabel(first.template_id) : 'Start workout'
                    })()}
              </div>
              <div className={styles.heroPrimarySub}>
                {todayWorkoutSummary?.date
                  ? `Completed today${todayWorkoutSummary?.templateId ? `: ${getTemplateLabel(todayWorkoutSummary.templateId)}` : ''} · ${todayWorkoutSummary.label}`
                  : (lastWorkoutSummary?.date ? `Last: ${formatDate(lastWorkoutSummary.date)} · ${lastWorkoutSummary.label}` : 'Keep it simple: show up, log it, move on.')}
              </div>
            </button>

            <div
              className={styles.quickGrid}
              style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}
            >
              <button
                type="button"
                className={styles.quickCard}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4, textAlign: 'left' }}
                onClick={() => openMealLog(navigate)}
              >
                <div className={styles.quickCardTitle}>Log meal</div>
                <div className={styles.quickCardSub}>Fast add</div>
              </button>
              <button
                type="button"
                className={styles.quickCard}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4, textAlign: 'left' }}
                onClick={() => startWorkout(navigate, { mode: 'picker', sessionType: 'workout' })}
              >
                <div className={styles.quickCardTitle}>Train</div>
                <div className={styles.quickCardSub}>Add exercises</div>
              </button>
              <button
                type="button"
                className={styles.quickCard}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4, textAlign: 'left' }}
                onClick={() => openHealth(navigate, { openLogModal: true })}
              >
                <div className={styles.quickCardTitle}>Metrics</div>
                <div className={styles.quickCardSub}>Log health</div>
              </button>
              <button
                type="button"
                className={styles.quickCard}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4, textAlign: 'left' }}
                onClick={() => openCalendar(navigate)}
              >
                <div className={styles.quickCardTitle}>Plan</div>
                <div className={styles.quickCardSub}>Calendar</div>
              </button>
            </div>
          </div>

          <div
            className={styles.summaryGrid}
            style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}
          >
            <button
              className={styles.summaryCard}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8, textAlign: 'left' }}
              onClick={() => openHealth(navigate)}
            >
              <div className={styles.summaryLabel}>Health</div>
              {(() => {
                const steps = fitbitSteps?.steps != null ? Number(fitbitSteps.steps) : Number(todayHealthMetrics?.steps)
                const sleepRaw = todayHealthMetrics?.sleep_duration
                const weight = todayHealthMetrics?.weight != null ? Number(todayHealthMetrics.weight) : null
                const calories = Number(todayHealthMetrics?.calories_burned ?? todayHealthMetrics?.calories)

                const stepsText = formatSteps(steps)
                const sleepText = formatSleep(sleepRaw)
                const weightText = weight != null ? formatWeightLbs(weight) : null
                const caloriesText = (Number.isFinite(calories) && calories > 0) ? String(Math.round(calories)) : null

                const any = Boolean(caloriesText) || Boolean(stepsText) || Boolean(sleepText) || Boolean(weightText)
                if (!any) return <div className={styles.summaryEmpty}>No metrics yet</div>

                // Mirror Nutrition: big primary number + compact secondary line
                if (caloriesText) {
                  return (
                    <>
                      <div className={styles.summaryValue}>{caloriesText}<span className={styles.summaryUnit}> cal</span></div>
                      <div className={styles.summarySub}>
                        {stepsText ? `Steps ${stepsText}` : ''}
                        {sleepText ? `${stepsText ? ' · ' : ''}Sleep ${sleepText}` : ''}
                        {weightText ? `${(stepsText || sleepText) ? ' · ' : ''}Wt ${weightText}` : ''}
                      </div>
                    </>
                  )
                }

                // Fallback primary value if calories are unavailable
                if (stepsText) {
                  return (
                    <>
                      <div className={styles.summaryValue}>{stepsText}<span className={styles.summaryUnit}> steps</span></div>
                      <div className={styles.summarySub}>
                        {sleepText ? `Sleep ${sleepText}` : ''}
                        {weightText ? `${sleepText ? ' · ' : ''}Wt ${weightText}` : ''}
                      </div>
                    </>
                  )
                }

                if (sleepText) {
                  return (
                    <>
                      <div className={styles.summaryValue}>{sleepText}</div>
                      <div className={styles.summarySub}>
                        {weightText ? `Wt ${weightText}` : ''}
                      </div>
                    </>
                  )
                }

                return (
                  <>
                    <div className={styles.summaryValue}>{weightText}</div>
                    <div className={styles.summarySub}>Weight</div>
                  </>
                )
              })()}
            </button>

            <button
              className={styles.summaryCard}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8, textAlign: 'left' }}
              onClick={() => openNutrition(navigate)}
            >
              <div className={styles.summaryLabel}>Nutrition</div>
              {todayNutrition ? (
                <>
                  <div className={styles.summaryValue}>{Math.round(Number(todayNutrition.calories || 0))}<span className={styles.summaryUnit}> cal</span></div>
                  <div className={styles.summarySub}>
                    P {Math.round(Number(todayNutrition.macros?.protein || 0))} · C {Math.round(Number(todayNutrition.macros?.carbs || 0))} · F {Math.round(Number(todayNutrition.macros?.fat || 0))}
                  </div>
                </>
              ) : (
                <div className={styles.summaryEmpty}>No food logged</div>
              )}
            </button>

            <button
              className={styles.summaryCard}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8, textAlign: 'left' }}
              onClick={() => openCalendar(navigate)}
            >
              <div className={styles.summaryLabel}>Schedule</div>
              {(() => {
                const today = getTodayEST()
                const todaysList = (scheduledWorkouts || []).filter(s => s?.date === today)
                const todays = todaysList[0] || null
                const next = (scheduledWorkouts || [])[0] || null
                if (todays) return <div className={styles.summarySub}>{todaysList.length > 1 ? `${todaysList.length} workouts today` : `Today: ${getTemplateLabel(todays?.template_id)}`}</div>
                if (next) return <div className={styles.summarySub}>Next: {getTemplateLabel(next?.template_id)} · {formatDate(next?.date)}</div>
                return <div className={styles.summaryEmpty}>Nothing scheduled</div>
              })()}
            </button>
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
                const isTomorrow = scheduled.date === getLocalDate(new Date(Date.now() + 24 * 60 * 60 * 1000))
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
                      {getTemplateLabel(scheduled.template_id)}
                    </div>
                    <Button
                      unstyled
                      className={styles.scheduledWorkoutAction}
                      onClick={() => {
                        if (isToday) {
                          if (scheduled.template_id === 'freestyle') {
                            startWorkout(navigate, { mode: 'picker', sessionType: 'workout' })
                            return
                          }
                          if (!scheduled.template_id) {
                            openCalendar(navigate)
                            return
                          }
                          startWorkout(navigate, { mode: 'template', sessionType: 'workout', templateId: scheduled.template_id, scheduledDate: scheduled.date })
                          return
                        }
                        openCalendar(navigate)
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
        
        {/* Social is intentionally hidden for now (ship later). */}
        {SOCIAL_ENABLED ? (
        <div className={styles.feed}>
          <div className={styles.feedHeader}>
            <button className={styles.feedToggle} onClick={() => setFeedExpanded(v => !v)} aria-expanded={feedExpanded}>
              <h2 className={styles.feedTitle}>Community</h2>
              <span className={styles.feedToggleHint}>{feedExpanded ? 'Hide' : 'Show'}</span>
            </button>
            <div className={styles.feedHeaderActions}>
              {pendingRequestCount > 0 && (
                <button
                  className={styles.friendRequestsBtn}
                  onClick={() => setShowFriendRequests(true)}
                  aria-label="Friend Requests"
                >
                  <span className={styles.friendRequestsIcon}><PeopleIcon size={18} /></span>
                  <span className={styles.friendRequestsBadge}>{pendingRequestCount}</span>
                </button>
              )}
              <button className={styles.addFriendBtn} onClick={() => setShowAddFriend(true)} aria-label="Add Friend">
                + Add
              </button>
            </div>
          </div>
          
          {/* Feed Filters */}
          {feedExpanded && (
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
          )}
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
                onAction={() => openLogHub(navigate)}
              />
            </div>
          ) : (
            <div className={styles.feedList}>
              {(feedExpanded ? recentLogs : recentLogs.slice(0, 2)).map((log, index) => {
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
              {!feedExpanded && recentLogs.length > 2 ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 16px 0' }}>
                  <Button variant="secondary" onClick={() => setFeedExpanded(true)}>Show more</Button>
                </div>
              ) : null}
              {feedHasMore ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 16px' }}>
                  <Button
                    variant="secondary"
                    onClick={async () => {
                      if (!user?.id || !feedCursor) return
                      setFeedLoadingMore(true)
                      try {
                        await loadRecentLogs(user.id, feedCursor, { append: true })
                      } finally {
                        setFeedLoadingMore(false)
                      }
                    }}
                    disabled={feedLoadingMore || !feedCursor}
                  >
                    {feedLoadingMore ? 'Loading…' : 'Load more'}
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </div>
        ) : null}
      </div>

      {SOCIAL_ENABLED && showAddFriend && (
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

      {SOCIAL_ENABLED && showFriendRequests && (
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
