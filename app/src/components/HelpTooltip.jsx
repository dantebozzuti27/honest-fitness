/**
 * Contextual Help Tooltip Component
 * Apple-style tooltip with info icon and helpful explanations
 */

import { useState } from 'react'
import styles from './HelpTooltip.module.css'

export default function HelpTooltip({ 
  content, 
  title,
  position = 'top' // 'top' | 'bottom' | 'left' | 'right'
}) {
  const [show, setShow] = useState(false)

  if (!content) return null

  return (
    <div 
      className={styles.tooltipContainer}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onTouchStart={() => setShow(!show)}
    >
      <button 
        className={styles.helpIcon}
        aria-label="Help"
        type="button"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01" />
        </svg>
      </button>
      {show && (
        <div className={`${styles.tooltip} ${styles[position]}`}>
          {title && <div className={styles.tooltipTitle}>{title}</div>}
          <div className={styles.tooltipContent}>{content}</div>
        </div>
      )}
    </div>
  )
}

