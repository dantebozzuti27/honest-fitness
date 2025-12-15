import { useEffect, useRef } from 'react'
import styles from './ConfirmDialog.module.css'
import Button from './Button'

/**
 * ConfirmDialog
 * Backwards-compatible prop API:
 * - `open` or `isOpen`
 * - `onCancel` or `onClose`
 * - `destructive` or `isDestructive`
 */
export default function ConfirmDialog(props) {
  const {
    open: openProp,
    isOpen,
    title = 'Confirm',
    message = '',
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    destructive: destructiveProp = false,
    isDestructive,
    onConfirm,
    onCancel,
    onClose
  } = props || {}

  const open = typeof isOpen === 'boolean' ? isOpen : Boolean(openProp)
  const destructive = typeof isDestructive === 'boolean' ? isDestructive : Boolean(destructiveProp)
  const handleCancel = onCancel || onClose

  const cancelBtnRef = useRef(null)

  useEffect(() => {
    if (!open) return
    // Focus the safe action by default
    cancelBtnRef.current?.focus?.()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        handleCancel?.()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, handleCancel])

  if (!open) return null

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={() => handleCancel?.()}
    >
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.title}>{title}</div>
        </div>
        {message ? <div className={styles.message}>{message}</div> : null}
        <div className={styles.actions}>
          <Button
            ref={cancelBtnRef}
            variant="secondary"
            onClick={() => handleCancel?.()}
            type="button"
          >
            {cancelText}
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'primary'}
            onClick={() => onConfirm?.()}
            type="button"
          >
            {confirmText}
          </Button>
        </div>
      </div>
    </div>
  )
}


