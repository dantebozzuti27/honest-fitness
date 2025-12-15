import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { useAuth } from '../context/AuthContext'
import { getUserPreferences, saveUserPreferences } from '../lib/supabaseDb'
import { logError } from '../utils/logger'
import styles from './Onboarding.module.css'

export default function Onboarding({ onComplete }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [step, setStep] = useState(1)
  const [skipping, setSkipping] = useState(false)

  const totalSteps = 3

  const handleSkip = async () => {
    if (!user) return
    setSkipping(true)
    try {
      const prefs = await getUserPreferences(user.id) || {}
      await saveUserPreferences(user.id, {
        ...prefs,
        onboarding_completed: true
      })
      onComplete?.()
    } catch (error) {
      logError('Error saving onboarding completion', error)
      onComplete?.()
    } finally {
      setSkipping(false)
    }
  }

  const handleNext = () => {
    if (step < totalSteps) {
      setStep(step + 1)
    } else {
      handleSkip()
    }
  }

  const handleAction = (action) => {
    handleSkip()
    if (action === 'wearable') {
      navigate('/wearables')
    } else if (action === 'workout') {
      navigate('/fitness')
    } else if (action === 'goal') {
      navigate('/goals')
    }
  }

  if (!user) return null

  // Ensure document.body exists before creating portal
  if (typeof document === 'undefined' || !document.body) {
    return null
  }

  return createPortal(
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2>Welcome to HonestFitness!</h2>
          <button className={styles.skipBtn} onClick={handleSkip} disabled={skipping}>
            {skipping ? '...' : 'Skip'}
          </button>
        </div>

        <div className={styles.content}>
          {step === 1 && (
            <div className={styles.step}>
              <div className={styles.icon} aria-hidden="true">Train</div>
              <h3>Track Your Workouts</h3>
              <p>Log exercises, sets, reps, and weights. Build your fitness history and see your progress over time.</p>
              <button className={styles.actionBtn} onClick={() => handleAction('workout')}>
                Start Your First Workout
              </button>
            </div>
          )}

          {step === 2 && (
            <div className={styles.step}>
              <div className={styles.icon} aria-hidden="true">Sync</div>
              <h3>Connect Your Wearables</h3>
              <p>Sync data from Fitbit, Oura, or Apple Watch to automatically track your health metrics.</p>
              <button className={styles.actionBtn} onClick={() => handleAction('wearable')}>
                Connect Device
              </button>
            </div>
          )}

          {step === 3 && (
            <div className={styles.step}>
              <div className={styles.icon} aria-hidden="true">Goals</div>
              <h3>Set Your Goals</h3>
              <p>Create fitness, nutrition, and health goals. Track your progress and stay motivated.</p>
              <button className={styles.actionBtn} onClick={() => handleAction('goal')}>
                Set a Goal
              </button>
            </div>
          )}
        </div>

        <div className={styles.footer}>
          <div className={styles.progress}>
            {Array.from({ length: totalSteps }).map((_, i) => (
              <div
                key={i}
                className={`${styles.progressDot} ${i + 1 <= step ? styles.active : ''}`}
              />
            ))}
          </div>
          <div className={styles.actions}>
            {step > 1 && (
              <button className={styles.backBtn} onClick={() => setStep(step - 1)}>
                Back
              </button>
            )}
            <button className={styles.nextBtn} onClick={handleNext}>
              {step === totalSteps ? 'Get Started' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

