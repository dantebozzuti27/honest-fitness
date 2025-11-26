import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { hasExercises } from '../db'
import { initializeData, reloadData } from '../utils/initData'
import { useAuth } from '../context/AuthContext'
import { calculateStreakFromSupabase } from '../lib/supabaseDb'
import { exportWorkoutData } from '../utils/exportData'
import styles from './Home.module.css'

export default function Home() {
  const navigate = useNavigate()
  const { user, signOut } = useAuth()
  const [streak, setStreak] = useState(0)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    async function init() {
      // Initialize exercise data if not present
      const hasData = await hasExercises()
      if (!hasData) {
        await initializeData()
      }
      
      // Get streak from Supabase if logged in
      if (user) {
        try {
          const currentStreak = await calculateStreakFromSupabase(user.id)
          setStreak(currentStreak)
        } catch (e) {
          console.error('Error getting streak:', e)
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
            Start Workout
          </button>
          
          <button 
            className={styles.secondaryBtn}
            onClick={() => navigate('/calendar')}
          >
            Calendar
          </button>
          
          <button 
            className={styles.secondaryBtn}
            onClick={() => navigate('/analytics')}
          >
            Analytics
          </button>

          <button 
            className={styles.secondaryBtn}
            onClick={() => navigate('/planner')}
          >
            Plan Workouts
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

