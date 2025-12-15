/**
 * Password Strength Indicator Component
 * Shows visual feedback for password strength
 */

import { useMemo } from 'react'
import styles from './PasswordStrengthIndicator.module.css'

export default function PasswordStrengthIndicator({ password }) {
  const strength = useMemo(() => {
    if (!password || password.length === 0) return { level: 0, label: '', color: '' }
    
    let score = 0
    const checks = {
      length: password.length >= 8,
      lowercase: /[a-z]/.test(password),
      uppercase: /[A-Z]/.test(password),
      number: /[0-9]/.test(password),
      special: /[^a-zA-Z0-9]/.test(password)
    }
    
    if (checks.length) score++
    if (checks.lowercase) score++
    if (checks.uppercase) score++
    if (checks.number) score++
    if (checks.special) score++
    
    if (score <= 2) return { level: 1, label: 'Weak', color: '#ef4444' }
    if (score <= 3) return { level: 2, label: 'Fair', color: '#f59e0b' }
    if (score <= 4) return { level: 3, label: 'Good', color: 'var(--accent)' }
    return { level: 4, label: 'Strong', color: '#10b981' }
  }, [password])
  
  return (
    <div className={styles.container}>
      <div className={styles.barContainer}>
        <div 
          className={styles.bar}
          style={{ 
            width: `${(strength.level / 4) * 100}%`,
            backgroundColor: strength.color
          }}
        />
      </div>
      {password && password.length > 0 && (
        <span className={styles.label} style={{ color: strength.color }}>
          {strength.label}
        </span>
      )}
      {password && password.length > 0 && (
        <div className={styles.requirements}>
          <div className={styles.requirement}>
            <span className={password.length >= 8 ? styles.check : styles.cross}>
              {password.length >= 8 ? '✓' : '✗'}
            </span>
            <span>8+ characters</span>
          </div>
          <div className={styles.requirement}>
            <span className={/[a-z]/.test(password) ? styles.check : styles.cross}>
              {/[a-z]/.test(password) ? '✓' : '✗'}
            </span>
            <span>Lowercase</span>
          </div>
          <div className={styles.requirement}>
            <span className={/[A-Z]/.test(password) ? styles.check : styles.cross}>
              {/[A-Z]/.test(password) ? '✓' : '✗'}
            </span>
            <span>Uppercase</span>
          </div>
          <div className={styles.requirement}>
            <span className={/[0-9]/.test(password) ? styles.check : styles.cross}>
              {/[0-9]/.test(password) ? '✓' : '✗'}
            </span>
            <span>Number</span>
          </div>
          <div className={styles.requirement}>
            <span className={/[^a-zA-Z0-9]/.test(password) ? styles.check : styles.cross}>
              {/[^a-zA-Z0-9]/.test(password) ? '✓' : '✗'}
            </span>
            <span>Special character</span>
          </div>
        </div>
      )}
    </div>
  )
}

