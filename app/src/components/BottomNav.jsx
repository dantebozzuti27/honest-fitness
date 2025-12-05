import { useNavigate, useLocation } from 'react-router-dom'
import styles from './BottomNav.module.css'

export default function BottomNav() {
  const navigate = useNavigate()
  const location = useLocation()

  const navItems = [
    { id: 'fitness', label: 'Fitness', path: '/fitness', icon: 'F' },
    { id: 'nutrition', label: 'Nutrition', path: '/nutrition', icon: 'N' },
    { id: 'health', label: 'Health', path: '/health', icon: 'H' },
    { id: 'plus', label: '', path: '/', icon: '+', isPlus: true },
    { id: 'analytics', label: 'Analytics', path: '/analytics', icon: 'A' },
    { id: 'goals', label: 'Goals', path: '/goals', icon: 'G' },
    { id: 'calendar', label: 'Calendar', path: '/calendar', icon: 'C' }
  ]

  const handleNavClick = (path) => {
    if (path === '/') {
      navigate('/')
    } else {
      navigate(path)
    }
  }

  const isActive = (path) => {
    if (path === '/') {
      return location.pathname === '/'
    }
    return location.pathname.startsWith(path)
  }

  return (
    <nav className={styles.bottomNav}>
      {navItems.map((item) => (
        <button
          key={item.id}
          className={`${styles.navButton} ${isActive(item.path) ? styles.active : ''} ${item.isPlus ? styles.plusButton : ''}`}
          onClick={() => handleNavClick(item.path)}
          aria-label={item.label || 'Home'}
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
  )
}

