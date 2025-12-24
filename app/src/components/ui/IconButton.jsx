import React from 'react'
import styles from './IconButton.module.css'

export default function IconButton({
  children,
  className = '',
  variant = 'ghost', // ghost | surface
  size = 'md', // sm | md
  ...props
}) {
  const v = variant === 'surface' ? styles.surface : styles.ghost
  const s = size === 'sm' ? styles.sm : styles.md
  return (
    <button type="button" className={`${styles.btn} ${v} ${s} ${className}`} {...props}>
      {children}
    </button>
  )
}


