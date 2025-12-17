import { useNavigate } from 'react-router-dom'
import BackButton from '../components/BackButton'
import SideMenu from '../components/SideMenu'
import Button from '../components/Button'
import styles from './Pricing.module.css'

export default function Pricing() {
  const navigate = useNavigate()

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <SideMenu />
        <h1 className={styles.title}>Pro</h1>
        <BackButton />
      </header>

      <div className={styles.hero}>
        <div className={styles.heroTitle}>Progression that improves every session.</div>
        <div className={styles.heroSub}>HonestFitness Pro is built for serious lifters.</div>
      </div>

      <div className={styles.grid}>
        <div className={styles.card}>
          <div className={styles.cardTitle}>Free</div>
          <div className={styles.price}>$0</div>
          <ul className={styles.list}>
            <li>Fast workout logging</li>
            <li>Workout history</li>
            <li>Basic PRs</li>
          </ul>
        </div>

        <div className={styles.cardPro}>
          <div className={styles.cardTitle}>Pro</div>
          <div className={styles.price}>Coming soon</div>
          <ul className={styles.list}>
            <li>Progression prescriptions (per exercise)</li>
            <li>Advanced analytics (weekly sets by muscle, adherence)</li>
            <li>Template packs + auto-progression</li>
            <li>Priority offline sync + reliability surfaces</li>
          </ul>
          <Button
            className={styles.cta}
            onClick={() => navigate('/invite/me')}
            title="Invite flow placeholder (payments not wired yet)"
          >
            Join waitlist
          </Button>
          <div className={styles.footnote}>
            Payments aren’t wired in yet — this page is the product/UX scaffold.
          </div>
        </div>
      </div>
    </div>
  )
}



