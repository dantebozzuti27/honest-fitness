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
    const totalSets = workout?.exercises?.reduce((sum, ex) => sum + (ex.sets?.length || 0), 0) || 0
    const totalExercises = workout?.exercises?.length || 0
    
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
            <div className={styles.statItem}>
              <div className={styles.statValueSmall}>{totalExercises}</div>
              <div className={styles.statLabelSmall}>Exercises</div>
            </div>
            <div className={styles.statItem}>
              <div className={styles.statValueSmall}>{totalSets}</div>
              <div className={styles.statLabelSmall}>Sets</div>
            </div>
            {workout?.perceivedEffort && (
              <div className={styles.statItem}>
                <div className={styles.statValueSmall}>{workout.perceivedEffort}/10</div>
                <div className={styles.statLabelSmall}>RPE</div>
              </div>
            )}
          </div>
          {workout?.exercises && workout.exercises.length > 0 && (
            <div className={styles.exercisesList}>
              {workout.exercises.slice(0, 5).map((ex, idx) => (
                <div key={idx} className={styles.exerciseItem}>
                  <span className={styles.exerciseName}>{ex.name}</span>
                  {ex.sets && ex.sets.length > 0 && (
                    <span className={styles.exerciseSets}>{ex.sets.length} sets</span>
                  )}
                </div>
              ))}
              {workout.exercises.length > 5 && (
                <div className={styles.moreExercises}>+{workout.exercises.length - 5} more</div>
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
    const { calories, protein, carbs, fat } = nutrition || {}
    
    return (
      <div className={styles.card} ref={cardRef}>
        <div className={styles.cardHeader}>
          <div className={styles.logo}>ECHELON</div>
          <div className={styles.cardType}>NUTRITION</div>
        </div>
        <div className={styles.cardContent}>
          <div className={styles.mainStat}>
            <div className={styles.statValue}>{calories?.toLocaleString() || 0}</div>
            <div className={styles.statLabel}>Calories</div>
          </div>
          <div className={styles.macrosGrid}>
            <div className={styles.macroItem}>
              <div className={styles.macroValue}>{protein?.toFixed(0) || 0}g</div>
              <div className={styles.macroLabel}>Protein</div>
            </div>
            <div className={styles.macroItem}>
              <div className={styles.macroValue}>{carbs?.toFixed(0) || 0}g</div>
              <div className={styles.macroLabel}>Carbs</div>
            </div>
            <div className={styles.macroItem}>
              <div className={styles.macroValue}>{fat?.toFixed(0) || 0}g</div>
              <div className={styles.macroLabel}>Fat</div>
            </div>
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

