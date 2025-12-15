import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { getTemplate, getAllExercises, saveWorkout } from '../db'
import { 
  saveWorkoutToSupabase, 
  savePausedWorkoutToSupabase, 
  getPausedWorkoutFromSupabase, 
  deletePausedWorkoutFromSupabase,
  saveActiveWorkoutSession,
  getActiveWorkoutSession,
  deleteActiveWorkoutSession
} from '../lib/supabaseDb'
import { getTodayEST } from '../utils/dateUtils'
import { useAuth } from '../context/AuthContext'
import { logError } from '../utils/logger'
import { getAutoAdjustmentFactor, applyAutoAdjustment, getWorkoutRecommendation } from '../lib/autoAdjust'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'
import ExerciseCard from '../components/ExerciseCard'
import ExercisePicker from '../components/ExercisePicker'
import ShareModal from '../components/ShareModal'
import { shareWorkoutToFeed } from '../utils/shareUtils'
import { getFitbitDaily, getMostRecentFitbitData } from '../lib/wearables'
import styles from './ActiveWorkout.module.css'

export default function ActiveWorkout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const { toast, showToast, hideToast } = useToast()
  const templateId = location.state?.templateId
  const randomWorkout = location.state?.randomWorkout
  const aiWorkout = location.state?.aiWorkout
  
  const [exercises, setExercises] = useState([])
  const [allExercises, setAllExercises] = useState([])
  const [showPicker, setShowPicker] = useState(false)
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
  const [isPaused, setIsPaused] = useState(false)
  const [pausedTime, setPausedTime] = useState(0) // Accumulated paused time
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
  const workoutStartMetricsRef = useRef(null) // Track wearable metrics at workout start (calories, steps)
  const pausedMetricsRef = useRef([]) // Track metrics during paused periods: [{pauseTime, resumeTime, metricsAtPause, metricsAtResume}]

  // Auto-save exercises periodically during workout
  useEffect(() => {
    if (!user || exercises.length === 0) return

    // Auto-save every 30 seconds
    autoSaveIntervalRef.current = setInterval(async () => {
      if (workoutStartTimeRef.current && exercises.length > 0) {
        try {
          // Only save if exercises have changed
          const exercisesStr = JSON.stringify(exercises)
          if (exercisesStr !== lastSavedExercisesRef.current) {
            // Save to active workout session
            const result = await saveActiveWorkoutSession(user.id, {
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
            localStorage.setItem(`activeWorkout_${user.id}`, JSON.stringify({
              exercises,
              workoutTime,
              restTime,
              isResting,
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
            localStorage.setItem(`activeWorkout_${user.id}`, JSON.stringify({
              exercises,
              workoutTime,
              restTime,
              isResting,
              templateId,
              date: getTodayEST(),
              timestamp: Date.now()
            }))
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
  }, [user, exercises, workoutTime, restTime, isResting, templateId])

  // Save exercises immediately when they change (debounced)
  useEffect(() => {
    if (!user || exercises.length === 0 || !workoutStartTimeRef.current) return

    const saveTimeout = setTimeout(async () => {
      try {
        const result = await saveActiveWorkoutSession(user.id, {
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
        localStorage.setItem(`activeWorkout_${user.id}`, JSON.stringify({
          exercises,
          workoutTime,
          restTime,
          isResting,
          templateId,
          date: getTodayEST(),
          timestamp: Date.now()
        }))
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
          localStorage.setItem(`activeWorkout_${user.id}`, JSON.stringify({
            exercises,
            workoutTime,
            restTime,
            isResting,
            templateId,
            date: getTodayEST(),
            timestamp: Date.now()
          }))
        } catch (e) {
          // localStorage might be full or unavailable
          if (!isExpectedError) {
            logError('Error saving to localStorage', e)
          }
        }
      }
    }, 2000) // Debounce: save 2 seconds after last change

    return () => clearTimeout(saveTimeout)
  }, [exercises, user])

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
        if (user) {
          try {
            const paused = await getPausedWorkoutFromSupabase(user.id)
            if (!mounted) return
            if (paused) {
              // If user clicked "Resume" from Fitness page, automatically resume
              const shouldResume = location.state?.resumePaused || window.confirm('You have a paused workout. Would you like to resume it?')
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
                if (user) {
                  try {
                    await saveActiveWorkoutSession(user.id, {
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
                await deletePausedWorkoutFromSupabase(user.id)
                hasResumedPaused = true
              } else {
                // User chose not to resume, delete paused workout
                await deletePausedWorkoutFromSupabase(user.id)
              }
            }
          } catch (error) {
            // Silently ignore PGRST205 errors (table doesn't exist - migration not run)
            if (error.code !== 'PGRST205' && !error.message?.includes('Could not find the table')) {
              logError('Error loading paused workout', error)
            }
          }
        }

        // Only load template/random/AI workout if we didn't resume a paused workout
        if (!hasResumedPaused && mounted) {
          if (templateId) {
            const template = await getTemplate(templateId)
            if (!mounted) return
            if (template && Array.isArray(template.exercises)) {
              const workoutExercises = template.exercises.map((name, idx) => {
            const exerciseData = allEx.find(e => e.name === name)
            if (!exerciseData) {
              // Exercise not found, will use default structure
            }
            const isCardio = exerciseData?.category === 'Cardio'
            const isRecovery = exerciseData?.category === 'Recovery'
            const defaultSets = (isCardio || isRecovery) ? 1 : 4
            return {
              id: idx,
              name,
              category: exerciseData?.category || 'Strength',
              bodyPart: exerciseData?.bodyPart || 'Other',
              equipment: exerciseData?.equipment || '',
              sets: Array(defaultSets).fill(null).map(() => ({ weight: '', reps: '', time: '', speed: '', incline: '' })),
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
      if (!user) return
      
      let restoredExercises = false
      
      try {
        const session = await getActiveWorkoutSession(user.id)
        
        if (session) {
          // Check if session is recent (within last 2 hours) - if older, ask user
          const sessionAge = Date.now() - new Date(session.workout_start_time).getTime()
          const isRecent = sessionAge < 7200000 // 2 hours
          
          // If session has exercises and is not recent, ask user if they want to resume
          if (session.exercises && Array.isArray(session.exercises) && session.exercises.length > 0 && !isRecent) {
            const shouldResume = window.confirm(
              `You have an old workout in progress from ${new Date(session.workout_start_time).toLocaleString()}.\n\n` +
              `Would you like to resume it, or start a fresh workout?\n\n` +
              `Click OK to resume, or Cancel to start fresh.`
            )
            
            if (!shouldResume) {
              // User wants to start fresh - delete the old session
              try {
                await deleteActiveWorkoutSession(user.id)
                localStorage.removeItem(`activeWorkout_${user.id}`)
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
              setExercises(session.exercises)
              lastSavedExercisesRef.current = JSON.stringify(session.exercises)
              restoredExercises = true
            }
          } else if (session.exercises && Array.isArray(session.exercises) && session.exercises.length > 0 && isRecent) {
            // Recent session - restore automatically
            workoutStartTimeRef.current = new Date(session.workout_start_time).getTime()
            const pausedMs = session.paused_time_ms || 0
            setPausedTime(pausedMs)
            pausedTimeRef.current = pausedMs
            setExercises(session.exercises)
            lastSavedExercisesRef.current = JSON.stringify(session.exercises)
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
                    saveActiveWorkoutSession(user.id, {
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
              saveActiveWorkoutSession(user.id, {
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
            const saved = localStorage.getItem(`activeWorkout_${user.id}`)
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
                    const shouldResume = window.confirm(
                      `You have an old workout saved from ${workoutDate}.\n\n` +
                      `Would you like to resume it, or start a fresh workout?\n\n` +
                      `Click OK to resume, or Cancel to start fresh and delete the old workout.`
                    )
                    
                    if (!shouldResume) {
                      // User wants to start fresh - delete the old workout
                      localStorage.removeItem(`activeWorkout_${user.id}`)
                      try {
                        await deleteActiveWorkoutSession(user.id)
                      } catch (error) {
                        // Silently fail
                      }
                      // Continue to initialize new workout below
                    } else {
                    // User wants to resume - restore the workout
                    setExercises(workoutData.exercises)
                    lastSavedExercisesRef.current = JSON.stringify(workoutData.exercises)
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
                      const savedMetrics = localStorage.getItem(`workoutStartMetrics_${user.id}`)
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
                    }
                  } else {
                    // Recent workout - restore automatically
                    setExercises(workoutData.exercises)
                    lastSavedExercisesRef.current = JSON.stringify(workoutData.exercises)
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
                      const savedMetrics = localStorage.getItem(`workoutStartMetrics_${user.id}`)
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
            localStorage.setItem(`workoutStartMetrics_${user.id}`, JSON.stringify(startMetrics))
          } catch (e) {
            // Silently fail
          }
          
          // Save to database
          try {
            await saveActiveWorkoutSession(user.id, {
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
          const saved = localStorage.getItem(`activeWorkout_${user.id}`)
          if (saved) {
            const workoutData = JSON.parse(saved)
            const workoutAge = workoutData.timestamp ? (Date.now() - workoutData.timestamp) : Infinity
            const isRecent = workoutAge < 7200000 // 2 hours
            
            if (workoutData.timestamp && workoutAge < 86400000) {
              if (workoutData.exercises && Array.isArray(workoutData.exercises) && workoutData.exercises.length > 0) {
                // If not recent, ask user if they want to resume
                if (!isRecent) {
                  const workoutDate = new Date(workoutData.timestamp).toLocaleString()
                  const shouldResume = window.confirm(
                    `You have an old workout saved from ${workoutDate}.\n\n` +
                    `Would you like to resume it, or start a fresh workout?\n\n` +
                    `Click OK to resume, or Cancel to start fresh and delete the old workout.`
                  )
                  
                  if (!shouldResume) {
                    // User wants to start fresh - delete the old workout
                    localStorage.removeItem(`activeWorkout_${user.id}`)
                    try {
                      await deleteActiveWorkoutSession(user.id)
                    } catch (error) {
                      // Silently fail
                    }
                    // Continue to initialize new timer below
                  } else {
                    // User wants to resume
                    setExercises(workoutData.exercises)
                    lastSavedExercisesRef.current = JSON.stringify(workoutData.exercises)
                    
                    // Restore start metrics from localStorage if available
                    try {
                      const savedMetrics = localStorage.getItem(`workoutStartMetrics_${user.id}`)
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
                } else {
                  // Recent workout - restore automatically
                  setExercises(workoutData.exercises)
                  lastSavedExercisesRef.current = JSON.stringify(workoutData.exercises)
                  
                  // Restore start metrics from localStorage if available
                  try {
                    const savedMetrics = localStorage.getItem(`workoutStartMetrics_${user.id}`)
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
          localStorage.setItem(`workoutStartMetrics_${user.id}`, JSON.stringify(startMetrics))
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
      if (!user) return
      
      if (document.hidden) {
        // App is being backgrounded - SAVE exercises immediately
        if (exercises.length > 0 && workoutStartTimeRef.current) {
          try {
            // Save to database
            await saveActiveWorkoutSession(user.id, {
              workoutStartTime: new Date(workoutStartTimeRef.current).toISOString(),
              pausedTimeMs: pausedTimeRef.current || 0,
              restStartTime: restStartTimeRef.current ? new Date(restStartTimeRef.current).toISOString() : null,
              restDurationSeconds: restDurationRef.current || null,
              isResting: isResting,
              exercises: exercises
            })
            
            // Also save to localStorage as backup
            localStorage.setItem(`activeWorkout_${user.id}`, JSON.stringify({
              exercises,
              workoutTime,
              restTime,
              isResting,
              templateId,
              date: getTodayEST(),
              timestamp: Date.now()
            }))
          } catch (error) {
            // Silently fail - at least try localStorage
            try {
              localStorage.setItem(`activeWorkout_${user.id}`, JSON.stringify({
                exercises,
                workoutTime,
                restTime,
                isResting,
                templateId,
                date: getTodayEST(),
                timestamp: Date.now()
              }))
            } catch (e) {
              logError('Error saving to localStorage on background', e)
            }
          }
        }
      } else {
        // App is coming to foreground - restore and recalculate
        try {
          const session = await getActiveWorkoutSession(user.id)
          if (session) {
            workoutStartTimeRef.current = new Date(session.workout_start_time).getTime()
            const pausedMs = session.paused_time_ms || 0
            setPausedTime(pausedMs)
            pausedTimeRef.current = pausedMs
            
            // Restore exercises if they exist
            if (session.exercises && Array.isArray(session.exercises) && session.exercises.length > 0) {
              setExercises(session.exercises)
              lastSavedExercisesRef.current = JSON.stringify(session.exercises)
            }
            
            // Restore start metrics from localStorage if available
            try {
              const savedMetrics = localStorage.getItem(`workoutStartMetrics_${user.id}`)
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
              if (remaining <= 0 && isResting) {
                clearInterval(restTimerRef.current)
                setIsResting(false)
                setShowTimesUp(true)
                const timeoutId = setTimeout(() => setShowTimesUp(false), 2000)
                timeoutRefs.current.push(timeoutId)
                // Clear rest timer from database
                await saveActiveWorkoutSession(user.id, {
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
      if (workoutStartTimeRef.current && user) {
        try {
          const session = await getActiveWorkoutSession(user.id)
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
  }, [templateId, randomWorkout, user])
  
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
    if (!user) return
    
    restDurationRef.current = duration
    restStartTimeRef.current = Date.now()
    setRestTime(duration)
    setIsResting(true)
    
    // Save to database
    try {
      await saveActiveWorkoutSession(user.id, {
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
          if (user) {
            saveActiveWorkoutSession(user.id, {
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
    if (!user) return
    
    clearInterval(restTimerRef.current)
    setIsResting(false)
    setRestTime(0)
    
    // Clear rest timer from database
    try {
      await saveActiveWorkoutSession(user.id, {
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
      const lastSet = ex.sets[ex.sets.length - 1] || { weight: '', reps: '' }
      return { 
        ...ex, 
        sets: [...ex.sets, { weight: lastSet.weight, reps: lastSet.reps, duration: 0 }]
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
      sets: Array(defaultSets).fill(null).map(() => ({ weight: '', reps: '', time: '', speed: '', incline: '' })),
      expanded: true
    }
    setExercises(prev => [...prev.map(e => ({ ...e, expanded: false })), newExercise])
    setShowPicker(false)
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
  const finishWorkout = async () => {
    // Clean up timers and auto-save
    clearInterval(workoutTimerRef.current)
    clearInterval(restTimerRef.current)
    if (autoSaveIntervalRef.current) {
      clearInterval(autoSaveIntervalRef.current)
    }
    
    // Final save of exercises before finishing (safety measure)
    if (user && exercises.length > 0 && workoutStartTimeRef.current) {
      try {
        await saveActiveWorkoutSession(user.id, {
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
    if (user) {
      try {
        await deleteActiveWorkoutSession(user.id)
      } catch (error) {
        logError('Error deleting active workout session', error)
      }
    }
    
    // Delete paused workout if it exists
    if (user) {
      try {
        await deletePausedWorkoutFromSupabase(user.id)
      } catch (error) {
        // Silently fail
      }
    }

    // Clear localStorage backup
    if (user) {
      try {
        localStorage.removeItem(`activeWorkout_${user.id}`)
        localStorage.removeItem(`workoutStartMetrics_${user.id}`)
      } catch (e) {
        // Silently fail
      }
    }
    
    // Capture wearable metrics at workout end and calculate difference
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
        logError('Error calculating workout wearable metrics', error)
      }
    }
    
    const workout = {
      date: getTodayEST(),
      duration: workoutTime,
      templateName: templateId || 'Freestyle',
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
      
      // Save to Supabase if logged in (with retry logic)
      if (user) {
        let retries = 3
        let saved = false
        while (retries > 0 && !saved) {
          try {
            await saveWorkoutToSupabase(workout, user.id)
            saved = true
            showToast('Workout saved successfully!', 'success')
            
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
              // Store in localStorage for manual recovery
              try {
                localStorage.setItem(`failedWorkout_${user.id}_${Date.now()}`, JSON.stringify(workout))
              } catch (e) {
                logError('Error storing failed workout in localStorage', e)
              }
            }
          }
        }
      } else {
        showToast('Workout saved locally!', 'success')
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
      setSavedWorkout(workout)
      setShowShareModal(true)
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
      if (user) {
        try {
          await savePausedWorkoutToSupabase({
            exercises,
            workoutTime,
            restTime,
            isResting,
            templateId,
            date: getTodayEST()
          }, user.id)
        } catch (error) {
          logError('Error saving paused workout', error)
          // Also save to localStorage as backup
          localStorage.setItem(`pausedWorkout_${user.id}`, JSON.stringify({
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

  const resumeWorkout = async () => {
    if (isPaused && user) {
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
        await saveActiveWorkoutSession(user.id, {
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

  return (
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
                if (window.confirm('Clear all exercises and start fresh? This will delete your current workout progress.')) {
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
                  if (user) {
                    try {
                      await deleteActiveWorkoutSession(user.id)
                      localStorage.removeItem(`activeWorkout_${user.id}`)
                      localStorage.removeItem(`workoutStartMetrics_${user.id}`)
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
              const confirmCancel = window.confirm('You have workout progress. Are you sure you want to cancel? Your progress will be saved for recovery.')
              if (!confirmCancel) return
            }
            
            // Save progress before canceling (for recovery)
            if (user && exercises.length > 0 && workoutStartTimeRef.current) {
              try {
                await saveActiveWorkoutSession(user.id, {
                  workoutStartTime: new Date(workoutStartTimeRef.current).toISOString(),
                  pausedTimeMs: pausedTimeRef.current || 0,
                  restStartTime: restStartTimeRef.current ? new Date(restStartTimeRef.current).toISOString() : null,
                  restDurationSeconds: restDurationRef.current || null,
                  isResting: false,
                  exercises: exercises
                })
                // Also save to localStorage
                localStorage.setItem(`activeWorkout_${user.id}`, JSON.stringify({
                  exercises,
                  workoutTime,
                  restTime,
                  isResting,
                  templateId,
                  date: getTodayEST(),
                  timestamp: Date.now()
                }))
              } catch (error) {
                // Only log unexpected errors
                const isExpectedError = error.code === 'PGRST205' || 
                                        error.code === '42P01' ||
                                        error.code === '42703' ||
                                        error.message?.includes('Could not find the table') ||
                                        error.message?.includes('column') ||
                                        error.message?.includes('does not exist')
                
                if (!isExpectedError) {
                  logError('Error saving workout before cancel', error)
                }
              }
            }
            
            // Clear workout timer when canceling
            if (user) {
              try {
                await deleteActiveWorkoutSession(user.id)
              } catch (error) {
                // Only log unexpected errors
                const isExpectedError = error.code === 'PGRST205' || 
                                        error.code === '42P01' ||
                                        error.message?.includes('Could not find the table')
                
                if (!isExpectedError) {
                  logError('Error deleting active workout session on cancel', error)
                }
              }
            }
            navigate('/')
          }}>
            Cancel
          </button>
          <div className={styles.workoutTimer}>{formatTime(workoutTime)}</div>
          <div className={styles.headerRight}>
            <button 
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
            >
              {isPaused ? '▶ Resume' : '⏸ Pause'}
            </button>
            <button 
              className={styles.finishBtn} 
              onClick={() => {
                if (handleFinishClick && typeof handleFinishClick === 'function') {
                  handleFinishClick()
                }
              }}
            >
              Finish
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
        {/* Stacking Helper Info */}
        {exercises.length >= 2 && exercises.some(ex => !ex.stacked) && (
          <div className={styles.stackHelper}>
            <span className={styles.stackHelperIcon}>💡</span>
            <span className={styles.stackHelperText}>
              Tip: Click "Stack" on exercises to create supersets (2 exercises) or circuits (3+ exercises)
            </span>
          </div>
        )}
        
        {exercises.map((exercise, idx) => {
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
              index={idx}
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
        
        <button className={styles.addExerciseBtn} onClick={() => setShowPicker(true)}>
          + Add Exercise
        </button>
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
              <label>Notes (optional)</label>
              <textarea
                className={styles.notesInput}
                placeholder="How did it go? Any PRs?"
                value={feedback.notes}
                onChange={(e) => setFeedback(f => ({ ...f, notes: e.target.value }))}
              />
            </div>

            <button className={styles.saveBtn} onClick={finishWorkout}>
              Save Workout
            </button>
          </div>
        </div>
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
    </div>
  )
}

