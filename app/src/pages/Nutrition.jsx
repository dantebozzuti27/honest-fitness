// Nutrition page - based on GhostMode but without CalAI
// Includes Dietician LLM feature and Goals sync
import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getActiveGoalsFromSupabase } from '../lib/goalsDb'
import { getTodayEST } from '../utils/dateUtils'
import { logError } from '../utils/logger'
import BarChart from '../components/BarChart'
// All charts are now BarChart only
import styles from './Nutrition.module.css'

const TABS = ['Today', 'History', 'Analytics', 'Settings']
const MEAL_TYPES = ['Breakfast', 'Lunch', 'Dinner', 'Snacks']
const COMMON_FOODS = [
  { name: 'Banana', calories: 105, macros: { protein: 1, carbs: 27, fat: 0 } },
  { name: 'Apple', calories: 95, macros: { protein: 0, carbs: 25, fat: 0 } },
  { name: 'Chicken Breast (100g)', calories: 165, macros: { protein: 31, carbs: 0, fat: 4 } },
  { name: 'Egg', calories: 70, macros: { protein: 6, carbs: 0, fat: 5 } },
  { name: 'Protein Shake', calories: 120, macros: { protein: 25, carbs: 3, fat: 1 } },
  { name: 'Greek Yogurt (100g)', calories: 59, macros: { protein: 10, carbs: 3, fat: 0 } },
  { name: 'Rice (100g cooked)', calories: 130, macros: { protein: 3, carbs: 28, fat: 0 } },
  { name: 'Avocado (half)', calories: 160, macros: { protein: 2, carbs: 9, fat: 15 } }
]

export default function Nutrition() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState('Today')
  const [targetCalories, setTargetCalories] = useState(2000)
  const [targetMacros, setTargetMacros] = useState({ protein: 150, carbs: 200, fat: 67 })
  const [currentCalories, setCurrentCalories] = useState(0)
  const [currentMacros, setCurrentMacros] = useState({ protein: 0, carbs: 0, fat: 0 })
  const [meals, setMeals] = useState([])
  const [waterIntake, setWaterIntake] = useState(0)
  const [selectedDate, setSelectedDate] = useState(getTodayEST())
  const [historyData, setHistoryData] = useState({})
  const [favorites, setFavorites] = useState([])
  const [showQuickAdd, setShowQuickAdd] = useState(false)
  const [showManualEntry, setShowManualEntry] = useState(false)
  const [selectedMealType, setSelectedMealType] = useState('Snacks')
  const [manualEntry, setManualEntry] = useState({
    name: '',
    calories: '',
    protein: '',
    carbs: '',
    fat: ''
  })
  const [fastingStartTime, setFastingStartTime] = useState(null)
  const [fastingEnabled, setFastingEnabled] = useState(false)
  const [showDietician, setShowDietician] = useState(false)
  const [dieticianAnalyzing, setDieticianAnalyzing] = useState(false)
  const [dieticianResult, setDieticianResult] = useState(null)
  const [nutritionGoals, setNutritionGoals] = useState([])
  const [weeklyMealPlan, setWeeklyMealPlan] = useState(null)
  const [showMealPlanEditor, setShowMealPlanEditor] = useState(false)
  const [editingMealPlanDay, setEditingMealPlanDay] = useState(null)
  const fastingTimerRef = useRef(null)

  useEffect(() => {
    if (!user) return
    loadSettings()
    loadDateDataFromSupabase(selectedDate)
    loadNutritionGoals()
    loadWeeklyMealPlan()
    // Restore manual entry from localStorage
    const saved = localStorage.getItem(`nutrition_manual_entry_${user.id}`)
    if (saved) {
      try {
        const entry = JSON.parse(saved)
        if (entry.calories || entry.name || entry.protein || entry.carbs || entry.fat) {
          setManualEntry(entry)
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
  }, [user, selectedDate])

  // Save meal input to localStorage when it changes
  useEffect(() => {
    if (user && (manualEntry.calories || manualEntry.name || manualEntry.protein || manualEntry.carbs || manualEntry.fat)) {
      localStorage.setItem(`nutrition_manual_entry_${user.id}`, JSON.stringify(manualEntry))
    }
  }, [manualEntry, user])

  const loadNutritionGoals = async () => {
    if (!user) return
    try {
      const goals = await getActiveGoalsFromSupabase(user.id, 'nutrition')
      setNutritionGoals(goals)
    } catch (error) {
      // Silently fail
    }
  }

  const loadWeeklyMealPlan = async () => {
    if (!user) return
    try {
      const { getWeeklyMealPlanFromSupabase } = await import('../lib/nutritionDb')
      const plan = await getWeeklyMealPlanFromSupabase(user.id)
      setWeeklyMealPlan(plan)
    } catch (error) {
      logError('Error loading weekly meal plan', error)
    }
  }

  const createWeeklyMealPlan = () => {
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    const newPlan = {}
    days.forEach(day => {
      newPlan[day] = {
        breakfast: null,
        lunch: null,
        dinner: null,
        snacks: []
      }
    })
    setWeeklyMealPlan(newPlan)
    setShowMealPlanEditor(true)
  }

  const saveWeeklyMealPlan = async () => {
    if (!user || !weeklyMealPlan) return
    try {
      const { saveWeeklyMealPlanToSupabase } = await import('../lib/nutritionDb')
      await saveWeeklyMealPlanToSupabase(user.id, weeklyMealPlan)
      setShowMealPlanEditor(false)
    } catch (error) {
      logError('Error saving weekly meal plan', error)
      alert('Failed to save meal plan. Please try again.')
    }
  }

  const applyMealPlanToDay = (day) => {
    if (!weeklyMealPlan || !weeklyMealPlan[day]) return
    
    const dayPlan = weeklyMealPlan[day]
    const mealsToAdd = []
    
    if (dayPlan.breakfast) {
      mealsToAdd.push({ ...dayPlan.breakfast, mealType: 'Breakfast' })
    }
    if (dayPlan.lunch) {
      mealsToAdd.push({ ...dayPlan.lunch, mealType: 'Lunch' })
    }
    if (dayPlan.dinner) {
      mealsToAdd.push({ ...dayPlan.dinner, mealType: 'Dinner' })
    }
    if (dayPlan.snacks && dayPlan.snacks.length > 0) {
      dayPlan.snacks.forEach(snack => {
        mealsToAdd.push({ ...snack, mealType: 'Snacks' })
      })
    }
    
    mealsToAdd.forEach(meal => {
      addMeal(meal)
    })
  }

  const loadSettings = async () => {
    if (!user) return
    try {
      const { getNutritionSettingsFromSupabase } = await import('../lib/nutritionDb')
      const settings = await getNutritionSettingsFromSupabase(user.id)
      if (settings) {
        setTargetCalories(settings.targetCalories || 2000)
        setTargetMacros(settings.targetMacros || { protein: 150, carbs: 200, fat: 67 })
        setFavorites(settings.favorites || [])
        setFastingEnabled(settings.fastingEnabled || false)
        if (settings.fastingStartTime) {
          setFastingStartTime(new Date(settings.fastingStartTime))
        }
      } else {
        const saved = localStorage.getItem(`ghostMode_${user.id}`)
        if (saved) {
          const data = JSON.parse(saved)
          setTargetCalories(data.targetCalories || 2000)
          setTargetMacros(data.targetMacros || { protein: 150, carbs: 200, fat: 67 })
          setFavorites(data.favorites || [])
          setFastingEnabled(data.fastingEnabled || false)
          if (data.fastingStartTime) {
            setFastingStartTime(new Date(data.fastingStartTime))
          }
          const { saveNutritionSettingsToSupabase } = await import('../lib/nutritionDb')
          await saveNutritionSettingsToSupabase(user.id, {
            targetCalories: data.targetCalories || 2000,
            targetMacros: data.targetMacros || { protein: 150, carbs: 200, fat: 67 },
            favorites: data.favorites || [],
            fastingEnabled: data.fastingEnabled || false,
            fastingStartTime: data.fastingStartTime || null
          })
        }
      }
    } catch (error) {
      logError('Error loading settings', error)
      const saved = localStorage.getItem(`ghostMode_${user.id}`)
      if (saved) {
        const data = JSON.parse(saved)
        setTargetCalories(data.targetCalories || 2000)
        setTargetMacros(data.targetMacros || { protein: 150, carbs: 200, fat: 67 })
        setFavorites(data.favorites || [])
        setFastingEnabled(data.fastingEnabled || false)
        if (data.fastingStartTime) {
          setFastingStartTime(new Date(data.fastingStartTime))
        }
      }
    }
  }

  const loadDateDataFromSupabase = async (date) => {
    if (!user) return
    try {
      const { getMealsFromSupabase, getNutritionRangeFromSupabase } = await import('../lib/nutritionDb')
      const dayData = await getMealsFromSupabase(user.id, date)
      setMeals(dayData.meals || [])
      setCurrentCalories(dayData.calories || 0)
      setCurrentMacros(dayData.macros || { protein: 0, carbs: 0, fat: 0 })
      setWaterIntake(dayData.water || 0)
      
      const startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      const endDate = getTodayEST()
      const history = await getNutritionRangeFromSupabase(user.id, startDate, endDate)
      
      const historyObj = {}
      history.forEach(item => {
        historyObj[item.date] = {
          meals: item.meals,
          calories: item.calories,
          macros: item.macros,
          water: item.water
        }
      })
      setHistoryData(historyObj)
    } catch (error) {
      logError('Error loading nutrition data', error)
      const saved = localStorage.getItem(`ghostMode_${user.id}`)
      if (saved) {
        const data = JSON.parse(saved)
        const dayData = data.historyData?.[date] || { meals: [], calories: 0, macros: { protein: 0, carbs: 0, fat: 0 }, water: 0 }
        setMeals(dayData.meals || [])
        setCurrentCalories(dayData.calories || 0)
        setCurrentMacros(dayData.macros || { protein: 0, carbs: 0, fat: 0 })
        setWaterIntake(dayData.water || 0)
        setHistoryData(data.historyData || {})
      }
    }
  }

  useEffect(() => {
    if (fastingEnabled && fastingStartTime) {
      fastingTimerRef.current = setInterval(() => {}, 1000)
      return () => clearInterval(fastingTimerRef.current)
    }
  }, [fastingEnabled, fastingStartTime])

  const saveData = async () => {
    if (!user) return
    const updatedHistory = {
      ...historyData,
      [selectedDate]: {
        meals,
        calories: currentCalories,
        macros: currentMacros,
        water: waterIntake
      }
    }
    try {
      const { saveNutritionSettingsToSupabase } = await import('../lib/nutritionDb')
      await saveNutritionSettingsToSupabase(user.id, {
        targetCalories,
        targetMacros,
        favorites,
        fastingEnabled,
        fastingStartTime: fastingStartTime?.toISOString() || null
      })
    } catch (error) {
      logError('Error saving settings to Supabase', error)
      localStorage.setItem(`ghostMode_${user.id}`, JSON.stringify({
        targetCalories,
        targetMacros,
        favorites,
        fastingEnabled,
        fastingStartTime: fastingStartTime?.toISOString() || null
      }))
    }
    setHistoryData(updatedHistory)
  }

  const addMeal = async (meal) => {
    if (!user) return
    const newMeal = {
      ...meal,
      id: Date.now().toString(),
      mealType: meal.mealType || selectedMealType,
      timestamp: new Date().toISOString()
    }
    const updatedMeals = [...meals, newMeal]
    const updatedCalories = currentCalories + (meal.calories || 0)
    const updatedMacros = {
      protein: currentMacros.protein + (meal.macros?.protein || 0),
      carbs: currentMacros.carbs + (meal.macros?.carbs || 0),
      fat: currentMacros.fat + (meal.macros?.fat || 0)
    }
    setMeals(updatedMeals)
    setCurrentCalories(updatedCalories)
    setCurrentMacros(updatedMacros)
    try {
      const { saveMealToSupabase } = await import('../lib/nutritionDb')
      await saveMealToSupabase(user.id, selectedDate, newMeal)
    } catch (error) {
      logError('Error saving meal to database', error)
    }
  }

  const addQuickFood = (food) => {
    addMeal({
      calories: food.calories,
      macros: food.macros,
      foods: [food.name],
      type: 'quick'
    })
    setShowQuickAdd(false)
  }

  const handleManualEntry = async () => {
    const { validateCalories, validateMacro } = await import('../utils/validation')
    const caloriesValidation = validateCalories(manualEntry.calories)
    if (!caloriesValidation.valid) {
      alert(caloriesValidation.error)
      return
    }
    const proteinValidation = validateMacro(manualEntry.protein || 0)
    const carbsValidation = validateMacro(manualEntry.carbs || 0)
    const fatValidation = validateMacro(manualEntry.fat || 0)
    if (!proteinValidation.valid || !carbsValidation.valid || !fatValidation.valid) {
      alert('Please enter valid macro values (0-1000g)')
      return
    }
    addMeal({
      calories: caloriesValidation.value,
      macros: {
        protein: proteinValidation.value,
        carbs: carbsValidation.value,
        fat: fatValidation.value
      },
      foods: manualEntry.name ? [manualEntry.name] : [],
      description: manualEntry.name || 'Manual entry',
      type: 'manual'
    })
    // Clear form after successful save
    const clearedEntry = { name: '', calories: '', protein: '', carbs: '', fat: '' }
    setManualEntry(clearedEntry)
    setShowManualEntry(false)
    // Save to localStorage to persist if user navigates away
    if (user) {
      localStorage.setItem(`nutrition_manual_entry_${user.id}`, JSON.stringify(clearedEntry))
    }
  }

  const removeMeal = async (mealId) => {
    if (!user) return
    const meal = meals.find(m => m.id === mealId)
    if (meal) {
      const updatedMeals = meals.filter(m => m.id !== mealId)
      const updatedCalories = Math.max(0, currentCalories - meal.calories)
      const updatedMacros = {
        protein: Math.max(0, currentMacros.protein - (meal.macros?.protein || 0)),
        carbs: Math.max(0, currentMacros.carbs - (meal.macros?.carbs || 0)),
        fat: Math.max(0, currentMacros.fat - (meal.macros?.fat || 0))
      }
      setMeals(updatedMeals)
      setCurrentCalories(updatedCalories)
      setCurrentMacros(updatedMacros)
      try {
        const { deleteMealFromSupabase } = await import('../lib/nutritionDb')
        await deleteMealFromSupabase(user.id, selectedDate, mealId)
      } catch (error) {
        logError('Error deleting meal from database', error)
      }
    }
  }

  const toggleFavorite = (meal) => {
    const isFavorite = favorites.some(f => f.id === meal.id)
    if (isFavorite) {
      setFavorites(favorites.filter(f => f.id !== meal.id))
    } else {
      setFavorites([...favorites, { ...meal, id: Date.now() }])
    }
    saveData()
  }

  const addFavorite = (favorite) => {
    addMeal({
      calories: favorite.calories,
      macros: favorite.macros,
      foods: favorite.foods || [],
      description: favorite.description,
      type: 'favorite'
    })
  }

  const addWater = async (amount) => {
    if (!user) return
    const newAmount = waterIntake + amount
    setWaterIntake(newAmount)
    try {
      const { updateWaterIntake } = await import('../lib/nutritionDb')
      await updateWaterIntake(user.id, selectedDate, newAmount)
    } catch (error) {
      // Silently fail
    }
  }

  const resetDay = () => {
    if (confirm('Reset today\'s data?')) {
      setMeals([])
      setCurrentCalories(0)
      setCurrentMacros({ protein: 0, carbs: 0, fat: 0 })
      setWaterIntake(0)
      saveData()
    }
  }

  const getFastingTime = () => {
    if (!fastingStartTime) return null
    const now = new Date()
    const diff = now - fastingStartTime
    const hours = Math.floor(diff / (1000 * 60 * 60))
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
    return `${hours}h ${minutes}m`
  }

  const startFasting = () => {
    setFastingStartTime(new Date())
    setFastingEnabled(true)
    saveData()
  }

  const stopFasting = () => {
    setFastingEnabled(false)
    setFastingStartTime(null)
    saveData()
  }

  // Check if user has 7+ days of full meals for Dietician
  const canUseDietician = useMemo(() => {
    const datesWithFullMeals = Object.entries(historyData).filter(([date, data]) => {
      return data.meals && Array.isArray(data.meals) && data.meals.length >= 3
    })
    return datesWithFullMeals.length >= 7
  }, [historyData])

  const handleDieticianAnalysis = async () => {
    if (!user || !canUseDietician) {
      alert('You need at least 7 days of full meals (3+ meals per day) to use the Dietician feature.')
      return
    }

    setDieticianAnalyzing(true)
    setDieticianResult(null)

    try {
      // Get last 7 days of nutrition data
      const last7Days = Object.entries(historyData)
        .sort((a, b) => b[0].localeCompare(a[0]))
        .slice(0, 7)
        .map(([date, data]) => ({
          date,
          calories: data.calories || 0,
          macros: data.macros || { protein: 0, carbs: 0, fat: 0 },
          meals: data.meals || []
        }))

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{
            role: 'user',
            content: `As a professional dietician, analyze my diet from the last 7 days and provide recommendations. Here's my nutrition data: ${JSON.stringify(last7Days)}. My daily goals are: ${targetCalories} calories, ${targetMacros.protein}g protein, ${targetMacros.carbs}g carbs, ${targetMacros.fat}g fat.`
          }]
        })
      })

      if (response.ok) {
        const data = await response.json()
        setDieticianResult(data.response || data.message || 'Analysis complete')
      } else {
        throw new Error('Dietician analysis failed')
      }
    } catch (error) {
      alert('Failed to analyze diet. Please try again.')
    } finally {
      setDieticianAnalyzing(false)
    }
  }

  const weeklyData = useMemo(() => {
    const dates = []
    const calories = []
    const proteins = []
    const carbs = []
    const fats = []
    for (let i = 6; i >= 0; i--) {
      const date = new Date()
      date.setDate(date.getDate() - i)
      const dateStr = date.toISOString().split('T')[0]
      dates.push(dateStr)
      const dayData = historyData[dateStr] || { calories: 0, macros: { protein: 0, carbs: 0, fat: 0 } }
      calories.push(dayData.calories || 0)
      proteins.push(dayData.macros?.protein || 0)
      carbs.push(dayData.macros?.carbs || 0)
      fats.push(dayData.macros?.fat || 0)
    }
    return { dates, calories, proteins, carbs, fats }
  }, [historyData])

  const macroDistribution = useMemo(() => {
    const total = currentMacros.protein * 4 + currentMacros.carbs * 4 + currentMacros.fat * 9
    if (total === 0) return { protein: 0, carbs: 0, fat: 0 }
    return {
      protein: ((currentMacros.protein * 4) / total) * 100,
      carbs: ((currentMacros.carbs * 4) / total) * 100,
      fat: ((currentMacros.fat * 9) / total) * 100
    }
  }, [currentMacros])

  const deficit = currentCalories - targetCalories
  const isOver = deficit > 0

  const mealsByType = useMemo(() => {
    const grouped = {}
    MEAL_TYPES.forEach(type => {
      grouped[type] = meals.filter(m => m.mealType === type)
    })
    return grouped
  }, [meals])

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>Nutrition</h1>
        {activeTab === 'Today' && (
          <button 
            className={styles.plusBtn}
            onClick={() => setShowQuickAdd(true)}
            aria-label="Add meal"
          >
            <span className={styles.plusIcon}>+</span>
          </button>
        )}
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
        {activeTab === 'Today' && (
          <div>
            {/* Log Meal Button */}
            <button
              className={styles.logMealBtn}
              onClick={() => setShowQuickAdd(true)}
            >
              Log meal
            </button>

            {/* Options List */}
            <div className={styles.optionsList}>
              <button
                className={styles.optionItem}
                onClick={() => {
                  // Scroll to daily intake section
                  const intakeSection = document.querySelector(`.${styles.summaryCard}`)
                  if (intakeSection) {
                    intakeSection.scrollIntoView({ behavior: 'smooth' })
                  }
                }}
              >
                <span className={styles.optionIcon}>🍴</span>
                <div className={styles.optionContent}>
                  <span className={styles.optionTitle}>Daily intake</span>
                  <span className={styles.optionSubtitle}>calories, protein, carbs, fats</span>
                </div>
              </button>
              
              <button
                className={styles.optionItem}
                onClick={() => {
                  // Scroll to goals section
                  const goalsSection = document.querySelector(`.${styles.goalsLink}`)
                  if (goalsSection) {
                    goalsSection.scrollIntoView({ behavior: 'smooth' })
                  }
                }}
              >
                <span className={styles.optionIcon}>🎯</span>
                <div className={styles.optionContent}>
                  <span className={styles.optionTitle}>Daily goals</span>
                  <span className={styles.optionSubtitle}>calories, protein, carbs, fat</span>
                </div>
              </button>
              
              <button
                className={styles.optionItem}
                onClick={() => {
                  // Scroll to meals section
                  const mealsSection = document.querySelector(`.${styles.mealsSection}`)
                  if (mealsSection) {
                    mealsSection.scrollIntoView({ behavior: 'smooth' })
                  }
                }}
              >
                <span className={styles.optionIcon}>📅</span>
                <div className={styles.optionContent}>
                  <span className={styles.optionTitle}>Daily meals</span>
                </div>
              </button>
              
              <button
                className={styles.optionItem}
                onClick={() => {
                  if (canUseDietician) {
                    handleDieticianAnalysis()
                  } else {
                    alert('You need at least 7 days of full meals (3+ meals per day) to use the Dietician feature.')
                  }
                }}
              >
                <span className={styles.optionIcon}>👤</span>
                <div className={styles.optionContent}>
                  <span className={styles.optionTitle}>Dietician</span>
                  <span className={styles.optionSubtitle}>LLM analyzes diet if it has 7 days or more of full meals</span>
                </div>
              </button>
            </div>

            {/* Daily Intake Section */}
            <div className={styles.dateSelector}>
              <button onClick={() => {
                const prev = new Date(selectedDate)
                prev.setDate(prev.getDate() - 1)
                setSelectedDate(prev.toISOString().split('T')[0])
              }}>
                ←
              </button>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className={styles.dateInput}
              />
              <button onClick={() => {
                const next = new Date(selectedDate)
                next.setDate(next.getDate() + 1)
                if (next <= new Date()) {
                  setSelectedDate(next.toISOString().split('T')[0])
                }
              }} disabled={selectedDate >= getTodayEST()}>
                →
              </button>
            </div>

            <div className={styles.summaryCard}>
              <div className={styles.calorieRow}>
                <div>
                  <label className={styles.label}>Target</label>
                  <input
                    type="number"
                    className={styles.calorieInput}
                    value={targetCalories}
                    onChange={(e) => {
                      setTargetCalories(parseInt(e.target.value) || 2000)
                      saveData()
                    }}
                    min="1000"
                    max="5000"
                  />
                </div>
                <div className={styles.divider}>/</div>
                <div>
                  <label className={styles.label}>Current</label>
                  <div className={`${styles.calorieValue} ${isOver ? styles.over : ''}`}>
                    {currentCalories}
                  </div>
                </div>
                <div className={styles.progressBar}>
                  <div
                    className={styles.progressFill}
                    style={{ width: `${Math.min(100, (currentCalories / targetCalories) * 100)}%` }}
                  />
                </div>
              </div>

              <div className={styles.macroProgress}>
                <div className={styles.macroItem}>
                  <div className={styles.macroHeader}>
                    <span>Protein</span>
                    <span>{Math.round(currentMacros.protein)} / {targetMacros.protein}g</span>
                  </div>
                  <div className={styles.macroBar}>
                    <div
                      className={styles.macroFill}
                      style={{
                        width: `${Math.min(100, (currentMacros.protein / targetMacros.protein) * 100)}%`,
                        background: '#4CAF50'
                      }}
                    />
                  </div>
                </div>
                <div className={styles.macroItem}>
                  <div className={styles.macroHeader}>
                    <span>Carbs</span>
                    <span>{Math.round(currentMacros.carbs)} / {targetMacros.carbs}g</span>
                  </div>
                  <div className={styles.macroBar}>
                    <div
                      className={styles.macroFill}
                      style={{
                        width: `${Math.min(100, (currentMacros.carbs / targetMacros.carbs) * 100)}%`,
                        background: '#2196F3'
                      }}
                    />
                  </div>
                </div>
                <div className={styles.macroItem}>
                  <div className={styles.macroHeader}>
                    <span>Fat</span>
                    <span>{Math.round(currentMacros.fat)} / {targetMacros.fat}g</span>
                  </div>
                  <div className={styles.macroBar}>
                    <div
                      className={styles.macroFill}
                      style={{
                        width: `${Math.min(100, (currentMacros.fat / targetMacros.fat) * 100)}%`,
                        background: '#FF9800'
                      }}
                    />
                  </div>
                </div>
              </div>

              <div className={styles.waterSection}>
                <div className={styles.waterHeader}>
                  <span>Water</span>
                  <span>{Math.round(waterIntake / 250)} / 8 glasses</span>
                </div>
                <div className={styles.waterButtons}>
                  {[250, 500, 750].map(amount => (
                    <button
                      key={amount}
                      className={styles.waterBtn}
                      onClick={() => addWater(amount)}
                    >
                      +{amount}ml
                    </button>
                  ))}
                </div>
              </div>

              {fastingEnabled && fastingStartTime && (
                <div className={styles.fastingCard}>
                  <div className={styles.fastingTime}>{getFastingTime()}</div>
                  <button className={styles.stopFastingBtn} onClick={stopFasting}>
                    End Fast
                  </button>
                </div>
              )}

              {isOver && (
                <div className={styles.activityNeeded}>
                  <span>You're over your target by {deficit} calories</span>
                </div>
              )}
            </div>

            {/* Daily Meals Section */}
            <div className={`${styles.mealsSection} ${styles.goalsLink}`}>
              <h3 className={styles.sectionTitle}>Daily Meals</h3>
              {MEAL_TYPES.map(type => {
                const typeMeals = mealsByType[type] || []
                if (typeMeals.length === 0) return null
                return (
                  <div key={type} className={styles.mealTypeGroup}>
                    <h4 className={styles.mealTypeTitle}>{type}</h4>
                    <div className={styles.mealsList}>
                      {typeMeals.map(meal => (
                        <MealCard
                          key={meal.id}
                          meal={meal}
                          onRemove={removeMeal}
                          onToggleFavorite={toggleFavorite}
                          isFavorite={favorites.some(f => f.id === meal.id)}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
              {meals.length === 0 && (
                <p className={styles.emptyHint}>No meals logged yet. Tap "Log meal" to get started!</p>
              )}
            </div>

            {/* Goals Section */}
            <div className={styles.goalsLink}>
              <div className={styles.goalsHeader}>
                <h3>Goals</h3>
                <button
                  className={styles.goalsBtn}
                  onClick={() => navigate('/goals')}
                >
                  View All →
                </button>
              </div>
              {nutritionGoals.length === 0 ? (
                <p className={styles.goalsNote}>No nutrition goals set. Create one on the Goals page.</p>
              ) : (
                <div className={styles.goalsList}>
                  {nutritionGoals.slice(0, 3).map(goal => {
                    const progress = goal.target_value > 0 
                      ? Math.min(100, (goal.current_value / goal.target_value) * 100) 
                      : 0
                    return (
                      <div key={goal.id} className={styles.goalCard}>
                        <div className={styles.goalHeader}>
                          <span className={styles.goalName}>
                            {goal.custom_name || goal.type}
                          </span>
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

            {/* Dietician LLM */}
            <div className={styles.dieticianSection}>
              <h3>Dietician</h3>
              <p className={styles.dieticianNote}>
                {canUseDietician 
                  ? 'Analyze your diet (requires 7+ days of full meals)'
                  : 'Log 7+ days of full meals (3+ meals per day) to unlock diet analysis'}
              </p>
              <button
                className={styles.dieticianBtn}
                onClick={handleDieticianAnalysis}
                disabled={!canUseDietician || dieticianAnalyzing}
              >
                {dieticianAnalyzing ? 'Analyzing...' : 'Analyze My Diet'}
              </button>
              {dieticianResult && (
                <div className={styles.dieticianResult}>
                  <h4>Diet Analysis</h4>
                  <p>{dieticianResult}</p>
                </div>
              )}
            </div>

            {showManualEntry && (
              <div className={styles.manualEntryCard}>
                <h3>Add Meal Manually</h3>
                <div className={styles.manualEntryForm}>
                  <div className={styles.formRow}>
                    <label>Food Name (optional)</label>
                    <input
                      type="text"
                      className={styles.formInput}
                      placeholder="e.g., Grilled Chicken"
                      value={manualEntry.name}
                      onChange={(e) => {
                        const updated = { ...manualEntry, name: e.target.value }
                        setManualEntry(updated)
                        if (user) {
                          localStorage.setItem(`nutrition_manual_entry_${user.id}`, JSON.stringify(updated))
                        }
                      }}
                    />
                  </div>
                  <div className={styles.formRow}>
                    <label>Calories *</label>
                    <input
                      type="number"
                      className={styles.formInput}
                      placeholder="0"
                      value={manualEntry.calories}
                      onChange={(e) => {
                        const updated = { ...manualEntry, calories: e.target.value }
                        setManualEntry(updated)
                        if (user) {
                          localStorage.setItem(`nutrition_manual_entry_${user.id}`, JSON.stringify(updated))
                        }
                      }}
                      min="0"
                    />
                  </div>
                  <div className={styles.macroInputs}>
                    <div className={styles.macroInput}>
                      <label>Protein (g)</label>
                      <input
                        type="number"
                        className={styles.formInput}
                        placeholder="0"
                        value={manualEntry.protein}
                        onChange={(e) => {
                          const updated = { ...manualEntry, protein: e.target.value }
                          setManualEntry(updated)
                          if (user) {
                            localStorage.setItem(`nutrition_manual_entry_${user.id}`, JSON.stringify(updated))
                          }
                        }}
                        min="0"
                        step="0.1"
                      />
                    </div>
                    <div className={styles.macroInput}>
                      <label>Carbs (g)</label>
                      <input
                        type="number"
                        className={styles.formInput}
                        placeholder="0"
                        value={manualEntry.carbs}
                        onChange={(e) => {
                          const updated = { ...manualEntry, carbs: e.target.value }
                          setManualEntry(updated)
                          if (user) {
                            localStorage.setItem(`nutrition_manual_entry_${user.id}`, JSON.stringify(updated))
                          }
                        }}
                        min="0"
                        step="0.1"
                      />
                    </div>
                    <div className={styles.macroInput}>
                      <label>Fat (g)</label>
                      <input
                        type="number"
                        className={styles.formInput}
                        placeholder="0"
                        value={manualEntry.fat}
                        onChange={(e) => {
                          const updated = { ...manualEntry, fat: e.target.value }
                          setManualEntry(updated)
                          if (user) {
                            localStorage.setItem(`nutrition_manual_entry_${user.id}`, JSON.stringify(updated))
                          }
                        }}
                        min="0"
                        step="0.1"
                      />
                    </div>
                  </div>
                  <div className={styles.manualEntryActions}>
                    <button
                      className={styles.cancelBtn}
                      onClick={() => {
                        setShowManualEntry(false)
                        setManualEntry({ name: '', calories: '', protein: '', carbs: '', fat: '' })
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      className={styles.submitBtn}
                      onClick={handleManualEntry}
                      disabled={!manualEntry.calories || manualEntry.calories <= 0}
                    >
                      Add Meal
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className={styles.mealTypeSelector}>
              {MEAL_TYPES.map(type => (
                <button
                  key={type}
                  className={`${styles.mealTypeBtn} ${selectedMealType === type ? styles.activeMealType : ''}`}
                  onClick={() => setSelectedMealType(type)}
                >
                  {type}
                </button>
              ))}
            </div>

            {showQuickAdd && (
              <div className={styles.quickAddCard}>
                <h3>Quick Add</h3>
                <div className={styles.quickAddGrid}>
                  {COMMON_FOODS.map((food, idx) => (
                    <button
                      key={idx}
                      className={styles.quickAddBtn}
                      onClick={() => addQuickFood(food)}
                    >
                      <div className={styles.quickAddName}>{food.name}</div>
                      <div className={styles.quickAddCal}>{food.calories} cal</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {MEAL_TYPES.map(type => {
              const typeMeals = mealsByType[type]
              if (typeMeals.length === 0) return null
              return (
                <div key={type} className={styles.mealSection}>
                  <h3 className={styles.mealSectionTitle}>{type}</h3>
                  {typeMeals.map(meal => (
                    <MealCard
                      key={meal.id}
                      meal={meal}
                      onRemove={removeMeal}
                      onToggleFavorite={toggleFavorite}
                      isFavorite={favorites.some(f => f.id === meal.id)}
                    />
                  ))}
                </div>
              )
            })}

            {meals.length === 0 && (
              <div className={styles.emptyState}>
                <p>No meals logged today</p>
                <p className={styles.emptyHint}>Click "Log Meal" to get started!</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'History' && (
          <div className={styles.historyContent}>
            <h2>Meal History</h2>
            <div className={styles.historyList}>
              {Object.entries(historyData)
                .sort((a, b) => b[0].localeCompare(a[0]))
                .map(([date, data]) => (
                  <div key={date} className={styles.historyDay}>
                    <div className={styles.historyDate}>
                      {new Date(date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                    </div>
                    <div className={styles.historyStats}>
                      <span>{data.calories || 0} cal</span>
                      <span>P: {Math.round(data.macros?.protein || 0)}g</span>
                      <span>C: {Math.round(data.macros?.carbs || 0)}g</span>
                      <span>F: {Math.round(data.macros?.fat || 0)}g</span>
                      <span>Water: {Math.round((data.water || 0) / 250)} glasses</span>
                    </div>
                    <button
                      className={styles.viewDayBtn}
                      onClick={() => {
                        setSelectedDate(date)
                        setActiveTab('Today')
                      }}
                    >
                      View Day
                    </button>
                  </div>
                ))}
              {Object.keys(historyData).length === 0 && (
                <div className={styles.emptyState}>No history yet</div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'Analytics' && (
          <div className={styles.analyticsContent}>
            <h2>Nutrition Analytics</h2>
            <div className={styles.chartCard}>
              <h3>Weekly Calories</h3>
              <BarChart
                data={Object.fromEntries(weeklyData.dates.map((d, i) => {
                  const date = new Date(d)
                  return [`${date.getMonth() + 1}/${date.getDate()}`, weeklyData.calories[i] || 0]
                }))}
                height={150}
                color="#ff2d2d"
                xAxisLabel="Date"
                yAxisLabel="Calories"
              />
            </div>
            <div className={styles.chartCard}>
              <h3>Today's Macro Distribution</h3>
              <div className={styles.macroPie}>
                <div className={styles.macroSlice} style={{
                  background: `conic-gradient(#4CAF50 0% ${macroDistribution.protein}%, #2196F3 ${macroDistribution.protein}% ${macroDistribution.protein + macroDistribution.carbs}%, #FF9800 ${macroDistribution.protein + macroDistribution.carbs}% 100%)`
                }}>
                  <div className={styles.macroPieCenter}>
                    <div className={styles.macroPieValue}>
                      {Math.round(macroDistribution.protein)}% P
                    </div>
                    <div className={styles.macroPieValue}>
                      {Math.round(macroDistribution.carbs)}% C
                    </div>
                    <div className={styles.macroPieValue}>
                      {Math.round(macroDistribution.fat)}% F
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className={styles.chartCard}>
              <h3>Weekly Protein</h3>
              <BarChart
                data={Object.fromEntries(weeklyData.dates.map((d, i) => {
                  const date = new Date(d)
                  return [`${date.getMonth() + 1}/${date.getDate()}`, weeklyData.proteins[i] || 0]
                }))}
                height={150}
                color="#ff2d2d"
                xAxisLabel="Date"
                yAxisLabel="Protein (g)"
              />
            </div>
          </div>
        )}

        {activeTab === 'Settings' && (
          <div className={styles.settingsContent}>
            <h2>Settings</h2>
            <div className={styles.settingsSection}>
              <h3>Daily Goals</h3>
              <p className={styles.goalsNote}>Syncs to Goals page</p>
              <div className={styles.settingItem}>
                <label>Target Calories</label>
                <input
                  type="number"
                  value={targetCalories}
                  onChange={(e) => {
                    setTargetCalories(parseInt(e.target.value) || 2000)
                  }}
                  min="1000"
                  max="5000"
                />
              </div>
              <div className={styles.settingItem}>
                <label>Target Protein (g)</label>
                <input
                  type="number"
                  value={targetMacros.protein}
                  onChange={(e) => {
                    setTargetMacros({ ...targetMacros, protein: parseInt(e.target.value) || 0 })
                  }}
                  min="0"
                  max="500"
                />
              </div>
              <div className={styles.settingItem}>
                <label>Target Carbs (g)</label>
                <input
                  type="number"
                  value={targetMacros.carbs}
                  onChange={(e) => {
                    setTargetMacros({ ...targetMacros, carbs: parseInt(e.target.value) || 0 })
                  }}
                  min="0"
                  max="500"
                />
              </div>
              <div className={styles.settingItem}>
                <label>Target Fat (g)</label>
                <input
                  type="number"
                  value={targetMacros.fat}
                  onChange={(e) => {
                    setTargetMacros({ ...targetMacros, fat: parseInt(e.target.value) || 0 })
                  }}
                  min="0"
                  max="500"
                />
              </div>
              <button
                className={styles.saveBtn}
                onClick={saveData}
              >
                Save Goals
              </button>
            </div>
            <div className={styles.settingsSection}>
              <h3>Favorites</h3>
              {favorites.length === 0 ? (
                <p className={styles.emptyHint}>No favorites yet. Star a meal to save it!</p>
              ) : (
                <div className={styles.favoritesList}>
                  {favorites.map((fav, idx) => (
                    <div key={idx} className={styles.favoriteItem}>
                      <div>
                        <div className={styles.favoriteName}>
                          {fav.foods?.[0] || fav.description || 'Favorite Meal'}
                        </div>
                        <div className={styles.favoriteMacros}>
                          {fav.calories} cal • P: {Math.round(fav.macros?.protein || 0)}g
                        </div>
                      </div>
                      <div className={styles.favoriteActions}>
                        <button
                          className={styles.addFavoriteBtn}
                          onClick={() => addFavorite(fav)}
                        >
                          Add
                        </button>
                        <button
                          className={styles.removeFavoriteBtn}
                          onClick={() => {
                            setFavorites(favorites.filter((_, i) => i !== idx))
                            saveData()
                          }}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className={styles.settingsSection}>
              <div className={styles.sectionHeader}>
                <h3>Weekly Meal Plan</h3>
                <button
                  className={styles.newGoalBtn}
                  onClick={() => {
                    if (weeklyMealPlan) {
                      setShowMealPlanEditor(true)
                    } else {
                      createWeeklyMealPlan()
                    }
                  }}
                >
                  {weeklyMealPlan ? 'Edit Plan' : 'Create Plan'}
                </button>
              </div>
              {weeklyMealPlan ? (
                <div className={styles.mealPlanPreview}>
                  {Object.entries(weeklyMealPlan).map(([day, meals]) => (
                    <div key={day} className={styles.mealPlanDay}>
                      <div className={styles.mealPlanDayHeader}>
                        <strong>{day}</strong>
                        <button
                          className={styles.applyDayBtn}
                          onClick={() => applyMealPlanToDay(day)}
                        >
                          Apply to Today
                        </button>
                      </div>
                      <div className={styles.mealPlanMeals}>
                        {meals.breakfast && (
                          <span className={styles.mealPlanMealTag}>B: {meals.breakfast.foods?.[0] || meals.breakfast.description || 'Meal'}</span>
                        )}
                        {meals.lunch && (
                          <span className={styles.mealPlanMealTag}>L: {meals.lunch.foods?.[0] || meals.lunch.description || 'Meal'}</span>
                        )}
                        {meals.dinner && (
                          <span className={styles.mealPlanMealTag}>D: {meals.dinner.foods?.[0] || meals.dinner.description || 'Meal'}</span>
                        )}
                        {meals.snacks && meals.snacks.length > 0 && (
                          <span className={styles.mealPlanMealTag}>S: {meals.snacks.length} snack(s)</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className={styles.emptyHint}>Create a weekly meal plan to quickly apply meals to any day</p>
              )}
            </div>
          </div>
        )}

        {/* Weekly Meal Plan Editor Modal */}
        {showMealPlanEditor && weeklyMealPlan && (
          <div className={styles.overlay} onClick={() => setShowMealPlanEditor(false)}>
            <div className={styles.modal} onClick={e => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <h2>Weekly Meal Plan</h2>
                <button onClick={() => setShowMealPlanEditor(false)}>✕</button>
              </div>
              <div className={styles.modalContent}>
                {Object.entries(weeklyMealPlan).map(([day, meals]) => (
                  <div key={day} className={styles.mealPlanDayEditor}>
                    <h4>{day}</h4>
                    <div className={styles.mealPlanMealInputs}>
                      <div className={styles.mealPlanMealInput}>
                        <label>Breakfast</label>
                        <button
                          className={styles.selectMealBtn}
                          onClick={() => {
                            setEditingMealPlanDay({ day, mealType: 'breakfast' })
                            setShowMealPlanEditor(false)
                            setShowQuickAdd(true)
                          }}
                        >
                          {meals.breakfast ? (meals.breakfast.foods?.[0] || meals.breakfast.description || 'Meal') : 'Select Meal'}
                        </button>
                      </div>
                      <div className={styles.mealPlanMealInput}>
                        <label>Lunch</label>
                        <button
                          className={styles.selectMealBtn}
                          onClick={() => {
                            setEditingMealPlanDay({ day, mealType: 'lunch' })
                            setShowMealPlanEditor(false)
                            setShowQuickAdd(true)
                          }}
                        >
                          {meals.lunch ? (meals.lunch.foods?.[0] || meals.lunch.description || 'Meal') : 'Select Meal'}
                        </button>
                      </div>
                      <div className={styles.mealPlanMealInput}>
                        <label>Dinner</label>
                        <button
                          className={styles.selectMealBtn}
                          onClick={() => {
                            setEditingMealPlanDay({ day, mealType: 'dinner' })
                            setShowMealPlanEditor(false)
                            setShowQuickAdd(true)
                          }}
                        >
                          {meals.dinner ? (meals.dinner.foods?.[0] || meals.dinner.description || 'Meal') : 'Select Meal'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                <div className={styles.modalActions}>
                  <button className={styles.cancelBtn} onClick={() => setShowMealPlanEditor(false)}>
                    Cancel
                  </button>
                  <button className={styles.saveBtn} onClick={saveWeeklyMealPlan}>
                    Save Plan
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}



function MealCard({ meal, onRemove, onToggleFavorite, isFavorite }) {
  return (
    <div className={styles.mealCard}>
      {meal.imageUrl && (
        <img src={meal.imageUrl} alt="Meal" className={styles.mealImage} />
      )}
      <div className={styles.mealHeader}>
        <div className={styles.mealCalories}>{meal.calories} cal</div>
        <div className={styles.mealActions}>
          <button
            className={`${styles.favoriteBtn} ${isFavorite ? styles.favoriteActive : ''}`}
            onClick={() => onToggleFavorite(meal)}
            title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            {isFavorite ? '★' : '☆'}
          </button>
          <button
            className={styles.removeBtn}
            onClick={() => onRemove(meal.id)}
          >
            ×
          </button>
        </div>
      </div>
      {meal.foods && meal.foods.length > 0 && (
        <div className={styles.mealFoods}>
          {meal.foods.map((food, idx) => (
            <span key={idx} className={styles.foodTag}>{food}</span>
          ))}
        </div>
      )}
      {meal.description && (
        <div className={styles.mealDescription}>{meal.description}</div>
      )}
      <div className={styles.mealMacros}>
        <span>P: {Math.round(meal.macros?.protein || 0)}g</span>
        <span>C: {Math.round(meal.macros?.carbs || 0)}g</span>
        <span>F: {Math.round(meal.macros?.fat || 0)}g</span>
      </div>
      <div className={styles.mealTime}>
        {new Date(meal.timestamp).toLocaleTimeString()}
      </div>
    </div>
  )
}


