import { useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import Modal from './Modal'
import styles from './SideMenu.module.css'

export default function SideMenu() {
  const navigate = useNavigate()
  const location = useLocation()
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef(null)
  const closeBtnRef = useRef(null)

  const menuItems = [
    { id: 'fitness', label: 'Fitness', path: '/fitness' },
    { id: 'nutrition', label: 'Nutrition', path: '/nutrition' },
    { id: 'health', label: 'Health', path: '/health' },
    { id: 'analytics', label: 'Analytics', path: '/analytics' },
    { id: 'goals', label: 'Goals', path: '/goals' },
    { id: 'calendar', label: 'Calendar', path: '/calendar' },
    { id: 'profile', label: 'Profile', path: '/profile' }
  ]

  const handleItemClick = (path) => {
    navigate(path)
    setIsOpen(false)
  }

  const isActive = (path) => {
    return location.pathname.startsWith(path)
  }

  return (
    <>
      <button
        className={styles.menuButton}
        onClick={() => setIsOpen(true)}
        aria-label="Open menu"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      {isOpen && (
        <Modal
          isOpen={Boolean(isOpen)}
          onClose={() => setIsOpen(false)}
          containerRef={menuRef}
          initialFocusRef={closeBtnRef}
          overlayClassName={styles.overlay}
          modalClassName={styles.menu}
          ariaLabel="Menu"
        >
            <div className={styles.menuHeader}>
              <h2 className={styles.menuTitle}>Menu</h2>
              <button ref={closeBtnRef} className={styles.closeButton} onClick={() => setIsOpen(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <nav className={styles.menuNav}>
              {menuItems.map((item) => (
                <button
                  key={item.id}
                  className={`${styles.menuItem} ${isActive(item.path) ? styles.active : ''}`}
                  onClick={() => handleItemClick(item.path)}
                >
                  <span className={styles.menuItemLabel}>{item.label}</span>
                  {isActive(item.path) && (
                    <svg className={styles.menuItemArrow} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  )}
                </button>
              ))}
            </nav>
        </Modal>
      )}
    </>
  )
}

