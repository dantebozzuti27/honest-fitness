import { useRef, useEffect } from 'react'
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

  const formatDate = (dateStr) => {
    if (!dateStr) return ''
    const date = new Date(dateStr + 'T12:00:00')
    return date.toLocaleDateString('en-US', { 
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
  }

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
          sets: validSets // Use filtered sets, but keep the exercise
        })
      })
    } else {
      console.warn('ShareCard: workout.exercises is missing or not an array', workout)
    }
    
    const totalExercises = validExercises.length
    
    // Find the longest exercise name to determine minimum column width
    const longestName = validExercises.reduce((max, ex) => {
      const nameLength = (ex.name || 'Exercise').length
      return Math.max(max, nameLength)
    }, 0)
    
    // Card dimensions: ~500px width, ~600px height
    // Header: ~60px, date+stat+count: ~120px, padding: ~32px
    // Available for grid: ~388px height, ~468px width
    const cardWidth = 500
    const cardHeight = 600
    const headerHeight = 60
    const topSectionHeight = 120
    const padding = 32
    const availableWidth = cardWidth - padding
    const availableHeightForGrid = cardHeight - headerHeight - topSectionHeight - padding
    
    // Calculate minimum column width needed for longest name (no wrapping)
    // Estimate: ~6px per character at 10px font size, plus padding
    const minCharWidth = 5.5 // pixels per character at base font size
    const minNameWidth = longestName * minCharWidth + 16 // 16px for padding
    const maxColumnsByWidth = Math.floor(availableWidth / minNameWidth)
    
    // Calculate optimal columns to fit all exercises without scrolling
    // Start with width-based limit, then adjust for height
    let optimalColumns = Math.min(maxColumnsByWidth, Math.max(2, Math.ceil(Math.sqrt(totalExercises))))
    
    // Ensure we have at least 2 columns and at most 5
    optimalColumns = Math.max(2, Math.min(5, optimalColumns))
    
    const rows = Math.ceil(totalExercises / optimalColumns)
    
    // Calculate if we can fit all rows in available height
    // Each row needs: item height + gap
    const baseItemHeight = 40 // padding(8px*2) + name(12px) + setsReps(10px) + gap(2px)
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
    let scaleFactor = 1
    if (finalHeightNeeded > availableHeightForGrid) {
      const maxItemHeight = (availableHeightForGrid - ((finalRows - 1) * gridGapBetweenRows)) / finalRows
      scaleFactor = Math.max(0.7, maxItemHeight / baseItemHeight)
    }
    
    // Calculate sizes with scale factor, ensuring readability
    const exerciseNameSize = Math.max(7, Math.floor(10 * scaleFactor))
    const setsRepsSize = Math.max(6, Math.floor(9 * scaleFactor))
    const itemPadding = Math.max(4, Math.floor(8 * scaleFactor))
    const itemGap = Math.max(2, Math.floor(2 * scaleFactor))
    const gridGap = Math.max(4, Math.floor(6 * scaleFactor))
    
    return (
      <div className={styles.card} ref={cardRef}>
        <div className={styles.cardHeader}>
          <div className={styles.logo}>ECHELON</div>
          <div className={styles.cardType}>WORKOUT</div>
        </div>
        <div className={styles.cardContent}>
          <div className={styles.cardDate}>{formatDate(workout?.date)}</div>
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
                maxHeight: `${availableHeightForGrid}px`,
                overflow: 'hidden'
              }}
            >
              {validExercises.map((ex, idx) => {
                // ex.sets is already filtered to only valid sets (from line 42)
                const sets = ex.sets || []
                const setCount = sets.length
                const isCardio = ex.category === 'Cardio' || ex.category === 'cardio'
                
                // For cardio exercises, show only time (sum all set times)
                // For other exercises, show sets × reps/weight
                let displayValue = null
                let displayLabel = ''
                let displayText = ''
                
                if (isCardio && sets.length > 0) {
                  // Sum all time values for cardio
                  const totalTime = sets.reduce((sum, s) => {
                    const time = s.time != null && s.time !== '' ? Number(s.time) : 0
                    return sum + time
                  }, 0)
                  
                  if (totalTime > 0) {
                    // Format time: convert seconds to MM:SS if > 60 seconds
                    if (totalTime >= 60) {
                      const minutes = Math.floor(totalTime / 60)
                      const seconds = totalTime % 60
                      displayText = `${minutes}:${String(seconds).padStart(2, '0')}`
                    } else {
                      displayText = `${totalTime}s`
                    }
                  } else {
                    displayText = 'No time'
                  }
                } else if (sets.length > 0) {
                  // For non-cardio, show sets × reps/weight
                  const firstSet = sets[0]
                  if (firstSet.reps != null && firstSet.reps !== '') {
                    displayValue = firstSet.reps
                    displayLabel = 'reps'
                    displayText = `${setCount} × ${displayValue} ${displayLabel}`
                  } else if (firstSet.time != null && firstSet.time !== '') {
                    displayValue = Math.round(firstSet.time)
                    displayLabel = 'sec'
                    displayText = `${setCount} × ${displayValue} ${displayLabel}`
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
                
                // Calculate actual item height (no wrapping, single line)
                const nameHeight = exerciseNameSize * 1.2
                const actualItemHeight = (itemPadding * 2) + itemGap + nameHeight + (setsRepsSize * 1.2)
                
                return (
                  <div 
                    key={`${ex.id || ex.name || idx}-${idx}`}
                    className={styles.exerciseItem}
                    style={{
                      padding: `${itemPadding}px ${itemPadding + 2}px`,
                      gap: `${itemGap}px`,
                      minHeight: `${Math.max(30, actualItemHeight)}px`,
                      height: `${actualItemHeight}px`
                    }}
                  >
                    <div 
                      className={styles.exerciseName}
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
          <div className={styles.cardType}>NUTRITION</div>
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
          <div className={styles.cardDate}>{formatDate(nutrition?.date)}</div>
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
          <div className={styles.cardType}>HEALTH</div>
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
          <div className={styles.cardDate}>{formatDate(health?.date)}</div>
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

