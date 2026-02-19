import type { ButtonHTMLAttributes, ReactNode } from 'react'
import styles from './IconButton.module.css'

export type IconButtonVariant = 'ghost' | 'surface'
export type IconButtonSize = 'sm' | 'md'

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode
  className?: string
  variant?: IconButtonVariant
  size?: IconButtonSize
}

export default function IconButton({
  children,
  className = '',
  variant = 'ghost', // ghost | surface
  size = 'md', // sm | md
  ...props
}: IconButtonProps) {
  const v = variant === 'surface' ? styles.surface : styles.ghost
  const s = size === 'sm' ? styles.sm : styles.md
  return (
    <button type="button" className={`${styles.btn} ${v} ${s} ${className}`} {...props}>
      {children}
    </button>
  )
}


