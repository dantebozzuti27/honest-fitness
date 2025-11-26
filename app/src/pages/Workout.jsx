import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAllTemplates, saveMetrics } from '../db'
import { saveMetricsToSupabase, getUserPreferences, generateWorkoutPlan } from '../lib/supabaseDb'
import { useAuth } from '../context/AuthContext'
import { getTodayEST } from '../utils/dateUtils'
import styles from './Workout.module.css'

export default function Workout() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [templates, setTemplates] = useState([])
  const [todaysPlan, setTodaysPlan] = useState(null)
  const [metrics, setMetrics] = useState({
    sleepScore: '',
    sleepTime: '',
    hrv: '',
    steps: '',
    caloriesBurned: '',
    weight: ''
  })

  useEffect(() => {
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
        } catch (e) {
          console.error('Error loading plan:', e)
        }
      }
    }
    load()
  }, [user])

  const handleMetricChange = (field, value) => {
    setMetrics(prev => ({ ...prev, [field]: value }))
  }

  const startWorkout = async (templateId) => {
    // Save metrics to previous day
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]
    const metricsToSave = {}
    if (metrics.sleepScore) metricsToSave.sleepScore = Number(metrics.sleepScore)
    if (metrics.sleepTime) metricsToSave.sleepTime = metrics.sleepTime
    if (metrics.hrv) metricsToSave.hrv = Number(metrics.hrv)
    if (metrics.steps) metricsToSave.steps = Number(metrics.steps)
    if (metrics.caloriesBurned) metricsToSave.caloriesBurned = Number(metrics.caloriesBurned)
    if (metrics.weight) metricsToSave.weight = Number(metrics.weight)
    
    if (Object.keys(metricsToSave).length > 0) {
      await saveMetrics(yesterday, metricsToSave)
      
      // Save to Supabase if logged in
      if (user) {
        try {
          await saveMetricsToSupabase(user.id, yesterday, metricsToSave)
        } catch (err) {
          console.error('Error saving metrics to Supabase:', err)
        }
      }
    }

    navigate('/workout/active', { state: { templateId } })
  }

  const startRandomWorkout = () => {
    navigate('/workout/active', { state: { randomWorkout: true } })
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate('/')}>
          ← Back
        </button>
        <h1 className={styles.title}>New Workout</h1>
      </header>

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
          <h2 className={styles.sectionTitle}>Templates</h2>
          
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
      </div>
    </div>
  )
}

