/**
 * Beautiful Empty State Component
 * Apple-style empty states with illustrations and helpful messaging
 */

import styles from './EmptyState.module.css'

export default function EmptyState({ 
  icon = '📊',
  title,
  message,
  actionLabel,
  onAction,
  illustration
}) {
  return (
    <div className={styles.emptyState}>
      {illustration ? (
        <div className={styles.illustration}>{illustration}</div>
      ) : (
        <div className={styles.icon}>{icon}</div>
      )}
      {title && <h3 className={styles.title}>{title}</h3>}
      {message && <p className={styles.message}>{message}</p>}
      {actionLabel && onAction && (
        <button className={styles.actionBtn} onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  )
}
