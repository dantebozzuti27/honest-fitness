import { useEffect } from 'react'
import Button from './Button'
import styles from './Toast.module.css'
import type { ToastType } from '../hooks/useToast'

export type ToastProps = {
  message: string
  type?: ToastType
  onClose: () => void
  duration?: number
}

export default function Toast({ message, type = 'success', onClose, duration = 3000 }: ToastProps) {
  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        onClose()
      }, duration)
      return () => clearTimeout(timer)
    }
  }, [duration, onClose])

  return (
    <div className={`${styles.toast} ${styles[type]}`}>
      <div className={styles.toastContent}>
        <span className={styles.toastIcon}>
          {type === 'success' ? 'OK' : type === 'error' ? '!' : 'i'}
        </span>
        <span className={styles.toastMessage}>{message}</span>
      </div>
      <Button unstyled className={styles.toastClose} onClick={onClose}>×</Button>
    </div>
  )
}



