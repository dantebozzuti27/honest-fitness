import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { HomeIcon, AnalyticsIcon, ProfileIcon } from './Icons'
import { useAuth } from '../context/AuthContext'
import { getOutboxPendingCount } from '../lib/syncOutbox'
import { useHaptic } from '../hooks/useHaptic'
import { getLastQuickAction } from '../utils/quickActions'
import { openMealLog, startWorkout } from '../utils/navIntents'
import styles from './BottomNav.module.css'

export default function BottomNav() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const [pendingSyncCount, setPendingSyncCount] = useState(0)
  const haptics = useHaptic()
  const longPressTimerRef = useRef(null)
  const longPressTriggeredRef = useRef(false)

  useEffect(() => {
    if (!user) return
    const refresh = () => setPendingSyncCount(getOutboxPendingCount(user.id))
    refresh()
    window.addEventListener('outboxUpdated', refresh)
    window.addEventListener('online', refresh)
    return () => {
      window.removeEventListener('outboxUpdated', refresh)
      window.removeEventListener('online', refresh)
    }
  }, [user])

  const navItems = [
    { 
      id: 'today', 
      label: 'Today', 
      path: '/', 
      icon: <HomeIcon />
    },
    { 
      id: 'log',
      label: 'Log',
      path: '/log',
      icon: '+'
    },
    { 
      id: 'progress',
      label: 'Progress',
      path: '/progress',
      icon: <AnalyticsIcon />
    },
    {
      id: 'profile',
      label: 'Profile',
      path: '/profile',
      icon: <ProfileIcon />
    }
  ]

  const handleNavClick = (item) => {
    if (item.path) {
      if (item.id === 'log') {
        if (longPressTriggeredRef.current) {
          longPressTriggeredRef.current = false
          return
        }
        navigate('/log')
        return
      }
      navigate(item.path)
    }
  }

  const runLastQuickAction = () => {
    const action = getLastQuickAction()

    if (!action?.type) {
      navigate('/log')
      return
    }

    try {
      haptics?.selection?.()
    } catch {}

    if (action.type === 'meal') {
      openMealLog(navigate, { mealType: action.mealType || undefined })
      return
    }

    if (action.type === 'continue_workout') {
      startWorkout(navigate, { mode: 'resume' })
      return
    }

    if (action.type === 'start_workout') {
      const sessionType = action.sessionType === 'recovery' ? 'recovery' : 'workout'
      startWorkout(navigate, { mode: 'picker', sessionType })
      return
    }

    // Unknown type -> fall back to the sheet
    navigate('/log')
  }

  const startLongPress = () => {
    clearLongPress()
    longPressTriggeredRef.current = false
    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true
      setQuickOpen(false)
      runLastQuickAction()
    }, 450)
  }

  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  const isActive = (path) => {
    if (!path) return false
    if (path === '/') return location.pathname === '/'
    return location.pathname.startsWith(path)
  }

  return (
    <>
      <nav className={styles.bottomNav}>
        {navItems.map((item) => (
          <button
            key={item.id}
            className={`${styles.navButton} ${isActive(item.path) ? styles.active : ''}`}
            onClick={() => handleNavClick(item)}
            onPointerDown={item.id === 'log' ? startLongPress : undefined}
            onPointerUp={item.id === 'log' ? clearLongPress : undefined}
            onPointerCancel={item.id === 'log' ? clearLongPress : undefined}
            onContextMenu={item.id === 'log' ? (e) => e.preventDefault() : undefined}
            aria-label={item.label}
          >
            {item.id === 'log' ? (
              <>
                <span className={styles.plusIcon}>{item.icon}</span>
                <span className={styles.navLabel}>{item.label}</span>
                {pendingSyncCount > 0 && (
                  <span className={styles.badge} aria-label={`${pendingSyncCount} items pending sync`} />
                )}
              </>
            ) : (
              <>
                <span className={styles.navIcon}>{item.icon}</span>
                <span className={styles.navLabel}>{item.label}</span>
              </>
            )}
          </button>
        ))}
      </nav>
    </>
  )
}

