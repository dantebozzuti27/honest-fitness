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
    
    // Get valid exercises with actual data
    const validExercises = []
    if (workout?.exercises) {
      workout.exercises.forEach(ex => {
        const validSets = (ex.sets || []).filter(s => s.weight || s.reps || s.time)
        if (validSets.length > 0) {
          validExercises.push({
            ...ex,
            sets: validSets
          })
        }
      })
    }
    
    const totalExercises = validExercises.length
    
    // Calculate optimal layout to fit all exercises without scrolling
    // Card height: ~500-600px, header: ~60px, date+stat+count: ~120px, padding: ~24px
    // Available for grid: ~300-400px
    // Calculate optimal columns to minimize rows while fitting width
    let optimalColumns = 2
    if (totalExercises > 18) {
      optimalColumns = 5 // 20 exercises = 4 rows
    } else if (totalExercises > 15) {
      optimalColumns = 4 // 16 exercises = 4 rows
    } else if (totalExercises > 12) {
      optimalColumns = 4 // 13-15 exercises = 3-4 rows
    } else if (totalExercises > 9) {
      optimalColumns = 3 // 10-12 exercises = 3-4 rows
    } else if (totalExercises > 6) {
      optimalColumns = 3 // 7-9 exercises = 2-3 rows
    } else {
      optimalColumns = 2 // 1-6 exercises = 1-3 rows
    }
    
    const rows = Math.ceil(totalExercises / optimalColumns)
    
    // Calculate scale factor based on number of rows
    // More rows = smaller items to fit everything
    // Available height: ~350px, need to fit all rows
    const estimatedAvailableHeight = 350
    const maxRowHeight = estimatedAvailableHeight / Math.max(rows, 1)
    
    // Base item height estimate: padding(12px) + gap(3px) + name(12px) + setsReps(10px) = ~37px
    // Plus grid gap between rows: ~6px
    const baseItemHeight = 37
    const gridGapBetweenRows = 6
    const maxItemHeight = maxRowHeight - gridGapBetweenRows
    
    // Scale factor: if we need items smaller than base, scale down
    const scaleFactor = Math.min(1, maxItemHeight / baseItemHeight)
    
    // Calculate sizes with minimums to ensure readability
    const exerciseNameSize = Math.max(6, Math.floor(10 * scaleFactor))
    const setsRepsSize = Math.max(5, Math.floor(9 * scaleFactor))
    const itemPadding = Math.max(3, Math.floor(6 * scaleFactor))
    const itemGap = Math.max(2, Math.floor(3 * scaleFactor))
    const gridGap = Math.max(3, Math.floor(6 * scaleFactor))
    
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
                gridTemplateColumns: `repeat(${optimalColumns}, 1fr)`
              }}
            >
              {validExercises.map((ex, idx) => {
                // ex.sets is already filtered to only valid sets (from line 42)
                const sets = ex.sets || []
                const setCount = sets.length
                
                // Get display value - prefer reps, then time, then weight
                let displayValue = null
                let displayLabel = ''
                
                if (sets.length > 0) {
                  const firstSet = sets[0]
                  if (firstSet.reps != null && firstSet.reps !== '') {
                    displayValue = firstSet.reps
                    displayLabel = 'reps'
                  } else if (firstSet.time != null && firstSet.time !== '') {
                    displayValue = Math.round(firstSet.time)
                    displayLabel = 'sec'
                  } else if (firstSet.weight != null && firstSet.weight !== '') {
                    displayValue = firstSet.weight
                    displayLabel = 'lbs'
                  }
                }
                
                // Always show exercise if it has sets (even if we can't format the value)
                // Calculate actual item height based on content
                const actualItemHeight = (itemPadding * 2) + itemGap + (exerciseNameSize * 1.2) + (setsRepsSize * 1.2)
                
                return (
                  <div 
                    key={`${ex.id || ex.name || idx}-${idx}`}
                    className={styles.exerciseItem}
                    style={{
                      padding: `${itemPadding}px ${itemPadding + 2}px`,
                      gap: `${itemGap}px`,
                      minHeight: `${Math.max(25, actualItemHeight)}px`
                    }}
                  >
                    <div 
                      className={styles.exerciseName}
                      style={{ fontSize: `${exerciseNameSize}px` }}
                    >
                      {ex.name || 'Exercise'}
                    </div>
                    {setCount > 0 && displayValue != null ? (
                      <div 
                        className={styles.setsReps}
                        style={{ fontSize: `${setsRepsSize}px` }}
                      >
                        {setCount} × {displayValue} {displayLabel}
                      </div>
                    ) : (
                      <div 
                        className={styles.setsReps}
                        style={{ fontSize: `${setsRepsSize}px` }}
                      >
                        {setCount} sets
                      </div>
                    )}
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

