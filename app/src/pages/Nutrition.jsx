// Nutrition page - based on GhostMode but without CalAI
// Includes Dietician LLM feature and Goals sync
import { useState, useEffect, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getActiveGoalsFromSupabase } from '../lib/goalsDb'
import { getTodayEST } from '../utils/dateUtils'
import { logError, logDebug } from '../utils/logger'
import { getSystemFoods, getFoodCategories, getFavoriteFoods, getRecentFoods } from '../lib/foodLibrary'

// Ensure logDebug is always available (fallback for build issues)
const safeLogDebug = logDebug || (() => {})
import BarChart from '../components/BarChart'
import Toast from '../components/Toast'
import { useToast } from '../hooks/useToast'
import ShareModal from '../components/ShareModal'
import SideMenu from '../components/SideMenu'
import HomeButton from '../components/HomeButton'
// All charts are now BarChart only
import styles from './Nutrition.module.css'

const TABS = ['Today', 'History', 'Plan', 'Goals']
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
  const location = useLocation()
  const { user } = useAuth()
  const { toast, showToast, hideToast } = useToast()
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
  const [foodSuggestions, setFoodSuggestions] = useState([])
  const [foodCategories, setFoodCategories] = useState([])
  const [showQuickAdd, setShowQuickAdd] = useState(false)
  const [showManualEntry, setShowManualEntry] = useState(false)
  const [showFoodSuggestions, setShowFoodSuggestions] = useState(false)
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
  const [goalsStartDate, setGoalsStartDate] = useState(getTodayEST())
  const [goalsEndDate, setGoalsEndDate] = useState(getTodayEST())
  const [showShareModal, setShowShareModal] = useState(false)
  const [selectedNutritionForShare, setSelectedNutritionForShare] = useState(null)
  const fastingTimerRef = useRef(null)

  useEffect(() => {
    if (!user) return
    
    // Check if meal modal should open from quick log
    if (location.state?.openMealModal) {
      setShowManualEntry(true)
      // Clear the state to prevent reopening on re-render
      navigate(location.pathname, { replace: true, state: {} })
    }
    
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

  // Refresh goals when page becomes visible or when navigating back from Goals page
  useEffect(() => {
    if (!user) return
    loadNutritionGoals()
  }, [user, location.key])

  useEffect(() => {
    if (!user) return
    
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        loadNutritionGoals()
      }
    }
    
    document.addEventListener('visibilitychange', handleVisibilityChange)
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [user])

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

  const loadFoodSuggestions = async () => {
    if (!user) return
    try {
      const [categories, systemFoods, favoriteFoods, recentFoods] = await Promise.all([
        getFoodCategories(),
        getSystemFoods({ search: '' }),
        getFavoriteFoods(user.id),
        getRecentFoods(user.id, 10)
      ])
      setFoodCategories(categories)
      // Combine favorites, recent, and system foods (prioritize favorites/recent)
      const allSuggestions = [
        ...favoriteFoods.map(f => ({ ...f, isFavorite: true })),
        ...recentFoods.map(f => ({ ...f, isRecent: true })),
        ...systemFoods.filter(f => !favoriteFoods.some(fav => fav.id === f.id) && !recentFoods.some(rec => rec.id === f.id))
      ]
      setFoodSuggestions(allSuggestions.slice(0, 50)) // Limit to 50 suggestions
    } catch (error) {
      logError('Error loading food suggestions', error)
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
        breakfast: { name: '', calories: 0, macros: { protein: 0, carbs: 0, fat: 0 }, time: '08:00' },
        lunch: { name: '', calories: 0, macros: { protein: 0, carbs: 0, fat: 0 }, time: '12:00' },
        dinner: { name: '', calories: 0, macros: { protein: 0, carbs: 0, fat: 0 }, time: '18:00' },
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
    
    if (dayPlan.breakfast && dayPlan.breakfast.name) {
      mealsToAdd.push({ 
        ...dayPlan.breakfast, 
        mealType: 'Breakfast',
        foods: [dayPlan.breakfast.name],
        description: dayPlan.breakfast.name
      })
    }
    if (dayPlan.lunch && dayPlan.lunch.name) {
      mealsToAdd.push({ 
        ...dayPlan.lunch, 
        mealType: 'Lunch',
        foods: [dayPlan.lunch.name],
        description: dayPlan.lunch.name
      })
    }
    if (dayPlan.dinner && dayPlan.dinner.name) {
      mealsToAdd.push({ 
        ...dayPlan.dinner, 
        mealType: 'Dinner',
        foods: [dayPlan.dinner.name],
        description: dayPlan.dinner.name
      })
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
        // Settings not found, use defaults
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
    if (!user) {
      logError('addMeal: No user found')
      throw new Error('User not authenticated')
    }
    try {
      const newMeal = {
        ...meal,
        id: Date.now().toString(),
        mealType: meal.mealType || selectedMealType,
        timestamp: new Date().toISOString()
      }
      
      safeLogDebug('addMeal: Saving meal', newMeal)
      
      // Save to database first
      const { saveMealToSupabase } = await import('../lib/nutritionDb')
      const result = await saveMealToSupabase(user.id, selectedDate, newMeal)
      safeLogDebug('addMeal: Save result', result)
      
      // Reload data from database to ensure consistency
      await loadDateDataFromSupabase(selectedDate)
      safeLogDebug('addMeal: Data reloaded successfully')
    } catch (error) {
      logError('addMeal: Error saving meal to database', error)
      logError('Error saving meal to database', error)
      throw error
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
    if (!manualEntry.calories || manualEntry.calories <= 0) {
      showToast('Please enter calories', 'error')
      return
    }
    
    try {
      const { validateCalories, validateMacro } = await import('../utils/validation')
      const caloriesValidation = validateCalories(manualEntry.calories)
      if (!caloriesValidation.valid) {
        showToast(caloriesValidation.error, 'error')
        return
      }
      const proteinValidation = validateMacro(manualEntry.protein || 0)
      const carbsValidation = validateMacro(manualEntry.carbs || 0)
      const fatValidation = validateMacro(manualEntry.fat || 0)
      if (!proteinValidation.valid || !carbsValidation.valid || !fatValidation.valid) {
        showToast('Please enter valid macro values (0-1000g)', 'error')
        return
      }
      
      await addMeal({
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
      showToast('Meal logged successfully!', 'success')
    } catch (error) {
      // Error already handled in addMeal
      showToast('Failed to log meal. Please try again.', 'error')
    }
  }

  const removeMeal = async (mealId) => {
    if (!user) return
    const meal = meals.find(m => m.id === mealId)
    if (meal) {
      const updatedMeals = meals.filter(m => m.id !== mealId)
      const updatedCalories = Math.max(0, currentCalories - (meal.calories || 0))
      const updatedMacros = {
        protein: Math.max(0, currentMacros.protein - (meal.macros?.protein || 0)),
        carbs: Math.max(0, currentMacros.carbs - (meal.macros?.carbs || 0)),
        fat: Math.max(0, currentMacros.fat - (meal.macros?.fat || 0))
      }
      setMeals(updatedMeals)
      setCurrentCalories(updatedCalories)
      setCurrentMacros(updatedMacros)
      
      // Update history data immediately
      const updatedHistory = {
        ...historyData,
        [selectedDate]: {
          meals: updatedMeals,
          calories: updatedCalories,
          macros: updatedMacros,
          water: waterIntake
        }
      }
      setHistoryData(updatedHistory)
      
      try {
        const { deleteMealFromSupabase } = await import('../lib/nutritionDb')
        await deleteMealFromSupabase(user.id, selectedDate, mealId)
      } catch (error) {
        logError('Error deleting meal from database', error)
        // Fallback to localStorage
        const saved = localStorage.getItem(`ghostMode_${user.id}`)
        const data = saved ? JSON.parse(saved) : {}
        data.historyData = updatedHistory
        localStorage.setItem(`ghostMode_${user.id}`, JSON.stringify(data))
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

  const calculateGoalProgress = (goal, startDate, endDate) => {
    // Calculate total progress for the date range
    let total = 0
    const start = new Date(startDate)
    const end = new Date(endDate)
    const current = new Date(start)
    
    while (current <= end) {
      const dateStr = current.toISOString().split('T')[0]
      const dayData = historyData[dateStr]
      if (dayData) {
        if (goal.type === 'calories') {
          total += dayData.calories || 0
        } else if (goal.type === 'protein') {
          total += dayData.macros?.protein || 0
        } else if (goal.type === 'carbs') {
          total += dayData.macros?.carbs || 0
        } else if (goal.type === 'fat') {
          total += dayData.macros?.fat || 0
        }
      }
      current.setDate(current.getDate() + 1)
    }
    
    return { current: total }
  }

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
        let data
        try {
          data = await response.json()
        } catch (e) {
          logError('Error parsing dietician response', e)
          showToast('Failed to parse response. Please try again.', 'error')
          return
        }
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
        <SideMenu />
        <h1>Nutrition</h1>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <HomeButton />
          {activeTab === 'Today' && (
            <button 
              className={styles.plusBtn}
              onClick={() => setShowManualEntry(true)}
              aria-label="Add meal"
            >
              <span className={styles.plusIcon}>+</span>
            </button>
          )}
        </div>
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
            <div className={styles.logMealActions}>
              <button
                className={styles.logMealBtn}
                onClick={() => {
                  setShowManualEntry(true)
                }}
              >
                Log meal
              </button>
              <button
                className={styles.foodSuggestionsBtn}
                onClick={() => setShowFoodSuggestions(!showFoodSuggestions)}
              >
                {showFoodSuggestions ? 'Hide' : 'Show'} Food Suggestions
              </button>
            </div>

            {/* Food Suggestions */}
            {showFoodSuggestions && foodSuggestions.length > 0 && (
              <div className={styles.foodSuggestionsCard}>
                <h3>Food Suggestions</h3>
                <div className={styles.foodSuggestionsGrid}>
                  {foodSuggestions.map(food => {
                    // Calculate calories and macros for 100g
                    const calories = food.calories_per_100g || 0
                    const protein = food.protein_per_100g || 0
                    const carbs = food.carbs_per_100g || 0
                    const fat = food.fat_per_100g || 0
                    
                    return (
                      <button
                        key={food.id}
                        className={styles.foodSuggestionBtn}
                        onClick={() => {
                          // Add food to meal
                          addMeal({
                            calories: Math.round(calories),
                            macros: {
                              protein: Math.round(protein),
                              carbs: Math.round(carbs),
                              fat: Math.round(fat)
                            },
                            foods: [food.name],
                            type: 'suggestion',
                            description: food.name
                          })
                          setShowFoodSuggestions(false)
                        }}
                      >
                        <div className={styles.foodSuggestionName}>{food.name}</div>
                        <div className={styles.foodSuggestionMacros}>
                          <span>{Math.round(calories)} cal</span>
                          {protein > 0 && <span>P: {Math.round(protein)}g</span>}
                          {carbs > 0 && <span>C: {Math.round(carbs)}g</span>}
                          {fat > 0 && <span>F: {Math.round(fat)}g</span>}
                        </div>
                        {food.isFavorite && <span className={styles.foodSuggestionBadge}>★</span>}
                        {food.isRecent && <span className={styles.foodSuggestionBadge}>Recent</span>}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Calories and Macros vs Goal */}
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

              {/* Share Button */}
              <button
                className={styles.shareBtn}
                onClick={() => setShowShareModal(true)}
              >
                Share Daily Summary
              </button>
            </div>

            {/* Daily Meals Section - Compact */}
            <div className={styles.mealsSection}>
              <h3 className={styles.sectionTitle}>Meals</h3>
              {meals.length === 0 ? (
                <p className={styles.emptyHint}>No meals logged. Tap "Log meal" to add one.</p>
              ) : (
                MEAL_TYPES.map(type => {
                  const typeMeals = mealsByType[type] || []
                  if (typeMeals.length === 0) return null
                  return (
                    <div key={type} className={styles.mealTypeGroup}>
                      <h4 className={styles.mealTypeTitle}>
                        <span className={styles.mealTypeLabel}>{type}</span>
                      </h4>
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
                })
              )}
            </div>

            {/* Goals Section - Compact */}
            {nutritionGoals.length > 0 && (
            <div className={styles.goalsLink}>
              <div className={styles.goalsHeader}>
                <h3>Goals</h3>
                <button
                  className={styles.goalsBtn}
                  onClick={() => navigate('/goals')}
                >
                  View All
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
            )}

            {/* Dietician LLM - Compact */}
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
                  <h3 className={styles.mealSectionTitle}>
                    <span className={styles.mealTypeLabel}>{type}</span>
                  </h3>
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
            <h2 className={styles.sectionTitle}>History</h2>
            <div className={styles.historyTable}>
              <div className={styles.historyTableHeader}>
                <div className={styles.historyTableCol}>Date</div>
                <div className={styles.historyTableCol}>Calories</div>
                <div className={styles.historyTableCol}>Protein</div>
                <div className={styles.historyTableCol}>Carbs</div>
                <div className={styles.historyTableCol}>Fat</div>
                <div className={styles.historyTableCol}>Actions</div>
              </div>
              <div className={styles.historyTableBody}>
                {Object.entries(historyData)
                  .sort((a, b) => b[0].localeCompare(a[0]))
                  .map(([date, data]) => (
                    <div key={date} className={styles.historyTableRow}>
                      <div className={styles.historyTableCol} onClick={() => {
                        setSelectedDate(date)
                        setActiveTab('Today')
                      }}>
                        {new Date(date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </div>
                      <div className={styles.historyTableCol} onClick={() => {
                        setSelectedDate(date)
                        setActiveTab('Today')
                      }}>{data.calories || 0}</div>
                      <div className={styles.historyTableCol} onClick={() => {
                        setSelectedDate(date)
                        setActiveTab('Today')
                      }}>{Math.round(data.macros?.protein || 0)}g</div>
                      <div className={styles.historyTableCol} onClick={() => {
                        setSelectedDate(date)
                        setActiveTab('Today')
                      }}>{Math.round(data.macros?.carbs || 0)}g</div>
                      <div className={styles.historyTableCol} onClick={() => {
                        setSelectedDate(date)
                        setActiveTab('Today')
                      }}>{Math.round(data.macros?.fat || 0)}g</div>
                      <div className={`${styles.historyTableCol} ${styles.actionsCol}`}>
                        <button
                          className={styles.shareBtn}
                          onClick={async (e) => {
                            e.stopPropagation()
                            // Load full meal data for the selected date
                            try {
                              const { getMealsFromSupabase } = await import('../lib/nutritionDb')
                              const dayData = await getMealsFromSupabase(user.id, date)
                              setSelectedNutritionForShare({
                                date,
                                calories: data.calories || 0,
                                protein: data.macros?.protein || 0,
                                carbs: data.macros?.carbs || 0,
                                fat: data.macros?.fat || 0,
                                meals: dayData.meals || [],
                                water: data.water || 0,
                                targetCalories: targetCalories,
                                targetMacros: targetMacros
                              })
                              setShowShareModal(true)
                            } catch (error) {
                              logError('Error loading nutrition data for sharing', error)
                              // Fallback to basic data
                              setSelectedNutritionForShare({
                                date,
                                calories: data.calories || 0,
                                protein: data.macros?.protein || 0,
                                carbs: data.macros?.carbs || 0,
                                fat: data.macros?.fat || 0,
                                meals: [],
                                targetCalories: targetCalories,
                                targetMacros: targetMacros
                              })
                              setShowShareModal(true)
                            }
                          }}
                        >
                          Share
                        </button>
                        <button
                          className={styles.deleteBtn}
                          onClick={async (e) => {
                            e.stopPropagation()
                            if (confirm(`Delete all nutrition data for ${date}?`)) {
                              try {
                                const { deleteMealFromSupabase, getMealsFromSupabase, updateWaterIntake } = await import('../lib/nutritionDb')
                                // Delete all meals for this date
                                const dayData = await getMealsFromSupabase(user.id, date)
                                if (dayData.meals && dayData.meals.length > 0) {
                                  for (const meal of dayData.meals) {
                                    await deleteMealFromSupabase(user.id, date, meal.id)
                                  }
                                }
                                // Clear water intake
                                await updateWaterIntake(user.id, date, 0)
                                // Reload data
                                await loadDateDataFromSupabase(selectedDate)
                                showToast('Nutrition data deleted', 'success')
                              } catch (error) {
                                logError('Error deleting nutrition data', error)
                                showToast('Failed to delete nutrition data', 'error')
                              }
                            }
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                {Object.keys(historyData).length === 0 && (
                  <div className={styles.historyTableEmpty}>No history yet</div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'Plan' && (
          <div className={styles.planContent}>
            <div className={styles.mealPlanSection}>
              <div className={styles.mealPlanHeader}>
                <div>
                  <h3>Weekly Meal Plan</h3>
                  <p className={styles.mealPlanDescription}>
                    Create a structured meal plan for the week and apply it to any day
                  </p>
                </div>
                <div className={styles.mealPlanActions}>
                  {weeklyMealPlan && (
                    <button
                      className={styles.deletePlanBtn}
                      onClick={async () => {
                        if (confirm('Are you sure you want to delete this meal plan?')) {
                          if (user) {
                            try {
                              const { saveWeeklyMealPlanToSupabase } = await import('../lib/nutritionDb')
                              await saveWeeklyMealPlanToSupabase(user.id, null)
                              setWeeklyMealPlan(null)
                            } catch (error) {
                              logError('Error deleting meal plan', error)
                              alert('Failed to delete meal plan')
                            }
                          }
                        }
                      }}
                    >
                      Delete Plan
                    </button>
                  )}
                  <button
                    className={styles.mealPlanBtn}
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
                        {meals.breakfast && meals.breakfast.name && (
                          <div className={styles.mealPlanMealTag}>
                            <span className={styles.mealPlanMealTime}>{meals.breakfast.time || '08:00'}</span>
                            <span className={styles.mealPlanMealName}>{meals.breakfast.name}</span>
                            {meals.breakfast.calories > 0 && (
                              <span className={styles.mealPlanMealMacros}>
                                {meals.breakfast.calories} cal | P: {meals.breakfast.macros?.protein || 0}g C: {meals.breakfast.macros?.carbs || 0}g F: {meals.breakfast.macros?.fat || 0}g
                              </span>
                            )}
                          </div>
                        )}
                        {meals.lunch && meals.lunch.name && (
                          <div className={styles.mealPlanMealTag}>
                            <span className={styles.mealPlanMealTime}>{meals.lunch.time || '12:00'}</span>
                            <span className={styles.mealPlanMealName}>{meals.lunch.name}</span>
                            {meals.lunch.calories > 0 && (
                              <span className={styles.mealPlanMealMacros}>
                                {meals.lunch.calories} cal | P: {meals.lunch.macros?.protein || 0}g C: {meals.lunch.macros?.carbs || 0}g F: {meals.lunch.macros?.fat || 0}g
                              </span>
                            )}
                          </div>
                        )}
                        {meals.dinner && meals.dinner.name && (
                          <div className={styles.mealPlanMealTag}>
                            <span className={styles.mealPlanMealTime}>{meals.dinner.time || '18:00'}</span>
                            <span className={styles.mealPlanMealName}>{meals.dinner.name}</span>
                            {meals.dinner.calories > 0 && (
                              <span className={styles.mealPlanMealMacros}>
                                {meals.dinner.calories} cal | P: {meals.dinner.macros?.protein || 0}g C: {meals.dinner.macros?.carbs || 0}g F: {meals.dinner.macros?.fat || 0}g
                              </span>
                            )}
                          </div>
                        )}
                        {meals.snacks && meals.snacks.length > 0 && (
                          <div className={styles.mealPlanMealTag}>
                            <span className={styles.mealPlanMealName}>Snacks: {meals.snacks.length} item(s)</span>
                          </div>
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

        {activeTab === 'Goals' && (
          <div className={styles.goalsContent}>
            <h2 className={styles.sectionTitle}>Nutrition Goals</h2>
            
            {/* Date Filter */}
            <div className={styles.goalsDateFilter}>
              <label>Date Range:</label>
              <div className={styles.dateRangeInputs}>
                <input
                  type="date"
                  value={goalsStartDate || getTodayEST()}
                  onChange={(e) => setGoalsStartDate(e.target.value)}
                  className={styles.dateInput}
                />
                <span>to</span>
                <input
                  type="date"
                  value={goalsEndDate || getTodayEST()}
                  onChange={(e) => setGoalsEndDate(e.target.value)}
                  className={styles.dateInput}
                />
              </div>
            </div>

            {/* Goals Progress */}
            {nutritionGoals.length === 0 ? (
              <p className={styles.emptyHint}>No nutrition goals set. Create one on the Goals page.</p>
            ) : (
              <div className={styles.goalsList}>
                {nutritionGoals.map(goal => {
                  // Calculate progress for date range
                  const goalProgress = calculateGoalProgress(goal, goalsStartDate || getTodayEST(), goalsEndDate || getTodayEST())
                  const progress = goal.target_value > 0 
                    ? Math.min(100, (goalProgress.current / goal.target_value) * 100) 
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
                        {goalProgress.current} / {goal.target_value} {goal.unit}
                      </div>
                      <div className={styles.goalDateRange}>
                        {new Date(goalsStartDate || getTodayEST()).toLocaleDateString()} - {new Date(goalsEndDate || getTodayEST()).toLocaleDateString()}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Weekly Meal Plan Editor Modal */}
      {showMealPlanEditor && weeklyMealPlan && (
        <div className={styles.overlay} onClick={() => setShowMealPlanEditor(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>Structured Meal Plan</h2>
              <button onClick={() => setShowMealPlanEditor(false)}>X</button>
            </div>
            <div className={styles.modalContent}>
              <div className={styles.mealPlanEditor}>
                {Object.entries(weeklyMealPlan).map(([day, dayMeals]) => (
                  <div key={day} className={styles.mealPlanDayEditor}>
                    <h4>{day}</h4>
                    {['breakfast', 'lunch', 'dinner'].map(mealType => {
                      const meal = dayMeals[mealType] || { name: '', calories: 0, macros: { protein: 0, carbs: 0, fat: 0 }, time: mealType === 'breakfast' ? '08:00' : mealType === 'lunch' ? '12:00' : '18:00' }
                      return (
                        <div key={mealType} className={styles.mealPlanMealInput}>
                          <label className={styles.mealPlanMealLabel}>
                            {mealType.charAt(0).toUpperCase() + mealType.slice(1)}
                          </label>
                          <div className={styles.mealPlanMealFields}>
                            <div className={styles.mealPlanFieldGroup}>
                              <label className={styles.mealPlanFieldLabel}>Meal Name</label>
                              <input
                                type="text"
                                placeholder="e.g., Grilled Chicken & Rice"
                                value={meal.name || ''}
                                onChange={(e) => {
                                  setWeeklyMealPlan(prev => ({
                                    ...prev,
                                    [day]: {
                                      ...prev[day],
                                      [mealType]: { ...meal, name: e.target.value }
                                    }
                                  }))
                                }}
                                className={styles.mealPlanInput}
                              />
                            </div>
                            <div className={styles.mealPlanFieldGroup}>
                              <label className={styles.mealPlanFieldLabel}>Time</label>
                              <input
                                type="time"
                                value={meal.time || (mealType === 'breakfast' ? '08:00' : mealType === 'lunch' ? '12:00' : '18:00')}
                                onChange={(e) => {
                                  setWeeklyMealPlan(prev => ({
                                    ...prev,
                                    [day]: {
                                      ...prev[day],
                                      [mealType]: { ...meal, time: e.target.value }
                                    }
                                  }))
                                }}
                                className={styles.mealPlanTimeInput}
                              />
                            </div>
                            <div className={styles.mealPlanFieldGroup}>
                              <label className={styles.mealPlanFieldLabel}>Calories</label>
                              <input
                                type="number"
                                placeholder="0"
                                value={meal.calories || ''}
                                onChange={(e) => {
                                  setWeeklyMealPlan(prev => ({
                                    ...prev,
                                    [day]: {
                                      ...prev[day],
                                      [mealType]: { ...meal, calories: parseInt(e.target.value) || 0 }
                                    }
                                  }))
                                }}
                                className={styles.mealPlanInput}
                                min="0"
                              />
                            </div>
                            <div className={styles.mealPlanFieldGroup}>
                              <label className={styles.mealPlanFieldLabel}>Protein (g)</label>
                              <input
                                type="number"
                                placeholder="0"
                                value={meal.macros?.protein || ''}
                                onChange={(e) => {
                                  setWeeklyMealPlan(prev => ({
                                    ...prev,
                                    [day]: {
                                      ...prev[day],
                                      [mealType]: { ...meal, macros: { ...meal.macros, protein: parseInt(e.target.value) || 0 } } 
                                    }
                                  }))
                                }}
                                className={styles.mealPlanInput}
                                min="0"
                              />
                            </div>
                            <div className={styles.mealPlanFieldGroup}>
                              <label className={styles.mealPlanFieldLabel}>Carbs (g)</label>
                              <input
                                type="number"
                                placeholder="0"
                                value={meal.macros?.carbs || ''}
                                onChange={(e) => {
                                  setWeeklyMealPlan(prev => ({
                                    ...prev,
                                    [day]: {
                                      ...prev[day],
                                      [mealType]: { ...meal, macros: { ...meal.macros, carbs: parseInt(e.target.value) || 0 } }
                                    }
                                  }))
                                }}
                                className={styles.mealPlanInput}
                                min="0"
                              />
                            </div>
                            <div className={styles.mealPlanFieldGroup}>
                              <label className={styles.mealPlanFieldLabel}>Fat (g)</label>
                              <input
                                type="number"
                                placeholder="0"
                                value={meal.macros?.fat || ''}
                                onChange={(e) => {
                                  setWeeklyMealPlan(prev => ({
                                    ...prev,
                                    [day]: {
                                      ...prev[day],
                                      [mealType]: { ...meal, macros: { ...meal.macros, fat: parseInt(e.target.value) || 0 } }
                                    }
                                  }))
                                }}
                                className={styles.mealPlanInput}
                                min="0"
                              />
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
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

      {/* Log Meal Modal */}
      {showManualEntry && createPortal(
        <>
          <div className={styles.overlay} onClick={() => {
            setShowManualEntry(false)
            setManualEntry({ name: '', calories: '', protein: '', carbs: '', fat: '' })
          }}>
            <div className={styles.modal} onClick={e => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <h2>Log Meal</h2>
                <button onClick={() => {
                  setShowManualEntry(false)
                  setManualEntry({ name: '', calories: '', protein: '', carbs: '', fat: '' })
                }}>✕</button>
              </div>
              <div className={styles.editForm}>
                <div className={styles.formGroup}>
                  <label>Food Name (optional)</label>
                  <input
                    type="text"
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
                <div className={styles.formGroup}>
                  <label>Calories *</label>
                  <input
                    type="number"
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
                <div className={styles.formGroup}>
                  <label>Protein (g)</label>
                  <input
                    type="number"
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
                <div className={styles.formGroup}>
                  <label>Carbs (g)</label>
                  <input
                    type="number"
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
                <div className={styles.formGroup}>
                  <label>Fat (g)</label>
                  <input
                    type="number"
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
                <div className={styles.formActions}>
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
                    className={styles.saveBtn}
                    onClick={async () => {
                      try {
                        await handleManualEntry()
                      } catch (error) {
                        logError('Error in submit button', error)
                        showToast('Failed to log meal. Please check console for details.', 'error')
                      }
                    }}
                    disabled={!manualEntry.calories || manualEntry.calories <= 0}
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>,
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
      {showShareModal && (() => {
        // Use selected nutrition from history, or fallback to current date
        const nutritionToShare = selectedNutritionForShare || {
          date: selectedDate,
          calories: currentCalories,
          protein: currentMacros.protein,
          carbs: currentMacros.carbs,
          fat: currentMacros.fat,
          meals: meals,
          targetCalories: targetCalories,
          targetMacros: targetMacros
        }
        
        return (
          <ShareModal
            type="nutrition"
            data={{
              nutrition: nutritionToShare
            }}
            onClose={() => {
              setShowShareModal(false)
              setSelectedNutritionForShare(null)
            }}
          />
        )
      })()}

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
            {isFavorite ? '*' : '+'}
          </button>
          <button
            className={styles.removeBtn}
            onClick={() => onRemove(meal.id)}
          >
            X
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


