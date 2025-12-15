import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { HomeIcon, AnalyticsIcon, ProfileIcon } from './Icons'
import { useAuth } from '../context/AuthContext'
import { getOutboxPendingCount } from '../lib/syncOutbox'
import styles from './BottomNav.module.css'

export default function BottomNav() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const [pendingSyncCount, setPendingSyncCount] = useState(0)

  useEffect(() => {
    if (!user) return
    const refresh = () => setPendingSyncCount(getOutboxPendingCount())
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
      navigate(item.path)
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

