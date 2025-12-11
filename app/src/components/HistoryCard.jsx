/**
 * History Card Component
 * Beautiful liquid glass card design for history entries
 * Used across Fitness, Nutrition, and Health pages
 */

import { useState } from 'react'
import { formatDateShort, getTodayEST, getYesterdayEST } from '../utils/dateUtils'
import styles from './HistoryCard.module.css'

export default function HistoryCard({
  type = 'fitness', // 'fitness', 'nutrition', 'health'
  date,
  data,
  onView,
  onShare,
  onDelete,
  onEdit,
  previousData = null, // For trend comparison
  index = 0
}) {
  const [isExpanded, setIsExpanded] = useState(false)

  // Format date with relative labels
  const formatDate = (dateStr) => {
    if (!dateStr) return ''
    const today = getTodayEST()
    const yesterday = getYesterdayEST()
    
    if (dateStr === today) return 'Today'
    if (dateStr === yesterday) return 'Yesterday'
    
    const date = new Date(dateStr + 'T12:00:00')
    const weekday = date.toLocaleDateString('en-US', { weekday: 'short' })
    const formatted = formatDateShort(dateStr)
    return `${weekday} • ${formatted}`
  }

  // Calculate trends
  const getTrend = (current, previous, format = (v) => v) => {
    if (!previous || current == null || previous == null) return null
    const diff = current - previous
    if (Math.abs(diff) < 0.01) return { direction: '→', value: 'Same', color: 'var(--text-secondary)' }
    const isPositive = diff > 0
    return {
      direction: isPositive ? '↑' : '↓',
      value: `${isPositive ? '+' : ''}${format(Math.abs(diff))}`,
      color: isPositive ? 'var(--color-green, #10b981)' : 'var(--color-red, #ef4444)'
    }
  }

  // Render based on type
  const renderContent = () => {
    switch (type) {
      case 'fitness':
        return renderFitnessCard()
      case 'nutrition':
        return renderNutritionCard()
      case 'health':
        return renderHealthCard()
      default:
        return null
    }
  }

  const renderFitnessCard = () => {
    const duration = data.duration || 0
    const durationMinutes = Math.floor(duration / 60)
    const durationSeconds = duration % 60
    const durationFormatted = `${durationMinutes}:${String(durationSeconds).padStart(2, '0')}`
    const exerciseCount = data.workout_exercises?.length || 0
    const templateName = data.template_name || 'Freestyle'
    
    // Calculate total volume (handle both workout_sets and sets)
    const totalVolume = data.workout_exercises?.reduce((sum, ex) => {
      const sets = ex.workout_sets || ex.sets || []
      return sum + (sets.reduce((setSum, set) => {
        return setSum + ((set.weight || 0) * (set.reps || 0))
      }, 0) || 0)
    }, 0) || 0
    
    // Get body parts worked
    const bodyParts = [...new Set(
      data.workout_exercises?.map(ex => ex.body_part || ex.bodyPart).filter(Boolean) || []
    )].slice(0, 3)
    
    // Duration trend
    const durationTrend = previousData?.duration 
      ? getTrend(duration, previousData.duration, (v) => `${Math.floor(v / 60)}min`)
      : null

    return (
      <>
        <div className={styles.cardHeader}>
          <div className={styles.dateSection}>
            <span className={styles.dateLabel}>{formatDate(date)}</span>
            {durationTrend && (
              <span className={styles.trend} style={{ color: durationTrend.color }}>
                {durationTrend.direction} {durationTrend.value}
              </span>
            )}
          </div>
          <div className={styles.primaryMetric}>
            <span className={styles.metricValue}>{durationFormatted}</span>
            <span className={styles.metricLabel}>Duration</span>
          </div>
        </div>
        
        <div className={styles.cardBody}>
          <div className={styles.metricRow}>
            <div className={styles.metricItem}>
              <span className={styles.metricValue}>{exerciseCount}</span>
              <span className={styles.metricLabel}>Exercises</span>
            </div>
            <div className={styles.metricItem}>
              <span className={styles.metricValue}>{totalVolume > 0 ? `${Math.round(totalVolume / 100) / 10}k` : '0'}</span>
              <span className={styles.metricLabel}>Volume (lbs)</span>
            </div>
            <div className={styles.metricItem}>
              <span className={styles.metricValue}>{templateName}</span>
              <span className={styles.metricLabel}>Template</span>
            </div>
          </div>
          
          {bodyParts.length > 0 && (
            <div className={styles.tags}>
              {bodyParts.map((part, i) => (
                <span key={i} className={styles.tag}>{part}</span>
              ))}
            </div>
          )}
        </div>
      </>
    )
  }

  const renderNutritionCard = () => {
    const calories = data.calories || data.calories_consumed || 0
    const protein = data.macros?.protein || 0
    const carbs = data.macros?.carbs || 0
    const fat = data.macros?.fat || 0
    const mealCount = data.meals?.length || 0
    
    // Calories trend
    const previousCalories = previousData?.calories || previousData?.calories_consumed || 0
    const caloriesTrend = previousCalories > 0
      ? getTrend(calories, previousCalories, (v) => `${Math.round(v)}`)
      : null

    // Calculate macro percentages
    const totalMacros = protein * 4 + carbs * 4 + fat * 9
    const proteinPct = totalMacros > 0 ? Math.round((protein * 4 / totalMacros) * 100) : 0
    const carbsPct = totalMacros > 0 ? Math.round((carbs * 4 / totalMacros) * 100) : 0
    const fatPct = totalMacros > 0 ? Math.round((fat * 9 / totalMacros) * 100) : 0

    return (
      <>
        <div className={styles.cardHeader}>
          <div className={styles.dateSection}>
            <span className={styles.dateLabel}>{formatDate(date)}</span>
            {caloriesTrend && (
              <span className={styles.trend} style={{ color: caloriesTrend.color }}>
                {caloriesTrend.direction} {caloriesTrend.value}
              </span>
            )}
          </div>
          <div className={styles.primaryMetric}>
            <span className={styles.metricValue}>{Math.round(calories).toLocaleString()}</span>
            <span className={styles.metricLabel}>Calories</span>
          </div>
        </div>
        
        <div className={styles.cardBody}>
          <div className={styles.metricRow}>
            <div className={styles.metricItem}>
              <span className={styles.metricValue}>{Math.round(protein)}g</span>
              <span className={styles.metricLabel}>Protein ({proteinPct}%)</span>
            </div>
            <div className={styles.metricItem}>
              <span className={styles.metricValue}>{Math.round(carbs)}g</span>
              <span className={styles.metricLabel}>Carbs ({carbsPct}%)</span>
            </div>
            <div className={styles.metricItem}>
              <span className={styles.metricValue}>{Math.round(fat)}g</span>
              <span className={styles.metricLabel}>Fat ({fatPct}%)</span>
            </div>
          </div>
          
          {mealCount > 0 && (
            <div className={styles.tags}>
              <span className={styles.tag}>{mealCount} meal{mealCount !== 1 ? 's' : ''}</span>
            </div>
          )}
        </div>
      </>
    )
  }

  const renderHealthCard = () => {
    const weight = data.weight
    const steps = data.steps || data.steps_count || 0
    const hrv = data.hrv
    const calories = data.calories_burned || data.calories || 0
    const sleepTime = data.sleep_time || data.sleep_duration
    const sleepScore = data.sleep_score
    const restingHR = data.resting_heart_rate
    const bodyTemp = data.body_temp
    
    // Count active metrics
    const activeMetrics = [weight, steps, hrv, calories, sleepTime, sleepScore, restingHR, bodyTemp].filter(v => v != null && v !== 0).length

    return (
      <>
        <div className={styles.cardHeader}>
          <div className={styles.dateSection}>
            <span className={styles.dateLabel}>{formatDate(date)}</span>
            <span className={styles.metricCount}>{activeMetrics} metric{activeMetrics !== 1 ? 's' : ''}</span>
          </div>
        </div>
        
        <div className={styles.cardBody}>
          <div className={styles.metricGrid}>
            {weight != null && (
              <div className={styles.metricItem}>
                <span className={styles.metricValue}>{weight}</span>
                <span className={styles.metricLabel}>Weight (lbs)</span>
              </div>
            )}
            {steps > 0 && (
              <div className={styles.metricItem}>
                <span className={styles.metricValue}>{steps.toLocaleString()}</span>
                <span className={styles.metricLabel}>Steps</span>
              </div>
            )}
            {hrv != null && (
              <div className={styles.metricItem}>
                <span className={styles.metricValue}>{Math.round(hrv)}</span>
                <span className={styles.metricLabel}>HRV (ms)</span>
              </div>
            )}
            {calories > 0 && (
              <div className={styles.metricItem}>
                <span className={styles.metricValue}>{calories.toLocaleString()}</span>
                <span className={styles.metricLabel}>Calories</span>
              </div>
            )}
            {sleepTime != null && (
              <div className={styles.metricItem}>
                <span className={styles.metricValue}>
                  {Math.floor(sleepTime / 60)}h {Math.round(sleepTime % 60)}m
                </span>
                <span className={styles.metricLabel}>Sleep</span>
              </div>
            )}
            {sleepScore != null && (
              <div className={styles.metricItem}>
                <span className={styles.metricValue}>{Math.round(sleepScore)}</span>
                <span className={styles.metricLabel}>Sleep Score</span>
              </div>
            )}
            {restingHR != null && (
              <div className={styles.metricItem}>
                <span className={styles.metricValue}>{Math.round(restingHR)}</span>
                <span className={styles.metricLabel}>Resting HR (bpm)</span>
              </div>
            )}
            {bodyTemp != null && (
              <div className={styles.metricItem}>
                <span className={styles.metricValue}>{bodyTemp.toFixed(1)}</span>
                <span className={styles.metricLabel}>Body Temp (°F)</span>
              </div>
            )}
          </div>
        </div>
      </>
    )
  }

  return (
    <div 
      className={styles.historyCard}
      style={{ 
        animationDelay: `${index * 0.05}s`,
        '--card-type': type
      }}
      onClick={() => {
        if (onView && typeof onView === 'function') {
          onView()
        }
        setIsExpanded(!isExpanded)
      }}
    >
      <div className={styles.cardContent}>
        {renderContent()}
      </div>
      
      <div className={styles.cardActions}>
        {onShare && (
          <button
            className={styles.actionBtn}
            onClick={(e) => {
              e.stopPropagation()
              if (onShare && typeof onShare === 'function') {
                onShare()
              }
            }}
            title="Share"
          >
            Share
          </button>
        )}
        {onEdit && (
          <button
            className={styles.actionBtn}
            onClick={(e) => {
              e.stopPropagation()
              if (onEdit && typeof onEdit === 'function') {
                onEdit()
              }
            }}
            title="Edit"
          >
            Edit
          </button>
        )}
        {onDelete && (
          <button
            className={`${styles.actionBtn} ${styles.deleteBtn}`}
            onClick={(e) => {
              e.stopPropagation()
              if (onDelete && typeof onDelete === 'function') {
                onDelete()
              }
            }}
            title="Delete"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  )
}

