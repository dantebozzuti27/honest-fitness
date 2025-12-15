/**
 * Beautiful Empty State Component
 * Apple-style empty states with illustrations and helpful messaging
 */

import styles from './EmptyState.module.css'
import Button from './Button'

export default function EmptyState({ 
  icon = null,
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
      ) : icon ? (
        <div className={styles.icon}>{icon}</div>
      ) : null}
      {title && <h3 className={styles.title}>{title}</h3>}
      {message && <p className={styles.message}>{message}</p>}
      {actionLabel && onAction && typeof onAction === 'function' && (
        <Button
          variant="primary"
          onClick={() => {
            if (onAction && typeof onAction === 'function') {
              onAction()
            }
          }}
        >
          {actionLabel}
        </Button>
      )}
    </div>
  )
}
