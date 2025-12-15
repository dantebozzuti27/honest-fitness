/**
 * Predictive Insights Component
 * Displays ML predictions: goal probability, injury risk, performance forecasts
 */

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { 
  forecastWorkoutPerformance, 
  predictInjuryRisk, 
  estimateGoalAchievementProbability 
} from '../lib/advancedML'
// Dynamic import for code-splitting
import InsightsCard from './InsightsCard'
import styles from './PredictiveInsights.module.css'
import { logError } from '../utils/logger'
import Spinner from './Spinner'

export default function PredictiveInsights() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [insights, setInsights] = useState([])
  const [dismissed, setDismissed] = useState(new Set())
  
  // Stable action handlers - use useCallback to ensure functions are stable
  const handleViewRecovery = useCallback(() => {
    console.log('Show recovery recommendations')
    // Could navigate to recovery page in the future
  }, [])
  
  const handleViewGoal = useCallback((goalId) => {
    return () => {
      console.log('Show goal details', goalId)
      // Could navigate to goals page in the future
    }
  }, [])
  
  useEffect(() => {
    if (!user) return
    
    loadPredictiveInsights()
  }, [user])
  
  async function loadPredictiveInsights() {
    if (!user) return
    
    setLoading(true)
    try {
      const goalsModule = await import('../lib/goalsDb')
      const { getActiveGoalsFromSupabase } = goalsModule || {}
      const goalsPromise = (getActiveGoalsFromSupabase && typeof getActiveGoalsFromSupabase === 'function')
        ? getActiveGoalsFromSupabase(user.id)
        : Promise.resolve([])
      
      const [forecast, injuryRisk, goals] = await Promise.all([
        forecastWorkoutPerformance(user.id),
        predictInjuryRisk(user.id),
        goalsPromise
      ])
      
      const newInsights = []
      
      // Workout performance forecast
      if (forecast) {
        newInsights.push({
          type: 'info',
          title: 'Performance Forecast',
          insights: [{
            message: forecast.trend === 'increasing' 
              ? `Your workout volume is trending up. Next workout likely ${Math.round(forecast.forecasted_volume)} lbs total volume (${forecast.confidence}% confidence)`
              : forecast.trend === 'decreasing'
              ? `Your workout volume is trending down. Consider adjusting your training intensity.`
              : `Your workout volume is stable. Next workout likely ${Math.round(forecast.forecasted_volume)} lbs total volume.`,
            icon: '📈'
          }]
        })
      }
      
      // Injury risk prediction
      if (injuryRisk) {
        const riskColor = injuryRisk.risk_level === 'high' ? 'error' 
          : injuryRisk.risk_level === 'medium' ? 'warning' 
          : 'success'
        
        newInsights.push({
          type: riskColor,
          title: 'Injury Risk Assessment',
          insights: [{
            message: `Your injury risk is ${injuryRisk.risk_level} (${injuryRisk.risk_score}/100). ${injuryRisk.recommendations?.[0] || 'Continue monitoring your recovery.'}`,
            icon: injuryRisk.risk_level === 'high' ? '⚠️' : '✅',
            action: handleViewRecovery,
            actionLabel: 'View Recommendations'
          }]
        })
      }
      
      // Goal achievement predictions
      if (goals && goals.length > 0) {
        const goalPredictions = await Promise.all(
          goals.slice(0, 3).map(async (goal) => {
            try {
              const prediction = await estimateGoalAchievementProbability(user.id, goal.id)
              if (prediction) {
                return { goal, prediction }
              }
            } catch (error) {
              logError('Error predicting goal achievement', error)
            }
            return null
          })
        )
        
        const validPredictions = goalPredictions.filter(p => p && p.prediction)
        
        if (validPredictions.length > 0) {
          const goalInsights = validPredictions.map(({ goal, prediction }) => ({
            message: `${goal.custom_name || goal.type}: ${prediction.probability}% chance of achievement. ${prediction.recommendation || ''}`,
            icon: prediction.probability >= 70 ? '🎯' : prediction.probability >= 40 ? '📊' : '⚠️',
            action: handleViewGoal(goal.id),
            actionLabel: 'View Goal'
          }))
          
          newInsights.push({
            type: 'info',
            title: 'Goal Achievement Predictions',
            insights: goalInsights
          })
        }
      }
      
      setInsights(newInsights)
    } catch (error) {
      logError('Error loading predictive insights', error)
    } finally {
      setLoading(false)
    }
  }
  
  const handleDismiss = (index) => {
    setDismissed(prev => new Set([...prev, index]))
  }
  
  if (loading) {
    return (
      <div className={styles.loadingContainer}>
        <Spinner size="small" />
      </div>
    )
  }
  
  if (insights.length === 0) {
    return null
  }
  
  return (
    <div className={styles.predictiveInsights}>
      {insights.map((insightGroup, index) => {
        if (dismissed.has(index)) return null
        
        return (
          <InsightsCard
            key={index}
            title={insightGroup.title}
            insights={insightGroup.insights}
            type={insightGroup.type}
            onDismiss={() => handleDismiss(index)}
            expandable={insightGroup.insights.length > 1}
          />
        )
      })}
    </div>
  )
}

