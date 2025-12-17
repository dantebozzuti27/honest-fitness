import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAllTemplates } from '../db/lazyDb'
import { getWorkoutDatesFromSupabase, getWorkoutsByDateFromSupabase, calculateStreakFromSupabase, deleteWorkoutFromSupabase } from '../lib/db/workoutsDb'
import { getUserPreferences } from '../lib/db/userPreferencesDb'
import {
  scheduleWorkoutSupabase,
  deleteScheduledWorkoutByDateFromSupabase,
  getScheduledWorkoutByDateFromSupabase,
  getScheduledWorkoutsFromSupabase,
  getScheduledWorkoutsByDateFromSupabase,
  deleteScheduledWorkoutByIdFromSupabase
} from '../lib/db/scheduledWorkoutsDb'
import { generateWorkoutPlan } from '../lib/workoutPlanning'
import { useAuth } from '../context/AuthContext'
import { getTodayEST } from '../utils/dateUtils'
import SideMenu from '../components/SideMenu'
import HomeButton from '../components/HomeButton'
import ConfirmDialog from '../components/ConfirmDialog'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'
import { useModalA11y } from '../hooks/useModalA11y'
import styles from './Calendar.module.css'

export default function Calendar() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { toast, showToast, hideToast } = useToast()
  const [currentDate, setCurrentDate] = useState(new Date())
  const [workoutDates, setWorkoutDates] = useState([])
  const [scheduledDates, setScheduledDates] = useState({}) // { [date]: scheduled_workouts[] }
  const [selectedDate, setSelectedDate] = useState(null)
  const [selectedWorkout, setSelectedWorkout] = useState(null)
  const [streak, setStreak] = useState(0)
  const [templates, setTemplates] = useState([])
  const [showScheduler, setShowScheduler] = useState(false) // false, 'workout', 'meal', 'goal'
  const [scheduledInfo, setScheduledInfo] = useState(null) // back-compat single
  const [scheduledInfoList, setScheduledInfoList] = useState([]) // multiple per day
  const [weeklyPlan, setWeeklyPlan] = useState(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const shownScheduledLoadErrorRef = useRef(false)

  const dayModalRef = useRef(null)
  const dayModalCloseBtnRef = useRef(null)
  useModalA11y({
    open: Boolean(selectedDate),
    onClose: () => closeModal(),
    containerRef: dayModalRef,
    initialFocusRef: dayModalCloseBtnRef
  })

  const refreshData = async () => {
    if (user) {
      const dates = await getWorkoutDatesFromSupabase(user.id)
      setWorkoutDates(dates)
      const s = await calculateStreakFromSupabase(user.id)
      setStreak(s)
      
      // Load scheduled workouts
      try {
        const scheduled = await getScheduledWorkoutsFromSupabase(user.id)
        const scheduledMap = {}
        ;(scheduled || []).forEach(sw => {
          const d = sw?.date
          if (!d) return
          if (!scheduledMap[d]) scheduledMap[d] = []
          scheduledMap[d].push(sw)
        })
        setScheduledDates(scheduledMap)
      } catch (error) {
        if (!shownScheduledLoadErrorRef.current) {
          shownScheduledLoadErrorRef.current = true
          showToast('Failed to load scheduled workouts.', 'error')
        }
      }
    }
  }

  useEffect(() => {
    async function load() {
      if (user) {
        await refreshData()
        
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
          // Plan loading failed, continue without plan
        }
      }
      const t = await getAllTemplates()
      setTemplates(t)
    }
    load()

    // Refresh on visibility change (when user comes back to tab)
    const handleVisibilityChange = () => {
      if (!document.hidden && user) {
        refreshData()
      }
    }
    const handleTemplatesUpdated = async () => {
      try {
        const t = await getAllTemplates()
        setTemplates(t)
      } catch {
        // ignore
      }
    }
    const handleScheduledUpdated = () => {
      if (user) refreshData()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('templatesUpdated', handleTemplatesUpdated)
    window.addEventListener('scheduledWorkoutsUpdated', handleScheduledUpdated)
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('templatesUpdated', handleTemplatesUpdated)
      window.removeEventListener('scheduledWorkoutsUpdated', handleScheduledUpdated)
    }
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
      const isScheduled = Array.isArray(scheduledDates[dateStr]) && scheduledDates[dateStr].length > 0
      days.push({
        day: i,
        date: dateStr,
        hasWorkout: workoutDates.includes(dateStr),
        isScheduled: isScheduled,
        scheduledItems: scheduledDates[dateStr] || [],
        isToday: dateStr === todayEST
      })
    }
    
    return days
  }, [currentDate, workoutDates, scheduledDates])

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
      setScheduledInfoList([])
    } else {
      setSelectedWorkout(null)
      if (user) {
        const list = await getScheduledWorkoutsByDateFromSupabase(user.id, day.date).catch(() => [])
        setScheduledInfoList(Array.isArray(list) ? list : [])
        const scheduled = await getScheduledWorkoutByDateFromSupabase(user.id, day.date).catch(() => null)
        setScheduledInfo(scheduled)
      }
    }
  }

  const closeModal = () => {
    setSelectedDate(null)
    setSelectedWorkout(null)
    setShowScheduler(false)
    setScheduledInfo(null)
    setScheduledInfoList([])
  }

  const handleScheduleGoal = () => {
    navigate('/goals')
  }

  const handleScheduleMeal = () => {
    navigate('/nutrition')
  }

  const handleSchedule = async (templateId) => {
    if (!user) return
    await scheduleWorkoutSupabase(user.id, selectedDate, templateId)
    // refresh from server to pick up multiple rows per date
    await refreshData()
    setShowScheduler(false)
    const list = await getScheduledWorkoutsByDateFromSupabase(user.id, selectedDate).catch(() => [])
    setScheduledInfoList(Array.isArray(list) ? list : [])
    const scheduled = await getScheduledWorkoutByDateFromSupabase(user.id, selectedDate).catch(() => null)
    setScheduledInfo(scheduled)
  }

  const handleUnschedule = async () => {
    if (!user || !selectedDate) return
    const count = Array.isArray(scheduledInfoList) ? scheduledInfoList.length : (scheduledInfo ? 1 : 0)
    const ok = window.confirm(
      count > 1
        ? `Remove all ${count} scheduled workouts for ${selectedDate}?`
        : `Remove the scheduled workout for ${selectedDate}?`
    )
    if (!ok) return
    await deleteScheduledWorkoutByDateFromSupabase(user.id, selectedDate)
    await refreshData()
    setScheduledInfo(null)
    setScheduledInfoList([])
    setShowScheduler(false)
    try {
      window.dispatchEvent(new CustomEvent('scheduledWorkoutsUpdated'))
    } catch {}
  }

  const handleDeleteScheduledById = async (rowId) => {
    if (!user?.id || !selectedDate || !rowId) return
    try {
      await deleteScheduledWorkoutByIdFromSupabase(user.id, rowId)
      await refreshData()
      const list = await getScheduledWorkoutsByDateFromSupabase(user.id, selectedDate).catch(() => [])
      setScheduledInfoList(Array.isArray(list) ? list : [])
      const scheduled = await getScheduledWorkoutByDateFromSupabase(user.id, selectedDate).catch(() => null)
      setScheduledInfo(scheduled)
      showToast('Scheduled workout removed.', 'success')
      try {
        window.dispatchEvent(new CustomEvent('scheduledWorkoutsUpdated'))
      } catch {}
    } catch (e) {
      showToast('Failed to remove scheduled workout. If this persists, re-run scheduled_workouts RLS policies in `supabase_run_all.sql`.', 'error', 8000)
    }
  }

  const isFutureDate = (dateStr) => {
    // Use the same local date key as the rest of the app (avoids UTC day-boundary bugs).
    return String(dateStr) > String(getTodayEST())
  }

  const isSelectedDateToday = useMemo(() => {
    if (!selectedDate) return false
    return selectedDate === getTodayEST()
  }, [selectedDate])

  const handleDeleteWorkout = async () => {
    if (!selectedWorkout || !user) return
    setDeleteConfirmOpen(true)
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <SideMenu />
        <h1 className={styles.title}>Calendar</h1>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <HomeButton />
          <div className={styles.streak}>
            {streak}
          </div>
        </div>
      </header>

      <div className={styles.content}>
        {toast && <Toast message={toast.message} type={toast.type} onClose={hideToast} />}
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
              className={`${styles.day} ${day?.hasWorkout ? styles.hasWorkout : ''} ${day?.isScheduled ? styles.isScheduled : ''} ${day?.isToday ? styles.today : ''}`}
              onClick={() => selectDay(day)}
              disabled={!day}
              title={day?.isScheduled ? `Scheduled: ${Array.isArray(day.scheduledItems) ? day.scheduledItems.length : 1} workout(s)` : ''}
            >
              {day?.day}
              {day?.isScheduled && !day?.hasWorkout && <span className={styles.scheduledDot}>●</span>}
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
          <div ref={dayModalRef} className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>{new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
              <button ref={dayModalCloseBtnRef} onClick={closeModal}>✕</button>
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
                <h3>Schedule</h3>
                <div className={styles.scheduleTabs}>
                  <button 
                    className={styles.scheduleTab}
                    onClick={() => setShowScheduler('workout')}
                  >
                    Workout
                  </button>
                  <button 
                    className={styles.scheduleTab}
                    onClick={() => setShowScheduler('meal')}
                  >
                    Meal
                  </button>
                  <button 
                    className={styles.scheduleTab}
                    onClick={() => setShowScheduler('goal')}
                  >
                    Goal
                  </button>
                </div>
                {showScheduler === 'workout' && (
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
                )}
                {showScheduler === 'meal' && (
                  <div className={styles.scheduleOptions}>
                    <button className={styles.scheduleBtn} onClick={() => {
                      navigate('/nutrition')
                      closeModal()
                    }}>
                      Log Meal
                    </button>
                    <button className={styles.scheduleBtn} onClick={() => {
                      // Create a meal plan goal
                      navigate('/goals', { state: { createMealPlan: true, date: selectedDate } })
                      closeModal()
                    }}>
                      Create Meal Plan
                    </button>
                    <p className={styles.scheduleNote}>Meals sync to Nutrition and Goals pages</p>
                  </div>
                )}
                {showScheduler === 'goal' && (
                  <div className={styles.scheduleOptions}>
                    <button className={styles.scheduleBtn} onClick={() => navigate('/goals')}>
                      Create Goal
                    </button>
                    <p className={styles.scheduleNote}>Goals sync to Fitness, Health, Nutrition, and Analytics pages</p>
                  </div>
                )}
              </div>
            ) : (
              <div className={styles.noWorkout}>
                {scheduledInfo ? (
                  <>
                    <p className={styles.scheduledLabel}>Scheduled:</p>
                    {Array.isArray(scheduledInfoList) && scheduledInfoList.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {scheduledInfoList.map((sw) => (
                          <div key={sw.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                            <div className={styles.scheduledName} style={{ margin: 0 }}>
                              {sw.template_id === 'freestyle' ? 'Freestyle' : templates.find(t => t.id === sw.template_id)?.name || 'Workout'}
                            </div>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                              {isSelectedDateToday ? (
                                <button
                                  className={styles.scheduleAction}
                                  onClick={() => {
                                    const tid = sw?.template_id
                                    if (!tid) {
                                      showToast('This scheduled workout is missing a template. Re-schedule it from Calendar.', 'error')
                                      return
                                    }
                                    closeModal()
                                    if (tid === 'freestyle') {
                                      navigate('/workout/active')
                                      return
                                    }
                                    navigate('/workout/active', { state: { templateId: tid, scheduledDate: selectedDate } })
                                  }}
                                >
                                  Start
                                </button>
                              ) : null}
                              <button className={styles.scheduleAction} onClick={() => handleDeleteScheduledById(sw.id)}>
                                Delete
                              </button>
                            </div>
                          </div>
                        ))}
                        {scheduledInfoList.length > 1 ? (
                          <button className={styles.scheduleAction} onClick={handleUnschedule}>
                            Remove all for this date
                          </button>
                        ) : null}
                      </div>
                    ) : (
                      <p className={styles.scheduledName}>
                        {scheduledInfo.template_id === 'freestyle' ? 'Freestyle' : templates.find(t => t.id === scheduledInfo.template_id)?.name || 'Workout'}
                      </p>
                    )}
                  </>
                ) : (
                  <p>No workout recorded</p>
                )}
                {isFutureDate(selectedDate) && (
                  <div className={styles.scheduleActions}>
                    <button className={styles.scheduleAction} onClick={() => setShowScheduler('workout')}>
                      {scheduledInfo ? 'Change Schedule' : 'Schedule Workout'}
                    </button>
                    {scheduledInfo ? (
                      <button className={styles.scheduleAction} onClick={handleUnschedule}>
                        Remove schedule
                      </button>
                    ) : null}
                    <button className={styles.scheduleAction} onClick={() => setShowScheduler('meal')}>
                      Schedule Meal
                    </button>
                    <button className={styles.scheduleAction} onClick={() => setShowScheduler('goal')}>
                      Schedule Goal
                    </button>
                  </div>
                )}
                {!isFutureDate(selectedDate) && (
                  <button className={styles.scheduleAction} onClick={() => setShowScheduler('workout')}>
                    Schedule
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={deleteConfirmOpen}
        title="Delete workout?"
        message="This will permanently remove it from your history."
        confirmText="Delete"
        cancelText="Cancel"
        isDestructive
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={async () => {
          if (!selectedWorkout || !user) return
          try {
            await deleteWorkoutFromSupabase(selectedWorkout.id, user.id)
            await refreshData()
            closeModal()
            showToast('Workout deleted', 'success')
          } catch (e) {
            showToast('Failed to delete workout. Please try again.', 'error')
          } finally {
            setDeleteConfirmOpen(false)
          }
        }}
      />

    </div>
  )
}

