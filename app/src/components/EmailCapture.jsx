/**
 * Email Capture Component
 * Captures email for non-users before requiring signup
 */

import { useState } from 'react'
import styles from './EmailCapture.module.css'

export default function EmailCapture({ onEmailCaptured, onSkip }) {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    setError('')
    
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      setError('Please enter a valid email address')
      return
    }
    
    // Store email (could send to backend/analytics)
    try {
      localStorage.setItem('early_access_email', email)
      // Could also send to analytics or backend API
      if (onEmailCaptured && typeof onEmailCaptured === 'function') {
        onEmailCaptured(email)
      }
      setSubmitted(true)
    } catch (err) {
      console.error('Error saving email:', err)
      setError('Failed to save email. Please try again.')
    }
  }

  if (submitted) {
    return (
      <div className={styles.container}>
        <div className={styles.successMessage}>
          <span className={styles.successIcon}>✓</span>
          <p>Thanks! We'll notify you when new features are available.</p>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h3 className={styles.title}>Get Early Access</h3>
        <p className={styles.description}>
          Be the first to know about new features, workouts, and exclusive content.
        </p>
        <form onSubmit={handleSubmit} className={styles.form}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Enter your email"
            className={styles.input}
            required
          />
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.actions}>
            <button type="submit" className={styles.submitBtn}>
              Notify Me
            </button>
            {onSkip && typeof onSkip === 'function' && (
              <button 
                type="button" 
                className={styles.skipBtn}
                onClick={onSkip}
              >
                Skip
              </button>
            )}
          </div>
        </form>
        <p className={styles.privacyNote}>
          We respect your privacy. Unsubscribe at any time.
        </p>
      </div>
    </div>
  )
}

