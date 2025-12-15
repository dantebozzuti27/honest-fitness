import { useNavigate } from 'react-router-dom'
import SideMenu from '../components/SideMenu'
import BackButton from '../components/BackButton'
import styles from './Progress.module.css'

export default function Progress() {
  const navigate = useNavigate()

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <SideMenu />
        <h1 className={styles.title}>Progress</h1>
        <BackButton />
      </header>

      <div className={styles.grid}>
        <button className={styles.card} onClick={() => navigate('/analytics')}>
          <div className={styles.cardTitle}>Analytics</div>
          <div className={styles.cardSubtitle}>Trends, readiness, and insights</div>
        </button>

        <button className={styles.card} onClick={() => navigate('/calendar')}>
          <div className={styles.cardTitle}>Calendar</div>
          <div className={styles.cardSubtitle}>Schedule + review sessions</div>
        </button>

        <button className={styles.card} onClick={() => navigate('/planner')}>
          <div className={styles.cardTitle}>Plan</div>
          <div className={styles.cardSubtitle}>Weekly plan + today’s focus</div>
        </button>
      </div>
    </div>
  )
}


