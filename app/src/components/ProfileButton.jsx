import { useNavigate } from 'react-router-dom'
import styles from './ProfileButton.module.css'

export default function ProfileButton() {
  const navigate = useNavigate()

  return (
    <button
      className={styles.profileButton}
      onClick={() => navigate('/profile')}
      aria-label="Profile and Settings"
    >
      <svg className={styles.profileIcon} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
        <circle cx="12" cy="7" r="4"></circle>
      </svg>
    </button>
  )
}

