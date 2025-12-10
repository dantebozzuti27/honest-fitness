import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import styles from './Tooltip.module.css'

export default function Tooltip({
  children,
  content,
  position = 'top', // 'top', 'bottom', 'left', 'right'
  delay = 300,
  className = ''
}) {
  const [visible, setVisible] = useState(false)
  const [coords, setCoords] = useState({ top: 0, left: 0 })
  const triggerRef = useRef(null)
  const tooltipRef = useRef(null)
  const timeoutRef = useRef(null)

  const showTooltip = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    timeoutRef.current = setTimeout(() => {
      if (triggerRef.current && tooltipRef.current) {
        const triggerRect = triggerRef.current.getBoundingClientRect()
        const tooltipRect = tooltipRef.current.getBoundingClientRect()
        
        let top = 0
        let left = 0

        switch (position) {
          case 'top':
            top = triggerRect.top - tooltipRect.height - 8
            left = triggerRect.left + (triggerRect.width / 2) - (tooltipRect.width / 2)
            break
          case 'bottom':
            top = triggerRect.bottom + 8
            left = triggerRect.left + (triggerRect.width / 2) - (tooltipRect.width / 2)
            break
          case 'left':
            top = triggerRect.top + (triggerRect.height / 2) - (tooltipRect.height / 2)
            left = triggerRect.left - tooltipRect.width - 8
            break
          case 'right':
            top = triggerRect.top + (triggerRect.height / 2) - (tooltipRect.height / 2)
            left = triggerRect.right + 8
            break
        }

        // Keep tooltip within viewport
        const padding = 8
        top = Math.max(padding, Math.min(top, window.innerHeight - tooltipRect.height - padding))
        left = Math.max(padding, Math.min(left, window.innerWidth - tooltipRect.width - padding))

        setCoords({ top, left })
        setVisible(true)
      }
    }, delay)
  }

  const hideTooltip = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    setVisible(false)
  }

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  if (!content) return children

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        onFocus={showTooltip}
        onBlur={hideTooltip}
        className={styles.trigger}
      >
        {children}
      </span>
      {visible && createPortal(
        <div
          ref={tooltipRef}
          className={`${styles.tooltip} ${styles[position]} ${className}`}
          style={{
            top: `${coords.top}px`,
            left: `${coords.left}px`
          }}
          role="tooltip"
        >
          {content}
        </div>,
        document.body
      )}
    </>
  )
}

