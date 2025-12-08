import { useRef, useEffect } from 'react'
import { formatDateMMDDYYYY } from '../utils/dateUtils'
import styles from './ShareCard.module.css'

export default function ShareCard({ type, data }) {
  const cardRef = useRef(null)

  const formatDuration = (seconds) => {
    // Duration is stored in SECONDS, not minutes
    if (!seconds) return '0m'
    const totalSeconds = Number(seconds)
    const totalMinutes = Math.floor(totalSeconds / 60)
    const hours = Math.floor(totalMinutes / 60)
    const mins = totalMinutes % 60
    if (hours > 0) {
      return `${hours}h ${mins}m`
    }
    return `${mins}m`
  }

  const formatDate = formatDateMMDDYYYY

  const renderWorkoutCard = () => {
    const { workout } = data
    
    // DEBUG: Log the exact data received
    console.log('ShareCard: Received workout data:', {
      exerciseCount: workout?.exercises?.length || 0,
      exercises: workout?.exercises?.map(ex => ({
        name: ex.name,
        setCount: ex.sets?.length || 0,
        sets: ex.sets
      })) || []
    })
    
    // IMPORTANT: Show ALL exercises from the workout, don't filter any out
    // Only filter sets to show valid ones, but keep all exercises
    const validExercises = []
    if (workout?.exercises && Array.isArray(workout.exercises)) {
      workout.exercises.forEach((ex, exIdx) => {
        if (!ex || !ex.name) {
          console.warn(`ShareCard: Exercise at index ${exIdx} is missing name`, ex)
          return
        }
        
        const sets = ex.sets || []
        // Filter sets: include if weight, reps, or time is not null/undefined/empty string
        // NOTE: 0 is a valid value, so check for != null and != ''
        const validSets = sets.filter(s => {
          if (!s) return false
          const hasWeight = s.weight != null && s.weight !== ''
          const hasReps = s.reps != null && s.reps !== ''
          const hasTime = s.time != null && s.time !== ''
          return hasWeight || hasReps || hasTime
        })
        
        // ALWAYS include the exercise, even if it has no valid sets
        // This ensures ALL exercises from the logged workout are shown
        validExercises.push({
          ...ex,
          sets: validSets, // Use filtered sets, but keep the exercise
          stacked: ex.stacked || false,
          stackGroup: ex.stackGroup || null
        })
      })
    } else {
      console.warn('ShareCard: workout.exercises is missing or not an array', workout)
    }
    
    const totalExercises = validExercises.length
    
    // Card dimensions: ~500px width, ~600px height
    // Header: ~60px, stat+count: ~80px, padding: ~32px
    // Available for grid: ~428px height, ~468px width (more space since date moved to header)
    const cardWidth = 500
    const cardHeight = 600
    const headerHeight = 60
    const topSectionHeight = 80 // Reduced since date is in header now
    const padding = 32
    const availableWidth = cardWidth - padding * 2
    const availableHeightForGrid = cardHeight - headerHeight - topSectionHeight - padding - 16 // Extra 16px for bottom padding
    
    // Use CSS Grid with auto-fit and minmax for responsive columns
    // Minimum column width: 100px (enough for most exercise names with truncation)
    // Maximum: 1fr (equal distribution)
    const minColumnWidth = 100
    const maxColumnsByWidth = Math.floor(availableWidth / minColumnWidth)
    
    // Calculate optimal columns to fit all exercises
    // Start with a reasonable default based on exercise count
    let optimalColumns = Math.max(2, Math.min(maxColumnsByWidth, Math.ceil(Math.sqrt(totalExercises))))
    optimalColumns = Math.max(2, Math.min(5, optimalColumns))
    
    const rows = Math.ceil(totalExercises / optimalColumns)
    
    // Calculate if we can fit all rows in available height
    // Base item height: padding(8px*2) + name(12px*1.2) + setsReps(10px*1.2) + gap(2px) = ~40px
    const baseItemHeight = 40
    const gridGapBetweenRows = 6
    const totalHeightNeeded = (rows * baseItemHeight) + ((rows - 1) * gridGapBetweenRows)
    
    // If we need more height than available, reduce columns to fit more rows
    if (totalHeightNeeded > availableHeightForGrid && optimalColumns > 2) {
      // Try reducing columns to fit height
      for (let cols = optimalColumns - 1; cols >= 2; cols--) {
        const testRows = Math.ceil(totalExercises / cols)
        const testHeight = (testRows * baseItemHeight) + ((testRows - 1) * gridGapBetweenRows)
        if (testHeight <= availableHeightForGrid) {
          optimalColumns = cols
          break
        }
      }
    }
    
    // Recalculate rows with final column count
    const finalRows = Math.ceil(totalExercises / optimalColumns)
    const finalHeightNeeded = (finalRows * baseItemHeight) + ((finalRows - 1) * gridGapBetweenRows)
    
    // Calculate scale factor if we need to shrink to fit height
    // Minimum font sizes: 10px for names, 8px for sets/reps (readable minimums)
    let scaleFactor = 1
    if (finalHeightNeeded > availableHeightForGrid) {
      const maxItemHeight = (availableHeightForGrid - ((finalRows - 1) * gridGapBetweenRows)) / finalRows
      scaleFactor = Math.max(0.8, maxItemHeight / baseItemHeight) // Don't go below 80% scale
    }
    
    // Calculate sizes with scale factor, ensuring minimum readability
    const exerciseNameSize = Math.max(10, Math.floor(12 * scaleFactor)) // Min 10px
    const setsRepsSize = Math.max(8, Math.floor(10 * scaleFactor)) // Min 8px
    const itemPadding = Math.max(6, Math.floor(8 * scaleFactor))
    const itemGap = Math.max(2, Math.floor(2 * scaleFactor))
    const gridGap = Math.max(4, Math.floor(6 * scaleFactor))
    
    return (
      <div className={styles.card} ref={cardRef}>
        <div className={styles.cardHeader}>
          <div className={styles.logo}>ECHELON</div>
          <div className={styles.headerRight}>
            <div className={styles.cardType}>WORKOUT</div>
            <div className={styles.cardDateHeader}>{formatDate(workout?.date)}</div>
          </div>
        </div>
        <div className={styles.cardContent}>
          <div className={styles.mainStat}>
            <div className={styles.statValue}>{formatDuration(workout?.duration)}</div>
            <div className={styles.statLabel}>Duration</div>
          </div>
          {totalExercises > 0 && (
            <div className={styles.exerciseCount}>
              {totalExercises} {totalExercises === 1 ? 'Exercise' : 'Exercises'}
            </div>
          )}
          {validExercises.length > 0 && (
            <div 
              className={styles.exercisesGrid}
              style={{
                gap: `${gridGap}px`,
                gridTemplateColumns: `repeat(${optimalColumns}, 1fr)`,
                height: `${availableHeightForGrid}px`,
                overflow: 'hidden'
              }}
            >
              {validExercises.map((ex, idx) => {
                // ex.sets is already filtered to only valid sets (from line 42)
                const sets = ex.sets || []
                const setCount = sets.length
                const isCardio = ex.category === 'Cardio' || ex.category === 'cardio'
                
                // Determine if this exercise is part of a stack (superset or circuit)
                const isStacked = ex.stacked && ex.stackGroup
                let stackLabel = null
                if (isStacked) {
                  // Find all exercises in the same stack group
                  const stackMembers = validExercises.filter(e => 
                    e.stacked && e.stackGroup === ex.stackGroup
                  )
                  const stackIndex = stackMembers.findIndex(e => e.name === ex.name)
                  if (stackMembers.length === 2) {
                    stackLabel = `Superset ${stackIndex + 1}/2`
                  } else if (stackMembers.length >= 3) {
                    stackLabel = `Circuit ${stackIndex + 1}/${stackMembers.length}`
                  }
                }
                
                // For cardio exercises, show only time (sum all set times)
                // For other exercises, show sets × reps/weight
                let displayValue = null
                let displayLabel = ''
                let displayText = ''
                
                if (isCardio && sets.length > 0) {
                  // Sum all time values for cardio (time is stored in seconds)
                  const totalTimeSeconds = sets.reduce((sum, s) => {
                    const time = s.time != null && s.time !== '' ? Number(s.time) : 0
                    return sum + time
                  }, 0)
                  
                  if (totalTimeSeconds > 0) {
                    // Convert seconds to minutes (round to 1 decimal place)
                    const totalMinutes = (totalTimeSeconds / 60).toFixed(1)
                    displayText = `${totalMinutes} min`
                  } else {
                    displayText = 'No time'
                  }
                } else if (sets.length > 0) {
                  // For non-cardio, show sets × reps/weight
                  const firstSet = sets[0]
                  const isRecovery = ex.category === 'Recovery' || ex.category === 'recovery'
                  
                  if (firstSet.reps != null && firstSet.reps !== '') {
                    displayValue = firstSet.reps
                    displayLabel = 'reps'
                    displayText = `${setCount} × ${displayValue} ${displayLabel}`
                  } else if (firstSet.time != null && firstSet.time !== '') {
                    // For recovery exercises or any timed exercises, show minutes
                    const timeSeconds = Number(firstSet.time)
                    if (isRecovery || timeSeconds >= 60) {
                      const minutes = (timeSeconds / 60).toFixed(1)
                      displayLabel = 'min'
                      displayText = `${setCount} × ${minutes} ${displayLabel}`
                    } else {
                      // For very short times (< 60s), show seconds
                      displayValue = Math.round(timeSeconds)
                      displayLabel = 'sec'
                      displayText = `${setCount} × ${displayValue} ${displayLabel}`
                    }
                  } else if (firstSet.weight != null && firstSet.weight !== '') {
                    displayValue = firstSet.weight
                    displayLabel = 'lbs'
                    displayText = `${setCount} × ${displayValue} ${displayLabel}`
                  } else {
                    displayText = `${setCount} sets`
                  }
                } else {
                  displayText = 'No sets'
                }
                
                return (
                  <div 
                    key={`${ex.id || ex.name || idx}-${idx}`}
                    className={styles.exerciseItem}
                    style={{
                      padding: `${itemPadding}px ${itemPadding + 2}px`,
                      gap: `${itemGap}px`
                    }}
                  >
                    {stackLabel && (
                      <div 
                        className={styles.stackLabel}
                        style={{ fontSize: `${Math.max(5, Math.floor(exerciseNameSize * 0.7))}px` }}
                      >
                        {stackLabel}
                      </div>
                    )}
                    <div 
                      className={`${styles.exerciseName} truncate`}
                      style={{ 
                        fontSize: `${exerciseNameSize}px`,
                        maxWidth: '100%'
                      }}
                      title={ex.name || 'Exercise'}
                    >
                      {ex.name || 'Exercise'}
                    </div>
                    <div 
                      className={styles.setsReps}
                      style={{ fontSize: `${setsRepsSize}px` }}
                    >
                      {displayText}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    )
  }

  const renderNutritionCard = () => {
    const { nutrition } = data
    
    // Calculate REAL stats from actual meals
    let totalCalories = 0
    let totalProtein = 0
    let totalCarbs = 0
    let totalFat = 0
    
    if (nutrition?.meals && Array.isArray(nutrition.meals)) {
      nutrition.meals.forEach(meal => {
        totalCalories += Number(meal.calories) || 0
        if (meal.macros) {
          totalProtein += Number(meal.macros.protein) || 0
          totalCarbs += Number(meal.macros.carbs) || 0
          totalFat += Number(meal.macros.fat) || 0
        }
      })
    }
    
    // Use calculated values or fallback to direct values
    const calories = totalCalories || Number(nutrition?.calories) || 0
    const protein = totalProtein || Number(nutrition?.protein) || 0
    const carbs = totalCarbs || Number(nutrition?.carbs) || 0
    const fat = totalFat || Number(nutrition?.fat) || 0
    
    return (
      <div className={styles.card} ref={cardRef}>
        <div className={styles.cardHeader}>
          <div className={styles.logo}>ECHELON</div>
          <div className={styles.headerRight}>
            <div className={styles.cardType}>NUTRITION</div>
            <div className={styles.cardDateHeader}>{formatDate(nutrition?.date)}</div>
          </div>
        </div>
        <div className={styles.cardContent}>
          <div className={styles.mainStat}>
            <div className={styles.statValue}>{calories > 0 ? calories.toLocaleString() : '—'}</div>
            <div className={styles.statLabel}>Calories</div>
          </div>
          <div className={styles.macrosGrid}>
            {protein > 0 && (
              <div className={styles.macroItem}>
                <div className={styles.macroValue}>{Math.round(protein)}g</div>
                <div className={styles.macroLabel}>Protein</div>
              </div>
            )}
            {carbs > 0 && (
              <div className={styles.macroItem}>
                <div className={styles.macroValue}>{Math.round(carbs)}g</div>
                <div className={styles.macroLabel}>Carbs</div>
              </div>
            )}
            {fat > 0 && (
              <div className={styles.macroItem}>
                <div className={styles.macroValue}>{Math.round(fat)}g</div>
                <div className={styles.macroLabel}>Fat</div>
              </div>
            )}
          </div>
          {nutrition?.meals && nutrition.meals.length > 0 && (
            <div className={styles.mealsList}>
              {nutrition.meals.slice(0, 4).map((meal, idx) => (
                <div key={idx} className={styles.mealItem}>
                  <span className={styles.mealName}>{meal.name || meal.meal_type}</span>
                  {meal.calories && (
                    <span className={styles.mealCalories}>{meal.calories} cal</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  const renderHealthCard = () => {
    const { health } = data
    const { steps, hrv, sleep_time, calories_burned, weight } = health || {}
    
    return (
      <div className={styles.card} ref={cardRef}>
        <div className={styles.cardHeader}>
          <div className={styles.logo}>ECHELON</div>
          <div className={styles.headerRight}>
            <div className={styles.cardType}>HEALTH</div>
            <div className={styles.cardDateHeader}>{formatDate(health?.date)}</div>
          </div>
        </div>
        <div className={styles.cardContent}>
          <div className={styles.healthStatsGrid}>
            {steps && (
              <div className={styles.healthStat}>
                <div className={styles.healthStatValue}>{steps.toLocaleString()}</div>
                <div className={styles.healthStatLabel}>Steps</div>
              </div>
            )}
            {hrv && (
              <div className={styles.healthStat}>
                <div className={styles.healthStatValue}>{Math.round(hrv)}</div>
                <div className={styles.healthStatLabel}>HRV (ms)</div>
              </div>
            )}
            {sleep_time && (
              <div className={styles.healthStat}>
                <div className={styles.healthStatValue}>
                  {Math.floor(sleep_time / 60)}:{String(Math.round(sleep_time % 60)).padStart(2, '0')}
                </div>
                <div className={styles.healthStatLabel}>Sleep</div>
              </div>
            )}
            {calories_burned && (
              <div className={styles.healthStat}>
                <div className={styles.healthStatValue}>{calories_burned.toLocaleString()}</div>
                <div className={styles.healthStatLabel}>Calories</div>
              </div>
            )}
            {weight && (
              <div className={styles.healthStat}>
                <div className={styles.healthStatValue}>{weight}</div>
                <div className={styles.healthStatLabel}>Weight (lbs)</div>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.shareCardContainer}>
      {type === 'workout' && renderWorkoutCard()}
      {type === 'nutrition' && renderNutritionCard()}
      {type === 'health' && renderHealthCard()}
    </div>
  )
}

