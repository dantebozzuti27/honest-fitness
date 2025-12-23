import Modal from '../Modal'
import styles from './Sheet.module.css'

/**
 * Sheet
 *
 * Bottom-sheet primitive (mobile-first).
 * Uses the shared `Modal` for focus trap + ESC close + portal.
 */
export default function Sheet({
  isOpen,
  onClose,
  children,
  ariaLabel = 'Sheet',
  initialFocusRef,
  containerRef,
  contentClassName = '',
  closeOnOverlayClick = true
}) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel={ariaLabel}
      overlayClassName={styles.overlay}
      modalClassName={`${styles.sheet} ${contentClassName}`.trim()}
      closeOnOverlayClick={closeOnOverlayClick}
      initialFocusRef={initialFocusRef}
      containerRef={containerRef}
    >
      {children}
    </Modal>
  )
}


