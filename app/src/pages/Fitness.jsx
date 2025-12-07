import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useLocation } from 'react-router-dom'
import { getAllTemplates, saveTemplate, deleteTemplate } from '../db'
import { saveMetricsToSupabase, getUserPreferences, generateWorkoutPlan, getMetricsFromSupabase, getWorkoutsFromSupabase, deleteWorkoutFromSupabase, getScheduledWorkoutsFromSupabase } from '../lib/supabaseDb'
import { getActiveGoalsFromSupabase } from '../lib/goalsDb'
import { useAuth } from '../context/AuthContext'
import { getTodayEST, getYesterdayEST } from '../utils/dateUtils'
import { logError } from '../utils/logger'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'
import ShareModal from '../components/ShareModal'
import ExercisePicker from '../components/ExercisePicker'
import TemplateEditor from '../components/TemplateEditor'
import SideMenu from '../components/SideMenu'
import HomeButton from '../components/HomeButton'
import styles from './Fitness.module.css'

const TABS = ['Workout', 'Templates', 'History', 'Goals']

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
  const { toast, showToast, hideToast } = useToast()
  const [showShareModal, setShowShareModal] = useState(false)
  const [selectedWorkoutForShare, setSelectedWorkoutForShare] = useState(null)
  const [showWorkoutStartModal, setShowWorkoutStartModal] = useState(false)
  const [showTemplateSelection, setShowTemplateSelection] = useState(false)
  const [todaysScheduledWorkout, setTodaysScheduledWorkout] = useState(null)
  const [metrics, setMetrics] = useState({
    sleepScore: '',
    sleepTime: '',
    hrv: '',
    steps: '',
    caloriesBurned: '',
    weight: ''
  })

  const loadFitnessGoals = async () => {
    if (!user) return
    try {
      const goals = await getActiveGoalsFromSupabase(user.id, 'fitness')
      setFitnessGoals(goals)
    } catch (e) {
      // Silently fail
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
          const todaysScheduled = scheduled?.find(s => s.date === today)
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
  }, [user, location.state])

  // Refresh goals when page becomes visible or when navigating back from Goals page
  useEffect(() => {
    if (!user) return
    loadFitnessGoals()
  }, [user, location.key])

  useEffect(() => {
    if (!user) return
    
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        loadFitnessGoals()
      }
    }
    
    document.addEventListener('visibilitychange', handleVisibilityChange)
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [user])

  const startWorkout = async (templateId, random = false) => {
    if (templateId === null && !random) {
      // Show modal to choose workout type
      setShowWorkoutStartModal(true)
      return
    }
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

  const loadWorkoutHistory = async () => {
    if (!user) return
    try {
      const workouts = await getWorkoutsFromSupabase(user.id)
      setWorkoutHistory(workouts)
    } catch (e) {
      // Silently fail
    }
  }

  const startRandomWorkout = async () => {
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Generate a random full-body workout for me' }]
        })
      })
      if (response.ok) {
        const data = await response.json()
        if (data.workout) {
          setAiWorkout(data.workout)
          localStorage.setItem('aiWorkout', JSON.stringify(data.workout))
          navigate('/workout/active', { state: { aiWorkout: data.workout } })
          return
        }
      }
    } catch (e) {
      alert('Failed to generate workout. Please try again.')
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
          <button
            key={tab}
            className={`${styles.tab} ${activeTab === tab ? styles.activeTab : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className={styles.content}>
        {activeTab === 'Workout' && (
          <div>
            {/* Start Workout Button */}
            <button
              className={styles.startWorkoutBtn}
              onClick={() => setShowWorkoutStartModal(true)}
            >
              Start Workout
            </button>

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
                          <button
                            className={styles.workoutTypeBtn}
                            onClick={() => handleWorkoutTypeSelect('scheduled')}
                          >
                            Today's Scheduled Workout
                            <span className={styles.workoutTypeSubtext}>
                              {templates.find(t => t.id === todaysScheduledWorkout.template_id)?.name || 'Scheduled'}
                            </span>
                          </button>
                        )}
                        <button
                          className={styles.workoutTypeBtn}
                          onClick={() => handleWorkoutTypeSelect('templates')}
                        >
                          Choose Template
                        </button>
                        <button
                          className={styles.workoutTypeBtn}
                          onClick={() => handleWorkoutTypeSelect('freestyle')}
                        >
                          Freestyle
                        </button>
                        <button
                          className={styles.workoutTypeBtn}
                          onClick={() => handleWorkoutTypeSelect('random')}
                        >
                          Random Workout
                        </button>
                      </div>
                      <button
                        className={styles.closeModalBtn}
                        onClick={() => {
                          setShowWorkoutStartModal(false)
                          setShowTemplateSelection(false)
                        }}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <div className={styles.modalHeader}>
                        <button
                          className={styles.backBtn}
                          onClick={() => setShowTemplateSelection(false)}
                        >
                          ← Back
                        </button>
                        <h3>Choose Template</h3>
                        <button
                          className={styles.closeModalBtn}
                          onClick={() => {
                            setShowWorkoutStartModal(false)
                            setShowTemplateSelection(false)
                          }}
                        >
                          ✕
                        </button>
                      </div>
                      <div className={styles.templateSelectionList}>
                        {templates.length === 0 ? (
                          <p className={styles.emptyText}>No templates available. Create one in the Templates tab.</p>
                        ) : (
                          templates.map(template => (
                            <button
                              key={template.id}
                              className={styles.templateSelectionBtn}
                              onClick={() => {
                                setShowWorkoutStartModal(false)
                                setShowTemplateSelection(false)
                                startWorkout(template.id, false)
                              }}
                            >
                              <span className={styles.templateName}>{template.name}</span>
                              <span className={styles.templateCount}>{template.exercises?.length || 0} exercises</span>
                            </button>
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
                  <button 
                    className={styles.startPlanBtn}
                    onClick={() => startWorkout(`plan-${todaysPlan.focus}`)}
                  >
                    Start {todaysPlan.focus} Workout
                  </button>
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
                    <button 
                      className={styles.clearAiBtn}
                      onClick={() => {
                        setAiWorkout(null)
                        localStorage.removeItem('aiWorkout')
                      }}
                    >
                      Clear
                    </button>
                  </div>
                  <div className={styles.aiWorkoutExercises}>
                    {aiWorkout.exercises?.map((ex, i) => (
                      <span key={i} className={styles.aiWorkoutExercise}>
                        {ex.name}: {ex.sets}x{ex.reps}
                      </span>
                    ))}
                  </div>
                  <button 
                    className={styles.startAiBtn}
                    onClick={() => navigate('/workout/active', { state: { aiWorkout } })}
                  >
                    Start AI Workout
                  </button>
                </div>
              </section>
            )}
          </div>
        )}

        {activeTab === 'Templates' && (
          <div>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Templates</h2>
              <button
                className={styles.manageBtn}
                onClick={() => setShowTemplateEditor(true)}
              >
                Manage
              </button>
            </div>
            
            <div className={styles.templateList}>
              {templates.map(template => (
                <div key={template.id} className={styles.templateItem}>
                  <button
                    className={styles.templateBtn}
                    onClick={() => {
                      setActiveTab('Workout')
                      startWorkout(template.id, false)
                    }}
                  >
                    <span className={styles.templateName}>{template.name}</span>
                    <span className={styles.templateCount}>{template.exercises.length} exercises</span>
                  </button>
                  <div className={styles.templateActions}>
                    <button
                      className={styles.editTemplateBtn}
                      onClick={() => {
                        setEditingTemplate(template)
                        setShowTemplateEditor(true)
                      }}
                      title="Edit template"
                    >
                      Edit
                    </button>
                    <button
                      className={styles.deleteTemplateBtn}
                      onClick={async () => {
                        if (confirm(`Delete template "${template.name}"?`)) {
                          try {
                            await deleteTemplate(template.id)
                            const updated = await getAllTemplates()
                            setTemplates(updated)
                            showToast('Template deleted', 'success')
                          } catch (e) {
                            logError('Error deleting template', e)
                            showToast('Failed to delete template', 'error')
                          }
                        }
                      }}
                      title="Delete template"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
              
              <button
                className={styles.freestyleBtn}
                onClick={() => {
                  setActiveTab('Workout')
                  startWorkout(null, false)
                }}
              >
                Freestyle Workout
              </button>

              <button
                className={styles.randomBtn}
                onClick={() => {
                  setActiveTab('Workout')
                  startRandomWorkout()
                }}
              >
                Random Workout
              </button>
            </div>
          </div>
        )}

        {activeTab === 'History' && (
          <div className={styles.historyContent}>
            <h2 className={styles.sectionTitle}>Workout History</h2>
            <div className={styles.historyTable}>
              <div className={styles.historyTableHeader}>
                <div className={styles.historyTableCol}>Date</div>
                <div className={styles.historyTableCol}>Duration</div>
                <div className={styles.historyTableCol}>Exercises</div>
                <div className={styles.historyTableCol}>Calories</div>
                <div className={styles.historyTableCol}>Actions</div>
              </div>
              <div className={styles.historyTableBody}>
                {workoutHistory.length === 0 ? (
                  <div className={styles.historyTableEmpty}>No workouts yet</div>
                ) : (
                  workoutHistory
                    .sort((a, b) => b.date.localeCompare(a.date))
                    .map(workout => (
                      <div key={workout.id} className={styles.historyTableRow}>
                        <div className={styles.historyTableCol}>
                          {new Date(workout.date + 'T12:00:00').toLocaleDateString('en-US', { 
                            month: 'short', 
                            day: 'numeric',
                            year: 'numeric'
                          })}
                        </div>
                        <div className={styles.historyTableCol}>
                          {workout.duration 
                            ? `${Math.floor((workout.duration || 0) / 60)}:${String((workout.duration || 0) % 60).padStart(2, '0')}`
                            : 'N/A'}
                        </div>
                        <div className={styles.historyTableCol}>
                          {workout.workout_exercises?.length || 0}
                        </div>
                        <div className={styles.historyTableCol}>
                          {workout.calories_burned || workout.calories || 'N/A'}
                        </div>
                        <div className={`${styles.historyTableCol} ${styles.actionsCol}`}>
                          <button
                            className={styles.shareBtn}
                            onClick={(e) => {
                              e.stopPropagation()
                              setSelectedWorkoutForShare(workout)
                              setShowShareModal(true)
                            }}
                          >
                            Share
                          </button>
                          <button
                            className={styles.deleteBtn}
                            onClick={async (e) => {
                              e.stopPropagation()
                              if (confirm(`Delete workout from ${workout.date}?`)) {
                                try {
                                  await deleteWorkoutFromSupabase(workout.id, user.id)
                                  await loadWorkoutHistory()
                                  showToast('Workout deleted', 'success')
                                } catch (error) {
                                  console.error('Error deleting workout:', error)
                                  showToast('Failed to delete workout', 'error')
                                }
                              }
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'Goals' && (
          <div>
            <h2 className={styles.sectionTitle}>Fitness Goals</h2>
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
                            {goal.custom_name || goal.type}
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
            <button
              className={styles.goalsBtn}
              onClick={() => navigate('/goals')}
            >
              View All Goals
            </button>
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
              if (confirm('Delete this template?')) {
                await deleteTemplate(id)
                const updated = await getAllTemplates()
                setTemplates(updated)
                if (editingTemplate?.id === id) {
                  setEditingTemplate(null)
                }
              }
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

      {/* Share Modal */}
      {showShareModal && selectedWorkoutForShare && (() => {
        // Transform workout data from database format to ShareCard format
        const exercises = (selectedWorkoutForShare.workout_exercises || []).map(ex => ({
          name: ex.exercise_name,
          sets: (ex.workout_sets || []).map(set => ({
            weight: set.weight,
            reps: set.reps,
            time: set.time,
            speed: set.speed,
            incline: set.incline
          }))
        }))
        
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
                notes: selectedWorkoutForShare.notes
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

