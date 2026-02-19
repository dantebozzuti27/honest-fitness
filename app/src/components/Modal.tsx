import type { CSSProperties, ReactNode, RefObject } from 'react'
import { useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useModalA11y } from '../hooks/useModalA11y'
import styles from './Modal.module.css'

/**
 * Modal
 * Shared modal/overlay primitive:
 * - Portal to document.body
 * - ESC close + focus trap + restore focus (useModalA11y)
 * - Click outside closes (configurable)
 *
 * Styling:
 * - Uses `Modal.module.css` by default
 * - You can override classes via overlayClassName/modalClassName
 */
type ModalProps = {
  isOpen: boolean
  onClose: () => void
  children: ReactNode
  overlayClassName?: string
  modalClassName?: string
  overlayStyle?: CSSProperties
  modalStyle?: CSSProperties
  ariaLabel?: string
  ariaLabelledBy?: string
  closeOnOverlayClick?: boolean
  initialFocusRef?: RefObject<HTMLElement | null>
  containerRef?: RefObject<HTMLElement | null>
}

export default function Modal({
  isOpen,
  onClose,
  children,
  overlayClassName,
  modalClassName,
  overlayStyle,
  modalStyle,
  ariaLabel,
  ariaLabelledBy,
  closeOnOverlayClick = true,
  initialFocusRef,
  containerRef: externalContainerRef
}: ModalProps) {
  const internalRef = useRef<HTMLElement | null>(null)
  const containerRef = externalContainerRef || internalRef

  const dialogProps = useMemo(() => {
    const p: Record<string, unknown> = {
      role: 'dialog',
      'aria-modal': true
    }
    if (ariaLabel) p['aria-label'] = ariaLabel
    if (ariaLabelledBy) p['aria-labelledby'] = ariaLabelledBy
    return p
  }, [ariaLabel, ariaLabelledBy])

  useModalA11y({
    open: Boolean(isOpen),
    onClose,
    containerRef,
    initialFocusRef
  })

  if (!isOpen) return null

  return createPortal(
    <div
      className={overlayClassName || styles.overlay}
      style={overlayStyle}
      onMouseDown={() => {
        if (closeOnOverlayClick) onClose?.()
      }}
    >
      <div
        {...dialogProps}
        ref={containerRef}
        className={modalClassName || styles.modal}
        style={modalStyle}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body
  )
}


