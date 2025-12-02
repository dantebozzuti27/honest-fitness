import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { hasExercises } from '../db'
import { initializeData, reloadData } from '../utils/initData'
import { useAuth } from '../context/AuthContext'
import { calculateStreakFromSupabase } from '../lib/supabaseDb'
import { exportWorkoutData } from '../utils/exportData'
import { calculateReadinessScore, getReadinessScore, saveReadinessScore } from '../lib/readiness'
import styles from './Home.module.css'

export default function Home() {
  const navigate = useNavigate()
  const { user, signOut } = useAuth()
  const [streak, setStreak] = useState(0)
  const [readiness, setReadiness] = useState(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [calculatingReadiness, setCalculatingReadiness] = useState(false)

  useEffect(() => {
    async function init() {
      // Initialize exercise data if not present
      const hasData = await hasExercises()
      if (!hasData) {
        await initializeData()
      }
      
      // Get streak and readiness from Supabase if logged in
      if (user) {
        try {
          const currentStreak = await calculateStreakFromSupabase(user.id)
          setStreak(currentStreak)
          
          // Get or calculate readiness score
          let readinessData = await getReadinessScore(user.id)
          if (!readinessData) {
            // Calculate if not exists
            setCalculatingReadiness(true)
            readinessData = await calculateReadinessScore(user.id)
            await saveReadinessScore(user.id, readinessData)
            setCalculatingReadiness(false)
          }
          setReadiness(readinessData)
        } catch (e) {
          console.error('Error loading data:', e)
        }
      }
      setLoading(false)
    }
    init()
  }, [user])

  const handleReloadData = async () => {
    setLoading(true)
    await reloadData()
    setLoading(false)
    alert('Exercise database reloaded!')
  }

  const handleLogout = async () => {
    await signOut()
    navigate('/auth')
  }

  const handleExport = async () => {
    if (!user) return
    setExporting(true)
    try {
      const result = await exportWorkoutData(user.id, user.email)
      alert(`Exported ${result.workouts} workouts and ${result.metrics} daily metrics!\n\nThe Excel file has been downloaded. Attach it to the email that just opened.`)
    } catch (err) {
      console.error('Export error:', err)
      alert('Failed to export data')
    }
    setExporting(false)
  }

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading...</div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <div className={styles.logoBg}>
        <img src="/logo.jpg" alt="" className={styles.logoBgImg} />
      </div>
      <div className={styles.content}>
        <img src="/logo.jpg" alt="HonestFitness" className={styles.logo} />
        
        {/* Honest Readiness Score */}
        {readiness && (
          <div className={`${styles.readinessCard} ${styles[`readiness${readiness.zone}`]}`}>
            <div className={styles.readinessHeader}>
              <span className={styles.readinessLabel}>Honest Readiness</span>
              {calculatingReadiness && <span className={styles.calculating}>Calculating...</span>}
            </div>
            <div className={styles.readinessScore}>
              <span className={styles.readinessNumber}>{readiness.score}</span>
              <span className={styles.readinessZone}>{readiness.zone.toUpperCase()}</span>
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
        
        <div className={styles.streakCard}>
          <div className={styles.streakRow}>
            <span className={styles.streakNumber}>{streak}</span>
            <img src="/streak-icon.png" alt="" className={styles.streakIcon} />
          </div>
          <span className={styles.streakLabel}>day streak</span>
        </div>

        <div className={styles.actions}>
          <button 
            className={styles.primaryBtn}
            onClick={() => navigate('/workout')}
          >
            💪 Workout
          </button>
          
          <button 
            className={styles.secondaryBtn}
            onClick={() => navigate('/ghost-mode')}
          >
            🍎 Nutrition
          </button>
          
          <button 
            className={styles.secondaryBtn}
            onClick={() => navigate('/analytics')}
          >
            📊 Analyze
          </button>

          <button 
            className={styles.secondaryBtn}
            onClick={() => navigate('/calendar')}
          >
            📅 Calendar
          </button>

          <button 
            className={styles.secondaryBtn}
            onClick={() => navigate('/planner')}
          >
            📋 Plan
          </button>

          <button 
            className={styles.secondaryBtn}
            onClick={() => navigate('/health')}
          >
            ❤️ Health
          </button>

          <button 
            className={styles.exportBtn}
            onClick={handleExport}
            disabled={exporting}
          >
            {exporting ? 'Exporting...' : 'Export Data'}
          </button>
        </div>
      </div>
    </div>
  )
}

