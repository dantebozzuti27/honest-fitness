import React from 'react'
import styles from './Card.module.css'

/**
 * Card
 * A resilient surface primitive. Use everywhere instead of ad-hoc div+border combos.
 */
export default function Card({
  children,
  className = '',
  as: Tag = 'div',
  variant = 'surface', // surface | subtle
  interactive = false,
  ...props
}) {
  const variantClass = variant === 'subtle' ? styles.subtle : styles.surface
  const interactiveClass = interactive ? styles.interactive : ''

  return (
    <Tag
      className={`${styles.card} ${variantClass} ${interactiveClass} ${className}`}
      {...props}
    >
      {children}
    </Tag>
  )
}


