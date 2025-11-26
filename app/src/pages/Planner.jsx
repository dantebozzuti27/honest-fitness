import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getUserPreferences, saveUserPreferences, generateWorkoutPlan, getWorkoutsFromSupabase } from '../lib/supabaseDb'
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
  const [activeTab, setActiveTab] = useState(0) // 0: My Plan, 1: Create, 2: AI
  const [loading, setLoading] = useState(true)
  const [templates, setTemplates] = useState([])
  const [currentPlan, setCurrentPlan] = useState(null)
  
  // Create plan state
  const [step, setStep] = useState(1)
  const [generating, setGenerating] = useState(false)
  const [prefs, setPrefs] = useState({
    planName: '',
    fitnessGoal: '',
    experienceLevel: '',
    availableDays: [],
    sessionDuration: 60,
    equipmentAvailable: [],
    injuries: ''
  })

  // AI Chat state
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Hey! I can help you create a workout plan, analyze your progress, or answer fitness questions. What would you like to do?' }
  ])
  const [input, setInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [userContext, setUserContext] = useState(null)
  const messagesEndRef = useRef(null)

  useEffect(() => {
    async function load() {
      if (user) {
        try {
          const existing = await getUserPreferences(user.id)
          if (existing && existing.fitness_goal) {
            setPrefs({
              planName: existing.plan_name || '',
              fitnessGoal: existing.fitness_goal || '',
              experienceLevel: existing.experience_level || '',
              availableDays: existing.available_days || [],
              sessionDuration: existing.session_duration || 60,
              equipmentAvailable: existing.equipment_available || [],
              injuries: existing.injuries || ''
            })
            // Generate current plan view
            const plan = generateWorkoutPlan({
              fitnessGoal: existing.fitness_goal,
              experienceLevel: existing.experience_level,
              availableDays: existing.available_days || [],
              sessionDuration: existing.session_duration || 60,
              equipmentAvailable: existing.equipment_available || [],
              injuries: existing.injuries
            }, [])
            setCurrentPlan({ ...plan, name: existing.plan_name })
          }
          
          // Load context for AI
          const workouts = await getWorkoutsFromSupabase(user.id)
          const bodyPartCounts = {}
          const exerciseCounts = {}
          workouts.forEach(w => {
            w.workout_exercises?.forEach(ex => {
              bodyPartCounts[ex.body_part] = (bodyPartCounts[ex.body_part] || 0) + 1
              exerciseCounts[ex.exercise_name] = (exerciseCounts[ex.exercise_name] || 0) + 1
            })
          })
          setUserContext({
            totalWorkouts: workouts.length,
            topBodyParts: Object.entries(bodyPartCounts).sort((a,b) => b[1]-a[1]).slice(0,5).map(([bp]) => bp),
            topExercises: Object.entries(exerciseCounts).sort((a,b) => b[1]-a[1]).slice(0,10).map(([ex]) => ex),
            preferences: existing
          })
        } catch (e) {
          console.error('Error loading:', e)
        }
      }
      const t = await getAllTemplates()
      setTemplates(t)
      setLoading(false)
    }
    load()
  }, [user])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Plan creation functions
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
      setGenerating(true)
      try {
        if (user) {
          await saveUserPreferences(user.id, prefs)
        }
        const plan = generateWorkoutPlan(prefs, templates)
        setCurrentPlan({ ...plan, name: prefs.planName })
        setActiveTab(0)
        setStep(1)
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
      setCurrentPlan(null)
    } catch (e) {
      console.error('Error deleting plan:', e)
    }
  }

  // AI Chat functions
  const sendMessage = async (directMessage = null) => {
    const messageToSend = directMessage || input.trim()
    if (!messageToSend || chatLoading) return
    
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: messageToSend }])
    setChatLoading(true)

    try {
      // Build context
      let contextMsg = ''
      if (userContext) {
        contextMsg = `User has ${userContext.totalWorkouts} workouts logged. `
        if (userContext.topBodyParts.length) contextMsg += `Most trained: ${userContext.topBodyParts.slice(0,3).join(', ')}. `
        if (prefs.fitnessGoal) contextMsg += `Goal: ${prefs.fitnessGoal}. `
      }

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            ...(contextMsg ? [{ role: 'system', content: contextMsg }] : []),
            ...messages.slice(1).map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content: messageToSend }
          ]
        })
      })

      if (response.ok) {
        const data = await response.json()
        setMessages(prev => [...prev, { role: 'assistant', content: data.message }])
      } else {
        throw new Error('API error')
      }
    } catch (error) {
      // Fallback to local response
      const fallback = getFallbackResponse(messageToSend, userContext, prefs)
      setMessages(prev => [...prev, { role: 'assistant', content: fallback }])
    }
    setChatLoading(false)
  }

  const getFallbackResponse = (message, context, currentPrefs) => {
    const lower = message.toLowerCase()
    
    if (lower.includes('workout') && (lower.includes('generate') || lower.includes('create') || lower.includes('suggest'))) {
      if (currentPrefs?.fitnessGoal) {
        const goal = currentPrefs.fitnessGoal
        let workout = 'Based on your profile, here\'s a workout:\n\n'
        if (goal === 'strength' || goal === 'hypertrophy') {
          workout += 'Push Day:\n- Bench Press: 4x8-10\n- Overhead Press: 3x10\n- Incline DB Press: 3x12\n- Tricep Extensions: 3x15\n- Lateral Raises: 3x15'
        } else if (goal === 'weight_loss') {
          workout += 'Full Body Circuit:\n- Goblet Squats: 3x15\n- Push-ups: 3x12\n- Rows: 3x12\n- Lunges: 3x10 each\n- Planks: 3x30s'
        } else {
          workout += 'Balanced Workout:\n- Squats: 3x12\n- Bench Press: 3x10\n- Rows: 3x10\n- Shoulder Press: 3x12\n- Core: 3x15'
        }
        return workout
      }
      return 'Go to the "Create" tab to set up your goals first, then I can generate personalized workouts!'
    }
    
    if (lower.includes('progress') || lower.includes('analyze')) {
      if (context && context.totalWorkouts > 0) {
        return `Your stats:\n- ${context.totalWorkouts} workouts logged\n- Most trained: ${context.topBodyParts.slice(0,3).join(', ')}\n- Top exercises: ${context.topExercises.slice(0,3).join(', ')}\n\nKeep it up!`
      }
      return 'Log some workouts first, then I can analyze your progress!'
    }
    
    if (lower.includes('goal') || lower.includes('plan')) {
      return 'Common goals:\n- Build Strength: Heavy weights, 4-6 reps\n- Build Muscle: Moderate weight, 8-12 reps\n- Lose Weight: Circuit training + cardio\n- Endurance: Higher reps, shorter rest\n\nGo to "Create" tab to set your goal!'
    }
    
    return 'I can help with:\n- "Generate a workout"\n- "Analyze my progress"\n- "Tips for [goal]"\n\nWhat would you like?'
  }

  const quickActions = [
    { label: 'Generate Workout', prompt: 'Generate a workout for me' },
    { label: 'Analyze Progress', prompt: 'Analyze my progress' },
    { label: 'Recovery Tips', prompt: 'Give me recovery tips' }
  ]

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
        <h1 className={styles.title}>Plan</h1>
      </header>

      <div className={styles.tabs}>
        <button 
          className={`${styles.tab} ${activeTab === 0 ? styles.activeTab : ''}`}
          onClick={() => setActiveTab(0)}
        >
          My Plan
        </button>
        <button 
          className={`${styles.tab} ${activeTab === 1 ? styles.activeTab : ''}`}
          onClick={() => setActiveTab(1)}
        >
          Create
        </button>
        <button 
          className={`${styles.tab} ${activeTab === 2 ? styles.activeTab : ''}`}
          onClick={() => setActiveTab(2)}
        >
          AI
        </button>
      </div>

      {/* My Plan Tab */}
      {activeTab === 0 && (
        <div className={styles.content}>
          {currentPlan ? (
            <div className={styles.planView}>
              <div className={styles.planHeader}>
                <h2>{currentPlan.name || 'My Workout Plan'}</h2>
                <span className={styles.planMeta}>{currentPlan.daysPerWeek} days/week</span>
              </div>
              
              <div className={styles.weekPlan}>
                {currentPlan.schedule.map((day, idx) => (
                  <div key={idx} className={`${styles.planDay} ${day.restDay ? styles.restDay : ''}`}>
                    <div className={styles.planDayHeader}>
                      <span className={styles.planDayName}>{day.day}</span>
                      <span className={styles.planDayType}>{day.focus}</span>
                    </div>
                    {day.exercises && (
                      <div className={styles.planExercises}>
                        {day.exercises.map((ex, i) => (
                          <span key={i} className={styles.planExercise}>{ex}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className={styles.planActions}>
                <button className={styles.editPlanBtn} onClick={() => setActiveTab(1)}>
                  Edit Plan
                </button>
                <button className={styles.deletePlanBtn} onClick={handleDeletePlan}>
                  Delete Plan
                </button>
              </div>
            </div>
          ) : (
            <div className={styles.noPlan}>
              <p>No plan created yet</p>
              <button className={styles.createBtn} onClick={() => setActiveTab(1)}>
                Create Your Plan
              </button>
            </div>
          )}
        </div>
      )}

      {/* Create Tab */}
      {activeTab === 1 && (
        <div className={styles.content}>
          <div className={styles.stepIndicator}>Step {step} of 4</div>
          
          {step === 1 && (
            <div className={styles.stepContent}>
              <h2>Name & Goal</h2>
              <input
                type="text"
                className={styles.planNameInput}
                placeholder="Plan name (optional)"
                value={prefs.planName}
                onChange={(e) => setPrefs(p => ({ ...p, planName: e.target.value }))}
              />
              <div className={styles.optionGrid}>
                {GOALS.map(goal => (
                  <button
                    key={goal.id}
                    className={`${styles.optionCard} ${prefs.fitnessGoal === goal.id ? styles.selected : ''}`}
                    onClick={() => setPrefs(p => ({ ...p, fitnessGoal: goal.id }))}
                  >
                    {goal.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className={styles.stepContent}>
              <h2>Experience</h2>
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
              <h2>Schedule</h2>
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
                <label>Duration</label>
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
              <h2>Equipment</h2>
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
              <textarea
                className={styles.injuryInput}
                placeholder="Any injuries? (optional)"
                value={prefs.injuries}
                onChange={(e) => setPrefs(p => ({ ...p, injuries: e.target.value }))}
              />
            </div>
          )}

          <div className={styles.footer}>
            {step > 1 && (
              <button className={styles.prevBtn} onClick={() => setStep(step - 1)}>Back</button>
            )}
            <button 
              className={styles.nextBtn} 
              onClick={handleNext}
              disabled={!canProceed() || generating}
            >
              {generating ? 'Creating...' : step === 4 ? 'Create Plan' : 'Next'}
            </button>
          </div>
        </div>
      )}

      {/* AI Tab */}
      {activeTab === 2 && (
        <div className={styles.aiContainer}>
          <div className={styles.messages}>
            {messages.map((msg, idx) => (
              <div key={idx} className={`${styles.message} ${styles[msg.role]}`}>
                <div className={styles.messageContent}>
                  {msg.content.split('\n').map((line, i) => (
                    <p key={i}>{line}</p>
                  ))}
                </div>
              </div>
            ))}
            {chatLoading && (
              <div className={`${styles.message} ${styles.assistant}`}>
                <div className={styles.messageContent}>
                  <div className={styles.typing}><span></span><span></span><span></span></div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {messages.length === 1 && (
            <div className={styles.quickActions}>
              {quickActions.map((action, idx) => (
                <button
                  key={idx}
                  className={styles.quickAction}
                  onClick={() => sendMessage(action.prompt)}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}

          <div className={styles.inputArea}>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
              placeholder="Ask me anything..."
              className={styles.input}
            />
            <button className={styles.sendBtn} onClick={sendMessage} disabled={chatLoading || !input.trim()}>
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
