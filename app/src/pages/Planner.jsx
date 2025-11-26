import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getUserPreferences, saveUserPreferences, generateWorkoutPlan } from '../lib/supabaseDb'
import { getAllTemplates } from '../db'
import styles from './Planner.module.css'

const GOALS = [
  { id: 'strength', label: 'Build Strength' },
  { id: 'hypertrophy', label: 'Build Muscle' },
  { id: 'endurance', label: 'Improve Endurance' },
  { id: 'weight_loss', label: 'Lose Weight' },
  { id: 'general', label: 'General Fitness' }
]

const EXPERIENCE = [
  { id: 'beginner', label: 'Beginner', desc: 'Less than 1 year' },
  { id: 'intermediate', label: 'Intermediate', desc: '1-3 years' },
  { id: 'advanced', label: 'Advanced', desc: '3+ years' }
]

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

const EQUIPMENT = [
  'Barbell', 'Dumbbells', 'Cables', 'Machines', 'Bodyweight', 'Kettlebell', 'Resistance Bands'
]

export default function Planner() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [templates, setTemplates] = useState([])
  const [generatedPlan, setGeneratedPlan] = useState(null)
  
  const [prefs, setPrefs] = useState({
    planName: '',
    fitnessGoal: '',
    experienceLevel: '',
    availableDays: [],
    sessionDuration: 60,
    equipmentAvailable: [],
    injuries: ''
  })

  useEffect(() => {
    async function load() {
      if (user) {
        try {
          const existing = await getUserPreferences(user.id)
          if (existing) {
            setPrefs({
              planName: existing.plan_name || '',
              fitnessGoal: existing.fitness_goal || '',
              experienceLevel: existing.experience_level || '',
              availableDays: existing.available_days || [],
              sessionDuration: existing.session_duration || 60,
              equipmentAvailable: existing.equipment_available || [],
              injuries: existing.injuries || ''
            })
          }
        } catch (e) {
          console.error('Error loading preferences:', e)
        }
      }
      const t = await getAllTemplates()
      setTemplates(t)
      setLoading(false)
    }
    load()
  }, [user])

  const toggleDay = (day) => {
    setPrefs(p => ({
      ...p,
      availableDays: p.availableDays.includes(day)
        ? p.availableDays.filter(d => d !== day)
        : [...p.availableDays, day]
    }))
  }

  const toggleEquipment = (eq) => {
    setPrefs(p => ({
      ...p,
      equipmentAvailable: p.equipmentAvailable.includes(eq)
        ? p.equipmentAvailable.filter(e => e !== eq)
        : [...p.equipmentAvailable, eq]
    }))
  }

  const handleNext = async () => {
    if (step < 4) {
      setStep(step + 1)
    } else {
      // Save preferences and generate plan
      setGenerating(true)
      try {
        if (user) {
          await saveUserPreferences(user.id, prefs)
        }
        const plan = generateWorkoutPlan(prefs, templates)
        setGeneratedPlan(plan)
        setStep(5)
      } catch (e) {
        console.error('Error generating plan:', e)
        alert('Failed to generate plan')
      }
      setGenerating(false)
    }
  }

  const canProceed = () => {
    switch (step) {
      case 1: return prefs.fitnessGoal !== ''
      case 2: return prefs.experienceLevel !== ''
      case 3: return prefs.availableDays.length > 0
      case 4: return true
      default: return false
    }
  }

  const handleDeletePlan = async () => {
    if (!confirm('Are you sure you want to delete this plan?')) return
    try {
      if (user) {
        await saveUserPreferences(user.id, {
          planName: '',
          fitnessGoal: '',
          experienceLevel: '',
          availableDays: [],
          sessionDuration: 60,
          equipmentAvailable: [],
          injuries: ''
        })
      }
      setPrefs({
        planName: '',
        fitnessGoal: '',
        experienceLevel: '',
        availableDays: [],
        sessionDuration: 60,
        equipmentAvailable: [],
        injuries: ''
      })
      setGeneratedPlan(null)
      setStep(1)
    } catch (e) {
      console.error('Error deleting plan:', e)
    }
  }

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading...</div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate('/')}>
          ← Back
        </button>
        <h1 className={styles.title}>Workout Planner</h1>
        <div className={styles.stepIndicator}>{step}/5</div>
      </header>

      <div className={styles.content}>
        {step === 1 && (
          <div className={styles.stepContent}>
            <h2>Name Your Plan</h2>
            <p className={styles.stepDesc}>Give your workout plan a name</p>
            
            <input
              type="text"
              className={styles.planNameInput}
              placeholder="e.g., Summer Shred, Strength Builder..."
              value={prefs.planName}
              onChange={(e) => setPrefs(p => ({ ...p, planName: e.target.value }))}
            />

            <h2 style={{ marginTop: '28px' }}>What's your main goal?</h2>
            <p className={styles.stepDesc}>This helps us tailor your workouts</p>
            
            <div className={styles.optionGrid}>
              {GOALS.map(goal => (
                <button
                  key={goal.id}
                  className={`${styles.optionCard} ${prefs.fitnessGoal === goal.id ? styles.selected : ''}`}
                  onClick={() => setPrefs(p => ({ ...p, fitnessGoal: goal.id }))}
                >
                  <span className={styles.optionLabel}>{goal.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className={styles.stepContent}>
            <h2>Experience Level</h2>
            <p className={styles.stepDesc}>How long have you been training?</p>
            
            <div className={styles.optionList}>
              {EXPERIENCE.map(exp => (
                <button
                  key={exp.id}
                  className={`${styles.listOption} ${prefs.experienceLevel === exp.id ? styles.selected : ''}`}
                  onClick={() => setPrefs(p => ({ ...p, experienceLevel: exp.id }))}
                >
                  <span className={styles.listLabel}>{exp.label}</span>
                  <span className={styles.listDesc}>{exp.desc}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className={styles.stepContent}>
            <h2>Available Days</h2>
            <p className={styles.stepDesc}>Which days can you work out?</p>
            
            <div className={styles.dayGrid}>
              {DAYS.map(day => (
                <button
                  key={day}
                  className={`${styles.dayBtn} ${prefs.availableDays.includes(day) ? styles.selected : ''}`}
                  onClick={() => toggleDay(day)}
                >
                  {day.slice(0, 3)}
                </button>
              ))}
            </div>

            <div className={styles.durationSection}>
              <label>Session Duration</label>
              <div className={styles.durationBtns}>
                {[30, 45, 60, 75, 90].map(mins => (
                  <button
                    key={mins}
                    className={`${styles.durationBtn} ${prefs.sessionDuration === mins ? styles.selected : ''}`}
                    onClick={() => setPrefs(p => ({ ...p, sessionDuration: mins }))}
                  >
                    {mins}m
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className={styles.stepContent}>
            <h2>Equipment & Limitations</h2>
            <p className={styles.stepDesc}>What do you have access to?</p>
            
            <div className={styles.equipmentGrid}>
              {EQUIPMENT.map(eq => (
                <button
                  key={eq}
                  className={`${styles.equipBtn} ${prefs.equipmentAvailable.includes(eq) ? styles.selected : ''}`}
                  onClick={() => toggleEquipment(eq)}
                >
                  {eq}
                </button>
              ))}
            </div>

            <div className={styles.injurySection}>
              <label>Any injuries or limitations?</label>
              <textarea
                className={styles.injuryInput}
                placeholder="e.g., Bad lower back, recovering from shoulder surgery..."
                value={prefs.injuries}
                onChange={(e) => setPrefs(p => ({ ...p, injuries: e.target.value }))}
              />
            </div>
          </div>
        )}

        {step === 5 && generatedPlan && (
          <div className={styles.stepContent}>
            <h2>Your Workout Plan</h2>
            <p className={styles.stepDesc}>{prefs.planName || GOALS.find(g => g.id === prefs.fitnessGoal)?.label}</p>
            
            <div className={styles.planOverview}>
              <div className={styles.planStat}>
                <span className={styles.planStatNum}>{generatedPlan.daysPerWeek}</span>
                <span className={styles.planStatLabel}>Days/Week</span>
              </div>
              <div className={styles.planStat}>
                <span className={styles.planStatNum}>{prefs.sessionDuration}m</span>
                <span className={styles.planStatLabel}>Per Session</span>
              </div>
            </div>

            <div className={styles.weekPlan}>
              {generatedPlan.schedule.map((day, idx) => (
                <div key={idx} className={styles.planDay}>
                  <div className={styles.planDayHeader}>
                    <span className={styles.planDayName}>{day.day}</span>
                    <span className={styles.planDayType}>{day.focus}</span>
                  </div>
                  {day.exercises && (
                    <div className={styles.planExercises}>
                      {day.exercises.slice(0, 4).map((ex, i) => (
                        <span key={i} className={styles.planExercise}>{ex}</span>
                      ))}
                      {day.exercises.length > 4 && (
                        <span className={styles.planMore}>+{day.exercises.length - 4} more</span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <button 
              className={styles.startPlanBtn}
              onClick={() => navigate('/')}
            >
              Start Training
            </button>
            <button 
              className={styles.deletePlanBtn}
              onClick={handleDeletePlan}
            >
              Delete Plan
            </button>
          </div>
        )}
      </div>

      {step < 5 && (
        <div className={styles.footer}>
          {step > 1 && (
            <button className={styles.prevBtn} onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          <button 
            className={styles.nextBtn} 
            onClick={handleNext}
            disabled={!canProceed() || generating}
          >
            {generating ? 'Generating...' : step === 4 ? 'Generate Plan' : 'Next'}
          </button>
        </div>
      )}
    </div>
  )
}

