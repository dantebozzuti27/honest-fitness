import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useLocation } from 'react-router-dom'
import { getAllTemplates, saveMetrics, saveTemplate, deleteTemplate } from '../db'
import { saveMetricsToSupabase, getUserPreferences, generateWorkoutPlan, getMetricsFromSupabase } from '../lib/supabaseDb'
import { useAuth } from '../context/AuthContext'
import { getTodayEST, getYesterdayEST } from '../utils/dateUtils'
import ExercisePicker from '../components/ExercisePicker'
import TemplateEditor from '../components/TemplateEditor'
import styles from './Workout.module.css'

export default function Workout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const [templates, setTemplates] = useState([])
  const [todaysPlan, setTodaysPlan] = useState(null)
  const [aiWorkout, setAiWorkout] = useState(null)
  const [showTemplateEditor, setShowTemplateEditor] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState(null)
  const [showExercisePicker, setShowExercisePicker] = useState(false)
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
      // Save to localStorage for persistence
      localStorage.setItem('aiWorkout', JSON.stringify(location.state.aiWorkout))
    } else {
      // Load from localStorage
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
      
      // Load user's generated plan
      if (user) {
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
            }, t)
            
            // Find today's workout
            const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
            const today = dayNames[new Date().getDay()]
            const todaysWorkout = plan.schedule.find(d => d.day === today && !d.restDay)
            setTodaysPlan(todaysWorkout)
          }
          
          // Load daily metrics from Supabase (try today first, then yesterday)
          const { getTodayEST } = await import('../utils/dateUtils')
          const today = getTodayEST()
          const yesterday = getYesterdayEST()
          
          // Try to get today's metrics first (from Fitbit sync)
          let metricsData = await getMetricsFromSupabase(user.id, today, today)
          if (!metricsData || metricsData.length === 0) {
            // Fallback to yesterday
            metricsData = await getMetricsFromSupabase(user.id, yesterday, yesterday)
          }
          
          // Also try to get Fitbit data directly
          if (!metricsData || metricsData.length === 0 || !metricsData[0].hrv) {
            try {
              const { getFitbitDaily, getMostRecentFitbitData } = await import('../lib/wearables')
              let fitbitData = await getFitbitDaily(user.id, today)
              if (!fitbitData) {
                fitbitData = await getFitbitDaily(user.id, yesterday)
              }
              if (!fitbitData) {
                fitbitData = await getMostRecentFitbitData(user.id)
              }
              
              if (fitbitData) {
                // Merge Fitbit data into metrics
                const fitbitMetrics = {
                  sleepScore: fitbitData.sleep_efficiency ? String(Math.round(fitbitData.sleep_efficiency)) : '',
                  sleepTime: fitbitData.sleep_duration ? formatSleepTime(fitbitData.sleep_duration) : '',
                  hrv: fitbitData.hrv ? String(Math.round(fitbitData.hrv)) : '',
                  steps: fitbitData.steps ? String(fitbitData.steps) : '',
                  caloriesBurned: fitbitData.calories || fitbitData.active_calories ? String(fitbitData.calories || fitbitData.active_calories) : '',
                  weight: fitbitData.weight ? String(fitbitData.weight) : ''
                }
                
                // Merge with existing metrics (prefer existing if present)
                if (metricsData && metricsData.length > 0) {
                  const existing = metricsData[0]
                  setMetrics({
                    sleepScore: existing.sleep_score ? String(existing.sleep_score) : fitbitMetrics.sleepScore,
                    sleepTime: existing.sleep_time ? formatSleepTime(existing.sleep_time) : fitbitMetrics.sleepTime,
                    hrv: existing.hrv ? String(existing.hrv) : fitbitMetrics.hrv,
                    steps: existing.steps ? String(existing.steps) : fitbitMetrics.steps,
                    caloriesBurned: existing.calories ? String(existing.calories) : fitbitMetrics.caloriesBurned,
                    weight: existing.weight ? String(existing.weight) : fitbitMetrics.weight
                  })
                } else {
                  setMetrics(fitbitMetrics)
                }
                return // Exit early since we have Fitbit data
              }
            } catch (fitbitError) {
              // Fitbit data is optional, continue with metrics data
            }
          }
          
          if (metricsData && metricsData.length > 0) {
            const metricsRecord = metricsData[0]
            setMetrics({
              sleepScore: metricsRecord.sleep_score ? String(metricsRecord.sleep_score) : '',
              sleepTime: metricsRecord.sleep_time ? formatSleepTime(metricsRecord.sleep_time) : '',
              hrv: metricsRecord.hrv ? String(metricsRecord.hrv) : '',
              steps: metricsRecord.steps ? String(metricsRecord.steps) : '',
              caloriesBurned: metricsRecord.calories ? String(metricsRecord.calories) : '',
              weight: metricsRecord.weight ? String(metricsRecord.weight) : ''
            })
          }
        } catch (e) {
          // Silently fail - metrics are optional
        }
      }
    }
    load()
  }, [user, location.state])
  
  // Helper function to format sleep time (minutes to "Xh Ym")
  const formatSleepTime = (minutes) => {
    if (!minutes || isNaN(minutes)) return ''
    const numMinutes = Number(minutes)
    if (isNaN(numMinutes)) return ''
    const hours = Math.floor(numMinutes / 60)
    const mins = Math.round(numMinutes % 60)
    return `${hours}h ${mins}m`
  }

  const handleMetricChange = (field, value) => {
    // Import validation dynamically to avoid circular dependencies
    import('../utils/validation').then(({ validateWeight, validateSteps, validateHRV, validateCalories, validateSleepScore }) => {
      let validatedValue = value
      
      // Validate based on field type
      if (field === 'weight' && value !== '' && value !== null && value !== undefined) {
        const validation = validateWeight(value)
        if (!validation.valid) {
          alert(validation.error)
          return
        }
        validatedValue = validation.value
      } else if (field === 'steps' && value !== '' && value !== null && value !== undefined) {
        const validation = validateSteps(value)
        if (!validation.valid) {
          alert(validation.error)
          return
        }
        validatedValue = validation.value
      } else if (field === 'hrv' && value !== '' && value !== null && value !== undefined) {
        const validation = validateHRV(value)
        if (!validation.valid) {
          alert(validation.error)
          return
        }
        validatedValue = validation.value
      } else if (field === 'caloriesBurned' && value !== '' && value !== null && value !== undefined) {
        const validation = validateCalories(value)
        if (!validation.valid) {
          alert(validation.error)
          return
        }
        validatedValue = validation.value
      } else if (field === 'sleepScore' && value !== '' && value !== null && value !== undefined) {
        const validation = validateSleepScore(value)
        if (!validation.valid) {
          alert(validation.error)
          return
        }
        validatedValue = validation.value
      }
      
      setMetrics(prev => ({ ...prev, [field]: validatedValue }))
    })
  }

  const startWorkout = async (templateId) => {
    // Save metrics to previous day
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]
    const metricsToSave = {}
    if (metrics.sleepScore) metricsToSave.sleepScore = Number(metrics.sleepScore)
    if (metrics.sleepTime) metricsToSave.sleepTime = metrics.sleepTime
    if (metrics.hrv) metricsToSave.hrv = Number(metrics.hrv)
    if (metrics.steps) metricsToSave.steps = Math.round(Number(metrics.steps)) // INTEGER - must be whole number
    if (metrics.caloriesBurned) metricsToSave.caloriesBurned = Number(metrics.caloriesBurned)
    if (metrics.weight) metricsToSave.weight = Number(metrics.weight)
    
    if (Object.keys(metricsToSave).length > 0) {
      await saveMetrics(yesterday, metricsToSave)
      
      // Save to Supabase if logged in
      if (user) {
        try {
          await saveMetricsToSupabase(user.id, yesterday, metricsToSave)
        } catch (err) {
          // Silently fail - metrics will be saved on next attempt
        }
      }
    }

    navigate('/workout/active', { state: { templateId } })
  }

  const startRandomWorkout = async () => {
    // Call LLM to generate random workout
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
    // Fallback to local random
    navigate('/workout/active', { state: { randomWorkout: true } })
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate('/')}>
          Back
        </button>
        <h1>New Workout</h1>
      </div>

      <div className={styles.content}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Daily Metrics</h2>
          <p className={styles.sectionNote}>Logged to previous day</p>
          
          <div className={styles.metricsGrid}>
            <div className={styles.metricItem}>
              <label>Sleep Score</label>
              <input
                type="number"
                placeholder="0-100"
                value={metrics.sleepScore}
                onChange={(e) => handleMetricChange('sleepScore', e.target.value)}
              />
            </div>
            <div className={styles.metricItem}>
              <label>Sleep Time</label>
              <input
                type="text"
                placeholder="7h 30m"
                value={metrics.sleepTime}
                onChange={(e) => handleMetricChange('sleepTime', e.target.value)}
              />
            </div>
            <div className={styles.metricItem}>
              <label>HRV</label>
              <input
                type="number"
                placeholder="ms"
                value={metrics.hrv}
                onChange={(e) => handleMetricChange('hrv', e.target.value)}
              />
            </div>
            <div className={styles.metricItem}>
              <label>Steps</label>
              <input
                type="number"
                placeholder="0"
                value={metrics.steps}
                onChange={(e) => handleMetricChange('steps', e.target.value)}
              />
            </div>
            <div className={styles.metricItem}>
              <label>Calories</label>
              <input
                type="number"
                placeholder="0"
                value={metrics.caloriesBurned}
                onChange={(e) => handleMetricChange('caloriesBurned', e.target.value)}
              />
            </div>
            <div className={styles.metricItem}>
              <label>Weight</label>
              <input
                type="number"
                placeholder="lbs"
                value={metrics.weight}
                onChange={(e) => handleMetricChange('weight', e.target.value)}
              />
            </div>
          </div>
        </section>

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

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Templates</h2>
            <button
              className={styles.manageTemplatesBtn}
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
              onClick={() => startRandomWorkout()}
            >
              Random Workout
            </button>
          </div>
        </section>

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
      </div>
    </div>
  )
}

