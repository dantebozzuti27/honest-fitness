import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAllTemplates, scheduleWorkout, getScheduledWorkout } from '../db'
import { getWorkoutDatesFromSupabase, getWorkoutsByDateFromSupabase, calculateStreakFromSupabase, getUserPreferences, generateWorkoutPlan, deleteWorkoutFromSupabase } from '../lib/supabaseDb'
import { useAuth } from '../context/AuthContext'
import { getTodayEST } from '../utils/dateUtils'
import styles from './Calendar.module.css'

export default function Calendar() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [currentDate, setCurrentDate] = useState(new Date())
  const [workoutDates, setWorkoutDates] = useState([])
  const [scheduledDates, setScheduledDates] = useState({})
  const [selectedDate, setSelectedDate] = useState(null)
  const [selectedWorkout, setSelectedWorkout] = useState(null)
  const [streak, setStreak] = useState(0)
  const [templates, setTemplates] = useState([])
  const [showScheduler, setShowScheduler] = useState(false)
  const [scheduledInfo, setScheduledInfo] = useState(null)
  const [weeklyPlan, setWeeklyPlan] = useState(null)

  useEffect(() => {
    async function load() {
      if (user) {
        const dates = await getWorkoutDatesFromSupabase(user.id)
        setWorkoutDates(dates)
        const s = await calculateStreakFromSupabase(user.id)
        setStreak(s)
        
        // Load weekly plan
        try {
          const prefs = await getUserPreferences(user.id)
          if (prefs && prefs.available_days?.length > 0) {
            const plan = generateWorkoutPlan({
              fitnessGoal: prefs.fitness_goal,
              experienceLevel: prefs.experience_level,
              availableDays: prefs.available_days,
              sessionDuration: prefs.session_duration,
              equipmentAvailable: prefs.equipment_available,
              injuries: prefs.injuries
            }, [])
            setWeeklyPlan(plan)
          }
        } catch (e) {
          console.error('Error loading plan:', e)
        }
      }
      const t = await getAllTemplates()
      setTemplates(t)
    }
    load()
  }, [user])

  const calendarDays = useMemo(() => {
    const year = currentDate.getFullYear()
    const month = currentDate.getMonth()
    
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    
    const days = []
    
    // Add empty cells for days before first of month
    for (let i = 0; i < firstDay.getDay(); i++) {
      days.push(null)
    }
    
    // Add days of month
    const todayEST = getTodayEST()
    for (let i = 1; i <= lastDay.getDate(); i++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`
      days.push({
        day: i,
        date: dateStr,
        hasWorkout: workoutDates.includes(dateStr),
        isToday: dateStr === todayEST
      })
    }
    
    return days
  }, [currentDate, workoutDates])

  const monthName = currentDate.toLocaleString('default', { month: 'long', year: 'numeric' })

  const prevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1))
  }

  const nextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1))
  }

  const selectDay = async (day) => {
    if (!day) return
    setSelectedDate(day.date)
    if (day.hasWorkout && user) {
      const workouts = await getWorkoutsByDateFromSupabase(user.id, day.date)
      setSelectedWorkout(workouts[0])
      setScheduledInfo(null)
    } else {
      setSelectedWorkout(null)
      const scheduled = await getScheduledWorkout(day.date)
      setScheduledInfo(scheduled)
    }
  }

  const closeModal = () => {
    setSelectedDate(null)
    setSelectedWorkout(null)
    setShowScheduler(false)
    setScheduledInfo(null)
  }

  const handleSchedule = async (templateId) => {
    await scheduleWorkout(selectedDate, templateId)
    setScheduledDates(prev => ({ ...prev, [selectedDate]: templateId }))
    setShowScheduler(false)
    const scheduled = await getScheduledWorkout(selectedDate)
    setScheduledInfo(scheduled)
  }

  const isFutureDate = (dateStr) => {
    const today = new Date().toISOString().split('T')[0]
    return dateStr > today
  }

  const handleDeleteWorkout = async () => {
    if (!selectedWorkout || !user) return
    if (!confirm('Are you sure you want to delete this workout?')) return
    
    try {
      await deleteWorkoutFromSupabase(selectedWorkout.id)
      // Refresh data
      const dates = await getWorkoutDatesFromSupabase(user.id)
      setWorkoutDates(dates)
      const s = await calculateStreakFromSupabase(user.id)
      setStreak(s)
      closeModal()
    } catch (e) {
      console.error('Error deleting workout:', e)
      alert('Failed to delete workout')
    }
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate('/')}>
          ← Back
        </button>
        <h1 className={styles.title}>Calendar</h1>
        <div className={styles.streak}>
          {streak}
          <img src="/streak-icon.png" alt="" className={styles.streakIcon} />
        </div>
      </header>

      <div className={styles.content}>
        <div className={styles.monthNav}>
          <button onClick={prevMonth}>←</button>
          <span className={styles.monthName}>{monthName}</span>
          <button onClick={nextMonth}>→</button>
        </div>

        <div className={styles.weekdays}>
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
            <div key={d} className={styles.weekday}>{d}</div>
          ))}
        </div>

        <div className={styles.days}>
          {calendarDays.map((day, idx) => (
            <button
              key={idx}
              className={`${styles.day} ${day?.hasWorkout ? styles.hasWorkout : ''} ${day?.isToday ? styles.today : ''}`}
              onClick={() => selectDay(day)}
              disabled={!day}
            >
              {day?.day}
            </button>
          ))}
        </div>

        {weeklyPlan && (
          <div className={styles.weeklyPlan}>
            <h3 className={styles.weeklyPlanTitle}>Weekly Plan</h3>
            <div className={styles.weeklyPlanGrid}>
              {weeklyPlan.schedule.map((day, idx) => (
                <div 
                  key={idx} 
                  className={`${styles.weeklyPlanDay} ${day.restDay ? styles.restDay : ''}`}
                >
                  <span className={styles.weeklyPlanDayName}>{day.day.slice(0, 3)}</span>
                  <span className={styles.weeklyPlanFocus}>{day.focus}</span>
                </div>
              ))}
            </div>
            <button 
              className={styles.editPlanBtn}
              onClick={() => navigate('/planner')}
            >
              Edit Plan
            </button>
          </div>
        )}
      </div>

      {selectedDate && (
        <div className={styles.overlay} onClick={closeModal}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>{new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
              <button onClick={closeModal}>✕</button>
            </div>
            
            {selectedWorkout ? (
              <div className={styles.workoutDetail}>
                <div className={styles.workoutMeta}>
                  <span className={styles.workoutDuration}>
                    {Math.floor((selectedWorkout.duration || 0) / 60)}:{String((selectedWorkout.duration || 0) % 60).padStart(2, '0')}
                  </span>
                  {selectedWorkout.perceived_effort && (
                    <span className={styles.workoutRpe}>RPE: {selectedWorkout.perceived_effort}</span>
                  )}
                </div>
                <div className={styles.exerciseList}>
                  {(selectedWorkout.workout_exercises || []).map((ex, idx) => (
                    <div key={idx} className={styles.exerciseItem}>
                      <div className={styles.exerciseHeader}>
                        <span className={styles.exerciseName}>{ex.exercise_name}</span>
                        <span className={styles.exerciseBodyPart}>{ex.body_part}</span>
                      </div>
                      <div className={styles.exerciseSets}>
                        {(ex.workout_sets || []).map((s, i) => (
                          <span key={i} className={styles.setChip}>
                            {s.weight ? `${s.reps}×${s.weight} lbs` : (s.time ? `${s.time}` : '-')}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                {selectedWorkout.notes && (
                  <div className={styles.workoutNotes}>
                    <strong>Notes:</strong> {selectedWorkout.notes}
                  </div>
                )}
                <button className={styles.deleteBtn} onClick={handleDeleteWorkout}>
                  Delete Workout
                </button>
              </div>
            ) : showScheduler ? (
              <div className={styles.scheduler}>
                <h3>Schedule Workout</h3>
                <div className={styles.scheduleOptions}>
                  {templates.map(t => (
                    <button key={t.id} className={styles.scheduleBtn} onClick={() => handleSchedule(t.id)}>
                      {t.name}
                    </button>
                  ))}
                  <button className={styles.scheduleBtn} onClick={() => handleSchedule('freestyle')}>
                    Freestyle
                  </button>
                </div>
              </div>
            ) : (
              <div className={styles.noWorkout}>
                {scheduledInfo ? (
                  <>
                    <p className={styles.scheduledLabel}>Scheduled:</p>
                    <p className={styles.scheduledName}>
                      {scheduledInfo.templateId === 'freestyle' ? 'Freestyle' : templates.find(t => t.id === scheduledInfo.templateId)?.name || 'Workout'}
                    </p>
                  </>
                ) : (
                  <p>No workout recorded</p>
                )}
                {isFutureDate(selectedDate) && (
                  <button className={styles.scheduleAction} onClick={() => setShowScheduler(true)}>
                    {scheduledInfo ? 'Change Schedule' : 'Schedule Workout'}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

