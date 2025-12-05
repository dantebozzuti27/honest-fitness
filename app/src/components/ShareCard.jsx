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
    // Adjust display based on workout length - show fewer exercises if very long
    const maxExercisesToShow = totalExercises > 8 ? 6 : totalExercises > 5 ? 7 : totalExercises
    const isLongWorkout = totalExercises > 5
    
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
          {totalExercises > 0 && (
            <div className={styles.statsGrid}>
              <div className={styles.statItem}>
                <div className={styles.statValueSmall}>{totalExercises}</div>
                <div className={styles.statLabelSmall}>Exercises</div>
              </div>
              {workout?.perceivedEffort && workout.perceivedEffort > 0 && (
                <div className={styles.statItem}>
                  <div className={styles.statValueSmall}>{workout.perceivedEffort}/10</div>
                  <div className={styles.statLabelSmall}>RPE</div>
                </div>
              )}
            </div>
          )}
          {validExercises.length > 0 && (
            <div className={styles.exercisesList}>
              {validExercises.slice(0, maxExercisesToShow).map((ex, idx) => {
                const sets = ex.sets || []
                
                // Calculate exercise-specific stats
                let exerciseReps = 0
                let exerciseVolume = 0
                let exerciseMaxWeight = 0
                
                sets.forEach(set => {
                  const weight = Number(set.weight) || 0
                  const reps = Number(set.reps) || 0
                  
                  if (reps > 0) {
                    exerciseReps += reps
                    exerciseVolume += weight * reps
                  }
                  
                  if (weight > exerciseMaxWeight) {
                    exerciseMaxWeight = weight
                  }
                })
                
                const setsInfo = sets.map((set, setIdx) => {
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
                
                // Show all sets but limit display based on workout length
                const maxSetsToShow = isLongWorkout ? 2 : 4
                
                return (
                  <div key={idx} className={styles.exerciseItem}>
                    <div className={styles.exerciseHeader}>
                      <span className={styles.exerciseName}>{ex.name}</span>
                      <div className={styles.exerciseStats}>
                        {sets.length > 0 && (
                          <span className={styles.exerciseSetCount}>{sets.length}s</span>
                        )}
                        {exerciseReps > 0 && (
                          <span className={styles.exerciseReps}>{exerciseReps}r</span>
                        )}
                        {exerciseMaxWeight > 0 && (
                          <span className={styles.exerciseMax}>{exerciseMaxWeight}lbs</span>
                        )}
                      </div>
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
              {totalExercises > maxExercisesToShow && (
                <div className={styles.moreExercises}>+{totalExercises - maxExercisesToShow} more</div>
              )}
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

