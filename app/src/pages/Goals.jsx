import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  getGoalsFromSupabase,
  getActiveGoalsFromSupabase,
  saveGoalToSupabase,
  archiveGoal,
  deleteGoalFromSupabase
} from '../lib/goalsDb'
import { getWorkoutsFromSupabase } from '../lib/supabaseDb'
import { getNutritionRangeFromSupabase } from '../lib/nutritionDb'
import { getMetricsFromSupabase } from '../lib/supabaseDb'
import { getTodayEST, getYesterdayEST } from '../utils/dateUtils'
import { logError } from '../utils/logger'
import BottomNav from '../components/BottomNav'
import SideMenu from '../components/SideMenu'
import HomeButton from '../components/HomeButton'
import styles from './Goals.module.css'

const GOAL_CATEGORIES = ['fitness', 'health', 'nutrition']
const FITNESS_GOAL_TYPES = [
  { type: 'workouts_per_week', label: 'Workouts per Week', unit: 'workouts' },
  { type: 'total_volume', label: 'Total Volume', unit: 'lbs' },
  { type: 'body_weight', label: 'Body Weight', unit: 'lbs' },
  { type: 'body_fat', label: 'Body Fat %', unit: '%' }
]
const HEALTH_GOAL_TYPES = [
  { type: 'steps', label: 'Daily Steps', unit: 'steps' },
  { type: 'sleep_hours', label: 'Sleep Hours', unit: 'hours' },
  { type: 'hrv', label: 'HRV', unit: 'ms' },
  { type: 'calories_burned', label: 'Calories Burned', unit: 'calories' }
]
const NUTRITION_GOAL_TYPES = [
  { type: 'calories', label: 'Daily Calories', unit: 'calories' },
  { type: 'protein', label: 'Daily Protein', unit: 'g' },
  { type: 'carbs', label: 'Daily Carbs', unit: 'g' },
  { type: 'fat', label: 'Daily Fat', unit: 'g' }
]

export default function Goals() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [activeCategory, setActiveCategory] = useState('fitness')
  const [goals, setGoals] = useState({ fitness: [], health: [], nutrition: [] })
  const [allGoals, setAllGoals] = useState([])
  const [pastGoals, setPastGoals] = useState([])
  const [showNewGoal, setShowNewGoal] = useState(false)
  const [showAnalyze, setShowAnalyze] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisResult, setAnalysisResult] = useState(null)
  const [newGoal, setNewGoal] = useState({
    category: 'fitness',
    type: '',
    customName: '',
    targetValue: '',
    unit: '',
    startDate: getTodayEST(),
    endDate: '',
    description: ''
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (user) {
      loadGoals()
    }
  }, [user])

  const loadGoals = async () => {
    if (!user) return
    setLoading(true)
    try {
      const [activeGoals, allGoals] = await Promise.all([
        getActiveGoalsFromSupabase(user.id),
        getGoalsFromSupabase(user.id, { status: 'archived' })
      ])

      // Group by category
      const grouped = { fitness: [], health: [], nutrition: [] }
      activeGoals.forEach(goal => {
        if (grouped[goal.category]) {
          grouped[goal.category].push(goal)
        }
      })
      setGoals(grouped)
      setAllGoals(activeGoals)
      setPastGoals(allGoals)
    } catch (error) {
      logError('Error loading goals', error)
    } finally {
      setLoading(false)
    }
  }

  const getGoalTypes = (category) => {
    switch (category) {
      case 'fitness':
        return FITNESS_GOAL_TYPES
      case 'health':
        return HEALTH_GOAL_TYPES
      case 'nutrition':
        return NUTRITION_GOAL_TYPES
      default:
        return []
    }
  }

  const handleCreateGoal = async () => {
    if (!user) return
    if (!newGoal.type) {
      alert('Please select a goal type')
      return
    }
    if (!newGoal.targetValue) {
      alert('Please enter a target value')
      return
    }

    try {
      const goalData = {
        category: newGoal.category,
        type: newGoal.category === 'custom' ? 'custom' : newGoal.type,
        customName: newGoal.category === 'custom' ? newGoal.customName : null,
        targetValue: Number(newGoal.targetValue),
        unit: newGoal.unit || getGoalTypes(newGoal.category).find(t => t.type === newGoal.type)?.unit || '',
        startDate: newGoal.startDate,
        endDate: newGoal.endDate || null,
        description: newGoal.description,
        status: 'active'
      }

      await saveGoalToSupabase(user.id, goalData)
      await loadGoals()
      setShowNewGoal(false)
      setNewGoal({
        category: 'fitness',
        type: '',
        customName: '',
        targetValue: '',
        unit: '',
        startDate: getTodayEST(),
        endDate: '',
        description: ''
      })
    } catch (error) {
      alert('Failed to create goal. Please try again.')
    }
  }

  const handleAnalyzeGoals = async () => {
    if (!user) return
    setAnalyzing(true)
    setAnalysisResult(null)

    try {
      // Get last 7 days of data for each category
      const today = getTodayEST()
      const sevenDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      
      // Get fitness data (workouts)
      const allWorkouts = await getWorkoutsFromSupabase(user.id)
      const last7DaysWorkouts = allWorkouts.filter(w => w.date >= sevenDaysAgo && w.date <= today)
      const uniqueWorkoutDates = [...new Set(last7DaysWorkouts.map(w => w.date))]
      
      // Get nutrition data
      const nutritionData = await getNutritionRangeFromSupabase(user.id, sevenDaysAgo, today)
      const uniqueNutritionDates = [...new Set(nutritionData.map(n => n.date))]
      
      // Get health metrics data
      const healthMetrics = await getMetricsFromSupabase(user.id, sevenDaysAgo, today)
      const uniqueHealthDates = [...new Set(healthMetrics.map(m => m.date))]
      
      // Check if we have at least 7 days of data for each category
      const missingData = []
      if (uniqueWorkoutDates.length < 7) {
        missingData.push(`Fitness (${uniqueWorkoutDates.length}/7 days)`)
      }
      if (uniqueNutritionDates.length < 7) {
        missingData.push(`Nutrition (${uniqueNutritionDates.length}/7 days)`)
      }
      if (uniqueHealthDates.length < 7) {
        missingData.push(`Health (${uniqueHealthDates.length}/7 days)`)
      }
      
      if (missingData.length > 0) {
        setAnalysisResult(`You need at least 7 days of data for each category to get a full analysis.\n\nMissing data:\n${missingData.join('\n')}\n\nPlease log more data and try again.`)
        setAnalyzing(false)
        return
      }
      
      // Prepare comprehensive data for analysis
      const analysisData = {
        fitness: {
          workouts: last7DaysWorkouts.map(w => ({
            date: w.date,
            exercises: w.workout_exercises?.map(ex => ({
              name: ex.exercise_name,
              bodyPart: ex.body_part,
              sets: ex.workout_sets?.length || 0,
              totalVolume: ex.workout_sets?.reduce((sum, s) => sum + ((s.weight || 0) * (s.reps || 0)), 0) || 0
            })) || []
          })),
          totalWorkouts: uniqueWorkoutDates.length,
          uniqueDates: uniqueWorkoutDates
        },
        nutrition: {
          dailyData: nutritionData.map(n => ({
            date: n.date,
            calories: n.calories,
            protein: n.macros?.protein || 0,
            carbs: n.macros?.carbs || 0,
            fat: n.macros?.fat || 0,
            meals: n.meals?.length || 0,
            water: n.water || 0
          })),
          totalDays: uniqueNutritionDates.length,
          uniqueDates: uniqueNutritionDates
        },
        health: {
          dailyData: healthMetrics.map(m => ({
            date: m.date,
            steps: m.steps,
            calories_burned: m.calories_burned || m.calories,
            sleep_time: m.sleep_time,
            sleep_score: m.sleep_score,
            hrv: m.hrv,
            weight: m.weight
          })),
          totalDays: uniqueHealthDates.length,
          uniqueDates: uniqueHealthDates
        },
        goals: (await getActiveGoalsFromSupabase(user.id)).map(g => ({
          category: g.category,
          type: g.type || g.custom_name,
          target: g.target_value,
          current: g.current_value,
          unit: g.unit
        }))
      }

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{
            role: 'user',
            content: `As a comprehensive health and fitness analyst, analyze my complete health picture from the last 7 days. Provide a detailed analysis covering fitness, nutrition, and health metrics. Here's my complete data: ${JSON.stringify(analysisData, null, 2)}`
          }]
        })
      })

      if (response.ok) {
        const data = await response.json()
        setAnalysisResult(data.response || data.message || 'Analysis complete')
      } else {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || errorData.message || 'Analysis failed')
      }
    } catch (error) {
      setAnalysisResult(`Failed to analyze: ${error.message || 'Unknown error'}`)
    } finally {
      setAnalyzing(false)
    }
  }

  const handleArchiveGoal = async (goalId) => {
    if (!user) return
    if (!confirm('Archive this goal?')) return

    try {
      await archiveGoal(user.id, goalId)
      await loadGoals()
    } catch (error) {
      alert('Failed to archive goal. Please try again.')
    }
  }

  const handleDeleteGoal = async (goalId) => {
    if (!user) return
    if (!confirm('Delete this goal permanently?')) return

    try {
      await deleteGoalFromSupabase(user.id, goalId)
      await loadGoals()
    } catch (error) {
      alert('Failed to delete goal. Please try again.')
    }
  }

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading goals...</div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <SideMenu />
        <h1 className={styles.title}>Goals</h1>
        <HomeButton />
      </header>

      <div className={styles.content}>
        {/* Category Filter - Top of Page */}
        <div className={styles.categoryTabs}>
          {GOAL_CATEGORIES.map(cat => (
            <button
              key={cat}
              className={`${styles.categoryTab} ${activeCategory === cat ? styles.active : ''}`}
              onClick={() => setActiveCategory(cat)}
            >
              {cat.charAt(0).toUpperCase() + cat.slice(1)}
            </button>
          ))}
        </div>

        {/* Goals Section - Show Only Active Category Goals */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>My Goals</h2>
            <button
              className={styles.newGoalBtn}
              onClick={() => {
                setNewGoal({ ...newGoal, category: activeCategory })
                setShowNewGoal(true)
              }}
            >
              + New Goal
            </button>
          </div>

          <div className={styles.goalsList}>
            {goals[activeCategory].length === 0 ? (
              <p className={styles.emptyText}>No {activeCategory} goals yet. Create your first goal!</p>
            ) : (
              goals[activeCategory].map(goal => {
                const progress = goal.target_value > 0 
                  ? Math.min(100, (goal.current_value / goal.target_value) * 100) 
                  : 0
                return (
                  <div key={goal.id} className={styles.goalCard}>
                    <div className={styles.goalHeader}>
                      <div>
                        <h3 className={styles.goalName}>
                          {goal.custom_name || getGoalTypes(goal.category).find(t => t.type === goal.type)?.label || goal.type}
                        </h3>
                        <span className={styles.goalCategory}>{goal.category.charAt(0).toUpperCase() + goal.category.slice(1)}</span>
                      </div>
                      <div className={styles.goalActions}>
                        <button
                          className={styles.archiveBtn}
                          onClick={() => handleArchiveGoal(goal.id)}
                        >
                          Archive
                        </button>
                        <button
                          className={styles.deleteBtn}
                          onClick={() => handleDeleteGoal(goal.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    <div className={styles.goalProgress}>
                      <div className={styles.progressBar}>
                        <div
                          className={styles.progressFill}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <div className={styles.progressText}>
                        {goal.current_value} / {goal.target_value} {goal.unit} ({Math.round(progress)}%)
                      </div>
                    </div>
                    {goal.description && (
                      <p className={styles.goalDescription}>{goal.description}</p>
                    )}
                    <div className={styles.goalDates}>
                      <span>Start: {new Date(goal.start_date).toLocaleDateString()}</span>
                      {goal.end_date && (
                        <span>End: {new Date(goal.end_date).toLocaleDateString()}</span>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </section>

        {/* Category Goals Section */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>{activeCategory.charAt(0).toUpperCase() + activeCategory.slice(1)} Goals</h2>
          </div>

          <div className={styles.goalsList}>
            {goals[activeCategory].length === 0 ? (
              <p className={styles.emptyText}>No {activeCategory} goals yet</p>
            ) : (
              goals[activeCategory].map(goal => {
                const progress = goal.target_value > 0 
                  ? Math.min(100, (goal.current_value / goal.target_value) * 100) 
                  : 0
                return (
                  <div key={goal.id} className={styles.goalCard}>
                    <div className={styles.goalHeader}>
                      <h3 className={styles.goalName}>
                        {goal.custom_name || getGoalTypes(goal.category).find(t => t.type === goal.type)?.label || goal.type}
                      </h3>
                      <div className={styles.goalActions}>
                        <button
                          className={styles.archiveBtn}
                          onClick={() => handleArchiveGoal(goal.id)}
                        >
                          Archive
                        </button>
                        <button
                          className={styles.deleteBtn}
                          onClick={() => handleDeleteGoal(goal.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    <div className={styles.goalProgress}>
                      <div className={styles.progressBar}>
                        <div
                          className={styles.progressFill}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <div className={styles.progressText}>
                        {goal.current_value} / {goal.target_value} {goal.unit}
                      </div>
                    </div>
                    {goal.description && (
                      <p className={styles.goalDescription}>{goal.description}</p>
                    )}
                    <div className={styles.goalDates}>
                      <span>Start: {new Date(goal.start_date).toLocaleDateString()}</span>
                      {goal.end_date && (
                        <span>End: {new Date(goal.end_date).toLocaleDateString()}</span>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </section>

        {/* Past Goals */}
        {pastGoals.length > 0 && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Past Goals</h2>
            <div className={styles.goalsList}>
              {pastGoals.slice(0, 10).map(goal => (
                <div key={goal.id} className={styles.pastGoalCard}>
                  <span className={styles.pastGoalName}>
                    {goal.custom_name || goal.type}
                  </span>
                  <span className={styles.pastGoalStatus}>{goal.status}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Analyze Me Button */}
        <section className={styles.section}>
          <button
            className={styles.analyzeBtn}
            onClick={handleAnalyzeGoals}
            disabled={analyzing}
          >
            {analyzing ? 'Analyzing...' : 'Analyze Me'}
          </button>
          {analysisResult && (
            <div className={styles.analysisResult}>
              <h3>Analysis Result</h3>
              <p>{analysisResult}</p>
            </div>
          )}
        </section>
      </div>

      {/* New Goal Modal */}
      {showNewGoal && (
        <div className={styles.overlay} onClick={() => setShowNewGoal(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>New Goal - {newGoal.category.charAt(0).toUpperCase() + newGoal.category.slice(1)}</h2>
              <button onClick={() => setShowNewGoal(false)}>✕</button>
            </div>
            <div className={styles.modalContent}>
              <div className={styles.formGroup}>
                <label>Category</label>
                <select
                  value={newGoal.category}
                  onChange={(e) => {
                    setNewGoal({ ...newGoal, category: e.target.value, type: '', unit: '' })
                  }}
                >
                  <option value="fitness">Fitness</option>
                  <option value="health">Health</option>
                  <option value="nutrition">Nutrition</option>
                </select>
              </div>
              <div className={styles.formGroup}>
                <label>Goal Type</label>
                <select
                  value={newGoal.type}
                  onChange={(e) => {
                    const selected = getGoalTypes(newGoal.category).find(t => t.type === e.target.value)
                    setNewGoal({
                      ...newGoal,
                      type: e.target.value,
                      unit: selected?.unit || ''
                    })
                  }}
                  disabled={!newGoal.category}
                >
                  <option value="">Select goal type</option>
                  {getGoalTypes(newGoal.category).map(gt => (
                    <option key={gt.type} value={gt.type}>{gt.label}</option>
                  ))}
                </select>
              </div>
              <div className={styles.formGroup}>
                <label>Target Value</label>
                <input
                  type="number"
                  value={newGoal.targetValue}
                  onChange={(e) => setNewGoal({ ...newGoal, targetValue: e.target.value })}
                  placeholder="Enter target value"
                />
              </div>
              <div className={styles.formGroup}>
                <label>Start Date</label>
                <input
                  type="date"
                  value={newGoal.startDate}
                  onChange={(e) => setNewGoal({ ...newGoal, startDate: e.target.value })}
                />
              </div>
              <div className={styles.formGroup}>
                <label>End Date (optional)</label>
                <input
                  type="date"
                  value={newGoal.endDate}
                  onChange={(e) => setNewGoal({ ...newGoal, endDate: e.target.value })}
                />
              </div>
              <div className={styles.formGroup}>
                <label>Description (optional)</label>
                <textarea
                  value={newGoal.description}
                  onChange={(e) => setNewGoal({ ...newGoal, description: e.target.value })}
                  rows={3}
                  placeholder="Add a description for this goal"
                />
              </div>
              <div className={styles.modalActions}>
                <button className={styles.cancelBtn} onClick={() => setShowNewGoal(false)}>
                  Cancel
                </button>
                <button className={styles.saveBtn} onClick={handleCreateGoal}>
                  Create Goal
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  )
}

