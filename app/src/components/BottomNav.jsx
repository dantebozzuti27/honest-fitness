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
    { 
      label: 'Start Workout', 
      action: 'workout',
      description: 'Start a new workout'
    },
    { 
      label: 'Log Meal', 
      action: 'meal',
      description: 'Add a meal to nutrition'
    },
    { 
      label: 'Log Health Metrics', 
      action: 'health',
      description: 'Log weight, sleep, etc.'
    }
  ]

  const handleNavClick = (item) => {
    if (item.isPlus) {
      setShowQuickLog(true)
    } else if (item.path) {
      navigate(item.path)
    }
  }

  const handleQuickLog = async (option) => {
    setShowQuickLog(false)
    
    if (option.action === 'workout') {
      // Navigate to fitness page and trigger workout modal
      navigate('/fitness', { state: { openWorkoutModal: true } })
    } else if (option.action === 'meal') {
      // Navigate to nutrition page and trigger meal modal
      navigate('/nutrition', { state: { openMealModal: true } })
    } else if (option.action === 'health') {
      // Navigate to health page and trigger log modal
      navigate('/health', { state: { openLogModal: true } })
    }
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
                  key={option.action}
                  className={styles.quickLogOption}
                  onClick={() => handleQuickLog(option)}
                >
                  <div className={styles.quickLogOptionLabel}>{option.label}</div>
                  {option.description && (
                    <div className={styles.quickLogOptionDesc}>{option.description}</div>
                  )}
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

