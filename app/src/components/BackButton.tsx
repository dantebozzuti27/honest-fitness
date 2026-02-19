import { useNavigate } from 'react-router-dom'
import Button from './Button'
import styles from './BackButton.module.css'

export default function BackButton({ fallbackPath = '/' }) {
  const navigate = useNavigate()

  return (
    <Button
      variant="tertiary"
      size="sm"
      className={styles.backButton}
      onClick={() => {
        if (window.history.length > 1) {
          navigate(-1)
        } else {
          navigate(fallbackPath)
        }
      }}
      aria-label="Back"
    >
      <span className={styles.chevron} aria-hidden="true">‹</span>
      <span className={styles.label}>Back</span>
    </Button>
  )
}


