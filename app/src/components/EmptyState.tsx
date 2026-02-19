/**
 * Beautiful Empty State Component
 * Apple-style empty states with illustrations and helpful messaging
 */

import type { ReactNode } from 'react'
import styles from './EmptyState.module.css'
import Button from './Button'

export type EmptyStateProps = {
  icon?: ReactNode | null
  illustration?: ReactNode | null
  title?: string
  message?: string
  actionLabel?: string
  onAction?: (() => void) | null
}

export default function EmptyState({ 
  icon = null,
  title,
  message,
  actionLabel,
  onAction,
  illustration = null
}: EmptyStateProps) {
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
