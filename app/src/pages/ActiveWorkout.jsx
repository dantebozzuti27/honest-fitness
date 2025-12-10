import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { getTemplate, getAllExercises, saveWorkout } from '../db'
import { saveWorkoutToSupabase, savePausedWorkoutToSupabase, getPausedWorkoutFromSupabase, deletePausedWorkoutFromSupabase } from '../lib/supabaseDb'
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
  const pauseStartTime = useRef(null)
  const workoutTimerRef = useRef(null)
  const restTimerRef = useRef(null)
  const workoutStartTimeRef = useRef(null)
  const restStartTimeRef = useRef(null)
  const restDurationRef = useRef(0)
  const timeoutRefs = useRef([]) // Track all timeouts for cleanup

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
              const shouldResume = window.confirm('You have a paused workout. Would you like to resume it?')
              if (shouldResume) {
                setExercises(Array.isArray(paused.exercises) ? paused.exercises : [])
                setWorkoutTime(paused.workout_time || 0)
                setRestTime(paused.rest_time || 0)
                setIsResting(paused.is_resting || false)
                workoutStartTimeRef.current = Date.now() - ((paused.workout_time || 0) * 1000)
                localStorage.setItem('workoutStartTime', workoutStartTimeRef.current.toString())
                // Clear paused time since we're resuming fresh
                setPausedTime(0)
                localStorage.setItem('pausedTime', '0')
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
    
    // Restore workout timer from localStorage if it exists (workout in progress)
    const savedWorkoutStartTime = localStorage.getItem('workoutStartTime')
    const savedPausedTime = localStorage.getItem('pausedTime')
    
    if (savedWorkoutStartTime) {
      // Restore existing workout timer
      workoutStartTimeRef.current = parseInt(savedWorkoutStartTime)
      if (savedPausedTime) {
        setPausedTime(parseInt(savedPausedTime))
      }
      // Calculate current elapsed time based on stored start time
      const elapsed = Math.floor((Date.now() - workoutStartTimeRef.current - (parseInt(savedPausedTime) || 0)) / 1000)
      setWorkoutTime(Math.max(0, elapsed))
    } else {
      // Initialize new workout timer
      workoutStartTimeRef.current = Date.now()
      localStorage.setItem('workoutStartTime', workoutStartTimeRef.current.toString())
      setWorkoutTime(0)
      setPausedTime(0)
      localStorage.setItem('pausedTime', '0')
    }
    
    // Restore rest timer if it was running
    const savedRestStart = localStorage.getItem('restStartTime')
    const savedRestDuration = localStorage.getItem('restDuration')
    if (savedRestStart && savedRestDuration) {
      restStartTimeRef.current = parseInt(savedRestStart)
      restDurationRef.current = parseInt(savedRestDuration)
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
              localStorage.removeItem('restStartTime')
              localStorage.removeItem('restDuration')
            }
          }
        }, 1000)
      } else {
        localStorage.removeItem('restStartTime')
        localStorage.removeItem('restDuration')
      }
    }
    
    // Update timer every second - always calculate from absolute time, not incremental
    // This ensures timer continues even when app is in background
    const updateTimer = () => {
      if (workoutStartTimeRef.current && !isPaused) {
        // Read pausedTime from localStorage to get the most current value
        const currentPausedTime = parseInt(localStorage.getItem('pausedTime') || '0')
        const elapsed = Math.floor((Date.now() - workoutStartTimeRef.current - currentPausedTime) / 1000)
        setWorkoutTime(Math.max(0, elapsed))
      }
    }
    
    // Update immediately
    updateTimer()
    
    // Then update every second
    if (workoutStartTimeRef.current) {
      workoutTimerRef.current = setInterval(updateTimer, 1000)
    }
    
    // Handle visibility change to recalculate time when app comes to foreground
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        // Recalculate workout time based on absolute time difference
        if (workoutStartTimeRef.current) {
          const currentPausedTime = parseInt(localStorage.getItem('pausedTime') || '0')
          const elapsed = Math.floor((Date.now() - workoutStartTimeRef.current - currentPausedTime) / 1000)
          setWorkoutTime(Math.max(0, elapsed))
        }
        // Recalculate rest timer
        if (restStartTimeRef.current && restDurationRef.current) {
          const elapsed = Math.floor((Date.now() - restStartTimeRef.current) / 1000)
          const remaining = Math.max(0, restDurationRef.current - elapsed)
          setRestTime(remaining)
          if (remaining <= 0 && isResting) {
            clearInterval(restTimerRef.current)
            setIsResting(false)
            setShowTimesUp(true)
            const timeoutId = setTimeout(() => setShowTimesUp(false), 2000)
            timeoutRefs.current.push(timeoutId)
            localStorage.removeItem('restStartTime')
            localStorage.removeItem('restDuration')
          }
        }
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    
    // Also handle page focus/blur for better mobile support
    const handleFocus = () => {
      if (workoutStartTimeRef.current) {
        const currentPausedTime = parseInt(localStorage.getItem('pausedTime') || '0')
        const elapsed = Math.floor((Date.now() - workoutStartTimeRef.current - currentPausedTime) / 1000)
        setWorkoutTime(Math.max(0, elapsed))
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
  }, [templateId, randomWorkout, user, isPaused])

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const startRest = (duration = 90) => {
    restDurationRef.current = duration
    restStartTimeRef.current = Date.now()
    localStorage.setItem('restStartTime', restStartTimeRef.current.toString())
    localStorage.setItem('restDuration', duration.toString())
    setRestTime(duration)
    setIsResting(true)
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
            localStorage.removeItem('restStartTime')
            localStorage.removeItem('restDuration')
          }
      }
    }, 1000)
  }

  const skipRest = () => {
    clearInterval(restTimerRef.current)
    setIsResting(false)
    setRestTime(0)
    localStorage.removeItem('restStartTime')
    localStorage.removeItem('restDuration')
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

  const handleFinishClick = () => {
    // Don't clear timers here - let them continue until workout is actually saved
    // This ensures accurate final time even if user takes time to fill out feedback
    setShowSummary(true)
  }

  // IMPORTANT: Workouts are ONLY created when the user explicitly finishes a workout.
  // This is the ONLY place where workout logs are created - never automatically.
  const finishWorkout = async () => {
    // Clean up timers and localStorage
    clearInterval(workoutTimerRef.current)
    clearInterval(restTimerRef.current)
    localStorage.removeItem('workoutStartTime')
    localStorage.removeItem('pausedTime')
    localStorage.removeItem('restStartTime')
    localStorage.removeItem('restDuration')
    
    // Delete paused workout if it exists
    if (user) {
      try {
        await deletePausedWorkoutFromSupabase(user.id)
      } catch (error) {
        // Silently fail
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
    
    // ONLY save workout if user has at least one exercise
    // Note: Exercises can have no sets, that's okay - we show all exercises
    if (workout.exercises.length === 0) {
      showToast('Cannot save workout with no exercises. Please add at least one exercise.', 'error')
      return
    }
    
    setIsSaving(true)
    try {
      // Save to local IndexedDB
      await saveWorkout(workout)
      
      // Save to Supabase if logged in
      if (user) {
        try {
          await saveWorkoutToSupabase(workout, user.id)
          showToast('Workout saved successfully!', 'success')
        } catch (err) {
          logError('Error saving workout to Supabase', err)
          showToast('Workout saved locally. Syncing to cloud failed - will retry later.', 'warning')
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
    navigate('/')
  }

  // Pause workout functionality
  const pauseWorkout = async () => {
    if (!isPaused) {
      // Pause: stop timer, save state
      setIsPaused(true)
      pauseStartTime.current = Date.now()
      clearInterval(workoutTimerRef.current)
      clearInterval(restTimerRef.current)
      
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

  const resumeWorkout = () => {
    if (isPaused) {
      // Resume: adjust paused time by pause duration
      const pauseDuration = pauseStartTime.current ? Date.now() - pauseStartTime.current : 0
      setPausedTime(prev => {
        const newPausedTime = prev + pauseDuration
        localStorage.setItem('pausedTime', newPausedTime.toString())
        return newPausedTime
      })
      setIsPaused(false)
      pauseStartTime.current = null
      
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
          <button className={styles.cancelBtn} onClick={() => {
            // Clear workout timer when canceling
            localStorage.removeItem('workoutStartTime')
            localStorage.removeItem('pausedTime')
            localStorage.removeItem('restStartTime')
            localStorage.removeItem('restDuration')
            navigate('/')
          }}>
            Cancel
          </button>
          <div className={styles.workoutTimer}>{formatTime(workoutTime)}</div>
          <button className={styles.finishBtn} onClick={handleFinishClick}>
            Finish
          </button>
        </div>
        
        {adjustmentInfo && adjustmentInfo.factor < 1.0 && (
          <div className={`${styles.adjustmentBanner} ${styles[`adjustment${adjustmentInfo.zone}`]}`}>
            <span>Auto-Adjusted: {adjustmentInfo.message}</span>
          </div>
        )}
        
        {isResting && (
          <div className={styles.restBar}>
            <span>Rest: {formatTime(restTime)}</span>
            <button onClick={skipRest}>Skip</button>
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
              notes: savedWorkout.notes
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

