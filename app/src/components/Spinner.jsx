import styles from './Spinner.module.css'

export default function Spinner({ size = 'md', color = 'secondary' }) {
  return (
    <div className={`${styles.spinner} ${styles[size]} ${styles[color]}`}>
      <div className={styles.spinnerCircle}></div>
    </div>
  )
}

