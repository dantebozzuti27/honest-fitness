import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getUserPreferences, saveUserPreferences, deleteUserPreferences } from '../lib/db/userPreferencesDb'
import { getWorkoutsFromSupabase } from '../lib/db/workoutsDb'
import { generateWorkoutPlan } from '../lib/workoutPlanning'
import { getAllTemplates } from '../db/lazyDb'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'
import { logError } from '../utils/logger'
import { nonBlocking } from '../utils/nonBlocking'
import { chatWithAI } from '../lib/chatApi'
import ConfirmDialog from '../components/ConfirmDialog'
import BackButton from '../components/BackButton'
import Skeleton from '../components/Skeleton'
import TextAreaField from '../components/TextAreaField'
import Button from '../components/Button'
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

const SPLITS = [
  { id: 'ppl', label: 'Push / Pull / Legs (PPL)' },
  { id: 'upper_lower', label: 'Upper / Lower' },
  { id: 'full_body', label: 'Full Body' },
  { id: 'bro_split', label: 'Body-part split (Bro split)' },
  { id: 'custom', label: 'Custom / Coach' }
]

const PROGRESSION = [
  { id: 'double_progression', label: 'Double progression (reps then weight)' },
  { id: 'linear', label: 'Linear (add weight weekly)' },
  { id: 'rpe', label: 'RPE-based (auto-adjust)' }
]

const MUSCLES = ['Chest', 'Back', 'Shoulders', 'Legs', 'Arms', 'Core']

export default function Planner() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { toast, showToast, hideToast } = useToast()
  const [activeTab, setActiveTab] = useState(0) // 0: My Plan, 1: Create, 2: AI
  const [loading, setLoading] = useState(true)
  const [templates, setTemplates] = useState([])
  const [currentPlan, setCurrentPlan] = useState(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  
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
    injuries: '',
    trainingSplit: 'ppl',
    progressionModel: 'double_progression',
    weeklySetsTargets: { Chest: 12, Back: 12, Shoulders: 10, Legs: 14, Arms: 10, Core: 6 }
  })

  // AI Chat state
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Hey! I can help you create a workout plan, analyze your progress, or answer fitness questions. What would you like to do?' }
  ])
  const [input, setInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [userContext, setUserContext] = useState(null)
  const [generatedWorkout, setGeneratedWorkout] = useState(null)
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
              injuries: existing.injuries || '',
              trainingSplit: existing.training_split || 'ppl',
              progressionModel: existing.progression_model || 'double_progression',
              weeklySetsTargets: (existing.weekly_sets_targets && typeof existing.weekly_sets_targets === 'object')
                ? existing.weekly_sets_targets
                : { Chest: 12, Back: 12, Shoulders: 10, Legs: 14, Arms: 10, Core: 6 }
            })
            // Generate current plan view
            const plan = generateWorkoutPlan({
              fitnessGoal: existing.fitness_goal,
              experienceLevel: existing.experience_level,
              availableDays: existing.available_days || [],
              sessionDuration: existing.session_duration || 60,
              equipmentAvailable: existing.equipment_available || [],
              injuries: existing.injuries,
              trainingSplit: existing.training_split || 'ppl',
              progressionModel: existing.progression_model || 'double_progression',
              weeklySetsTargets: existing.weekly_sets_targets || {}
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
          nonBlocking(Promise.reject(e), { showToast, message: 'Some Planner data failed to load.', level: 'info' })
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
        logError('Error generating plan', e)
        showToast('Failed to generate plan. Please try again.', 'error')
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

  const setWeeklyTarget = (muscle, value) => {
    const n = Number(value)
    const v = Number.isFinite(n) ? Math.max(0, Math.min(40, Math.floor(n))) : 0
    setPrefs(p => ({
      ...p,
      weeklySetsTargets: { ...(p.weeklySetsTargets || {}), [muscle]: v }
    }))
  }

  const handleDeletePlan = async () => {
    setDeleteConfirmOpen(true)
  }

  // AI Chat functions
  const sendMessage = async (directMessage = null) => {
    const messageToSend = directMessage || input.trim()
    if (!messageToSend || chatLoading) return
    
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: String(messageToSend) }])
    setChatLoading(true)

    try {
      let contextMsg = ''
      if (userContext && userContext.totalWorkouts) {
        contextMsg = `User has ${userContext.totalWorkouts} workouts logged.`
      }

      let data
      try {
        data = await chatWithAI({
          context: contextMsg,
          messages: [{ role: 'user', content: String(messageToSend) }]
        })
      } catch (e) {
        data = { message: 'Failed to get response' }
      }

      const replyContent = String(data?.message || data?.error || 'No response received')
      
      if (data?.workout && Array.isArray(data.workout.exercises)) {
        setGeneratedWorkout(data.workout)
        const summary = `Here's your workout: ${data.workout.name || 'Custom Workout'}\n\n` +
          data.workout.exercises.map(ex => `- ${ex.name}: ${ex.sets}x${ex.reps}`).join('\n')
        setMessages(prev => [...prev, { role: 'assistant', content: summary, workout: data.workout }])
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: replyContent }])
      }
    } catch (error) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Connection error. Please try again.' }])
    } finally {
      setChatLoading(false)
    }
  }

  const quickActions = [
    { label: 'Generate Workout', prompt: 'Generate a workout for me' },
    { label: 'Analyze Progress', prompt: 'Analyze my progress' },
    { label: 'Recovery Tips', prompt: 'Give me recovery tips' }
  ]

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading} style={{ width: '100%' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Skeleton style={{ width: '40%', height: 16 }} />
            <Skeleton style={{ width: '100%', height: 120 }} />
            <Skeleton style={{ width: '100%', height: 120 }} />
            <Skeleton style={{ width: '70%', height: 16 }} />
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          duration={toast.duration}
          onClose={hideToast}
        />
      )}
      <ConfirmDialog
        isOpen={deleteConfirmOpen}
        title="Delete plan?"
        message="This will clear your current plan and preferences."
        confirmText="Delete"
        cancelText="Cancel"
        isDestructive
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={async () => {
          try {
            if (user) {
              // Prefer deleting the row entirely to avoid DB constraints rejecting empty strings.
              try {
                await deleteUserPreferences(user.id)
              } catch (e) {
                // Fallback: clear fields via upsert (best-effort).
                await saveUserPreferences(user.id, {
                  planName: '',
                  fitnessGoal: null,
                  experienceLevel: null,
                  availableDays: [],
                  sessionDuration: 60,
                  equipmentAvailable: [],
                  injuries: ''
                })
              }
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
            showToast('Plan deleted', 'success')
          } catch (e) {
            logError('Error deleting plan', e)
            showToast('Failed to delete plan. Please try again.', 'error')
          } finally {
            setDeleteConfirmOpen(false)
          }
        }}
      />
      <div className={styles.container}>
      <header className={styles.header}>
        <BackButton fallbackPath="/progress" />
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
                  <Button
                    unstyled
                    key={eq}
                    className={`${styles.equipBtn} ${prefs.equipmentAvailable.includes(eq) ? styles.selected : ''}`}
                    onClick={() => toggleEquipment(eq)}
                  >
                    {eq}
                  </Button>
                ))}
              </div>
              <TextAreaField
                className={styles.injuryInput}
                placeholder="Any injuries? (optional)"
                value={prefs.injuries}
                onChange={(e) => setPrefs(p => ({ ...p, injuries: e.target.value }))}
                rows={3}
              />

              <div className={styles.planConfig}>
                <h3 className={styles.subhead}>Training split</h3>
                <select
                  className={styles.select}
                  value={prefs.trainingSplit}
                  onChange={(e) => setPrefs(p => ({ ...p, trainingSplit: e.target.value }))}
                >
                  {SPLITS.map(s => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>

                <h3 className={styles.subhead}>Progression model</h3>
                <select
                  className={styles.select}
                  value={prefs.progressionModel}
                  onChange={(e) => setPrefs(p => ({ ...p, progressionModel: e.target.value }))}
                >
                  {PROGRESSION.map(p => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>

                <h3 className={styles.subhead}>Weekly sets targets (per muscle)</h3>
                <div className={styles.targetsGrid}>
                  {MUSCLES.map((m) => (
                    <label key={m} className={styles.targetRow}>
                      <span className={styles.targetLabel}>{m}</span>
                      <input
                        className={styles.targetInput}
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={40}
                        value={Number(prefs.weeklySetsTargets?.[m] ?? 0)}
                        onChange={(e) => setWeeklyTarget(m, e.target.value)}
                      />
                    </label>
                  ))}
                </div>
                <div className={styles.helperText}>
                  Targets are saved to your profile and will be used by future program features and coach plans.
                </div>
              </div>
            </div>
          )}

          <div className={styles.footer}>
            {step > 1 && (
              <Button unstyled className={styles.prevBtn} onClick={() => setStep(step - 1)}>Back</Button>
            )}
            <Button
              unstyled
              className={styles.nextBtn}
              onClick={handleNext}
              disabled={!canProceed() || generating}
            >
              {generating ? 'Creating...' : step === 4 ? 'Create Plan' : 'Next'}
            </Button>
          </div>
        </div>
      )}

      {/* AI Tab */}
      {activeTab === 2 && (
        <div className={styles.aiContainer}>
          <div className={styles.messages}>
            {messages.map((msg, idx) => {
              const content = String(msg?.content || '')
              const lines = content.split('\n')
              return (
                <div key={idx} className={`${styles.message} ${styles[msg?.role || 'assistant']}`}>
                  <div className={styles.messageContent}>
                    {lines.map((line, i) => (
                      <p key={i}>{line || '\u00A0'}</p>
                    ))}
                    {msg?.workout && Array.isArray(msg.workout.exercises) && (
                      <button 
                        className={styles.startWorkoutBtn}
                        onClick={() => navigate('/workout/active', { state: { aiWorkout: msg.workout } })}
                      >
                        Start This Workout
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
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
              onKeyDown={(e) => { if (e.key === 'Enter') sendMessage() }}
              placeholder="Ask me anything..."
              className={styles.input}
            />
            <button className={styles.sendBtn} onClick={() => sendMessage()} disabled={chatLoading || !input.trim()}>
              Send
            </button>
          </div>
        </div>
      )}
    </div>
    </>
  )
}
