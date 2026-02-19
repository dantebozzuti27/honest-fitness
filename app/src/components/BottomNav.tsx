import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { HomeIcon, AnalyticsIcon, ProfileIcon, FitnessIcon } from './Icons'
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
    { id: 'today', label: 'Today', path: '/', icon: <HomeIcon /> },
    { id: 'workouts', label: 'Workouts', path: '/workout', icon: <FitnessIcon /> },
    { id: 'analytics', label: 'Analytics', path: '/analytics', icon: <AnalyticsIcon /> },
    { id: 'profile', label: 'Profile', path: '/profile', icon: <ProfileIcon /> },
  ]

  const isActive = (path: string) => {
    if (!path) return false
    if (path === '/') return location.pathname === '/'
    return location.pathname.startsWith(path)
  }

  return (
    <nav className={styles.bottomNav}>
      {navItems.map((item) => (
        <button
          key={item.id}
          className={`${styles.navButton} ${isActive(item.path) ? styles.active : ''}`}
          onClick={() => navigate(item.path)}
          aria-label={item.label}
        >
          <span className={styles.navIcon}>{item.icon}</span>
          <span className={styles.navLabel}>{item.label}</span>
          {item.id === 'today' && pendingSyncCount > 0 && (
            <span className={styles.badge} aria-label={`${pendingSyncCount} items pending sync`} />
          )}
        </button>
      ))}
    </nav>
  )
}
