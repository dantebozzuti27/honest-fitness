import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { calculateStreak, hasExercises } from '../db'
import { initializeData, reloadData } from '../utils/initData'
import { useAuth } from '../context/AuthContext'
import styles from './Home.module.css'

export default function Home() {
  const navigate = useNavigate()
  const { user, signOut } = useAuth()
  const [streak, setStreak] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function init() {
      // Initialize exercise data if not present
      const hasData = await hasExercises()
      if (!hasData) {
        await initializeData()
      }
      
      const currentStreak = await calculateStreak()
      setStreak(currentStreak)
      setLoading(false)
    }
    init()
  }, [])

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

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading...</div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <h1 className={styles.title}>HonestFitness</h1>
        
        <div className={styles.streakCard}>
          <span className={styles.streakNumber}>{streak}</span>
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
        </div>
      </div>
    </div>
  )
}

