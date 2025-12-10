import styles from './EmptyState.module.css'

export default function EmptyState({ 
  icon = '📭', 
  title = 'No data', 
  message = 'There\'s nothing here yet.',
  actionLabel,
  onAction,
  size = 'medium'
}) {
  return (
    <div className={`${styles.emptyState} ${styles[size]}`}>
      <div className={styles.icon}>{icon}</div>
      <h3 className={styles.title}>{title}</h3>
      {message && <p className={styles.message}>{message}</p>}
      {actionLabel && onAction && (
        <button className={styles.actionBtn} onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  )
}

