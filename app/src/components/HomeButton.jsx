import { useNavigate } from 'react-router-dom'
import styles from './HomeButton.module.css'

export default function HomeButton() {
  const navigate = useNavigate()
  
  return (
    <button 
      className={styles.homeButton}
      onClick={() => navigate('/')}
      aria-label="Home"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M8 1L1 7H3V14H7V10H9V14H13V7H15L8 1Z" fill="currentColor" stroke="currentColor" strokeWidth="0.5"/>
      </svg>
    </button>
  )
}

