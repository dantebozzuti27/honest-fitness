import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getWorkoutsFromSupabase } from '../lib/supabaseDb'
import { getReadinessScore } from '../lib/readiness'
import { getAllConnectedAccounts } from '../lib/wearables'
import { getTodayEST } from '../utils/dateUtils'
import LineChart from '../components/LineChart'
import BarChart from '../components/BarChart'
import styles from './Health.module.css'

export default function Health() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [readiness, setReadiness] = useState(null)
  const [workouts, setWorkouts] = useState([])
  const [wearables, setWearables] = useState([])
  const [nutrition, setNutrition] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selectedPeriod, setSelectedPeriod] = useState('week') // week, month, 90days

  useEffect(() => {
    if (user) {
      loadAllData()
    }
  }, [user, selectedPeriod])

  const loadAllData = async () => {
    if (!user) return
    
    setLoading(true)
    try {
      // Load readiness score
      const readinessData = await getReadinessScore(user.id)
      setReadiness(readinessData)

      // Load workouts
      const allWorkouts = await getWorkoutsFromSupabase(user.id)
      const filteredWorkouts = filterByPeriod(allWorkouts)
      setWorkouts(filteredWorkouts)

      // Load wearables
      const connected = await getAllConnectedAccounts(user.id)
      setWearables(connected || [])

      // Load nutrition data from localStorage
      const nutritionData = localStorage.getItem(`ghostMode_${user.id}`)
      if (nutritionData) {
        const parsed = JSON.parse(nutritionData)
        const todayData = parsed.historyData?.[getTodayEST()]
        if (todayData) {
          setNutrition({
            calories: todayData.calories || 0,
            macros: todayData.macros || { protein: 0, carbs: 0, fat: 0 },
            water: todayData.water || 0
          })
        }
      }
    } catch (error) {
      console.error('Error loading health data:', error)
    } finally {
      setLoading(false)
    }
  }

  const filterByPeriod = (data) => {
    const now = new Date()
    const cutoff = new Date()
    
    switch (selectedPeriod) {
      case 'week':
        cutoff.setDate(now.getDate() - 7)
        break
      case 'month':
        cutoff.setMonth(now.getMonth() - 1)
        break
      case '90days':
        cutoff.setDate(now.getDate() - 90)
        break
      default:
        return data
    }
    
    return data.filter(item => {
      const itemDate = new Date(item.date || item.timestamp)
      return itemDate >= cutoff
    })
  }

  // Calculate health metrics
  const healthMetrics = useMemo(() => {
    const metrics = {
      workouts: workouts.length,
      totalCalories: 0,
      avgReadiness: 0,
      totalSteps: 0,
      totalSleep: 0,
      avgHRV: 0,
      hasWorkouts: workouts.length > 0,
      hasNutrition: nutrition && nutrition.calories > 0,
      hasWearables: wearables.length > 0
    }

    // Calculate average readiness from available data
    if (readiness) {
      metrics.avgReadiness = readiness.score || 0
    }

    // Nutrition data
    if (nutrition) {
      metrics.totalCalories = nutrition.calories
    }

    return metrics
  }, [workouts, readiness, nutrition, wearables])

  // Weekly trends
  const weeklyTrends = useMemo(() => {
    const dates = []
    const readinessScores = []
    const calories = []
    const workouts = []

    for (let i = 6; i >= 0; i--) {
      const date = new Date()
      date.setDate(date.getDate() - i)
      const dateStr = date.toISOString().split('T')[0]
      dates.push(dateStr)

      // Get readiness for this date (would need to fetch from DB)
      readinessScores.push(0) // Placeholder
      calories.push(0) // Placeholder
      workouts.push(0) // Placeholder
    }

    return { dates, readinessScores, calories, workouts }
  }, [])

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading health data...</div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate('/')}>
          ← Back
        </button>
        <h1>Health Overview</h1>
        <div className={styles.periodSelector}>
          <select
            className={styles.periodSelect}
            value={selectedPeriod}
            onChange={(e) => setSelectedPeriod(e.target.value)}
          >
            <option value="week">Last 7 Days</option>
            <option value="month">Last 30 Days</option>
            <option value="90days">Last 90 Days</option>
          </select>
        </div>
      </div>

      <div className={styles.content}>
        {/* Readiness Score Card */}
        {readiness && (
          <div className={`${styles.readinessCard} ${styles[`readiness${readiness.zone}`]}`}>
            <div className={styles.readinessHeader}>
              <h2>Honest Readiness</h2>
              <span className={styles.readinessZone}>{readiness.zone.toUpperCase()}</span>
            </div>
            <div className={styles.readinessScore}>
              <span className={styles.readinessNumber}>{readiness.score}</span>
              <span className={styles.readinessLabel}>/ 100</span>
            </div>
            <div className={styles.readinessComponents}>
              <div className={styles.component}>
                <span className={styles.componentLabel}>Load</span>
                <span className={styles.componentValue}>
                  {readiness.ac_ratio !== undefined ? readiness.ac_ratio : 
                   readiness.components?.acRatio !== undefined ? readiness.components.acRatio : 'N/A'}
                </span>
              </div>
              <div className={styles.component}>
                <span className={styles.componentLabel}>HRV</span>
                <span className={styles.componentValue}>
                  {readiness.hrv_score !== undefined ? readiness.hrv_score : 
                   readiness.components?.hrvScore !== undefined ? readiness.components.hrvScore : 'N/A'}
                </span>
              </div>
              <div className={styles.component}>
                <span className={styles.componentLabel}>Sleep</span>
                <span className={styles.componentValue}>
                  {readiness.sleep_score !== undefined ? readiness.sleep_score : 
                   readiness.components?.sleepScore !== undefined ? readiness.components.sleepScore : 'N/A'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Data Sources Status */}
        <div className={styles.sourcesCard}>
          <h3>Data Sources</h3>
          <div className={styles.sourcesList}>
            <div className={`${styles.sourceItem} ${healthMetrics.hasWorkouts ? styles.connected : styles.disconnected}`}>
              <span className={styles.sourceIcon}>💪</span>
              <div className={styles.sourceInfo}>
                <span className={styles.sourceName}>Workouts</span>
                <span className={styles.sourceStatus}>
                  {healthMetrics.hasWorkouts ? `${healthMetrics.workouts} workouts` : 'No data'}
                </span>
              </div>
            </div>
            <div className={`${styles.sourceItem} ${healthMetrics.hasNutrition ? styles.connected : styles.disconnected}`}>
              <span className={styles.sourceIcon}>🍎</span>
              <div className={styles.sourceInfo}>
                <span className={styles.sourceName}>Nutrition</span>
                <span className={styles.sourceStatus}>
                  {healthMetrics.hasNutrition ? `${healthMetrics.totalCalories} cal today` : 'No data'}
                </span>
              </div>
            </div>
            <div className={`${styles.sourceItem} ${healthMetrics.hasWearables ? styles.connected : styles.disconnected}`}>
              <span className={styles.sourceIcon}>⌚</span>
              <div className={styles.sourceInfo}>
                <span className={styles.sourceName}>Wearables</span>
                <span className={styles.sourceStatus}>
                  {healthMetrics.hasWearables ? `${wearables.length} connected` : 'Not connected'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Stats */}
        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <div className={styles.statIcon}>💪</div>
            <div className={styles.statValue}>{healthMetrics.workouts}</div>
            <div className={styles.statLabel}>Workouts</div>
          </div>
          {nutrition && (
            <div className={styles.statCard}>
              <div className={styles.statIcon}>🔥</div>
              <div className={styles.statValue}>{nutrition.calories}</div>
              <div className={styles.statLabel}>Calories</div>
            </div>
          )}
          {nutrition && (
            <div className={styles.statCard}>
              <div className={styles.statIcon}>🥩</div>
              <div className={styles.statValue}>{Math.round(nutrition.macros.protein)}g</div>
              <div className={styles.statLabel}>Protein</div>
            </div>
          )}
          {nutrition && nutrition.water > 0 && (
            <div className={styles.statCard}>
              <div className={styles.statIcon}>💧</div>
              <div className={styles.statValue}>{Math.round(nutrition.water / 250)}</div>
              <div className={styles.statLabel}>Water (glasses)</div>
            </div>
          )}
        </div>

        {/* Insights */}
        <div className={styles.insightsCard}>
          <h3>Health Insights</h3>
          <div className={styles.insightsList}>
            {readiness && readiness.zone === 'green' && (
              <div className={styles.insightItem}>
                <span className={styles.insightIcon}>✅</span>
                <span>High readiness - Great time to push your limits!</span>
              </div>
            )}
            {readiness && readiness.zone === 'red' && (
              <div className={styles.insightItem}>
                <span className={styles.insightIcon}>⚠️</span>
                <span>Low readiness - Consider rest or light activity</span>
              </div>
            )}
            {healthMetrics.hasWorkouts && healthMetrics.hasNutrition && (
              <div className={styles.insightItem}>
                <span className={styles.insightIcon}>📊</span>
                <span>Complete picture: Tracking workouts + nutrition</span>
              </div>
            )}
            {healthMetrics.hasWearables && (
              <div className={styles.insightItem}>
                <span className={styles.insightIcon}>⌚</span>
                <span>Wearable data improving readiness accuracy</span>
              </div>
            )}
            {!healthMetrics.hasWorkouts && !healthMetrics.hasNutrition && !healthMetrics.hasWearables && (
              <div className={styles.insightItem}>
                <span className={styles.insightIcon}>💡</span>
                <span>Start logging workouts and meals to see your full health picture</span>
              </div>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className={styles.actionsCard}>
          <h3>Quick Actions</h3>
          <div className={styles.actionsGrid}>
            {!healthMetrics.hasWorkouts && (
              <button
                className={styles.actionBtn}
                onClick={() => navigate('/workout')}
              >
                💪 Log Workout
              </button>
            )}
            {!healthMetrics.hasNutrition && (
              <button
                className={styles.actionBtn}
                onClick={() => navigate('/ghost-mode')}
              >
                🍎 Log Meal
              </button>
            )}
            {!healthMetrics.hasWearables && (
              <button
                className={styles.actionBtn}
                onClick={() => navigate('/wearables')}
              >
                ⌚ Connect Wearable
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

