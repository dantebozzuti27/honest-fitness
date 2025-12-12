import { useRef, useEffect, useState } from 'react'
import { formatDateMMDDYYYY } from '../utils/dateUtils'
import { useAuth } from '../context/AuthContext'
import { getUserProfile } from '../lib/friendsDb'
import { getWorkoutsFromSupabase, calculateStreakFromSupabase } from '../lib/supabaseDb'
import { calculateWorkoutAchievements, calculateNutritionAchievements, calculateHealthAchievements } from '../utils/achievements'
import styles from './ShareCard.module.css'

export default function ShareCard({ type, data, theme = 'default', showAchievements = true, showBranding = true, showSocial = true, customStats = null }) {
  const cardRef = useRef(null)
  const { user } = useAuth()
  const [achievements, setAchievements] = useState([])
  const [userProfile, setUserProfile] = useState(null)
  const [userStats, setUserStats] = useState({})

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

  // Load user profile and stats for social context
  useEffect(() => {
    if (user && showSocial) {
      getUserProfile(user.id).then(profile => {
        setUserProfile(profile)
      }).catch(() => {})
      
      // Load user stats for achievements
      Promise.all([
        getWorkoutsFromSupabase(user.id),
        calculateStreakFromSupabase(user.id)
      ]).then(([workouts, streak]) => {
        setUserStats({
          totalWorkouts: workouts?.length || 0,
          currentStreak: streak || 0,
          previousWorkout: workouts?.[1] || null
        })
      }).catch(() => {})
    }
  }, [user, showSocial])

  // Calculate achievements
  useEffect(() => {
    if (!showAchievements) return
    
    let calculated = []
    if (type === 'workout' && data.workout) {
      calculated = calculateWorkoutAchievements(data.workout, userStats)
    } else if (type === 'nutrition' && data.nutrition) {
      calculated = calculateNutritionAchievements(data.nutrition, userStats)
    } else if (type === 'health' && data.health) {
      calculated = calculateHealthAchievements(data.health, userStats)
    }
    setAchievements(calculated)
  }, [type, data, userStats, showAchievements])

  const renderWorkoutCard = () => {
    const { workout } = data
    
    // IMPORTANT: Show ALL exercises from the workout, don't filter any out
    // Only filter sets to show valid ones, but keep all exercises
    const rawExercises = []
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
        rawExercises.push({
          ...ex,
          sets: validSets, // Use filtered sets, but keep the exercise
          stacked: ex.stacked || false,
          stackGroup: ex.stackGroup || null
        })
      })
    } else {
      console.warn('ShareCard: workout.exercises is missing or not an array', workout)
    }
    
    // Group stacked exercises together and merge them
    const validExercises = []
    const processedStackGroups = new Set()
    
    rawExercises.forEach((ex) => {
      // Skip if already processed as part of a stack
      if (ex.stacked && ex.stackGroup && processedStackGroups.has(ex.stackGroup)) {
        return
      }
      
      // If this exercise is stacked, find all exercises in the same stack group
      if (ex.stacked && ex.stackGroup) {
        const stackMembers = rawExercises.filter(e => 
          e.stacked && e.stackGroup === ex.stackGroup
        )
        
        if (stackMembers.length > 1) {
          // Merge stacked exercises into one
          processedStackGroups.add(ex.stackGroup)
          
          // Combine exercise names
          const combinedName = stackMembers.map(e => e.name).join(' / ')
          
          // Create alternating sets: Set 1 of Ex1, Set 1 of Ex2, Set 2 of Ex1, Set 2 of Ex2, etc.
          const maxSets = Math.max(...stackMembers.map(e => e.sets.length))
          const mergedSets = []
          
          for (let setIndex = 0; setIndex < maxSets; setIndex++) {
            stackMembers.forEach((member, memberIndex) => {
              const set = member.sets[setIndex]
              if (set) {
                mergedSets.push({
                  ...set,
                  exerciseName: member.name,
                  exerciseIndex: memberIndex
                })
              }
            })
          }
          
          // Determine stack type
          const stackType = stackMembers.length === 2 ? 'Superset' : 'Circuit'
          
          validExercises.push({
            id: `stack-${ex.stackGroup}`,
            name: combinedName,
            sets: mergedSets,
            stacked: true,
            stackGroup: ex.stackGroup,
            stackMembers: stackMembers,
            stackType: stackType,
            category: stackMembers[0]?.category || ex.category
          })
        } else {
          // Only one exercise in stack, treat as normal
          validExercises.push(ex)
        }
      } else {
        // Not stacked, add as normal
        validExercises.push(ex)
      }
    })
    
    const totalExercises = validExercises.length
    
    // Card dimensions: 300px x 300px (square, smaller)
    // Header: ~40px, stat+count: ~50px, padding: ~20px
    // Available for grid: ~190px height, ~260px width
    const cardWidth = 300
    const cardHeight = 300
    const headerHeight = 40
    const topSectionHeight = 50 // Reduced since date is in header now
    const padding = 20
    const availableWidth = cardWidth - padding * 2
    const availableHeightForGrid = cardHeight - headerHeight - topSectionHeight - padding - 10 // Extra 10px for bottom padding
    
    // Use CSS Grid with auto-fit and minmax for responsive columns
    // Minimum column width: 70px (reduced for smaller card)
    // Maximum: 1fr (equal distribution)
    const minColumnWidth = 70
    const maxColumnsByWidth = Math.floor(availableWidth / minColumnWidth)
    
    // Calculate optimal columns to fit all exercises
    // Start with a reasonable default based on exercise count
    let optimalColumns = Math.max(2, Math.min(maxColumnsByWidth, Math.ceil(Math.sqrt(totalExercises))))
    optimalColumns = Math.max(2, Math.min(5, optimalColumns))
    
    const rows = Math.ceil(totalExercises / optimalColumns)
    
    // Calculate if we can fit all rows in available height
    // Base item height: padding(6px*2) + name(10px*1.2) + setsReps(8px*1.2) + gap(2px) = ~30px (reduced for smaller card)
    const baseItemHeight = 30
    const gridGapBetweenRows = 4
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
    const exerciseNameSize = Math.max(8, Math.floor(10 * scaleFactor)) // Min 8px (reduced for smaller card)
    const setsRepsSize = Math.max(7, Math.floor(8 * scaleFactor)) // Min 7px (reduced for smaller card)
    const itemPadding = Math.max(6, Math.floor(8 * scaleFactor))
    const itemGap = Math.max(2, Math.floor(2 * scaleFactor))
    const gridGap = Math.max(4, Math.floor(6 * scaleFactor))
    
    // Calculate total volume for display
    let totalVolume = 0
    validExercises.forEach(ex => {
      const sets = ex.sets || []
      sets.forEach(set => {
        const weight = Number(set.weight) || 0
        const reps = Number(set.reps) || 0
        totalVolume += weight * reps
      })
    })
    
    // Get stats to display (use customStats if provided)
    const displayStats = customStats || {
      duration: formatDuration(workout?.duration),
      exercises: totalExercises,
      volume: totalVolume
    }

    return (
      <div className={`${styles.card} ${styles[`theme_${theme}`]}`} ref={cardRef}>
        <div className={styles.cardHeader}>
          <div className={styles.logo}>ECHELON</div>
          <div className={styles.headerRight}>
            <div className={styles.cardType}>WORKOUT</div>
            <div className={styles.cardDateHeader}>{formatDate(workout?.date)}</div>
          </div>
        </div>
        
        {/* Achievements Banner */}
        {showAchievements && achievements.length > 0 && (
          <div className={styles.achievementsBanner}>
            {achievements.slice(0, 2).map((achievement, idx) => (
              <div key={idx} className={`${styles.achievementBadge} ${styles[achievement.type]}`}>
                {achievement.label}
              </div>
            ))}
          </div>
        )}
        
        {/* Social Context */}
        {showSocial && userProfile && (
          <div className={styles.socialContext}>
            <span className={styles.username}>@{userProfile.username || 'user'}</span>
          </div>
        )}
        
        <div className={styles.cardContent}>
          <div className={styles.mainStat}>
            <div className={styles.statValue}>{displayStats.duration}</div>
            <div className={styles.statLabel}>Duration</div>
          </div>
          {displayStats.exercises > 0 && (
            <div className={styles.exerciseCount}>
              {displayStats.exercises} {displayStats.exercises === 1 ? 'Exercise' : 'Exercises'}
              {displayStats.volume > 0 && (
                <span className={styles.volumeStat}> • {displayStats.volume >= 1000 ? `${(displayStats.volume / 1000).toFixed(1)}k` : Math.round(displayStats.volume)} lbs</span>
              )}
            </div>
          )}
          {/* Display wearable metrics if available */}
          {(workout?.workoutCaloriesBurned != null || workout?.workoutSteps != null) && (
            <div className={styles.workoutMetrics}>
              {workout.workoutCaloriesBurned != null && (
                <div className={styles.workoutMetric}>
                  <span className={styles.workoutMetricValue}>{Math.round(workout.workoutCaloriesBurned)}</span>
                  <span className={styles.workoutMetricLabel}>Calories</span>
                </div>
              )}
              {workout.workoutSteps != null && (
                <div className={styles.workoutMetric}>
                  <span className={styles.workoutMetricValue}>{workout.workoutSteps.toLocaleString()}</span>
                  <span className={styles.workoutMetricLabel}>Steps</span>
                </div>
              )}
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
                // ex.sets is already filtered to only valid sets
                const sets = ex.sets || []
                const setCount = sets.length
                const isCardio = ex.category === 'Cardio' || ex.category === 'cardio'
                const isStacked = ex.stacked && ex.stackGroup && ex.stackMembers
                
                // For stacked exercises, show alternating sets
                let displayText = ''
                
                if (isStacked && sets.length > 0) {
                  // For stacked exercises, show alternating sets format
                  // Group sets by round (each round has one set from each exercise in the stack)
                  const roundCount = Math.ceil(sets.length / ex.stackMembers.length)
                  const firstRoundSets = sets.slice(0, ex.stackMembers.length)
                  
                  // Build display text showing alternating pattern
                  const parts = []
                  firstRoundSets.forEach((set, idx) => {
                    const member = ex.stackMembers[idx]
                    if (!member) return
                    
                    if (set.reps != null && set.reps !== '') {
                      const weight = set.weight ? `×${set.weight}` : ''
                      parts.push(`${set.reps}${weight}`)
                    } else if (set.time != null && set.time !== '') {
                      const timeSeconds = Number(set.time)
                      const minutes = (timeSeconds / 60).toFixed(1)
                      parts.push(`${minutes}m`)
                    } else if (set.weight != null && set.weight !== '') {
                      parts.push(`${set.weight}lbs`)
                    }
                  })
                  
                  if (parts.length > 0) {
                    displayText = parts.join(' / ')
                    if (roundCount > 1) {
                      displayText = `${roundCount}× (${displayText})`
                    }
                  } else {
                    displayText = `${setCount} sets`
                  }
                } else if (isCardio && sets.length > 0) {
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
                    const displayValue = firstSet.reps
                    const displayLabel = 'reps'
                    displayText = `${setCount} × ${displayValue} ${displayLabel}`
                  } else if (firstSet.time != null && firstSet.time !== '') {
                    // For recovery exercises or any timed exercises, show minutes
                    const timeSeconds = Number(firstSet.time)
                    let displayLabel = ''
                    if (isRecovery || timeSeconds >= 60) {
                      const minutes = (timeSeconds / 60).toFixed(1)
                      displayLabel = 'min'
                      displayText = `${setCount} × ${minutes} ${displayLabel}`
                    } else {
                      // For very short times (< 60s), show seconds
                      const displayValue = Math.round(timeSeconds)
                      displayLabel = 'sec'
                      displayText = `${setCount} × ${displayValue} ${displayLabel}`
                    }
                  } else if (firstSet.weight != null && firstSet.weight !== '') {
                    const displayValue = firstSet.weight
                    const displayLabel = 'lbs'
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
                    {isStacked && ex.stackType && (
                      <div 
                        className={styles.stackLabel}
                        style={{ fontSize: `${Math.max(5, Math.floor(exerciseNameSize * 0.7))}px` }}
                      >
                        {ex.stackType}
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
    
    // Get stats to display
    const displayStats = customStats || {
      calories,
      protein,
      carbs,
      fat
    }

    return (
      <div className={`${styles.card} ${styles[`theme_${theme}`]}`} ref={cardRef}>
        <div className={styles.cardHeader}>
          <div className={styles.logo}>ECHELON</div>
          <div className={styles.headerRight}>
            <div className={styles.cardType}>NUTRITION</div>
            <div className={styles.cardDateHeader}>{formatDate(nutrition?.date)}</div>
          </div>
        </div>
        
        {/* Achievements Banner */}
        {showAchievements && achievements.length > 0 && (
          <div className={styles.achievementsBanner}>
            {achievements.slice(0, 2).map((achievement, idx) => (
              <div key={idx} className={`${styles.achievementBadge} ${styles[achievement.type]}`}>
                {achievement.label}
              </div>
            ))}
          </div>
        )}
        
        {/* Social Context */}
        {showSocial && userProfile && (
          <div className={styles.socialContext}>
            <span className={styles.username}>@{userProfile.username || 'user'}</span>
          </div>
        )}
        
        <div className={styles.cardContent}>
          <div className={styles.mainStat}>
            <div className={styles.statValue}>{displayStats.calories > 0 ? displayStats.calories.toLocaleString() : '—'}</div>
            <div className={styles.statLabel}>Calories</div>
          </div>
          <div className={styles.macrosGrid}>
            {displayStats.protein > 0 && (
              <div className={styles.macroItem}>
                <div className={styles.macroValue}>{Math.round(displayStats.protein)}g</div>
                <div className={styles.macroLabel}>Protein</div>
              </div>
            )}
            {displayStats.carbs > 0 && (
              <div className={styles.macroItem}>
                <div className={styles.macroValue}>{Math.round(displayStats.carbs)}g</div>
                <div className={styles.macroLabel}>Carbs</div>
              </div>
            )}
            {displayStats.fat > 0 && (
              <div className={styles.macroItem}>
                <div className={styles.macroValue}>{Math.round(displayStats.fat)}g</div>
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
        
        {/* Branding Footer */}
        {showBranding && (
          <div className={styles.brandingFooter}>
            <div className={styles.brandingText}>Made with Echelon</div>
            <div className={styles.brandingUrl}>echelon.app</div>
          </div>
        )}
      </div>
    )
  }

  const renderHealthCard = () => {
    const { health } = data
    const { steps, hrv, sleep_time, calories_burned, weight } = health || {}
    
    return (
      <div className={`${styles.card} ${styles[`theme_${theme}`]}`} ref={cardRef}>
        <div className={styles.cardHeader}>
          <div className={styles.logo}>ECHELON</div>
          <div className={styles.headerRight}>
            <div className={styles.cardType}>HEALTH</div>
            <div className={styles.cardDateHeader}>{formatDate(health?.date)}</div>
          </div>
        </div>
        
        {/* Achievements Banner */}
        {showAchievements && achievements.length > 0 && (
          <div className={styles.achievementsBanner}>
            {achievements.slice(0, 2).map((achievement, idx) => (
              <div key={idx} className={`${styles.achievementBadge} ${styles[achievement.type]}`}>
                {achievement.label}
              </div>
            ))}
          </div>
        )}
        
        {/* Social Context */}
        {showSocial && userProfile && (
          <div className={styles.socialContext}>
            <span className={styles.username}>@{userProfile.username || 'user'}</span>
          </div>
        )}
        
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
        
        {/* Branding Footer */}
        {showBranding && (
          <div className={styles.brandingFooter}>
            <div className={styles.brandingText}>Made with Echelon</div>
            <div className={styles.brandingUrl}>echelon.app</div>
          </div>
        )}
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

