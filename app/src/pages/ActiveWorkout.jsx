import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { getTemplate, getAllExercises, saveWorkout } from '../db'
import { saveWorkoutToSupabase } from '../lib/supabaseDb'
import { useAuth } from '../context/AuthContext'
import ExerciseCard from '../components/ExerciseCard'
import ExercisePicker from '../components/ExercisePicker'
import styles from './ActiveWorkout.module.css'

export default function ActiveWorkout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const templateId = location.state?.templateId
  
  const [exercises, setExercises] = useState([])
  const [allExercises, setAllExercises] = useState([])
  const [showPicker, setShowPicker] = useState(false)
  const [workoutTime, setWorkoutTime] = useState(0)
  const [restTime, setRestTime] = useState(0)
  const [isResting, setIsResting] = useState(false)
  const [draggedId, setDraggedId] = useState(null)
  const workoutTimerRef = useRef(null)
  const restTimerRef = useRef(null)

  useEffect(() => {
    async function load() {
      const allEx = await getAllExercises()
      setAllExercises(allEx)
      
      if (templateId) {
        const template = await getTemplate(templateId)
        if (template) {
          const workoutExercises = template.exercises.map((name, idx) => {
            const exerciseData = allEx.find(e => e.name === name) || { name, category: 'Strength' }
            const isCardio = exerciseData.category === 'Cardio'
            const isRecovery = exerciseData.category === 'Recovery'
            const defaultSets = (isCardio || isRecovery) ? 1 : 4
            return {
              id: idx,
              name,
              category: exerciseData.category,
              bodyPart: exerciseData.bodyPart,
              sets: Array(defaultSets).fill(null).map(() => ({ weight: '', reps: '', time: '', speed: '', incline: '' })),
              expanded: idx === 0
            }
          })
          setExercises(workoutExercises)
        }
      }
    }
    load()
    
    // Start workout timer
    workoutTimerRef.current = setInterval(() => {
      setWorkoutTime(t => t + 1)
    }, 1000)
    
    return () => {
      clearInterval(workoutTimerRef.current)
      clearInterval(restTimerRef.current)
    }
  }, [templateId])

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const startRest = () => {
    setRestTime(90)
    setIsResting(true)
    clearInterval(restTimerRef.current)
    restTimerRef.current = setInterval(() => {
      setRestTime(t => {
        if (t <= 1) {
          clearInterval(restTimerRef.current)
          setIsResting(false)
          return 0
        }
        return t - 1
      })
    }, 1000)
  }

  const skipRest = () => {
    clearInterval(restTimerRef.current)
    setIsResting(false)
    setRestTime(0)
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

  const handleDragStart = (id) => {
    setDraggedId(id)
  }

  const handleDragOver = (e, targetId) => {
    e.preventDefault()
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

  const handleDragEnd = () => {
    setDraggedId(null)
  }

  const finishWorkout = async () => {
    clearInterval(workoutTimerRef.current)
    clearInterval(restTimerRef.current)
    
    const workout = {
      date: new Date().toISOString().split('T')[0],
      duration: workoutTime,
      exercises: exercises.map(ex => ({
        name: ex.name,
        category: ex.category,
        bodyPart: ex.bodyPart,
        equipment: ex.equipment,
        sets: ex.sets.filter(s => s.weight || s.reps || s.time)
      })).filter(ex => ex.sets.length > 0)
    }
    
    // Save to local IndexedDB
    await saveWorkout(workout)
    
    // Save to Supabase if logged in
    if (user) {
      try {
        await saveWorkoutToSupabase(workout, user.id)
      } catch (err) {
        console.error('Error saving to Supabase:', err)
      }
    }
    
    navigate('/')
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.headerTop}>
          <button className={styles.cancelBtn} onClick={() => navigate('/')}>
            Cancel
          </button>
          <div className={styles.workoutTimer}>{formatTime(workoutTime)}</div>
          <button className={styles.finishBtn} onClick={finishWorkout}>
            Finish
          </button>
        </div>
        
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
            onDragStart={() => handleDragStart(exercise.id)}
            onDragOver={(e) => handleDragOver(e, exercise.id)}
            onDragEnd={handleDragEnd}
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
    </div>
  )
}

