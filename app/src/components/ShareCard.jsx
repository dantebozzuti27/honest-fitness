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
    
    // Calculate REAL stats from actual data
    let totalSets = 0
    let totalReps = 0
    let totalVolume = 0
    let maxWeight = 0
    const validExercises = []
    
    if (workout?.exercises) {
      workout.exercises.forEach(ex => {
        const validSets = (ex.sets || []).filter(s => s.weight || s.reps || s.time)
        if (validSets.length > 0) {
          validExercises.push(ex)
          totalSets += validSets.length
          
          validSets.forEach(set => {
            const weight = Number(set.weight) || 0
            const reps = Number(set.reps) || 0
            
            if (reps > 0) {
              totalReps += reps
              const volume = weight * reps
              totalVolume += volume
            }
            
            if (weight > maxWeight) {
              maxWeight = weight
            }
          })
        }
      })
    }
    
    const totalExercises = validExercises.length
    const isLongWorkout = totalExercises > 6
    const avgWeight = totalSets > 0 && totalReps > 0 ? Math.round(totalVolume / totalReps) : 0
    
    return (
      <div className={styles.card} ref={cardRef}>
        <div className={styles.cardHeader}>
          <div className={styles.logo}>ECHELON</div>
          <div className={styles.cardType}>WORKOUT</div>
        </div>
        <div className={styles.cardContent}>
          <div className={styles.mainStat}>
            <div className={styles.statValue}>{formatDuration(workout?.duration)}</div>
            <div className={styles.statLabel}>Duration</div>
          </div>
          <div className={styles.statsGrid}>
            {totalExercises > 0 && (
              <div className={styles.statItem}>
                <div className={styles.statValueSmall}>{totalExercises}</div>
                <div className={styles.statLabelSmall}>Exercises</div>
              </div>
            )}
            {totalSets > 0 && (
              <div className={styles.statItem}>
                <div className={styles.statValueSmall}>{totalSets}</div>
                <div className={styles.statLabelSmall}>Sets</div>
              </div>
            )}
            {totalReps > 0 && (
              <div className={styles.statItem}>
                <div className={styles.statValueSmall}>{totalReps}</div>
                <div className={styles.statLabelSmall}>Reps</div>
              </div>
            )}
            {totalVolume > 0 && (
              <div className={styles.statItem}>
                <div className={styles.statValueSmall}>
                  {totalVolume >= 1000 ? `${Math.round(totalVolume / 1000)}k` : totalVolume}
                </div>
                <div className={styles.statLabelSmall}>Volume</div>
              </div>
            )}
            {maxWeight > 0 && (
              <div className={styles.statItem}>
                <div className={styles.statValueSmall}>{maxWeight}</div>
                <div className={styles.statLabelSmall}>Max</div>
              </div>
            )}
            {workout?.perceivedEffort && workout.perceivedEffort > 0 && (
              <div className={styles.statItem}>
                <div className={styles.statValueSmall}>{workout.perceivedEffort}/10</div>
                <div className={styles.statLabelSmall}>RPE</div>
              </div>
            )}
          </div>
          {validExercises.length > 0 && (
            <div className={styles.exercisesList}>
              {validExercises.map((ex, idx) => {
                const validSets = (ex.sets || []).filter(s => s.weight || s.reps || s.time)
                const setsInfo = validSets.map((set, setIdx) => {
                  const parts = []
                  if (set.weight) parts.push(`${set.weight}lbs`)
                  if (set.reps) parts.push(`${set.reps}`)
                  if (set.time) {
                    const mins = Math.floor(set.time / 60)
                    const secs = set.time % 60
                    parts.push(`${mins}:${String(secs).padStart(2, '0')}`)
                  }
                  return parts.length > 0 ? parts.join('×') : null
                }).filter(Boolean)
                
                // Show more sets for shorter workouts, fewer for longer ones
                const maxSetsToShow = isLongWorkout ? 3 : 5
                
                return (
                  <div key={idx} className={styles.exerciseItem}>
                    <div className={styles.exerciseHeader}>
                      <span className={styles.exerciseName}>{ex.name}</span>
                      <span className={styles.exerciseSetCount}>{validSets.length}s</span>
                    </div>
                    {setsInfo.length > 0 && (
                      <div className={styles.exerciseSets}>
                        {setsInfo.slice(0, maxSetsToShow).map((info, i) => (
                          <span key={i} className={styles.setInfo}>{info}</span>
                        ))}
                        {setsInfo.length > maxSetsToShow && (
                          <span className={styles.moreSets}>+{setsInfo.length - maxSetsToShow}</span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          <div className={styles.cardDate}>{formatDate(workout?.date)}</div>
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

