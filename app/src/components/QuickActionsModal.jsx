import Modal from './Modal'
import LogHub from './LogHub'
import styles from './QuickActionsModal.module.css'

export default function QuickActionsModal({ isOpen, onClose, pendingSyncCount = 0 }) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel="Log hub"
      modalClassName={styles.modal}
      overlayClassName={styles.overlay}
    >
      <LogHub variant="sheet" onClose={onClose} pendingSyncCount={pendingSyncCount} />
    </Modal>
  )
}


