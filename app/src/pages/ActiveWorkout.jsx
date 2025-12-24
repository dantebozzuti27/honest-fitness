import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { getTemplate, getAllExercises, saveWorkout } from '../db/lazyDb'
import { 
  saveWorkoutToSupabase, 
  savePausedWorkoutToSupabase, 
  getPausedWorkoutFromSupabase, 
  deletePausedWorkoutFromSupabase,
  saveActiveWorkoutSession,
  getActiveWorkoutSession,
  deleteActiveWorkoutSession
} from '../lib/db/workoutsSessionDb'
import { getRecentWorkoutsFromSupabase } from '../lib/db/workoutsDb'
import { getTodayEST } from '../utils/dateUtils'
import { useAuth } from '../context/AuthContext'
import { logError } from '../utils/logger'
import { getAutoAdjustmentFactor, applyAutoAdjustment, getWorkoutRecommendation } from '../lib/autoAdjust'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'
import ConfirmDialog from '../components/ConfirmDialog'
import Button from '../components/Button'
import TextAreaField from '../components/TextAreaField'
import SearchField from '../components/SearchField'
import { enqueueOutboxItem } from '../lib/syncOutbox'
import { trackWorkoutEvent, trackFeatureUsage } from '../lib/eventTracking'
import ExerciseCard from '../components/ExerciseCard'
import ExercisePicker from '../components/ExercisePicker'
import ShareModal from '../components/ShareModal'
import { shareWorkoutToFeed } from '../utils/shareUtils'
import { setLastQuickAction } from '../utils/quickActions'
import { getFitbitDaily, getMostRecentFitbitData } from '../lib/wearables'
import SafeAreaScaffold from '../components/ui/SafeAreaScaffold'
import Sheet from '../components/ui/Sheet'
import { uuidv4 } from '../utils/uuid'
import styles from './ActiveWorkout.module.css'

function normalizeActiveWorkoutEntry(location) {
  const rawState = location?.state
  const state = rawState && typeof rawState === 'object' ? rawState : {}

  const qs = (() => {
    try {
      return new URLSearchParams(location?.search || '')
    } catch {
      return new URLSearchParams('')
    }
  })()

  const sessionTypeRaw = (state.sessionType || '').toString().toLowerCase()
  const sessionTypeProvided = sessionTypeRaw === 'workout' || sessionTypeRaw === 'recovery'
  const sessionType = sessionTypeRaw === 'recovery' ? 'recovery' : 'workout'

  const templateId = typeof state.templateId === 'string' && state.templateId.trim() ? state.templateId.trim() : null
  const aiWorkout = state.aiWorkout && typeof state.aiWorkout === 'object' ? state.aiWorkout : null

  const randomWorkout = (() => {
    if (state.randomWorkout === true) return true
    if (state.randomWorkout && typeof state.randomWorkout === 'object') return state.randomWorkout
    return null
  })()

  const quickAddExerciseName = (() => {
    if (typeof state.quickAddExerciseName === 'string' && state.quickAddExerciseName.trim()) {
      return state.quickAddExerciseName.trim()
    }
    const fromQuery = (qs.get('exercise') || '').toString().trim()
    return fromQuery ? fromQuery : null
  })()

  const openPickerOnLoad =
    state.openPicker === true ||
    qs.get('quick') === '1' ||
    qs.get('picker') === '1'

  const resumePaused = state.resumePaused === true

  // Derive a single “entry mode” even if multiple fields are present.
  // Priority is deterministic so behavior stays stable across refactors.
  const mode = (() => {
    if (templateId) return 'template'
    if (aiWorkout) return 'ai'
    if (randomWorkout) return 'random'
    if (quickAddExerciseName) return 'quick_add_exercise'
    if (openPickerOnLoad) return 'picker'
    return 'resume'
  })()

  return {
    sessionType,
    sessionTypeProvided,
    templateId,
    aiWorkout,
    randomWorkout,
    quickAddExerciseName,
    openPickerOnLoad,
    resumePaused,
    mode
  }
}

export default function ActiveWorkout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const { toast, showToast, hideToast } = useToast()
  const userId = user?.id || null
  const entry = useMemo(() => normalizeActiveWorkoutEntry(location), [location.key])
  const templateId = entry.templateId
  const randomWorkout = entry.randomWorkout
  const aiWorkout = entry.aiWorkout
  const initialSessionType = entry.sessionTypeProvided ? entry.sessionType : null
  const openPickerOnLoad = entry.openPickerOnLoad
  const quickAddExerciseName = entry.quickAddExerciseName

  // Learn "repeat last action" from all workout entry paths (not just Quick Actions).
  useEffect(() => {
    try {
      if (initialSessionType === 'workout' || initialSessionType === 'recovery') {
        setLastQuickAction({ type: 'start_workout', sessionType: initialSessionType })
        return
      }
      // If the user navigates directly to ActiveWorkout with no sessionType, it's typically a resume.
      setLastQuickAction({ type: 'continue_workout' })
    } catch {
      // ignore
    }
    // location.key changes on navigation to the same route
  }, [location.key, initialSessionType])
  
  const [exercises, setExercises] = useState([])
  const [allExercises, setAllExercises] = useState([])
  const [showPicker, setShowPicker] = useState(false)
  const [exerciseFilter, setExerciseFilter] = useState('')
  const [workoutTime, setWorkoutTime] = useState(0)
  const [restTime, setRestTime] = useState(0)
  const [isResting, setIsResting] = useState(false)
  const [draggedId, setDraggedId] = useState(null)
  const [showSummary, setShowSummary] = useState(false)
  const [feedback, setFeedback] = useState({ rpe: 7, moodAfter: 3, notes: '' })
  const [showTimesUp, setShowTimesUp] = useState(false)
  const [adjustmentInfo, setAdjustmentInfo] = useState(null)
  const [showShareModal, setShowShareModal] = useState(false)
  const [savedWorkout, setSavedWorkout] = useState(null)
  const [lastByExerciseName, setLastByExerciseName] = useState({})
  const [showControlsSheet, setShowControlsSheet] = useState(false)
  const [prefAutoAdvance, setPrefAutoAdvance] = useState(() => {
    try { return localStorage.getItem('workout_auto_advance') !== '0' } catch { return true }
  })
  const [prefAutoNext, setPrefAutoNext] = useState(() => {
    try { return localStorage.getItem('workout_auto_next') === '1' } catch { return false }
  })
  const [syncPill, setSyncPill] = useState({ label: 'Ready', tone: 'neutral' }) // neutral | good | warn
  const confirmResolverRef = useRef(null)
  const trackedStartRef = useRef(false)
  const trackedFirstSetRef = useRef(false)
  const trackedCompleteRef = useRef(false)
  const [confirmDialog, setConfirmDialog] = useState({
    open: false,
    title: 'Confirm',
    message: '',
    confirmText: 'Confirm',
    cancelText: 'Cancel',
    isDestructive: false
  })

  // Session type must be declared before any effects that reference it (dependency arrays are evaluated during render).
  const [sessionType, setSessionType] = useState(
    entry.sessionType
  ) // 'workout' | 'recovery'
  const [sessionTypeMode, setSessionTypeMode] = useState(
    entry.sessionTypeProvided ? 'manual' : 'auto'
  ) // 'auto' | 'manual'
  const [isPaused, setIsPaused] = useState(false)
  const [pausedTime, setPausedTime] = useState(0) // Accumulated paused time

  // If the user navigates to this route again with a different explicit session type,
  // update our state deterministically. (Otherwise keep existing session state.)
  useEffect(() => {
    if (!entry.sessionTypeProvided) return
    setSessionType(entry.sessionType)
    setSessionTypeMode('manual')
    // Only react to explicit navigation changes, not local state updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key])
  const [isSaving, setIsSaving] = useState(false)
  const [calculatedWorkoutMetrics, setCalculatedWorkoutMetrics] = useState({ calories: null, steps: null }) // Calculated workout metrics for display
  const pauseStartTime = useRef(null)
  const pausedTimeRef = useRef(0) // Ref to track paused time for timer calculations
  const workoutTimerRef = useRef(null)
  const restTimerRef = useRef(null)
  const workoutStartTimeRef = useRef(null)
  const restStartTimeRef = useRef(null)
  const restDurationRef = useRef(0)
  const timeoutRefs = useRef([]) // Track all timeouts for cleanup
  const autoSaveIntervalRef = useRef(null) // Auto-save interval
  const lastSavedExercisesRef = useRef(null) // Track last saved exercises to avoid unnecessary saves
  // Refs to avoid stale-closure bugs during background/foreground transitions.
  // (On iOS especially, visibilitychange can fire before a debounced save and we must persist the *latest* set entries.)
  const exercisesRef = useRef([])
  const workoutTimeRef = useRef(0)
  const restTimeRef = useRef(0)
  const isRestingRef = useRef(false)
  const sessionTypeRef = useRef('workout')
  const sessionTypeModeRef = useRef('auto')
  const workoutStartMetricsRef = useRef(null) // Track wearable metrics at workout start (calories, steps)
  const pausedMetricsRef = useRef([]) // Track metrics during paused periods: [{pauseTime, resumeTime, metricsAtPause, metricsAtResume}]
  const didQuickAddRef = useRef(false)

  // Keep refs in sync with the latest state so event listeners always read fresh values.
  useEffect(() => { exercisesRef.current = Array.isArray(exercises) ? exercises : [] }, [exercises])
  useEffect(() => { workoutTimeRef.current = Number.isFinite(Number(workoutTime)) ? Number(workoutTime) : 0 }, [workoutTime])
  useEffect(() => { restTimeRef.current = Number.isFinite(Number(restTime)) ? Number(restTime) : 0 }, [restTime])
  useEffect(() => { isRestingRef.current = Boolean(isResting) }, [isResting])
  useEffect(() => { sessionTypeRef.current = sessionType }, [sessionType])
  useEffect(() => { sessionTypeModeRef.current = sessionTypeMode }, [sessionTypeMode])

  const computeEntryScore = (exs) => {
    // Higher score means "more filled-in work" (more likely the correct snapshot to keep).
    const list = Array.isArray(exs) ? exs : []
    let score = 0
    for (const ex of list) {
      for (const s of Array.isArray(ex?.sets) ? ex.sets : []) {
        if (s?.weight != null && String(s.weight).trim() !== '') score += 1
        if (s?.reps != null && String(s.reps).trim() !== '') score += 1
        if (s?.time != null && String(s.time).trim() !== '') score += 1
        if (s?.time_seconds != null && String(s.time_seconds).trim() !== '') score += 1
        if (s?.speed != null && String(s.speed).trim() !== '') score += 1
        if (s?.incline != null && String(s.incline).trim() !== '') score += 1
      }
    }
    return score
  }

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

  const normalizeNameKey = (name) => (name || '').toString().trim().toLowerCase()

  const parseTimeToSeconds = (raw) => {
    if (raw == null) return null
    const s = String(raw).trim()
    if (!s) return null
    if (s.includes(':')) {
      const [mm, ss] = s.split(':').map(v => v.trim())
      const m = Number(mm)
      const sec = Number(ss)
      if (Number.isFinite(m) && Number.isFinite(sec)) return Math.max(0, Math.floor(m * 60 + sec))
    }
    const n = Number(s)
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null
  }

  const formatLastSummary = (exRow) => {
    const sets = Array.isArray(exRow?.workout_sets) ? exRow.workout_sets : []
    // prefer weight/reps sets if present
    const strength = sets.filter(s => s?.weight || s?.reps)
    if (strength.length > 0) {
      // choose top set by weight (fallback to last)
      const toDisplayWeight = (s) => {
        if (s?.is_bodyweight === true) return 'BW'
        if (String(s?.weight_label || '').trim().toUpperCase() === 'BW') return 'BW'
        if (String(s?.weight || '').trim().toUpperCase() === 'BW') return 'BW'
        return s?.weight != null && String(s.weight).trim() !== '' ? Number(s.weight) : null
      }
      const sortWeight = (s) => {
        const w = toDisplayWeight(s)
        return typeof w === 'number' && Number.isFinite(w) ? w : 0
      }
      const top = strength.slice().sort((a, b) => (sortWeight(b) - sortWeight(a)))[0] || strength[strength.length - 1]
      const w = toDisplayWeight(top)
      const r = top?.reps ? Number(top.reps) : null
      if (w === 'BW' && r != null) return `${r}×BW`
      if (w === 'BW') return 'BW'
      if (w != null && r != null) return `${r}×${w} lbs`
      if (w != null) return `${w} lbs`
      if (r != null) return `${r} reps`
    }
    // cardio/recovery time
    const withTime = sets.filter(s => s?.time != null && String(s.time).trim() !== '')
    if (withTime.length > 0) {
      const t = withTime[withTime.length - 1]?.time
      const n = parseTimeToSeconds(t)
      if (Number.isFinite(n)) {
        const mins = Math.floor(Math.max(0, n) / 60)
        const secs = Math.max(0, n) % 60
        return `${mins}:${String(secs).padStart(2, '0')}`
      }
      return String(t)
    }
    return ''
  }

  // Last-time cues (best-effort). We only fetch a small recent window.
  useEffect(() => {
    if (!user?.id) return
    if (!Array.isArray(exercises) || exercises.length === 0) return
    let mounted = true
    ;(async () => {
      try {
        const wanted = new Set(exercises.map(e => normalizeNameKey(e?.name)).filter(Boolean))
        if (wanted.size === 0) return
        const recent = await getRecentWorkoutsFromSupabase(user.id, 30)
        const map = {}
        const best = {}
        for (const w of Array.isArray(recent) ? recent : []) {
          const wDate = w?.date ? String(w.date) : ''
          for (const exRow of Array.isArray(w?.workout_exercises) ? w.workout_exercises : []) {
            const key = normalizeNameKey(exRow?.exercise_name)
            if (!key || !wanted.has(key)) continue
            // Best e1RM (over recent window) for strength sets.
            const sets = Array.isArray(exRow?.workout_sets) ? exRow.workout_sets : []
            for (const s of sets) {
              if (s?.is_bodyweight === true || String(s?.weight_label || '').trim().toUpperCase() === 'BW') continue
              const weight = Number(s?.weight)
              const reps = Number(s?.reps)
              if (!Number.isFinite(weight) || !Number.isFinite(reps) || weight <= 0 || reps <= 0) continue
              const e1rm = weight * (1 + reps / 30)
              const prev = best[key]
              if (!prev || e1rm > prev.e1rm) {
                best[key] = { e1rm, weight, reps, date: wDate }
              }
            }

            // Most recent summary for display.
            if (!map[key]) {
              const summary = formatLastSummary(exRow)
              if (summary) map[key] = { summary, date: wDate }
            }
          }
          if (Object.keys(map).length >= wanted.size && Object.keys(best).length >= wanted.size) break
        }
        // Merge best into lastInfo map.
        const merged = {}
        for (const key of Array.from(wanted.values())) {
          if (map[key] || best[key]) {
            merged[key] = { ...(map[key] || {}), best: best[key] || null }
          }
        }
        if (mounted) setLastByExerciseName(merged)
      } catch (e) {
        // non-blocking
      }
    })()
    return () => {
      mounted = false
    }
  }, [user?.id, exercises])

  // Retention/activation instrumentation (best-effort; telemetry is OFF unless enabled).
  useEffect(() => {
    if (!user?.id) return
    if (!Array.isArray(exercises) || exercises.length === 0) return
    if (trackedStartRef.current) return
    trackedStartRef.current = true
    try {
      trackWorkoutEvent('start', null, {
        session_type: sessionType,
        template_id: templateId || null,
        exercise_count: exercises.length
      })
    } catch {}
  }, [user?.id, exercises?.length, sessionType, templateId])

  useEffect(() => {
    if (!user?.id) return
    if (trackedFirstSetRef.current) return
    const anySetLogged = (Array.isArray(exercises) ? exercises : []).some(ex =>
      (Array.isArray(ex?.sets) ? ex.sets : []).some(s =>
        (s?.weight != null && String(s.weight).trim() !== '') ||
        (s?.reps != null && String(s.reps).trim() !== '') ||
        (s?.time != null && String(s.time).trim() !== '') ||
        (s?.time_seconds != null && String(s.time_seconds).trim() !== '')
      )
    )
    if (!anySetLogged) return
    trackedFirstSetRef.current = true
    try {
      trackWorkoutEvent('first_set_logged', null, {
        session_type: sessionType,
        template_id: templateId || null
      })
      trackFeatureUsage('activation_first_set_logged', { session_type: sessionType })
    } catch {}
  }, [user?.id, exercises, sessionType, templateId])

  const resolveConfirm = (result) => {
    setConfirmDialog(prev => ({ ...prev, open: false }))
    const resolve = confirmResolverRef.current
    confirmResolverRef.current = null
    if (resolve) resolve(result)
  }

  const inferSessionTypeFromExercises = (exs) => {
    const list = Array.isArray(exs) ? exs : []
    if (list.length === 0) return 'workout'
    const nonRecovery = list.some(e => (e?.category || '').toString().toLowerCase() !== 'recovery')
    return nonRecovery ? 'workout' : 'recovery'
  }

  // Auto-detect session type unless user explicitly sets it
  useEffect(() => {
    if (sessionTypeMode !== 'auto') return
    setSessionType(inferSessionTypeFromExercises(exercises))
  }, [exercises, sessionTypeMode])

  // One-tap recovery logging: if user explicitly started a Recovery session, open the picker immediately.
  useEffect(() => {
    if (initialSessionType !== 'recovery') return
    if (exercises.length > 0) return
    if (templateId || randomWorkout || aiWorkout) return
    const t = setTimeout(() => setShowPicker(true), 200)
    return () => clearTimeout(t)
  }, [initialSessionType, exercises.length, templateId, randomWorkout, aiWorkout])

  // Command palette / shortcuts: open exercise picker immediately
  useEffect(() => {
    if (!openPickerOnLoad) return
    const t = setTimeout(() => setShowPicker(true), 0)
    return () => clearTimeout(t)
  }, [openPickerOnLoad])

  // Command palette: quick-add an exercise by name (one-enter logging)
  useEffect(() => {
    if (!quickAddExerciseName) return
    if (didQuickAddRef.current) return
    if (!Array.isArray(allExercises) || allExercises.length === 0) return

    const match = allExercises.find(e => (e?.name || '').toString().toLowerCase() === quickAddExerciseName.toString().toLowerCase())
    if (match) {
      if ((match.category || '').toString().toLowerCase() === 'recovery') {
        setSessionType('recovery')
        setSessionTypeMode('manual')
      }
      addExercise(match)
      didQuickAddRef.current = true
      return
    }

    // If not found, still allow adding a custom entry (keeps flow unblocked)
    addExercise({ name: quickAddExerciseName, category: 'Strength', bodyPart: 'Other', equipment: '' })
    didQuickAddRef.current = true
  }, [quickAddExerciseName, allExercises])

  // Auto-save exercises periodically during workout
  useEffect(() => {
    if (!userId || exercises.length === 0) return

    // Auto-save every 30 seconds
    autoSaveIntervalRef.current = setInterval(async () => {
      if (workoutStartTimeRef.current && exercises.length > 0) {
        const exercisesStr = JSON.stringify(exercises)
        try {
          // Only save if exercises have changed
          if (exercisesStr !== lastSavedExercisesRef.current) {
            // Save to active workout session
            const result = await saveActiveWorkoutSession(userId, {
              workoutStartTime: new Date(workoutStartTimeRef.current).toISOString(),
              pausedTimeMs: pausedTimeRef.current || 0,
              restStartTime: restStartTimeRef.current ? new Date(restStartTimeRef.current).toISOString() : null,
              restDurationSeconds: restDurationRef.current || null,
              isResting: isResting,
              exercises: exercises // Save exercises for recovery
            })
            
            // If saveActiveWorkoutSession returns null, table/column doesn't exist - that's okay, use localStorage
            lastSavedExercisesRef.current = exercisesStr

            // Also save to localStorage as backup
            localStorage.setItem(`activeWorkout_${userId}`, JSON.stringify({
              exercises,
              workoutTime,
              restTime,
              isResting,
              sessionType,
              sessionTypeMode,
              templateId,
              date: getTodayEST(),
              timestamp: Date.now()
            }))
          }
        } catch (error) {
          // Only log unexpected errors (not table/column missing errors)
          const isExpectedError = error.code === 'PGRST205' || 
                                  error.code === '42P01' ||
                                  error.code === '42703' ||
                                  error.message?.includes('Could not find the table') ||
                                  error.message?.includes('column') ||
                                  error.message?.includes('does not exist')
          
          if (!isExpectedError) {
            logError('Error auto-saving workout progress', error)
          }
          
          // Always fallback to localStorage
          try {
            localStorage.setItem(`activeWorkout_${userId}`, JSON.stringify({
              exercises,
              workoutTime,
              restTime,
              isResting,
              sessionType,
              sessionTypeMode,
              templateId,
              date: getTodayEST(),
              timestamp: Date.now()
            }))
            // Treat localStorage as a "save" for dirty/restore guards even if Supabase failed/offline.
            lastSavedExercisesRef.current = exercisesStr
          } catch (e) {
            // localStorage might be full or unavailable
            if (!isExpectedError) {
              logError('Error saving to localStorage backup', e)
            }
          }
        }
      }
    }, 30000) // Every 30 seconds

    return () => {
      if (autoSaveIntervalRef.current) {
        clearInterval(autoSaveIntervalRef.current)
      }
    }
  }, [userId, exercises, workoutTime, restTime, isResting, templateId, sessionType, sessionTypeMode])

  // Save exercises immediately when they change (debounced)
  useEffect(() => {
    if (!userId || exercises.length === 0 || !workoutStartTimeRef.current) return

    const saveTimeout = setTimeout(async () => {
      try {
        const result = await saveActiveWorkoutSession(userId, {
          workoutStartTime: new Date(workoutStartTimeRef.current).toISOString(),
          pausedTimeMs: pausedTimeRef.current || 0,
          restStartTime: restStartTimeRef.current ? new Date(restStartTimeRef.current).toISOString() : null,
          restDurationSeconds: restDurationRef.current || null,
          isResting: isResting,
          exercises: exercises
        })
        
        // If result is null, table/column doesn't exist - that's okay, localStorage will be used
        if (result !== null) {
          lastSavedExercisesRef.current = JSON.stringify(exercises)
        }

        // Also save to localStorage
        localStorage.setItem(`activeWorkout_${userId}`, JSON.stringify({
          exercises,
          workoutTime,
          restTime,
          isResting,
          sessionType,
          sessionTypeMode,
          templateId,
          date: getTodayEST(),
          timestamp: Date.now()
        }))
        // Even if Supabase is offline, localStorage is still a successful persistence layer.
        lastSavedExercisesRef.current = JSON.stringify(exercises)
      } catch (error) {
        // Only log unexpected errors (not table/column missing errors)
        const isExpectedError = error.code === 'PGRST205' || 
                                error.code === '42P01' ||
                                error.code === '42703' ||
                                error.message?.includes('Could not find the table') ||
                                error.message?.includes('column') ||
                                error.message?.includes('does not exist')
        
        if (!isExpectedError) {
          logError('Error saving exercise progress', error)
        }
        
        // Always fallback to localStorage
        try {
          localStorage.setItem(`activeWorkout_${userId}`, JSON.stringify({
            exercises,
            workoutTime,
            restTime,
            isResting,
            sessionType,
            sessionTypeMode,
            templateId,
            date: getTodayEST(),
            timestamp: Date.now()
          }))
          lastSavedExercisesRef.current = JSON.stringify(exercises)
        } catch (e) {
          // localStorage might be full or unavailable
          if (!isExpectedError) {
            logError('Error saving to localStorage', e)
          }
        }
      }
    }, 2000) // Debounce: save 2 seconds after last change

    return () => clearTimeout(saveTimeout)
  }, [exercises, userId, workoutTime, restTime, isResting, templateId, sessionType, sessionTypeMode])

  // Warn before leaving page with unsaved workout
  useEffect(() => {
    if (exercises.length === 0 || !workoutStartTimeRef.current) return

    const handleBeforeUnload = (e) => {
      // Only warn if there's actual progress (exercises with data)
      const hasProgress = exercises.some(ex => 
        ex.sets && ex.sets.some(s => 
          (s.weight && s.weight !== '') || 
          (s.reps && s.reps !== '') || 
          (s.time && s.time !== '')
        )
      )
      
      if (hasProgress) {
        e.preventDefault()
        e.returnValue = 'You have unsaved workout progress. Are you sure you want to leave?'
        return e.returnValue
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [exercises])

  useEffect(() => {
    let mounted = true
    
    async function load() {
      try {
        const allEx = await getAllExercises()
        if (!mounted) return
        // Exercises loaded from database
        setAllExercises(Array.isArray(allEx) ? allEx : [])
        
        // Check for paused workout first
        let hasResumedPaused = false
        if (userId) {
          try {
            const paused = await getPausedWorkoutFromSupabase(userId)
            if (!mounted) return
            if (paused) {
              // If user clicked "Resume" from Fitness page, automatically resume
              const shouldResume = location.state?.resumePaused || await confirmAsync({
                title: 'Resume workout?',
                message: 'You have a paused workout. Would you like to resume it?',
                confirmText: 'Resume',
                cancelText: 'Discard',
                isDestructive: true
              })
              if (shouldResume) {
                setExercises(Array.isArray(paused.exercises) ? paused.exercises : [])
                setWorkoutTime(paused.workout_time || 0)
                setRestTime(paused.rest_time || 0)
                setIsResting(paused.is_resting || false)
                workoutStartTimeRef.current = Date.now() - ((paused.workout_time || 0) * 1000)
                // Clear paused time since we're resuming fresh
                setPausedTime(0)
                pausedTimeRef.current = 0
                
                // Save to database
                if (userId) {
                  try {
                    await saveActiveWorkoutSession(userId, {
                      workoutStartTime: new Date(workoutStartTimeRef.current).toISOString(),
                      pausedTimeMs: 0,
                      restStartTime: null,
                      restDurationSeconds: null,
                      isResting: false
                    })
                  } catch (error) {
                    logError('Error saving resumed workout session', error)
                  }
                }
                // Delete paused workout since we're resuming
                await deletePausedWorkoutFromSupabase(userId)
                try {
                  localStorage.removeItem(`pausedWorkout_${userId}`)
                  localStorage.removeItem('pausedWorkout')
                } catch {}
                hasResumedPaused = true
              } else {
                // User chose not to resume, delete paused workout
                await deletePausedWorkoutFromSupabase(userId)
                try {
                  localStorage.removeItem(`pausedWorkout_${userId}`)
                  localStorage.removeItem('pausedWorkout')
                } catch {}
              }
            }
          } catch (error) {
            // Silently ignore PGRST205 errors (table doesn't exist - migration not run)
            if (error.code !== 'PGRST205' && !error.message?.includes('Could not find the table')) {
              logError('Error loading paused workout', error)
            }
          }
        }

        // If DB paused workout isn't available (missing migration, etc), fall back to localStorage paused workout.
        if (!hasResumedPaused && mounted) {
          try {
            const key = userId ? `pausedWorkout_${userId}` : 'pausedWorkout'
            const raw = localStorage.getItem(key)
            if (raw) {
              const paused = JSON.parse(raw)
              const shouldResume = location.state?.resumePaused || await confirmAsync({
                title: 'Resume workout?',
                message: 'You have a paused workout saved on this device. Would you like to resume it?',
                confirmText: 'Resume',
                cancelText: 'Discard',
                isDestructive: true
              })
              if (shouldResume) {
                setExercises(Array.isArray(paused.exercises) ? paused.exercises : [])
                setWorkoutTime(paused.workoutTime || 0)
                setRestTime(paused.restTime || 0)
                setIsResting(paused.isResting || false)
                workoutStartTimeRef.current = Date.now() - ((paused.workoutTime || 0) * 1000)
                setPausedTime(0)
                pausedTimeRef.current = 0
                hasResumedPaused = true
              }
              // Clean up either way so this doesn't keep nagging.
              localStorage.removeItem(key)
            }
          } catch {
            // ignore
          }
        }

        // Only load template/random/AI workout if we didn't resume a paused workout
        if (!hasResumedPaused && mounted) {
          if (templateId) {
            const template = await getTemplate(templateId)
            if (!mounted) return
            if (template && Array.isArray(template.exercises)) {
              const workoutExercises = template.exercises.map((entry, idx) => {
                const name = typeof entry === 'string' ? entry : (entry?.name || '')
                const presetSets = typeof entry === 'object' ? entry?.sets : undefined
                const presetReps = typeof entry === 'object' ? entry?.reps : undefined
                const presetTime = typeof entry === 'object' ? entry?.time : undefined
                const presetStackGroup = typeof entry === 'object' ? entry?.stackGroup : undefined

                const exerciseData = allEx.find(e => e.name === name)
                const isCardio = exerciseData?.category === 'Cardio'
                const isRecovery = exerciseData?.category === 'Recovery'
                const defaultSets = (isCardio || isRecovery) ? 1 : 4
                const setsCount = Number.isFinite(Number(presetSets)) && Number(presetSets) > 0 ? Number(presetSets) : defaultSets

                const repsValue = (presetReps ?? '').toString()
                const timeValue = (presetTime ?? '').toString()
                const targetSeconds = isCardio ? parseTimeToSeconds(timeValue) : null

                return {
                  id: idx,
                  name,
                  category: exerciseData?.category || 'Strength',
                  bodyPart: exerciseData?.bodyPart || 'Other',
                  equipment: exerciseData?.equipment || '',
                  stacked: Boolean(presetStackGroup),
                  stackGroup: presetStackGroup ? String(presetStackGroup) : null,
                  sets: Array(setsCount).fill(null).map(() => ({
                    weight: '',
                    reps: !isCardio ? repsValue : '',
                    // Cardio template "time" should be treated as a target, not a recorded time.
                    // Keep the live time fields empty so the timer starts at 0:00.
                    time: '',
                    time_seconds: '',
                    target_time: isCardio ? timeValue : '',
                    target_time_seconds: isCardio && targetSeconds != null ? targetSeconds : '',
                    speed: '',
                    incline: ''
                  })),
                  expanded: idx === 0
                }
              })
          
          // Apply auto-adjustment based on readiness
          if (user) {
            try {
              const adjustment = await getAutoAdjustmentFactor(user.id)
              setAdjustmentInfo(adjustment)
              if (adjustment.factor < 1.0) {
                const adjusted = applyAutoAdjustment(workoutExercises, adjustment.factor)
                setExercises(adjusted)
              } else {
                setExercises(workoutExercises)
              }
            } catch (error) {
              // Auto-adjustment failed, continue without adjustment
              setExercises(workoutExercises)
            }
          } else {
            setExercises(workoutExercises)
          }
        }
      } else if (randomWorkout) {
        // Generate random workout
        const strengthExercises = allEx.filter(e => e.category === 'Strength')
        const cardioExercises = allEx.filter(e => e.category === 'Cardio')
        
        // Pick 5-7 random strength exercises from different body parts
        const bodyParts = [...new Set(strengthExercises.map(e => e.bodyPart))]
        const shuffledBodyParts = bodyParts.sort(() => Math.random() - 0.5).slice(0, 5)
        
        const randomExercises = []
        shuffledBodyParts.forEach((bp, idx) => {
          const bpExercises = strengthExercises.filter(e => e.bodyPart === bp)
          if (bpExercises.length > 0) {
            const randomEx = bpExercises[Math.floor(Math.random() * bpExercises.length)]
            randomExercises.push({
              id: idx,
              name: randomEx.name,
              category: randomEx.category,
              bodyPart: randomEx.bodyPart,
              equipment: randomEx.equipment,
              sets: Array(4).fill(null).map(() => ({ weight: '', reps: '', time: '', speed: '', incline: '' })),
              expanded: idx === 0
            })
          }
        })
        
        // Add 1 cardio exercise
        if (cardioExercises.length > 0) {
          const randomCardio = cardioExercises[Math.floor(Math.random() * cardioExercises.length)]
          randomExercises.push({
            id: randomExercises.length,
            name: randomCardio.name,
            category: randomCardio.category,
            bodyPart: randomCardio.bodyPart,
            equipment: randomCardio.equipment,
            sets: [{ weight: '', reps: '', time: '', speed: '', incline: '' }],
            expanded: false
          })
        }
        
        setExercises(randomExercises)
      } else if (aiWorkout) {
        // Load AI-generated workout
        const workoutExercises = aiWorkout.exercises.map((ex, idx) => ({
          id: idx,
          name: ex.name,
          category: 'Strength',
          bodyPart: ex.bodyPart || 'Other',
          equipment: '',
          sets: Array(ex.sets || 3).fill(null).map(() => ({ 
            weight: '', 
            reps: ex.reps?.toString() || '', 
            time: '', 
            speed: '', 
            incline: '' 
          })),
          expanded: idx === 0
        }))
        setExercises(workoutExercises)
      }
      }
      } catch (error) {
        logError('Error loading workout', error)
      }
    }
    load()
    
    // Restore workout timer from database if it exists (workout in progress)
    async function loadWorkoutSession() {
      if (!userId) return
      
      let restoredExercises = false
      
      try {
        const session = await getActiveWorkoutSession(userId)
        
        if (session) {
          // Check if session is recent (within last 2 hours) - if older, ask user
          const sessionAge = Date.now() - new Date(session.workout_start_time).getTime()
          const isRecent = sessionAge < 7200000 // 2 hours
          
          // If session has exercises and is not recent, ask user if they want to resume
          if (session.exercises && Array.isArray(session.exercises) && session.exercises.length > 0 && !isRecent) {
            const startTimeLabel = new Date(session.workout_start_time).toLocaleString()
            const shouldResume = await confirmAsync({
              title: 'Resume workout?',
              message: `You have an older workout in progress from ${startTimeLabel}. Resume it or start fresh?`,
              confirmText: 'Resume',
              cancelText: 'Start fresh',
              isDestructive: true
            })
            
            if (!shouldResume) {
              // User wants to start fresh - delete the old session
              try {
                await deleteActiveWorkoutSession(userId)
                localStorage.removeItem(`activeWorkout_${userId}`)
              } catch (error) {
                // Silently fail
              }
              // Continue to initialize new workout below
            } else {
              // User wants to resume - restore the session
              workoutStartTimeRef.current = new Date(session.workout_start_time).getTime()
              const pausedMs = session.paused_time_ms || 0
              setPausedTime(pausedMs)
              pausedTimeRef.current = pausedMs
              const localExs = exercisesRef.current
              const localStr = JSON.stringify(localExs || [])
              const isDirtyLocal = lastSavedExercisesRef.current != null && localStr !== lastSavedExercisesRef.current
              const hasLocalProgress = computeEntryScore(localExs) > 0
              if (!isDirtyLocal && !hasLocalProgress) {
                setExercises(session.exercises)
                lastSavedExercisesRef.current = JSON.stringify(session.exercises)
              }
              restoredExercises = true
            }
          } else if (session.exercises && Array.isArray(session.exercises) && session.exercises.length > 0 && isRecent) {
            // Recent session - restore automatically
            workoutStartTimeRef.current = new Date(session.workout_start_time).getTime()
            const pausedMs = session.paused_time_ms || 0
            setPausedTime(pausedMs)
            pausedTimeRef.current = pausedMs
            const localExs = exercisesRef.current
            const localStr = JSON.stringify(localExs || [])
            const isDirtyLocal = lastSavedExercisesRef.current != null && localStr !== lastSavedExercisesRef.current
            const hasLocalProgress = computeEntryScore(localExs) > 0
            if (!isDirtyLocal && !hasLocalProgress) {
              setExercises(session.exercises)
              lastSavedExercisesRef.current = JSON.stringify(session.exercises)
            }
            restoredExercises = true
          } else {
            // Session exists but no exercises - restore timer only
            workoutStartTimeRef.current = new Date(session.workout_start_time).getTime()
            const pausedMs = session.paused_time_ms || 0
            setPausedTime(pausedMs)
            pausedTimeRef.current = pausedMs
          }
          
          // Restore rest timer if it was running
          if (session.rest_start_time && session.rest_duration_seconds) {
            restStartTimeRef.current = new Date(session.rest_start_time).getTime()
            restDurationRef.current = session.rest_duration_seconds
            setIsResting(session.is_resting || false)
            
            const elapsed = Math.floor((Date.now() - restStartTimeRef.current) / 1000)
            const remaining = Math.max(0, restDurationRef.current - elapsed)
            if (remaining > 0) {
              setRestTime(remaining)
              setIsResting(true)
              restTimerRef.current = setInterval(() => {
                if (restStartTimeRef.current) {
                  const elapsed = Math.floor((Date.now() - restStartTimeRef.current) / 1000)
                  const remaining = Math.max(0, restDurationRef.current - elapsed)
                  setRestTime(remaining)
                  if (remaining <= 0) {
                    clearInterval(restTimerRef.current)
                    setIsResting(false)
                    setShowTimesUp(true)
                    const timeoutId = setTimeout(() => setShowTimesUp(false), 2000)
                    timeoutRefs.current.push(timeoutId)
                    // Clear rest timer from database
                    saveActiveWorkoutSession(userId, {
                      workoutStartTime: new Date(workoutStartTimeRef.current).toISOString(),
                      pausedTimeMs: pausedTime,
                      restStartTime: null,
                      restDurationSeconds: null,
                      isResting: false
                    }).catch(() => {})
                  }
                }
              }, 1000)
            } else {
              // Rest timer expired, clear it
              setIsResting(false)
              saveActiveWorkoutSession(userId, {
                workoutStartTime: new Date(workoutStartTimeRef.current).toISOString(),
                pausedTimeMs: pausedTime,
                restStartTime: null,
                restDurationSeconds: null,
                isResting: false
              }).catch(() => {})
            }
          }
          
          // Calculate current elapsed time based on stored start time
          const elapsed = Math.floor((Date.now() - workoutStartTimeRef.current - (session.paused_time_ms || 0)) / 1000)
          setWorkoutTime(Math.max(0, elapsed))
        }
        
        // If no exercises were restored from database, try localStorage (even if session was null)
        if (!restoredExercises) {
          try {
            const saved = localStorage.getItem(`activeWorkout_${userId}`)
            if (saved) {
              const workoutData = JSON.parse(saved)
              // Restore if it's recent (within last 2 hours - reduced from 24 hours)
              const workoutAge = workoutData.timestamp ? (Date.now() - workoutData.timestamp) : Infinity
              const isRecent = workoutAge < 7200000 // 2 hours
              
              if (workoutData.timestamp && workoutAge < 86400000) { // Still check up to 24 hours for prompt
                if (workoutData.exercises && Array.isArray(workoutData.exercises) && workoutData.exercises.length > 0) {
                  // If not recent, ask user if they want to resume
                  if (!isRecent) {
                    const workoutDate = new Date(workoutData.timestamp).toLocaleString()
                    const shouldResume = await confirmAsync({
                      title: 'Resume workout?',
                      message: `You have an older workout saved from ${workoutDate}. Resume it or start fresh and delete it?`,
                      confirmText: 'Resume',
                      cancelText: 'Start fresh',
                      isDestructive: true
                    })
                    
                    if (!shouldResume) {
                      // User wants to start fresh - delete the old workout
                      localStorage.removeItem(`activeWorkout_${userId}`)
                      try {
                        await deleteActiveWorkoutSession(userId)
                      } catch (error) {
                        // Silently fail
                      }
                      // Continue to initialize new workout below
                    } else {
                    // User wants to resume - restore the workout
                    const localExs = exercisesRef.current
                    const localStr = JSON.stringify(localExs || [])
                    const isDirtyLocal = lastSavedExercisesRef.current != null && localStr !== lastSavedExercisesRef.current
                    const hasLocalProgress = computeEntryScore(localExs) > 0
                    if (!isDirtyLocal && !hasLocalProgress) {
                      setExercises(workoutData.exercises)
                      lastSavedExercisesRef.current = JSON.stringify(workoutData.exercises)
                    }
                    restoredExercises = true
                    
                    // Restore timer if we have workout start time
                    if (workoutData.timestamp) {
                      // Estimate workout start time from timestamp
                      if (!workoutStartTimeRef.current) {
                        workoutStartTimeRef.current = workoutData.timestamp - (workoutData.workoutTime || 0) * 1000
                      }
                    }
                    
                    // Restore start metrics from localStorage if available
                    try {
                      const savedMetrics = localStorage.getItem(`workoutStartMetrics_${userId}`)
                      if (savedMetrics) {
                        workoutStartMetricsRef.current = JSON.parse(savedMetrics)
                      }
                    } catch (e) {
                      // Silently fail
                    }
                    
                    if (workoutData.workoutTime) setWorkoutTime(workoutData.workoutTime)
                    if (workoutData.restTime) setRestTime(workoutData.restTime)
                    if (workoutData.isResting !== undefined) setIsResting(workoutData.isResting)
                    if (workoutData.sessionType) {
                      setSessionType((workoutData.sessionType || 'workout').toString().toLowerCase() === 'recovery' ? 'recovery' : 'workout')
                      if (workoutData.sessionTypeMode) {
                        setSessionTypeMode(workoutData.sessionTypeMode === 'manual' ? 'manual' : 'auto')
                      }
                    }
                    
                    showToast('Workout progress recovered from backup', 'info')
                    }
                  } else {
                    // Recent workout - restore automatically
                    const localExs = exercisesRef.current
                    const localStr = JSON.stringify(localExs || [])
                    const isDirtyLocal = lastSavedExercisesRef.current != null && localStr !== lastSavedExercisesRef.current
                    const hasLocalProgress = computeEntryScore(localExs) > 0
                    if (!isDirtyLocal && !hasLocalProgress) {
                      setExercises(workoutData.exercises)
                      lastSavedExercisesRef.current = JSON.stringify(workoutData.exercises)
                    }
                    restoredExercises = true
                    
                    // Restore timer if we have workout start time
                    if (workoutData.timestamp) {
                      // Estimate workout start time from timestamp
                      if (!workoutStartTimeRef.current) {
                        workoutStartTimeRef.current = workoutData.timestamp - (workoutData.workoutTime || 0) * 1000
                      }
                    }
                    
                    // Restore start metrics from localStorage if available
                    try {
                      const savedMetrics = localStorage.getItem(`workoutStartMetrics_${userId}`)
                      if (savedMetrics) {
                        workoutStartMetricsRef.current = JSON.parse(savedMetrics)
                      }
                    } catch (e) {
                      // Silently fail
                    }
                    
                    if (workoutData.workoutTime) setWorkoutTime(workoutData.workoutTime)
                    if (workoutData.restTime) setRestTime(workoutData.restTime)
                    if (workoutData.isResting !== undefined) setIsResting(workoutData.isResting)
                    if (workoutData.sessionType) {
                      setSessionType((workoutData.sessionType || 'workout').toString().toLowerCase() === 'recovery' ? 'recovery' : 'workout')
                      if (workoutData.sessionTypeMode) {
                        setSessionTypeMode(workoutData.sessionTypeMode === 'manual' ? 'manual' : 'auto')
                      }
                    }
                    
                    showToast('Workout progress recovered from backup', 'info')
                  }
                }
              }
            }
          } catch (e) {
            logError('Error restoring from localStorage', e)
          }
        }
        
        // If still no session and no restored exercises, initialize new workout
        if (!session && !restoredExercises) {
          workoutStartTimeRef.current = Date.now()
          setWorkoutTime(0)
          setPausedTime(0)
          pausedTimeRef.current = 0
          
          // Capture wearable metrics at workout start
          const startMetrics = await getCurrentWearableMetrics()
          workoutStartMetricsRef.current = startMetrics
          
          // Save start metrics to localStorage for persistence
          try {
            localStorage.setItem(`workoutStartMetrics_${userId}`, JSON.stringify(startMetrics))
          } catch (e) {
            // Silently fail
          }
          
          // Save to database
          try {
            await saveActiveWorkoutSession(userId, {
              workoutStartTime: new Date(workoutStartTimeRef.current).toISOString(),
              pausedTimeMs: 0,
              restStartTime: null,
              restDurationSeconds: null,
              isResting: false
            })
          } catch (error) {
            // Silently fail - localStorage will be used
          }
        }
      } catch (error) {
        logError('Error loading workout session', error)
        
        // Fallback: try localStorage even on error
        try {
          const saved = localStorage.getItem(`activeWorkout_${userId}`)
          if (saved) {
            const workoutData = JSON.parse(saved)
            const workoutAge = workoutData.timestamp ? (Date.now() - workoutData.timestamp) : Infinity
            const isRecent = workoutAge < 7200000 // 2 hours
            
            if (workoutData.timestamp && workoutAge < 86400000) {
              if (workoutData.exercises && Array.isArray(workoutData.exercises) && workoutData.exercises.length > 0) {
                // If not recent, ask user if they want to resume
                if (!isRecent) {
                  const workoutDate = new Date(workoutData.timestamp).toLocaleString()
                  const shouldResume = await confirmAsync({
                    title: 'Resume workout?',
                    message: `You have an older workout saved from ${workoutDate}. Resume it or start fresh and delete it?`,
                    confirmText: 'Resume',
                    cancelText: 'Start fresh',
                    isDestructive: true
                  })
                  
                  if (!shouldResume) {
                    // User wants to start fresh - delete the old workout
                    localStorage.removeItem(`activeWorkout_${userId}`)
                    try {
                      await deleteActiveWorkoutSession(userId)
                    } catch (error) {
                      // Silently fail
                    }
                    // Continue to initialize new timer below
                  } else {
                    // User wants to resume
                    const localExs = exercisesRef.current
                    const localStr = JSON.stringify(localExs || [])
                    const isDirtyLocal = lastSavedExercisesRef.current != null && localStr !== lastSavedExercisesRef.current
                    const hasLocalProgress = computeEntryScore(localExs) > 0
                    if (!isDirtyLocal && !hasLocalProgress) {
                      setExercises(workoutData.exercises)
                      lastSavedExercisesRef.current = JSON.stringify(workoutData.exercises)
                    }
                    
                    // Restore start metrics from localStorage if available
                    try {
                      const savedMetrics = localStorage.getItem(`workoutStartMetrics_${userId}`)
                      if (savedMetrics) {
                        workoutStartMetricsRef.current = JSON.parse(savedMetrics)
                      }
                    } catch (e) {
                      // Silently fail
                    }
                    
                    if (workoutData.workoutTime) setWorkoutTime(workoutData.workoutTime)
                    if (workoutData.restTime) setRestTime(workoutData.restTime)
                    if (workoutData.isResting !== undefined) setIsResting(workoutData.isResting)
                    if (workoutData.sessionType) {
                      setSessionType((workoutData.sessionType || 'workout').toString().toLowerCase() === 'recovery' ? 'recovery' : 'workout')
                      if (workoutData.sessionTypeMode) {
                        setSessionTypeMode(workoutData.sessionTypeMode === 'manual' ? 'manual' : 'auto')
                      }
                    }
                    showToast('Workout progress recovered from backup', 'info')
                    return // Don't initialize new timer if we recovered
                  }
                } else {
                  // Recent workout - restore automatically
                  const localExs = exercisesRef.current
                  const localStr = JSON.stringify(localExs || [])
                  const isDirtyLocal = lastSavedExercisesRef.current != null && localStr !== lastSavedExercisesRef.current
                  const hasLocalProgress = computeEntryScore(localExs) > 0
                  if (!isDirtyLocal && !hasLocalProgress) {
                    setExercises(workoutData.exercises)
                    lastSavedExercisesRef.current = JSON.stringify(workoutData.exercises)
                  }
                  
                  // Restore start metrics from localStorage if available
                  try {
                    const savedMetrics = localStorage.getItem(`workoutStartMetrics_${userId}`)
                    if (savedMetrics) {
                      workoutStartMetricsRef.current = JSON.parse(savedMetrics)
                    }
                  } catch (e) {
                    // Silently fail
                  }
                  
                  if (workoutData.workoutTime) setWorkoutTime(workoutData.workoutTime)
                  if (workoutData.restTime) setRestTime(workoutData.restTime)
                  if (workoutData.isResting !== undefined) setIsResting(workoutData.isResting)
                  showToast('Workout progress recovered from backup', 'info')
                  return // Don't initialize new timer if we recovered
                }
              }
            }
          }
        } catch (e) {
          logError('Error restoring from localStorage fallback', e)
        }
        
        // Last resort: initialize new timer
        workoutStartTimeRef.current = Date.now()
        setWorkoutTime(0)
        setPausedTime(0)
        pausedTimeRef.current = 0
        
        // Capture wearable metrics at workout start
        const startMetrics = await getCurrentWearableMetrics()
        workoutStartMetricsRef.current = startMetrics
        
        // Save start metrics to localStorage for persistence
        try {
          localStorage.setItem(`workoutStartMetrics_${userId}`, JSON.stringify(startMetrics))
        } catch (e) {
          // Silently fail
        }
      }
    }
    
    // Load workout session and set up timer after it loads
    loadWorkoutSession().then(() => {
      // Clear any existing interval first
      if (workoutTimerRef.current) {
        clearInterval(workoutTimerRef.current)
      }
      
      // Update timer every second - always calculate from absolute time, not incremental
      // This ensures timer continues even when app is in background
      const updateTimer = () => {
        if (workoutStartTimeRef.current && !isPaused) {
          // Use ref for pausedTime to get current value
          const elapsed = Math.floor((Date.now() - workoutStartTimeRef.current - pausedTimeRef.current) / 1000)
          setWorkoutTime(Math.max(0, elapsed))
        }
      }
      
      // Update immediately
      updateTimer()
      
      // Then update every second - always set up the interval if we have a start time
      if (workoutStartTimeRef.current) {
        workoutTimerRef.current = setInterval(updateTimer, 1000)
      }
    })
    
    // Handle visibility change - save when backgrounded, restore when foregrounded
    const handleVisibilityChange = async () => {
      if (!userId) return
      
      if (document.hidden) {
        // App is being backgrounded - SAVE exercises immediately
        const exs = exercisesRef.current
        if (exs.length > 0 && workoutStartTimeRef.current) {
          try {
            // Save to database
            await saveActiveWorkoutSession(userId, {
              workoutStartTime: new Date(workoutStartTimeRef.current).toISOString(),
              pausedTimeMs: pausedTimeRef.current || 0,
              restStartTime: restStartTimeRef.current ? new Date(restStartTimeRef.current).toISOString() : null,
              restDurationSeconds: restDurationRef.current || null,
              isResting: isRestingRef.current,
              exercises: exs
            })
            
            // Also save to localStorage as backup
            localStorage.setItem(`activeWorkout_${userId}`, JSON.stringify({
              exercises: exs,
              workoutTime: workoutTimeRef.current,
              restTime: restTimeRef.current,
              isResting: isRestingRef.current,
              sessionType: sessionTypeRef.current,
              sessionTypeMode: sessionTypeModeRef.current,
              templateId,
              date: getTodayEST(),
              timestamp: Date.now()
            }))
            lastSavedExercisesRef.current = JSON.stringify(exs)
          } catch (error) {
            // Silently fail - at least try localStorage
            try {
              localStorage.setItem(`activeWorkout_${userId}`, JSON.stringify({
                exercises: exs,
                workoutTime: workoutTimeRef.current,
                restTime: restTimeRef.current,
                isResting: isRestingRef.current,
                sessionType: sessionTypeRef.current,
                sessionTypeMode: sessionTypeModeRef.current,
                templateId,
                date: getTodayEST(),
                timestamp: Date.now()
              }))
              lastSavedExercisesRef.current = JSON.stringify(exs)
            } catch (e) {
              logError('Error saving to localStorage on background', e)
            }
          }
        }
      } else {
        // App is coming to foreground - restore and recalculate
        try {
          const session = await getActiveWorkoutSession(userId)
          if (session) {
            workoutStartTimeRef.current = new Date(session.workout_start_time).getTime()
            const pausedMs = session.paused_time_ms || 0
            setPausedTime(pausedMs)
            pausedTimeRef.current = pausedMs
            
            // Restore exercises only if it is safe to do so.
            // IMPORTANT: Never clobber local in-memory edits with a stale remote snapshot (this can wipe logged reps/weight).
            if (session.exercises && Array.isArray(session.exercises) && session.exercises.length > 0) {
              const localExs = exercisesRef.current
              const localStr = JSON.stringify(localExs || [])
              const localScore = computeEntryScore(localExs)
              const hasLocalProgress = localScore > 0
              const isDirtyLocal = lastSavedExercisesRef.current != null && localStr !== lastSavedExercisesRef.current
              if (!isDirtyLocal && !hasLocalProgress) {
                setExercises(session.exercises)
                lastSavedExercisesRef.current = JSON.stringify(session.exercises)
              } else {
                // Keep local. If remote is clearly "richer", we can surface a nudge (no destructive auto-restore).
                const remoteScore = computeEntryScore(session.exercises)
                if (remoteScore > localScore + 3) {
                  showToast('We found a synced workout snapshot, but kept your local entries to avoid losing data.', 'info')
                }
              }
            }
            
            // Restore start metrics from localStorage if available
            try {
              const savedMetrics = localStorage.getItem(`workoutStartMetrics_${userId}`)
              if (savedMetrics) {
                workoutStartMetricsRef.current = JSON.parse(savedMetrics)
              }
            } catch (e) {
              // Silently fail
            }
            
            // Initialize paused metrics ref (we can't restore paused metrics from storage, so start fresh)
            pausedMetricsRef.current = []
            
            // Recalculate workout time based on absolute time difference
            const elapsed = Math.floor((Date.now() - workoutStartTimeRef.current - pausedMs) / 1000)
            setWorkoutTime(Math.max(0, elapsed))
            
            // Recalculate rest timer
            if (session.rest_start_time && session.rest_duration_seconds) {
              restStartTimeRef.current = new Date(session.rest_start_time).getTime()
              restDurationRef.current = session.rest_duration_seconds
              setIsResting(session.is_resting || false)
              
              const elapsed = Math.floor((Date.now() - restStartTimeRef.current) / 1000)
              const remaining = Math.max(0, restDurationRef.current - elapsed)
              setRestTime(remaining)
              if (remaining <= 0 && isRestingRef.current) {
                clearInterval(restTimerRef.current)
                setIsResting(false)
                setShowTimesUp(true)
                const timeoutId = setTimeout(() => setShowTimesUp(false), 2000)
                timeoutRefs.current.push(timeoutId)
                // Clear rest timer from database
                await saveActiveWorkoutSession(userId, {
                  workoutStartTime: new Date(workoutStartTimeRef.current).toISOString(),
                  pausedTimeMs: pausedTime,
                  restStartTime: null,
                  restDurationSeconds: null,
                  isResting: false
                })
              }
            }
          }
        } catch (error) {
          logError('Error reloading workout session on visibility change', error)
        }
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    
    // Also handle page focus/blur for better mobile support
    const handleFocus = async () => {
      if (workoutStartTimeRef.current && userId) {
        try {
          const session = await getActiveWorkoutSession(userId)
          if (session) {
            workoutStartTimeRef.current = new Date(session.workout_start_time).getTime()
            const pausedMs = session.paused_time_ms || 0
            setPausedTime(pausedMs)
            pausedTimeRef.current = pausedMs
            const elapsed = Math.floor((Date.now() - workoutStartTimeRef.current - pausedMs) / 1000)
            setWorkoutTime(Math.max(0, elapsed))
          }
        } catch (error) {
          logError('Error reloading workout session on focus', error)
        }
      }
    }
    window.addEventListener('focus', handleFocus)
    
    return () => {
      mounted = false
      clearInterval(workoutTimerRef.current)
      clearInterval(restTimerRef.current)
      // Clear all timeouts
      timeoutRefs.current.forEach(timeoutId => clearTimeout(timeoutId))
      timeoutRefs.current = []
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleFocus)
    }
  }, [templateId, randomWorkout, aiWorkout, userId])
  
  // Separate effect to handle timer updates based on isPaused state
  useEffect(() => {
    if (!workoutStartTimeRef.current) return
    
    // Clear existing interval
    if (workoutTimerRef.current) {
      clearInterval(workoutTimerRef.current)
    }
    
    if (!isPaused) {
      // Timer is running - update every second
      workoutTimerRef.current = setInterval(() => {
        if (workoutStartTimeRef.current && !isPaused) {
          const elapsed = Math.floor((Date.now() - workoutStartTimeRef.current - pausedTimeRef.current) / 1000)
          setWorkoutTime(Math.max(0, elapsed))
        }
      }, 1000)
    }
    
    return () => {
      if (workoutTimerRef.current) {
        clearInterval(workoutTimerRef.current)
      }
    }
  }, [isPaused])

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  // Get current wearable metrics (calories burned and steps)
  const getCurrentWearableMetrics = async () => {
    if (!user) return { calories: null, steps: null }
    
    try {
      const today = getTodayEST()
      // Try to get today's data first
      let fitbitData = await getFitbitDaily(user.id, today)
      
      // If no data for today, try yesterday
      if (!fitbitData) {
        const { getYesterdayEST } = await import('../utils/dateUtils')
        const yesterday = getYesterdayEST()
        fitbitData = await getFitbitDaily(user.id, yesterday)
      }
      
      // If still no data, try most recent
      if (!fitbitData) {
        fitbitData = await getMostRecentFitbitData(user.id)
      }
      
      if (fitbitData) {
        return {
          calories: fitbitData.calories_burned || fitbitData.calories || null,
          steps: fitbitData.steps || null
        }
      }
    } catch (error) {
      logError('Error getting wearable metrics', error)
    }
    
    return { calories: null, steps: null }
  }

  const startRest = async (duration = 90) => {
    if (!userId) return
    
    restDurationRef.current = duration
    restStartTimeRef.current = Date.now()
    setRestTime(duration)
    setIsResting(true)
    
    // Save to database
    try {
      await saveActiveWorkoutSession(userId, {
        workoutStartTime: new Date(workoutStartTimeRef.current).toISOString(),
        pausedTimeMs: pausedTime,
        restStartTime: new Date(restStartTimeRef.current).toISOString(),
        restDurationSeconds: duration,
        isResting: true
      })
    } catch (error) {
      logError('Error saving rest timer to database', error)
    }
    
    clearInterval(restTimerRef.current)
    restTimerRef.current = setInterval(() => {
      if (restStartTimeRef.current) {
        const elapsed = Math.floor((Date.now() - restStartTimeRef.current) / 1000)
        const remaining = Math.max(0, restDurationRef.current - elapsed)
        setRestTime(remaining)
        if (remaining <= 0) {
          clearInterval(restTimerRef.current)
          setIsResting(false)
          setShowTimesUp(true)
          const timeoutId = setTimeout(() => setShowTimesUp(false), 2000)
          timeoutRefs.current.push(timeoutId)
          // Clear rest timer from database
          if (userId) {
            saveActiveWorkoutSession(userId, {
              workoutStartTime: new Date(workoutStartTimeRef.current).toISOString(),
              pausedTimeMs: pausedTime,
              restStartTime: null,
              restDurationSeconds: null,
              isResting: false
            }).catch(() => {})
          }
        }
      }
    }, 1000)
  }

  const skipRest = async () => {
    if (!userId) return
    
    clearInterval(restTimerRef.current)
    setIsResting(false)
    setRestTime(0)
    
    // Clear rest timer from database
    try {
      await saveActiveWorkoutSession(userId, {
        workoutStartTime: new Date(workoutStartTimeRef.current).toISOString(),
        pausedTimeMs: pausedTime,
        restStartTime: null,
        restDurationSeconds: null,
        isResting: false
      })
    } catch (error) {
      logError('Error clearing rest timer from database', error)
    }
  }

  // Persist prefs (used by ExerciseCard for auto-advance/auto-next)
  useEffect(() => {
    try { localStorage.setItem('workout_auto_advance', prefAutoAdvance ? '1' : '0') } catch {}
  }, [prefAutoAdvance])

  useEffect(() => {
    try { localStorage.setItem('workout_auto_next', prefAutoNext ? '1' : '0') } catch {}
  }, [prefAutoNext])

  // Lightweight sync pill (trust-grade)
  useEffect(() => {
    const update = () => {
      try {
        if (isSaving) return setSyncPill({ label: 'Saving…', tone: 'warn' })
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return setSyncPill({ label: 'Offline', tone: 'warn' })
        if (user) return setSyncPill({ label: 'Synced', tone: 'good' })
        return setSyncPill({ label: 'Local', tone: 'neutral' })
      } catch {
        return setSyncPill({ label: 'Ready', tone: 'neutral' })
      }
    }
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [isSaving, user])

  const toggleExpanded = (id) => {
    setExercises(prev => prev.map(ex => 
      ex.id === id ? { ...ex, expanded: !ex.expanded } : { ...ex, expanded: false }
    ))
  }

  const updateSet = (exerciseId, setIndex, field, value) => {
    setExercises(prev => prev.map(ex => {
      if (ex.id !== exerciseId) return ex
      const newSets = [...ex.sets]
      newSets[setIndex] = { ...newSets[setIndex], [field]: value }
      return { ...ex, sets: newSets }
    }))
  }

  const addSet = (exerciseId) => {
    setExercises(prev => prev.map(ex => {
      if (ex.id !== exerciseId) return ex
      const lastSet = ex.sets[ex.sets.length - 1] || { weight: '', reps: '', time: '', time_seconds: '', speed: '', incline: '' }
      return { 
        ...ex, 
        // Keep a consistent set shape across all exercise types (Supabase persists: weight, reps, time, speed, incline).
        sets: [
          ...ex.sets,
          {
            weight: lastSet.weight ?? '',
            reps: lastSet.reps ?? '',
            time: lastSet.time ?? '',
            time_seconds: lastSet.time_seconds ?? '',
            speed: lastSet.speed ?? '',
            incline: lastSet.incline ?? ''
          }
        ]
      }
    }))
  }

  const removeSet = (exerciseId) => {
    setExercises(prev => prev.map(ex => {
      if (ex.id !== exerciseId || ex.sets.length <= 1) return ex
      return { ...ex, sets: ex.sets.slice(0, -1) }
    }))
  }

  const addExercise = (exercise) => {
    const isCardio = exercise.category === 'Cardio'
    const isRecovery = exercise.category === 'Recovery'
    const defaultSets = (isCardio || isRecovery) ? 1 : 4
    const newExercise = {
      id: Date.now(),
      name: exercise.name,
      category: exercise.category,
      bodyPart: exercise.bodyPart,
      sets: Array(defaultSets).fill(null).map(() => ({ weight: '', reps: '', time: '', time_seconds: '', speed: '', incline: '' })),
      expanded: true
    }
    setExercises(prev => [...prev.map(e => ({ ...e, expanded: false })), newExercise])
    setShowPicker(false)
  }

  const quickAddRecovery = (name) => {
    const match = allExercises.find(e => (e?.name || '').toString().toLowerCase() === name.toLowerCase())
    addExercise(match || { name, category: 'Recovery', bodyPart: 'Recovery', equipment: '' })
  }

  const removeExercise = (id) => {
    setExercises(prev => prev.filter(ex => ex.id !== id))
  }

  const moveExercise = (id, direction) => {
    setExercises(prev => {
      const idx = prev.findIndex(ex => ex.id === id)
      if (idx === -1) return prev
      if (direction === 'up' && idx === 0) return prev
      if (direction === 'down' && idx === prev.length - 1) return prev
      
      const newArr = [...prev]
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1
      ;[newArr[idx], newArr[swapIdx]] = [newArr[swapIdx], newArr[idx]]
      return newArr
    })
  }

  const completeExercise = (id) => {
    setExercises(prev => {
      const idx = prev.findIndex(ex => ex.id === id)
      const currentExercise = prev[idx]
      
      // If exercise is stacked, move to next exercise in stack instead of next sequential
      if (currentExercise?.stacked && currentExercise?.stackGroup) {
        const stackMembers = prev.filter(ex => ex.stacked && ex.stackGroup === currentExercise.stackGroup)
        const currentStackIndex = stackMembers.findIndex(ex => ex.id === id)
        const nextStackIndex = (currentStackIndex + 1) % stackMembers.length
        const nextStackExercise = stackMembers[nextStackIndex]
        const nextStackGlobalIndex = prev.findIndex(ex => ex.id === nextStackExercise.id)
        
        return prev.map((ex, i) => ({
          ...ex,
          completed: ex.id === id ? true : ex.completed,
          expanded: i === nextStackGlobalIndex // expand next exercise in stack
        }))
      }
      
      // Normal flow - expand next sequential exercise
      const newArr = prev.map((ex, i) => ({
        ...ex,
        completed: ex.id === id ? true : ex.completed,
        expanded: i === idx + 1 // expand next exercise
      }))
      return newArr
    })
  }

  const handleDragStart = (e, id) => {
    setDraggedId(id)
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/html', id.toString())
    }
    // Add visual feedback
    const card = e.target.closest('[class*="card"]') || e.target
    if (card) {
      card.style.opacity = '0.5'
    }
  }

  const handleDragOver = (e, targetId) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    
    if (draggedId === null || draggedId === targetId) return
    
    setExercises(prev => {
      const dragIdx = prev.findIndex(ex => ex.id === draggedId)
      const targetIdx = prev.findIndex(ex => ex.id === targetId)
      if (dragIdx === -1 || targetIdx === -1) return prev
      
      const newArr = [...prev]
      const [dragged] = newArr.splice(dragIdx, 1)
      newArr.splice(targetIdx, 0, dragged)
      return newArr
    })
  }

  const handleDragEnd = (e) => {
    // Reset opacity
    const card = e.target.closest('[class*="card"]') || e.target
    if (card) {
      card.style.opacity = '1'
    }
    setDraggedId(null)
  }

  const handleDragEnter = (e) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = (e, targetId) => {
    e.preventDefault()
    e.stopPropagation()
    setDraggedId(null)
  }

  const handleFinishClick = async () => {
    // Don't clear timers here - let them continue until workout is actually saved
    // This ensures accurate final time even if user takes time to fill out feedback
    
    // Calculate workout metrics when summary modal is shown
    let workoutCaloriesBurned = null
    let workoutSteps = null
    if (user && workoutStartMetricsRef.current) {
      try {
        const endMetrics = await getCurrentWearableMetrics()
        const startMetrics = workoutStartMetricsRef.current
        
        // If workout is currently paused, close out the last pause period
        if (isPaused && pausedMetricsRef.current && pausedMetricsRef.current.length > 0) {
          const lastPause = pausedMetricsRef.current[pausedMetricsRef.current.length - 1]
          if (lastPause && !lastPause.resumeTime) {
            // Workout finished while paused - use end metrics as resume metrics
            lastPause.resumeTime = Date.now()
            lastPause.metricsAtResume = endMetrics
          }
        }
        
        // Calculate total difference (end - start)
        let totalCaloriesDiff = null
        let totalStepsDiff = null
        
        if (endMetrics.calories != null && startMetrics.calories != null) {
          totalCaloriesDiff = endMetrics.calories - startMetrics.calories
        }
        if (endMetrics.steps != null && startMetrics.steps != null) {
          totalStepsDiff = endMetrics.steps - startMetrics.steps
        }
        
        // Subtract metrics accumulated during paused periods
        if (pausedMetricsRef.current && pausedMetricsRef.current.length > 0) {
          let pausedCalories = 0
          let pausedSteps = 0
          
          pausedMetricsRef.current.forEach(pause => {
            if (pause.metricsAtPause && pause.metricsAtResume) {
              // Calculate metrics accumulated during this pause period
              const pauseCalories = pause.metricsAtResume.calories != null && pause.metricsAtPause.calories != null
                ? pause.metricsAtResume.calories - pause.metricsAtPause.calories
                : 0
              const pauseSteps = pause.metricsAtResume.steps != null && pause.metricsAtPause.steps != null
                ? pause.metricsAtResume.steps - pause.metricsAtPause.steps
                : 0
              
              pausedCalories += Math.max(0, pauseCalories)
              pausedSteps += Math.max(0, pauseSteps)
            }
          })
          
          // Subtract paused metrics from total
          if (totalCaloriesDiff != null) {
            workoutCaloriesBurned = Math.max(0, totalCaloriesDiff - pausedCalories)
          }
          if (totalStepsDiff != null) {
            workoutSteps = Math.max(0, totalStepsDiff - pausedSteps)
          }
        } else {
          // No pauses, use total difference
          if (totalCaloriesDiff != null) {
            workoutCaloriesBurned = Math.max(0, totalCaloriesDiff)
          }
          if (totalStepsDiff != null) {
            workoutSteps = Math.max(0, totalStepsDiff)
          }
        }
      } catch (error) {
        logError('Error calculating workout wearable metrics for summary', error)
      }
    }
    
    // Store calculated metrics for display in summary modal
    setCalculatedWorkoutMetrics({
      calories: workoutCaloriesBurned,
      steps: workoutSteps
    })
    
    setShowSummary(true)
  }

  // IMPORTANT: Workouts are ONLY created when the user explicitly finishes a workout.
  // This is the ONLY place where workout logs are created - never automatically.
  const finishWorkout = async ({ openShare = true, navigateTo = null } = {}) => {
    // Clean up timers and auto-save
    clearInterval(workoutTimerRef.current)
    clearInterval(restTimerRef.current)
    if (autoSaveIntervalRef.current) {
      clearInterval(autoSaveIntervalRef.current)
    }
    
    // Final save of exercises before finishing (safety measure)
    if (userId && exercises.length > 0 && workoutStartTimeRef.current) {
      try {
        await saveActiveWorkoutSession(userId, {
          workoutStartTime: new Date(workoutStartTimeRef.current).toISOString(),
          pausedTimeMs: pausedTimeRef.current || 0,
          restStartTime: restStartTimeRef.current ? new Date(restStartTimeRef.current).toISOString() : null,
          restDurationSeconds: restDurationRef.current || null,
          isResting: false,
          exercises: exercises
        })
      } catch (error) {
        logError('Error saving final workout state', error)
      }
    }
    
    // Delete active workout session from database (after final save)
    if (userId) {
      try {
        await deleteActiveWorkoutSession(userId)
      } catch (error) {
        logError('Error deleting active workout session', error)
      }
    }
    
    // Delete paused workout if it exists
    if (userId) {
      try {
        await deletePausedWorkoutFromSupabase(userId)
      } catch (error) {
        // Silently fail
      }
    }
    // Clear local paused backups
    if (userId) {
      try {
        localStorage.removeItem(`pausedWorkout_${userId}`)
        localStorage.removeItem('pausedWorkout')
      } catch {}
    }

    // Clear localStorage backup
    if (userId) {
      try {
        localStorage.removeItem(`activeWorkout_${userId}`)
        localStorage.removeItem(`workoutStartMetrics_${userId}`)
      } catch (e) {
        // Silently fail
      }
    }
    
    // Capture wearable metrics at workout end and calculate difference
    let workoutCaloriesBurned = null
    let workoutSteps = null
    if (userId && workoutStartMetricsRef.current) {
      try {
        const endMetrics = await getCurrentWearableMetrics()
        const startMetrics = workoutStartMetricsRef.current
        
        // If workout is currently paused, close out the last pause period
        if (isPaused && pausedMetricsRef.current && pausedMetricsRef.current.length > 0) {
          const lastPause = pausedMetricsRef.current[pausedMetricsRef.current.length - 1]
          if (lastPause && !lastPause.resumeTime) {
            // Workout finished while paused - use end metrics as resume metrics
            lastPause.resumeTime = Date.now()
            lastPause.metricsAtResume = endMetrics
          }
        }
        
        // Calculate total difference (end - start)
        let totalCaloriesDiff = null
        let totalStepsDiff = null
        
        if (endMetrics.calories != null && startMetrics.calories != null) {
          totalCaloriesDiff = endMetrics.calories - startMetrics.calories
        }
        if (endMetrics.steps != null && startMetrics.steps != null) {
          totalStepsDiff = endMetrics.steps - startMetrics.steps
        }
        
        // Subtract metrics accumulated during paused periods
        if (pausedMetricsRef.current && pausedMetricsRef.current.length > 0) {
          let pausedCalories = 0
          let pausedSteps = 0
          
          pausedMetricsRef.current.forEach(pause => {
            if (pause.metricsAtPause && pause.metricsAtResume) {
              // Calculate metrics accumulated during this pause period
              const pauseCalories = pause.metricsAtResume.calories != null && pause.metricsAtPause.calories != null
                ? pause.metricsAtResume.calories - pause.metricsAtPause.calories
                : 0
              const pauseSteps = pause.metricsAtResume.steps != null && pause.metricsAtPause.steps != null
                ? pause.metricsAtResume.steps - pause.metricsAtPause.steps
                : 0
              
              pausedCalories += Math.max(0, pauseCalories)
              pausedSteps += Math.max(0, pauseSteps)
            }
          })
          
          // Subtract paused metrics from total
          if (totalCaloriesDiff != null) {
            workoutCaloriesBurned = Math.max(0, totalCaloriesDiff - pausedCalories)
          }
          if (totalStepsDiff != null) {
            workoutSteps = Math.max(0, totalStepsDiff - pausedSteps)
          }
        } else {
          // No pauses, use total difference
          if (totalCaloriesDiff != null) {
            workoutCaloriesBurned = Math.max(0, totalCaloriesDiff)
          }
          if (totalStepsDiff != null) {
            workoutSteps = Math.max(0, totalStepsDiff)
          }
        }
      } catch (error) {
        logError('Error calculating workout wearable metrics', error)
      }
    }
    
    const workout = {
      id: uuidv4(),
      date: getTodayEST(),
      duration: workoutTime,
      templateName: sessionType === 'recovery' ? 'Recovery Session' : (templateId || 'Freestyle'),
      sessionType: sessionType,
      perceivedEffort: feedback.rpe,
      moodAfter: feedback.moodAfter,
      notes: feedback.notes,
      dayOfWeek: new Date().getDay(),
      workoutCaloriesBurned: workoutCaloriesBurned,
      workoutSteps: workoutSteps,
      // IMPORTANT: Include ALL exercises from the workout, don't filter any out
      // Only filter sets to show valid ones, but keep all exercises
      exercises: exercises.map(ex => ({
        name: ex.name,
        category: ex.category || 'Strength',
        bodyPart: ex.bodyPart || 'Other',
        equipment: ex.equipment || '',
        stacked: ex.stacked || false,
        stackGroup: ex.stackGroup || null,
        // Filter sets: include if weight, reps, or time is not null/undefined/empty string
        // NOTE: 0 is a valid value, so check for != null and != '' (matches ShareCard logic)
        sets: ex.sets.filter(s => {
          if (!s) return false
          const hasWeight = s.weight != null && s.weight !== ''
          const hasReps = s.reps != null && s.reps !== ''
          const hasTime = s.time != null && s.time !== ''
          return hasWeight || hasReps || hasTime
        })
      }))
      // REMOVED: .filter(ex => ex.sets.length > 0) - this was removing exercises!
    }
    
    // Allow workouts with 0 exercises (user may want to log a workout session without exercises)
    // Note: Exercises can have no sets, that's okay - we show all exercises
    
    setIsSaving(true)
    try {
      // Save to local IndexedDB first (fast, local backup)
      await saveWorkout(workout)

      if (!trackedCompleteRef.current) {
        trackedCompleteRef.current = true
        try {
          trackWorkoutEvent('complete', null, {
            session_type: sessionType,
            template_id: templateId || null,
            duration_seconds: workoutTime,
            exercise_count: (Array.isArray(exercises) ? exercises.length : 0)
          })
          trackFeatureUsage('activation_workout_completed', { session_type: sessionType })
        } catch {}
      }
      
      // Save to Supabase if logged in (with retry logic)
      if (user) {
        let retries = 3
        let saved = false
        while (retries > 0 && !saved) {
          try {
            await saveWorkoutToSupabase(workout, user.id)
            saved = true
            showToast(sessionType === 'recovery' ? 'Recovery session saved successfully!' : 'Workout saved successfully!', 'success')
            
            // Trigger history refresh event for Fitness page
            window.dispatchEvent(new CustomEvent('workoutSaved', { detail: { workout } }))
          } catch (err) {
            retries--
            logError(`Error saving workout to Supabase (${3 - retries}/3 attempts)`, err)
            if (retries > 0) {
              // Wait before retry
              await new Promise(resolve => setTimeout(resolve, 1000))
            } else {
              // All retries failed
              showToast('Workout saved locally. Syncing to cloud failed - will retry later.', 'warning')
              // Persist for eventual sync
              enqueueOutboxItem({ userId: user.id, kind: 'workout', payload: { workout } })
            }
          }
        }
      } else {
        showToast(sessionType === 'recovery' ? 'Recovery session saved locally!' : 'Workout saved locally!', 'success')
      }
      
      // Automatically share workout to feed
      try {
        if (user) {
          const shared = await shareWorkoutToFeed(workout, user.id)
          if (shared) {
            // Feed will update automatically via the 'feedUpdated' event
          }
        }
      } catch (err) {
        logError('Error sharing workout to feed', err)
        // Don't show error to user - feed sharing is non-critical
      }
      
      // Store workout for sharing (manual share/download)
      if (openShare) {
        setSavedWorkout(workout)
        setShowShareModal(true)
      } else {
        setSavedWorkout(null)
        setShowShareModal(false)
        setShowSummary(false)
        if (navigateTo) navigate(navigateTo)
      }
    } catch (err) {
      logError('Error saving workout', err)
      showToast('Failed to save workout. Please try again.', 'error')
    } finally {
      setIsSaving(false)
    }
  }
  
  const handleShareClose = () => {
    setShowShareModal(false)
    setSavedWorkout(null)
    // Navigate to fitness page to see the saved workout in history
    navigate('/fitness', { state: { refreshHistory: true } })
  }

  // Pause workout functionality
  const pauseWorkout = async () => {
    if (!isPaused) {
      // Capture metrics at pause time
      const pauseMetrics = await getCurrentWearableMetrics()
      const pauseTime = Date.now()
      
      // Pause: stop timer, save state
      setIsPaused(true)
      pauseStartTime.current = pauseTime
      clearInterval(workoutTimerRef.current)
      clearInterval(restTimerRef.current)
      
      // Store pause metrics
      if (!pausedMetricsRef.current) {
        pausedMetricsRef.current = []
      }
      pausedMetricsRef.current.push({
        pauseTime: pauseTime,
        metricsAtPause: pauseMetrics
      })
      
      // Save paused workout state
      if (userId) {
        try {
          await savePausedWorkoutToSupabase({
            exercises,
            workoutTime,
            restTime,
            isResting,
            templateId,
            date: getTodayEST()
          }, userId)
        } catch (error) {
          logError('Error saving paused workout', error)
          // Also save to localStorage as backup
          localStorage.setItem(`pausedWorkout_${userId}`, JSON.stringify({
            exercises,
            workoutTime,
            restTime,
            isResting,
            templateId,
            date: getTodayEST()
          }))
        }
      } else {
        // Not logged in, save to localStorage
        localStorage.setItem('pausedWorkout', JSON.stringify({
          exercises,
          workoutTime,
          restTime,
          isResting,
          templateId,
          date: getTodayEST()
        }))
      }
    }
  }

  const pauseAndExit = async () => {
    try {
      if (!isPaused) {
        await pauseWorkout()
      }
    } catch (e) {
      // If pausing fails, still allow navigation—localStorage backup covers most cases.
    }
    showToast('Workout paused. You can resume it later.', 'info')
    navigate('/')
  }

  const resumeWorkout = async () => {
    if (isPaused && userId) {
      // Capture metrics at resume time
      const resumeMetrics = await getCurrentWearableMetrics()
      const resumeTime = Date.now()
      
      // Find the most recent pause entry and update it with resume info
      if (pausedMetricsRef.current && pausedMetricsRef.current.length > 0) {
        const lastPause = pausedMetricsRef.current[pausedMetricsRef.current.length - 1]
        if (lastPause && !lastPause.resumeTime) {
          lastPause.resumeTime = resumeTime
          lastPause.metricsAtResume = resumeMetrics
        }
      }
      
      // Resume: adjust paused time by pause duration
      const pauseDuration = pauseStartTime.current ? resumeTime - pauseStartTime.current : 0
      const newPausedTime = pausedTime + pauseDuration
      setPausedTime(newPausedTime)
      pausedTimeRef.current = newPausedTime
      setIsPaused(false)
      pauseStartTime.current = null
      
      // Restart the timer interval
      if (workoutStartTimeRef.current) {
        if (workoutTimerRef.current) {
          clearInterval(workoutTimerRef.current)
        }
        workoutTimerRef.current = setInterval(() => {
          if (workoutStartTimeRef.current && !isPaused) {
            const elapsed = Math.floor((Date.now() - workoutStartTimeRef.current - pausedTimeRef.current) / 1000)
            setWorkoutTime(Math.max(0, elapsed))
          }
        }, 1000)
      }
      
      // Save to database
      try {
        await saveActiveWorkoutSession(userId, {
          workoutStartTime: new Date(workoutStartTimeRef.current).toISOString(),
          pausedTimeMs: newPausedTime,
          restStartTime: restStartTimeRef.current ? new Date(restStartTimeRef.current).toISOString() : null,
          restDurationSeconds: restDurationRef.current || null,
          isResting: isResting
        })
      } catch (error) {
        logError('Error saving resumed workout session', error)
      }
      
      // Timer will automatically restart via the interval that checks !isPaused
    }
  }

  // Exercise stacking (superset/circuit) functionality
  const toggleExerciseStack = (exerciseId) => {
    setExercises(prev => {
      const exercise = prev.find(ex => ex.id === exerciseId)
      if (!exercise) return prev
      
      // If already stacked, remove from stack
      if (exercise.stacked) {
        const updated = prev.map(ex => {
          if (ex.id === exerciseId) {
            return { ...ex, stacked: false, stackGroup: null }
          }
          return ex
        })
        showToast('Removed from stack', 'success')
        return updated
      }
      
      // Create new stack
      const newStackGroup = Date.now()
      const updated = prev.map(ex => {
        if (ex.id === exerciseId) {
          return { ...ex, stacked: true, stackGroup: newStackGroup }
        }
        return ex
      })
      showToast('Exercise added to stack. Stack another exercise to create a superset/circuit.', 'success')
      return updated
    })
  }

  const addToStack = (exerciseId, targetStackGroup) => {
    setExercises(prev => {
      const stackSize = prev.filter(ex => ex.stacked && ex.stackGroup === targetStackGroup).length + 1
      const label = stackSize === 2 ? 'Superset' : 'Circuit'
      showToast(`Added to ${label.toLowerCase()}`, 'success')
      return prev.map(ex => {
        if (ex.id === exerciseId) {
          return { ...ex, stacked: true, stackGroup: targetStackGroup }
        }
        return ex
      })
    })
  }

  const removeFromStack = (exerciseId) => {
    setExercises(prev => prev.map(ex => {
      if (ex.id === exerciseId) {
        return { ...ex, stacked: false, stackGroup: null }
      }
      return ex
    }))
    showToast('Removed from stack', 'success')
  }

  const unstackGroup = (groupId) => {
    if (!groupId) return
    setExercises(prev => prev.map(ex => {
      if (ex.stacked && ex.stackGroup === groupId) {
        return { ...ex, stacked: false, stackGroup: null }
      }
      return ex
    }))
    showToast('Unstacked', 'success')
  }

  const handleStackNext = ({ exerciseId, stackGroup, isLastSet }) => {
    if (!exerciseId || !stackGroup) return
    setExercises(prev => {
      const list = Array.isArray(prev) ? prev : []
      const currentIdx = list.findIndex(ex => ex?.id === exerciseId)
      if (currentIdx === -1) return prev

      const groupMembers = list.filter(ex => ex?.stacked && ex?.stackGroup === stackGroup)
      if (groupMembers.length <= 1) return prev

      // Optionally mark the current exercise completed if it finished its last set.
      const nextList = list.map(ex => {
        if (ex?.id !== exerciseId) return ex
        if (!isLastSet) return ex
        return { ...ex, completed: true, expanded: false }
      })

      // Determine next exercise in the stack: cycle through members, skipping completed ones.
      const orderedMembers = list.filter(ex => ex?.stacked && ex?.stackGroup === stackGroup)
      const currentInGroupIndex = orderedMembers.findIndex(ex => ex?.id === exerciseId)
      const candidates = orderedMembers.filter(ex => !ex?.completed)

      // If everything in the group is completed, move focus to the next non-stack exercise after the group.
      if (candidates.length === 0) {
        // Find the last index of this group in the main list.
        const indices = list
          .map((ex, idx) => ({ ex, idx }))
          .filter(({ ex }) => ex?.stacked && ex?.stackGroup === stackGroup)
          .map(({ idx }) => idx)
        const lastIdx = indices.length ? Math.max(...indices) : currentIdx

        // Expand the next non-stacked exercise if it exists.
        return nextList.map((ex, idx) => ({
          ...ex,
          expanded: idx === lastIdx + 1 ? true : false
        }))
      }

      // Find next in the ordered cycle.
      const nextExpandedId = (() => {
        for (let step = 1; step <= orderedMembers.length; step++) {
          const candidate = orderedMembers[(currentInGroupIndex + step) % orderedMembers.length]
          if (candidate && !candidate.completed) return candidate.id
        }
        return orderedMembers[(currentInGroupIndex + 1) % orderedMembers.length]?.id
      })()

      return nextList.map((ex) => ({
        ...ex,
        expanded: ex?.id === nextExpandedId
      }))
    })
  }

  const renderItems = (() => {
    const items = []
    const firstIndexByGroup = new Map()
    const membersByGroup = new Map()

    exercises.forEach((ex, idx) => {
      if (ex?.stacked && ex?.stackGroup) {
        if (!firstIndexByGroup.has(ex.stackGroup)) firstIndexByGroup.set(ex.stackGroup, idx)
        const arr = membersByGroup.get(ex.stackGroup) || []
        arr.push(ex)
        membersByGroup.set(ex.stackGroup, arr)
      }
    })

    const renderedGroups = new Set()

    exercises.forEach((ex, idx) => {
      const gid = ex?.stacked && ex?.stackGroup ? ex.stackGroup : null
      if (gid && membersByGroup.get(gid)?.length > 1) {
        if (renderedGroups.has(gid)) return
        if (firstIndexByGroup.get(gid) !== idx) return
        renderedGroups.add(gid)
        items.push({ kind: 'stack', groupId: gid, members: membersByGroup.get(gid) || [] })
        return
      }
      items.push({ kind: 'single', exercise: ex })
    })

    return items
  })()

  const exerciseFilterKey = normalizeNameKey(exerciseFilter)
  const filteredRenderItems = exerciseFilterKey
    ? renderItems
        .map((item) => {
          if (item?.kind === 'stack') {
            const members = (Array.isArray(item.members) ? item.members : []).filter((m) =>
              normalizeNameKey(m?.name).includes(exerciseFilterKey)
            )
            if (members.length === 0) return null
            return { ...item, members }
          }
          if (item?.kind === 'single') {
            const ex = item.exercise
            if (!ex) return null
            return normalizeNameKey(ex?.name).includes(exerciseFilterKey) ? item : null
          }
          return null
        })
        .filter(Boolean)
    : renderItems

  return (
    <SafeAreaScaffold>
      <div className={styles.container}>
      {showTimesUp && (
        <div className={styles.timesUpOverlay}>
          <span className={styles.timesUpText}>Times up, back to work</span>
        </div>
      )}
      <header className={styles.header}>
        <div className={styles.headerTop}>
          {exercises.length > 0 && (
            <button 
              className={styles.clearBtn}
              onClick={async () => {
                const ok = await confirmAsync({
                  title: 'Clear workout?',
                  message: 'Clear all exercises and start fresh? This will delete your current workout progress.',
                  confirmText: 'Clear',
                  cancelText: 'Cancel',
                  isDestructive: true
                })
                if (ok) {
                  setExercises([])
                  workoutStartTimeRef.current = Date.now()
                  setWorkoutTime(0)
                  setPausedTime(0)
                  pausedTimeRef.current = 0
                  setIsResting(false)
                  setRestTime(0)
                  workoutStartMetricsRef.current = null
                  pausedMetricsRef.current = []
                  
                  // Clear from database and localStorage
                  if (userId) {
                    try {
                      await deleteActiveWorkoutSession(userId)
                      localStorage.removeItem(`activeWorkout_${userId}`)
                      localStorage.removeItem(`workoutStartMetrics_${userId}`)
                      showToast('Workout cleared. Starting fresh.', 'info')
                    } catch (error) {
                      // Silently fail
                    }
                  }
                }
              }}
              title="Clear workout and start fresh"
            >
              Clear
            </button>
          )}
          <button className={styles.cancelBtn} onClick={async () => {
            // Warn user before canceling if there's progress
            const hasProgress = exercises.some(ex => 
              ex.sets && ex.sets.some(s => 
                (s.weight && s.weight !== '') || 
                (s.reps && s.reps !== '') || 
                (s.time && s.time !== '')
              )
            )
            
            if (hasProgress) {
              const confirmCancel = await confirmAsync({
                title: 'Cancel session?',
                message: 'This will delete this workout session and you will NOT be able to resume it. Continue?',
                confirmText: 'Delete session',
                cancelText: 'Keep going',
                isDestructive: true
              })
              if (!confirmCancel) return
            }
            
            // Cancel means DELETE: clear persisted progress (Supabase + localStorage) so it won't show up anywhere.
            if (userId) {
              try {
                await deleteActiveWorkoutSession(userId)
              } catch (error) {
                // Only log unexpected errors
                const isExpectedError = error.code === 'PGRST205' || 
                                        error.code === '42P01' ||
                                        error.message?.includes('Could not find the table')
                
                if (!isExpectedError) {
                  logError('Error deleting active workout session on cancel', error)
                }
              }
              try {
                localStorage.removeItem(`activeWorkout_${userId}`)
                localStorage.removeItem(`workoutStartMetrics_${userId}`)
                localStorage.removeItem(`pausedWorkout_${userId}`)
                localStorage.removeItem('pausedWorkout')
              } catch {
                // ignore
              }
            }
            navigate('/')
          }}>
            Cancel
          </button>
          <div className={styles.workoutTimer}>{formatTime(workoutTime)}</div>
          <div className={styles.headerRight}>
            <button
              type="button"
              className={styles.kebabBtn}
              onClick={() => setShowControlsSheet(true)}
              aria-label="Workout controls and preferences"
              title="Controls"
            >
              ⋯
            </button>
            <Button
              unstyled
              className={`${styles.pauseBtn} ${isPaused ? styles.paused : ''}`}
              onClick={() => {
                if (isPaused) {
                  if (resumeWorkout && typeof resumeWorkout === 'function') {
                    resumeWorkout()
                  }
                } else {
                  if (pauseWorkout && typeof pauseWorkout === 'function') {
                    pauseWorkout()
                  }
                }
              }}
              title={isPaused ? 'Resume Workout' : 'Pause Workout'}
              aria-pressed={isPaused ? 'true' : 'false'}
            >
              {isPaused ? '▶ Resume' : '⏸ Pause'}
            </Button>
            {isPaused && (
              <Button
                unstyled
                className={styles.cancelBtn}
                onClick={() => {
                  if (pauseAndExit && typeof pauseAndExit === 'function') {
                    pauseAndExit()
                  }
                }}
                title="Pause and leave (resume later)"
              >
                Exit
              </Button>
            )}
            <Button
              unstyled
              className={styles.finishBtn}
              onClick={() => {
                if (handleFinishClick && typeof handleFinishClick === 'function') {
                  handleFinishClick()
                }
              }}
            >
              Finish
            </Button>
          </div>
        </div>

        <div className={styles.sessionTypeRow}>
          <div className={styles.sessionTypeLabel}>
            {sessionType === 'recovery' ? 'Recovery Session' : 'Workout'}
            {sessionTypeMode === 'auto' && (
              <span className={styles.sessionTypeAuto}>Auto</span>
            )}
          </div>
          <div className={styles.sessionTypeToggle}>
            <button
              type="button"
              className={`${styles.sessionTypeBtn} ${sessionType === 'workout' ? styles.sessionTypeActive : ''}`}
              onClick={() => {
                setSessionType('workout')
                setSessionTypeMode('manual')
              }}
            >
              Workout
            </button>
            <button
              type="button"
              className={`${styles.sessionTypeBtn} ${sessionType === 'recovery' ? styles.sessionTypeActive : ''}`}
              onClick={() => {
                setSessionType('recovery')
                setSessionTypeMode('manual')
              }}
            >
              Recovery
            </button>
          </div>
        </div>
        
        {adjustmentInfo && adjustmentInfo.factor < 1.0 && (
          <div className={`${styles.adjustmentBanner} ${styles[`adjustment${adjustmentInfo.zone}`]}`}>
            <span>Auto-Adjusted: {adjustmentInfo.message}</span>
          </div>
        )}
        
        {isResting && (
          <div className={styles.restBar}>
            <span>Rest: {formatTime(restTime)}</span>
            <button 
              onClick={() => {
                if (skipRest && typeof skipRest === 'function') {
                  skipRest()
                }
              }}
            >
              Skip
            </button>
          </div>
        )}
      </header>

      <div className={styles.content}>
        {exercises.length >= 2 && (
          <div className={styles.findRow}>
            <SearchField
              value={exerciseFilter}
              onChange={(e) => setExerciseFilter(e.target.value)}
              onClear={() => setExerciseFilter('')}
              placeholder="Find exercise in this workout…"
            />
          </div>
        )}
        {/* Stacking Helper Info */}
        {exercises.length >= 2 && exercises.some(ex => !ex.stacked) && (
          <div className={styles.stackHelper}>
            <span className={styles.stackHelperIcon}>💡</span>
            <span className={styles.stackHelperText}>
              Tip: Click "Stack" on exercises to create supersets (2 exercises) or circuits (3+ exercises)
            </span>
          </div>
        )}
        
        {filteredRenderItems.map((item) => {
          if (item.kind === 'stack') {
            const members = Array.isArray(item.members) ? item.members : []
            const label = members.length === 2 ? 'Superset' : 'Circuit'
            return (
              <div key={`stack-${item.groupId}`} className={styles.stackGroupBox}>
                <div className={styles.stackGroupHeader}>
                  <div className={styles.stackGroupTitle}>
                    {label}: {members.map(m => m.name).join(' / ')}
                  </div>
                  <Button
                    unstyled
                    className={styles.stackGroupAction}
                    onClick={() => unstackGroup(item.groupId)}
                    title="Unstack this group"
                  >
                    Unstack
                  </Button>
                </div>
                <div className={styles.stackGroupInner}>
                  {members.map((exercise) => {
                    const stackGroup = exercise.stacked ? exercise.stackGroup : null
                    const stackMembers = stackGroup ? members : []
                    const stackIndex = stackMembers.findIndex(ex => ex.id === exercise.id)
                    return (
                      <ExerciseCard
                        key={exercise.id}
                        exercise={exercise}
                        lastInfo={lastByExerciseName?.[normalizeNameKey(exercise?.name)] || null}
                        adjustmentFactor={adjustmentInfo?.factor || 1}
                        index={0}
                        total={0}
                        stacked={exercise.stacked}
                        stackGroup={stackGroup}
                        stackMembers={stackMembers}
                        stackIndex={stackIndex}
                        existingStacks={[]}
                        onToggle={() => toggleExpanded(exercise.id)}
                        onUpdateSet={(setIdx, field, value) => updateSet(exercise.id, setIdx, field, value)}
                        onAddSet={() => addSet(exercise.id)}
                        onRemoveSet={() => removeSet(exercise.id)}
                        onRemove={() => removeExercise(exercise.id)}
                        onMove={(dir) => moveExercise(exercise.id, dir)}
                        onStartRest={startRest}
                        onComplete={() => completeExercise(exercise.id)}
                        onStackNext={handleStackNext}
                        onToggleStack={() => toggleExerciseStack(exercise.id)}
                        onAddToStack={() => {}}
                        onRemoveFromStack={() => removeFromStack(exercise.id)}
                        isDragging={false}
                        draggable={false}
                        showDragHandle={false}
                        containerClassName={styles.stackMemberCard}
                      />
                    )
                  })}
                </div>
              </div>
            )
          }

          const exercise = item.exercise
          if (!exercise) return null

          // Find other exercises in the same stack group
          const stackGroup = exercise.stacked ? exercise.stackGroup : null
          const stackMembers = stackGroup ? exercises.filter(ex => ex.stacked && ex.stackGroup === stackGroup) : []
          const stackIndex = stackMembers.findIndex(ex => ex.id === exercise.id)
          
          // Find existing stacks that this exercise could join (always define as array)
          const existingStacks = exercises
            .filter(ex => ex.stacked && ex.stackGroup && ex.id !== exercise.id)
            .map(ex => ({
              group: ex.stackGroup,
              members: exercises.filter(e => e.stacked && e.stackGroup === ex.stackGroup),
              names: exercises.filter(e => e.stacked && e.stackGroup === ex.stackGroup).map(e => e.name)
            }))
            .filter((stack, index, self) => 
              index === self.findIndex(s => s.group === stack.group)
            ) || [] // Ensure it's always an array

          return (
            <ExerciseCard
              key={exercise.id}
              exercise={exercise}
              lastInfo={lastByExerciseName?.[normalizeNameKey(exercise?.name)] || null}
              adjustmentFactor={adjustmentInfo?.factor || 1}
              index={exercises.findIndex(e => e.id === exercise.id)}
              total={exercises.length}
              stacked={exercise.stacked}
              stackGroup={stackGroup}
              stackMembers={stackMembers}
              stackIndex={stackIndex}
              existingStacks={existingStacks || []}
              onToggle={() => toggleExpanded(exercise.id)}
              onUpdateSet={(setIdx, field, value) => updateSet(exercise.id, setIdx, field, value)}
              onAddSet={() => addSet(exercise.id)}
              onRemoveSet={() => removeSet(exercise.id)}
              onRemove={() => removeExercise(exercise.id)}
              onMove={(dir) => moveExercise(exercise.id, dir)}
              onStartRest={startRest}
              onComplete={() => completeExercise(exercise.id)}
              onStackNext={handleStackNext}
              onToggleStack={() => toggleExerciseStack(exercise.id)}
              onAddToStack={(targetGroup) => addToStack(exercise.id, targetGroup)}
              onRemoveFromStack={() => removeFromStack(exercise.id)}
              isDragging={draggedId === exercise.id}
              onDragStart={(e) => handleDragStart(e, exercise.id)}
              onDragOver={(e) => handleDragOver(e, exercise.id)}
              onDragEnter={handleDragEnter}
              onDragEnd={handleDragEnd}
              onDrop={(e) => handleDrop(e, exercise.id)}
            />
          )
        })}

        {exercises.length === 0 && sessionType === 'recovery' && (
          <div className={styles.quickAddRow}>
            <button className={styles.quickAddChip} onClick={() => quickAddRecovery('Sauna')}>Sauna</button>
            <button className={styles.quickAddChip} onClick={() => quickAddRecovery('Cold Plunge')}>Cold Plunge</button>
            <button className={styles.quickAddChip} onClick={() => quickAddRecovery('Breathwork')}>Breathwork</button>
            <button className={styles.quickAddChip} onClick={() => quickAddRecovery('Stretching (Full Body)')}>Stretch</button>
          </div>
        )}

        <button className={styles.addExerciseBtn} onClick={() => setShowPicker(true)}>
          {sessionType === 'recovery' ? '+ Add Recovery' : '+ Add Exercise'}
        </button>
      </div>

      {/* Bottom sticky one-hand bar */}
      <div className={styles.bottomBar} role="region" aria-label="Workout controls">
        <div className={styles.bottomBarLeft}>
          <div className={`${styles.syncPill} ${syncPill.tone === 'good' ? styles.syncGood : syncPill.tone === 'warn' ? styles.syncWarn : ''}`}>
            {syncPill.label}
          </div>
        </div>
        <div className={styles.bottomBarMain}>
          {!isResting ? (
            <div className={styles.restPresets} aria-label="Rest presets">
              <button type="button" className={styles.restChip} onClick={() => startRest(60)} aria-label="Start 60 second rest">60s</button>
              <button type="button" className={styles.restChip} onClick={() => startRest(90)} aria-label="Start 90 second rest">90s</button>
              <button type="button" className={styles.restChip} onClick={() => startRest(120)} aria-label="Start 120 second rest">120s</button>
            </div>
          ) : (
            <button type="button" className={styles.restChipActive} onClick={skipRest} aria-label="Skip rest">
              Rest {formatTime(restTime)} · Skip
            </button>
          )}
        </div>
        <div className={styles.bottomBarRight}>
          <button type="button" className={styles.bottomBtn} onClick={() => setShowPicker(true)} aria-label="Add exercise">+ Add</button>
          <button type="button" className={styles.bottomBtnPrimary} onClick={() => handleFinishClick()} aria-label="Finish workout">Finish</button>
        </div>
      </div>

      {showPicker && (
        <ExercisePicker
          exercises={allExercises}
          onSelect={addExercise}
          onClose={() => setShowPicker(false)}
        />
      )}

      {showSummary && (
        <div className={styles.summaryOverlay}>
          <div className={styles.summaryModal}>
            <h2>Workout Complete!</h2>
            <p className={styles.summaryDuration}>{formatTime(workoutTime)}</p>
            
            {/* Display calculated workout metrics if available */}
            {(calculatedWorkoutMetrics.calories != null || calculatedWorkoutMetrics.steps != null) && (
              <div className={styles.summaryMetrics}>
                {calculatedWorkoutMetrics.calories != null && (
                  <div className={styles.summaryMetric}>
                    <span className={styles.summaryMetricLabel}>Calories Burned:</span>
                    <span className={styles.summaryMetricValue}>{Math.round(calculatedWorkoutMetrics.calories)}</span>
                  </div>
                )}
                {calculatedWorkoutMetrics.steps != null && (
                  <div className={styles.summaryMetric}>
                    <span className={styles.summaryMetricLabel}>Steps:</span>
                    <span className={styles.summaryMetricValue}>{calculatedWorkoutMetrics.steps.toLocaleString()}</span>
                  </div>
                )}
              </div>
            )}
            
            <div className={styles.feedbackSection}>
              <label>How hard was it? (RPE)</label>
              <div className={styles.rpeSlider}>
                {[1,2,3,4,5,6,7,8,9,10].map(n => (
                  <button
                    key={n}
                    className={`${styles.rpeBtn} ${feedback.rpe === n ? styles.rpeActive : ''}`}
                    onClick={() => setFeedback(f => ({ ...f, rpe: n }))}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div className={styles.rpeLabels}>
                <span>Easy</span>
                <span>Max Effort</span>
              </div>
            </div>

            <div className={styles.feedbackSection}>
              <label>How do you feel now?</label>
              <div className={styles.moodButtons}>
                {[1, 2, 3, 4, 5].map((num) => (
                  <button
                    key={num}
                    className={`${styles.moodBtn} ${feedback.moodAfter === num ? styles.moodActive : ''}`}
                    onClick={() => setFeedback(f => ({ ...f, moodAfter: num }))}
                  >
                    {num}
                  </button>
                ))}
              </div>
              <div className={styles.rpeLabels}>
                <span>Exhausted</span>
                <span>Energized</span>
              </div>
            </div>

            <div className={styles.feedbackSection}>
              <TextAreaField
                label="Notes (optional)"
                className={styles.notesInput}
                placeholder="How did it go? Any PRs?"
                value={feedback.notes}
                onChange={(e) => setFeedback(f => ({ ...f, notes: e.target.value }))}
                rows={3}
              />
            </div>

            <div className={styles.finishActions}>
              <Button unstyled className={styles.saveBtn} onClick={() => finishWorkout({ openShare: false })}>
                Save
              </Button>
              <Button unstyled className={styles.saveBtn} onClick={() => finishWorkout({ openShare: true })}>
                Save & Share
              </Button>
              <Button unstyled className={styles.saveBtnSecondary} onClick={() => finishWorkout({ openShare: false, navigateTo: '/calendar' })}>
                Save & Plan Next
              </Button>
            </div>
          </div>
        </div>
      )}

      {showControlsSheet && (
        <Sheet
          isOpen={showControlsSheet}
          onClose={() => setShowControlsSheet(false)}
          ariaLabel="Workout controls"
          contentClassName={styles.controlsSheet}
        >
          <div className={styles.controlsHeader}>
            <div className={styles.controlsTitle}>Controls</div>
            <button type="button" className={styles.controlsClose} onClick={() => setShowControlsSheet(false)} aria-label="Close controls">Close</button>
          </div>
          <div className={styles.controlsRow}>
            <span className={styles.controlsLabel}>Auto-advance (weight → reps)</span>
            <button
              type="button"
              className={`${styles.toggleBtn} ${prefAutoAdvance ? styles.toggleOn : ''}`}
              onClick={() => setPrefAutoAdvance(v => !v)}
              aria-pressed={prefAutoAdvance ? 'true' : 'false'}
            >
              {prefAutoAdvance ? 'On' : 'Off'}
            </button>
          </div>
          <div className={styles.controlsRow}>
            <span className={styles.controlsLabel}>Auto-next when filled</span>
            <button
              type="button"
              className={`${styles.toggleBtn} ${prefAutoNext ? styles.toggleOn : ''}`}
              onClick={() => setPrefAutoNext(v => !v)}
              aria-pressed={prefAutoNext ? 'true' : 'false'}
            >
              {prefAutoNext ? 'On' : 'Off'}
            </button>
          </div>
          <div className={styles.controlsHint}>
            These apply to set entry on this device.
          </div>
        </Sheet>
      )}

      {/* Share Modal */}
      {showShareModal && savedWorkout && (
        <ShareModal
          type="workout"
      data={{
        workout: {
          date: savedWorkout.date,
          duration: savedWorkout.duration || 0,
          exercises: savedWorkout.exercises || [],
          templateName: savedWorkout.templateName || 'Freestyle Workout',
          perceivedEffort: savedWorkout.perceivedEffort,
          moodAfter: savedWorkout.moodAfter,
          notes: savedWorkout.notes,
          workoutCaloriesBurned: savedWorkout.workoutCaloriesBurned,
          workoutSteps: savedWorkout.workoutSteps
        }
      }}
          onClose={handleShareClose}
        />
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
        isOpen={confirmDialog.open}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmText={confirmDialog.confirmText}
        cancelText={confirmDialog.cancelText}
        isDestructive={confirmDialog.isDestructive}
        onClose={() => resolveConfirm(false)}
        onConfirm={() => resolveConfirm(true)}
      />
      </div>
    </SafeAreaScaffold>
  )
}

