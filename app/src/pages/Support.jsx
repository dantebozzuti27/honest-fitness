import BackButton from '../components/BackButton'
import HomeButton from '../components/HomeButton'
import Button from '../components/Button'
import styles from './Support.module.css'
import { SUPPORT_EMAIL } from '../config/appStore'

export default function Support() {
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <BackButton fallbackPath="/" />
        <h1>Support</h1>
        <HomeButton />
      </div>

      <div className={styles.content}>
        <div className={styles.card}>
          <h2>Contact</h2>
          <p className={styles.muted}>
            Need help, have feedback, or want to report a bug? Email us and we’ll get back to you.
          </p>
          <div className={styles.actions}>
            <a className={styles.linkBtn} href={`mailto:${SUPPORT_EMAIL}`}>
              Email {SUPPORT_EMAIL}
            </a>
          </div>
        </div>

        <div className={styles.card}>
          <h2>Account & data</h2>
          <ul className={styles.list}>
            <li>
              <strong>Export your data:</strong> Profile → Export (CSV/JSON)
            </li>
            <li>
              <strong>Delete your account:</strong> Profile → Delete Account (permanent, deletes your workouts/metrics/etc.)
            </li>
          </ul>
        </div>

        <div className={styles.card}>
          <h2>Quick fixes</h2>
          <ul className={styles.list}>
            <li>
              <strong>Login issues:</strong> confirm you’re using the same provider (Apple/Google/email) you originally signed up with.
            </li>
            <li>
              <strong>Sync issues:</strong> Wearables → reconnect provider, then pull-to-refresh the Health page.
            </li>
          </ul>
        </div>

        <div className={styles.card}>
          <h2>Legal</h2>
          <div className={styles.actions}>
            <Button
              unstyled
              className={styles.linkBtn}
              onClick={() => {
                window.location.href = '/privacy'
              }}
            >
              Privacy Policy
            </Button>
            <Button
              unstyled
              className={styles.linkBtn}
              onClick={() => {
                window.location.href = '/terms'
              }}
            >
              Terms of Service
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}


