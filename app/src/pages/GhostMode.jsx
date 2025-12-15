import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { analyzeMealFromImage, analyzeMealFromText, calculateActivityNeeded } from '../lib/calai'
import { getTodayEST } from '../utils/dateUtils'
import BarChart from '../components/BarChart'
import LineChart from '../components/LineChart'
import { logError } from '../utils/logger'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'
import ConfirmDialog from '../components/ConfirmDialog'
import EmptyState from '../components/EmptyState'
import BackButton from '../components/BackButton'
import TextAreaField from '../components/TextAreaField'
import Button from '../components/Button'
import styles from './GhostMode.module.css'

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

export default function GhostMode() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { toast, showToast, hideToast } = useToast()
  const [confirmState, setConfirmState] = useState({ open: false, title: '', message: '', action: null })
  const [activeTab, setActiveTab] = useState('Today')
  const [targetCalories, setTargetCalories] = useState(2000)
  const [targetMacros, setTargetMacros] = useState({ protein: 150, carbs: 200, fat: 67 })
  const [currentCalories, setCurrentCalories] = useState(0)
  const [currentMacros, setCurrentMacros] = useState({ protein: 0, carbs: 0, fat: 0 })
  const [meals, setMeals] = useState([])
  const [waterIntake, setWaterIntake] = useState(0) // in ml
  const [selectedDate, setSelectedDate] = useState(getTodayEST())
  const [historyData, setHistoryData] = useState({}) // date -> { meals, calories, macros, water }
  const [favorites, setFavorites] = useState([])
  const [analyzing, setAnalyzing] = useState(false)
  const [showTextInput, setShowTextInput] = useState(false)
  const [showQuickAdd, setShowQuickAdd] = useState(false)
  const [showManualEntry, setShowManualEntry] = useState(false)
  const [textInput, setTextInput] = useState('')
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
  const fileInputRef = useRef(null)
  const fastingTimerRef = useRef(null)

  // Load all data
  useEffect(() => {
    if (!user) return
    
    // Load settings from Supabase (with localStorage fallback for migration)
    loadSettings()
    
    // Load meal data from Supabase
    loadDateDataFromSupabase(selectedDate)
  }, [user, selectedDate])
  
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
        // Fallback to localStorage for migration
        const saved = localStorage.getItem(`ghostMode_${user.id}`)
        if (saved) {
          try {
            const data = JSON.parse(saved)
            setTargetCalories(data.targetCalories || 2000)
            setTargetMacros(data.targetMacros || { protein: 150, carbs: 200, fat: 67 })
            setFavorites(data.favorites || [])
            setFastingEnabled(data.fastingEnabled || false)
            if (data.fastingStartTime) {
              setFastingStartTime(new Date(data.fastingStartTime))
            }
            // Migrate to Supabase
            const { saveNutritionSettingsToSupabase } = await import('../lib/nutritionDb')
            await saveNutritionSettingsToSupabase(user.id, {
              targetCalories: data.targetCalories || 2000,
              targetMacros: data.targetMacros || { protein: 150, carbs: 200, fat: 67 },
              favorites: data.favorites || [],
              fastingEnabled: data.fastingEnabled || false,
              fastingStartTime: data.fastingStartTime || null
            })
          } catch (parseError) {
            logError('Error parsing localStorage ghostMode data', parseError)
            localStorage.removeItem(`ghostMode_${user.id}`)
          }
        }
      }
    } catch (error) {
      logError('Error loading settings', error)
      // Fallback to localStorage
      const saved = localStorage.getItem(`ghostMode_${user.id}`)
      if (saved) {
        try {
          const data = JSON.parse(saved)
          setTargetCalories(data.targetCalories || 2000)
          setTargetMacros(data.targetMacros || { protein: 150, carbs: 200, fat: 67 })
          setFavorites(data.favorites || [])
          setFastingEnabled(data.fastingEnabled || false)
          if (data.fastingStartTime) {
            setFastingStartTime(new Date(data.fastingStartTime))
          }
        } catch (parseError) {
          logError('Error parsing localStorage ghostMode data in catch block', parseError)
          localStorage.removeItem(`ghostMode_${user.id}`)
        }
      }
    }
  }
  
  const loadDateDataFromSupabase = async (date) => {
    if (!user) return
    
    try {
      const { getMealsFromSupabase } = await import('../lib/nutritionDb')
      const dayData = await getMealsFromSupabase(user.id, date)
      setMeals(dayData.meals || [])
      setCurrentCalories(dayData.calories || 0)
      setCurrentMacros(dayData.macros || { protein: 0, carbs: 0, fat: 0 })
      setWaterIntake(dayData.water || 0)
      
      // Also load history for analytics
      const { getNutritionRangeFromSupabase } = await import('../lib/nutritionDb')
      const startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      const endDate = getTodayEST()
      const history = await getNutritionRangeFromSupabase(user.id, startDate, endDate)
      
      // Convert to historyData format
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
      // Fallback to localStorage if Supabase fails
      const saved = localStorage.getItem(`ghostMode_${user.id}`)
      if (saved) {
        try {
          const data = JSON.parse(saved)
          const dayData = data.historyData?.[date] || { meals: [], calories: 0, macros: { protein: 0, carbs: 0, fat: 0 }, water: 0 }
          setMeals(dayData.meals || [])
          setCurrentCalories(dayData.calories || 0)
          setCurrentMacros(dayData.macros || { protein: 0, carbs: 0, fat: 0 })
          setWaterIntake(dayData.water || 0)
          setHistoryData(data.historyData || {})
        } catch (parseError) {
          logError('Error parsing localStorage ghostMode data', parseError)
          localStorage.removeItem(`ghostMode_${user.id}`)
        }
      }
    }
  }

  // Fasting timer
  useEffect(() => {
    if (fastingEnabled && fastingStartTime) {
      fastingTimerRef.current = setInterval(() => {
        // Timer updates automatically via state
      }, 1000)
      return () => clearInterval(fastingTimerRef.current)
    }
  }, [fastingEnabled, fastingStartTime])

  const loadDateData = (date) => {
    const dayData = historyData[date] || { meals: [], calories: 0, macros: { protein: 0, carbs: 0, fat: 0 }, water: 0 }
    setMeals(dayData.meals || [])
    setCurrentCalories(dayData.calories || 0)
    setCurrentMacros(dayData.macros || { protein: 0, carbs: 0, fat: 0 })
    setWaterIntake(dayData.water || 0)
  }

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
    
    // Save settings to Supabase
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
      // Fallback to localStorage
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
    
    // Save to Supabase immediately
    try {
      const { saveMealToSupabase } = await import('../lib/nutritionDb')
      await saveMealToSupabase(user.id, selectedDate, newMeal)
    } catch (error) {
      logError('Error saving meal to database', error)
      // Fallback to localStorage if Supabase fails
      setTimeout(() => {
        const dayData = {
          meals: updatedMeals,
          calories: updatedCalories,
          macros: updatedMacros,
          water: waterIntake
        }
        const updatedHistory = {
          ...historyData,
          [selectedDate]: dayData
        }
        setHistoryData(updatedHistory)
        saveData()
      }, 0)
    }
  }

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    setAnalyzing(true)
    try {
      const result = await analyzeMealFromImage(file)
      addMeal({
        calories: result.calories,
        macros: result.macros,
        foods: result.foods,
        type: 'image',
        imageUrl: URL.createObjectURL(file)
      })
    } catch (error) {
      showToast(`Error analyzing meal: ${error.message}`, 'error')
    } finally {
      setAnalyzing(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleTextSubmit = async () => {
    if (!textInput.trim()) return

    setAnalyzing(true)
    try {
      const result = await analyzeMealFromText(textInput)
      addMeal({
        calories: result.calories,
        macros: result.macros,
        foods: result.foods,
        type: 'text',
        description: textInput
      })
      setTextInput('')
      setShowTextInput(false)
    } catch (error) {
      showToast(`Error analyzing meal: ${error.message}`, 'error')
    } finally {
      setAnalyzing(false)
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
    // Import validation dynamically
    try {
      const validationModule = await import('../utils/validation')
      const { validateCalories, validateMacro } = validationModule || {}
      
      // Validate calories
      if (validateCalories && typeof validateCalories === 'function') {
        const caloriesValidation = validateCalories(manualEntry.calories)
        if (!caloriesValidation.valid) {
          showToast(caloriesValidation.error, 'error')
          return
        }
      }
      
      // Validate macros
      if (validateMacro && typeof validateMacro === 'function') {
        const proteinValidation = validateMacro(manualEntry.protein || 0)
        const carbsValidation = validateMacro(manualEntry.carbs || 0)
        const fatValidation = validateMacro(manualEntry.fat || 0)
        
        if (!proteinValidation.valid || !carbsValidation.valid || !fatValidation.valid) {
          showToast('Please enter valid macro values (0-1000g)', 'error')
          return
        }
      }
      
      // Get validated values or use raw values if validation not available
      const validatedCalories = (validateCalories && typeof validateCalories === 'function')
        ? validateCalories(manualEntry.calories).value
        : Number(manualEntry.calories) || 0
      const validatedProtein = (validateMacro && typeof validateMacro === 'function')
        ? validateMacro(manualEntry.protein || 0).value
        : Number(manualEntry.protein) || 0
      const validatedCarbs = (validateMacro && typeof validateMacro === 'function')
        ? validateMacro(manualEntry.carbs || 0).value
        : Number(manualEntry.carbs) || 0
      const validatedFat = (validateMacro && typeof validateMacro === 'function')
        ? validateMacro(manualEntry.fat || 0).value
        : Number(manualEntry.fat) || 0

      addMeal({
        calories: validatedCalories,
        macros: {
          protein: validatedProtein,
          carbs: validatedCarbs,
          fat: validatedFat
        },
        foods: manualEntry.name ? [manualEntry.name] : [],
        description: manualEntry.name || 'Manual entry',
        type: 'manual'
      })

      // Reset form
      setManualEntry({
        name: '',
        calories: '',
        protein: '',
        carbs: '',
        fat: ''
      })
      setShowManualEntry(false)
    } catch (validationError) {
      logError('Error importing or calling validation functions', validationError)
      // Fallback: use raw values without validation
      addMeal({
        calories: Number(manualEntry.calories) || 0,
        macros: {
          protein: Number(manualEntry.protein) || 0,
          carbs: Number(manualEntry.carbs) || 0,
          fat: Number(manualEntry.fat) || 0
        },
        foods: manualEntry.name ? [manualEntry.name] : [],
        description: manualEntry.name || 'Manual entry',
        type: 'manual'
      })
      setManualEntry({ name: '', calories: '', protein: '', carbs: '', fat: '' })
      setShowManualEntry(false)
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
      
      // Delete from Supabase
      try {
        const { deleteMealFromSupabase } = await import('../lib/nutritionDb')
        await deleteMealFromSupabase(user.id, selectedDate, mealId)
      } catch (error) {
        logError('Error deleting meal from database', error)
        // Fallback to localStorage
        setTimeout(() => {
          const dayData = {
            meals: updatedMeals,
            calories: updatedCalories,
            macros: updatedMacros,
            water: waterIntake
          }
          const updatedHistory = {
            ...historyData,
            [selectedDate]: dayData
          }
          setHistoryData(updatedHistory)
          saveData()
        }, 0)
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
    
    // Save to Supabase
    try {
      const { updateWaterIntake } = await import('../lib/nutritionDb')
      await updateWaterIntake(user.id, selectedDate, newAmount)
    } catch (error) {
      // Fallback to localStorage if Supabase fails
      setTimeout(() => {
        const dayData = {
          meals,
          calories: currentCalories,
          macros: currentMacros,
          water: newAmount
        }
        const updatedHistory = {
          ...historyData,
          [selectedDate]: dayData
        }
        setHistoryData(updatedHistory)
        saveData()
      }, 0)
    }
  }

  const resetDay = () => {
    setConfirmState({
      open: true,
      title: 'Reset today?',
      message: 'This will clear meals and water for the selected date.',
      action: 'reset_day'
    })
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

  // Analytics calculations
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

  const activityNeeded = calculateActivityNeeded(currentCalories, targetCalories)
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
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          duration={toast.duration}
          onClose={hideToast}
        />
      )}
      <div className={styles.header}>
        <BackButton fallbackPath="/" />
        <h1>Food Intake</h1>
        {activeTab === 'Today' && (
          <button className={styles.resetBtn} onClick={resetDay}>
            Reset
          </button>
        )}
      </div>

      {/* Tabs */}
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

      <ConfirmDialog
        isOpen={confirmState.open}
        title={confirmState.title}
        message={confirmState.message}
        confirmText={confirmState.action === 'reset_day' ? 'Reset' : 'Confirm'}
        cancelText="Cancel"
        isDestructive={confirmState.action === 'reset_day'}
        onClose={() => setConfirmState({ open: false, title: '', message: '', action: null })}
        onConfirm={() => {
          try {
            if (confirmState.action === 'reset_day') {
              setMeals([])
              setCurrentCalories(0)
              setCurrentMacros({ protein: 0, carbs: 0, fat: 0 })
              setWaterIntake(0)
              saveData()
              showToast('Reset complete', 'success')
            }
          } finally {
            setConfirmState({ open: false, title: '', message: '', action: null })
          }
        }}
      />

      <div className={styles.content}>
        {/* TODAY TAB */}
        {activeTab === 'Today' && (
          <>
            {/* Date Selector */}
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

            {/* Calorie & Macro Summary */}
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

              {/* Macro Progress */}
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

              {/* Water Intake */}
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

              {/* Fasting Timer */}
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
                  <span>{activityNeeded.message}</span>
                </div>
              )}
            </div>

            {/* Quick Actions */}
            <div className={styles.actions}>
              <button
                className={styles.primaryBtn}
                onClick={() => setShowManualEntry(!showManualEntry)}
              >
                ➕ Add Meal
              </button>
              <button
                className={styles.secondaryBtn}
                onClick={() => setShowQuickAdd(!showQuickAdd)}
              >
                Quick Add
              </button>
              {!fastingEnabled && (
                <button
                  className={styles.secondaryBtn}
                  onClick={startFasting}
                >
                  Start Fast
                </button>
              )}
            </div>

            {/* AI Options (Optional) */}
            <div className={styles.aiOptions}>
              <div className={styles.aiOptionsHeader}>
                <span className={styles.aiOptionsLabel}>AI Analysis (Optional)</span>
              </div>
              <div className={styles.aiOptionsButtons}>
                <button
                  className={styles.aiBtn}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={analyzing}
                >
                  {analyzing ? 'Analyzing...' : 'Analyze Photo'}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleImageUpload}
                  style={{ display: 'none' }}
                />
                <button
                  className={styles.aiBtn}
                  onClick={() => setShowTextInput(!showTextInput)}
                >
                  Analyze Text
                </button>
              </div>
            </div>

            {/* Manual Entry Form */}
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
                      onChange={(e) => setManualEntry({ ...manualEntry, name: e.target.value })}
                    />
                  </div>
                  <div className={styles.formRow}>
                    <label>Calories *</label>
                    <input
                      type="number"
                      className={styles.formInput}
                      placeholder="0"
                      value={manualEntry.calories}
                      onChange={(e) => setManualEntry({ ...manualEntry, calories: e.target.value })}
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
                        onChange={(e) => setManualEntry({ ...manualEntry, protein: e.target.value })}
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
                        onChange={(e) => setManualEntry({ ...manualEntry, carbs: e.target.value })}
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
                        onChange={(e) => setManualEntry({ ...manualEntry, fat: e.target.value })}
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
                      onClick={() => {
                        if (handleManualEntry && typeof handleManualEntry === 'function') {
                          handleManualEntry()
                        }
                      }}
                      disabled={!manualEntry.calories || manualEntry.calories <= 0}
                    >
                      Add Meal
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Meal Type Selector */}
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

            {/* Quick Add Foods */}
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

            {/* Text Input */}
            {showTextInput && (
              <div className={styles.textInputCard}>
                <TextAreaField
                  className={styles.textInput}
                  placeholder="Describe your meal..."
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  rows={3}
                />
                <div className={styles.textInputActions}>
                  <Button
                    unstyled
                    className={styles.cancelBtn}
                    onClick={() => {
                      setShowTextInput(false)
                      setTextInput('')
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    unstyled
                    className={styles.submitBtn}
                    onClick={() => {
                      if (handleTextSubmit && typeof handleTextSubmit === 'function') {
                        handleTextSubmit()
                      }
                    }}
                    disabled={!textInput.trim() || analyzing}
                  >
                    Analyze
                  </Button>
                </div>
              </div>
            )}

            {/* Meals by Type */}
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
              <EmptyState
                title="No meals logged today"
                message="Add your first meal, or use AI analysis for quick entry."
                actionLabel="Add meal"
                onAction={() => setShowManualEntry(true)}
              />
            )}
          </>
        )}

        {/* HISTORY TAB */}
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
                <EmptyState
                  title="No history yet"
                  message="Start logging meals to build your history."
                  actionLabel="Add meal"
                  onAction={() => {
                    setActiveTab('Today')
                    setShowManualEntry(true)
                  }}
                />
              )}
            </div>
          </div>
        )}

        {/* ANALYTICS TAB */}
        {activeTab === 'Analytics' && (
          <div className={styles.analyticsContent}>
            <h2>Nutrition Analytics</h2>
            
            {/* Weekly Calories */}
            <div className={styles.chartCard}>
              <h3>Weekly Calories</h3>
              <LineChart
                data={weeklyData.calories}
                labels={weeklyData.dates.map(d => {
                  const date = new Date(d)
                  return `${date.getMonth() + 1}/${date.getDate()}`
                })}
                height={150}
                color="#ff2d2d"
              />
            </div>

            {/* Macro Distribution */}
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

            {/* Weekly Macros */}
            <div className={styles.chartCard}>
              <h3>Weekly Protein</h3>
              <BarChart
                data={Object.fromEntries(weeklyData.dates.map((d, i) => {
                  const date = new Date(d)
                  return [`${date.getMonth() + 1}/${date.getDate()}`, weeklyData.proteins[i]]
                }))}
                height={150}
                color="#4CAF50"
              />
            </div>
          </div>
        )}

        {/* SETTINGS TAB */}
        {activeTab === 'Settings' && (
          <div className={styles.settingsContent}>
            <h2>Settings</h2>
            
            <div className={styles.settingsSection}>
              <h3>Calorie & Macro Goals</h3>
              <div className={styles.settingItem}>
                <label>Target Calories</label>
                <input
                  type="number"
                  value={targetCalories}
                  onChange={(e) => {
                    setTargetCalories(parseInt(e.target.value) || 2000)
                    saveData()
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
                    saveData()
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
                    saveData()
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
                    saveData()
                  }}
                  min="0"
                  max="500"
                />
              </div>
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
