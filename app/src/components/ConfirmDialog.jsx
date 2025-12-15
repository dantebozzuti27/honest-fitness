import styles from './ConfirmDialog.module.css'

export default function ConfirmDialog({
  open,
  title = 'Confirm',
  message = '',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel
}) {
  if (!open) return null

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label={title}>
      <div className={styles.dialog}>
        <div className={styles.header}>
          <div className={styles.title}>{title}</div>
        </div>
        {message ? <div className={styles.message}>{message}</div> : null}
        <div className={styles.actions}>
          <button className={styles.cancelBtn} onClick={onCancel} type="button">
            {cancelText}
          </button>
          <button
            className={`${styles.confirmBtn} ${destructive ? styles.destructive : ''}`}
            onClick={onConfirm}
            type="button"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}


