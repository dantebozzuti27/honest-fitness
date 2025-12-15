import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getAllTemplates, saveTemplate, deleteTemplate } from '../db'
import { saveMetricsToSupabase, getUserPreferences, generateWorkoutPlan, getMetricsFromSupabase, getWorkoutsFromSupabase, deleteWorkoutFromSupabase, getScheduledWorkoutsFromSupabase, getPausedWorkoutFromSupabase } from '../lib/supabaseDb'
// Dynamic import for code-splitting
import { useAuth } from '../context/AuthContext'
import { getTodayEST, getYesterdayEST } from '../utils/dateUtils'
import { formatGoalName } from '../utils/formatUtils'
import { formatDateMMDDYYYY } from '../utils/dateUtils'
import { logDebug, logError } from '../utils/logger'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'
import ConfirmDialog from '../components/ConfirmDialog'
import ShareModal from '../components/ShareModal'
import ExercisePicker from '../components/ExercisePicker'
import TemplateEditor from '../components/TemplateEditor'
import SideMenu from '../components/SideMenu'
import HomeButton from '../components/HomeButton'
import HistoryCard from '../components/HistoryCard'
import { chatWithAI } from '../lib/chatApi'
import { FitnessIcon } from '../components/Icons'
import EmptyState from '../components/EmptyState'
import Button from '../components/Button'
import styles from './Fitness.module.css'

const TABS = ['Workout', 'Templates', 'History', 'Scheduled', 'Goals']

export default function Fitness() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState('Workout')
  const [templates, setTemplates] = useState([])
  const [todaysPlan, setTodaysPlan] = useState(null)
  const [aiWorkout, setAiWorkout] = useState(null)
  const [showTemplateEditor, setShowTemplateEditor] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState(null)
  const [workoutHistory, setWorkoutHistory] = useState([])
  const [fitnessGoals, setFitnessGoals] = useState([])
  const [scheduledWorkouts, setScheduledWorkouts] = useState([])
  const { toast, showToast, hideToast } = useToast()
  const [confirmState, setConfirmState] = useState({ open: false, title: '', message: '', action: null, payload: null })
  const [showShareModal, setShowShareModal] = useState(false)
  const [selectedWorkoutForShare, setSelectedWorkoutForShare] = useState(null)
  const [showWorkoutStartModal, setShowWorkoutStartModal] = useState(false)
  const [showTemplateSelection, setShowTemplateSelection] = useState(false)
  const [todaysScheduledWorkout, setTodaysScheduledWorkout] = useState(null)
  const [isGeneratingWorkout, setIsGeneratingWorkout] = useState(false)
  const subscriptionRef = useRef(null)
  const [pausedWorkout, setPausedWorkout] = useState(null)
  const [metrics, setMetrics] = useState({
    sleepScore: '',
    sleepTime: '',
    hrv: '',
    steps: '',
    caloriesBurned: '',
    weight: ''
  })

  const loadFitnessGoals = useCallback(async () => {
    if (!user) return
    try {
      // First, update goal progress based on current data
      const { updateCategoryGoals } = await import('../lib/goalsDb')
      await updateCategoryGoals(user.id, 'fitness').catch(() => {
        // Silently fail - continue to load goals even if update fails
      })
      
      // Then load the updated goals
      const { getActiveGoalsFromSupabase } = await import('../lib/goalsDb')
      const goals = await getActiveGoalsFromSupabase(user.id, 'fitness')
      setFitnessGoals(goals)
    } catch (e) {
      // Silently fail
    }
  }, [user])

  const loadWorkoutHistory = useCallback(async () => {
    if (!user) return
    try {
      const workouts = await getWorkoutsFromSupabase(user.id)
      setWorkoutHistory(workouts)
    } catch (e) {
      // Silently fail
      logError('Error loading workout history', e)
    }
  }, [user])

  const loadPausedWorkout = useCallback(async () => {
    if (!user) return
    try {
      const paused = await getPausedWorkoutFromSupabase(user.id)
      setPausedWorkout(paused)
    } catch (e) {
      // Silently fail - table might not exist
      if (e.code !== 'PGRST205' && !e.message?.includes('Could not find the table')) {
        logError('Error loading paused workout', e)
      }
      setPausedWorkout(null)
    }
  }, [user])

  const handleResumePausedWorkout = () => {
    if (pausedWorkout) {
      navigate('/workout/active', { state: { resumePaused: true } })
    }
  }

  const handleDismissPausedWorkout = async () => {
    if (!user || !pausedWorkout) return
    try {
      const { deletePausedWorkoutFromSupabase } = await import('../lib/supabaseDb')
      await deletePausedWorkoutFromSupabase(user.id)
      setPausedWorkout(null)
      if (showToast && typeof showToast === 'function') {
        showToast('Paused workout dismissed', 'info')
      }
    } catch (error) {
      logError('Error dismissing paused workout', error)
      if (showToast && typeof showToast === 'function') {
        showToast('Failed to dismiss paused workout', 'error')
      }
    }
  }

  useEffect(() => {
    // Check if AI workout was passed from Planner
    if (location.state?.aiWorkout) {
      setAiWorkout(location.state.aiWorkout)
      localStorage.setItem('aiWorkout', JSON.stringify(location.state.aiWorkout))
    } else {
      const saved = localStorage.getItem('aiWorkout')
      if (saved) {
        try {
          setAiWorkout(JSON.parse(saved))
        } catch (e) {
          localStorage.removeItem('aiWorkout')
        }
      }
    }

    // Check if workout modal should open from quick log
    if (location.state?.openWorkoutModal) {
      setShowWorkoutStartModal(true)
      // Clear the state to prevent reopening on re-render
      navigate(location.pathname, { replace: true, state: {} })
    }

    async function load() {
      const t = await getAllTemplates()
      setTemplates(t)
      
      if (user) {
        try {
          // Load workout history
          const workouts = await getWorkoutsFromSupabase(user.id)
          setWorkoutHistory(workouts) // Show all workouts
          
          // Load fitness goals
          await loadFitnessGoals()
          
          // Load today's scheduled workout
          const today = getTodayEST()
          const scheduled = await getScheduledWorkoutsFromSupabase(user.id)
          setScheduledWorkouts(scheduled || [])
          const todaysScheduled = Array.isArray(scheduled) ? scheduled.find(s => s && s.date === today) : null
          if (todaysScheduled) {
            setTodaysScheduledWorkout(todaysScheduled)
          }
          
          const prefs = await getUserPreferences(user.id)
          if (prefs && prefs.available_days?.length > 0) {
            const plan = generateWorkoutPlan({
              fitnessGoal: prefs.fitness_goal,
              experienceLevel: prefs.experience_level,
              availableDays: prefs.available_days,
              sessionDuration: prefs.session_duration,
              equipmentAvailable: prefs.equipment_available,
              injuries: prefs.injuries
            }, t)
            
            const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
            const todayDay = dayNames[new Date().getDay()]
            const todaysWorkout = plan.schedule.find(d => d.day === todayDay && !d.restDay)
            setTodaysPlan(todaysWorkout)
          }
        } catch (e) {
          // Silently fail
        }
      }
    }
    load()
    loadPausedWorkout()
  }, [user, location.state, loadPausedWorkout])

  // Refresh goals when page becomes visible or when navigating back from Goals page
  useEffect(() => {
    if (!user) return
    loadFitnessGoals()
  }, [user, location.key, loadFitnessGoals])

  useEffect(() => {
    if (!user) return
    
    // Set up Supabase real-time subscription for workouts
    const workoutsChannel = supabase
      .channel(`fitness_workouts_changes_${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*', // INSERT, UPDATE, DELETE
          schema: 'public',
          table: 'workouts',
          filter: `user_id=eq.${user.id}`
        },
        (payload) => {
          // Refresh workout history when workout changes
          logDebug('Workout change detected in Fitness', { eventType: payload?.eventType })
          loadWorkoutHistory()
        }
      )
      .subscribe()

    subscriptionRef.current = { workoutsChannel }
    
    // Listen for workoutSaved event from ActiveWorkout page
    const handleWorkoutSaved = () => {
      // Small delay to ensure database write is complete
      setTimeout(() => {
        loadWorkoutHistory()
      }, 500)
    }
    
    window.addEventListener('workoutSaved', handleWorkoutSaved)
    
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        loadFitnessGoals()
        loadWorkoutHistory() // Also refresh workout history
      }
    }
    
    // Refresh when window gains focus
    const handleFocus = () => {
      if (document.hasFocus()) {
        loadWorkoutHistory()
      }
    }
    
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleFocus)
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('workoutSaved', handleWorkoutSaved)
      
      // Clean up subscription
      if (subscriptionRef.current?.workoutsChannel) {
        supabase.removeChannel(subscriptionRef.current.workoutsChannel)
        subscriptionRef.current = null
      }
    }
  }, [user, loadFitnessGoals, loadWorkoutHistory])

  // Refresh workout history when navigating to Fitness page or when History tab becomes active
  useEffect(() => {
    if (user && (location.pathname === '/fitness' || location.pathname === '/workout')) {
      // Small delay to ensure page is mounted
      const timeoutId = setTimeout(() => {
        loadWorkoutHistory()
      }, 100)
      return () => clearTimeout(timeoutId)
    }
  }, [location.pathname, user, loadWorkoutHistory])

  // Refresh workout history when History tab is opened
  useEffect(() => {
    if (user && activeTab === 'History') {
      loadWorkoutHistory()
    }
  }, [activeTab, user, loadWorkoutHistory])

  const startWorkout = async (templateId, random = false) => {
    // Navigate to active workout page
    // templateId can be null for freestyle workouts
    navigate('/workout/active', { state: { templateId, randomWorkout: random } })
  }

  const handleWorkoutTypeSelect = (type) => {
    if (type === 'scheduled' && todaysScheduledWorkout) {
      // Start today's scheduled workout
      setShowWorkoutStartModal(false)
      startWorkout(todaysScheduledWorkout.template_id, false)
    } else if (type === 'templates') {
      // Show template selection in modal
      setShowTemplateSelection(true)
    } else if (type === 'freestyle') {
      setShowWorkoutStartModal(false)
      startWorkout(null, false)
    } else if (type === 'random') {
      setShowWorkoutStartModal(false)
      startWorkout(null, true)
    }
  }

  // Removed startOutdoorRun - not needed for now

  const startRandomWorkout = async () => {
    try {
      const data = await chatWithAI({
        messages: [{ role: 'user', content: 'Generate a random full-body workout for me' }]
      })
      if (data?.workout) {
        setAiWorkout(data.workout)
        localStorage.setItem('aiWorkout', JSON.stringify(data.workout))
        navigate('/workout/active', { state: { aiWorkout: data.workout } })
        return
      }
    } catch (e) {
      showToast('Failed to generate workout. Please try again.', 'error')
    }
    navigate('/workout/active', { state: { randomWorkout: true } })
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <SideMenu />
        <h1>Fitness</h1>
        <HomeButton />
      </div>

      <div className={styles.tabs}>
        {TABS.map(tab => (
          <Button
            unstyled
            key={tab}
            className={`${styles.tab} ${activeTab === tab ? styles.activeTab : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </Button>
        ))}
      </div>

      <div className={styles.content}>
        {activeTab === 'Workout' && (
          <div>
            {/* Paused Workout Banner */}
            {pausedWorkout && (
              <div className={styles.pausedWorkoutBanner}>
                <div className={styles.pausedWorkoutInfo}>
                  <span className={styles.pausedWorkoutIcon}>⏸</span>
                  <div className={styles.pausedWorkoutDetails}>
                    <div className={styles.pausedWorkoutTitle}>Paused Workout</div>
                    <div className={styles.pausedWorkoutSubtext}>
                      {pausedWorkout.exercises?.length || 0} exercises • {Math.floor((pausedWorkout.workout_time || 0) / 60)} min
                      {pausedWorkout.paused_at && ` • Paused ${new Date(pausedWorkout.paused_at).toLocaleDateString()}`}
                    </div>
                  </div>
                </div>
                <div className={styles.pausedWorkoutActions}>
                  <Button unstyled className={styles.resumePausedBtn} onClick={handleResumePausedWorkout}>
                    Resume
                  </Button>
                  <Button
                    unstyled
                    className={styles.dismissPausedBtn}
                    onClick={handleDismissPausedWorkout}
                    title="Dismiss paused workout"
                  >
                    ×
                  </Button>
                </div>
              </div>
            )}

            {/* Start Workout Button */}
            <Button unstyled className={styles.startWorkoutBtn} onClick={() => setShowWorkoutStartModal(true)}>
              Start Workout
            </Button>

            {/* Workout Start Modal */}
            {showWorkoutStartModal && (
              <div className={styles.workoutStartModalOverlay} onClick={() => {
                setShowWorkoutStartModal(false)
                setShowTemplateSelection(false)
              }}>
                <div className={styles.workoutStartModal} onClick={(e) => e.stopPropagation()}>
                  {!showTemplateSelection ? (
                    <>
                      <h3>Choose Workout Type</h3>
                      <div className={styles.workoutTypeOptions}>
                        {todaysScheduledWorkout && (
                          <Button
                            unstyled
                            className={styles.workoutTypeBtn}
                            onClick={() => handleWorkoutTypeSelect('scheduled')}
                          >
                            Today's Scheduled Workout
                            <span className={styles.workoutTypeSubtext}>
                              {templates.find(t => t.id === todaysScheduledWorkout.template_id)?.name || 'Scheduled'}
                            </span>
                          </Button>
                        )}
                        <Button unstyled className={styles.workoutTypeBtn} onClick={() => handleWorkoutTypeSelect('templates')}>
                          Choose Template
                        </Button>
                        <Button unstyled className={styles.workoutTypeBtn} onClick={() => handleWorkoutTypeSelect('freestyle')}>
                          Freestyle
                        </Button>
                        <Button unstyled className={styles.workoutTypeBtn} onClick={() => handleWorkoutTypeSelect('random')}>
                          Random Workout
                        </Button>
                      </div>
                      <Button
                        unstyled
                        className={styles.closeModalBtn}
                        onClick={() => {
                          setShowWorkoutStartModal(false)
                          setShowTemplateSelection(false)
                        }}
                      >
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      <div className={styles.modalHeader}>
                        <Button
                          unstyled
                          className={styles.backBtn}
                          onClick={() => setShowTemplateSelection(false)}
                          aria-label="Back"
                        >
                          ←
                        </Button>
                        <h3 className={styles.modalTitle}>Choose Template</h3>
                        <Button
                          unstyled
                          className={styles.closeModalBtn}
                          onClick={() => {
                            setShowWorkoutStartModal(false)
                            setShowTemplateSelection(false)
                          }}
                          aria-label="Close"
                        >
                          ✕
                        </Button>
                      </div>
                      <div className={styles.templateSelectionList}>
                        {templates.length === 0 ? (
                          <EmptyState
                            title="No templates yet"
                            message="Create a template in the Templates tab to start faster."
                            actionLabel="Open templates"
                            onAction={() => {
                              setShowWorkoutStartModal(false)
                              setShowTemplateSelection(false)
                              setActiveTab('Templates')
                            }}
                          />
                        ) : (
                          templates.map(template => (
                            <Button
                              unstyled
                              key={template.id}
                              className={styles.templateSelectionBtn}
                              onClick={() => {
                                setShowWorkoutStartModal(false)
                                setShowTemplateSelection(false)
                                startWorkout(template.id, false)
                              }}
                            >
                              <div className={styles.templateSelectionContent}>
                                <span className={styles.templateSelectionName}>{template.name}</span>
                                <span className={styles.templateSelectionCount}>{template.exercises?.length || 0} exercises</span>
                              </div>
                            </Button>
                          ))
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Today's Plan */}
            {todaysPlan && (
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Today's Plan</h2>
                <div className={styles.todayPlan}>
                  <div className={styles.todayPlanHeader}>
                    <span className={styles.todayPlanFocus}>{todaysPlan.focus}</span>
                    <span className={styles.todayPlanDay}>{todaysPlan.day}</span>
                  </div>
                  <div className={styles.todayPlanExercises}>
                    {todaysPlan.exercises?.map((ex, i) => (
                      <span key={i} className={styles.todayPlanExercise}>{ex}</span>
                    ))}
                  </div>
                  <Button unstyled className={styles.startPlanBtn} onClick={() => startWorkout(`plan-${todaysPlan.focus}`)}>
                    Start {todaysPlan.focus} Workout
                  </Button>
                </div>
              </section>
            )}

            {/* AI Generated Workout */}
            {aiWorkout && (
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>AI Generated Workout</h2>
                <div className={styles.aiWorkoutCard}>
                  <div className={styles.aiWorkoutHeader}>
                    <span className={styles.aiWorkoutName}>{aiWorkout.name}</span>
                    <Button
                      unstyled
                      className={styles.clearAiBtn}
                      onClick={() => {
                        setAiWorkout(null)
                        localStorage.removeItem('aiWorkout')
                      }}
                    >
                      Clear
                    </Button>
                  </div>
                  <div className={styles.aiWorkoutExercises}>
                    {aiWorkout.exercises?.map((ex, i) => (
                      <span key={i} className={styles.aiWorkoutExercise}>
                        {ex.name}: {ex.sets}x{ex.reps}
                      </span>
                    ))}
                  </div>
                  <Button unstyled className={styles.startAiBtn} onClick={() => navigate('/workout/active', { state: { aiWorkout } })}>
                    Start AI Workout
                  </Button>
                </div>
              </section>
            )}
          </div>
        )}

        {activeTab === 'Templates' && (
          <div>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Templates</h2>
              <Button unstyled className={styles.manageBtn} onClick={() => setShowTemplateEditor(true)}>
                Manage
              </Button>
            </div>
            
            <div className={styles.templateList}>
              {templates.map(template => (
                <div key={template.id} className={styles.templateItem}>
                  <Button
                    unstyled
                    className={styles.templateBtn}
                    onClick={() => {
                      setActiveTab('Workout')
                      startWorkout(template.id, false)
                    }}
                  >
                    <span className={styles.templateName}>{template.name}</span>
                    <span className={styles.templateCount}>{template.exercises.length} exercises</span>
                  </Button>
                  <div className={styles.templateActions}>
                    <Button
                      unstyled
                      className={styles.editTemplateBtn}
                      onClick={() => {
                        setEditingTemplate(template)
                        setShowTemplateEditor(true)
                      }}
                      title="Edit template"
                    >
                      Edit
                    </Button>
                    <Button
                      unstyled
                      className={styles.deleteTemplateBtn}
                      onClick={async () => {
                        setConfirmState({
                          open: true,
                          title: 'Delete template?',
                          message: `Delete template "${template.name}"?`,
                          action: 'delete_template',
                          payload: { templateId: template.id }
                        })
                      }}
                      title="Delete template"
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
              
              <Button
                unstyled
                className={styles.freestyleBtn}
                onClick={() => {
                  setActiveTab('Workout')
                  startWorkout(null, false, true) // forceNavigate = true
                }}
              >
                Freestyle Workout
              </Button>

              <Button
                unstyled
                className={styles.randomBtn}
                onClick={() => {
                  setActiveTab('Workout')
                  startRandomWorkout()
                }}
              >
                Random Workout
              </Button>
            </div>
          </div>
        )}

        {activeTab === 'History' && (
          <div className={styles.historyContent}>
            <h2 className={styles.sectionTitle}>Workout & Recovery History</h2>
            {workoutHistory.length === 0 ? (
              <EmptyState
                icon={<FitnessIcon size={24} />}
                title="No sessions yet"
                message="Log a workout or a recovery session to see your progress here."
                actionLabel="Start session"
                onAction={() => navigate('/log')}
              />
            ) : (
              <div className={styles.historyCards}>
                {workoutHistory
                  .sort((a, b) => b.date.localeCompare(a.date))
                  .map((workout, index) => {
                    const previousWorkout = workoutHistory
                      .sort((a, b) => b.date.localeCompare(a.date))
                      [index + 1]
                    return (
                      <HistoryCard
                        key={workout.id}
                        type="fitness"
                        date={workout.date}
                        data={workout}
                        previousData={previousWorkout}
                        index={index}
                        onView={() => {
                          // Could navigate to workout details
                          logDebug('View workout clicked', { workoutId: workout.id })
                        }}
                        onShare={() => {
                          setSelectedWorkoutForShare(workout)
                          setShowShareModal(true)
                        }}
                        onDelete={async () => {
                          setConfirmState({
                            open: true,
                            title: 'Delete session?',
                            message: `Delete session from ${workout.date}?`,
                            action: 'delete_workout',
                            payload: { workoutId: workout.id }
                          })
                        }}
                      />
                    )
                  })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'Scheduled' && (
          <div className={styles.scheduledContent}>
            <h2 className={styles.sectionTitle}>Scheduled Workouts</h2>
            <div style={{ marginBottom: '16px' }}>
              <Button unstyled className={styles.goalsBtn} onClick={() => navigate('/calendar')}>
                Schedule Workout
              </Button>
            </div>
            {(() => {
              const today = getTodayEST()
              const upcoming = scheduledWorkouts.filter(s => s.date >= today).sort((a, b) => a.date.localeCompare(b.date))
              const past = scheduledWorkouts.filter(s => s.date < today).sort((a, b) => b.date.localeCompare(a.date))
              
              if (upcoming.length === 0 && past.length === 0) {
                return (
                  <EmptyState
                    title="No scheduled workouts"
                    message="Schedule workouts in Calendar to keep your week on track."
                    actionLabel="Open calendar"
                    onAction={() => navigate('/calendar')}
                  />
                )
              }
              
              return (
                <>
                  {upcoming.length > 0 && (
                    <div style={{ marginBottom: '24px' }}>
                      <h3 className={styles.subsectionTitle}>Upcoming</h3>
                      <div className={styles.scheduledList}>
                        {upcoming.map((scheduled, idx) => {
                          const date = new Date(scheduled.date + 'T12:00:00')
                          const isToday = scheduled.date === today
                          const isTomorrow = scheduled.date === new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]
                          let dateLabel = ''
                          if (isToday) {
                            dateLabel = 'Today'
                          } else if (isTomorrow) {
                            dateLabel = 'Tomorrow'
                          } else {
                            dateLabel = date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
                          }
                          const template = templates.find(t => t.id === scheduled.template_id)
                          return (
                            <div key={idx} className={styles.scheduledCard}>
                              <div className={styles.scheduledDate}>{dateLabel}</div>
                              <div className={styles.scheduledName}>
                                {scheduled.template_id === 'freestyle' ? 'Freestyle' : template?.name || 'Workout'}
                              </div>
                              <Button unstyled className={styles.scheduledAction} onClick={() => navigate('/calendar')}>
                                View
                              </Button>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                  {past.length > 0 && (
                    <div>
                      <h3 className={styles.subsectionTitle}>Past</h3>
                      <div className={styles.scheduledList}>
                        {past.slice(0, 10).map((scheduled, idx) => {
                          const date = new Date(scheduled.date + 'T12:00:00')
                          const template = templates.find(t => t.id === scheduled.template_id)
                          return (
                            <div key={idx} className={styles.scheduledCard}>
                              <div className={styles.scheduledDate}>
                                {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                              </div>
                              <div className={styles.scheduledName}>
                                {scheduled.template_id === 'freestyle' ? 'Freestyle' : template?.name || 'Workout'}
                              </div>
                              <Button unstyled className={styles.scheduledAction} onClick={() => navigate('/calendar')}>
                                View
                              </Button>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </>
              )
            })()}
          </div>
        )}

        {activeTab === 'Goals' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 className={styles.sectionTitle}>Fitness Goals</h2>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <Button
                  unstyled
                  className={styles.goalsBtn}
                  onClick={async () => {
                    if (user) {
                      try {
                        showToast('Refreshing goals...', 'info')
                        const { updateCategoryGoals } = await import('../lib/goalsDb')
                        const result = await updateCategoryGoals(user.id, 'fitness')
                        await loadFitnessGoals()
                        showToast(`Goals refreshed! Updated ${result.updated} goals.`, 'success')
                      } catch (error) {
                        logError('Error refreshing fitness goals', error)
                        showToast(`Error: ${error.message || 'Failed to refresh goals. Check console for details.'}`, 'error')
                      }
                    }
                  }}
                >
                  Refresh
                </Button>
                <Button unstyled className={styles.goalsBtn} onClick={() => navigate('/goals')}>
                  View All Goals
                </Button>
              </div>
            </div>
            {fitnessGoals.length === 0 ? (
              <p className={styles.emptyText}>No fitness goals set. Create one on the Goals page.</p>
            ) : (
              <div className={styles.goalsList}>
                {fitnessGoals.map(goal => {
                  const progress = goal.target_value > 0 
                    ? Math.min(100, (goal.current_value / goal.target_value) * 100) 
                    : 0
                  return (
                    <div key={goal.id} className={styles.goalCard}>
                      <div className={styles.goalHeader}>
                        <div className={styles.goalNameContainer}>
                          <span className={styles.goalName}>
                            {formatGoalName(goal)}
                          </span>
                        </div>
                        <span className={styles.goalProgress}>{Math.round(progress)}%</span>
                      </div>
                      <div className={styles.goalBar}>
                        <div className={styles.goalBarFill} style={{ width: `${progress}%` }} />
                      </div>
                      <div className={styles.goalValues}>
                        {goal.current_value} / {goal.target_value} {goal.unit}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Template Editor Modal */}
        {showTemplateEditor && createPortal(
          <TemplateEditor
            templates={templates}
            onClose={() => {
              setShowTemplateEditor(false)
              setEditingTemplate(null)
            }}
            onSave={async (template) => {
              await saveTemplate(template)
              const updated = await getAllTemplates()
              setTemplates(updated)
              setEditingTemplate(null)
            }}
            onDelete={async (id) => {
              setConfirmState({
                open: true,
                title: 'Delete template?',
                message: 'Delete this template?',
                action: 'delete_template',
                payload: { templateId: id }
              })
            }}
            onEdit={(template) => {
              setEditingTemplate(template)
            }}
            editingTemplate={editingTemplate}
          />,
          document.body
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
        isOpen={confirmState.open}
        title={confirmState.title}
        message={confirmState.message}
        confirmText={confirmState.action?.startsWith('delete') ? 'Delete' : 'Confirm'}
        cancelText="Cancel"
        isDestructive={confirmState.action?.startsWith('delete')}
        onClose={() => setConfirmState({ open: false, title: '', message: '', action: null, payload: null })}
        onConfirm={async () => {
          const action = confirmState.action
          const payload = confirmState.payload
          try {
            if (action === 'delete_template') {
              const templateId = payload?.templateId
              if (!templateId) return
              await deleteTemplate(templateId)
              const updated = await getAllTemplates()
              setTemplates(updated)
              showToast('Template deleted', 'success')
            } else if (action === 'delete_workout') {
              const workoutId = payload?.workoutId
              if (!workoutId || !user) return
              await deleteWorkoutFromSupabase(workoutId, user.id)
              await loadWorkoutHistory()
              showToast('Workout deleted', 'success')
            }
          } catch (e) {
            logError('Confirm action failed', e)
            showToast('Action failed. Please try again.', 'error')
          } finally {
            setConfirmState({ open: false, title: '', message: '', action: null, payload: null })
          }
        }}
      />

      {/* Share Modal */}
      {showShareModal && selectedWorkoutForShare && (() => {
        // Transform workout data from database format to ShareCard format
        const exercises = (selectedWorkoutForShare.workout_exercises || []).map(ex => ({
          name: ex.exercise_name,
          category: ex.category,
          stacked: ex.stacked || false,
          stackGroup: ex.stack_group || null,
          sets: (ex.workout_sets || []).map(set => ({
            weight: set.weight,
            reps: set.reps,
            time: set.time,
            speed: set.speed,
            incline: set.incline
          }))
        }))
        
        // Intentionally avoid logging workout contents (PII-adjacent) even in dev.
        
        return (
          <ShareModal
            type="workout"
            data={{
              workout: {
                date: selectedWorkoutForShare.date,
                duration: selectedWorkoutForShare.duration || 0,
                exercises: exercises,
                templateName: selectedWorkoutForShare.template_name || 'Freestyle Workout',
                perceivedEffort: selectedWorkoutForShare.perceived_effort,
                moodAfter: selectedWorkoutForShare.mood_after,
                notes: selectedWorkoutForShare.notes,
                workoutCaloriesBurned: selectedWorkoutForShare.workout_calories_burned != null ? selectedWorkoutForShare.workout_calories_burned : null,
                workoutSteps: selectedWorkoutForShare.workout_steps != null ? selectedWorkoutForShare.workout_steps : null
              }
            }}
            onClose={() => {
              setShowShareModal(false)
              setSelectedWorkoutForShare(null)
            }}
          />
        )
      })()}
      </div>

    </div>
  )
}

