import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { FitnessIcon, NutritionIcon, HealthIcon, AnalyticsIcon } from './Icons'
import styles from './BottomNav.module.css'

export default function BottomNav() {
  const navigate = useNavigate()
  const location = useLocation()
  const [showQuickLog, setShowQuickLog] = useState(false)

  const navItems = [
    { 
      id: 'fitness', 
      label: 'Fitness', 
      path: '/fitness', 
      icon: <FitnessIcon />
    },
    { 
      id: 'nutrition', 
      label: 'Nutrition', 
      path: '/nutrition', 
      icon: <NutritionIcon />
    },
    { 
      id: 'plus', 
      label: 'Quick Log', 
      path: null, 
      isPlus: true,
      icon: '+'
    },
    { 
      id: 'health', 
      label: 'Health', 
      path: '/health', 
      icon: <HealthIcon />
    },
    { 
      id: 'analytics', 
      label: 'Analytics', 
      path: '/analytics', 
      icon: <AnalyticsIcon />
    }
  ]

  const quickLogOptions = [
    { label: 'Log Workout', path: '/fitness' },
    { label: 'Log Meal', path: '/nutrition' },
    { label: 'Log Health Metrics', path: '/health' }
  ]

  const handleNavClick = (item) => {
    if (item.isPlus) {
      setShowQuickLog(true)
    } else if (item.path) {
      navigate(item.path)
    }
  }

  const handleQuickLog = (path) => {
    setShowQuickLog(false)
    navigate(path)
  }

  const isActive = (path) => {
    if (!path) return false
    return location.pathname.startsWith(path)
  }

  return (
    <>
      <nav className={styles.bottomNav}>
        {navItems.map((item) => (
          <button
            key={item.id}
            className={`${styles.navButton} ${isActive(item.path) ? styles.active : ''} ${item.isPlus ? styles.plusButton : ''}`}
            onClick={() => handleNavClick(item)}
            aria-label={item.label}
          >
            {item.isPlus ? (
              <span className={styles.plusIcon}>{item.icon}</span>
            ) : (
              <>
                <span className={styles.navIcon}>{item.icon}</span>
                <span className={styles.navLabel}>{item.label}</span>
              </>
            )}
          </button>
        ))}
      </nav>

      {/* Quick Log Menu */}
      {showQuickLog && createPortal(
        <>
          <div className={styles.quickLogOverlay} onClick={() => setShowQuickLog(false)} />
          <div className={styles.quickLogMenu}>
            <div className={styles.quickLogHeader}>
              <h3>Quick Log</h3>
              <button className={styles.quickLogClose} onClick={() => setShowQuickLog(false)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className={styles.quickLogOptions}>
              {quickLogOptions.map((option) => (
                <button
                  key={option.path}
                  className={styles.quickLogOption}
                  onClick={() => handleQuickLog(option.path)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  )
}

