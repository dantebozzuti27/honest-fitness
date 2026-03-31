import { useEffect, useRef, useCallback } from 'react'
import styles from './ConfirmDialog.module.css'
import Button from './Button'

/**
 * ConfirmDialog
 * Backwards-compatible prop API:
 * - `open` or `isOpen`
 * - `onCancel` or `onClose`
 * - `destructive` or `isDestructive`
 */
export type ConfirmDialogProps = {
  open?: boolean
  isOpen?: boolean
  title?: string
  message?: string
  confirmText?: string
  cancelText?: string
  destructive?: boolean
  isDestructive?: boolean
  onConfirm?: () => void
  onCancel?: () => void
  onClose?: () => void
}

export default function ConfirmDialog(props: ConfirmDialogProps) {
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

  const cancelBtnRef = useRef<HTMLButtonElement | null>(null)
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null)

  const onConfirmRef = useRef(onConfirm)
  onConfirmRef.current = onConfirm
  const handleCancelRef = useRef(handleCancel)
  handleCancelRef.current = handleCancel

  useEffect(() => {
    if (!open) return
    cancelBtnRef.current?.focus?.()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCancelRef.current?.()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        onConfirmRef.current?.()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  // Native DOM click listener on the confirm button so that clicks
  // dispatched by browser-automation frameworks (which bypass React's
  // synthetic event delegation) still trigger the confirm action.
  useEffect(() => {
    if (!open) return
    const btn = confirmBtnRef.current
    if (!btn) return
    const handler = () => onConfirmRef.current?.()
    btn.addEventListener('click', handler)
    return () => btn.removeEventListener('click', handler)
  }, [open])

  const setConfirmRef = useCallback((el: HTMLButtonElement | null) => {
    confirmBtnRef.current = el
  }, [])

  if (!open) return null

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={() => handleCancelRef.current?.()}
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
            onClick={() => handleCancelRef.current?.()}
            type="button"
          >
            {cancelText}
          </Button>
          <Button
            ref={setConfirmRef}
            variant={destructive ? 'destructive' : 'primary'}
            onClick={() => onConfirmRef.current?.()}
            type="button"
          >
            {confirmText}
          </Button>
        </div>
      </div>
    </div>
  )
}


