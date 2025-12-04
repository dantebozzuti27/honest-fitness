import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { getAllTemplates, saveTemplate, deleteTemplate } from '../db'
import { saveMetricsToSupabase, getUserPreferences, generateWorkoutPlan, getMetricsFromSupabase, getWorkoutsFromSupabase } from '../lib/supabaseDb'
import { useAuth } from '../context/AuthContext'
import { getTodayEST, getYesterdayEST } from '../utils/dateUtils'
import ExercisePicker from '../components/ExercisePicker'
import TemplateEditor from '../components/TemplateEditor'
import styles from './Fitness.module.css'

export default function Fitness() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const [templates, setTemplates] = useState([])
  const [todaysPlan, setTodaysPlan] = useState(null)
  const [aiWorkout, setAiWorkout] = useState(null)
  const [showTemplateEditor, setShowTemplateEditor] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState(null)
  const [workoutHistory, setWorkoutHistory] = useState([])
  const [showHistory, setShowHistory] = useState(false)
  const [metrics, setMetrics] = useState({
    sleepScore: '',
    sleepTime: '',
    hrv: '',
    steps: '',
    caloriesBurned: '',
    weight: ''
  })

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

    async function load() {
      const t = await getAllTemplates()
      setTemplates(t)
      
      if (user) {
        try {
          // Load workout history
          const workouts = await getWorkoutsFromSupabase(user.id)
          setWorkoutHistory(workouts.slice(0, 10)) // Show last 10 workouts
          
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
            const today = dayNames[new Date().getDay()]
            const todaysWorkout = plan.schedule.find(d => d.day === today && !d.restDay)
            setTodaysPlan(todaysWorkout)
          }
        } catch (e) {
          // Silently fail
        }
      }
    }
    load()
  }, [user, location.state])

  const startWorkout = async (templateId) => {
    navigate('/workout/active', { state: { templateId } })
  }

  const startOutdoorRun = () => {
    // Create a simple outdoor run workout
    const outdoorRunWorkout = {
      name: 'Outdoor Run',
      exercises: [{
        name: 'Outdoor Run',
        bodyPart: 'Cardio',
        sets: [{
          time: 0, // Will track time during workout
          distance: 0,
          calories: 0
        }]
      }]
    }
    navigate('/workout/active', { state: { outdoorRun: true, aiWorkout: outdoorRunWorkout } })
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
      <header className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate('/')}>
          ← Back
        </button>
        <h1 className={styles.title}>Fitness</h1>
      </header>

      <div className={styles.content}>
        {/* Start Workout Section */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Start Workout</h2>
          <div className={styles.actionButtons}>
            <button
              className={styles.primaryBtn}
              onClick={() => startWorkout(null)}
            >
              Start Workout
            </button>
            <button
              className={styles.secondaryBtn}
              onClick={startOutdoorRun}
            >
              Start Outdoor Run
            </button>
          </div>
        </section>

        {/* Goals Section */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Goals</h2>
            <button
              className={styles.linkBtn}
              onClick={() => navigate('/goals')}
            >
              View All →
            </button>
          </div>
          <p className={styles.sectionNote}>Syncs to Goals page</p>
        </section>

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

        {/* Templates Section */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>View Templates</h2>
            <button
              className={styles.manageBtn}
              onClick={() => setShowTemplateEditor(true)}
            >
              Manage
            </button>
          </div>
          
          <div className={styles.templateList}>
            {templates.map(template => (
              <button
                key={template.id}
                className={styles.templateBtn}
                onClick={() => startWorkout(template.id)}
              >
                <span className={styles.templateName}>{template.name}</span>
                <span className={styles.templateCount}>{template.exercises.length} exercises</span>
              </button>
            ))}
            
            <button
              className={styles.freestyleBtn}
              onClick={() => startWorkout(null)}
            >
              Freestyle Workout
            </button>

            <button
              className={styles.randomBtn}
              onClick={startRandomWorkout}
            >
              Random Workout
            </button>
          </div>
        </section>

        {/* Workout History */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Workout History</h2>
            <button
              className={styles.linkBtn}
              onClick={() => setShowHistory(!showHistory)}
            >
              {showHistory ? 'Hide' : 'Show'}
            </button>
          </div>
          {showHistory && (
            <div className={styles.historyList}>
              {workoutHistory.length === 0 ? (
                <p className={styles.emptyText}>No workouts yet</p>
              ) : (
                workoutHistory.map(workout => (
                  <div key={workout.id} className={styles.historyItem}>
                    <div className={styles.historyDate}>
                      {new Date(workout.date + 'T12:00:00').toLocaleDateString('en-US', { 
                        month: 'short', 
                        day: 'numeric',
                        year: 'numeric'
                      })}
                    </div>
                    <div className={styles.historyDetails}>
                      <span className={styles.historyDuration}>
                        {Math.floor((workout.duration || 0) / 60)}:{String((workout.duration || 0) % 60).padStart(2, '0')}
                      </span>
                      {workout.workout_exercises?.length > 0 && (
                        <span className={styles.historyExercises}>
                          {workout.workout_exercises.length} exercises
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </section>

        {/* Template Editor Modal */}
        {showTemplateEditor && (
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
          />
        )}
      </div>
    </div>
  )
}

