import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { getTemplate, getAllExercises, saveWorkout } from '../db'
import { saveWorkoutToSupabase } from '../lib/supabaseDb'
import { getTodayEST } from '../utils/dateUtils'
import { useAuth } from '../context/AuthContext'
import { getAutoAdjustmentFactor, applyAutoAdjustment, getWorkoutRecommendation } from '../lib/autoAdjust'
import ExerciseCard from '../components/ExerciseCard'
import ExercisePicker from '../components/ExercisePicker'
import styles from './ActiveWorkout.module.css'

export default function ActiveWorkout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
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
  const workoutTimerRef = useRef(null)
  const restTimerRef = useRef(null)
  const workoutStartTimeRef = useRef(null)
  const restStartTimeRef = useRef(null)
  const restDurationRef = useRef(0)

  useEffect(() => {
    async function load() {
      const allEx = await getAllExercises()
      // Exercises loaded from database
      setAllExercises(allEx)
      
      if (templateId) {
        const template = await getTemplate(templateId)
        if (template) {
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
    load()
    
    // Initialize workout timer with persistence
    const savedStartTime = localStorage.getItem('workoutStartTime')
    if (savedStartTime) {
      workoutStartTimeRef.current = parseInt(savedStartTime)
      const elapsed = Math.floor((Date.now() - workoutStartTimeRef.current) / 1000)
      setWorkoutTime(elapsed)
    } else {
      workoutStartTimeRef.current = Date.now()
      localStorage.setItem('workoutStartTime', workoutStartTimeRef.current.toString())
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
              setTimeout(() => setShowTimesUp(false), 2000)
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
    
    // Update timer every second
    workoutTimerRef.current = setInterval(() => {
      if (workoutStartTimeRef.current) {
        const elapsed = Math.floor((Date.now() - workoutStartTimeRef.current) / 1000)
        setWorkoutTime(elapsed)
      }
    }, 1000)
    
    // Handle visibility change to recalculate time
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        if (workoutStartTimeRef.current) {
          const elapsed = Math.floor((Date.now() - workoutStartTimeRef.current) / 1000)
          setWorkoutTime(elapsed)
        }
        if (restStartTimeRef.current && restDurationRef.current) {
          const elapsed = Math.floor((Date.now() - restStartTimeRef.current) / 1000)
          const remaining = Math.max(0, restDurationRef.current - elapsed)
          setRestTime(remaining)
          if (remaining <= 0 && isResting) {
            setIsResting(false)
            setShowTimesUp(true)
            setTimeout(() => setShowTimesUp(false), 2000)
            localStorage.removeItem('restStartTime')
            localStorage.removeItem('restDuration')
          }
        }
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    
    return () => {
      clearInterval(workoutTimerRef.current)
      clearInterval(restTimerRef.current)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [templateId, randomWorkout])

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
          setTimeout(() => setShowTimesUp(false), 2000)
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
    clearInterval(workoutTimerRef.current)
    clearInterval(restTimerRef.current)
    setShowSummary(true)
  }

  const finishWorkout = async () => {
    // Clean up timers and localStorage
    clearInterval(workoutTimerRef.current)
    clearInterval(restTimerRef.current)
    localStorage.removeItem('workoutStartTime')
    localStorage.removeItem('restStartTime')
    localStorage.removeItem('restDuration')
    
    const workout = {
      date: getTodayEST(),
      duration: workoutTime,
      templateName: templateId || 'Freestyle',
      perceivedEffort: feedback.rpe,
      moodAfter: feedback.moodAfter,
      notes: feedback.notes,
      dayOfWeek: new Date().getDay(),
      exercises: exercises.map(ex => ({
        name: ex.name,
        category: ex.category || 'Strength',
        bodyPart: ex.bodyPart || 'Other',
        equipment: ex.equipment || '',
        sets: ex.sets.filter(s => s.weight || s.reps || s.time)
      })).filter(ex => ex.sets.length > 0)
    }
    
    // Saving workout to database
    
    // Save to local IndexedDB
    await saveWorkout(workout)
    
    // Save to Supabase if logged in
    if (user) {
      try {
        await saveWorkoutToSupabase(workout, user.id)
      } catch (err) {
        // Error saving, will retry
      }
    }
    
    navigate('/')
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
          <button className={styles.cancelBtn} onClick={() => navigate('/')}>
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
        {exercises.map((exercise, idx) => (
          <ExerciseCard
            key={exercise.id}
            exercise={exercise}
            index={idx}
            total={exercises.length}
            onToggle={() => toggleExpanded(exercise.id)}
            onUpdateSet={(setIdx, field, value) => updateSet(exercise.id, setIdx, field, value)}
            onAddSet={() => addSet(exercise.id)}
            onRemoveSet={() => removeSet(exercise.id)}
            onRemove={() => removeExercise(exercise.id)}
            onMove={(dir) => moveExercise(exercise.id, dir)}
            onStartRest={startRest}
            onComplete={() => completeExercise(exercise.id)}
            isDragging={draggedId === exercise.id}
            onDragStart={(e) => handleDragStart(e, exercise.id)}
            onDragOver={(e) => handleDragOver(e, exercise.id)}
            onDragEnter={handleDragEnter}
            onDragEnd={handleDragEnd}
            onDrop={(e) => handleDrop(e, exercise.id)}
          />
        ))}
        
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
    </div>
  )
}

